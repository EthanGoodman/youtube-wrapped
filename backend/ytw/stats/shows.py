"""Stats for platforms with episodic shows (Netflix): show progress, binges, rewatches, episodes vs movies.

Episodes are matched to each show's full episode list (`catalog_episodes`: TMDB for Netflix,
Crunchyroll's catalog for Crunchyroll, filled at build time after `enrich`) through the
season/episode numbers kept in items.extra. Without TMDB data, progress falls back to the
show's episode count and season binges can't be worked out.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date, timedelta

from .common import Filters, Range, data_bounds, ranked, time_expr, where
from .tops import _VIDEO_INFO, _attach

UNKNOWN = "show:unknown-show"  # episodes Netflix listed without a show name (see parser.UNKNOWN_SHOW)
WATCHING_DAYS = 30      # a show watched within this many days of the period's end is "watching", not "dropped"
MIN_BINGE_EPISODES = 3  # shorter seasons don't count as binges
REWATCH_GAP_DAYS = 7
BINGE_MAX_DAYS = 30     # a show page's "seasons binged" only counts seasons finished within this many days    # two viewings this far apart are a rewatch (not finishing an episode the next day)


def _as_int(v) -> int | None:
    """Season / episode numbers as ints; None for missing or non-numeric ones ("", "SP", 12.5)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else None


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _asof(conn: sqlite3.Connection, r: Range) -> date:
    bounds = data_bounds(conn)
    return min(r.end, bounds[1]) if bounds else r.end


def _aired(conn: sqlite3.Connection, keys: list[str], asof: date) -> dict[str, list[tuple[int, int]]]:
    """Episodes per show that had aired by `asof` (specials / season 0 left out), from the catalog."""
    if not keys or not _has_table(conn, "catalog_episodes"):
        return {}
    out: dict[str, list[tuple[int, int]]] = defaultdict(list)
    ph = ",".join("?" * len(keys))
    for key, s, n in conn.execute(
            f"SELECT creator_id, season, number FROM catalog_episodes WHERE creator_id IN ({ph}) AND season > 0 "
            f"AND (air_date IS NULL OR air_date = '' OR substr(air_date, 1, 10) <= ?) ORDER BY season, number",
            [*keys, asof.isoformat()]):
        out[key].append((s, n))
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
        sn = _as_int(s), _as_int(n)
        if None not in sn:
            out[key]["eps"][sn] = first
    return out


def _show_info(conn: sqlite3.Connection, keys: list[str]) -> dict[str, sqlite3.Row]:
    if not keys:
        return {}
    ph = ",".join("?" * len(keys))
    return {r["creator_id"]: r for r in conn.execute(
        f"SELECT creator_id, title, avatar_url, item_count "
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
    aired = _aired(conn, keys, asof)
    seen = _first_watches(conn, keys, r.end)
    shows, summary = [], {"finished": 0, "watching": 0, "dropped": 0}
    for row in rows:
        k, meta = row["k"], info.get(row["k"])
        eps = aired.get(k)
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
    aired = _aired(conn, keys, _asof(conn, r))
    seen = _first_watches(conn, keys, r.end)
    out = []
    for k in keys:
        meta = info.get(k)
        eps = aired.get(k)
        if not eps or not meta:
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
    items = _attach(conn, ranked(conn, "w.video_id", r, f, limit, extra_where="w.kind = 'movie'"), _VIDEO_INFO)
    cards = _movie_cards(conn, [i["key"] for i in items])
    for i in items:  # poster, backdrop, year, runtime and genres for the movie lists
        c = cards.get(i["key"], {})
        i.update({k: c.get(k) for k in ("poster", "backdrop", "year", "runtime_s")}, genres=c.get("genres", []))
    return items


# ------------------------------------------------------------------ home screen (Netflix-style rows)

def _show_cards(conn: sqlite3.Connection, keys: list[str]) -> dict[str, dict]:
    """Display details for shows: poster, 16:9 backdrop, year, seasons, genres, synopsis."""
    if not keys:
        return {}
    ph = ",".join("?" * len(keys))
    out = {}
    for row in conn.execute(f"SELECT creator_id, title, avatar_url, item_count, extra FROM creators WHERE creator_id IN ({ph})", keys):
        extra = json.loads(row["extra"] or "{}")
        out[row["creator_id"]] = {
            "key": row["creator_id"], "kind": "show", "title": row["title"], "poster": row["avatar_url"],
            "backdrop": extra.get("backdrop"), "year": extra.get("year"), "seasons": extra.get("seasons"),
            "genres": extra.get("topics") or [], "overview": extra.get("overview"), "episodes_total": row["item_count"],
            # anime details from AniList (Crunchyroll); absent elsewhere
            "studios": extra.get("studios") or [], "anime_season": extra.get("anime_season"), "score": extra.get("score"),
            "format": extra.get("format"), "simulcast": bool(extra.get("simulcast")),
        }
    return out


def _movie_cards(conn: sqlite3.Connection, keys: list[str]) -> dict[str, dict]:
    if not keys:
        return {}
    ph = ",".join("?" * len(keys))
    genres: dict[str, list[str]] = defaultdict(list)
    for item, g in conn.execute(f"SELECT item_id, genre FROM item_genres WHERE item_id IN ({ph})", keys):
        genres[item].append(g)
    out = {}
    for row in conn.execute(f"SELECT item_id, title, thumb_small, thumb_large, duration_s, extra FROM items WHERE item_id IN ({ph})", keys):
        extra = json.loads(row["extra"] or "{}")
        out[row["item_id"]] = {
            "key": row["item_id"], "kind": "movie", "title": row["title"], "poster": row["thumb_small"],
            "backdrop": row["thumb_large"], "year": extra.get("year"), "runtime_s": row["duration_s"],
            "genres": genres.get(row["item_id"], []), "overview": extra.get("overview"),
        }
    return out


def home(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    """The Netflix home page's show/movie details for a period: your #1 show (its backdrop sets the
    mood of the stats header), Top 10 with stats, finished shows, movies, and shows new to you."""
    from . import evolution, tops  # local import: tops imports this module's neighbours
    prog = {s["key"]: s for s in progress(conn, r, f, 500)["shows"]}
    top = tops.top_channels(conn, r, f, 10)
    movies = top_movies(conn, r, f, 10)
    # over your whole history every show is "new", so that list only makes sense for a shorter period
    bounds = data_bounds(conn)
    covers_all = bool(bounds) and r.start <= bounds[0]
    new = [] if covers_all else [d for d in evolution.new_discoveries(conn, r, f, 12) if d["channel_id"] != UNKNOWN]
    cards = _show_cards(conn, list({*prog, *(t["key"] for t in top), *(d["channel_id"] for d in new)}))
    mcards = _movie_cards(conn, [m["key"] for m in movies])

    def show(key: str, **more) -> dict | None:
        card = cards.get(key)
        if not card:
            return None
        p = prog.get(key, {})
        return {**card, "count": p.get("count", 0), "time_s": p.get("time_s", 0), "watched": p.get("watched"),
                "total": p.get("total"), "pct": p.get("pct"), "status": p.get("status"),
                "last_watched": p.get("last_watched"), **more}

    # how much of each show you watched dubbed (only platforms that record the audio language, i.e. Crunchyroll)
    dubbed = {k: (d or 0) / n for k, d, n in conn.execute(
        """SELECT w.channel_id, SUM(json_extract(i.extra, '$.dubbed')), COUNT(*) FROM watches w
           JOIN items i ON i.item_id = w.video_id WHERE w.channel_id IS NOT NULL
             AND json_extract(i.extra, '$.dubbed') IS NOT NULL GROUP BY w.channel_id""")}
    for c in cards.values():
        c["dub_share"] = dubbed.get(c["key"])
    top10 = [x for t in top if (x := show(t["key"], count=t["count"], time_s=t["time_s"], rank=t["rank"]))]
    finished = sorted((s for s in prog.values() if s["status"] == "finished"), key=lambda s: s["last_watched"], reverse=True)
    return {
        "billboard": top10[0] if top10 else None,
        "top10": top10,
        "finished": [x for s in finished if (x := show(s["key"]))],
        "movies": [{**mcards[m["key"]], "count": m["count"], "time_s": m["time_s"], "rank": m["rank"]}
                   for m in movies if m["key"] in mcards],
        "new": [x for d in new if (x := show(d["channel_id"], first_watched=d["first_watched"], count=d["count"]))],
    }


# ------------------------------------------------------------------ one show's page

def show_detail(conn: sqlite3.Connection, key: str, f: Filters, today: date | None = None) -> dict | None:
    """Everything about one show across your whole history: header details, progress, an episode
    checklist by season (TMDB's list, marked with what you watched and when), your pace, and your
    other shows in the same genres."""
    card = _show_cards(conn, [key]).get(key)
    if not card:
        return None
    asof = data_bounds(conn)[1] if data_bounds(conn) else (today or date.today())
    everything = Range(date(1900, 1, 1), asof, "All time")
    prog = next((s for s in progress(conn, everything, f, 1000)["shows"] if s["key"] == key), None)

    # what you watched, per episode: first and last day, how many times
    watched: dict[str, dict] = {}
    for item, s, n, label, title, first, last, times, t in conn.execute(
            f"""SELECT w.video_id, json_extract(i.extra, '$.season_number'), json_extract(i.extra, '$.episode_number'),
                       json_extract(i.extra, '$.season'), i.title, MIN(w.local_date), MAX(w.local_date), COUNT(*), SUM({time_expr(f)})
                FROM watches w LEFT JOIN items i ON i.item_id = w.video_id
                WHERE w.channel_id = ? AND w.kind = 'episode' GROUP BY w.video_id""", (key,)):
        watched[item] = {"season": s, "number": n, "label": label, "title": title, "first": first, "last": last,
                         "times": times, "time_s": t or 0}
    by_num = {(_as_int(v["season"]), _as_int(v["number"])): v for v in watched.values()
              if _as_int(v["season"]) is not None and _as_int(v["number"]) is not None}

    seasons: list[dict] = []
    matched: set[tuple[int, int]] = set()
    if _has_table(conn, "catalog_episodes"):
        by_season: dict[int, list[dict]] = defaultdict(list)
        for s, n, name, runtime, still, air in conn.execute(
                "SELECT season, number, name, runtime_min, still, air_date FROM catalog_episodes "
                "WHERE creator_id = ? AND season > 0 ORDER BY season, number", (key,)):
            w = by_num.get((s, n))
            if w:
                matched.add((s, n))
            air = (air or "")[:10] or None
            aired = not air or air <= asof.isoformat()
            by_season[s].append({
                "number": n, "name": name, "runtime_min": runtime, "air_date": air or None, "aired": aired,
                "still": still,
                "watched": bool(w), "first": w["first"] if w else None, "times": w["times"] if w else 0,
            })
        for s, eps in by_season.items():
            aired = [e for e in eps if e["aired"]]
            seasons.append({"season": s, "episodes": eps, "aired": len(aired), "watched": sum(e["watched"] for e in aired)})
    # episodes TMDB's numbering can't place (e.g. One Piece's arcs): listed under Netflix's own season name
    other = sorted(({"title": v["title"], "season": v["label"], "first": v["first"], "times": v["times"]}
                    for v in watched.values()
                    if (_as_int(v["season"]), _as_int(v["number"])) not in matched),
                   key=lambda e: e["first"])

    # pace
    days = [r_[0] for r_ in conn.execute(
        "SELECT local_date FROM watches WHERE channel_id = ? AND kind = 'episode' GROUP BY local_date ORDER BY 1", (key,))]
    top_day = conn.execute(
        "SELECT local_date, COUNT(DISTINCT video_id) n FROM watches WHERE channel_id = ? AND kind = 'episode' "
        "GROUP BY local_date ORDER BY n DESC, local_date LIMIT 1", (key,)).fetchone()
    # a season finished over years (started, then picked up again later) isn't a binge
    fastest = [b for b in binges(conn, everything, f, 500) if b["key"] == key and b["days"] <= BINGE_MAX_DAYS]
    pace = {
        "days": len(days), "first": days[0] if days else None, "last": days[-1] if days else None,
        "per_day": (len(watched) / len(days)) if days else 0,
        "best_day": {"date": top_day[0], "episodes": top_day[1]} if top_day else None,
        "fastest_season": min(fastest, key=lambda b: (b["days"], -b["episodes"])) if fastest else None,
        "seasons_binged": sorted(fastest, key=lambda b: b["season"]),
    }

    # your other shows sharing its genres (most shared genres first, then most watched)
    mine = set(card["genres"])
    similar = []
    if mine:
        others = {k: c for k, c in _show_cards(conn, [r_[0] for r_ in conn.execute(
            "SELECT DISTINCT channel_id FROM watches WHERE channel_id IS NOT NULL AND channel_id NOT IN (?, ?)",
            (key, UNKNOWN))]).items()}
        counts = dict(conn.execute("SELECT channel_id, COUNT(*) FROM watches WHERE channel_id IS NOT NULL GROUP BY 1").fetchall())
        scored = [(len(mine & set(c["genres"])), counts.get(k, 0), c) for k, c in others.items() if mine & set(c["genres"])]
        scored.sort(key=lambda x: (-x[0], -x[1]))
        similar = [{**c, "count": n, "shared": shared} for shared, n, c in scored[:10]]

    return {
        "show": card,
        "progress": prog,
        "seasons": seasons,
        "other_episodes": other,
        "pace": pace,
        "similar": similar,
        "time_s": sum(v["time_s"] for v in watched.values()),
        "episodes_watched": len(watched),
        "views": sum(v["times"] for v in watched.values()),
    }


# ------------------------------------------------------------------ anime (Crunchyroll)

SIMULCAST_DAYS = 7  # watched within a week of the episode airing


def anime(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    """Sub vs dub (from the audio language you watched in) and simulcast watching (how soon after
    an episode aired you watched it)."""
    w_sql, p = where(r, f)
    rows = conn.execute(
        f"""SELECT json_extract(i.extra, '$.dubbed'), {time_expr(f)}, w.start_epoch, w.published_epoch, w.channel_id
            FROM watches w LEFT JOIN items i ON i.item_id = w.video_id WHERE {w_sql}""", p).fetchall()
    sub = {"count": 0, "time_s": 0}
    dub = {"count": 0, "time_s": 0}
    lags, simul_shows = [], defaultdict(int)
    for dubbed, t, start, aired, show in rows:
        bucket = dub if dubbed else sub
        bucket["count"] += 1
        bucket["time_s"] += t or 0
        if aired and start and start >= aired:
            days = (start - aired) / 86400
            lags.append(days)
            if days <= SIMULCAST_DAYS and show:
                simul_shows[show] += 1
    lags.sort()
    names = _show_info(conn, list(simul_shows))
    top = sorted(simul_shows.items(), key=lambda kv: -kv[1])[:5]
    return {
        "sub": sub, "dub": dub,
        "simulcast": sum(1 for d in lags if d <= SIMULCAST_DAYS),
        "dated": len(lags),
        "median_days_after_air": lags[len(lags) // 2] if lags else None,
        "simulcast_shows": [{"key": k, "title": names[k]["title"] if k in names else k,
                             "avatar_url": names[k]["avatar_url"] if k in names else None, "episodes": n} for k, n in top],
    }


def anime_page(conn: sqlite3.Connection, r: Range, f: Filters) -> dict:
    """The Anime tab: sub vs dub (overall, per series, per month), simulcast watching, studios, the
    seasons your series aired in, formats, and AniList scores and tags. Series details come from AniList."""
    w_sql, p = where(r, f)
    rows = conn.execute(
        f"""SELECT w.channel_id, w.month, json_extract(i.extra, '$.dubbed'), {time_expr(f)}, w.start_epoch, w.published_epoch
            FROM watches w LEFT JOIN items i ON i.item_id = w.video_id
            WHERE {w_sql} AND w.channel_id IS NOT NULL""", p).fetchall()
    per: dict[str, dict] = defaultdict(lambda: {"count": 0, "time_s": 0, "dub": 0, "simulcast": 0, "lags": []})
    months: dict[str, dict] = defaultdict(lambda: {"sub": 0, "dub": 0})
    lag_buckets = {"same week": 0, "within a month": 0, "within a year": 0, "1-5 years": 0, "5+ years": 0}
    for key, month, dubbed, t, start, aired in rows:
        s = per[key]
        s["count"] += 1
        s["time_s"] += t or 0
        s["dub"] += 1 if dubbed else 0
        months[month]["dub" if dubbed else "sub"] += 1
        if aired and start and start >= aired:
            days = (start - aired) / 86400
            s["lags"].append(days)
            s["simulcast"] += days <= SIMULCAST_DAYS
            lag_buckets["same week" if days <= 7 else "within a month" if days <= 31 else "within a year" if days <= 365
                        else "1-5 years" if days <= 5 * 365 else "5+ years"] += 1
    cards = _show_cards(conn, list(per))

    def card(k: str) -> dict:
        c, s = cards.get(k, {"key": k, "title": k, "poster": None, "studios": [], "genres": []}), per[k]
        return {"key": k, "title": c["title"], "poster": c.get("poster"), "count": s["count"], "time_s": s["time_s"],
                "dub_share": s["dub"] / s["count"] if s["count"] else None, "simulcast": s["simulcast"],
                "studios": c.get("studios") or [], "anime_season": c.get("anime_season"), "score": c.get("score"),
                "format": c.get("format"), "year": c.get("year")}
    series = sorted((card(k) for k in per), key=lambda c: -(c["time_s"] if f.metric == "time" else c["count"]))
    brief = ("key", "title", "poster", "count")

    studios: dict[str, dict] = {}
    for s in series:
        for name in s["studios"][:1]:  # the main studio
            st = studios.setdefault(name, {"name": name, "count": 0, "time_s": 0, "series": []})
            st["count"] += s["count"]
            st["time_s"] += s["time_s"]
            st["series"].append({k: s[k] for k in brief})
    seasons: dict[str, dict] = {}
    for s in series:
        if s["anime_season"]:
            z = seasons.setdefault(s["anime_season"], {"season": s["anime_season"], "count": 0, "series": []})
            z["count"] += s["count"]
            z["series"].append({k: s[k] for k in brief})
    order = {"Winter": 0, "Spring": 1, "Summer": 2, "Fall": 3}

    def season_key(name: str) -> tuple:
        part, _, year = name.rpartition(" ")
        return (int(year) if year.isdigit() else 0, order.get(part, 0))
    decades: dict[str, int] = defaultdict(int)
    formats: dict[str, int] = defaultdict(int)
    for s in series:
        yr = season_key(s["anime_season"])[0] if s["anime_season"] else (int(s["year"]) if (s["year"] or "").isdigit() else 0)
        if yr:
            decades[f"{yr // 10 * 10}s"] += s["count"]
        if s["format"]:
            formats[s["format"].replace("_", " ")] += s["count"]
    scored = [s for s in series if s["score"]]
    eps_scored = sum(s["count"] for s in scored)
    tags: dict[str, int] = defaultdict(int)
    for k in per:
        extra = conn.execute("SELECT extra FROM creators WHERE creator_id = ?", (k,)).fetchone()
        for t in (json.loads(extra[0] or "{}").get("tags", []) if extra else []):
            tags[t] += per[k]["count"]

    sub_n = sum(s["count"] - s["dub"] for s in per.values())
    dub_n = sum(s["dub"] for s in per.values())
    all_lags = sorted(d for s in per.values() for d in s["lags"])
    return {
        "series_count": len(series),
        "sub_dub": {"sub": sub_n, "dub": dub_n,
                    "sub_time_s": sum(s["time_s"] * (1 - s["dub"] / s["count"]) for s in per.values() if s["count"]),
                    "dub_time_s": sum(s["time_s"] * (s["dub"] / s["count"]) for s in per.values() if s["count"])},
        "sub_dub_months": [{"month": m, **v} for m, v in sorted(months.items())],
        "series": series,
        "simulcast": {"episodes": sum(s["simulcast"] for s in per.values()), "dated": len(all_lags),
                      "median_days": all_lags[len(all_lags) // 2] if all_lags else None, "buckets": lag_buckets,
                      "series": [s for s in sorted(series, key=lambda s: -s["simulcast"]) if s["simulcast"]][:8]},
        "studios": sorted(studios.values(), key=lambda s: -(s["time_s"] if f.metric == "time" else s["count"]))[:12],
        "seasons": sorted(seasons.values(), key=lambda z: season_key(z["season"]), reverse=True),
        "decades": sorted(({"decade": d, "count": n} for d, n in decades.items()), key=lambda d: d["decade"]),
        "formats": sorted(({"format": k, "count": n} for k, n in formats.items()), key=lambda x: -x["count"]),
        "scores": {"average": round(sum(s["score"] * s["count"] for s in scored) / eps_scored) if eps_scored else None,
                   "best": sorted(scored, key=lambda s: -s["score"])[:5], "worst": sorted(scored, key=lambda s: s["score"])[:3]},
        "tags": sorted(({"tag": t, "count": n} for t, n in tags.items()), key=lambda x: -x["count"])[:15],
    }
