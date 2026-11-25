"""The generic tables every stat reads, and the typed rows connectors write into them.

A video connector's build() turns its raw data into:
    View     one time something was watched (-> watches)
    Item     the thing watched: a video, an episode, a movie (-> items)
    Creator  who made it: a channel, a show, a series (-> creators)
plus genres per item (-> item_genres). Other families (music, games, …) add their event types
here when their chapter lands.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import astuple, dataclass
from datetime import date, datetime
from typing import Iterable

_SLUG = re.compile(r"[^a-z0-9]+")


def slug(*parts: str | None) -> str:
    """A stable id from names: slug("Harbor Lights", "Season 1") -> "harbor-lights|season-1"."""
    return "|".join(_SLUG.sub("-", (p or "").lower()).strip("-") for p in parts)


WATCH_COLS = ("entry_id", "kind", "video_id", "channel_id", "start_epoch", "local_iso", "local_date", "year",
              "month", "local_hour", "local_minute", "local_dow", "duration_s", "est_s", "max_s", "est_method",
              "gap_next_s", "session_id", "bucket", "short_basis", "is_background", "is_live", "delayed_fix",
              "category_id", "published_epoch")


@dataclass(slots=True)
class View:
    """One viewing. Everything date-shaped (day, month, hour, weekday) is derived from `local`."""
    entry_id: int
    kind: str                         # video | short | music | episode | movie | …
    item_id: str | None
    creator_id: str | None
    start_epoch: float
    local: datetime                   # the start, in the user's timezone
    est_s: int                        # seconds watched (exact, or estimated: see est_method)
    est_method: str                   # exact | gap | full | cap | runtime | fallback | complete | playhead
    duration_s: int | None = None     # what the platform says it watched/played, if anything
    max_s: int | None = None          # the most it could have been (the item's full length)
    session_id: int | None = None
    bucket: str = "long"              # long | short | music | unknown
    local_date: str | None = None     # only when the export's own date must win (dates-only files)
    gap_next_s: float | None = None
    short_basis: str | None = None
    is_background: int = 0
    is_live: int = 0
    delayed_fix: int = 0
    category_id: str | None = None
    published_epoch: float | None = None

    def row(self) -> tuple:
        lc = self.local
        d = self.local_date or lc.date().isoformat()
        return (self.entry_id, self.kind, self.item_id, self.creator_id, self.start_epoch, lc.isoformat(), d,
                int(d[:4]), d[:7], lc.hour, lc.hour * 60 + lc.minute, date.fromisoformat(d).weekday(),
                self.duration_s, self.est_s, self.max_s, self.est_method, self.gap_next_s, self.session_id,
                self.bucket, self.short_basis, self.is_background, self.is_live, self.delayed_fix,
                self.category_id, self.published_epoch)


@dataclass(slots=True)
class Item:
    item_id: str
    status: str                       # ok | missing | unknown (never looked up)
    title: str | None = None
    creator_id: str | None = None
    thumb_small: str | None = None
    thumb_large: str | None = None
    duration_s: int | None = None
    published_at: str | None = None
    category_id: str | None = None
    url: str | None = None
    extra: str | None = None          # JSON for platform-specific fields
    album_id: str | None = None       # music: the track's album


ITEM_COLS = ("item_id", "status", "title", "creator_id", "thumb_small", "thumb_large", "duration_s", "published_at",
             "category_id", "url", "extra", "album_id")


@dataclass(slots=True)
class Creator:
    creator_id: str
    status: str
    title: str | None = None
    handle: str | None = None
    avatar_url: str | None = None
    subscriber_count: int | None = None
    item_count: int | None = None
    country: str | None = None
    created_at: str | None = None
    url: str | None = None
    extra: str | None = None


def assign_sessions(views: list[View], gap_s: float = 1800) -> None:
    """Group views into sessions: a new one starts after a gap of more than `gap_s` seconds."""
    n, prev_end = 0, None
    for v in sorted(views, key=lambda v: v.start_epoch):
        if prev_end is None or v.start_epoch - prev_end > gap_s:
            n += 1
        v.session_id = n
        prev_end = max(prev_end or 0, v.start_epoch + v.est_s)


def write_views(conn: sqlite3.Connection, views: Iterable[View]) -> int:
    """Replace `watches` with these views. Returns how many. Views without a session_id get
    sessions by the 30-minute-gap rule (set them yourself for platform-specific sessions)."""
    views = list(views)
    missing = sum(v.session_id is None for v in views)
    if missing and missing != len(views):
        raise ValueError("set session_id on every view or on none")
    if missing:
        assign_sessions(views)
    rows = [v.row() for v in views]
    conn.execute("DELETE FROM watches")
    conn.executemany(f"INSERT INTO watches ({', '.join(WATCH_COLS)}) VALUES ({','.join('?' * len(WATCH_COLS))})",
                     rows)
    return len(rows)


def write_items(conn: sqlite3.Connection, items: Iterable[Item]) -> None:
    conn.execute("DELETE FROM items")
    # named columns: databases made before album_id have it last (added by migration), new ones too
    conn.executemany(f"INSERT INTO items ({', '.join(ITEM_COLS)}) VALUES ({','.join('?' * len(ITEM_COLS))})",
                     [astuple(i) for i in items])


def write_creators(conn: sqlite3.Connection, creators: Iterable[Creator]) -> None:
    conn.execute("DELETE FROM creators")
    conn.executemany("INSERT INTO creators VALUES (?,?,?,?,?,?,?,?,?,?,?)", [astuple(c) for c in creators])


def write_genres(conn: sqlite3.Connection, genres: dict[str, Iterable[str]]) -> None:
    conn.execute("DELETE FROM item_genres")
    conn.executemany("INSERT INTO item_genres VALUES (?, ?)", [(i, g) for i, gs in genres.items() for g in gs])
