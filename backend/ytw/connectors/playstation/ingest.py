"""Load the PlayStation files that fetch/sync saved (data/playstation/) into data/playstation.db and build the shared
tables. The files and how hours are dated are the games family's (connectors/games.py); trophies are its
achievements. PlayStation's pictures vary per game, so fetch saves them in each game's file."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo

from .. import games


def _links(_gid: str) -> tuple[None, None, None]:
    return None, None, None


def ingest(conn: sqlite3.Connection, folder: Path) -> dict:
    return games.load(conn, folder, "PlayStation", "python backend/cli.py fetch --platform playstation")


def build(conn: sqlite3.Connection, tz: ZoneInfo) -> int:
    return games.build(conn, tz, _links)
