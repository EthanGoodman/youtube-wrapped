"""Games-only stats (#21): achievements. Playtime uses the shared lists and pages (items = creators = games).
Reads the platform's achievement table (Steam: st_achievements); every function returns empty results without one."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime

from .common import Range

TABLE = "st_achievements"   # other game platforms (PSN trophies, Xbox) will expose the same columns


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
        f"SELECT appid, api, name, description, unlocked, rarity FROM {TABLE} WHERE unlocked IS NOT NULL ORDER BY unlocked, appid, api")]
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
    for appid, n, got, last in conn.execute(f"SELECT appid, COUNT(*), COUNT(unlocked), MAX(unlocked) FROM {TABLE} GROUP BY appid"):
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
    if not _has(conn) or not key.startswith("game:") or not key[5:].isdigit():
        return None
    rows = conn.execute(f"SELECT api, name, description, unlocked, rarity FROM {TABLE} WHERE appid = ?", (int(key[5:]),)).fetchall()
    items = [{"api": a, "name": n or a, "description": d, "unlocked": _local(u, tz) if u else None, "rarity": rr}
             for a, n, d, u, rr in rows]
    items.sort(key=lambda i: (i["unlocked"] is None, i["unlocked"] or "", i["rarity"] if i["rarity"] is not None else 101, i["api"]))
    got = sum(1 for i in items if i["unlocked"])
    return {"key": key, "total": len(items), "unlocked": got, "pct": got / len(items) if items else None, "achievements": items}
