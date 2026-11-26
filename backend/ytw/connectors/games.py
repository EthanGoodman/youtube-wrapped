"""The games family's shared pieces (#21): what's actually known about your play, and nothing invented.

Game platforms (Steam, Epic, PlayStation, Xbox) give running totals per game, not a log of sessions. So:
  - hours are dated only where they really can be: the growth between a day's snapshot and the previous day's is
    play on that day (the sync checks hourly while the app runs, so a day's last check is close to midnight);
  - everything else (all the hours from before tracking began, and growth across a gap of more than a day when
    the app wasn't running) has no date: it counts in lifetime totals only (stats.common.UNDATED_TABLE) and never
    reaches a calendar, chart, record or Wrapped;
  - the past is told by achievements instead: each unlock is a real, timestamped moment of play (stats/games.py).

Every game platform saves the same small files (its fetch writes them in data/<platform>/):

  snapshots/<YYYY-MM-DD>.json   your library at that day's last check: {"day", "at": epoch, "games": [{id, name,
                                minutes, last_played, acquired, first_played, plays}]} (lifetime totals; the dates are
                                epochs or null; first_played and plays (sessions) only where the platform says, e.g. PSN)
  games/<id>.json               {id, achievements: [{api, name, desc, unlocked, type}], rarity: {api: pct}, genres: [...],
                                 and optionally poster / header / url when the platform's art isn't at a fixed address}

load() reads them into the game_* tables and build() writes the shared tables like every platform: one View per
game per tracked day (kind "play", item = creator = the game, so top lists rank games), Items/Creators for the
games. Steam's files say "appid" for the id.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date, datetime, time
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

from .. import db
from ..imports import ImportRejected, Source
from ..stats.common import UNDATED_TABLE
from . import store
from .base import finish_build
from .store import Creator, Item, View

SCHEMA = """
CREATE TABLE IF NOT EXISTS game_snapshots (day TEXT NOT NULL, game TEXT NOT NULL, minutes INTEGER NOT NULL,
                                           last_played INTEGER, PRIMARY KEY (day, game));
CREATE TABLE IF NOT EXISTS game_titles (game TEXT PRIMARY KEY, name TEXT NOT NULL, genres TEXT,
                                        poster TEXT, header TEXT, url TEXT,
                                        acquired INTEGER,    -- epoch: when you got it (Epic says; Steam doesn't)
                                        first_played INTEGER, plays INTEGER);   -- PlayStation says both
CREATE TABLE IF NOT EXISTS game_achievements (
    game        TEXT NOT NULL,
    api         TEXT NOT NULL,
    name        TEXT,
    description TEXT,
    unlocked    INTEGER,          -- epoch seconds, NULL = not unlocked
    rarity      REAL,             -- % of players who have it
    kind        TEXT,             -- trophies: platinum | gold | silver | bronze
    PRIMARY KEY (game, api)
);
"""
_OLD = ("st_snapshots", "st_games", "st_achievements")   # Steam's tables before the games family shared them


def init(conn: sqlite3.Connection) -> None:
    db.init_db(conn)
    conn.executescript(SCHEMA)
    for table, col in (("game_titles", "acquired"), ("game_titles", "first_played"), ("game_titles", "plays"), ("game_achievements", "kind")):
        if col not in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {'TEXT' if col == 'kind' else 'INTEGER'}")
    have = {n for (n,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if set(_OLD) <= have:                      # a Steam database from before the rename: same rows, new names
        conn.execute("INSERT OR IGNORE INTO game_snapshots SELECT day, CAST(appid AS TEXT), minutes, last_played FROM st_snapshots")
        conn.execute("INSERT OR IGNORE INTO game_titles (game, name, genres) SELECT CAST(appid AS TEXT), name, genres FROM st_games")
        conn.execute("INSERT OR IGNORE INTO game_achievements (game, api, name, description, unlocked, rarity) "
                     "SELECT CAST(appid AS TEXT), api, name, description, unlocked, rarity FROM st_achievements")
        for t in _OLD:
            conn.execute(f"DROP TABLE {t}")
        conn.commit()


def _int(v, default: int | None = None) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _id(g: dict) -> str | None:
    """A game's id from its file: Epic's app name, Steam's appid or a PlayStation title id, as text (never a path)."""
    v = g.get("id", g.get("appid"))
    v = str(v).strip() if isinstance(v, (str, int)) and not isinstance(v, bool) else ""
    return v[:200] if v and "/" not in v and "\\" not in v else None


def _https(v) -> str | None:
    return v[:1000] if isinstance(v, str) and v.startswith("https://") else None


def load(conn: sqlite3.Connection, folder: Path, name: str, fetch_cmd: str) -> dict:
    """Replace the stored game data with what's in `folder` (every snapshot and game file there)."""
    snaps = sorted((folder / "snapshots").glob("*.json")) if (folder / "snapshots").is_dir() else []
    if not snaps:
        raise FileNotFoundError(f"No {name} library snapshots in {folder / 'snapshots'}. Run `{fetch_cmd}` first.")
    rows, games, acquired, first_played, plays = [], {}, {}, {}, {}
    for path in snaps:
        day = path.stem
        try:
            date.fromisoformat(day)
        except ValueError:
            continue
        with Source(path) as src:
            data = src.read_json(src.names()[0])
        if not isinstance(data, dict) or not isinstance(data.get("games"), list):
            raise ImportRejected(f"{path.name} isn't a {name} library snapshot")
        for g in data["games"]:
            gid = _id(g) if isinstance(g, dict) else None
            if not gid or not isinstance(g.get("name"), str):
                continue
            rows.append((day, gid, max(0, _int(g.get("minutes"), 0) or 0), _int(g.get("last_played"))))
            games[gid] = g["name"][:300]
            if _int(g.get("acquired")):
                acquired[gid] = _int(g.get("acquired"))
            if _int(g.get("first_played")):
                first_played[gid] = min(_int(g.get("first_played")), first_played.get(gid) or 2**62)
            if _int(g.get("plays")) is not None:
                plays[gid] = _int(g.get("plays"))            # the latest snapshot's count
    ach, extra = [], {}
    for path in sorted((folder / "games").glob("*.json")) if (folder / "games").is_dir() else []:
        with Source(path) as src:
            g = src.read_json(src.names()[0])
        gid = _id(g) if isinstance(g, dict) else None
        if not gid:
            continue
        extra[gid] = (json.dumps([x for x in g.get("genres") or [] if isinstance(x, str)][:6]),
                      _https(g.get("poster")), _https(g.get("header")), _https(g.get("url")))
        rarity = g.get("rarity") if isinstance(g.get("rarity"), dict) else {}
        for a in g.get("achievements") or []:
            if isinstance(a, dict) and isinstance(a.get("api"), str):
                pct = rarity.get(a["api"])
                ach.append((gid, a["api"], a.get("name"), a.get("desc"), _int(a.get("unlocked")) or None,
                            float(pct) if isinstance(pct, (int, float, str)) and str(pct).replace(".", "", 1).isdigit() else None,
                            a.get("type") if a.get("type") in ("platinum", "gold", "silver", "bronze") else None))
    init(conn)
    conn.execute("DELETE FROM game_snapshots")
    conn.execute("DELETE FROM game_titles")
    conn.execute("DELETE FROM game_achievements")
    conn.executemany("INSERT OR REPLACE INTO game_snapshots VALUES (?,?,?,?)", rows)
    conn.executemany("INSERT INTO game_titles (game, name, genres, poster, header, url, acquired, first_played, plays) "
                     "VALUES (?,?,?,?,?,?,?,?,?)",
                     [(g, n, *extra.get(g, ("[]", None, None, None)), acquired.get(g), first_played.get(g), plays.get(g))
                      for g, n in games.items()])
    conn.executemany("INSERT OR REPLACE INTO game_achievements (game, api, name, description, unlocked, rarity, kind) "
                     "VALUES (?,?,?,?,?,?,?)", ach)
    conn.commit()
    return {"snapshots": len(snaps), "games": len(games), "achievements": sum(1 for a in ach if a[4])}


Links = Callable[[str], tuple]   # game id -> (poster, header, store url) when the game file didn't save them


def build(conn: sqlite3.Connection, tz: ZoneInfo, links: Links) -> int:
    """Dated play only where it's known (growth between consecutive days' snapshots); every other minute counts in
    lifetime totals only. The years with any real activity (achievement unlocks or tracked play) go in meta."""
    init(conn)
    snaps: dict[date, dict[str, int]] = defaultdict(dict)
    last_played: dict[str, int] = {}
    for day, gid, minutes, lp in conn.execute("SELECT day, game, minutes, last_played FROM game_snapshots ORDER BY day, game"):
        snaps[date.fromisoformat(day)][gid] = minutes
        if lp:
            last_played[gid] = max(lp, last_played.get(gid, 0))
    if not snaps:
        return 0
    first = min(snaps)

    plays: list[tuple[date, str, int, str]] = []          # (day, game, minutes, how)
    undated: dict[str, int] = defaultdict(int)            # minutes no day can be given
    for gid, minutes in snaps[first].items():              # everything before tracking began
        if minutes > 0:
            undated[gid] += minutes
    for day, gid, minutes, dated in snapshot_deltas(snaps):
        if dated:
            plays.append((day, gid, minutes, "snapshot"))
        else:                                              # a gap of days without a check: can't say which day
            undated[gid] += minutes
    # undated minutes ride on the first snapshot day (inside every all-time range) in their own table
    plays += [(first, gid, m, "undated") for gid, m in sorted(undated.items())]

    views = []
    for n, (day, gid, minutes, how) in enumerate(sorted(plays), 1):
        # the time of day isn't known (a snapshot says how much, not when): local noon, and no time_of_day capability
        at = datetime.combine(day, time(12), tz)
        views.append(View(n, "play", f"game:{gid}", f"game:{gid}", at.timestamp(), at, minutes * 60, how,
                          duration_s=minutes * 60, local_date=day.isoformat()))
    for v in views:
        v.session_id = v.entry_id                          # no sittings: a day's total isn't a session
    active = {d for d, _, _, how in plays if how == "snapshot"}
    active |= {datetime.fromtimestamp(ts, tz).date() for (ts,) in conn.execute("SELECT unlocked FROM game_achievements WHERE unlocked IS NOT NULL")}
    # first and last played are real days of play too (PlayStation and Steam say)
    active |= {datetime.fromtimestamp(ts, tz).date() for (ts,) in conn.execute("SELECT first_played FROM game_titles WHERE first_played IS NOT NULL")}
    active |= {datetime.fromtimestamp(ts, tz).date() for ts in last_played.values() if ts}
    years = {d.year for d in active}

    ach = {g: (n, u) for g, n, u in conn.execute("SELECT game, COUNT(*), COUNT(unlocked) FROM game_achievements GROUP BY game")}
    latest = max(snaps)
    items, creators, genre_of = [], [], {}
    day_of = lambda ts: datetime.fromtimestamp(ts, tz).date().isoformat() if ts else None  # noqa: E731
    for gid, name, genres, poster, header, url, acq, fp, plays in conn.execute(
            "SELECT game, name, genres, poster, header, url, acquired, first_played, plays FROM game_titles"):
        key = f"game:{gid}"
        genre_of[key] = json.loads(genres or "[]")
        dp, dh, du = links(gid)
        poster, header, url = poster or dp, header or dh, url or du
        total, got = ach.get(gid, (0, 0))
        extra = json.dumps({"minutes": snaps[latest].get(gid, 0), "achievements": total, "unlocked": got,
                            "last_played": day_of(last_played.get(gid)), "acquired": day_of(acq),
                            "first_played": day_of(fp), "plays": plays})
        items.append(Item(key, "ok", name, key, poster, header, url=url, extra=extra))
        creators.append(Creator(key, "ok", name, avatar_url=poster, url=url, extra=extra))
    conn.execute("PRAGMA foreign_keys=OFF")  # no YouTube-style raw `entries` table here
    store.write_views(conn, views)
    conn.execute(f"DROP TABLE IF EXISTS {UNDATED_TABLE}")
    conn.execute(f"CREATE TABLE {UNDATED_TABLE} AS SELECT * FROM watches WHERE est_method = 'undated'")
    conn.execute("DELETE FROM watches WHERE est_method = 'undated'")
    n = len(views) - len(undated)
    store.write_items(conn, items)
    store.write_creators(conn, creators)
    store.write_genres(conn, {k: g for k, g in genre_of.items() if g})
    caps = (["achievements"] if ach else []) + (["genres"] if any(genre_of.values()) else [])
    db.set_meta(conn, "extra_capabilities", ",".join(caps))
    db.set_meta(conn, "tracked_since", first.isoformat())
    db.set_meta(conn, "activity_years", ",".join(str(y) for y in sorted(years)))
    db.set_meta(conn, "activity_span", f"{min(active).isoformat()},{max(active).isoformat()}" if active else "")
    finish_build(conn)
    return n


def snapshot_deltas(snapshots: dict[date, dict[str, int]]) -> list[tuple[date, str, int, bool]]:
    """Daily totals {day: {game: minutes}} -> (day, game, minutes, dated): the growth since the previous snapshot.
    `dated` is True only when that snapshot is from the day before, so the growth is that one day's play; after a
    gap (the app wasn't running) it could be any of those days, so it isn't dated. The first snapshot is the
    baseline; a total that goes down (refunds, family sharing) counts as no play."""
    out: list[tuple[date, str, int, bool]] = []
    prev_day: date | None = None
    prev: dict[str, int] = {}
    for day in sorted(snapshots):
        cur = snapshots[day]
        if prev_day is not None:
            for game in sorted(cur):
                grew = cur[game] - prev.get(game, 0)
                if grew > 0:
                    out.append((day, game, grew, (day - prev_day).days == 1))
        prev_day, prev = day, cur
    return out
