"""Search history stats (only if search-history.json was imported)."""
from __future__ import annotations

import re
import sqlite3
from collections import Counter

from .common import Range

STOPWORDS = frozenset("""a an the and or of to in on for with at by from is it i you my me how what why
when who vs v is are be do does was this that your his her their our its into &""".split())
_WORD = re.compile(r"[\w']+", re.UNICODE)


def search_stats(conn: sqlite3.Connection, r: Range, limit: int = 30, all_time: bool = False) -> dict:
    """all_time: ignore the range (search history can start years before watch history)."""
    p = ("0000-01-01", "9999-12-31") if all_time else r.params()
    total_ever = conn.execute("SELECT COUNT(*) FROM searches WHERE kind='search'").fetchone()[0]
    if not total_ever:
        return {"available": False}
    rows = conn.execute("SELECT query, local_date, local_iso FROM searches WHERE kind='search' "
                        "AND local_date BETWEEN ? AND ? ORDER BY epoch", p).fetchall()
    queries = Counter()
    display = {}
    words = Counter()
    for q, _, _ in rows:
        if not q:
            continue
        key = " ".join(q.lower().split())
        queries[key] += 1
        display.setdefault(key, q)
        words.update(w for w in _WORD.findall(key) if len(w) > 2 and w not in STOPWORDS and not w.isdigit())
    months = Counter(d[:7] for _, d, _ in rows)
    first_ever = conn.execute("SELECT query, local_iso FROM searches WHERE kind='search' "
                              "ORDER BY epoch LIMIT 1").fetchone()
    return {
        "available": True,
        "searches": len(rows),
        "unique": len(queries),
        "top_searches": [{"query": display[k], "count": n} for k, n in queries.most_common(limit)],
        "top_terms": [{"term": w, "count": n} for w, n in words.most_common(limit)],
        "per_month": [{"month": m, "count": n} for m, n in sorted(months.items())],
        "first_in_range": {"query": rows[0][0], "local_iso": rows[0][2]} if rows else None,
        "first_ever": {"query": first_ever[0], "local_iso": first_ever[1]},
    }
