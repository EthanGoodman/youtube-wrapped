"""Ranked top lists: channels, videos, categories, genres, tags, artists, songs."""
from __future__ import annotations

import sqlite3

from .common import Filters, Range, ranked


def _attach(conn: sqlite3.Connection, items: list[dict], sql: str) -> list[dict]:
    """Merge extra columns (looked up by key) into ranked items."""
    if not items:
        return items
    keys = [i["key"] for i in items]
    info = {row[0]: dict(row) for row in conn.execute(sql.format(ph=",".join("?" * len(keys))), keys)}
    for i in items:
        extra = info.get(i["key"], {})
        extra.pop("k", None)
        i.update(extra)
    return items


_CHANNEL_INFO = """
SELECT ch.k AS k, cr.title, cr.avatar_url, cr.subscriber_count, cr.handle,
       ch.first_watched, ch.last_watched
FROM (SELECT channel_id AS k, MIN(local_date) AS first_watched, MAX(local_date) AS last_watched
      FROM watches WHERE channel_id IN ({ph}) GROUP BY channel_id) ch
LEFT JOIN creators cr ON cr.creator_id = ch.k
"""

_VIDEO_INFO = """
SELECT w.video_id AS k, i.title, i.thumb_small AS thumb, i.duration_s, w.channel_id,
       cr.title AS channel, MIN(w.local_date) AS first_watched, MAX(w.local_date) AS last_watched,
       w.bucket, MAX(w.kind) AS kind
FROM watches w
LEFT JOIN items i ON i.item_id = w.video_id
LEFT JOIN creators cr ON cr.creator_id = w.channel_id
WHERE w.video_id IN ({ph}) GROUP BY w.video_id
"""


def top_channels(conn, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    # Netflix's nameless episodes ("Unknown show") count in totals but aren't a show to rank
    items = ranked(conn, "w.channel_id", r, f, limit + 1)
    if any(i["key"] == "show:unknown-show" for i in items):
        items = [i for i in items if i["key"] != "show:unknown-show"]
        for n, i in enumerate(items, 1):
            i["rank"] = n
            i["rank_change"] = (i["prev_rank"] - n) if i["prev_rank"] else None
    return _attach(conn, items[:limit], _CHANNEL_INFO)


def top_videos(conn, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    """By rewatch count (or time). Unavailable videos are included: they're still watches."""
    # nameless Netflix episodes ("Unknown show · Episode 1") from different shows would look like rewatches
    items = ranked(conn, "w.video_id", r, f, limit, extra_where="COALESCE(w.channel_id, '') != 'show:unknown-show'")
    return _attach(conn, items, _VIDEO_INFO)


def top_categories(conn, r: Range, f: Filters, limit: int = 30) -> list[dict]:
    items = ranked(conn, "w.category_id", r, f, limit)
    return _attach(conn, items, "SELECT category_id AS k, title FROM categories WHERE category_id IN ({ph})")


def top_genres(conn, r: Range, f: Filters, limit: int = 30) -> list[dict]:
    items = ranked(conn, "t.genre", r, f, limit, joins="JOIN item_genres t ON t.item_id = pv.video_id",
                   pre_aggregate_by_video=True)
    for i in items:
        i["title"] = i["key"]
    return items


def top_tags(conn, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    items = ranked(conn, "t.tag", r, f, limit, joins="JOIN item_tags t ON t.item_id = pv.video_id",
                   pre_aggregate_by_video=True)
    for i in items:
        i["title"] = i["key"]
    return items


def top_artists(conn, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    """YouTube Music artists: music watches grouped by channel ('Artist - Topic' -> 'Artist')."""
    fm = Filters(buckets=("music",), exclude_bg_time=f.exclude_bg_time, metric=f.metric)
    items = _attach(conn, ranked(conn, "w.channel_id", r, fm, limit), _CHANNEL_INFO)
    for i in items:
        if i.get("title", "").endswith(" - Topic"):
            i["title"] = i["title"][: -len(" - Topic")]
    return items


def top_songs(conn, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    fm = Filters(buckets=("music",), exclude_bg_time=f.exclude_bg_time, metric=f.metric)
    return _attach(conn, ranked(conn, "w.video_id", r, fm, limit), _VIDEO_INFO)
