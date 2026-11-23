"""Load parsed Takeout data into SQLite. Safe to rerun: rows are deduplicated."""
from __future__ import annotations

import sqlite3
from dataclasses import fields
from operator import attrgetter
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from ... import db
from ...imports import Source
from .parser import Entry, Search, parse_search_history, parse_watch_history

_ENTRY_COLS = [f.name for f in fields(Entry)]
_entry_row = attrgetter(*_ENTRY_COLS)
_SEARCH_COLS = [f.name for f in fields(Search)]
_search_row = attrgetter(*_SEARCH_COLS)


def insert_entries(conn: sqlite3.Connection, entries: list[Entry]) -> int:
    """Insert entries, skipping ones already present. Returns number of new rows."""
    before = conn.total_changes
    conn.executemany(
        f"INSERT OR IGNORE INTO entries ({', '.join(_ENTRY_COLS)}) "
        f"VALUES ({', '.join('?' * len(_ENTRY_COLS))})",
        map(_entry_row, entries),
    )
    return conn.total_changes - before


def _load(source):
    """A path to a JSON export (read with the import limits) or already-parsed data."""
    if isinstance(source, (str, Path)):
        with Source(Path(source)) as src:
            return src.read_json(src.names()[0])
    return source


def ingest_watch_history(conn: sqlite3.Connection, source, tz: ZoneInfo) -> dict:
    entries = parse_watch_history(_load(source), tz)
    added = insert_entries(conn, entries)
    db.set_meta(conn, "watch_history_ingested_at", datetime.now(timezone.utc).isoformat())
    db.set_meta(conn, "timezone", str(tz))
    conn.commit()
    return {"parsed": len(entries), "added": added}


def ingest_search_history(conn: sqlite3.Connection, source, tz: ZoneInfo) -> dict:
    searches = parse_search_history(_load(source), tz)
    before = conn.total_changes
    conn.executemany(
        f"INSERT OR IGNORE INTO searches ({', '.join(_SEARCH_COLS)}) "
        f"VALUES ({', '.join('?' * len(_SEARCH_COLS))})",
        map(_search_row, searches),
    )
    added = conn.total_changes - before
    conn.commit()
    return {"parsed": len(searches), "added": added,
            "searches": sum(1 for s in searches if s.kind == "search")}


def kind_counts(conn: sqlite3.Connection) -> dict[str, int]:
    return dict(conn.execute("SELECT kind, COUNT(*) FROM entries GROUP BY kind ORDER BY 2 DESC").fetchall())
