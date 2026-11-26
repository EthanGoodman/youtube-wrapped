"""Load the Steam files that fetch/sync saved (data/steam/) into data/steam.db and build the shared tables.
The files and how hours are dated are the games family's (connectors/games.py); Steam adds where its art and store
pages live. Only what the stats use is stored: no friends, profile, or other account data."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo

from .. import games

# Steam moved its art from shared.cloudflare.steamstatic.com (now a redirect, which the image relay never follows)
ART = "https://shared.steamstatic.com/store_item_assets/steam/apps/{appid}/"


def _links(appid: str) -> tuple[str, str, str]:
    art = ART.format(appid=appid)
    return art + "library_600x900.jpg", art + "header.jpg", f"https://store.steampowered.com/app/{appid}/"


def ingest(conn: sqlite3.Connection, folder: Path) -> dict:
    return games.load(conn, folder, "Steam", "python backend/cli.py fetch --platform steam")


def build(conn: sqlite3.Connection, tz: ZoneInfo) -> int:
    return games.build(conn, tz, _links)
