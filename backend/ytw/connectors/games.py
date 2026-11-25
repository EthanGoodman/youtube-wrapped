"""The games family's shared pieces (#21): turning lifetime playtime into dated play.

Game platforms (Steam, Epic, PlayStation, Xbox) give running totals, not a log of sessions. Two sources date the hours:
  - daily snapshots of every game's total: the growth from one day to the next is real play that day (exact);
  - before the first snapshot, a game's hours are spread over the days it showed activity (achievement unlocks),
    weighted by how much happened each day; a game with no dated activity goes on its last-played day. These
    are estimates and are marked so (est_method "estimate").

Every game platform saves the same small files (its fetch writes them in data/<platform>/):

  snapshots/<YYYY-MM-DD>.json   your library that day: {"games": [{id, name, minutes, last_played}]} (lifetime totals)
  games/<id>.json               {id, achievements: [{api, name, desc, unlocked}], rarity: {api: pct}, genres: [...],
                                 and optionally poster / header / url when the platform's art isn't at a fixed address}

load() reads them into the game_* tables and build() writes the shared tables like every platform: one View per
game per day played (kind "play", item = creator = the game, so top lists rank games), Items/Creators for the
games; game_achievements feeds the achievement pages (stats/games.py). Steam's files say "appid" for the id.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable
from zoneinfo import ZoneInfo

from .. import db
from ..imports import ImportRejected, Source
from . import store
from .base import finish_build
from .store import Creator, Item, View

SCHEMA = """
CREATE TABLE IF NOT EXISTS game_snapshots (day TEXT NOT NULL, game TEXT NOT NULL, minutes INTEGER NOT NULL,
                                           last_played INTEGER, PRIMARY KEY (day, game));
CREATE TABLE IF NOT EXISTS game_titles (game TEXT PRIMARY KEY, name TEXT NOT NULL, genres TEXT,
                                        poster TEXT, header TEXT, url TEXT);
CREATE TABLE IF NOT EXISTS game_achievements (
    game        TEXT NOT NULL,
    api         TEXT NOT NULL,
    name        TEXT,
    description TEXT,
    unlocked    INTEGER,          -- epoch seconds, NULL = not unlocked
    rarity      REAL,             -- % of players who have it
    PRIMARY KEY (game, api)
);
"""
_OLD = ("st_snapshots", "st_games", "st_achievements")   # Steam's tables before the games family shared them


def init(conn: sqlite3.Connection) -> None:
    db.init_db(conn)
    conn.executescript(SCHEMA)
    have = {n for (n,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if set(_OLD) <= have:                      # a Steam database from before the rename: same rows, new names
        conn.execute("INSERT OR IGNORE INTO game_snapshots SELECT day, CAST(appid AS TEXT), minutes, last_played FROM st_snapshots")
        conn.execute("INSERT OR IGNORE INTO game_titles (game, name, genres) SELECT CAST(appid AS TEXT), name, genres FROM st_games")
        conn.execute("INSERT OR IGNORE INTO game_achievements "
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
    """A game's id from its file: Epic's app name or Steam's appid, as text (never a path)."""
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
    rows, games = [], {}
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
                            float(pct) if isinstance(pct, (int, float, str)) and str(pct).replace(".", "", 1).isdigit() else None))
    init(conn)
    conn.execute("DELETE FROM game_snapshots")
    conn.execute("DELETE FROM game_titles")
    conn.execute("DELETE FROM game_achievements")
    conn.executemany("INSERT OR REPLACE INTO game_snapshots VALUES (?,?,?,?)", rows)
    conn.executemany("INSERT INTO game_titles VALUES (?,?,?,?,?,?)",
                     [(g, n, *extra.get(g, ("[]", None, None, None))) for g, n in games.items()])
    conn.executemany("INSERT OR REPLACE INTO game_achievements VALUES (?,?,?,?,?,?)", ach)
    conn.commit()
    return {"snapshots": len(snaps), "games": len(games), "achievements": sum(1 for a in ach if a[4])}


Links = Callable[[str], tuple]   # game id -> (poster, header, store url) when the game file didn't save them


def build(conn: sqlite3.Connection, tz: ZoneInfo, links: Links) -> int:
    """Dated play from snapshots (exact) and, before the first one, from achievement days (estimated)."""
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
    unlocks: dict[str, list[datetime]] = defaultdict(list)
    for gid, ts in conn.execute("SELECT game, unlocked FROM game_achievements WHERE unlocked IS NOT NULL ORDER BY game, unlocked"):
        unlocks[gid].append(datetime.fromtimestamp(ts, tz))

    plays: list[tuple[date, str, int, str]] = []          # (day, game, minutes, how)
    for gid, minutes in snaps[first].items():              # before the first snapshot: estimates
        before = [u.date() for u in unlocks[gid] if u.date() < first]
        lp = datetime.fromtimestamp(last_played[gid], tz).date() if last_played.get(gid) else None
        fallback = lp if lp and lp < first else first - timedelta(days=1)
        plays += [(d, gid, m, "estimate") for d, m in spread(minutes, before, fallback)]
    plays += [(d, g, m, "snapshot") for d, g, m in snapshot_deltas(snaps)]

    first_unlock_on: dict[tuple[str, date], datetime] = {}
    for gid, us in unlocks.items():
        for u in us:
            first_unlock_on.setdefault((gid, u.date()), u)
    views = []
    for n, (day, gid, minutes, how) in enumerate(sorted(plays), 1):
        # the time of day: the day's first achievement for that game when there is one (real), else midday
        at = first_unlock_on.get((gid, day)) or datetime.combine(day, time(12), tz)
        start = at - timedelta(minutes=min(minutes, 12 * 60) / 2) if how == "estimate" else at
        views.append(View(n, "play", f"game:{gid}", f"game:{gid}", start.timestamp(), start.astimezone(tz), minutes * 60, how,
                          duration_s=minutes * 60, local_date=day.isoformat()))
    store.assign_sessions(views)

    ach = {g: (n, u) for g, n, u in conn.execute("SELECT game, COUNT(*), COUNT(unlocked) FROM game_achievements GROUP BY game")}
    latest = max(snaps)
    items, creators, genre_of = [], [], {}
    for gid, name, genres, poster, header, url in conn.execute("SELECT game, name, genres, poster, header, url FROM game_titles"):
        key = f"game:{gid}"
        genre_of[key] = json.loads(genres or "[]")
        dp, dh, du = links(gid)
        poster, header, url = poster or dp, header or dh, url or du
        total, got = ach.get(gid, (0, 0))
        extra = json.dumps({"minutes": snaps[latest].get(gid, 0), "achievements": total, "unlocked": got,
                            "last_played": datetime.fromtimestamp(last_played[gid], timezone.utc).date().isoformat()
                            if last_played.get(gid) else None})
        items.append(Item(key, "ok", name, key, poster, header, url=url, extra=extra))
        creators.append(Creator(key, "ok", name, avatar_url=poster, url=url, extra=extra))
    conn.execute("PRAGMA foreign_keys=OFF")  # no YouTube-style raw `entries` table here
    n = store.write_views(conn, views)
    store.write_items(conn, items)
    store.write_creators(conn, creators)
    store.write_genres(conn, {k: g for k, g in genre_of.items() if g})
    caps = ["estimated_time", "time_of_day"] + (["achievements"] if ach else []) + (["genres"] if any(genre_of.values()) else [])
    db.set_meta(conn, "extra_capabilities", ",".join(caps))
    db.set_meta(conn, "tracked_since", first.isoformat())
    finish_build(conn)
    return n


def snapshot_deltas(snapshots: dict[date, dict[str, int]]) -> list[tuple[date, str, int]]:
    """Daily totals {day: {game: minutes}} -> (day, game, minutes played that day): the growth since the previous
    snapshot, dated on the later day. The first snapshot is the baseline (nothing before it is dated here); a total
    that goes down (refunds, family sharing) counts as no play."""
    out: list[tuple[date, str, int]] = []
    prev: dict[str, int] | None = None
    for day in sorted(snapshots):
        cur = snapshots[day]
        if prev is not None:
            for game in sorted(cur):
                grew = cur[game] - prev.get(game, 0)
                if grew > 0:
                    out.append((day, game, grew))
        prev = cur
    return out


def spread(minutes: int, activity: Iterable[date], fallback: date | None) -> list[tuple[date, int]]:
    """Spread `minutes` over activity days, weighted by how often each day appears (e.g. one entry per achievement).
    No activity -> all on `fallback` (the last-played day); no fallback either -> nothing can be dated. Whole minutes,
    and the parts always add up to `minutes` (the remainder goes to the busiest days first)."""
    if minutes <= 0:
        return []
    weight: dict[date, int] = defaultdict(int)
    for d in activity:
        weight[d] += 1
    if not weight:
        return [(fallback, minutes)] if fallback else []
    total = sum(weight.values())
    days = sorted(weight, key=lambda d: (-weight[d], d))
    parts = {d: minutes * weight[d] // total for d in days}
    left = minutes - sum(parts.values())
    for d in days[:left]:
        parts[d] += 1
    return sorted((d, m) for d, m in parts.items() if m > 0)
