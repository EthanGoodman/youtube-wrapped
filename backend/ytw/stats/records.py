"""Records and fun stats."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from .common import Filters, Range, time_expr, where
from .overview import watch_info

MILESTONES = (1, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 75000, 100000, 150000, 200000)


# ------------------------------------------------------------------ pure streak math

def longest_streak(days: list[date]) -> dict | None:
    """Longest run of consecutive days. `days` must be sorted and unique."""
    if not days:
        return None
    best_len, best_start = 1, days[0]
    cur_len, cur_start = 1, days[0]
    for prev, d in zip(days, days[1:]):
        if d - prev == timedelta(days=1):
            cur_len += 1
        else:
            cur_len, cur_start = 1, d
        if cur_len > best_len:
            best_len, best_start = cur_len, cur_start
    return {"days": best_len, "start": best_start.isoformat(),
            "end": (best_start + timedelta(days=best_len - 1)).isoformat()}


def current_streak(days: list[date], asof: date) -> dict:
    """Streak still alive on `asof`: its last day must be asof or the day before
    (today isn't over yet, so not having watched today doesn't break it)."""
    days = [d for d in days if d <= asof]
    if not days or (asof - days[-1]).days > 1:
        return {"days": 0, "start": None, "end": None}
    i = len(days) - 1
    while i > 0 and days[i] - days[i - 1] == timedelta(days=1):
        i -= 1
    return {"days": len(days) - i, "start": days[i].isoformat(), "end": days[-1].isoformat()}


def longest_break(days: list[date]) -> dict | None:
    """Longest run of days with no watching, between two active days."""
    best = None
    for prev, d in zip(days, days[1:]):
        gap = (d - prev).days - 1
        if gap > 0 and (best is None or gap > best["days"]):
            best = {"days": gap, "start": (prev + timedelta(days=1)).isoformat(),
                    "end": (d - timedelta(days=1)).isoformat()}
    return best


# ------------------------------------------------------------------ queries

def _active_days(conn, r: Range, f: Filters) -> list[date]:
    w_sql, p = where(r, f)
    return [date.fromisoformat(d) for (d,) in conn.execute(
        f"SELECT DISTINCT w.local_date FROM watches w WHERE {w_sql} ORDER BY 1", p)]


def streaks(conn, r: Range, f: Filters, today: date | None = None) -> dict:
    days = _active_days(conn, r, f)
    asof = min(today or date.today(), r.end)
    return {"longest": longest_streak(days), "current": current_streak(days, asof),
            "longest_break": longest_break(days)}


def biggest_days(conn, r: Range, f: Filters) -> dict:
    w_sql, p = where(r, f)
    out = {}
    for key, order in (("by_count", "n"), ("by_time", "t")):
        row = conn.execute(f"SELECT w.local_date, COUNT(*) n, SUM({time_expr(f)}) t FROM watches w "
                           f"WHERE {w_sql} GROUP BY 1 ORDER BY {order} DESC, 1 LIMIT 1", p).fetchone()
        out[key] = {"date": row[0], "count": row[1], "time_s": row[2] or 0} if row else None
    return out


def longest_session(conn, r: Range, f: Filters) -> dict | None:
    """Longest binge: the session with the most estimated time (sessions split by the gap rule)."""
    w_sql, p = where(r, f)
    row = conn.execute(f"""
        SELECT w.session_id, COUNT(*), SUM({time_expr(f)}) t, MIN(w.start_epoch), MAX(w.start_epoch + w.est_s),
               MIN(w.local_iso), MIN(w.entry_id)
        FROM watches w WHERE {w_sql} GROUP BY w.session_id ORDER BY t DESC LIMIT 1""", p).fetchone()
    if not row:
        return None
    sid, n, t, start, end, start_iso, _ = row
    ch = conn.execute(f"""SELECT cr.title, COUNT(*) FROM watches w
        LEFT JOIN creators cr ON cr.creator_id = w.channel_id
        WHERE w.session_id = ? AND {w_sql} GROUP BY w.channel_id ORDER BY 2 DESC LIMIT 1""",
                      [sid, *p]).fetchone()
    return {"session_id": sid, "videos": n, "time_s": t or 0, "span_s": end - start, "start": start_iso,
            "top_channel": ch[0] if ch else None}


def night_owl(conn, r: Range, f: Filters) -> dict:
    """Latest-night watch (latest time between midnight and 5am) and earliest morning (5am-noon)."""
    w_sql, p = where(r, f)
    late = conn.execute(f"SELECT w.entry_id FROM watches w WHERE {w_sql} AND w.local_minute < 300 "
                        f"ORDER BY w.local_minute DESC, w.start_epoch DESC LIMIT 1", p).fetchone()
    early = conn.execute(f"SELECT w.entry_id FROM watches w WHERE {w_sql} AND w.local_minute BETWEEN 300 AND 719 "
                         f"ORDER BY w.local_minute, w.start_epoch DESC LIMIT 1", p).fetchone()
    return {"latest_night": watch_info(conn, late[0]) if late else None,
            "earliest_morning": watch_info(conn, early[0]) if early else None}


def channel_day_record(conn, r: Range, f: Filters) -> dict | None:
    """Most videos from one channel in a single day."""
    w_sql, p = where(r, f)
    row = conn.execute(f"""
        SELECT w.local_date, w.channel_id, COUNT(*) n, SUM({time_expr(f)}) FROM watches w
        WHERE {w_sql} AND w.channel_id IS NOT NULL GROUP BY 1, 2 ORDER BY n DESC, 1 LIMIT 1""", p).fetchone()
    if not row:
        return None
    found = conn.execute("SELECT title FROM creators WHERE creator_id = ?", (row[1],)).fetchone()
    title = found[0] if found else None
    return {"date": row[0], "channel_id": row[1], "channel": title, "count": row[2], "time_s": row[3] or 0}


def milestones(conn, f: Filters) -> list[dict]:
    """Your 1st, 100th, 1,000th ... watch (all-time, ignoring the range)."""
    w_sql, p = where(Range(date(1970, 1, 1), date(9999, 12, 31)), f)
    total = conn.execute(f"SELECT COUNT(*) FROM watches w WHERE {w_sql}", p).fetchone()[0]
    out = []
    for n in MILESTONES:
        if n > total:
            break
        eid = conn.execute(f"SELECT w.entry_id FROM watches w WHERE {w_sql} ORDER BY w.start_epoch, w.entry_id "
                           f"LIMIT 1 OFFSET ?", [*p, n - 1]).fetchone()[0]
        out.append({"n": n, **watch_info(conn, eid)})
    return out


def video_age(conn, r: Range, f: Filters) -> dict:
    """Oldest video watched (by upload date) and 'early bird' watches within an hour of upload."""
    w_sql, p = where(r, f)
    oldest = conn.execute(f"SELECT w.entry_id, w.published_epoch FROM watches w WHERE {w_sql} "
                          f"AND w.published_epoch IS NOT NULL ORDER BY w.published_epoch LIMIT 1", p).fetchone()
    early = f"FROM watches w WHERE {w_sql} AND w.start_epoch - w.published_epoch BETWEEN 0 AND 3600"
    n = conn.execute(f"SELECT COUNT(*) {early}", p).fetchone()[0]
    fastest = conn.execute(f"SELECT w.entry_id, w.start_epoch - w.published_epoch d {early} "
                           f"ORDER BY d LIMIT 1", p).fetchone()
    return {
        "oldest": {**watch_info(conn, oldest[0]),
                   "published_at": datetime.fromtimestamp(oldest[1], timezone.utc).isoformat()} if oldest else None,
        "early_bird_count": n,
        "fastest": {**watch_info(conn, fastest[0]), "seconds_after_upload": round(fastest[1])} if fastest else None,
    }


def odd_counts(conn, r: Range) -> dict:
    """Things that aren't watches: ads, unavailable videos, surveys (from raw entries).
    Only YouTube logs these; other platforms have no `entries` table and get zeros."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'entries'").fetchone():
        return {"ads": 0, "ad_impressions": 0, "ad_clicks": 0, "unavailable": 0, "surveys": 0, "posts": 0}
    counts = dict(conn.execute("SELECT kind, COUNT(*) FROM entries WHERE local_date BETWEEN ? AND ? "
                               "GROUP BY kind", r.params()).fetchall())
    return {"ads": counts.get("ad", 0), "ad_impressions": counts.get("ad_impression", 0),
            "ad_clicks": counts.get("ad_click", 0), "unavailable": counts.get("unavailable", 0),
            "surveys": counts.get("survey", 0), "posts": counts.get("post", 0)}


def records(conn, r: Range, f: Filters, today: date | None = None) -> dict:
    return {
        "biggest_day": biggest_days(conn, r, f),
        "longest_session": longest_session(conn, r, f),
        "streaks": streaks(conn, r, f, today),
        **night_owl(conn, r, f),
        "channel_day": channel_day_record(conn, r, f),
        **video_age(conn, r, f),
        "counts": odd_counts(conn, r),
    }
