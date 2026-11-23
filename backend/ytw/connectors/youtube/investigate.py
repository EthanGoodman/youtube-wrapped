"""Investigate delayed video timestamps (video logged hours after its pre-roll ad)."""
from __future__ import annotations

import sqlite3
from collections import Counter
from datetime import datetime

from .parser import AD, WATCH_KINDS

GAP_BUCKETS = [(0, 10, "<10s"), (10, 30, "10-30s"), (30, 60, "30-60s"), (60, 300, "1-5m"),
               (300, 1800, "5-30m"), (1800, 3600, "30-60m"), (3600, 3 * 3600, "1-3h"),
               (3 * 3600, 5 * 3600, "3-5h"), (5 * 3600, 7 * 3600, "5-7h"),
               (7 * 3600, float("inf"), "7h+")]


def _bucket(gap: float) -> str:
    for lo, hi, label in GAP_BUCKETS:
        if lo <= gap < hi:
            return label
    return "?"


def ad_to_next_watch(conn: sqlite3.Connection) -> list[dict]:
    """For every ad that is immediately followed (ignoring other ads) by a watch entry."""
    rows = conn.execute(
        "SELECT id, kind, epoch, local_iso, title, channel_name, video_id FROM entries "
        "WHERE kind IN ('ad','video','unavailable','music') ORDER BY epoch, id").fetchall()
    out = []
    last_ad = None
    for r in rows:
        if r["kind"] == AD:
            last_ad = r
        elif r["kind"] in WATCH_KINDS:
            if last_ad is not None:
                out.append({"ad": last_ad, "video": r, "gap": r["epoch"] - last_ad["epoch"]})
            last_ad = None
    return out


def report(conn: sqlite3.Connection, keywords: list[str], min_gap_h: float = 1.0) -> str:
    pairs = ad_to_next_watch(conn)
    lines = []
    p = lines.append
    total_ads = conn.execute("SELECT COUNT(*) FROM entries WHERE kind='ad'").fetchone()[0]
    p(f"Ads total: {total_ads:,}. Ad -> next video pairs (last ad before a video): {len(pairs):,}")
    p("\nGap from ad to the next video:")
    counts = Counter(_bucket(x["gap"]) for x in pairs)
    for _, _, label in GAP_BUCKETS:
        n = counts.get(label, 0)
        p(f"  {label:>7}  {n:>7,}  {'#' * min(60, round(60 * n / max(1, len(pairs))))}")

    long = [x for x in pairs if x["gap"] >= min_gap_h * 3600]
    p(f"\nPairs with gap >= {min_gap_h:g}h: {len(long):,}")
    if not long:
        return "\n".join(lines)

    # Is the delay a whole number of hours (timezone-style glitch) or does it vary?
    offs = [abs(x["gap"] - round(x["gap"] / 3600) * 3600) for x in long]
    p(f"  within 2 min of a whole hour: {sum(o <= 120 for o in offs):,} "
      f"({100 * sum(o <= 120 for o in offs) / len(long):.0f}%)")
    hist = Counter(min(int(x['gap'] // 1800) / 2, 24) for x in long)
    p("  gap histogram (30-min bins, hours):")
    for h in sorted(hist):
        p(f"    {h:>5.1f}h  {hist[h]:>5,}  {'#' * min(60, hist[h])}")

    def is_bg(x):
        t = (x["video"]["title"] or "").lower()
        return any(k in t for k in keywords)
    bg = sum(map(is_bg, long))
    p(f"\n  title matches a background/sleep keyword: {bg:,} ({100 * bg / len(long):.0f}%)")
    near6 = [x for x in long if 5.5 * 3600 <= x["gap"] <= 6.5 * 3600]
    if near6:
        bg6 = sum(map(is_bg, near6))
        p(f"  of the {len(near6):,} with gap 5.5-6.5h, keyword matches: {bg6:,} ({100 * bg6 / len(near6):.0f}%)")

    p("\n  local hour of the AD (gap >= threshold):")
    ah = Counter(datetime.fromisoformat(x["ad"]["local_iso"]).hour for x in long)
    p("    " + "  ".join(f"{h:02d}:{ah.get(h, 0)}" for h in range(24)))

    p("\n  top channels of the delayed videos:")
    for ch, n in Counter(x["video"]["channel_name"] or "(unavailable)" for x in long).most_common(10):
        p(f"    {n:>5}  {ch}")
    p("\n  top delayed videos:")
    for t, n in Counter(x["video"]["title"] or x["video"]["video_id"] for x in long).most_common(10):
        p(f"    {n:>5}  {t[:80]}")

    p("\n  examples (ad time -> video time, gap):")
    for x in near6[:8] or long[:8]:
        p(f"    {x['ad']['local_iso'][:19]} -> {x['video']['local_iso'][:19]} "
          f"({x['gap'] / 3600:.2f}h)  {(x['video']['title'] or '')[:60]}")
    return "\n".join(lines)
