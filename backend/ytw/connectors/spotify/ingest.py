"""Load Spotify streaming history into data/spotify.db and build the generic tables from it.

Reads either export (or both, merged):
  extended   Streaming_History_Audio_*.json   (Account -> Privacy -> Extended streaming history; lifetime, per play)
  account    StreamingHistory_music_*.json    (the quicker "Account data" download; about the last year, no ids)
Files may sit in data/spotify/ as they are or inside the .zip Spotify sends. Only the fields the stats use are
kept: never the IP address, country, username or user agent. Podcasts, audiobooks and video plays are skipped.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from ... import db
from ...imports import ImportRejected, Source
from .. import store
from ..base import finish_build
from ..music import Album, dedupe_listens, is_stream, write_albums
from ..store import Creator, Item, View, slug
from . import lastfm

PLAYS_SCHEMA = """
CREATE TABLE IF NOT EXISTS plays (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL,     -- extended | account
    end_epoch   REAL NOT NULL,     -- Spotify stamps when the play ended
    ms_played   INTEGER NOT NULL,
    track       TEXT NOT NULL,
    artist      TEXT NOT NULL,
    album       TEXT,
    track_uri   TEXT,              -- spotify:track:<id> (extended only)
    reason_start TEXT,
    reason_end  TEXT,
    shuffle     INTEGER,
    skipped     INTEGER,
    offline     INTEGER,
    device      TEXT               -- phone | computer | tv | console | speaker | web | other
);
CREATE INDEX IF NOT EXISTS ix_plays_end ON plays(end_epoch);
"""

EXTENDED_PREFIX, ACCOUNT_PREFIX = "streaming_history_audio_", "streaminghistory_music_"


def init(conn: sqlite3.Connection) -> None:
    db.init_db(conn)
    conn.executescript(PLAYS_SCHEMA)


def _device(platform: str | None) -> str:
    p = (platform or "").lower()
    for word, kind in (("ios", "phone"), ("android", "phone"), ("windows", "computer"), ("os x", "computer"),
                       ("osx", "computer"), ("mac", "computer"), ("linux", "computer"), ("web", "web"),
                       ("ps4", "console"), ("ps5", "console"), ("playstation", "console"), ("xbox", "console"),
                       ("tv", "tv"), ("cast", "speaker"), ("sonos", "speaker"), ("speaker", "speaker")):
        if word in p:
            return kind
    return "other"


def _epoch(text: str, fmt: str | None = None) -> float:
    if fmt:
        return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).timestamp()
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def parse_extended(rows: list) -> list[tuple]:
    """Extended history rows -> play tuples (music tracks only)."""
    out = []
    for r in rows:
        if not isinstance(r, dict) or not r.get("spotify_track_uri") or not r.get("master_metadata_track_name"):
            continue  # podcasts, audiobooks, local files, removed tracks
        out.append(("extended", _epoch(r["ts"]), int(r.get("ms_played") or 0), r["master_metadata_track_name"],
                    r.get("master_metadata_album_artist_name") or "Unknown artist", r.get("master_metadata_album_album_name"),
                    r["spotify_track_uri"], r.get("reason_start"), r.get("reason_end"), int(bool(r.get("shuffle"))),
                    int(bool(r.get("skipped"))), int(bool(r.get("offline"))), _device(r.get("platform"))))
    return out


def parse_account(rows: list) -> list[tuple]:
    """Account-data rows ("endTime": "2024-05-01 13:45" UTC) -> play tuples. No ids, albums or skip flags."""
    out = []
    for r in rows:
        if not isinstance(r, dict) or not r.get("trackName") or not r.get("endTime"):
            continue
        out.append(("account", _epoch(r["endTime"], "%Y-%m-%d %H:%M"), int(r.get("msPlayed") or 0), r["trackName"],
                    r.get("artistName") or "Unknown artist", None, None, None, None, None, None, None, None))
    return out


def _sources(folder: Path) -> list[Path]:
    return sorted(p for p in folder.rglob("*") if p.is_file() and ".incoming" not in p.parts
                  and (p.suffix.lower() == ".zip" or p.name.lower().startswith((EXTENDED_PREFIX, ACCOUNT_PREFIX))))


def ingest(conn: sqlite3.Connection, folder: Path) -> dict:
    """Replace the stored plays with everything in `folder` (exports are complete snapshots)."""
    plays: list[tuple] = []
    files = 0
    for path in _sources(folder):
        with Source(path) as src:
            for name in src.names():
                base = Path(name).name.lower()
                if not base.endswith(".json") or not base.startswith((EXTENDED_PREFIX, ACCOUNT_PREFIX)):
                    continue
                rows = src.read_json(name)
                if not isinstance(rows, list):
                    raise ImportRejected(f"{Path(name).name} isn't a Spotify streaming history file")
                plays += parse_extended(rows) if base.startswith(EXTENDED_PREFIX) else parse_account(rows)
                files += 1
    if not files:
        raise FileNotFoundError(f"No Streaming_History_Audio_*.json or StreamingHistory_music_*.json in {folder}")
    init(conn)
    conn.execute("DELETE FROM plays")
    conn.executemany("INSERT INTO plays (source, end_epoch, ms_played, track, artist, album, track_uri, reason_start, "
                     "reason_end, shuffle, skipped, offline, device) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     sorted(plays, key=lambda p: (p[1], p[3], p[0])))
    conn.commit()
    return {"files": files, "plays": len(plays), "sources": sorted({p[0] for p in plays})}


def album_key(artist: str, album: str) -> str:
    """Our id for an album (the export has album names, not ids)."""
    return f"album:{slug(artist, album)}"


def _apply_lookups(conn: sqlite3.Connection, items: dict, creators: dict, albums: dict) -> None:
    """Album art on albums and their tracks, photos on artists (from api.py's caches). Our artist ids come from names
    (the export has no artist ids), so a Spotify artist is matched through an album: its main artist, same name."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'sp_albums'").fetchone():
        return
    found = {aid: json.loads(d) for aid, d in conn.execute("SELECT album_id, data FROM sp_albums WHERE data IS NOT NULL")}
    photos = {a: json.loads(d) for a, d in conn.execute("SELECT artist_id, data FROM sp_artists WHERE data IS NOT NULL")}
    for aid, t in found.items():
        al, a = t["album"], albums.get(aid)
        if a:
            a.cover_small, a.cover_large, a.released = al.get("small"), al.get("large"), al.get("released")
        main = (t.get("artists") or [None])[0]
        cr = creators.get(a.creator_id or "") if a else None
        if main and cr and not cr.url and (main.get("name") or "").casefold() == (cr.title or "").casefold():
            cr.avatar_url = (photos.get(main["id"]) or {}).get("small")
            cr.url = f"https://open.spotify.com/artist/{main['id']}"
    for it in items.values():
        a = albums.get(it.album_id or "")
        if a and a.cover_small:
            it.thumb_small, it.thumb_large = a.cover_small, a.cover_large


def _genres(conn: sqlite3.Connection, items: dict, creators: dict) -> dict[str, list[str]]:
    """Genres per track: its artist's (Last.fm tags are per artist)."""
    by_name = lastfm.artist_genres(conn)
    if not by_name:
        return {}
    title = {cid: c.title for cid, c in creators.items()}
    return {i: by_name[title[it.creator_id]] for i, it in items.items()
            if it.creator_id in title and by_name.get(title[it.creator_id])}


def _track_id(uri: str | None, artist: str, track: str) -> str:
    """Spotify's id when the export has it; otherwise a name-based id (account data)."""
    return f"track:{uri.rsplit(':', 1)[-1]}" if uri else f"track:{slug(artist, track)}"


def build(conn: sqlite3.Connection, tz: ZoneInfo, session_gap_s: int = 1800) -> int:
    """Rebuild watches / items / creators / albums from the stored plays. Only streams (30 s or more) become
    listens; shorter plays are counted per track as skips."""
    init(conn)
    rows = conn.execute("SELECT id, source, end_epoch, ms_played, track, artist, album, track_uri, skipped "
                        "FROM plays ORDER BY end_epoch, id").fetchall()
    # account-data rows have no track id: give them the id the extended export uses for the same name
    uri_for = {(a, t): u for (_, _, _, _, t, a, _, u, _) in rows if u}
    views: list[View] = []
    items: dict[str, Item] = {}
    creators: dict[str, Creator] = {}
    albums: dict[str, Album] = {}
    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"plays": 0, "skips": 0})
    # both exports: the account download repeats the extended plays (to the minute only), so on days the extended
    # history covers, its rows win and the account rows are dropped
    extended_days = {datetime.fromtimestamp(r[2], tz).date() for r in rows if r[1] == "extended"}
    rows = [r for r in rows if r[1] == "extended" or datetime.fromtimestamp(r[2], tz).date() not in extended_days]
    for pid, source, end, ms, track, artist, album, uri, skipped in rows:
        uri = uri or uri_for.get((artist, track))
        item_id = _track_id(uri, artist, track)
        artist_id = f"artist:{slug(artist)}"
        album_id = album_key(artist, album) if album else None
        counts[item_id]["plays"] += 1
        if album_id and album_id not in albums:
            albums[album_id] = Album(album_id, album, artist_id)
        if item_id not in items or (album_id and not items[item_id].album_id):
            items[item_id] = Item(item_id, "ok", track, artist_id, url=(f"https://open.spotify.com/track/{uri.rsplit(':', 1)[-1]}"
                                                                         if uri else None), album_id=album_id)
        creators.setdefault(artist_id, Creator(artist_id, "ok", artist))
        if not is_stream(ms):
            counts[item_id]["skips"] += 1
            continue
        start = end - ms / 1000
        local = datetime.fromtimestamp(start, tz)
        views.append(View(pid, "track", item_id, artist_id, start, local, round(ms / 1000), "exact",
                          duration_s=round(ms / 1000), bucket="music"))
    _apply_lookups(conn, items, creators, albums)
    views = dedupe_listens(views)
    conn.execute("PRAGMA foreign_keys=OFF")  # no YouTube-style raw `entries` table here
    store.assign_sessions(views, session_gap_s)
    for item_id, c in counts.items():
        items[item_id].extra = json.dumps(c)
    n = store.write_views(conn, views)
    store.write_items(conn, items.values())
    store.write_creators(conn, creators.values())
    write_albums(conn, albums.values())
    genres = _genres(conn, items, creators)
    store.write_genres(conn, genres)
    db.set_meta(conn, "extra_capabilities", "time_of_day,genres" if genres else "time_of_day")
    finish_build(conn)
    return n
