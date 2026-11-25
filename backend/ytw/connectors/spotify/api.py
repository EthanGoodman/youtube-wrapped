"""Album art, artist photos and genres from Spotify's Web API, matched exactly by the track ids in the export.

Uses the client-credentials flow: an app-only token from the user's own Spotify developer app (Client ID + secret
in the OS keychain). It never signs in as the user and can't see their account. Answers are cached in the
database (sp_tracks / sp_artists), so a second run only asks for what's new.
"""
from __future__ import annotations

import base64
import json
import sqlite3
from typing import Callable

from ... import net

API = "https://api.spotify.com/v1/"
TOKEN_URL = "https://accounts.spotify.com/api/token"
BATCH = 50  # Spotify's limit for /tracks?ids= and /artists?ids=

SCHEMA = """
CREATE TABLE IF NOT EXISTS sp_tracks (track_id TEXT PRIMARY KEY, data TEXT);   -- data NULL = Spotify doesn't know it
CREATE TABLE IF NOT EXISTS sp_artists (artist_id TEXT PRIMARY KEY, data TEXT);
"""

Fetcher = Callable[[str, dict], dict]


class SpotifyError(Exception):
    pass


def http_fetcher(client_id: str, client_secret: str) -> Fetcher:
    """GET <API><path> with an app token (fetched once, refreshed when it expires)."""
    state: dict[str, str] = {}

    def token() -> str:
        auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        try:
            r = net.request("POST", TOKEN_URL, form={"grant_type": "client_credentials"},
                            headers={"Authorization": f"Basic {auth}"}, timeout=20, retries=2)
        except net.NetError as e:
            raise SpotifyError(str(e)) from None
        if r.status in (400, 401):
            raise SpotifyError("Spotify rejected the Client ID / secret - save them again with "
                               "python backend/cli.py secrets set SPOTIFY_CLIENT_ID (and SPOTIFY_CLIENT_SECRET)")
        if not r.ok:
            raise SpotifyError(f"Spotify token request failed (HTTP {r.status})")
        state["token"] = r.json({}).get("access_token", "")
        return state["token"]

    def fetch(path: str, params: dict) -> dict:
        for attempt in (1, 2):
            tok = state.get("token") or token()
            try:
                r = net.request("GET", API + path, params=params, headers={"Authorization": f"Bearer {tok}"},
                                timeout=20, retries=4)
            except net.NetError as e:
                raise SpotifyError(str(e)) from None
            if r.status == 401 and attempt == 1:   # token expired (they last an hour): get a new one once
                state.pop("token", None)
                continue
            if r.status == 403:
                raise SpotifyError("Spotify refused the request (HTTP 403): check the app in the Spotify developer dashboard")
            if r.status == 429:
                raise SpotifyError("Spotify kept rate-limiting; try again in a few minutes")
            if not r.ok:
                raise SpotifyError(f"Spotify HTTP {r.status}")
            return r.json({})
        raise SpotifyError("Spotify keeps rejecting the app token")
    return fetch


def _best(images: list | None, want: int) -> str | None:
    """The smallest image at least `want` px wide (Spotify lists them largest first)."""
    imgs = [i for i in (images or []) if isinstance(i, dict) and i.get("url")]
    fit = [i for i in imgs if (i.get("width") or 0) >= want]
    pick = min(fit, key=lambda i: i.get("width") or 0) if fit else (imgs[0] if imgs else None)
    return pick["url"] if pick else None


def _slim_track(t: dict) -> dict:
    """Only what the stats show: album (name, art, release date) and the artists' ids and names."""
    al = t.get("album") or {}
    return {"duration_ms": t.get("duration_ms"),
            "album": {"id": al.get("id"), "name": al.get("name"), "released": al.get("release_date"),
                      "small": _best(al.get("images"), 300), "large": _best(al.get("images"), 640)},
            "artists": [{"id": a.get("id"), "name": a.get("name")} for a in t.get("artists") or [] if a.get("id")]}


def _slim_artist(a: dict) -> dict:
    return {"name": a.get("name"), "genres": [g for g in a.get("genres") or [] if isinstance(g, str)][:8],
            "small": _best(a.get("images"), 300), "large": _best(a.get("images"), 640)}


def enrich(conn: sqlite3.Connection, fetch: Fetcher, progress: Callable[[str], None] = lambda s: None) -> dict:
    """Look up every track id in the plays that isn't cached yet, then every artist those tracks name."""
    conn.executescript(SCHEMA)
    have = {r[0] for r in conn.execute("SELECT track_id FROM sp_tracks")}
    ids = sorted({u.rsplit(":", 1)[-1] for (u,) in conn.execute("SELECT DISTINCT track_uri FROM plays WHERE track_uri IS NOT NULL")} - have)
    requests = 0
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i + BATCH]
        got = fetch("tracks", {"ids": ",".join(chunk)}).get("tracks") or []
        requests += 1
        by_id = {t["id"]: t for t in got if isinstance(t, dict) and t.get("id")}
        conn.executemany("INSERT OR REPLACE INTO sp_tracks VALUES (?, ?)",
                         [(tid, json.dumps(_slim_track(by_id[tid])) if tid in by_id else None) for tid in chunk])
        conn.commit()
        progress(f"tracks {min(i + BATCH, len(ids)):,}/{len(ids):,}")
    artist_ids = set()
    for (data,) in conn.execute("SELECT data FROM sp_tracks WHERE data IS NOT NULL"):
        artist_ids.update(a["id"] for a in json.loads(data)["artists"][:1])  # the main artist is the one we rank
    have_a = {r[0] for r in conn.execute("SELECT artist_id FROM sp_artists")}
    todo = sorted(artist_ids - have_a)
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        got = fetch("artists", {"ids": ",".join(chunk)}).get("artists") or []
        requests += 1
        by_id = {a["id"]: a for a in got if isinstance(a, dict) and a.get("id")}
        conn.executemany("INSERT OR REPLACE INTO sp_artists VALUES (?, ?)",
                         [(aid, json.dumps(_slim_artist(by_id[aid])) if aid in by_id else None) for aid in chunk])
        conn.commit()
        progress(f"artists {min(i + BATCH, len(todo)):,}/{len(todo):,}")
    found = conn.execute("SELECT COUNT(*), COUNT(data) FROM sp_tracks").fetchone()
    artists = conn.execute("SELECT COUNT(*), COUNT(data) FROM sp_artists").fetchone()
    return {"tracks": found[0], "tracks_found": found[1], "artists": artists[0], "artists_found": artists[1],
            "requests": requests}
