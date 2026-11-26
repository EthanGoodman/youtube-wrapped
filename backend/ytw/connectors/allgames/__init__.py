"""All games: every game platform combined into one view (Steam + Epic + PlayStation…), built from their databases.

Not a book on the shelf and not a source of its own: after any game platform builds, data/allgames.db is rebuilt
from theirs. The same game on several platforms (matched by name, see match.py) becomes one game whose hours,
achievements/trophies and dates are the platforms' real numbers added together, with the split kept per platform.
Nothing is estimated here either: it only adds up what each platform knows.
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import TYPE_CHECKING

from ... import db
from ...stats.common import UNDATED_TABLE
from .. import games, store
from ..base import Manifest, finish_build, vocab
from .match import clean, group, load_overrides

if TYPE_CHECKING:
    from ...config import Config

SOURCES = ("steam", "epic", "playstation")       # poster preference too: tall cover art first

MANIFEST = Manifest(
    "allgames", "All games", True, "allgames", vocab("game", "games", "game", "games", "play", "played", "playtime"),
    frozenset({"achievements"}),
    ("Combines your game platforms (Steam, Epic Games, PlayStation) into one view: add them and it builds itself",),
    "", family="games", auth="file", order=50, shelf=False)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", clean(name)).strip("-")[:120] or "game"


def _rows(conn: sqlite3.Connection, sql: str) -> list[dict]:
    cur = conn.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _has(conn: sqlite3.Connection, table: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone())


def rebuild(cfg: "Config") -> int:
    """Rebuild data/allgames.db from the game platforms' databases. Returns how many games it has (0: no data)."""
    srcs = {p: cfg.platform_db(p) for p in SOURCES if cfg.platform_db(p).exists()}
    games_by_src: list[tuple[str, dict]] = []
    data: dict[str, dict] = {}
    for pid, path in srcs.items():
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            if not _has(c, "items"):
                continue
            d = {"items": _rows(c, "SELECT * FROM items"), "watches": _rows(c, "SELECT * FROM watches"),
                 "undated": _rows(c, f"SELECT * FROM {UNDATED_TABLE}") if _has(c, UNDATED_TABLE) else [],
                 "ach": _rows(c, "SELECT * FROM game_achievements") if _has(c, "game_achievements") else [],
                 "genres": _rows(c, "SELECT item_id, genre FROM item_genres"),
                 "meta": dict(c.execute("SELECT key, value FROM meta").fetchall()) if _has(c, "meta") else {}}
        finally:
            c.close()
        data[pid] = d
        games_by_src += [(pid, it) for it in d["items"]]
    out = cfg.platform_db("allgames")
    if not games_by_src:
        if out.exists():
            out.unlink()
        return 0
    same, different = load_overrides(cfg.root / "game-matches.toml")
    gnum = group([it["title"] or it["item_id"] for _, it in games_by_src], same, different)

    # one combined game per group: its id, name (the shortest), picture (by platform preference) and sums
    members: dict[int, list[tuple[str, dict]]] = {}
    for (pid, it), k in zip(games_by_src, gnum):
        members.setdefault(k, []).append((pid, it))
    key_of: dict[tuple[str, str], str] = {}
    items, creators, titles, genres = [], [], [], {}
    used: set[str] = set()
    for k, ms in members.items():
        extras = [(pid, it, json.loads(it["extra"] or "{}")) for pid, it in ms]
        name = min((it["title"] or it["item_id"] for _, it, _ in extras), key=lambda n: (len(n), n))
        gid = _slug(name)
        while gid in used:
            gid += "-2"
        used.add(gid)
        key = f"game:{gid}"
        for pid, it, _ in extras:
            key_of[(pid, it["item_id"])] = key
        by_pref = sorted(extras, key=lambda e: SOURCES.index(e[0]))
        poster = next((it["thumb_small"] for _, it, _ in by_pref if it["thumb_small"]), None)
        header = next((it["thumb_large"] for _, it, _ in by_pref if it["thumb_large"]), None)
        url = next((it["url"] for _, it, _ in by_pref if it["url"]), None)
        split: dict[str, int] = {}
        for pid, _, x in extras:
            split[pid] = split.get(pid, 0) + int(x.get("minutes") or 0)
        dates = lambda f: [x[f] for _, _, x in extras if x.get(f)]  # noqa: E731
        extra = {"minutes": sum(split.values()), "platforms": {p: m for p, m in split.items()},
                 "achievements": sum(int(x.get("achievements") or 0) for _, _, x in extras),
                 "unlocked": sum(int(x.get("unlocked") or 0) for _, _, x in extras),
                 "first_played": min(dates("first_played"), default=None), "last_played": max(dates("last_played"), default=None),
                 "acquired": min(dates("acquired"), default=None),
                 "plays": sum(int(x["plays"]) for _, _, x in extras if x.get("plays")) or None}
        items.append(store.Item(key, "ok", name, key, poster, header, url=url, extra=json.dumps(extra)))
        creators.append(store.Creator(key, "ok", name, avatar_url=poster, url=url, extra=json.dumps(extra)))
        titles.append((gid, name, poster, header, url))
        for pid, it, _ in extras:
            genres.setdefault(key, set()).update(g["genre"] for g in data[pid]["genres"] if g["item_id"] == it["item_id"])

    conn = db.connect(out)
    try:
        games.init(conn)
        n = 0
        rows, undated, ach = [], [], []
        for pid, d in data.items():
            for src, dest in ((d["watches"], rows), (d["undated"], undated)):
                for w in src:
                    k = key_of.get((pid, w["video_id"]))
                    if k:
                        n += 1
                        dest.append({**w, "entry_id": n, "session_id": n, "video_id": k, "channel_id": k})
            for a in d["ach"]:
                k = key_of.get((pid, f"game:{a['game']}"))
                if k:
                    ach.append((k[5:], f"{pid}:{a['api']}", a["name"], a["description"], a["unlocked"], a["rarity"], a.get("kind")))
        conn.execute("PRAGMA foreign_keys=OFF")
        cols = list(store.WATCH_COLS)
        conn.execute("DELETE FROM watches")
        conn.executemany(f"INSERT INTO watches ({', '.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                         [tuple(w.get(c) for c in cols) for w in rows])
        conn.execute(f"DROP TABLE IF EXISTS {UNDATED_TABLE}")
        conn.execute(f"CREATE TABLE {UNDATED_TABLE} AS SELECT * FROM watches WHERE 0")
        conn.executemany(f"INSERT INTO {UNDATED_TABLE} ({', '.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                         [tuple(w.get(c) for c in cols) for w in undated])
        conn.execute("DELETE FROM game_achievements")
        conn.executemany("INSERT INTO game_achievements (game, api, name, description, unlocked, rarity, kind) VALUES (?,?,?,?,?,?,?)", ach)
        conn.execute("DELETE FROM game_titles")
        conn.executemany("INSERT INTO game_titles (game, name, poster, header, url) VALUES (?,?,?,?,?)", titles)
        store.write_items(conn, items)
        store.write_creators(conn, creators)
        store.write_genres(conn, {k: sorted(v) for k, v in genres.items() if v})
        metas = [d["meta"] for d in data.values()]
        years = sorted({y for m in metas for y in (m.get("activity_years") or "").split(",") if y})
        spans = [d for m in metas for d in (m.get("activity_span") or "").split(",") if d]
        tracked = [m["tracked_since"] for m in metas if m.get("tracked_since")]
        db.set_meta(conn, "extra_capabilities", "achievements" + (",genres" if genres else ""))
        db.set_meta(conn, "activity_years", ",".join(years))
        db.set_meta(conn, "activity_span", f"{min(spans)},{max(spans)}" if spans else "")
        db.set_meta(conn, "tracked_since", min(tracked) if tracked else "")
        db.set_meta(conn, "sources", ",".join(data))
        finish_build(conn)
        conn.commit()
    finally:
        conn.close()
    return len(items)


def rebuild_quietly(cfg: "Config", out=print) -> None:
    """After a game platform builds: refresh the combined view (never fails the platform's own build)."""
    try:
        n = rebuild(cfg)
        if n:
            out(f"All games: {n:,} games across {', '.join(p for p in SOURCES if cfg.platform_db(p).exists())}")
    except (sqlite3.Error, OSError, ValueError) as e:
        out(f"All games: couldn't rebuild the combined view ({e})")


__all__ = ["MANIFEST", "rebuild", "rebuild_quietly", "Path"]
