"""Album art and artist photos, with no keys and no sign-in.

Album art: Spotify's public oEmbed endpoint (the one sites use to embed a song), asked about one track per album: the
    exact track id from the export, so the art is never a guess. (Spotify's developer API allows new apps only a few
    hundred lookups a day: it locked a test app for 24 hours after ~580, so it can't cover a real library.)
Artist photos: Deezer's public search, by artist name; only an exact name match counts, so an artist Deezer doesn't
    have keeps its initial rather than someone else's face.

Most-listened first, a few requests in parallel, every answer cached (sp_albums / dz_artists): a quick pass over the
top of the library gives the pages their pictures within minutes, a later pass fills in the rest, and a stopped or
rate-limited run loses nothing.
"""
from __future__ import annotations

import json
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from ... import net

OEMBED = "https://open.spotify.com/oembed"
DEEZER = "https://api.deezer.com/search/artist"
WORKERS = 4

SCHEMA = """
-- album_id is ours (album:<artist>|<album>); data NULL = not found
CREATE TABLE IF NOT EXISTS sp_albums (album_id TEXT PRIMARY KEY, track_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS dz_artists (name TEXT PRIMARY KEY, data TEXT);
"""

Fetcher = Callable[[str], dict]

_SP_IMAGE = re.compile(r"^https://[a-z0-9.-]+\.(?:spotifycdn\.com|scdn\.co)/image/([0-9a-f]{20,64})$")
# Spotify image ids start with a size code: ...1e02 = 300 px album art, ...b273 = 640 px
_SMALL, _LARGE = "ab67616d00001e02", "ab67616d0000b273"


class ArtError(Exception):
    pass


def oembed_fetcher() -> Fetcher:
    net.client.rate_limit("open.spotify.com", 0.08)

    def fetch(track_id: str) -> dict:
        try:
            r = net.request("GET", OEMBED, params={"url": f"https://open.spotify.com/track/{track_id}"}, timeout=20, retries=4)
        except net.NetError as e:
            raise ArtError(str(e)) from None
        if r.status == 429:
            raise ArtError("Spotify is rate-limiting album art; what was found is saved, run it again later for the rest")
        return (r.json({}) or {}) if r.ok else {}
    return fetch


def deezer_fetcher() -> Fetcher:
    net.client.rate_limit("api.deezer.com", 0.11)   # Deezer allows 50 requests per 5 seconds

    def fetch(name: str) -> dict:
        try:
            r = net.request("GET", DEEZER, params={"q": name, "limit": 5}, timeout=20, retries=4)
        except net.NetError as e:
            raise ArtError(str(e)) from None
        data = r.json({}) or {}
        if r.status == 429 or (data.get("error") or {}).get("code") == 4:
            raise ArtError("Deezer is rate-limiting artist photos; what was found is saved, run it again later for the rest")
        return data if r.ok else {}
    return fetch


def album_art(answer: dict) -> dict | None:
    """oEmbed answer -> {small, large} album art on i.scdn.co (the image ids work on Spotify's main image host)."""
    m = _SP_IMAGE.match(str(answer.get("thumbnail_url") or ""))
    if not m:
        return None
    small = f"https://i.scdn.co/image/{m.group(1)}"
    return {"small": small, "large": small.replace(_SMALL, _LARGE) if _SMALL in small else small}


def artist_photo(answer: dict, name: str) -> dict | None:
    """Deezer search answer -> {small, large} for the artist with exactly this name (any case), skipping placeholders."""
    for a in answer.get("data") or []:
        if not isinstance(a, dict) or str(a.get("name") or "").casefold() != name.casefold():
            continue
        small, large = a.get("picture_medium"), a.get("picture_big")
        if small and "/images/artist//" not in small:   # Deezer's blank silhouette has no image hash
            return {"small": small, "large": large or small}
        return None
    return None


def _album_todo(conn: sqlite3.Connection) -> list[tuple[str, str]]:
    """(album_id, track id to ask with) for every album not looked up yet, most-listened album first."""
    from .ingest import album_key
    done = {r[0] for r in conn.execute("SELECT album_id FROM sp_albums")}
    best: dict[str, list] = {}   # album -> [album ms, best track ms, track id]
    for artist, album, uri, ms in conn.execute(
            "SELECT artist, album, track_uri, SUM(ms_played) FROM plays WHERE track_uri IS NOT NULL AND album IS NOT NULL "
            "GROUP BY artist, album, track_uri ORDER BY artist, album, track_uri"):
        aid = album_key(artist, album)
        if aid in done:
            continue
        b = best.setdefault(aid, [0, -1, ""])
        b[0] += ms
        if ms > b[1]:
            b[1], b[2] = ms, uri.rsplit(":", 1)[-1]
    return [(aid, v[2]) for aid, v in sorted(best.items(), key=lambda kv: (-kv[1][0], kv[0]))]


def _artist_todo(conn: sqlite3.Connection) -> list[str]:
    done = {r[0] for r in conn.execute("SELECT name FROM dz_artists")}
    return [a for (a,) in conn.execute("SELECT artist FROM plays GROUP BY artist ORDER BY SUM(ms_played) DESC, artist")
            if a not in done]


def _run(conn: sqlite3.Connection, items: list, ask: Callable, save: Callable, progress: Callable[[str], None], label: str) -> None:
    """Ask for each item with a few workers; save answers on this thread (SQLite stays single-threaded)."""
    with ThreadPoolExecutor(WORKERS) as pool:
        for n, (item, answer) in enumerate(zip(items, pool.map(ask, items)), 1):
            save(item, answer)
            if n % 25 == 0 or n == len(items):
                conn.commit()                  # an error later (rate limit, network) keeps everything saved so far
                progress(f"{label} {n:,}/{len(items):,}")


def enrich(conn: sqlite3.Connection, albums_fetch: Fetcher, artists_fetch: Fetcher, limit: int | None = None,
           progress: Callable[[str], None] = lambda s: None) -> dict:
    """Album art then artist photos, most-listened first; at most `limit` of each this call (None = all)."""
    conn.executescript(SCHEMA)
    albums = _album_todo(conn)[:limit]
    _run(conn, albums, lambda it: albums_fetch(it[1]),
         lambda it, a: conn.execute("INSERT OR REPLACE INTO sp_albums VALUES (?, ?, ?)",
                                    (it[0], it[1], json.dumps(album_art(a)) if album_art(a) else None)), progress, "album art")
    artists = _artist_todo(conn)[:limit]
    _run(conn, artists, artists_fetch,
         lambda name, a: conn.execute("INSERT OR REPLACE INTO dz_artists VALUES (?, ?)",
                                      (name, json.dumps(artist_photo(a, name)) if artist_photo(a, name) else None)),
         progress, "artist photos")
    conn.commit()
    al = conn.execute("SELECT COUNT(data) FROM sp_albums").fetchone()[0]
    ar = conn.execute("SELECT COUNT(data) FROM dz_artists").fetchone()[0]
    return {"albums_found": al, "artists_found": ar, "requests": len(albums) + len(artists),
            "left": len(_album_todo(conn)) + len(_artist_todo(conn))}


def cached(conn: sqlite3.Connection) -> tuple[dict[str, dict], dict[str, dict]]:
    """({album_id: art}, {artist name: photo}) from the caches. Album rows saved by the earlier Web API lookup
    (whole track objects) are read too, so their pictures aren't fetched twice."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'sp_albums'").fetchone():
        return {}, {}
    art = {}
    for aid, data in conn.execute("SELECT album_id, data FROM sp_albums WHERE data IS NOT NULL"):
        d = json.loads(data)
        art[aid] = d.get("album") if "album" in d else d
    photos = {}
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'dz_artists'").fetchone():
        photos = {n: json.loads(d) for n, d in conn.execute("SELECT name, data FROM dz_artists WHERE data IS NOT NULL")}
    return art, photos
