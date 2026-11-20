"""Shared pieces for stats: date ranges, filters, ranked lists with rank change."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import date, timedelta

ALL_BUCKETS = ("long", "short", "music")


@dataclass(frozen=True)
class Range:
    """Inclusive local-date range."""
    start: date
    end: date
    label: str = ""

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def previous(self) -> "Range":
        """The equal-length period right before this one."""
        end = self.start - timedelta(days=1)
        return Range(end - timedelta(days=self.days - 1), end, "previous")

    def params(self) -> tuple[str, str]:
        return self.start.isoformat(), self.end.isoformat()

    def to_dict(self) -> dict:
        return {"start": self.start.isoformat(), "end": self.end.isoformat(), "days": self.days,
                "label": self.label}


def data_bounds(conn: sqlite3.Connection) -> tuple[date, date] | None:
    row = conn.execute("SELECT MIN(local_date), MAX(local_date) FROM watches").fetchone()
    if not row or not row[0]:
        return None
    return date.fromisoformat(row[0]), date.fromisoformat(row[1])


def resolve_range(conn: sqlite3.Connection, preset: str = "all", start: str | None = None,
                  end: str | None = None, today: date | None = None) -> Range:
    """Presets: 4w, 6m, this_year, all, custom, or a year like '2021'."""
    today = today or date.today()
    bounds = data_bounds(conn) or (today, today)
    if preset == "4w":
        return Range(today - timedelta(days=27), today, "Last 4 weeks")
    if preset == "6m":
        return Range(today - timedelta(days=182), today, "Last 6 months")
    if preset == "this_year":
        return Range(date(today.year, 1, 1), today, str(today.year))
    if preset.isdigit() and len(preset) == 4:
        y = int(preset)
        return Range(date(y, 1, 1), min(date(y, 12, 31), max(today, bounds[1])), preset)
    if preset == "custom":
        if not start or not end:
            raise ValueError("custom range needs start and end")
        s, e = date.fromisoformat(start), date.fromisoformat(end)
        if e < s:
            s, e = e, s
        return Range(s, e, f"{s} – {e}")
    if preset == "all":
        return Range(bounds[0], bounds[1], "All time")
    raise ValueError(f"unknown range preset: {preset}")


@dataclass(frozen=True)
class Filters:
    buckets: tuple[str, ...] = ALL_BUCKETS  # which of long / short / music to include
    exclude_bg_time: bool = True            # background audio counts as a watch but 0 time
    metric: str = "count"                   # ranking metric: count | time

    def __post_init__(self):
        if self.metric not in ("count", "time"):
            raise ValueError("metric must be count or time")
        if not self.buckets or any(b not in ALL_BUCKETS for b in self.buckets):
            raise ValueError(f"buckets must be a subset of {ALL_BUCKETS}")


def time_expr(f: Filters, alias: str = "w") -> str:
    return (f"(CASE WHEN {alias}.is_background = 1 THEN 0 ELSE {alias}.est_s END)"
            if f.exclude_bg_time else f"{alias}.est_s")


def max_expr(f: Filters, alias: str = "w") -> str:
    return (f"(CASE WHEN {alias}.is_background = 1 THEN 0 ELSE COALESCE({alias}.max_s, 0) END)"
            if f.exclude_bg_time else f"COALESCE({alias}.max_s, 0)")


def where(r: Range, f: Filters, alias: str = "w") -> tuple[str, list]:
    sql = f"{alias}.local_date BETWEEN ? AND ?"
    params: list = list(r.params())
    if set(f.buckets) != set(ALL_BUCKETS):
        sql += f" AND {alias}.bucket IN ({','.join('?' * len(f.buckets))})"
        params += list(f.buckets)
    return sql, params


def ranked(conn: sqlite3.Connection, key_sql: str, r: Range, f: Filters, limit: int = 50,
           joins: str = "", extra_where: str = "", extra_params: tuple = (),
           compare: bool = True, pre_aggregate_by_video: bool = False) -> list[dict]:
    """Rank `key_sql` values by count or estimated time within a range.

    Returns [{key, count, time_s, share, rank, prev_rank, rank_change}], where share is
    the fraction of the range total for the chosen metric and rank_change is positive
    when the item moved up (None if it wasn't ranked in the previous period: "new").
    With pre_aggregate_by_video, watches are first summed per video (much faster when
    `joins` fans out to many rows per video, e.g. tags).
    """
    def run(rng: Range, lim: int | None) -> tuple[list[dict], float]:
        w_sql, params = where(rng, f)
        order = "time_s" if f.metric == "time" else "cnt"
        if pre_aggregate_by_video:
            src = (f"(SELECT w.video_id, COUNT(*) AS n, SUM({time_expr(f)}) AS t FROM watches w "
                   f"WHERE {w_sql} GROUP BY w.video_id) pv {joins}")
            cnt, tsum, where_sql = "SUM(pv.n)", "SUM(pv.t)", "1=1"
        else:
            src = f"watches w {joins}"
            cnt, tsum, where_sql = "COUNT(*)", f"SUM({time_expr(f)})", w_sql
        if extra_where:
            where_sql += f" AND {extra_where}"
        q = (f"SELECT {key_sql} AS k, {cnt} AS cnt, {tsum} AS time_s FROM {src} "
             f"WHERE {where_sql} AND {key_sql} IS NOT NULL GROUP BY k ORDER BY {order} DESC, k "
             + (f"LIMIT {int(lim)}" if lim else ""))
        rows = conn.execute(q, params + list(extra_params)).fetchall()
        # share is relative to the same subset (e.g. within one channel on its detail page)
        if pre_aggregate_by_video or not extra_where:
            tot = conn.execute(f"SELECT COUNT(*), SUM({time_expr(f)}) FROM watches w WHERE {w_sql}",
                               params).fetchone()
        else:
            tot = conn.execute(f"SELECT COUNT(*), SUM({time_expr(f)}) FROM watches w {joins} "
                               f"WHERE {w_sql} AND {extra_where}", params + list(extra_params)).fetchone()
        total = (tot[1] if f.metric == "time" else tot[0]) or 0
        return [{"key": k, "count": c, "time_s": t or 0} for k, c, t in rows], total

    cur, total = run(r, limit)
    prev_rank = {}
    if compare:
        prev, _ = run(r.previous(), max(limit * 4, 200))
        prev_rank = {p["key"]: i + 1 for i, p in enumerate(prev)}
    for i, item in enumerate(cur):
        val = item["time_s"] if f.metric == "time" else item["count"]
        item["share"] = (val / total) if total else 0
        item["rank"] = i + 1
        pr = prev_rank.get(item["key"])
        item["prev_rank"] = pr
        item["rank_change"] = (pr - item["rank"]) if pr else None
    return cur


def pct_change(cur: float | None, prev: float | None) -> float | None:
    if not prev:
        return None
    return (cur or 0) / prev - 1


def rows_to_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]
