"""SQLite schema and connection helpers."""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_VERSION = 3

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id            INTEGER PRIMARY KEY,
    dedupe_key    TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL,
    time_utc      TEXT NOT NULL,
    epoch         REAL NOT NULL,
    local_iso     TEXT NOT NULL,
    local_date    TEXT NOT NULL,
    local_hour    INTEGER NOT NULL,
    local_minute  INTEGER NOT NULL,
    local_dow     INTEGER NOT NULL,
    header        TEXT,
    title         TEXT,
    url           TEXT,
    video_id      TEXT,
    channel_id    TEXT,
    channel_name  TEXT,
    brand_hint    TEXT,
    preroll_for   INTEGER REFERENCES entries(id)  -- ads: the video entry this ad played before
);
CREATE INDEX IF NOT EXISTS ix_entries_epoch   ON entries(epoch);
CREATE INDEX IF NOT EXISTS ix_entries_kind    ON entries(kind, epoch);
CREATE INDEX IF NOT EXISTS ix_entries_video   ON entries(video_id);
CREATE INDEX IF NOT EXISTS ix_entries_channel ON entries(channel_id);
CREATE INDEX IF NOT EXISTS ix_entries_date    ON entries(local_date);

CREATE TABLE IF NOT EXISTS searches (
    id            INTEGER PRIMARY KEY,
    dedupe_key    TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL,          -- search | ad | other
    time_utc      TEXT NOT NULL,
    epoch         REAL NOT NULL,
    local_iso     TEXT NOT NULL,
    local_date    TEXT NOT NULL,
    local_hour    INTEGER NOT NULL,
    local_dow     INTEGER NOT NULL,
    query         TEXT,
    url           TEXT
);
CREATE INDEX IF NOT EXISTS ix_searches_epoch ON searches(epoch);

-- YouTube Data API cache. status: 'ok' or 'missing' (API returned nothing: deleted/private)
CREATE TABLE IF NOT EXISTS videos (
    video_id       TEXT PRIMARY KEY,
    status         TEXT NOT NULL,
    fetched_at     TEXT NOT NULL,
    title          TEXT,
    channel_id     TEXT,
    channel_title  TEXT,
    published_at   TEXT,
    duration_raw   TEXT,             -- ISO 8601 as returned (P0D for ongoing live streams)
    duration_s     INTEGER,          -- NULL when unknown
    live           TEXT,             -- snippet.liveBroadcastContent: none | live | upcoming
    was_live       INTEGER,          -- 1 if it has liveStreamingDetails (a past or current stream)
    category_id    TEXT,
    tags           TEXT,             -- JSON list
    topics         TEXT,             -- JSON list of topic names (from topicDetails)
    thumb_small    TEXT,
    thumb_large    TEXT,
    view_count     INTEGER,
    like_count     INTEGER,
    embed_w        INTEGER,          -- player embed size: aspect ratio tells Shorts (vertical) apart.
    embed_h        INTEGER           -- NULL = not checked, -1 = API returned nothing
);
CREATE INDEX IF NOT EXISTS ix_videos_channel ON videos(channel_id);

CREATE TABLE IF NOT EXISTS channels (
    channel_id        TEXT PRIMARY KEY,
    status            TEXT NOT NULL,
    fetched_at        TEXT NOT NULL,
    title             TEXT,
    handle            TEXT,
    avatar_url        TEXT,
    subscriber_count  INTEGER,       -- NULL if hidden
    video_count       INTEGER,
    view_count        INTEGER,
    country           TEXT,
    created_at        TEXT,
    topics            TEXT           -- JSON list
);

CREATE TABLE IF NOT EXISTS categories (
    category_id  TEXT PRIMARY KEY,
    title        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_calls (
    id          INTEGER PRIMARY KEY,
    called_at   TEXT NOT NULL,       -- UTC ISO
    quota_day   TEXT NOT NULL,       -- Pacific date; Google resets quota at midnight PT
    endpoint    TEXT NOT NULL,
    units       INTEGER NOT NULL,
    n_ids       INTEGER,
    status      TEXT NOT NULL        -- ok | error:<reason>
);
CREATE INDEX IF NOT EXISTS ix_api_calls_day ON api_calls(quota_day);

-- Derived: one row per real watch (video / unavailable / music). Rebuilt by `build`.
CREATE TABLE IF NOT EXISTS watches (
    entry_id      INTEGER PRIMARY KEY REFERENCES entries(id),
    kind          TEXT NOT NULL,
    video_id      TEXT,
    channel_id    TEXT,
    start_epoch   REAL NOT NULL,     -- corrected start (see delayed_fix)
    local_iso     TEXT NOT NULL,
    local_date    TEXT NOT NULL,
    year          INTEGER NOT NULL,
    month         TEXT NOT NULL,     -- YYYY-MM
    local_hour    INTEGER NOT NULL,
    local_minute  INTEGER NOT NULL,
    local_dow     INTEGER NOT NULL,
    duration_s    INTEGER,           -- NULL when unknown (deleted, live, not enriched)
    est_s         INTEGER NOT NULL,  -- estimated seconds watched
    max_s         INTEGER,           -- "max possible": full duration, capped (archived 24/7 streams)
    est_method    TEXT NOT NULL,     -- gap | full | cap | fallback
    gap_next_s    REAL,
    session_id    INTEGER NOT NULL,
    bucket        TEXT NOT NULL,     -- long | short | music
    short_basis   TEXT,              -- shape | hint | duration (how a Short was detected)
    is_background INTEGER NOT NULL,
    is_live       INTEGER NOT NULL,
    delayed_fix   INTEGER NOT NULL,  -- 1 if start was moved back to its pre-roll ad
    category_id   TEXT
);
-- covering index: date-range stats read everything they need from it
CREATE INDEX IF NOT EXISTS ix_watches_date    ON watches(local_date, is_background, bucket, est_s, max_s,
                                                         channel_id, video_id, category_id);
CREATE INDEX IF NOT EXISTS ix_watches_epoch   ON watches(start_epoch);
CREATE INDEX IF NOT EXISTS ix_watches_channel ON watches(channel_id, local_date);
CREATE INDEX IF NOT EXISTS ix_watches_video   ON watches(video_id);
CREATE INDEX IF NOT EXISTS ix_watches_session ON watches(session_id);

-- Derived lookups (rebuilt by `build`)
CREATE TABLE IF NOT EXISTS video_topics (video_id TEXT NOT NULL, topic TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_video_topics ON video_topics(video_id, topic);
CREATE TABLE IF NOT EXISTS video_tags (video_id TEXT NOT NULL, tag TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_video_tags ON video_tags(video_id, tag);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# Columns added after a table was first created: (table, column, type)
_ADDED_COLUMNS = [("videos", "embed_w", "INTEGER"), ("videos", "embed_h", "INTEGER"),
                  ("watches", "max_s", "INTEGER")]


def _migrate(conn: sqlite3.Connection) -> None:
    for table, col, typ in _ADDED_COLUMNS:
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if cols and col not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    _migrate(conn)
    set_meta(conn, "schema_version", str(SCHEMA_VERSION))
    conn.commit()


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT INTO meta(key, value) VALUES(?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else None
