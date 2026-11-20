"""Load Netflix viewing history into data/netflix.db and build the generic tables from it."""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

from .. import db
from .parser import FULL, SIMPLE, find_files, parse_history, profiles_in

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
    """Replace the stored history with what's in `folder` (exports are complete snapshots).
    The full export wins over the quick download when both are present."""
    full, quick = find_files(folder)
    path = full or quick
    if path is None:
        raise FileNotFoundError(f"No NetflixViewingHistory.csv or ViewingActivity.csv in {folder}")
    text = path.read_text(encoding="utf-8-sig")
    if full and not profile:
        names = profiles_in(text)
        if len(names) > 1:
            raise ValueError("This export has several profiles: " + ", ".join(names)
                             + ". Pick yours with --profile or [netflix] profile in config.toml.")
    fmt, views = parse_history(text, tz, profile)
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
    db.set_meta(conn, "netflix_file", path.name)
    db.set_meta(conn, "timezone", str(tz))
    conn.commit()
    return {"format": fmt, "file": path.name, "rows": len(views),
            "supplemental": sum(1 for v in views if v.supplemental)}


def build(conn: sqlite3.Connection, tz: ZoneInfo, cfg_netflix: dict, session_gap_s: float = 1800) -> int:
    """Fill watches / items / creators from `views` (supplemental rows skipped)."""
    fallback = {"episode": cfg_netflix.get("fallback_episode_minutes", 42) * 60,
                "movie": cfg_netflix.get("fallback_movie_minutes", 110) * 60}
    rows = conn.execute("SELECT * FROM views WHERE supplemental IS NULL "
                        "ORDER BY COALESCE(start_epoch, 0), local_date, file_order").fetchall()
    has_times = any(r["start_epoch"] is not None for r in rows)

    watches, items, creators = [], {}, {}
    session, prev_end, prev_date = 0, None, None
    for r in rows:
        kind = "episode" if r["kind"] == "episode" else "movie"  # unknown counts as a movie until TMDB
        show = r["show"] if kind == "episode" else None
        item_id = ("ep:" + slug(show, r["season"], r["episode"])) if show else ("mv:" + slug(r["title"]))
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
            est, method = fallback[kind], "fallback"
            if r["local_date"] != prev_date:
                session += 1
            prev_date = r["local_date"]
        local = start.astimezone(tz)
        local_date = r["local_date"] if r["start_epoch"] is None else local.date().isoformat()
        watches.append((
            r["id"], kind, item_id, creator_id, start.timestamp(), local.isoformat(), local_date,
            int(local_date[:4]), local_date[:7], local.hour, local.hour * 60 + local.minute,
            datetime.fromisoformat(local_date).weekday(), r["duration_s"], est, r["duration_s"] or None,
            method, None, session, "long", None, 0, 0, 0, None, None))
        if item_id not in items:
            items[item_id] = (item_id, "unknown", r["episode"] if show else r["title"], creator_id, None, None,
                              None, None, None, "https://www.netflix.com/search?q=" + quote(show or r["title"]),
                              json.dumps({"show": show, "season": r["season"], "episode": r["episode"],
                                          "kind": kind, "netflix_title": r["title"]}))
        if creator_id and creator_id not in creators:
            creators[creator_id] = (creator_id, "unknown", show, None, None, None, None, None, None,
                                    "https://www.netflix.com/search?q=" + quote(show), None)

    conn.execute("PRAGMA foreign_keys=OFF")  # Netflix has no YouTube-style raw `entries` table
    cols = ("entry_id, kind, video_id, channel_id, start_epoch, local_iso, local_date, year, month, local_hour, "
            "local_minute, local_dow, duration_s, est_s, max_s, est_method, gap_next_s, session_id, bucket, "
            "short_basis, is_background, is_live, delayed_fix, category_id, published_epoch")
    conn.execute("DELETE FROM watches")
    conn.execute("DELETE FROM items")
    conn.execute("DELETE FROM creators")
    conn.executemany(f"INSERT INTO watches ({cols}) VALUES ({','.join('?' * 25)})", watches)
    conn.executemany("INSERT INTO items VALUES (?,?,?,?,?,?,?,?,?,?,?)", list(items.values()))
    conn.executemany("INSERT INTO creators VALUES (?,?,?,?,?,?,?,?,?,?,?)", list(creators.values()))
    # what this data can show: real times of day only come with the full export
    db.set_meta(conn, "extra_capabilities", "time_of_day" if has_times else "estimated_time")
    db.set_meta(conn, "built_at", datetime.now(timezone.utc).isoformat())
    conn.commit()
    return len(watches)
