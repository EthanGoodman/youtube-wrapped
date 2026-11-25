"""Genres from Last.fm: each artist's top tags (what listeners call them), matched by artist name.

Spotify no longer gives genres to new developer apps, and Last.fm's tags are the richer source anyway. Needs a free
Last.fm API key (LASTFM_API_KEY in the OS keychain); read-only calls, no Last.fm account access. Most-listened
artists first, a few requests in parallel, every answer cached in lf_artists so a run can stop and resume.
"""
from __future__ import annotations

import json
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from ... import net

API = "https://ws.audioscrobbler.com/2.0/"
WORKERS = 4
MIN_GAP_S = 0.22            # Last.fm asks for at most ~5 requests a second
MIN_COUNT = 25              # a tag's weight (0-100, relative to the artist's top tag) to count as a genre
MAX_GENRES = 3

SCHEMA = "CREATE TABLE IF NOT EXISTS lf_artists (name TEXT PRIMARY KEY, tags TEXT);  -- tags NULL = not found"

# tags that aren't genres
_NOT_GENRES = {"seen live", "favorites", "favourite", "favorite", "favourites", "love", "awesome", "beautiful", "cool",
               "best", "good", "amazing", "under 2000 listeners", "spotify", "all", "male vocalists", "female vocalists",
               "female vocalist", "male vocalist", "singer-songwriter", "american", "british", "english", "uk", "usa",
               "canadian", "australian", "swedish", "german", "french", "korean", "japanese", "united states",
               "united kingdom", "canada", "australia", "sweden", "germany", "france", "japan", "korea", "irish",
               "scottish", "dutch", "norwegian", "finnish", "italian", "spanish", "brazilian", "mexican"}
# how some tags should read once Title-Cased
DISPLAY = {"rnb": "R&B", "r&b": "R&B", "hip-hop": "Hip-Hop", "hip hop": "Hip-Hop", "edm": "EDM", "idm": "IDM", "lo-fi": "Lo-Fi",
           "uk garage": "UK Garage", "k-pop": "K-Pop", "j-pop": "J-Pop", "dnb": "Drum and Bass", "drum n bass": "Drum and Bass"}
_JUNK = re.compile(r"^\d{2,4}s?$|^my |favou?rite")

Fetcher = Callable[[str], dict]   # artist name -> Last.fm JSON


class LastfmError(Exception):
    pass


def http_fetcher(api_key: str) -> Fetcher:
    net.client.rate_limit("ws.audioscrobbler.com", MIN_GAP_S)

    def fetch(artist: str) -> dict:
        try:
            r = net.request("GET", API, params={"method": "artist.gettoptags", "artist": artist, "autocorrect": 1,
                                                "api_key": api_key, "format": "json"}, timeout=20, retries=5)
        except net.NetError as e:
            raise LastfmError(str(e)) from None
        data = r.json({}) or {}
        if data.get("error") in (10, 26):     # invalid / suspended key
            raise LastfmError("Last.fm rejected the API key - save it again with python backend/cli.py secrets set LASTFM_API_KEY")
        if data.get("error") == 29 or r.status == 429:
            raise LastfmError("Last.fm is rate-limiting; what was found is saved, run it again later for the rest")
        return data if r.ok else {}
    return fetch


def genres_from(data: dict, artist: str) -> list[str]:
    """Top tags that read as genres: weighty enough, not opinions, places or the artist's own name."""
    tags = (data.get("toptags") or {}).get("tag") or []
    out: list[str] = []
    for t in tags if isinstance(tags, list) else [tags]:
        name = str(t.get("name") or "").strip().lower() if isinstance(t, dict) else ""
        try:
            count = int(t.get("count") or 0)
        except (TypeError, ValueError):
            count = 0
        if (count < MIN_COUNT or not name or name in _NOT_GENRES or _JUNK.search(name)
                or name == artist.lower() or len(name) > 30 or name in out):
            continue
        out.append(name)
        if len(out) == MAX_GENRES:
            break
    return out


def enrich(conn: sqlite3.Connection, fetch: Fetcher, limit: int | None = None,
           progress: Callable[[str], None] = lambda s: None) -> dict:
    """Look up artists not cached yet, most-listened first; at most `limit` this call (None = all)."""
    conn.executescript(SCHEMA)
    done = {r[0] for r in conn.execute("SELECT name FROM lf_artists")}
    todo = [a for (a,) in conn.execute("SELECT artist FROM plays GROUP BY artist ORDER BY SUM(ms_played) DESC, artist")
            if a not in done]
    batch = todo[:limit]
    with ThreadPoolExecutor(WORKERS) as pool:
        for n, (artist, data) in enumerate(zip(batch, pool.map(fetch, batch)), 1):
            g = genres_from(data, artist) if data.get("toptags") else None
            conn.execute("INSERT OR REPLACE INTO lf_artists VALUES (?, ?)", (artist, json.dumps(g) if g is not None else None))
            if n % 25 == 0 or n == len(batch):
                conn.commit()
                progress(f"genres {n:,}/{len(batch):,}")
    conn.commit()
    found = conn.execute("SELECT COUNT(*), COUNT(tags) FROM lf_artists WHERE tags IS NOT NULL AND tags != '[]'").fetchone()
    return {"artists_with_genres": found[1], "requests": len(batch), "left": len(todo) - len(batch)}


def artist_genres(conn: sqlite3.Connection) -> dict[str, list[str]]:
    """Artist name -> genres (Title Case), from the cache."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'lf_artists'").fetchone():
        return {}
    return {name: [DISPLAY.get(g, g.title()) for g in json.loads(tags) if g not in _NOT_GENRES] for name, tags in
            conn.execute("SELECT name, tags FROM lf_artists WHERE tags IS NOT NULL")}
