"""Games-only stats (#21): achievements. Playtime uses the shared lists and pages (items = creators = games).
Reads the games family's game_achievements table (connectors/games.py); every function returns empty results without one."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime

from .common import Range

TABLE = "game_achievements"


def _has(conn: sqlite3.Connection) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (TABLE,)).fetchone())


def _games(conn: sqlite3.Connection, keys: list[str]) -> dict[str, dict]:
    if not keys:
        return {}
    ph = ",".join("?" * len(keys))
    return {r["item_id"]: {"key": r["item_id"], "title": r["title"], "poster": r["thumb_small"], "header": r["thumb_large"],
                           **json.loads(r["extra"] or "{}")}
            for r in conn.execute(f"SELECT item_id, title, thumb_small, thumb_large, extra FROM items WHERE item_id IN ({ph})", keys)}


def _local(ts: int, tz) -> str:
    return datetime.fromtimestamp(ts, tz).isoformat()


def achievements_summary(conn: sqlite3.Connection, r: Range, tz) -> dict:
    """Unlocks in the range: how many, per month, most in a day, the rarest, newest first, and 100%-completed games."""
    if not _has(conn):
        return {"unlocked": 0, "per_month": [], "best_day": None, "rarest": [], "recent": [], "perfect": [], "total": 0}
    rows = [(f"game:{a}", api, name, desc, ts, rarity, datetime.fromtimestamp(ts, tz)) for a, api, name, desc, ts, rarity in conn.execute(
        f"SELECT game, api, name, description, unlocked, rarity FROM {TABLE} WHERE unlocked IS NOT NULL ORDER BY unlocked, game, api")]
    lo, hi = r.start.isoformat(), r.end.isoformat()
    inr = [x for x in rows if lo <= x[6].date().isoformat() <= hi]
    per_month, per_day = {}, {}
    for x in inr:
        per_month[x[6].strftime("%Y-%m")] = per_month.get(x[6].strftime("%Y-%m"), 0) + 1
        k = (x[6].date().isoformat(), x[0])
        per_day[k] = per_day.get(k, 0) + 1
    best = min(per_day.items(), key=lambda kv: (-kv[1], kv[0])) if per_day else None
    games = _games(conn, sorted({x[0] for x in inr}))

    def card(x) -> dict:
        return {"game": games.get(x[0], {"key": x[0]}), "api": x[1], "name": x[2], "description": x[3],
                "unlocked": x[6].isoformat(), "rarity": x[5]}
    rarest = sorted((x for x in inr if x[5] is not None), key=lambda x: (x[5], x[4], x[0]))[:5]
    # perfect: every achievement unlocked, the last one inside the range
    perfect = []
    for appid, n, got, last in conn.execute(f"SELECT game, COUNT(*), COUNT(unlocked), MAX(unlocked) FROM {TABLE} GROUP BY game"):
        if n and n == got and lo <= datetime.fromtimestamp(last, tz).date().isoformat() <= hi:
            perfect.append((f"game:{appid}", n, datetime.fromtimestamp(last, tz)))
    pg = _games(conn, [p[0] for p in perfect])
    return {
        "unlocked": len(inr),
        "total": conn.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0],
        "per_month": [{"month": m, "count": n} for m, n in sorted(per_month.items())],
        "best_day": {"date": best[0][0], "game": _games(conn, [best[0][1]]).get(best[0][1], {"key": best[0][1]}), "count": best[1]} if best else None,
        "rarest": [card(x) for x in rarest],
        "recent": [card(x) for x in reversed(inr[-12:])],
        "perfect": [{"game": pg.get(k, {"key": k}), "achievements": n, "completed": when.isoformat()}
                    for k, n, when in sorted(perfect, key=lambda p: (p[2], p[0]), reverse=True)],
    }


def game_achievements(conn: sqlite3.Connection, key: str, tz) -> dict | None:
    """One game's achievement checklist: unlocked first (in order), then the rest, rarest first."""
    if not _has(conn) or not key.startswith("game:") or not key[5:]:
        return None
    rows = conn.execute(f"SELECT api, name, description, unlocked, rarity FROM {TABLE} WHERE game = ?", (key[5:],)).fetchall()
    items = [{"api": a, "name": n or a, "description": d, "unlocked": _local(u, tz) if u else None, "rarity": rr}
             for a, n, d, u, rr in rows]
    items.sort(key=lambda i: (i["unlocked"] is None, i["unlocked"] or "", i["rarity"] if i["rarity"] is not None else 101, i["api"]))
    got = sum(1 for i in items if i["unlocked"])
    return {"key": key, "total": len(items), "unlocked": got, "pct": got / len(items) if items else None, "achievements": items}


# ------------------------------------------------------------------ the past, told by real unlocks (no invented hours)
# Steam and Epic say how long you've played each game in total, never when. Each achievement unlock is a real,
# timestamped moment of play, so everything below that has a date comes from unlocks; hours only from days the
# app tracked (watches), and lifetime hours only as totals.

Unlock = tuple  # (game key, api, name, description, local datetime, rarity)


def _unlocks(conn: sqlite3.Connection, tz, r: Range | None = None) -> list[Unlock]:
    """Every unlock, oldest first; only those inside `r` when given."""
    if not _has(conn):
        return []
    rows = [(f"game:{g}", a, n, d, datetime.fromtimestamp(ts, tz), rr) for g, a, n, d, ts, rr in conn.execute(
        f"SELECT game, api, name, description, unlocked, rarity FROM {TABLE} WHERE unlocked IS NOT NULL ORDER BY unlocked, game, api")]
    return [x for x in rows if r.start <= x[4].date() <= r.end] if r else rows


def _card(games: dict, x: Unlock) -> dict:
    return {"game": games.get(x[0], {"key": x[0]}), "api": x[1], "name": x[2] or x[1], "description": x[3],
            "unlocked": x[4].isoformat(), "rarity": x[5]}


def _tracked(conn: sqlite3.Connection, r: Range) -> dict:
    """Hours from days the app tracked (exact), within `r`."""
    s, days = conn.execute("SELECT COALESCE(SUM(est_s), 0), COUNT(DISTINCT local_date) FROM watches "
                           "WHERE local_date BETWEEN ? AND ?", r.params()).fetchone()
    return {"est_s": s, "days": days}


def _streak(days: list) -> dict | None:
    """The longest run of consecutive days in `days` (sorted dates)."""
    best, start, prev, run = None, None, None, 0
    for d in days:
        run = run + 1 if prev and (d - prev).days == 1 else 1
        start = d if run == 1 else start
        if not best or run > best["days"]:
            best = {"days": run, "start": start.isoformat(), "end": d.isoformat()}
        prev = d
    return best


def activity(conn: sqlite3.Connection, r: Range, tz) -> dict:
    """Patterns, from unlocks: which days, hours and weekdays you were unlocking; and tracked hours in the range."""
    rows = _unlocks(conn, tz, r)
    per_day: dict[str, int] = {}
    hours, weekdays = [0] * 24, [0] * 7
    for x in rows:
        k = x[4].date().isoformat()
        per_day[k] = per_day.get(k, 0) + 1
        hours[x[4].hour] += 1
        weekdays[x[4].weekday()] += 1
    return {"unlocks": len(rows), "active_days": len(per_day), "games": len({x[0] for x in rows}),
            "days": [{"date": d, "count": n} for d, n in sorted(per_day.items())],
            "hours": hours, "weekdays": weekdays, "tracked": _tracked(conn, r)}


def timeline(conn: sqlite3.Connection, tz) -> list[dict]:
    """When you were into each game: first and last unlock and how many, plus what's known without dates (lifetime
    hours, when you got it, last played). A played game without unlocks still comes back (lifetime only)."""
    span: dict[str, list] = {}
    for x in _unlocks(conn, tz):
        s = span.setdefault(x[0], [x[4], x[4], 0])
        s[1], s[2] = x[4], s[2] + 1
    keys = [k for (k,) in conn.execute("SELECT item_id FROM items")]
    games = _games(conn, keys)
    out = []
    for k in keys:
        g, s = games[k], span.get(k)
        out.append({"game": g, "minutes": g.get("minutes") or 0,
                    "first_unlock": s[0].date().isoformat() if s else None, "last_unlock": s[1].date().isoformat() if s else None,
                    "unlocks": s[2] if s else 0, "achievements": g.get("achievements") or 0,
                    "acquired": g.get("acquired"), "last_played": g.get("last_played")})
    out.sort(key=lambda t: (t["first_unlock"] is None, t["first_unlock"] or "", -t["minutes"], t["game"]["key"]))
    return [t for t in out if t["minutes"] or t["unlocks"]]


def years(conn: sqlite3.Connection, tz) -> list[dict]:
    """Each year with activity: unlocks, active days, games you unlocked in, the most active game (by unlocks), and
    tracked hours for years the app was running."""
    by: dict[int, list] = {}
    for x in _unlocks(conn, tz):
        by.setdefault(x[4].year, []).append(x)
    tracked = {int(y): (s, d) for y, s, d in conn.execute(
        "SELECT substr(local_date, 1, 4), SUM(est_s), COUNT(DISTINCT local_date) FROM watches GROUP BY 1")}
    games = _games(conn, sorted({x[0] for xs in by.values() for x in xs}))
    out = []
    for y in sorted(set(by) | set(tracked)):
        xs = by.get(y, [])
        count: dict[str, int] = {}
        for x in xs:
            count[x[0]] = count.get(x[0], 0) + 1
        top = min(count.items(), key=lambda kv: (-kv[1], kv[0])) if count else None
        out.append({"year": y, "unlocks": len(xs), "active_days": len({x[4].date() for x in xs}), "games": len(count),
                    "top": {"game": games.get(top[0], {"key": top[0]}), "unlocks": top[1]} if top else None,
                    "tracked_s": tracked.get(y, (0, 0))[0] or 0, "tracked_days": tracked.get(y, (0, 0))[1]})
    return out


def records(conn: sqlite3.Connection, tz, r: Range | None = None) -> dict:
    """Records that really happened: rarest unlocks, most unlocks in a day, the latest-night and earliest-morning
    unlock, fastest 100%, longest run of days unlocking, the most-played game, and the biggest tracked day."""
    rows = _unlocks(conn, tz, r)
    games = _games(conn, sorted({x[0] for x in rows}))
    per_day: dict[tuple, int] = {}
    for x in rows:
        per_day[(x[4].date(), x[0])] = per_day.get((x[4].date(), x[0]), 0) + 1
    best = min(per_day.items(), key=lambda kv: (-kv[1], kv[0][0], kv[0][1])) if per_day else None
    night = [x for x in rows if x[4].hour < 5]                 # the one closest to 5am is the latest night
    morning = [x for x in rows if 5 <= x[4].hour < 10]         # the first after 5am is the earliest morning
    rare = sorted((x for x in rows if x[5] is not None), key=lambda x: (x[5], x[4]))
    fastest = None
    if _has(conn):
        for g, n, got, lo, hi in conn.execute(f"SELECT game, COUNT(*), COUNT(unlocked), MIN(unlocked), MAX(unlocked) FROM {TABLE} GROUP BY game"):
            done = datetime.fromtimestamp(hi, tz).date() if hi else None
            if n >= 5 and n == got and (r is None or r.start <= done <= r.end):      # a real 100% (5+ achievements)
                d = (done - datetime.fromtimestamp(lo, tz).date()).days + 1
                if not fastest or (d, f"game:{g}") < (fastest["days"], fastest["key"]):
                    fastest = {"key": f"game:{g}", "days": d, "achievements": n, "completed": done.isoformat()}
    if fastest:
        fastest["game"] = _games(conn, [fastest["key"]]).get(fastest["key"], {"key": fastest["key"]})
    lo_d, hi_d = (r.start.isoformat(), r.end.isoformat()) if r else ("0000-01-01", "9999-12-31")
    day = conn.execute("SELECT local_date, video_id, est_s FROM watches WHERE local_date BETWEEN ? AND ? "
                       "ORDER BY est_s DESC, local_date LIMIT 1", (lo_d, hi_d)).fetchone()
    return {
        "unlocks": len(rows),
        "rarest": [_card(games, x) for x in rare[:3]],
        "best_day": {"date": best[0][0].isoformat(), "game": games.get(best[0][1], {"key": best[0][1]}), "count": best[1]} if best else None,
        "latest_night": _card(games, max(night, key=lambda x: (x[4].time(), x[4]))) if night else None,
        "earliest_morning": _card(games, min(morning, key=lambda x: (x[4].time(), x[4]))) if morning else None,
        "fastest_perfect": fastest,
        "streak": _streak(sorted({x[4].date() for x in rows})),
        "tracked_best_day": {"date": day[0], "game": _games(conn, [day[1]]).get(day[1], {"key": day[1]}), "est_s": day[2]} if day else None,
    }


def wrapped_year(conn: sqlite3.Connection, r: Range, tz) -> dict:
    """One year's story from its unlocks (and tracked hours when the app was running): how active, which games,
    the new ones, the rarest, the 100%s. `counts` and `new` are for the personality metrics."""
    rows = _unlocks(conn, tz, r)
    count: dict[str, int] = {}
    for x in rows:
        count[x[0]] = count.get(x[0], 0) + 1
    first_ever: dict[str, datetime] = {}
    for x in _unlocks(conn, tz):
        first_ever.setdefault(x[0], x[4])
    new = sorted((k for k in count if r.start <= first_ever[k].date() <= r.end), key=lambda k: first_ever[k])
    order = sorted(count.items(), key=lambda kv: (-kv[1], kv[0]))
    games = _games(conn, [k for k, _ in order])
    hours = [0] * 24
    for x in rows:
        hours[x[4].hour] += 1
    rec = records(conn, tz, r)
    tracked = _tracked(conn, r)
    top_t = conn.execute("SELECT video_id, SUM(est_s) t FROM watches WHERE local_date BETWEEN ? AND ? GROUP BY 1 "
                         "ORDER BY t DESC, 1 LIMIT 1", r.params()).fetchone()
    return {
        "unlocks": len(rows), "active_days": len({x[4].date() for x in rows}), "games": len(count),
        "top_games": [{"game": games.get(k, {"key": k}), "unlocks": n, "share": n / len(rows)} for k, n in order[:5]],
        "new_games": [games.get(k, {"key": k}) for k in new],
        "rarest": rec["rarest"], "best_day": rec["best_day"], "streak": rec["streak"], "latest_night": rec["latest_night"],
        "busiest_hour": max(range(24), key=lambda h: (hours[h], -h)) if rows else None,
        "hours": hours, "perfect": achievements_summary(conn, r, tz)["perfect"],
        "tracked": {**tracked, "top": _games(conn, [top_t[0]]).get(top_t[0])} if tracked["est_s"] and top_t else None,
        "counts": count, "new": new, "unlock_times": [x[4] for x in rows], "rarities": [x[5] for x in rows],
    }
