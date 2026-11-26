"""Everything the Wrapped story needs for one year, in one call, plus the viewer personality."""
from __future__ import annotations

import json
import sqlite3
import tomllib
from datetime import date
from pathlib import Path

from . import db
from .stats import evolution, overview, patterns, records, shows, tops
from .stats.common import Filters, Range, time_expr, where

METRICS = ("night_share", "early_share", "weekend_share", "shorts_share", "music_share", "gaming_share",
           "background_share", "top5_share", "explorer_ratio", "avg_session_min")
NETFLIX_METRICS = ("binge_day_share", "finish_rate", "drop_rate", "top_show_share", "anime_share", "movie_share",
                   "weekend_share", "night_share", "shows_count", "episodes_per_day",
                   # anime (Crunchyroll): audio language, simulcast, and what kind of anime (AniList tags / genres)
                   "dub_share", "sub_share", "simulcast_share", "shounen_share", "isekai_share", "romance_share",
                   "slice_of_life_share", "sports_share", "psychological_share")
# metrics that need real start times (quick Netflix downloads put every view at midnight)
TIME_METRICS = frozenset({"night_share", "early_share"})


def personalities_file(root: Path, platform: str) -> Path:
    """personalities.toml for YouTube, personalities-<platform>.toml for the others."""
    return root / ("personalities.toml" if platform == "youtube" else f"personalities-{platform}.toml")


def load_personalities(path: Path, metrics: tuple[str, ...] = METRICS) -> dict:
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    for p in cfg.get("personality", []):
        if p.get("metric") not in metrics:
            raise ValueError(f"personality {p.get('id')}: unknown metric {p.get('metric')!r}")
        if not p.get("threshold"):
            raise ValueError(f"personality {p.get('id')}: threshold must be > 0")
    return cfg


# Wrapped modes -> which content types they cover
MODES = {"all": ("long", "short", "music", "unknown"), "videos": ("long", "music"), "shorts": ("short",)}


def personality_metrics(conn: sqlite3.Connection, r: Range, f: Filters) -> dict[str, float]:
    w_sql, p = where(r, f)
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


def pick_personality(metrics: dict[str, float], cfg: dict, skip_metrics: frozenset[str] = frozenset()) -> dict:
    """Highest value/threshold wins if it reaches 1; otherwise the fallback.
    Personalities whose metric is in skip_metrics are left out (e.g. shorts_share in Shorts-only mode)."""
    scored = []
    for p in cfg.get("personality", []):
        if p["metric"] in skip_metrics:
            continue
        value = metrics.get(p["metric"], 0.0)
        scored.append((value / p["threshold"], value, p))
    scored.sort(key=lambda s: -s[0])
    runner_ups = [{"id": p["id"], "name": p["name"], "emoji": p.get("emoji", ""), "score": round(s, 2)}
                  for s, _, p in scored[1:4] if s >= 1]
    if scored and scored[0][0] >= 1:
        score, value, p = scored[0]
        reason = p.get("reason", "").format(
            pct=f"{value * 100:.0f}%", value=f"{value:.0f}", value1=f"{value:.1f}",
            inverse=f"{1 / value:.0f}" if value else "∞")
        return {**_public(p), "reason": reason, "metric": p["metric"], "value": value, "score": round(score, 2),
                "also": runner_ups}
    fb = cfg.get("fallback", {"id": "all_rounder", "name": "The All-Rounder", "emoji": "⭐"})
    return {**_public(fb), "reason": fb.get("reason", ""), "metric": None, "value": None, "score": None, "also": []}


def _public(p: dict) -> dict:
    return {k: p.get(k) for k in ("id", "name", "emoji", "color", "tagline")}


def wrapped(conn: sqlite3.Connection, year: int, f: Filters, personalities: dict,
            today: date | None = None, mode: str = "all") -> dict:
    """mode: all | videos (long-form + music) | shorts. Every card uses only that content.
    In "all", channel/video rankings still use long-form only (a pile of 20-second Shorts
    shouldn't outrank what you sat down to watch) and Shorts get their own card."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {', '.join(MODES)}")
    r = Range(date(year, 1, 1), date(year, 12, 31), str(year))
    base = Filters(buckets=MODES[mode], exclude_bg_time=f.exclude_bg_time, metric=f.metric)
    ov = overview.overview(conn, r, base)
    if not ov["videos"]:
        return {"year": year, "mode": mode, "empty": True}
    rank_f = Filters(buckets=MODES["videos"], exclude_bg_time=f.exclude_bg_time, metric=f.metric) if mode == "all" else base
    by_time = Filters(buckets=rank_f.buckets, exclude_bg_time=f.exclude_bg_time, metric="time")
    shorts_f = Filters(buckets=MODES["shorts"], exclude_bg_time=f.exclude_bg_time, metric="count")
    rec = records.records(conn, r, base, today)
    clock = patterns.clock(conn, r, base)
    metrics = personality_metrics(conn, r, base)
    top_channels_time = tops.top_channels(conn, r, by_time, 1)
    discoveries = evolution.new_discoveries(conn, r, base, 3)
    return {
        "year": year,
        "mode": mode,
        "empty": False,
        "overview": {k: ov[k] for k in ("videos", "unique_videos", "unique_channels", "est_s", "max_s",
                                        "active_days", "days", "pct_days_active", "split", "change")},
        "top_channels": tops.top_channels(conn, r, rank_f, 5),
        "top_channel_by_time": top_channels_time[0] if top_channels_time else None,
        "top_shorts_channels": tops.top_channels(conn, r, shorts_f, 5) if mode == "all" else [],
        "top_videos": tops.top_videos(conn, r, rank_f, 5),
        "top_categories": tops.top_categories(conn, r, base, 3),
        "top_genres": tops.top_genres(conn, r, base, 3),
        "clock": clock,
        "peak_hour": max(clock, key=lambda h: h["count"])["hour"],
        "biggest_day": rec["biggest_day"]["by_count"],
        "longest_session": rec["longest_session"],
        "streak": rec["streaks"]["longest"],
        "latest_night": rec["latest_night"],
        "discovery": discoveries[0] if discoveries else None,
        "metrics": metrics,
        "personality": pick_personality(metrics, personalities,
                                        frozenset() if mode == "all" else frozenset({"shorts_share"})),
    }


# ------------------------------------------------------------------ Netflix

UNKNOWN_SHOW = shows.UNKNOWN


def netflix_metrics(conn: sqlite3.Connection, r: Range, f: Filters, progress: dict) -> dict[str, float]:
    """Personality metrics for a Netflix year (see personalities-netflix.toml)."""
    w_sql, p = where(r, f)
    n, episodes, movies, weekend, night, days = (x or 0 for x in conn.execute(
        f"SELECT COUNT(*), SUM(w.kind = 'episode'), SUM(w.kind = 'movie'), SUM(w.local_dow >= 5), "
        f"SUM(w.local_hour < 5), COUNT(DISTINCT w.local_date) FROM watches w WHERE {w_sql}", p).fetchone())
    if not n:
        return {m: 0.0 for m in NETFLIX_METRICS}
    binge_days = conn.execute(f"""SELECT COUNT(DISTINCT d) FROM (SELECT w.local_date d FROM watches w
        WHERE {w_sql} AND w.kind = 'episode' AND w.channel_id != '{UNKNOWN_SHOW}'
        GROUP BY w.local_date, w.channel_id HAVING COUNT(*) >= 5)""", p).fetchone()[0]
    top_show = conn.execute(f"""SELECT COALESCE(MAX(c), 0) FROM (SELECT COUNT(*) c FROM watches w
        WHERE {w_sql} AND w.kind = 'episode' AND w.channel_id != '{UNKNOWN_SHOW}' GROUP BY w.channel_id)""", p).fetchone()[0]
    named_eps = conn.execute(f"SELECT COUNT(*) FROM watches w WHERE {w_sql} AND w.kind = 'episode' "
                             f"AND w.channel_id != '{UNKNOWN_SHOW}'", p).fetchone()[0]
    anime = conn.execute(f"""SELECT COUNT(*) FROM watches w JOIN creators c ON c.creator_id = w.channel_id
        WHERE {w_sql} AND c.country = 'JP' AND EXISTS (SELECT 1 FROM item_genres g
              WHERE g.item_id = w.video_id AND g.genre = 'Animation')""", p).fetchone()[0]
    summary = progress["summary"]
    started = sum(summary.values())
    return {
        "binge_day_share": binge_days / days if days else 0.0,
        "finish_rate": summary["finished"] / started if started else 0.0,
        "drop_rate": summary["dropped"] / started if started else 0.0,
        "top_show_share": top_show / named_eps if named_eps else 0.0,
        "anime_share": anime / n,
        "movie_share": movies / n,
        "weekend_share": weekend / n,
        "night_share": night / n,
        "shows_count": float(started),
        "episodes_per_day": episodes / days if days else 0.0,
        **anime_metrics(conn, r, f, n),
    }


def anime_metrics(conn: sqlite3.Connection, r: Range, f: Filters, n: int) -> dict[str, float]:
    """Shares of episodes: dubbed / subbed, watched within a week of airing, and by kind of anime
    (a series counts as "shounen" etc. when AniList tags or genres say so). Zero where unknown."""
    w_sql, p = where(r, f)
    rows = conn.execute(
        f"""SELECT json_extract(i.extra, '$.dubbed'), w.start_epoch, w.published_epoch, c.extra,
                   (SELECT group_concat(g.genre, '|') FROM item_genres g WHERE g.item_id = w.video_id)
            FROM watches w LEFT JOIN items i ON i.item_id = w.video_id
            LEFT JOIN creators c ON c.creator_id = w.channel_id WHERE {w_sql}""", p).fetchall()
    known_audio = [d for d, *_ in rows if d is not None]
    kinds = {"shounen_share": ("shounen",), "isekai_share": ("isekai",), "romance_share": ("romance",),
             "slice_of_life_share": ("slice of life", "iyashikei"), "sports_share": ("sports",),
             "psychological_share": ("psychological",)}
    counts = dict.fromkeys(kinds, 0)
    simul = 0
    for dubbed, start, aired, extra, genres in rows:
        if start and aired and 0 <= start - aired <= 7 * 86400:
            simul += 1
        e = json.loads(extra or "{}")
        words = {t.lower() for t in (e.get("tags") or []) + (e.get("topics") or [])} | {g.lower() for g in (genres or "").split("|") if g}
        for k, names in kinds.items():
            counts[k] += any(w in words for w in names)
    return {
        "dub_share": sum(1 for d in known_audio if d) / len(known_audio) if known_audio else 0.0,
        "sub_share": sum(1 for d in known_audio if not d) / len(known_audio) if known_audio else 0.0,
        "simulcast_share": simul / n if n else 0.0,
        **{k: v / n if n else 0.0 for k, v in counts.items()},
    }


def netflix_wrapped(conn: sqlite3.Connection, year: int, f: Filters, personalities: dict,
                    today: date | None = None, has_times: bool = False, anime: bool = False) -> dict:
    """The shows Wrapped story (Netflix, Crunchyroll): shows instead of channels, posters instead of avatars.
    With `anime`, adds sub vs dub, simulcast and top studio."""
    r = Range(date(year, 1, 1), date(year, 12, 31), str(year))
    base = Filters(exclude_bg_time=f.exclude_bg_time, metric=f.metric)
    ov = overview.overview(conn, r, base)
    if not ov["videos"]:
        return {"platform": "netflix", "year": year, "mode": "all", "empty": True}
    by_time = Filters(exclude_bg_time=f.exclude_bg_time, metric="time")
    rec = records.records(conn, r, base, today)
    prog = shows.progress(conn, r, base, 500)
    finished = [s for s in prog["shows"] if s["status"] == "finished"]
    top_time = tops.top_channels(conn, r, by_time, 1)
    discoveries = [d for d in evolution.new_discoveries(conn, r, base, 4) if d["channel_id"] != UNKNOWN_SHOW]
    clock = patterns.clock(conn, r, base) if has_times else []
    metrics = netflix_metrics(conn, r, base, prog)
    return {
        "platform": "netflix",
        "year": year,
        "mode": "all",
        "empty": False,
        "has_times": has_times,
        "overview": {k: ov[k] for k in ("videos", "unique_videos", "unique_channels", "est_s", "max_s",
                                        "active_days", "days", "pct_days_active", "split", "change")},
        "top_channels": tops.top_channels(conn, r, base, 5),
        "top_channel_by_time": top_time[0] if top_time else None,
        "top_movies": shows.top_movies(conn, r, base, 5),
        "top_genres": tops.top_genres(conn, r, base, 5),
        "kind_split": shows.split(conn, r, base),
        "progress": {"summary": prog["summary"], "finished": finished[:8], "shows": len(prog["shows"])},
        "binge": (shows.binges(conn, r, base, 1) or [None])[0],
        "episode_day": (shows.episode_days(conn, r, base, 1) or [None])[0],
        "biggest_day": rec["biggest_day"]["by_count"],
        "streak": rec["streaks"]["longest"],
        "discovery": discoveries[0] if discoveries else None,
        "clock": clock,
        "peak_hour": max(clock, key=lambda h: h["count"])["hour"] if clock else None,
        "metrics": metrics,
        "personality": pick_personality(metrics, personalities, frozenset() if has_times else TIME_METRICS),
        "anime": _anime_card(conn, r, base) if anime else None,
    }


def _anime_card(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    a = shows.anime_page(conn, r, f)
    return {"sub": a["sub_dub"]["sub"], "dub": a["sub_dub"]["dub"], "simulcast": a["simulcast"]["episodes"],
            "simulcast_series": [{k: s[k] for k in ("key", "title", "poster")} for s in a["simulcast"]["series"][:3]],
            "studio": ({k: a["studios"][0][k] for k in ("name", "count")} | {"series": a["studios"][0]["series"][:4]})
                      if a["studios"] else None,
            "season": ({"season": a["seasons"][0]["season"], "series": a["seasons"][0]["series"][:4]}
                       if a["seasons"] else None),
            "score": a["scores"]["average"]}


# ------------------------------------------------------------------ music (Spotify, …)

MUSIC_METRICS = ("night_share", "early_share", "weekend_share", "top_artist_share", "top5_share", "explorer_ratio",
                 "repeat_share", "new_artist_share", "avg_session_min", "minutes_per_day")


def music_metrics(conn: sqlite3.Connection, r: Range, f: Filters) -> dict[str, float]:
    """Listening habits for the music personalities (all for the year; shares are 0..1)."""
    w_sql, p = where(r, f)
    n, night, early, weekend, est, chans, days = (x or 0 for x in conn.execute(f"""
        SELECT COUNT(*), SUM(w.local_hour < 5), SUM(w.local_hour BETWEEN 5 AND 8), SUM(w.local_dow >= 5), SUM(w.est_s),
               COUNT(DISTINCT w.channel_id), COUNT(DISTINCT w.local_date) FROM watches w WHERE {w_sql}""", p).fetchone())
    if not n:
        return {m: 0.0 for m in MUSIC_METRICS}
    per_artist = [c for (c,) in conn.execute(f"SELECT COUNT(*) c FROM watches w WHERE {w_sql} GROUP BY w.channel_id "
                                             "ORDER BY c DESC, w.channel_id LIMIT 5", p)]
    # the same song 3+ times in a day: the repeat button
    repeats = conn.execute(f"""SELECT COALESCE(SUM(c), 0) FROM (SELECT COUNT(*) c FROM watches w WHERE {w_sql}
        GROUP BY w.local_date, w.video_id HAVING c >= 3)""", p).fetchone()[0]
    # streams of artists you first heard this year
    new = conn.execute(f"""SELECT COUNT(*) FROM watches w WHERE {w_sql} AND w.channel_id IN (
        SELECT channel_id FROM watches GROUP BY channel_id HAVING MIN(local_date) >= ?)""", [*p, r.start.isoformat()]).fetchone()[0]
    sess = conn.execute(f"SELECT AVG(t) FROM (SELECT SUM({time_expr(f)}) t FROM watches w WHERE {w_sql} GROUP BY w.session_id)",
                        p).fetchone()[0] or 0
    return {
        "night_share": night / n, "early_share": early / n, "weekend_share": weekend / n,
        "top_artist_share": (per_artist[0] / n) if per_artist else 0.0,
        "top5_share": sum(per_artist) / n,
        "explorer_ratio": chans / n,
        "repeat_share": repeats / n,
        "new_artist_share": new / n,
        "avg_session_min": sess / 60,
        "minutes_per_day": est / 60 / days if days else 0.0,
    }


def music_wrapped(conn: sqlite3.Connection, year: int, f: Filters, personalities: dict, today: date | None = None) -> dict:
    """The music Wrapped story: minutes, top artists / songs / album, genres, clock, on repeat, a new artist."""
    from .stats import music
    r = Range(date(year, 1, 1), date(year, 12, 31), str(year))
    base = Filters(exclude_bg_time=f.exclude_bg_time, metric="count")
    by_time = Filters(exclude_bg_time=f.exclude_bg_time, metric="time")
    ov = overview.overview(conn, r, base)
    if not ov["videos"]:
        return {"platform": "music", "kind": "music", "year": year, "mode": "all", "empty": True}
    rec = records.records(conn, r, base, today)
    clock = patterns.clock(conn, r, base)
    discoveries = evolution.new_discoveries(conn, r, by_time, 1)
    metrics = music_metrics(conn, r, base)
    return {
        "kind": "music",
        "year": year,
        "mode": "all",
        "empty": False,
        "overview": {k: ov[k] for k in ("videos", "unique_videos", "unique_channels", "est_s", "active_days", "days", "change")},
        "top_artists": tops.top_channels(conn, r, by_time, 5),
        "top_tracks": tops.top_videos(conn, r, base, 5),
        "top_albums": music.top_albums(conn, r, by_time, 3),
        "top_genres": tops.top_genres(conn, r, by_time, 5),
        "clock": clock,
        "peak_hour": max(clock, key=lambda h: h["count"])["hour"],
        "biggest_day": rec["biggest_day"]["by_count"],
        "streak": rec["streaks"]["longest"],
        "on_repeat": music.records(conn, r, base)["on_repeat"],
        "discovery": discoveries[0] if discoveries else None,
        "metrics": metrics,
        # in the first year of data every artist is new: that personality would always win
        "personality": pick_personality(metrics, personalities,
                                        frozenset({"new_artist_share"}) if year <= _first_year(conn) else frozenset()),
    }


def _first_year(conn: sqlite3.Connection) -> int:
    first = conn.execute("SELECT MIN(year) FROM watches").fetchone()[0]
    return int(first) if first else 0


# ------------------------------------------------------------------ games (Steam, …)

GAMES_METRICS = ("top_game_share", "games_count", "new_game_share", "achievements", "rare_achievements",
                 "weekend_share", "night_share", "active_days")


def games_metrics(y: dict) -> dict[str, float]:
    """Playing habits for the games personalities, from the year's achievement unlocks (real, timestamped moments
    of play; hours aren't known by day before tracking). Shares are 0..1."""
    n = y["unlocks"]
    if not n:
        return {m: 0.0 for m in GAMES_METRICS}
    times, counts = y["unlock_times"], y["counts"]
    return {
        "top_game_share": max(counts.values()) / n, "games_count": float(len(counts)),
        "new_game_share": sum(counts[k] for k in y["new"]) / n, "achievements": float(n),
        "rare_achievements": float(sum(1 for p in y["rarities"] if p is not None and p < 10)),
        "weekend_share": sum(1 for t in times if t.weekday() >= 5) / n, "night_share": sum(1 for t in times if t.hour < 5) / n,
        "active_days": float(y["active_days"]),
    }


def games_wrapped(conn: sqlite3.Connection, year: int, f: Filters, personalities: dict, tz, today: date | None = None) -> dict:
    """The games Wrapped story, all of it real: the year's achievement unlocks (how active, which games, the new
    ones, the rarest, the 100%s, the latest night) and, for days the app tracked, hours played."""
    from .stats import games
    r = Range(date(year, 1, 1), date(year, 12, 31), str(year))
    y = games.wrapped_year(conn, r, tz)
    if not y["unlocks"] and not y["tracked"]:
        return {"kind": "games", "year": year, "mode": "all", "empty": True}
    metrics = games_metrics(y)
    first = min((int(v) for v in (db.get_meta(conn, "activity_years") or "").split(",") if v.isdigit()), default=year)
    story = {k: v for k, v in y.items() if k not in ("counts", "new", "unlock_times", "rarities")}
    return {
        "kind": "games",
        "year": year,
        "mode": "all",
        "empty": False,
        "tracked_since": db.get_meta(conn, "tracked_since"),
        **story,
        "metrics": metrics,
        "personality": pick_personality(metrics, personalities, frozenset({"new_game_share"}) if year <= first else frozenset()),
    }

