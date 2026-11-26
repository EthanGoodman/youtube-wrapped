"""Click-through detail pages: channel, video, category, genre, year."""
from __future__ import annotations

import json
import sqlite3
from datetime import date

from . import evolution, overview, patterns, records, tops
from .common import Filters, Range, ranked, time_expr, watches_for_totals, where

EVER = evolution.EVER


def _subset_totals(conn, r: Range, f: Filters, joins: str, cond: str, params: list) -> dict:
    w_sql, p = where(r, f)
    row = conn.execute(f"""
        SELECT COUNT(*), COUNT(DISTINCT w.video_id), SUM({time_expr(f)}), MIN(w.local_date),
               MAX(w.local_date), COUNT(DISTINCT w.local_date)
        FROM {watches_for_totals(conn, r)} w {joins} WHERE {w_sql} AND {cond}""", [*p, *params]).fetchone()
    return {"videos": row[0], "unique_videos": row[1], "est_s": row[2] or 0,
            "first_watched": row[3], "last_watched": row[4], "active_days": row[5]}


def _subset_monthly(conn, f: Filters, joins: str, cond: str, params: list) -> list[dict]:
    w_sql, p = where(EVER, f)
    return [{"month": m, "count": n, "time_s": t or 0} for m, n, t in conn.execute(
        f"SELECT w.month, COUNT(*), SUM({time_expr(f)}) FROM watches w {joins} "
        f"WHERE {w_sql} AND {cond} GROUP BY 1 ORDER BY 1", [*p, *params])]


def _subset_clock(conn, r: Range, f: Filters, joins: str, cond: str, params: list) -> list[dict]:
    w_sql, p = where(r, f)
    got = {h: (n, t or 0) for h, n, t in conn.execute(
        f"SELECT w.local_hour, COUNT(*), SUM({time_expr(f)}) FROM watches w {joins} "
        f"WHERE {w_sql} AND {cond} GROUP BY 1", [*p, *params])}
    return [{"hour": h, "count": got.get(h, (0, 0))[0], "time_s": got.get(h, (0, 0))[1]} for h in range(24)]


def _top_videos_in(conn, r: Range, f: Filters, joins: str, cond: str, params: list, limit=20):
    items = ranked(conn, "w.video_id", r, f, limit, joins=joins, extra_where=cond,
                   extra_params=tuple(params), compare=False)
    return tops._attach(conn, items, tops._VIDEO_INFO)


def _top_channels_in(conn, r: Range, f: Filters, joins: str, cond: str, params: list, limit=20):
    items = ranked(conn, "w.channel_id", r, f, limit, joins=joins, extra_where=cond,
                   extra_params=tuple(params), compare=False)
    return tops._attach(conn, items, tops._CHANNEL_INFO)


def channel_rank_history(conn, channel_id: str, f: Filters) -> list[dict]:
    """The channel's rank among all channels, per year."""
    w_sql, p = where(EVER, f)
    order = f"SUM({time_expr(f)})" if f.metric == "time" else "COUNT(*)"
    rows = conn.execute(f"""
        SELECT year, rnk, n, total FROM (
            SELECT w.year, w.channel_id, COUNT(*) n,
                   RANK() OVER (PARTITION BY w.year ORDER BY {order} DESC) rnk,
                   COUNT(*) OVER (PARTITION BY w.year) total
            FROM watches w WHERE {w_sql} AND w.channel_id IS NOT NULL GROUP BY w.year, w.channel_id)
        WHERE channel_id = ? ORDER BY year""", [*p, channel_id]).fetchall()
    return [{"year": y, "rank": rk, "count": n, "channels_that_year": tot} for y, rk, n, tot in rows]


def channel(conn: sqlite3.Connection, channel_id: str, r: Range, f: Filters) -> dict | None:
    info = conn.execute("SELECT * FROM creators WHERE creator_id = ?", (channel_id,)).fetchone()
    if not info:
        return None
    extra = json.loads(info["extra"] or "{}")
    cond, params = "w.channel_id = ?", [channel_id]
    return {
        "channel": {"channel_id": channel_id, "title": info["title"], "handle": info["handle"],
                    "avatar_url": info["avatar_url"], "subscriber_count": info["subscriber_count"],
                    "video_count": info["item_count"], "country": info["country"],
                    "created_at": info["created_at"], "topics": extra.get("topics", [])},
        "url": info["url"],
        "range": r.to_dict(),
        "in_range": _subset_totals(conn, r, f, "", cond, params),
        "all_time": _subset_totals(conn, EVER, f, "", cond, params),
        "top_videos": _top_videos_in(conn, r, f, "", cond, params),
        "monthly": _subset_monthly(conn, f, "", cond, params),
        "clock": _subset_clock(conn, r, f, "", cond, params),
        "rank_history": channel_rank_history(conn, channel_id, f),
    }


def video(conn: sqlite3.Connection, video_id: str) -> dict | None:
    watches = conn.execute("""SELECT w.entry_id, w.local_iso, w.est_s, w.est_method, w.delayed_fix
        FROM watches w WHERE w.video_id = ? ORDER BY w.start_epoch""", (video_id,)).fetchall()
    i = conn.execute("""SELECT i.*, cr.title AS creator_title, c.title AS category FROM items i
        LEFT JOIN creators cr ON cr.creator_id = i.creator_id
        LEFT JOIN categories c ON c.category_id = i.category_id
        WHERE i.item_id = ?""", (video_id,)).fetchone()
    if not i:
        return None
    extra = json.loads(i["extra"] or "{}")
    w0 = conn.execute("SELECT kind, bucket, short_basis, is_background, is_live FROM watches "
                      "WHERE video_id = ? ORDER BY start_epoch DESC LIMIT 1", (video_id,)).fetchone()
    return {
        "video": {"video_id": video_id, "status": i["status"], "title": i["title"],
                  "channel_id": i["creator_id"], "channel_title": i["creator_title"] or extra.get("channel_title"),
                  "published_at": i["published_at"], "duration_s": i["duration_s"],
                  "category_id": i["category_id"], "category": i["category"],
                  "thumb_large": i["thumb_large"], "view_count": extra.get("view_count"),
                  "like_count": extra.get("like_count"), "live": extra.get("live"),
                  "tags": extra.get("tags", []), "topics": extra.get("topics", []),
                  **(dict(w0) if w0 else {})},
        "url": i["url"],
        "watch_count": len(watches),
        "total_est_s": sum(w["est_s"] for w in watches),
        "watches": [dict(w) for w in watches],
    }


def category(conn, category_id: str, r: Range, f: Filters) -> dict | None:
    t = conn.execute("SELECT title FROM categories WHERE category_id = ?", (category_id,)).fetchone()
    if not t:
        return None
    cond, params = "w.category_id = ?", [category_id]
    return {
        "category": {"category_id": category_id, "title": t[0]}, "range": r.to_dict(),
        "in_range": _subset_totals(conn, r, f, "", cond, params),
        "all_time": _subset_totals(conn, EVER, f, "", cond, params),
        "top_channels": _top_channels_in(conn, r, f, "", cond, params),
        "top_videos": _top_videos_in(conn, r, f, "", cond, params),
        "monthly": _subset_monthly(conn, f, "", cond, params),
        "clock": _subset_clock(conn, r, f, "", cond, params),
    }


def genre(conn, topic: str, r: Range, f: Filters) -> dict | None:
    if not conn.execute("SELECT 1 FROM item_genres WHERE genre = ? LIMIT 1", (topic,)).fetchone():
        return None
    joins, cond, params = "JOIN item_genres t ON t.item_id = w.video_id", "t.genre = ?", [topic]
    return {
        "genre": {"title": topic,
                  "url": "https://en.wikipedia.org/wiki/" + topic.replace(" ", "_")},
        "range": r.to_dict(),
        "in_range": _subset_totals(conn, r, f, joins, cond, params),
        "all_time": _subset_totals(conn, EVER, f, joins, cond, params),
        "top_channels": _top_channels_in(conn, r, f, joins, cond, params),
        "top_videos": _top_videos_in(conn, r, f, joins, cond, params),
        "monthly": _subset_monthly(conn, f, joins, cond, params),
        "clock": _subset_clock(conn, r, f, joins, cond, params),
    }


def year(conn, y: int, f: Filters, today: date | None = None) -> dict:
    r = Range(date(y, 1, 1), date(y, 12, 31), str(y))
    return {
        "year": y,
        "overview": overview.overview(conn, r, f),
        "top_channels": tops.top_channels(conn, r, f, 10),
        "top_videos": tops.top_videos(conn, r, f, 10),
        "top_categories": tops.top_categories(conn, r, f, 10),
        "top_genres": tops.top_genres(conn, r, f, 10),
        "new_discoveries": evolution.new_discoveries(conn, r, f, 10),
        "monthly": patterns.monthly(conn, r, f),
        "clock": patterns.clock(conn, r, f),
        "records": records.records(conn, r, f, today),
    }
