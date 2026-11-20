"""Overview numbers for a range, with comparison against the previous equal period."""
from __future__ import annotations

import sqlite3

from .common import Filters, Range, max_expr, pct_change, time_expr, where


def _totals(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    w_sql, p = where(r, f)
    row = conn.execute(f"""
        SELECT COUNT(*), COUNT(DISTINCT w.video_id), COUNT(DISTINCT w.channel_id),
               COALESCE(SUM({time_expr(f)}), 0), COALESCE(SUM({max_expr(f)}), 0),
               COUNT(DISTINCT w.local_date),
               SUM(w.is_background), COALESCE(SUM(CASE WHEN w.is_background = 1 THEN w.est_s END), 0),
               SUM(w.duration_s IS NULL)
        FROM watches w WHERE {w_sql}""", p).fetchone()
    videos, uniq_v, uniq_c, est, mx, active, bg, bg_s, unknown = row
    days = r.days
    return {
        "videos": videos, "unique_videos": uniq_v, "unique_channels": uniq_c,
        "est_s": est, "max_s": mx, "active_days": active, "days": days,
        "pct_days_active": active / days if days else 0,
        "avg_videos_per_day": videos / days if days else 0,
        "avg_est_s_per_day": est / days if days else 0,
        "background_videos": bg or 0, "background_s": bg_s,
        "unknown_duration_videos": unknown or 0,
    }


def _split(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    w_sql, p = where(r, Filters(exclude_bg_time=f.exclude_bg_time))  # always all buckets here
    out = {b: {"videos": 0, "est_s": 0} for b in ("long", "short", "music")}
    for b, n, t in conn.execute(
            f"SELECT w.bucket, COUNT(*), SUM({time_expr(f)}) FROM watches w WHERE {w_sql} GROUP BY 1", p):
        out[b] = {"videos": n, "est_s": t or 0}
    return out


def _edge_watch(conn: sqlite3.Connection, r: Range, f: Filters, order: str) -> dict | None:
    w_sql, p = where(r, f)
    # find the row first, then join only that one (joining before sorting is ~30x slower)
    hit = conn.execute(f"SELECT w.entry_id FROM watches w WHERE {w_sql} "
                       f"ORDER BY w.start_epoch {order} LIMIT 1", p).fetchone()
    if not hit:
        return None
    return watch_info(conn, hit[0])


def watch_info(conn: sqlite3.Connection, entry_id: int) -> dict | None:
    """Display info for one watch."""
    row = conn.execute("""
        SELECT w.entry_id, w.video_id, w.local_iso, COALESCE(v.title, e.title) AS title,
               COALESCE(c.title, e.channel_name) AS channel, w.channel_id, v.thumb_small AS thumb,
               w.kind, w.bucket, w.duration_s, w.est_s
        FROM watches w JOIN entries e ON e.id = w.entry_id
        LEFT JOIN videos v ON v.video_id = w.video_id AND v.status = 'ok'
        LEFT JOIN channels c ON c.channel_id = w.channel_id AND c.status = 'ok'
        WHERE w.entry_id = ?""", (entry_id,)).fetchone()
    return dict(row) if row else None


def overview(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    cur = _totals(conn, r, f)
    prev = _totals(conn, r.previous(), f)
    return {
        "range": r.to_dict(),
        **cur,
        "change": {k: pct_change(cur[k], prev[k])
                   for k in ("videos", "unique_videos", "unique_channels", "est_s", "active_days")},
        "previous": prev,
        "split": _split(conn, r, f),
        "first_watch": _edge_watch(conn, r, f, "ASC"),
        "last_watch": _edge_watch(conn, r, f, "DESC"),
    }
