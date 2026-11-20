"""Turn raw entries + API data into `watches`: one row per real watch with an
estimated watch time, session, Shorts/background/live flags.

Takeout only records when a video *started*, so watch time is an estimate:
  - ads are removed first (they'd break the gaps between real videos)
  - delayed logs (~6h after the pre-roll) are moved back to the pre-roll's time
  - in a session:       est = min(duration, gap to next video)
  - last of a session:  est = min(duration, max_per_video)
  - unknown duration:   est = min(gap, fallback)
  - everything is capped at max_per_video
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .parser import AD, WATCH_KINDS


@dataclass
class WatchConfig:
    session_gap_s: float = 1800
    max_per_video_s: int = 10800
    fallback_s: int = 600
    max_possible_cap_s: int = 43200
    delay_enabled: bool = True
    delay_offset_s: float = 21600
    delay_tolerance_s: float = 120
    delay_min_duration_s: int = 18000
    shorts_max_s: int = 180
    shorts_hints: tuple[str, ...] = ("#shorts", "#short")
    bg_min_duration_s: int = 3600
    bg_keywords: tuple[str, ...] = ()
    bg_channels: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def from_config(cls, cfg) -> "WatchConfig":
        w, d, s, b = (cfg.section(x) for x in ("watchtime", "delayed_log", "shorts", "background"))
        return cls(
            session_gap_s=w.get("session_gap_minutes", 30) * 60,
            max_per_video_s=w.get("max_seconds_per_video", 10800),
            fallback_s=w.get("unknown_duration_fallback_seconds", 600),
            max_possible_cap_s=w.get("max_possible_cap_seconds", 43200),
            delay_enabled=d.get("enabled", True),
            delay_offset_s=d.get("offset_seconds", 21600),
            delay_tolerance_s=d.get("tolerance_seconds", 120),
            delay_min_duration_s=d.get("min_duration_seconds", 18000),
            shorts_max_s=s.get("max_duration_seconds", 180),
            shorts_hints=tuple(h.lower() for h in s.get("title_hints", ["#shorts"])),
            bg_min_duration_s=b.get("min_duration_seconds", 3600),
            bg_keywords=tuple(k.lower() for k in b.get("keywords", [])),
            bg_channels=frozenset(b.get("channels", [])),
        )


@dataclass
class Raw:
    """One entry joined with its API data (if any)."""
    entry_id: int
    kind: str
    epoch: float
    video_id: str | None = None
    channel_id: str | None = None
    channel_name: str | None = None
    title: str | None = None
    duration_s: int | None = None   # from API; None if unknown
    live: str | None = None         # none | live | upcoming
    was_live: int = 0
    embed_w: int | None = None
    embed_h: int | None = None
    tags: tuple[str, ...] = ()
    category_id: str | None = None
    published_at: str | None = None


def is_short(r: Raw, c: WatchConfig) -> str | None:
    """Return how the video was judged a Short ('shape' | 'hint' | 'duration'), or None."""
    if r.kind != "video" or not r.duration_s or r.duration_s > c.shorts_max_s:
        return None
    if r.embed_w and r.embed_h and r.embed_w > 0 and r.embed_h > 0:
        return "shape" if r.embed_w <= r.embed_h else None
    title = (r.title or "").lower()
    if any(h in title for h in c.shorts_hints):
        return "hint"
    return "duration" if r.duration_s <= 60 else None


def is_background(r: Raw, c: WatchConfig, delayed: bool) -> bool:
    if delayed:
        return True
    if r.channel_id in c.bg_channels or (r.channel_name and r.channel_name in c.bg_channels):
        return True
    long_enough = (r.duration_s or 0) >= c.bg_min_duration_s or r.live in ("live", "upcoming")
    if not long_enough:
        return False
    text = " ".join([(r.title or "").lower(), *(t.lower() for t in r.tags)])
    return any(k in text for k in c.bg_keywords)


def compute(rows: list[Raw], c: WatchConfig) -> list[dict]:
    """rows: ads and watch entries, sorted by epoch. Returns one dict per watch."""
    # 1. drop ads, but remember the last ad before each watch (no watch in between)
    watches: list[tuple[Raw, float | None]] = []
    last_ad: float | None = None
    for r in rows:
        if r.kind == AD:
            last_ad = r.epoch
        elif r.kind in WATCH_KINDS:
            watches.append((r, last_ad))
            last_ad = None

    # 2. resolve duration and start time
    items = []
    for r, ad_epoch in watches:
        live = r.live in ("live", "upcoming") or (r.was_live and not r.duration_s)
        dur = r.duration_s if r.duration_s and r.duration_s > 0 and not live else None
        start, delayed = r.epoch, False
        if (c.delay_enabled and ad_epoch is not None
                and abs(r.epoch - ad_epoch - c.delay_offset_s) <= c.delay_tolerance_s
                and (dur is None or dur >= c.delay_min_duration_s)):
            start, delayed = ad_epoch, True
        items.append((r, dur, start, delayed, bool(live or r.was_live)))
    # a moved-back start can't cross another watch (there was none between ad and video),
    # but keep the order explicit
    items.sort(key=lambda x: (x[2], x[0].entry_id))

    # 3. gaps, sessions, estimates
    out = []
    session = 0
    prev_gap = None
    for i, (r, dur, start, delayed, live) in enumerate(items):
        gap = items[i + 1][2] - start if i + 1 < len(items) else None
        if prev_gap is None or prev_gap > c.session_gap_s:
            session += 1
        in_session = gap is not None and gap <= c.session_gap_s
        if dur is None:
            est, method = (min(gap, c.fallback_s) if in_session else c.fallback_s), "fallback"
        elif in_session:
            est, method = (dur, "full") if dur <= gap else (gap, "gap")
        else:
            est, method = dur, "full"
        if est > c.max_per_video_s:
            est, method = c.max_per_video_s, "cap"
        short = is_short(r, c)
        out.append({
            "entry_id": r.entry_id, "kind": r.kind, "video_id": r.video_id, "channel_id": r.channel_id,
            "start_epoch": start, "duration_s": dur, "est_s": int(round(est)), "est_method": method,
            "max_s": min(dur, c.max_possible_cap_s) if dur else None,
            "gap_next_s": gap, "session_id": session,
            "bucket": ("music" if r.kind == "music" else "unknown" if r.kind == "unavailable"
                       else "short" if short else "long"),
            "short_basis": short, "is_background": int(is_background(r, c, delayed)),
            "is_live": int(live), "delayed_fix": int(delayed), "category_id": r.category_id,
            "published_epoch": _epoch(r.published_at),
        })
        prev_gap = gap
    return out


def _epoch(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


# ------------------------------------------------------------------ database

_LOAD_SQL = """
SELECT e.id, e.kind, e.epoch, e.video_id, e.channel_id, e.channel_name,
       COALESCE(v.title, e.title), v.duration_s, v.live, v.was_live, v.embed_w, v.embed_h,
       v.tags, v.category_id, v.published_at
FROM entries e
LEFT JOIN videos v ON v.video_id = e.video_id AND v.status = 'ok'
WHERE e.kind IN ('ad', 'video', 'unavailable', 'music')
ORDER BY e.epoch, e.id
"""

_COLS = ("entry_id, kind, video_id, channel_id, start_epoch, local_iso, local_date, year, month, "
         "local_hour, local_minute, local_dow, duration_s, est_s, max_s, est_method, gap_next_s, session_id, "
         "bucket, short_basis, is_background, is_live, delayed_fix, category_id, published_epoch")


def load_rows(conn: sqlite3.Connection) -> list[Raw]:
    rows = []
    for (eid, kind, epoch, vid, cid, cname, title, dur, live, was_live, ew, eh, tags, cat, pub) in conn.execute(_LOAD_SQL):
        if kind == AD:
            rows.append(Raw(eid, kind, epoch))
            continue
        rows.append(Raw(eid, kind, epoch, vid, cid, cname, title, dur, live, was_live or 0, ew, eh,
                        tuple(json.loads(tags)) if tags else (), cat, pub))
    return rows


def build_watches(conn: sqlite3.Connection, c: WatchConfig, tz: ZoneInfo) -> int:
    out = compute(load_rows(conn), c)
    records = []
    for w in out:
        local = datetime.fromtimestamp(w["start_epoch"], timezone.utc).astimezone(tz)
        date = local.strftime("%Y-%m-%d")
        records.append((
            w["entry_id"], w["kind"], w["video_id"], w["channel_id"], w["start_epoch"],
            local.isoformat(), date, local.year, date[:7], local.hour, local.hour * 60 + local.minute,
            local.weekday(), w["duration_s"], w["est_s"], w["max_s"], w["est_method"], w["gap_next_s"], w["session_id"],
            w["bucket"], w["short_basis"], w["is_background"], w["is_live"], w["delayed_fix"],
            w["category_id"], w["published_epoch"],
        ))
    conn.execute("DELETE FROM watches")
    conn.executemany(f"INSERT INTO watches ({_COLS}) VALUES ({','.join('?' * len(_COLS.split(',')))})",
                     records)
    conn.commit()
    return len(records)
