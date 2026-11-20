"""Stats for platforms with episodic shows (Netflix): show progress, binges, rewatches, episodes vs movies.

Episodes are matched to TMDB's episode list (`tmdb_episodes`, filled by `enrich`) through the
season/episode numbers kept in items.extra. Without TMDB data, progress falls back to the
show's episode count and season binges can't be worked out.
"""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import date, timedelta

from .common import Filters, Range, data_bounds, ranked, time_expr, where
from .tops import _VIDEO_INFO, _attach

UNKNOWN = "show:unknown-show"  # episodes Netflix listed without a show name (see parser.UNKNOWN_SHOW)
WATCHING_DAYS = 30      # a show watched within this many days of the period's end is "watching", not "dropped"
MIN_BINGE_EPISODES = 3  # shorter seasons don't count as binges
REWATCH_GAP_DAYS = 7    # two viewings this far apart are a rewatch (not finishing an episode the next day)


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _asof(conn: sqlite3.Connection, r: Range) -> date:
    bounds = data_bounds(conn)
    return min(r.end, bounds[1]) if bounds else r.end


def _aired(conn: sqlite3.Connection, show_ids: list[int], asof: date) -> dict[int, list[tuple[int, int]]]:
    """TMDB episodes per show that had aired by `asof` (specials / season 0 left out)."""
    if not show_ids or not _has_table(conn, "tmdb_episodes"):
        return {}
    out: dict[int, list[tuple[int, int]]] = defaultdict(list)
    ph = ",".join("?" * len(show_ids))
    for sid, s, n in conn.execute(
            f"SELECT show_id, season, number FROM tmdb_episodes WHERE show_id IN ({ph}) AND season > 0 "
            f"AND (air_date IS NULL OR air_date = '' OR air_date <= ?) ORDER BY season, number",
            [*show_ids, asof.isoformat()]):
        out[sid].append((s, n))
    return out


def _first_watches(conn: sqlite3.Connection, show_keys: list[str], until: date) -> dict[str, dict]:
    """Per show: each episode's first watch date up to `until`, keyed by (season, number) when
    TMDB matched it, plus the count of distinct episodes overall (matched or not)."""
    out: dict[str, dict] = {k: {"eps": {}, "distinct": 0} for k in show_keys}
    if not show_keys:
        return out
    ph = ",".join("?" * len(show_keys))
    for key, item, s, n, first in conn.execute(
            f"SELECT w.channel_id, w.video_id, json_extract(i.extra, '$.season_number'), "
            f"json_extract(i.extra, '$.episode_number'), MIN(w.local_date) "
            f"FROM watches w LEFT JOIN items i ON i.item_id = w.video_id "
            f"WHERE w.channel_id IN ({ph}) AND w.kind = 'episode' AND w.local_date <= ? "
            f"GROUP BY w.channel_id, w.video_id", [*show_keys, until.isoformat()]):
        out[key]["distinct"] += 1
        if s is not None and n is not None:
            out[key]["eps"][(int(s), int(n))] = first
    return out


def _show_info(conn: sqlite3.Connection, keys: list[str]) -> dict[str, sqlite3.Row]:
    if not keys:
        return {}
    ph = ",".join("?" * len(keys))
    return {r["creator_id"]: r for r in conn.execute(
        f"SELECT creator_id, title, avatar_url, item_count, json_extract(extra, '$.tmdb_id') AS tmdb_id "
        f"FROM creators WHERE creator_id IN ({ph})", keys)}


def progress(conn: sqlite3.Connection, r: Range, f: Filters, limit: int = 50) -> dict:
    """How far you got into each show you watched in the period, and whether you finished,
    are still watching, or dropped it. Episodes count all your history up to the period's end."""
    w_sql, p = where(r, f)
    rows = conn.execute(
        f"SELECT w.channel_id AS k, COUNT(*) AS cnt, SUM({time_expr(f)}) AS time_s, MAX(w.local_date) AS last "
        f"FROM watches w WHERE {w_sql} AND w.kind = 'episode' AND w.channel_id IS NOT NULL "
        f"AND w.channel_id != '{UNKNOWN}' GROUP BY w.channel_id ORDER BY {'time_s' if f.metric == 'time' else 'cnt'} DESC, k", p).fetchall()
    asof = _asof(conn, r)
    keys = [row["k"] for row in rows]
    info = _show_info(conn, keys)
    aired = _aired(conn, [int(i["tmdb_id"]) for i in info.values() if i["tmdb_id"]], asof)
    seen = _first_watches(conn, keys, r.end)
    shows, summary = [], {"finished": 0, "watching": 0, "dropped": 0}
    for row in rows:
        k, meta = row["k"], info.get(row["k"])
        eps = aired.get(int(meta["tmdb_id"])) if meta and meta["tmdb_id"] else None
        watched_eps = seen[k]["eps"]
        if eps:
            aired_set = set(eps)
            # episodes TMDB couldn't line up still count toward progress
            watched = min(len(eps), max(len(aired_set & watched_eps.keys()), seen[k]["distinct"]))
            total = len(eps)
            finale = eps[-1] in watched_eps
            per_season: dict[int, list[int]] = defaultdict(lambda: [0, 0])
            for s, n in eps:
                per_season[s][1] += 1
                per_season[s][0] += (s, n) in watched_eps
            seasons_total = len(per_season)
            seasons_done = sum(1 for w, t in per_season.values() if w == t)
        else:
            watched = seen[k]["distinct"]
            total = meta["item_count"] if meta and meta["item_count"] else None
            finale = bool(total and watched >= total)
            seasons_total = seasons_done = None
        if total and (finale and watched >= total * 0.8 or watched >= total):
            status = "finished"
        elif date.fromisoformat(row["last"]) >= asof - timedelta(days=WATCHING_DAYS):
            status = "watching"
        else:
            status = "dropped"
        summary[status] += 1
        shows.append({
            "key": k, "title": meta["title"] if meta else k, "avatar_url": meta["avatar_url"] if meta else None,
            "count": row["cnt"], "time_s": row["time_s"] or 0, "last_watched": row["last"],
            "watched": watched, "total": total, "pct": min(1.0, watched / total) if total else None,
            "seasons_total": seasons_total, "seasons_finished": seasons_done, "status": status,
        })
    return {"summary": summary, "shows": shows[:limit]}


def binges(conn: sqlite3.Connection, r: Range, f: Filters, limit: int = 10) -> list[dict]:
    """Seasons you finished, fastest first (finished = every aired episode watched, last one in the period)."""
    w_sql, p = where(r, f)
    keys = [k for (k,) in conn.execute(
        f"SELECT DISTINCT w.channel_id FROM watches w WHERE {w_sql} AND w.kind = 'episode' "
        f"AND w.channel_id IS NOT NULL AND w.channel_id != '{UNKNOWN}'", p)]
    info = _show_info(conn, keys)
    aired = _aired(conn, [int(i["tmdb_id"]) for i in info.values() if i["tmdb_id"]], _asof(conn, r))
    seen = _first_watches(conn, keys, r.end)
    out = []
    for k in keys:
        meta = info.get(k)
        eps = aired.get(int(meta["tmdb_id"])) if meta and meta["tmdb_id"] else None
        if not eps:
            continue
        seasons: dict[int, list[tuple[int, int]]] = defaultdict(list)
        for s, n in eps:
            seasons[s].append((s, n))
        for s, season_eps in seasons.items():
            dates = [seen[k]["eps"].get(e) for e in season_eps]
            if len(season_eps) < MIN_BINGE_EPISODES or None in dates:
                continue
            start, end = date.fromisoformat(min(dates)), date.fromisoformat(max(dates))
            if not r.start <= end <= r.end:
                continue
            days = (end - start).days + 1
            out.append({"key": k, "title": meta["title"], "avatar_url": meta["avatar_url"], "season": s,
                        "episodes": len(season_eps), "days": days, "start": start.isoformat(),
                        "end": end.isoformat(), "per_day": len(season_eps) / days})
    out.sort(key=lambda b: (b["days"], -b["episodes"], b["end"]))
    return out[:limit]


def episode_days(conn: sqlite3.Connection, r: Range, f: Filters, limit: int = 5) -> list[dict]:
    """Most episodes of one show in a single day."""
    w_sql, p = where(r, f)
    rows = conn.execute(
        f"SELECT w.local_date AS day, w.channel_id AS k, COUNT(DISTINCT w.video_id) AS episodes, "
        f"SUM({time_expr(f)}) AS time_s FROM watches w "
        f"WHERE {w_sql} AND w.kind = 'episode' AND w.channel_id IS NOT NULL AND w.channel_id != '{UNKNOWN}' "
        f"GROUP BY w.local_date, w.channel_id ORDER BY episodes DESC, time_s DESC, day LIMIT ?",
        [*p, limit]).fetchall()
    info = _show_info(conn, [row["k"] for row in rows])
    return [{"date": row["day"], "key": row["k"], "title": info[row["k"]]["title"] if row["k"] in info else row["k"],
             "avatar_url": info[row["k"]]["avatar_url"] if row["k"] in info else None,
             "episodes": row["episodes"], "time_s": row["time_s"] or 0} for row in rows]


def rewatches(conn: sqlite3.Connection, r: Range, f: Filters, limit: int = 20) -> dict:
    """Titles watched again on days at least a week apart. Netflix's quick download lists each
    title once, so rewatches only show up in the full export (`detectable` says which)."""
    w_sql, p = where(r, f)
    repeats = conn.execute("SELECT 1 FROM watches GROUP BY video_id HAVING COUNT(*) > 1 LIMIT 1").fetchone()
    rows = conn.execute(
        f"SELECT w.video_id AS k, w.local_date AS day FROM watches w WHERE {w_sql} "
        f"AND COALESCE(w.channel_id, '') != '{UNKNOWN}' ORDER BY w.video_id, w.local_date",
        p).fetchall()
    viewings: dict[str, list[date]] = defaultdict(list)
    for row in rows:
        d = date.fromisoformat(row["day"])
        days = viewings[row["k"]]
        if not days or (d - days[-1]).days >= REWATCH_GAP_DAYS:
            days.append(d)
    hits = sorted(((k, ds) for k, ds in viewings.items() if len(ds) > 1), key=lambda x: (-len(x[1]), x[0]))[:limit]
    items = [{"key": k, "times": len(ds), "first": ds[0].isoformat(), "last": ds[-1].isoformat(),
              "count": len(ds), "time_s": 0} for k, ds in hits]
    return {"detectable": repeats is not None or bool(items), "items": _attach(conn, items, _VIDEO_INFO)}


def split(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    """Episodes vs movies: watches, estimated time and distinct titles of each."""
    w_sql, p = where(r, f)
    out = {k: {"count": 0, "est_s": 0, "titles": 0} for k in ("episode", "movie")}
    for kind, cnt, t, titles in conn.execute(
            f"SELECT w.kind, COUNT(*), SUM({time_expr(f)}), COUNT(DISTINCT COALESCE(w.channel_id, w.video_id)) "
            f"FROM watches w WHERE {w_sql} GROUP BY w.kind", p):
        if kind in out:
            out[kind] = {"count": cnt, "est_s": t or 0, "titles": titles}
    return out


def top_movies(conn: sqlite3.Connection, r: Range, f: Filters, limit: int = 50) -> list[dict]:
    items = ranked(conn, "w.video_id", r, f, limit, extra_where="w.kind = 'movie'")
    return _attach(conn, items, _VIDEO_INFO)
