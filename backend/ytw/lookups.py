"""Fill the generic display tables (items, creators, item_genres, item_tags) from YouTube's data.

The stats engine only reads titles, pictures and links from these tables, so other platforms
can reuse it by filling them their own way.
"""
from __future__ import annotations

import json
import re
import sqlite3

# (name, table, columns): dropped during the bulk rebuild and recreated after (much faster)
_INDEXES = [("ix_item_genres", "item_genres", "item_id, genre"),
            ("ix_item_genres_genre", "item_genres", "genre, item_id"),
            ("ix_item_tags", "item_tags", "item_id, tag"),
            ("ix_item_tags_tag", "item_tags", "tag, item_id")]
_SPACE = re.compile(r"\s+")
_KEY = re.compile(r"[^0-9a-z]+")

# One row per watched video: API data when we have it, else what Takeout recorded.
_ITEMS_SQL = """
INSERT INTO items (item_id, status, title, creator_id, thumb_small, thumb_large, duration_s,
                   published_at, category_id, url, extra)
SELECT w.video_id,
       CASE WHEN v.status IS NULL THEN 'unknown' ELSE v.status END,
       COALESCE(v.title, (SELECT e.title FROM entries e WHERE e.video_id = w.video_id AND e.title IS NOT NULL
                          ORDER BY e.epoch DESC LIMIT 1)),
       w.channel_id, v.thumb_small, v.thumb_large, v.duration_s, v.published_at, v.category_id,
       'https://www.youtube.com/watch?v=' || w.video_id,
       CASE WHEN v.status = 'ok' THEN json_object(
           'view_count', v.view_count, 'like_count', v.like_count, 'live', v.live,
           'channel_title', v.channel_title,
           'tags', json(COALESCE(v.tags, '[]')), 'topics', json(COALESCE(v.topics, '[]'))) END
FROM (SELECT video_id, MAX(channel_id) AS channel_id FROM watches
      WHERE video_id IS NOT NULL GROUP BY video_id) w
LEFT JOIN videos v ON v.video_id = w.video_id
"""

# One row per channel seen in watches: API data when we have it, else the name from Takeout.
_CREATORS_SQL = """
INSERT INTO creators (creator_id, status, title, handle, avatar_url, subscriber_count, item_count,
                      country, created_at, url, extra)
SELECT ids.cid,
       CASE WHEN c.status IS NULL THEN 'unknown' ELSE c.status END,
       COALESCE(c.title, (SELECT MAX(e.channel_name) FROM entries e WHERE e.channel_id = ids.cid)),
       c.handle, c.avatar_url, c.subscriber_count, c.video_count, c.country, c.created_at,
       'https://www.youtube.com/channel/' || ids.cid,
       json_object('topics', json(COALESCE(c.topics, '[]')))
FROM (SELECT DISTINCT channel_id AS cid FROM watches WHERE channel_id IS NOT NULL) ids
LEFT JOIN channels c ON c.channel_id = ids.cid
"""


def clean_tags(tags: list[str], channel_title: str | None, stopwords: frozenset[str]) -> list[str]:
    """Lowercase, trim, dedupe; drop the channel's own name, numbers, 1-char and stop tags."""
    chan = _KEY.sub("", (channel_title or "").lower())
    out, seen = [], set()
    for t in tags:
        t = _SPACE.sub(" ", t.lower().strip().strip("#"))
        key = _KEY.sub("", t)
        if (len(key) < 2 or key.isdigit() or t in stopwords or (chan and key == chan)
                or key in seen):
            continue
        seen.add(key)
        out.append(t)
    return out


def build_display(conn: sqlite3.Connection) -> tuple[int, int]:
    """Rebuild items and creators for everything in `watches`."""
    conn.execute("DELETE FROM items")
    conn.execute("DELETE FROM creators")
    conn.execute(_ITEMS_SQL)
    conn.execute(_CREATORS_SQL)
    conn.commit()
    return (conn.execute("SELECT COUNT(*) FROM items").fetchone()[0],
            conn.execute("SELECT COUNT(*) FROM creators").fetchone()[0])


def build_lookups(conn: sqlite3.Connection, stopwords: frozenset[str],
                  min_videos: int = 2) -> tuple[int, int]:
    """Rebuild items/creators, then item_genres and item_tags for watched videos.

    Tags found on fewer than `min_videos` videos are dropped: they can only rank via
    rewatches of one video (already covered by top videos) and they triple the table.
    """
    build_display(conn)
    rows = conn.execute(
        "SELECT v.video_id, v.topics, v.tags, v.channel_title FROM videos v "
        "WHERE v.status='ok' AND v.video_id IN (SELECT video_id FROM watches)").fetchall()
    genres, tags = [], []
    for vid, tp, tg, chan in rows:
        genres.extend((vid, t) for t in json.loads(tp or "[]"))
        tags.extend((vid, t) for t in clean_tags(json.loads(tg or "[]"), chan, stopwords))
    for name, _, _ in _INDEXES:
        conn.execute(f"DROP INDEX IF EXISTS {name}")
    conn.execute("DELETE FROM item_genres")
    conn.execute("DELETE FROM item_tags")
    conn.executemany("INSERT INTO item_genres VALUES (?, ?)", genres)
    # drop rare tags before inserting rather than deleting them afterwards
    per_tag: dict[str, int] = {}
    for _, t in tags:
        per_tag[t] = per_tag.get(t, 0) + 1
    conn.executemany("INSERT INTO item_tags VALUES (?, ?)",
                     ((v, t) for v, t in tags if per_tag[t] >= min_videos))
    for name, table, cols in _INDEXES:
        conn.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table}({cols})")
    conn.commit()
    return len(genres), conn.execute("SELECT COUNT(*) FROM item_tags").fetchone()[0]
