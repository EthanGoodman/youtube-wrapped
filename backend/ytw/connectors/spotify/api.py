"""Album art and artist photos from Spotify's Web API, matched exactly by the track ids in the export.

Uses the client-credentials flow: an app-only token from the user's own Spotify developer app (Client ID + secret in
the OS keychain). It never signs in as the user and can't see their account.

New developer apps may only ask for one thing at a time (the 50-at-once endpoints answer 403) and get no genres, so:
  - one request per album (through one of its tracks: the album's art covers every track on it) and per artist;
  - most-played first, a few requests in parallel, every answer cached (sp_albums / sp_artists), so a quick pass
    over the top of the library gives the pages their pictures fast and a later pass fills in the rest.
Genres come from Last.fm instead (lastfm.py).
"""
from __future__ import annotations

import base64
import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from ... import net

API = "https://api.spotify.com/v1/"
TOKEN_URL = "https://accounts.spotify.com/api/token"
WORKERS = 4
MIN_GAP_S = 0.12            # at most ~8 requests a second in all (Spotify's limit is a rolling 30 s window)

SCHEMA = """
-- album_id is ours (album:<artist>|<album>); data NULL = Spotify didn't know the track we asked with
CREATE TABLE IF NOT EXISTS sp_albums (album_id TEXT PRIMARY KEY, track_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS sp_artists (artist_id TEXT PRIMARY KEY, data TEXT);    -- Spotify's artist id
"""

Fetcher = Callable[[str], dict]   # path -> JSON ({} when Spotify doesn't know it)


class SpotifyError(Exception):
    pass


def http_fetcher(client_id: str, client_secret: str) -> Fetcher:
    """GET <API><path> with an app token (fetched once, refreshed when it expires; safe across threads)."""
    state: dict[str, str] = {}
    lock = threading.Lock()
    net.client.rate_limit("api.spotify.com", MIN_GAP_S)

    def token(stale: str | None = None) -> str:
        with lock:
            if state.get("token") and state["token"] != stale:
                return state["token"]
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

    def fetch(path: str) -> dict:
        tok = token()
        for attempt in (1, 2):
            try:
                r = net.request("GET", API + path, headers={"Authorization": f"Bearer {tok}"}, timeout=20, retries=6)
            except net.NetError as e:
                raise SpotifyError(str(e)) from None
            if r.status == 401 and attempt == 1:   # tokens last an hour: get a new one once
                tok = token(stale=tok)
                continue
            if r.status in (400, 404):
                return {}
            if r.status == 403:
                raise SpotifyError("Spotify refused the request (HTTP 403): check the app in the Spotify developer dashboard")
            if r.status == 429:
                raise SpotifyError("Spotify is rate-limiting; what was found is saved, run it again later for the rest")
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
    """Only what the stats show: the album's name, art and release date, and the track's artists."""
    al = t.get("album") or {}
    return {"album": {"id": al.get("id"), "name": al.get("name"), "released": al.get("release_date"),
                      "small": _best(al.get("images"), 300), "large": _best(al.get("images"), 640)},
            "artists": [{"id": a.get("id"), "name": a.get("name")} for a in t.get("artists") or [] if a.get("id")]}


def _slim_artist(a: dict) -> dict:
    return {"name": a.get("name"), "small": _best(a.get("images"), 300), "large": _best(a.get("images"), 640)}


def _album_todo(conn: sqlite3.Connection) -> list[tuple[str, str]]:
    """(album_id, track id to ask with) for every album not looked up yet, most-listened album first."""
    from .ingest import album_key  # the same ids build() gives albums
    done = {r[0] for r in conn.execute("SELECT album_id FROM sp_albums")}
    best: dict[str, tuple[int, int, str]] = {}   # album -> (album ms, best track ms, track id)
    for artist, album, uri, ms in conn.execute(
            "SELECT artist, album, track_uri, SUM(ms_played) FROM plays WHERE track_uri IS NOT NULL AND album IS NOT NULL "
            "GROUP BY artist, album, track_uri"):
        aid = album_key(artist, album)
        if aid in done:
            continue
        tot, top, tid = best.get(aid, (0, -1, ""))
        tid_new = uri.rsplit(":", 1)[-1]
        best[aid] = (tot + ms, ms, tid_new) if ms > top or (ms == top and tid_new < tid) else (tot + ms, top, tid)
    return [(aid, v[2]) for aid, v in sorted(best.items(), key=lambda kv: (-kv[1][0], kv[0]))]


def _artist_todo(conn: sqlite3.Connection) -> list[str]:
    """Spotify ids of the albums' main artists not looked up yet, most-listened first."""
    from .ingest import album_key
    plays = {album_key(a, al): ms for a, al, ms in conn.execute(
        "SELECT artist, album, SUM(ms_played) FROM plays WHERE album IS NOT NULL GROUP BY artist, album")}
    done = {r[0] for r in conn.execute("SELECT artist_id FROM sp_artists")}
    weight: dict[str, int] = {}
    for aid, data in conn.execute("SELECT album_id, data FROM sp_albums WHERE data IS NOT NULL"):
        main = (json.loads(data).get("artists") or [None])[0]
        if main and main["id"] not in done:
            weight[main["id"]] = weight.get(main["id"], 0) + plays.get(aid, 0)
    return sorted(weight, key=lambda k: (-weight[k], k))


def _run(conn: sqlite3.Connection, items: list, ask: Callable, save: Callable, progress: Callable[[str], None], label: str) -> int:
    """Ask for each item with a few workers; save answers on this thread (SQLite stays single-threaded)."""
    with ThreadPoolExecutor(WORKERS) as pool:
        for n, (item, answer) in enumerate(zip(items, pool.map(ask, items)), 1):
            save(item, answer)
            if n % 25 == 0 or n == len(items):
                conn.commit()                  # an error later (rate limit, network) keeps everything saved so far
                progress(f"{label} {n:,}/{len(items):,}")
    return len(items)


def enrich(conn: sqlite3.Connection, fetch: Fetcher, limit: int | None = None,
           progress: Callable[[str], None] = lambda s: None) -> dict:
    """Look up albums (art) then their artists (photos), most-listened first; at most `limit` of each this call
    (None = all). Answers are committed as they come, so stopping halfway loses nothing."""
    conn.executescript(SCHEMA)
    albums = _album_todo(conn)[:limit]

    def save_album(item, t):
        conn.execute("INSERT OR REPLACE INTO sp_albums VALUES (?, ?, ?)",
                     (item[0], item[1], json.dumps(_slim_track(t)) if t.get("album") else None))
    asked = _run(conn, albums, lambda it: fetch(f"tracks/{it[1]}"), save_album, progress, "albums")
    conn.commit()
    artists = _artist_todo(conn)[:limit]

    def save_artist(aid, a):
        conn.execute("INSERT OR REPLACE INTO sp_artists VALUES (?, ?)", (aid, json.dumps(_slim_artist(a)) if a.get("name") else None))
    asked += _run(conn, artists, lambda aid: fetch(f"artists/{aid}"), save_artist, progress, "artists")
    conn.commit()
    left = len(_album_todo(conn)) + len(_artist_todo(conn))
    found = conn.execute("SELECT COUNT(*), COUNT(data) FROM sp_albums").fetchone()
    found_a = conn.execute("SELECT COUNT(*), COUNT(data) FROM sp_artists").fetchone()
    return {"albums": found[0], "albums_found": found[1], "artists": found_a[0], "artists_found": found_a[1],
            "requests": asked, "left": left}
