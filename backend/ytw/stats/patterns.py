"""When you watch: clock, weekday x hour heatmap, calendar, monthly, weekday vs weekend."""
from __future__ import annotations

import sqlite3
from datetime import timedelta

from .common import Filters, Range, time_expr, where


def clock(conn: sqlite3.Connection, r: Range, f: Filters) -> list[dict]:
    w_sql, p = where(r, f)
    got = {h: (n, t) for h, n, t in conn.execute(
        f"SELECT w.local_hour, COUNT(*), SUM({time_expr(f)}) FROM watches w WHERE {w_sql} GROUP BY 1", p)}
    return [{"hour": h, "count": got.get(h, (0, 0))[0], "time_s": got.get(h, (0, 0))[1] or 0}
            for h in range(24)]


def heatmap(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    """grid[dow][hour]; dow 0 = Monday."""
    w_sql, p = where(r, f)
    count = [[0] * 24 for _ in range(7)]
    time_s = [[0] * 24 for _ in range(7)]
    for d, h, n, t in conn.execute(
            f"SELECT w.local_dow, w.local_hour, COUNT(*), SUM({time_expr(f)}) FROM watches w "
            f"WHERE {w_sql} GROUP BY 1, 2", p):
        count[d][h], time_s[d][h] = n, t or 0
    return {"count": count, "time_s": time_s}


def calendar(conn: sqlite3.Connection, r: Range, f: Filters) -> list[dict]:
    """One entry per day in the range (zeros included)."""
    w_sql, p = where(r, f)
    got = {d: (n, t) for d, n, t in conn.execute(
        f"SELECT w.local_date, COUNT(*), SUM({time_expr(f)}) FROM watches w WHERE {w_sql} GROUP BY 1", p)}
    out = []
    day = r.start
    while day <= r.end:
        n, t = got.get(day.isoformat(), (0, 0))
        out.append({"date": day.isoformat(), "count": n, "time_s": t or 0})
        day += timedelta(days=1)
    return out


def monthly(conn: sqlite3.Connection, r: Range, f: Filters) -> list[dict]:
    w_sql, p = where(r, f)
    rows = conn.execute(f"""
        SELECT w.month, COUNT(*), SUM({time_expr(f)}),
               SUM(w.bucket = 'long'), SUM(w.bucket = 'short'), SUM(w.bucket = 'music')
        FROM watches w WHERE {w_sql} GROUP BY 1 ORDER BY 1""", p).fetchall()
    got = {m: (n, t, lo, sh, mu) for m, n, t, lo, sh, mu in rows}
    out = []
    y, m = r.start.year, r.start.month
    while (y, m) <= (r.end.year, r.end.month):
        key = f"{y:04d}-{m:02d}"
        n, t, lo, sh, mu = got.get(key, (0, 0, 0, 0, 0))
        out.append({"month": key, "count": n, "time_s": t or 0, "long": lo or 0, "short": sh or 0,
                    "music": mu or 0})
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def weekday_weekend(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    w_sql, p = where(r, f)
    tot = {"weekday": [0, 0], "weekend": [0, 0]}
    for kind, n, t in conn.execute(
            f"SELECT CASE WHEN w.local_dow >= 5 THEN 'weekend' ELSE 'weekday' END, COUNT(*), "
            f"SUM({time_expr(f)}) FROM watches w WHERE {w_sql} GROUP BY 1", p):
        tot[kind] = [n, t or 0]
    days = {"weekday": 0, "weekend": 0}
    day = r.start
    while day <= r.end:
        days["weekend" if day.weekday() >= 5 else "weekday"] += 1
        day += timedelta(days=1)
    return {k: {"count": tot[k][0], "time_s": tot[k][1], "days": days[k],
                "avg_count_per_day": tot[k][0] / days[k] if days[k] else 0,
                "avg_time_s_per_day": tot[k][1] / days[k] if days[k] else 0}
            for k in ("weekday", "weekend")}
