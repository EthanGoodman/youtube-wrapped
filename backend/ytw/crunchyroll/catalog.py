"""Crunchyroll's own catalog for the series you watched: posters and banners, and every season's full
episode list (so show progress, binges and the episode checklist know what's out).

Uses the same signed-in session as the history fetch. Everything is cached in the database: a series
is only fetched again with `refresh`. Requests are paced like the history fetch.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Callable

from .fetch import API, Client

SCHEMA = """
CREATE TABLE IF NOT EXISTS cr_series (
    series_id    TEXT PRIMARY KEY,
    title        TEXT,
    description  TEXT,
    poster       TEXT,      -- tall 2:3
    banner       TEXT,      -- wide 16:9
    episode_count INTEGER,
    season_count INTEGER,
    launch_year  INTEGER,
    is_simulcast INTEGER,
    keywords     TEXT,      -- JSON list
    fetched_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cr_seasons (
    season_id    TEXT PRIMARY KEY,
    series_id    TEXT NOT NULL,
    seq          INTEGER,   -- season_sequence_number: what history entries use too
    title        TEXT,
    episodes     INTEGER
);
CREATE TABLE IF NOT EXISTS cr_episodes (
    episode_id   TEXT PRIMARY KEY,
    series_id    TEXT NOT NULL,
    season_id    TEXT NOT NULL,
    season_seq   INTEGER,
    number       INTEGER,   -- episode_number (NULL for specials and recaps)
    title        TEXT,
    duration_ms  INTEGER,
    air_date     TEXT,
    still        TEXT
);
CREATE INDEX IF NOT EXISTS ix_cr_episodes_series ON cr_episodes(series_id, season_seq, number);
"""


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def _image(images: dict, kind: str, width: int) -> str | None:
    """The smallest image of that kind at least `width` wide (or the largest there is)."""
    sets = (images or {}).get(kind) or []
    sizes = sorted((s for group in sets for s in group if s.get("source")), key=lambda s: s.get("width") or 0)
    pick = next((s for s in sizes if (s.get("width") or 0) >= width), sizes[-1] if sizes else None)
    return pick["source"] if pick else None


def pick_seasons(seasons: list[dict]) -> list[dict]:
    """One season per season number. Some series list each dub as its own season ("… (English Dub)");
    keep the original-language one so dubs don't count their episodes twice."""
    def score(z: dict) -> tuple:
        title = (z.get("title") or "").lower()
        return (z.get("audio_locale") == "ja-JP", "dub)" not in title and "dub " not in title,
                len(z.get("versions") or []), z.get("number_of_episodes") or 0)
    best: dict[int, dict] = {}
    for z in seasons:
        seq = z.get("season_sequence_number") or z.get("season_number")
        if seq is None:
            continue
        if seq not in best or score(z) > score(best[seq]):
            best[seq] = z
    return [best[k] for k in sorted(best)]


def fetch_series(conn: sqlite3.Connection, client: Client, series_id: str, locale: str = "en-US") -> int:
    """Fetch one series (details, seasons, episodes) into the cache. Returns episodes stored."""
    data = client.get(f"{API}/content/v2/cms/series/{series_id}?locale={locale}").get("data") or []
    if not data:
        return 0
    s = data[0]
    seasons = pick_seasons(client.get(f"{API}/content/v2/cms/series/{series_id}/seasons?locale={locale}").get("data") or [])
    episodes = []
    for z in seasons:
        client.sleep(client.pause_s)
        seq = z.get("season_sequence_number") or z.get("season_number")
        for e in client.get(f"{API}/content/v2/cms/seasons/{z['id']}/episodes?locale={locale}").get("data") or []:
            num = e.get("episode_number")
            episodes.append((e["id"], series_id, z["id"], seq, int(num) if isinstance(num, (int, float)) and float(num).is_integer() else None,
                             e.get("title"), e.get("duration_ms"), e.get("episode_air_date") or e.get("premium_available_date"),
                             _image(e.get("images"), "thumbnail", 600)))
    conn.execute("DELETE FROM cr_episodes WHERE series_id = ?", (series_id,))
    conn.execute("DELETE FROM cr_seasons WHERE series_id = ?", (series_id,))
    conn.executemany("INSERT OR REPLACE INTO cr_seasons VALUES (?,?,?,?,?)",
                     [(z["id"], series_id, z.get("season_sequence_number") or z.get("season_number"), z.get("title"),
                       z.get("number_of_episodes")) for z in seasons])
    conn.executemany("INSERT OR REPLACE INTO cr_episodes VALUES (?,?,?,?,?,?,?,?,?)", episodes)
    conn.execute("INSERT OR REPLACE INTO cr_series VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
        series_id, s.get("title"), s.get("description"), _image(s.get("images"), "poster_tall", 480),
        _image(s.get("images"), "poster_wide", 1200), s.get("episode_count"), s.get("season_count"),
        s.get("series_launch_year"), int(bool(s.get("is_simulcast"))), json.dumps(s.get("keywords") or []),
        datetime.now(timezone.utc).isoformat()))
    conn.commit()
    return len(episodes)


def fetch_catalog(conn: sqlite3.Connection, client: Client, series_ids: list[str], refresh: bool = False,
                  locale: str = "en-US", progress: Callable[[str], None] = lambda s: None) -> dict:
    init(conn)
    have = {r[0] for r in conn.execute("SELECT series_id FROM cr_series")}
    todo = [s for s in series_ids if refresh or s not in have]
    episodes = 0
    for i, sid in enumerate(todo, 1):
        progress(f"series {i}/{len(todo)}")
        episodes += fetch_series(conn, client, sid, locale)
        client.sleep(client.pause_s)
    return {"series": len(series_ids), "fetched": len(todo), "episodes": episodes, "requests": client.requests}
