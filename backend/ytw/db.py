"""SQLite schema and connection helpers."""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_VERSION = 1

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


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    set_meta(conn, "schema_version", str(SCHEMA_VERSION))
    conn.commit()


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT INTO meta(key, value) VALUES(?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else None
