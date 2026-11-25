"""Load the Steam files that fetch/sync saved (data/steam/) into data/steam.db and build the shared tables.

  snapshots/<YYYY-MM-DD>.json   your library that day: [{appid, name, minutes, last_played}] (lifetime totals)
  games/<appid>.json            {appid, achievements: [{api, name, desc, unlocked}], rarity: {api: pct}, genres: [...]}

Hours are dated two ways (games.py): growth between daily snapshots is exact play on that day; hours from before the
first snapshot are spread over the days the game's achievements were unlocked (or its last-played day), marked as
estimates. Only what the stats use is stored: no friends, profile, or other account data.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from ... import db
from ...imports import ImportRejected, Source
from .. import store
from ..base import finish_build
from ..games import snapshot_deltas, spread
from ..store import Creator, Item, View

SCHEMA = """
CREATE TABLE IF NOT EXISTS st_snapshots (day TEXT NOT NULL, appid INTEGER NOT NULL, minutes INTEGER NOT NULL,
                                         last_played INTEGER, PRIMARY KEY (day, appid));
CREATE TABLE IF NOT EXISTS st_games (appid INTEGER PRIMARY KEY, name TEXT NOT NULL, genres TEXT);
CREATE TABLE IF NOT EXISTS st_achievements (
    appid       INTEGER NOT NULL,
    api         TEXT NOT NULL,
    name        TEXT,
    description TEXT,
    unlocked    INTEGER,          -- epoch seconds, NULL = not unlocked
    rarity      REAL,             -- % of players who have it
    PRIMARY KEY (appid, api)
);
"""

ART = "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/{appid}/"


def init(conn: sqlite3.Connection) -> None:
    db.init_db(conn)
    conn.executescript(SCHEMA)


def _int(v, default: int | None = None) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def ingest(conn: sqlite3.Connection, folder: Path) -> dict:
    """Replace the stored Steam data with what's in `folder` (every snapshot and game file there)."""
    snaps = sorted((folder / "snapshots").glob("*.json")) if (folder / "snapshots").is_dir() else []
    if not snaps:
        raise FileNotFoundError(f"No Steam library snapshots in {folder / 'snapshots'}. Run `python backend/cli.py fetch --platform steam` first.")
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
            raise ImportRejected(f"{path.name} isn't a Steam library snapshot")
        for g in data["games"]:
            appid, minutes = _int(g.get("appid")), _int(g.get("minutes"), 0)
            if not appid or not isinstance(g.get("name"), str):
                continue
            rows.append((day, appid, max(0, minutes or 0), _int(g.get("last_played"))))
            games[appid] = g["name"][:300]
    ach, genres = [], {}
    for path in sorted((folder / "games").glob("*.json")) if (folder / "games").is_dir() else []:
        with Source(path) as src:
            g = src.read_json(src.names()[0])
        appid = _int(g.get("appid")) if isinstance(g, dict) else None
        if not appid:
            continue
        genres[appid] = [x for x in g.get("genres") or [] if isinstance(x, str)][:6]
        rarity = g.get("rarity") if isinstance(g.get("rarity"), dict) else {}
        for a in g.get("achievements") or []:
            if isinstance(a, dict) and isinstance(a.get("api"), str):
                pct = rarity.get(a["api"])
                ach.append((appid, a["api"], a.get("name"), a.get("desc"), _int(a.get("unlocked")) or None,
                            float(pct) if isinstance(pct, (int, float, str)) and str(pct).replace(".", "", 1).isdigit() else None))
    init(conn)
    conn.execute("DELETE FROM st_snapshots")
    conn.execute("DELETE FROM st_games")
    conn.execute("DELETE FROM st_achievements")
    conn.executemany("INSERT OR REPLACE INTO st_snapshots VALUES (?,?,?,?)", rows)
    conn.executemany("INSERT INTO st_games VALUES (?,?,?)", [(a, n, json.dumps(genres.get(a, []))) for a, n in games.items()])
    conn.executemany("INSERT OR REPLACE INTO st_achievements VALUES (?,?,?,?,?,?)", ach)
    conn.commit()
    return {"snapshots": len(snaps), "games": len(games), "achievements": sum(1 for a in ach if a[4])}


def build(conn: sqlite3.Connection, tz: ZoneInfo) -> int:
    """Dated play from snapshots (exact) and, before the first one, from achievement days (estimated)."""
    init(conn)
    snaps: dict[date, dict[str, int]] = defaultdict(dict)
    last_played: dict[int, int] = {}
    for day, appid, minutes, lp in conn.execute("SELECT day, appid, minutes, last_played FROM st_snapshots ORDER BY day, appid"):
        snaps[date.fromisoformat(day)][str(appid)] = minutes
        if lp:
            last_played[appid] = max(lp, last_played.get(appid, 0))
    if not snaps:
        return 0
    first = min(snaps)
    unlocks: dict[int, list[datetime]] = defaultdict(list)
    for appid, ts in conn.execute("SELECT appid, unlocked FROM st_achievements WHERE unlocked IS NOT NULL ORDER BY appid, unlocked"):
        unlocks[appid].append(datetime.fromtimestamp(ts, tz))

    plays: list[tuple[date, int, int, str]] = []          # (day, appid, minutes, how)
    for appid_s, minutes in snaps[first].items():           # before the first snapshot: estimates
        appid = int(appid_s)
        before = [u.date() for u in unlocks[appid] if u.date() < first]
        lp = datetime.fromtimestamp(last_played[appid], tz).date() if last_played.get(appid) else None
        fallback = lp if lp and lp < first else first - timedelta(days=1)
        plays += [(d, appid, m, "estimate") for d, m in spread(minutes, before, fallback)]
    plays += [(d, int(a), m, "snapshot") for d, a, m in snapshot_deltas(snaps)]

    first_unlock_on: dict[tuple[int, date], datetime] = {}
    for appid, us in unlocks.items():
        for u in us:
            first_unlock_on.setdefault((appid, u.date()), u)
    views = []
    for n, (day, appid, minutes, how) in enumerate(sorted(plays), 1):
        # the time of day: the day's first achievement for that game when there is one (real), else midday
        at = first_unlock_on.get((appid, day)) or datetime.combine(day, time(12), tz)
        start = at - timedelta(minutes=min(minutes, 12 * 60) / 2) if how == "estimate" else at
        local = start.astimezone(tz)
        views.append(View(n, "play", f"game:{appid}", f"game:{appid}", start.timestamp(), local, minutes * 60, how,
                          duration_s=minutes * 60, local_date=day.isoformat()))
    store.assign_sessions(views)

    names = dict(conn.execute("SELECT appid, name FROM st_games"))
    genre_of = {a: json.loads(g or "[]") for a, g in conn.execute("SELECT appid, genres FROM st_games")}
    ach = {a: (n, u) for a, n, u in conn.execute("SELECT appid, COUNT(*), COUNT(unlocked) FROM st_achievements GROUP BY appid")}
    latest = max(snaps)
    items, creators = [], []
    for appid, name in names.items():
        gid = f"game:{appid}"
        total, got = ach.get(appid, (0, 0))
        extra = json.dumps({"minutes": snaps[latest].get(str(appid), 0), "achievements": total, "unlocked": got,
                            "last_played": datetime.fromtimestamp(last_played[appid], timezone.utc).date().isoformat()
                            if last_played.get(appid) else None})
        art = ART.format(appid=appid)
        items.append(Item(gid, "ok", name, gid, art + "library_600x900.jpg", art + "header.jpg",
                          url=f"https://store.steampowered.com/app/{appid}/", extra=extra))
        creators.append(Creator(gid, "ok", name, avatar_url=art + "library_600x900.jpg",
                                url=f"https://store.steampowered.com/app/{appid}/", extra=extra))
    conn.execute("PRAGMA foreign_keys=OFF")  # no YouTube-style raw `entries` table here
    n = store.write_views(conn, views)
    store.write_items(conn, items)
    store.write_creators(conn, creators)
    store.write_genres(conn, {f"game:{a}": g for a, g in genre_of.items() if g})
    caps = ["estimated_time", "time_of_day", "achievements"] + (["genres"] if any(genre_of.values()) else [])
    db.set_meta(conn, "extra_capabilities", ",".join(caps))
    db.set_meta(conn, "tracked_since", first.isoformat())
    finish_build(conn)
    return n
