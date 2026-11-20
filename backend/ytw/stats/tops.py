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
SELECT ch.k AS k, COALESCE(c.title, ch.name) AS title, c.avatar_url, c.subscriber_count, c.handle,
       ch.first_watched, ch.last_watched
FROM (SELECT channel_id AS k, MIN(local_date) AS first_watched, MAX(local_date) AS last_watched,
             (SELECT e.channel_name FROM entries e WHERE e.channel_id = w.channel_id LIMIT 1) AS name
      FROM watches w WHERE channel_id IN ({ph}) GROUP BY channel_id) ch
LEFT JOIN channels c ON c.channel_id = ch.k AND c.status = 'ok'
"""

_VIDEO_INFO = """
SELECT w.video_id AS k, COALESCE(v.title, MAX(e.title)) AS title, v.thumb_small AS thumb,
       v.duration_s, w.channel_id, COALESCE(c.title, MAX(e.channel_name)) AS channel,
       MIN(w.local_date) AS first_watched, MAX(w.local_date) AS last_watched, w.bucket,
       MAX(w.kind) AS kind
FROM watches w JOIN entries e ON e.id = w.entry_id
LEFT JOIN videos v ON v.video_id = w.video_id AND v.status = 'ok'
LEFT JOIN channels c ON c.channel_id = w.channel_id AND c.status = 'ok'
WHERE w.video_id IN ({ph}) GROUP BY w.video_id
"""


def top_channels(conn, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    items = ranked(conn, "w.channel_id", r, f, limit)
    return _attach(conn, items, _CHANNEL_INFO)


def top_videos(conn, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    """By rewatch count (or time). Unavailable videos are included: they're still watches."""
    items = ranked(conn, "w.video_id", r, f, limit)
    return _attach(conn, items, _VIDEO_INFO)


def top_categories(conn, r: Range, f: Filters, limit: int = 30) -> list[dict]:
    items = ranked(conn, "w.category_id", r, f, limit)
    return _attach(conn, items, "SELECT category_id AS k, title FROM categories WHERE category_id IN ({ph})")


def top_genres(conn, r: Range, f: Filters, limit: int = 30) -> list[dict]:
    items = ranked(conn, "t.topic", r, f, limit, joins="JOIN video_topics t ON t.video_id = pv.video_id",
                   pre_aggregate_by_video=True)
    for i in items:
        i["title"] = i["key"]
    return items


def top_tags(conn, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    items = ranked(conn, "t.tag", r, f, limit, joins="JOIN video_tags t ON t.video_id = pv.video_id",
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
