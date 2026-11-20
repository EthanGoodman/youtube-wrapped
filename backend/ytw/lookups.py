"""Normalized per-video genre (topic) and tag tables, so stats don't parse JSON per row."""
from __future__ import annotations

import json
import re
import sqlite3

# (name, table, columns): dropped during the bulk rebuild and recreated after (much faster)
_INDEXES = [("ix_video_topics", "video_topics", "video_id, topic"),
            ("ix_video_topics_topic", "video_topics", "topic, video_id"),
            ("ix_video_tags", "video_tags", "video_id, tag"),
            ("ix_video_tags_tag", "video_tags", "tag, video_id")]
_SPACE = re.compile(r"\s+")
_KEY = re.compile(r"[^0-9a-z]+")


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


def build_lookups(conn: sqlite3.Connection, stopwords: frozenset[str],
                  min_videos: int = 2) -> tuple[int, int]:
    """Rebuild video_topics and video_tags for watched videos.

    Tags found on fewer than `min_videos` videos are dropped: they can only rank via
    rewatches of one video (already covered by top videos) and they triple the table.
    """
    rows = conn.execute(
        "SELECT v.video_id, v.topics, v.tags, v.channel_title FROM videos v "
        "WHERE v.status='ok' AND v.video_id IN (SELECT video_id FROM watches)").fetchall()
    topics, tags = [], []
    for vid, tp, tg, chan in rows:
        topics.extend((vid, t) for t in json.loads(tp or "[]"))
        tags.extend((vid, t) for t in clean_tags(json.loads(tg or "[]"), chan, stopwords))
    for name, _, _ in _INDEXES:
        conn.execute(f"DROP INDEX IF EXISTS {name}")
    conn.execute("DELETE FROM video_topics")
    conn.execute("DELETE FROM video_tags")
    conn.executemany("INSERT INTO video_topics VALUES (?, ?)", topics)
    # drop rare tags before inserting rather than deleting them afterwards
    per_tag: dict[str, int] = {}
    for _, t in tags:
        per_tag[t] = per_tag.get(t, 0) + 1
    conn.executemany("INSERT INTO video_tags VALUES (?, ?)",
                     ((v, t) for v, t in tags if per_tag[t] >= min_videos))
    for name, table, cols in _INDEXES:
        conn.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table}({cols})")
    conn.commit()
    return len(topics), conn.execute("SELECT COUNT(*) FROM video_tags").fetchone()[0]
