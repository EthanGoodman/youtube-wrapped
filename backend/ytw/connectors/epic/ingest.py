"""Load the Epic files that fetch/sync saved (data/epic/) into data/epic.db and build the shared tables.
The files and how hours are dated are the games family's (connectors/games.py). Epic's art and store links vary per
game, so fetch saves them in each game's file; a game without them shows its initial."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo

from .. import games


def _links(_app: str) -> tuple[None, None, None]:
    return None, None, None


def ingest(conn: sqlite3.Connection, folder: Path) -> dict:
    return games.load(conn, folder, "Epic", "python backend/cli.py fetch --platform epic")


def build(conn: sqlite3.Connection, tz: ZoneInfo) -> int:
    return games.build(conn, tz, _links)
