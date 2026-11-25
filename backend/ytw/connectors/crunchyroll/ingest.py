"""Turn the fetched Crunchyroll history (data/crunchyroll/watch-history.json) into the generic
watches / items / creators / item_genres tables, so the shared stats work on it.

What one history entry gives us: the time you last played the episode (UTC, to the second), how far
into it you got (playhead, seconds), its length (duration_ms), whether you finished it, the series /
season / episode, genres (tenant_categories), the audio language (sub vs dub), its air date and stills.
Crunchyroll keeps only the latest play of each episode, so rewatches aren't visible.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from ... import db
from ...imports import ImportRejected, Source
from .. import store
from ..base import finish_build
from ..store import Creator, Item, View
from .fetch import HISTORY_FILE

MIN_PLAY_S = 30          # a tap that played for a few seconds isn't a watch
SESSION_GAP_S = 30 * 60  # a new viewing session starts after a 30-minute break
JAPANESE = "ja-JP"


def _epoch(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _thumb(images: dict, width: int) -> str | None:
    """The smallest still at least `width` wide (Crunchyroll sends 320 to 1920)."""
    sets = (images or {}).get("thumbnail") or []
    sizes = sorted((s for group in sets for s in group if s.get("source")), key=lambda s: s.get("width") or 0)
    pick = next((s for s in sizes if (s.get("width") or 0) >= width), sizes[-1] if sizes else None)
    return pick["source"] if pick else None


def parse(entries: list[dict], tz: ZoneInfo) -> list[dict]:
    """History entries -> plays, oldest first. Removed videos (no details) and few-second taps are skipped."""
    plays = []
    for e in entries:
        panel = e.get("panel") or {}
        kind = panel.get("type")
        meta = panel.get("episode_metadata") if kind == "episode" else panel.get("movie_metadata") if kind == "movie" else None
        start = _epoch(e.get("date_played"))
        if not meta or start is None:
            continue
        length = round((meta.get("duration_ms") or 0) / 1000) or None
        playhead = e.get("playhead") or 0
        watched = length if e.get("fully_watched") and length else min(playhead, length or playhead)
        if watched < MIN_PLAY_S and not e.get("fully_watched"):
            continue
        local = datetime.fromtimestamp(start, timezone.utc).astimezone(tz)
        aired = meta.get("episode_air_date") or meta.get("premium_available_date") or meta.get("upload_date")
        series_id = meta.get("series_id") or e.get("parent_id")
        plays.append({
            "id": panel.get("id") or e.get("id"), "kind": "episode" if kind == "episode" else "movie",
            "series_id": series_id if kind == "episode" else None,
            "series_title": meta.get("series_title") or meta.get("movie_listing_title"),
            "series_slug": meta.get("series_slug_title"),
            "season_id": meta.get("season_id"), "season_title": meta.get("season_title"),
            "season": meta.get("season_display_number") or str(meta.get("season_number") or ""),
            "season_seq": meta.get("season_sequence_number") or meta.get("season_number"),
            "episode": meta.get("episode") or (str(meta["episode_number"]) if meta.get("episode_number") else None),
            "episode_number": meta.get("episode_number"), "title": panel.get("title"), "slug": panel.get("slug_title"),
            "start": start, "local": local, "watched_s": int(watched), "length_s": length,
            "finished": bool(e.get("fully_watched")), "playhead_s": playhead,
            "audio": meta.get("audio_locale"), "dubbed": bool(meta.get("audio_locale")) and meta.get("audio_locale") != JAPANESE,
            "genres": meta.get("tenant_categories") or [], "aired": aired, "aired_epoch": _epoch(aired),
            "maturity": (meta.get("maturity_ratings") or [None])[0],
            "thumb_small": _thumb(panel.get("images"), 600), "thumb_large": _thumb(panel.get("images"), 1200),
            "description": panel.get("description"),
        })
    plays.sort(key=lambda p: p["start"])
    return plays


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


def _series_details(conn: sqlite3.Connection, series_ids: list[str]) -> dict[str, dict]:
    """Poster, banner, counts and AniList data per series, from `enrich` (empty if it hasn't run)."""
    out: dict[str, dict] = {sid: {} for sid in series_ids}
    if _has_table(conn, "cr_series"):
        for r in conn.execute("SELECT series_id, description, poster, banner, season_count, launch_year, is_simulcast FROM cr_series"):
            if r[0] in out:
                out[r[0]].update(description=r[1], poster=r[2], banner=r[3], season_count=r[4], launch_year=r[5], is_simulcast=r[6])
    if _has_table(conn, "cr_episodes"):
        today = datetime.now(timezone.utc).date().isoformat()
        for sid, n, first in conn.execute(
                "SELECT series_id, SUM(number IS NOT NULL AND season_seq > 0 AND (air_date IS NULL OR substr(air_date, 1, 10) <= ?)), "
                "MIN(substr(air_date, 1, 10)) FROM cr_episodes GROUP BY series_id", (today,)):
            if sid in out:
                out[sid].update(aired_episodes=n or None, first_air=first)
    if _has_table(conn, "anilist"):
        for sid, data in conn.execute("SELECT series_id, data FROM anilist WHERE data IS NOT NULL"):
            if sid in out:
                out[sid]["anilist"] = json.loads(data)
    return out


def build(conn: sqlite3.Connection, folder: Path, tz: ZoneInfo) -> dict:
    """Rebuild the tables from the fetched history file."""
    path = folder / HISTORY_FILE
    if not path.exists():
        raise FileNotFoundError(f"No {HISTORY_FILE} in {folder}. Run `python backend/cli.py fetch --platform crunchyroll` first.")
    with Source(path) as src:
        raw = src.read_json(src.names()[0])
    if not isinstance(raw, dict):
        raise ImportRejected(f"{HISTORY_FILE} isn't a Crunchyroll history file")
    plays = parse(raw.get("items") or [], tz)
    db.init_db(conn)

    watches, items, creators, genres = [], {}, {}, {}
    session, prev_end = 0, None
    for n, p in enumerate(plays, 1):
        if prev_end is None or p["start"] - prev_end > SESSION_GAP_S:
            session += 1
        prev_end = max(prev_end or 0, p["start"] + p["watched_s"])
        local = p["local"]
        item_id = ("ep:" if p["kind"] == "episode" else "mv:") + p["id"]
        creator_id = f"series:{p['series_id']}" if p["series_id"] else None
        watches.append(View(
            n, p["kind"], item_id, creator_id, p["start"], local, p["watched_s"],
            "complete" if p["finished"] else "playhead", duration_s=p["watched_s"], max_s=p["length_s"],
            session_id=session, published_epoch=p["aired_epoch"]))
        items[item_id] = Item(
            item_id, "ok", p["title"], creator_id, p["thumb_small"], p["thumb_large"], p["length_s"],
            (p["aired"] or "")[:10] or None, None,
            f"https://www.crunchyroll.com/watch/{p['id']}/{p['slug'] or ''}".rstrip("/"),
            # season_number / episode_number are numbers (the shared show stats count episodes by them);
            # the season's own label ("2", "S2", sometimes empty) is kept separately
            json.dumps({"show": p["series_title"], "season": p["season_title"], "season_number": p["season_seq"],
                        "season_display": p["season"], "season_id": p["season_id"], "episode": p["episode"],
                        "episode_number": p["episode_number"], "kind": p["kind"], "finished": p["finished"],
                        "playhead_s": p["playhead_s"], "audio": p["audio"], "dubbed": p["dubbed"],
                        "maturity": p["maturity"], "air_date": p["aired"], "overview": p["description"]}))
        genres[item_id] = p["genres"]
        if creator_id:
            c = creators.setdefault(creator_id, {"title": p["series_title"], "slug": p["series_slug"], "genres": set(), "seasons": {}})
            c["genres"].update(p["genres"])
            if p["season_id"]:
                c["seasons"][p["season_id"]] = p["season_title"]

    conn.execute("PRAGMA foreign_keys=OFF")  # no YouTube-style raw `entries` table here
    store.write_views(conn, watches)
    store.write_items(conn, items.values())
    details = _series_details(conn, [cid.split(":", 1)[1] for cid in creators])
    rows = []
    for cid, c in creators.items():
        d = details.get(cid.split(":", 1)[1], {})
        al = d.get("anilist") or {}
        rows.append(Creator(
            cid, "ok", c["title"], None, d.get("poster"), None, d.get("aired_episodes"), "JP", d.get("first_air"),
            f"https://www.crunchyroll.com/series/{cid.split(':', 1)[1]}/{c['slug'] or ''}".rstrip("/"),
            json.dumps({
                "topics": sorted(c["genres"] | set(al.get("genres") or [])), "seasons_seen": len(c["seasons"]),
                "seasons": d.get("season_count"), "year": str(d["launch_year"]) if d.get("launch_year") else None,
                "overview": d.get("description"), "poster": d.get("poster"), "backdrop": d.get("banner"),
                "simulcast": bool(d.get("is_simulcast")),
                # AniList extras
                "anilist_id": al.get("id"), "studios": [n["name"] for n in ((al.get("studios") or {}).get("nodes") or [])],
                "anime_season": f"{(al.get('season') or '').title()} {al.get('seasonYear')}".strip() if al.get("seasonYear") else None,
                "format": al.get("format"), "score": al.get("averageScore"),
                "tags": [t["name"] for t in (al.get("tags") or []) if not t.get("isMediaSpoiler") and (t.get("rank") or 0) >= 60][:8],
                "cover_color": (al.get("coverImage") or {}).get("color"),
            })))
    store.write_creators(conn, rows)
    # every episode out, per series, from Crunchyroll's catalog (for progress, binges, the checklist)
    conn.execute("DELETE FROM catalog_episodes")
    if _has_table(conn, "cr_episodes"):
        conn.execute("""INSERT OR REPLACE INTO catalog_episodes
            SELECT 'series:' || series_id, season_seq, number, title, CAST(ROUND(duration_ms / 60000.0) AS INTEGER), still, air_date
            FROM cr_episodes WHERE number IS NOT NULL AND season_seq > 0""")
    store.write_genres(conn, genres)
    # real start times and real watch time (playhead / length): no estimating
    db.set_meta(conn, "extra_capabilities", "time_of_day")
    db.set_meta(conn, "crunchyroll_profile", raw.get("profile") or "")
    db.set_meta(conn, "timezone", str(tz))
    finish_build(conn)
    return {"plays": len(watches), "series": len(creators), "skipped": len(raw.get("items") or []) - len(watches),
            "hours": sum(w.est_s for w in watches) / 3600,
            "first": watches[0].local.date().isoformat() if watches else None,
            "last": watches[-1].local.date().isoformat() if watches else None}
