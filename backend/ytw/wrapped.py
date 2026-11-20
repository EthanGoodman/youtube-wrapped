"""Everything the Wrapped story needs for one year, in one call, plus the viewer personality."""
from __future__ import annotations

import sqlite3
import tomllib
from datetime import date
from pathlib import Path

from .stats import evolution, overview, patterns, records, tops
from .stats.common import Filters, Range, time_expr, where

METRICS = ("night_share", "early_share", "weekend_share", "shorts_share", "music_share", "gaming_share",
           "background_share", "top5_share", "explorer_ratio", "avg_session_min")


def load_personalities(path: Path) -> dict:
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    for p in cfg.get("personality", []):
        if p.get("metric") not in METRICS:
            raise ValueError(f"personality {p.get('id')}: unknown metric {p.get('metric')!r}")
        if not p.get("threshold"):
            raise ValueError(f"personality {p.get('id')}: threshold must be > 0")
    return cfg


def personality_metrics(conn: sqlite3.Connection, r: Range, f: Filters) -> dict[str, float]:
    w_sql, p = where(r, Filters(exclude_bg_time=f.exclude_bg_time))  # always all buckets
    row = conn.execute(f"""
        SELECT COUNT(*),
               SUM(w.local_hour < 5), SUM(w.local_hour BETWEEN 5 AND 8), SUM(w.local_dow >= 5),
               SUM(w.bucket = 'short'), SUM(w.bucket = 'music'), SUM(w.category_id = '20'),
               SUM(w.est_s), SUM(CASE WHEN w.is_background = 1 THEN w.est_s ELSE 0 END),
               COUNT(DISTINCT w.channel_id), SUM(w.channel_id IS NOT NULL)
        FROM watches w WHERE {w_sql}""", p).fetchone()
    n, night, early, weekend, shorts, music, gaming, est_all, bg_s, chans, with_chan = (x or 0 for x in row)
    if not n:
        return {m: 0.0 for m in METRICS}
    top5 = conn.execute(f"""SELECT COALESCE(SUM(c), 0) FROM (SELECT COUNT(*) c FROM watches w
        WHERE {w_sql} AND w.channel_id IS NOT NULL GROUP BY w.channel_id ORDER BY c DESC LIMIT 5)""", p).fetchone()[0]
    sess = conn.execute(f"""SELECT AVG(t) FROM (SELECT SUM({time_expr(f)}) t FROM watches w
        WHERE {w_sql} GROUP BY w.session_id)""", p).fetchone()[0] or 0
    return {
        "night_share": night / n,
        "early_share": early / n,
        "weekend_share": weekend / n,
        "shorts_share": shorts / n,
        "music_share": music / n,
        "gaming_share": gaming / n,
        "background_share": bg_s / est_all if est_all else 0.0,
        "top5_share": top5 / with_chan if with_chan else 0.0,
        "explorer_ratio": chans / with_chan if with_chan else 0.0,
        "avg_session_min": sess / 60,
    }


def pick_personality(metrics: dict[str, float], cfg: dict) -> dict:
    """Highest value/threshold wins if it reaches 1; otherwise the fallback."""
    scored = []
    for p in cfg.get("personality", []):
        value = metrics.get(p["metric"], 0.0)
        scored.append((value / p["threshold"], value, p))
    scored.sort(key=lambda s: -s[0])
    runner_ups = [{"id": p["id"], "name": p["name"], "emoji": p.get("emoji", ""), "score": round(s, 2)}
                  for s, _, p in scored[1:4] if s >= 1]
    if scored and scored[0][0] >= 1:
        score, value, p = scored[0]
        reason = p.get("reason", "").format(
            pct=f"{value * 100:.0f}%", value=f"{value:.0f}",
            inverse=f"{1 / value:.0f}" if value else "∞")
        return {**_public(p), "reason": reason, "metric": p["metric"], "value": value, "score": round(score, 2),
                "also": runner_ups}
    fb = cfg.get("fallback", {"id": "all_rounder", "name": "The All-Rounder", "emoji": "⭐"})
    return {**_public(fb), "reason": fb.get("reason", ""), "metric": None, "value": None, "score": None, "also": []}


def _public(p: dict) -> dict:
    return {k: p.get(k) for k in ("id", "name", "emoji", "color", "tagline")}


def wrapped(conn: sqlite3.Connection, year: int, f: Filters, personalities: dict,
            today: date | None = None) -> dict:
    r = Range(date(year, 1, 1), date(year, 12, 31), str(year))
    ov = overview.overview(conn, r, f)
    if not ov["videos"]:
        return {"year": year, "empty": True}
    # Channel and video rankings use long-form (+ music) only, so a pile of 20-second Shorts
    # can't outrank the channels you actually sat down to watch. Shorts get their own list.
    long_f = Filters(buckets=("long", "music"), exclude_bg_time=f.exclude_bg_time, metric=f.metric)
    shorts_f = Filters(buckets=("short",), exclude_bg_time=f.exclude_bg_time, metric="count")
    by_time = Filters(buckets=("long", "music"), exclude_bg_time=f.exclude_bg_time, metric="time")
    rec = records.records(conn, r, f, today)
    clock = patterns.clock(conn, r, f)
    metrics = personality_metrics(conn, r, f)
    top_channels = tops.top_channels(conn, r, long_f, 5)
    top_shorts_channels = tops.top_channels(conn, r, shorts_f, 5)
    top_channels_time = tops.top_channels(conn, r, by_time, 1)
    discoveries = evolution.new_discoveries(conn, r, f, 3)
    return {
        "year": year,
        "empty": False,
        "overview": {k: ov[k] for k in ("videos", "unique_videos", "unique_channels", "est_s", "max_s",
                                        "active_days", "days", "pct_days_active", "split", "change")},
        "top_channels": top_channels,
        "top_channel_by_time": top_channels_time[0] if top_channels_time else None,
        "top_shorts_channels": top_shorts_channels,
        "top_videos": tops.top_videos(conn, r, long_f, 5),
        "top_categories": tops.top_categories(conn, r, f, 3),
        "top_genres": tops.top_genres(conn, r, f, 3),
        "clock": clock,
        "peak_hour": max(clock, key=lambda h: h["count"])["hour"],
        "biggest_day": rec["biggest_day"]["by_count"],
        "longest_session": rec["longest_session"],
        "streak": rec["streaks"]["longest"],
        "latest_night": rec["latest_night"],
        "discovery": discoveries[0] if discoveries else None,
        "metrics": metrics,
        "personality": pick_personality(metrics, personalities),
    }
