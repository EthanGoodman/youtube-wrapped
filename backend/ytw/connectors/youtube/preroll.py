"""Link ads to the video they played before (pre-roll)."""
from __future__ import annotations

import sqlite3

from .parser import AD, WATCH_KINDS


def find_prerolls(rows: list[tuple[int, str, float]], window: float) -> dict[int, int]:
    """rows: (id, kind, epoch) sorted by epoch. Returns {ad_id: video_id_row}.

    An ad is a pre-roll for the next watch entry if it is at most `window` seconds
    before it and no other watch entry lies between them. Several ads can share
    one video (double pre-roll).
    """
    links: dict[int, int] = {}
    pending: list[tuple[int, float]] = []  # ads since the last watch entry
    for rid, kind, epoch in rows:
        if kind == AD:
            pending.append((rid, epoch))
        elif kind in WATCH_KINDS:
            for ad_id, ad_epoch in pending:
                if 0 <= epoch - ad_epoch <= window:
                    links[ad_id] = rid
            pending = []
    return links


def link_prerolls(conn: sqlite3.Connection, window: float) -> int:
    rows = conn.execute("SELECT id, kind, epoch FROM entries ORDER BY epoch, id").fetchall()
    links = find_prerolls([tuple(r) for r in rows], window)
    conn.execute("UPDATE entries SET preroll_for = NULL WHERE preroll_for IS NOT NULL")
    conn.executemany("UPDATE entries SET preroll_for = ? WHERE id = ?",
                     ((vid, ad) for ad, vid in links.items()))
    conn.commit()
    return len(links)
