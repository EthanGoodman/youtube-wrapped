"""Music-only stats (#20): top albums, an album's page, and the records only music has (on repeat, most skipped).
Artists and tracks use the shared lists and pages (creators = artists, items = tracks)."""
from __future__ import annotations

import json
import sqlite3

from . import details, tops
from .common import Filters, Range, ranked, where

_ALBUM_INFO = """
SELECT a.album_id AS k, a.title, a.cover_small AS cover, a.released, a.creator_id AS artist_id, cr.title AS artist
FROM albums a LEFT JOIN creators cr ON cr.creator_id = a.creator_id
WHERE a.album_id IN ({ph})
"""
_TRACK_ALBUM = "JOIN items ia ON ia.item_id = w.video_id"


def top_albums(conn: sqlite3.Connection, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    items = ranked(conn, "ia.album_id", r, f, limit, joins="JOIN items ia ON ia.item_id = pv.video_id",
                   pre_aggregate_by_video=True)
    return tops._attach(conn, items, _ALBUM_INFO)


def album(conn: sqlite3.Connection, album_id: str, r: Range, f: Filters) -> dict | None:
    info = conn.execute(_ALBUM_INFO.format(ph="?"), (album_id,)).fetchone()
    if not info:
        return None
    cond, params = "ia.album_id = ?", [album_id]
    return {
        "album": {k: info[k] for k in ("title", "cover", "released", "artist_id", "artist")} | {"album_id": album_id},
        "range": r.to_dict(),
        "in_range": details._subset_totals(conn, r, f, _TRACK_ALBUM, cond, params),
        "all_time": details._subset_totals(conn, details.EVER, f, _TRACK_ALBUM, cond, params),
        "top_videos": details._top_videos_in(conn, r, f, _TRACK_ALBUM, cond, params, limit=50),
        "monthly": details._subset_monthly(conn, f, _TRACK_ALBUM, cond, params),
        "clock": details._subset_clock(conn, r, f, _TRACK_ALBUM, cond, params),
    }


def _track(conn: sqlite3.Connection, item_id: str) -> dict:
    row = conn.execute("""SELECT i.item_id, i.title, i.thumb_small, i.creator_id, cr.title AS artist, a.cover_small
        FROM items i LEFT JOIN creators cr ON cr.creator_id = i.creator_id LEFT JOIN albums a ON a.album_id = i.album_id
        WHERE i.item_id = ?""", (item_id,)).fetchone()
    if not row:
        return {"key": item_id}
    return {"key": row["item_id"], "title": row["title"], "artist": row["artist"], "artist_id": row["creator_id"],
            "cover": row["thumb_small"] or row["cover_small"]}


def records(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    """On repeat: the most streams of one track in a single day. Most skipped: the track you skipped most (all time;
    skips aren't streams, so they're counted per track at build time)."""
    w_sql, p = where(r, f)
    rep = conn.execute(f"""SELECT w.local_date, w.video_id, COUNT(*) n FROM watches w WHERE {w_sql}
        GROUP BY 1, 2 ORDER BY n DESC, w.local_date, w.video_id LIMIT 1""", p).fetchone()
    skipped = None
    for item_id, extra in conn.execute("SELECT item_id, extra FROM items WHERE extra LIKE '%\"skips\"%'"):
        s = json.loads(extra or "{}").get("skips", 0)
        if s and (skipped is None or (s, item_id) > (skipped[1], skipped[0])):
            skipped = (item_id, s)
    return {
        "on_repeat": {**_track(conn, rep[1]), "date": rep[0], "count": rep[2]} if rep and rep[2] > 1 else None,
        "most_skipped": {**_track(conn, skipped[0]), "skips": skipped[1]} if skipped else None,
    }
