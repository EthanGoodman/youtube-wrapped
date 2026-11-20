"""How taste changed: #1 per year, bar race, discoveries, loyalty, fell off, mix by year."""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import date, timedelta

from .common import Filters, Range, time_expr, where

EVER = Range(date(1970, 1, 1), date(9999, 12, 31))


def _channel_names(conn: sqlite3.Connection, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    ph = ",".join("?" * len(ids))
    out = {cid: {"title": name, "avatar_url": None} for cid, name in conn.execute(
        f"SELECT channel_id, MAX(channel_name) FROM entries WHERE channel_id IN ({ph}) GROUP BY 1", ids)}
    for cid, title, avatar in conn.execute(
            f"SELECT channel_id, title, avatar_url FROM channels WHERE status='ok' AND channel_id IN ({ph})", ids):
        out[cid] = {"title": title or out.get(cid, {}).get("title"), "avatar_url": avatar}
    return out


def _metric(f: Filters) -> str:
    return f"SUM({time_expr(f)})" if f.metric == "time" else "COUNT(*)"


def top_channel_per_year(conn, f: Filters) -> list[dict]:
    w_sql, p = where(EVER, f)
    best: dict[int, tuple] = {}
    for year, cid, n, t in conn.execute(
            f"SELECT w.year, w.channel_id, COUNT(*), SUM({time_expr(f)}) FROM watches w "
            f"WHERE {w_sql} AND w.channel_id IS NOT NULL GROUP BY 1, 2", p):
        val = t if f.metric == "time" else n
        if year not in best or val > best[year][3]:
            best[year] = (cid, n, t or 0, val)
    names = _channel_names(conn, [b[0] for b in best.values()])
    return [{"year": y, "channel_id": b[0], "count": b[1], "time_s": b[2], **names.get(b[0], {})}
            for y, b in sorted(best.items())]


def bar_race(conn, r: Range, f: Filters, top_n: int = 10) -> dict:
    """Cumulative count (or time) per channel per month, for channels that were ever top N."""
    w_sql, p = where(r, f)
    per = defaultdict(dict)  # month -> {channel: value}
    months = []
    for month, cid, val in conn.execute(
            f"SELECT w.month, w.channel_id, {_metric(f)} FROM watches w "
            f"WHERE {w_sql} AND w.channel_id IS NOT NULL GROUP BY 1, 2 ORDER BY 1", p):
        if not months or months[-1] != month:
            months.append(month)
        per[month][cid] = val or 0
    cum: dict[str, float] = defaultdict(float)
    frames = []
    ever_top: set[str] = set()
    for m in months:
        for cid, v in per[m].items():
            cum[cid] += v
        top = sorted(cum.items(), key=lambda kv: -kv[1])[:top_n]
        ever_top.update(c for c, _ in top)
        frames.append({"month": m, "top": [{"channel_id": c, "value": v} for c, v in top]})
    return {"metric": f.metric, "frames": frames, "channels": _channel_names(conn, sorted(ever_top))}


def new_discoveries(conn, r: Range, f: Filters, limit: int = 30) -> list[dict]:
    """Channels first watched (ever) inside the range, ranked by how much you watched them there."""
    w_sql, p = where(r, f)
    rows = conn.execute(f"""
        WITH firsts AS (SELECT channel_id, MIN(local_date) AS first FROM watches
                        WHERE channel_id IS NOT NULL GROUP BY channel_id)
        SELECT w.channel_id, fi.first, COUNT(*) n, SUM({time_expr(f)}) t FROM watches w
        JOIN firsts fi ON fi.channel_id = w.channel_id
        WHERE {w_sql} AND fi.first BETWEEN ? AND ?
        GROUP BY w.channel_id ORDER BY {'t' if f.metric == 'time' else 'n'} DESC LIMIT ?""",
                        [*p, *r.params(), limit]).fetchall()
    names = _channel_names(conn, [r_[0] for r_ in rows])
    return [{"channel_id": cid, "first_watched": first, "count": n, "time_s": t or 0, **names.get(cid, {})}
            for cid, first, n, t in rows]


def loyalty(conn, f: Filters, min_per_year: int = 3, limit: int = 30) -> list[dict]:
    """Channels watched (at least `min_per_year` times) in the most distinct years."""
    w_sql, p = where(EVER, f)
    rows = conn.execute(f"""
        SELECT channel_id, COUNT(*) AS years, SUM(n) AS total, MIN(year), MAX(year),
               GROUP_CONCAT(year) FROM (
            SELECT w.channel_id, w.year, COUNT(*) n FROM watches w
            WHERE {w_sql} AND w.channel_id IS NOT NULL GROUP BY 1, 2 HAVING n >= ?)
        GROUP BY channel_id ORDER BY years DESC, total DESC LIMIT ?""", [*p, min_per_year, limit]).fetchall()
    names = _channel_names(conn, [r_[0] for r_ in rows])
    return [{"channel_id": cid, "years": y, "count": total, "first_year": fy, "last_year": ly,
             "year_list": sorted(int(x) for x in yl.split(",")), **names.get(cid, {})}
            for cid, y, total, fy, ly, yl in rows]


def fell_off(conn, f: Filters, asof: date | None = None, recent_days: int = 365,
             min_before: int = 30, limit: int = 30) -> list[dict]:
    """Channels you watched a lot before the last `recent_days` and (almost) not since."""
    w_sql, p = where(EVER, f)
    if asof is None:
        last = conn.execute("SELECT MAX(local_date) FROM watches").fetchone()[0]
        asof = date.fromisoformat(last) if last else date.today()
    cutoff = (asof - timedelta(days=recent_days)).isoformat()
    rows = conn.execute(f"""
        SELECT w.channel_id, SUM(w.local_date < ?) AS before, SUM(w.local_date >= ?) AS recent,
               MAX(w.local_date) AS last, MIN(w.local_date) AS first,
               (SELECT year FROM watches w2 WHERE w2.channel_id = w.channel_id
                GROUP BY year ORDER BY COUNT(*) DESC LIMIT 1) AS peak_year
        FROM watches w WHERE {w_sql} AND w.channel_id IS NOT NULL GROUP BY 1
        HAVING before >= ? AND recent <= MAX(2, before * 0.05)
        ORDER BY before DESC LIMIT ?""", [cutoff, cutoff, *p, min_before, limit]).fetchall()
    names = _channel_names(conn, [r_[0] for r_ in rows])
    return [{"channel_id": cid, "count_before": b, "count_recent": rc, "last_watched": last,
             "first_watched": first, "peak_year": peak, **names.get(cid, {})}
            for cid, b, rc, last, first, peak in rows]


def mix_by_year(conn, f: Filters, kind: str = "category", top: int = 8) -> dict:
    """Share of each category (or genre) per year; smaller ones are folded into 'Other'."""
    w_sql, p = where(EVER, f)
    if kind == "category":
        q = (f"SELECT w.year, COALESCE(c.title, 'Unknown'), COUNT(*), SUM({time_expr(f)}) FROM watches w "
             f"LEFT JOIN categories c ON c.category_id = w.category_id WHERE {w_sql} GROUP BY 1, 2")
    elif kind == "genre":
        q = (f"SELECT w.year, t.topic, COUNT(*), SUM({time_expr(f)}) FROM watches w "
             f"JOIN video_topics t ON t.video_id = w.video_id WHERE {w_sql} GROUP BY 1, 2")
    else:
        raise ValueError("kind must be category or genre")
    data = defaultdict(dict)
    totals = defaultdict(float)
    for year, name, n, t in conn.execute(q, p):
        v = (t or 0) if f.metric == "time" else n
        data[year][name] = v
        totals[name] += v
    keep = [n for n, _ in sorted(totals.items(), key=lambda kv: -kv[1]) if n != "Unknown"][:top]
    years = sorted(data)
    series = {name: [data[y].get(name, 0) for y in years] for name in keep}
    series["Other"] = [sum(v for k, v in data[y].items() if k not in keep) for y in years]
    return {"kind": kind, "metric": f.metric, "years": years, "series": series}
