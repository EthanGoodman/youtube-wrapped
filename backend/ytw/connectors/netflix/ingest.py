"""Load Netflix viewing history into data/netflix.db and build the generic tables from it."""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

from ... import db
from .. import store
from ..base import finish_build
from ..store import Creator, Item, View
from . import tmdb
from .parser import find_files, parse_files, profiles_in

VIEWS_SCHEMA = """
CREATE TABLE IF NOT EXISTS views (
    id           INTEGER PRIMARY KEY,
    source       TEXT NOT NULL,      -- simple (quick download) | full (data export)
    title        TEXT NOT NULL,
    show         TEXT,
    season       TEXT,
    episode      TEXT,
    kind         TEXT NOT NULL,      -- episode | movie | unknown
    local_date   TEXT NOT NULL,
    start_epoch  REAL,               -- full export only
    duration_s   INTEGER,            -- full export only (time actually watched)
    profile      TEXT,
    device       TEXT,
    country      TEXT,
    supplemental TEXT,               -- TRAILER, HOOK, … (not counted)
    attributes   TEXT,
    bookmark_s   INTEGER,
    file_order   INTEGER
);
CREATE INDEX IF NOT EXISTS ix_views_date ON views(local_date);
"""

_SLUG = re.compile(r"[^0-9a-z]+")


def slug(*parts: str | None) -> str:
    return "|".join(_SLUG.sub("-", (p or "").lower()).strip("-") for p in parts)


def init(conn: sqlite3.Connection) -> None:
    db.init_db(conn)
    conn.executescript(VIEWS_SCHEMA)


def ingest(conn: sqlite3.Connection, folder: Path, tz: ZoneInfo, profile: str | None = None) -> dict:
    """Replace the stored history with everything in `folder` (exports are complete snapshots).
    Several files (e.g. two accounts) are merged in date order; a viewing in two files counts once."""
    paths = find_files(folder)
    if not paths:
        raise FileNotFoundError(f"No NetflixViewingHistory.csv or ViewingActivity.csv in {folder}")
    texts = [p.read_text(encoding="utf-8-sig") for p in paths]
    if not profile:
        for p, text in zip(paths, texts):
            names = profiles_in(text)
            if len(names) > 1:
                raise ValueError(f"{p.name} has several profiles: " + ", ".join(names)
                                 + ". Pick yours with --profile or [netflix] profile in config.toml.")
    fmt, views, dropped = parse_files(texts, tz, profile)
    init(conn)
    conn.execute("DELETE FROM views")
    conn.executemany(
        "INSERT INTO views (source, title, show, season, episode, kind, local_date, start_epoch, duration_s, "
        "profile, device, country, supplemental, attributes, bookmark_s, file_order) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(v.source, v.title, v.show, v.season, v.episode, v.kind, v.local_date,
          v.start_utc.timestamp() if v.start_utc else None, v.duration_s, v.profile, v.device, v.country,
          v.supplemental, v.attributes, v.bookmark_s, v.order) for v in views])
    db.set_meta(conn, "netflix_source", fmt)
    db.set_meta(conn, "netflix_file", ", ".join(p.name for p in paths))
    db.set_meta(conn, "timezone", str(tz))
    conn.commit()
    return {"format": fmt, "file": ", ".join(p.name for p in paths), "files": len(paths), "rows": len(views),
            "duplicates": dropped, "supplemental": sum(1 for v in views if v.supplemental)}


def build(conn: sqlite3.Connection, tz: ZoneInfo, cfg_netflix: dict, session_gap_s: float = 1800) -> int:
    """Fill watches / items / creators from `views` (supplemental rows skipped)."""
    fallback = {"episode": cfg_netflix.get("fallback_episode_minutes", 42) * 60,
                "movie": cfg_netflix.get("fallback_movie_minutes", 110) * 60}
    rows = conn.execute("SELECT * FROM views WHERE supplemental IS NULL "
                        "ORDER BY local_date, COALESCE(start_epoch, 0), file_order").fetchall()
    has_times = any(r["start_epoch"] is not None for r in rows)
    db.init_db(conn)  # the shared tables (incl. catalog_episodes), whatever version the database was made with
    # TMDB data, if `enrich` has run (else everything falls back to estimates)
    conn.executescript(tmdb.SCHEMA)
    meta = {r["query"]: r for r in conn.execute("SELECT * FROM tmdb_titles WHERE media_type != 'none'")}
    resolved = {r["title"]: r for r in conn.execute("SELECT * FROM title_resolution")}
    parents = {r["show"]: (r["parent"], r["season"]) for r in conn.execute("SELECT * FROM show_parent")}

    find_episode = tmdb.episode_lookup(conn)

    def info(media: str, name: str | None):
        return meta.get(f"{media}|{tmdb.norm(name)}") if name else None

    watches, items, creators = [], {}, {}
    session, prev_end, prev_date = 0, None, None
    genres: dict[str, list[str]] = {}
    for r in rows:
        kind, show, episode = r["kind"], r["show"], r["episode"]
        if kind == "unknown":  # one-off with a colon: TMDB settled it, else it counts as a movie
            res = resolved.get(r["title"])
            kind, show, episode = (res["kind"], res["show"], res["episode"]) if res else ("movie", None, None)
        if kind != "episode":
            show = episode = None
        season = r["season"]
        if show in parents:  # "One Piece: East Blue" -> One Piece, season "East Blue"
            show, arc = parents[show]
            season = season or arc
        t = info("tv", show) if show else info("movie", r["title"])
        ep = find_episode(t["tmdb_id"], season, episode) if t and show else None
        runtime_min = (ep["runtime_min"] if ep and ep["runtime_min"] else None) or (t["runtime_min"] if t else None)
        runtime_s = runtime_min * 60 if runtime_min else None
        item_id = ("ep:" + slug(show, season, episode)) if show else ("mv:" + slug(r["title"]))
        creator_id = ("show:" + slug(show)) if show else None
        if r["start_epoch"] is not None:
            start = datetime.fromtimestamp(r["start_epoch"], timezone.utc)
            est, method = (r["duration_s"] or 0), "exact"
            if prev_end is None or r["start_epoch"] - prev_end > session_gap_s:
                session += 1
            prev_end = r["start_epoch"] + est
        else:
            # quick download: dates only. Keep the file's order within a day; one session per day.
            d = datetime.fromisoformat(r["local_date"])
            start = datetime.combine(d.date(), time(0), tz) + timedelta(seconds=r["file_order"])
            start = start.astimezone(timezone.utc)
            est, method = (runtime_s, "runtime") if runtime_s else (fallback[kind], "fallback")
            if r["local_date"] != prev_date:
                session += 1
            prev_date = r["local_date"]
        local = start.astimezone(tz)
        local_date = r["local_date"] if r["start_epoch"] is None else local.date().isoformat()
        watches.append(View(
            r["id"], kind, item_id, creator_id, start.timestamp(), local, est, method,
            duration_s=r["duration_s"], max_s=runtime_s or r["duration_s"] or None, session_id=session,
            local_date=local_date))
        if item_id not in items:
            items[item_id] = Item(
                item_id, "ok" if t else "unknown", episode if show else (t["name"] if t else r["title"]), creator_id,
                tmdb.img(ep["still_path"], "w300") if ep and ep["still_path"] else (tmdb.img(t["poster_path"], "w185") if t else None),
                tmdb.img((ep["still_path"] if ep else None) or t["backdrop_path"] or t["poster_path"], "w780") if t else None,
                runtime_s, t["first_air_date"] if t else None, None,
                "https://www.netflix.com/search?q=" + quote(show or r["title"]),
                json.dumps({"show": show, "season": season, "episode": episode, "kind": kind,
                            "netflix_title": r["title"], "year": t["year"] if t else None,
                            "overview": t["overview"] if t and not show else None,
                            "poster": tmdb.img(t["poster_path"], "w500") if t else None,
                            "tmdb_id": t["tmdb_id"] if t else None, "tmdb_type": "tv" if show else "movie",
                            "season_number": ep["season"] if ep else None, "episode_number": ep["number"] if ep else None,
                            "air_date": ep["air_date"] if ep else None}))
            if t:
                genres[item_id] = json.loads(t["genres"] or "[]")
        if creator_id and creator_id not in creators:
            creators[creator_id] = Creator(
                creator_id, "ok" if t else "unknown", t["name"] if t else show, None,
                tmdb.img(t["poster_path"], "w185") if t else None, None, t["episodes"] if t else None,
                t["country"] if t else None, t["first_air_date"] if t else None,
                "https://www.netflix.com/search?q=" + quote(show),
                json.dumps({"topics": json.loads(t["genres"] or "[]"), "seasons": t["seasons"], "year": t["year"],
                            "overview": t["overview"], "poster": tmdb.img(t["poster_path"], "w500"),
                            "backdrop": tmdb.img(t["backdrop_path"], "w1280"), "tmdb_id": t["tmdb_id"]})
                if t else None)

    conn.execute("PRAGMA foreign_keys=OFF")  # Netflix has no YouTube-style raw `entries` table
    store.write_views(conn, watches)
    store.write_items(conn, items.values())
    store.write_creators(conn, creators.values())
    store.write_genres(conn, genres)
    # every episode of each matched show, for show progress and the episode checklist
    conn.execute("DELETE FROM catalog_episodes")
    conn.execute("""INSERT OR REPLACE INTO catalog_episodes
        SELECT c.creator_id, e.season, e.number, e.name, e.runtime_min,
               CASE WHEN e.still_path IS NOT NULL THEN 'https://image.tmdb.org/t/p/w300' || e.still_path END, e.air_date
        FROM creators c JOIN tmdb_episodes e ON e.show_id = json_extract(c.extra, '$.tmdb_id')
        WHERE e.season > 0""")
    # what this data can show: real times of day only come with the full export
    db.set_meta(conn, "extra_capabilities", "time_of_day" if has_times else "estimated_time")
    finish_build(conn, analyze=False)  # small; ANALYZE would reorder tied rankings (#85)
    return len(watches)
