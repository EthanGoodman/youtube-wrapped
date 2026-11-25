"""The music family's shared pieces (#20): what counts as a stream, albums, and one listen per play across sources.

A music connector's build() writes the same generic tables as every platform (store.py):
    View     one stream (-> watches): kind "track", item = the track, creator = its main artist, bucket "music"
    Item     the track (-> items), with album_id
    Creator  the artist (-> creators)
plus albums (-> albums) and genres per track (-> item_genres, usually the artist's genres).

Only streams are stored: plays of at least 30 seconds, Spotify's own rule for counting a stream (stats.fm counts
the same way). Shorter plays are skips; connectors keep a per-track skip count in items.extra instead.
"""
from __future__ import annotations

import sqlite3
from dataclasses import astuple, dataclass
from typing import Iterable

from .store import View

MIN_STREAM_MS = 30_000      # a play counts as a stream from 30 seconds
SAME_PLAY_S = 30            # two sources reporting the same track this close together = one play


def is_stream(ms_played: int | None) -> bool:
    return (ms_played or 0) >= MIN_STREAM_MS


@dataclass(slots=True)
class Album:
    album_id: str
    title: str | None = None
    creator_id: str | None = None     # the album's artist
    cover_small: str | None = None
    cover_large: str | None = None
    released: str | None = None       # YYYY or YYYY-MM-DD
    extra: str | None = None


def write_albums(conn: sqlite3.Connection, albums: Iterable[Album]) -> None:
    conn.execute("DELETE FROM albums")
    conn.executemany("INSERT INTO albums VALUES (?,?,?,?,?,?,?)", [astuple(a) for a in albums])


def dedupe_listens(views: Iterable[View]) -> list[View]:
    """One listen per play when several sources report it (a Spotify export and Last.fm scrobbles, say): the same
    track starting within SAME_PLAY_S seconds of a kept listen is dropped. The first source given wins a tie, so
    pass the most detailed source first. Order of the result: by start time."""
    kept: list[View] = []
    last_start: dict[str | None, float] = {}
    for v in sorted(views, key=lambda v: v.start_epoch):  # stable: equal starts keep the caller's order
        prev = last_start.get(v.item_id)
        if prev is not None and v.start_epoch - prev <= SAME_PLAY_S:
            continue
        kept.append(v)
        last_start[v.item_id] = v.start_epoch
    return kept
