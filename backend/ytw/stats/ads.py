"""The ads you sat through (from entries marked "From Google Ads")."""
from __future__ import annotations

import sqlite3

from .common import Range

# Advertiser: the ad video's channel (from the API), else the hint from Takeout
_BRAND = "COALESCE(v.channel_title, e.brand_hint)"


def ads(conn: sqlite3.Connection, r: Range, limit: int = 15) -> dict:
    p = r.params()
    q = lambda sql, *extra: conn.execute(sql, [*p, *extra]).fetchall()  # noqa: E731
    counts = dict(q("SELECT kind, COUNT(*) FROM entries WHERE local_date BETWEEN ? AND ? "
                    "AND kind IN ('ad', 'ad_impression', 'ad_click') GROUP BY kind"))
    n_ads = counts.get("ad", 0)
    prerolls = q("SELECT COUNT(*) FROM entries WHERE local_date BETWEEN ? AND ? AND kind='ad' "
                 "AND preroll_for IS NOT NULL")[0][0]
    watch_h = (q("SELECT SUM(CASE WHEN is_background=1 THEN 0 ELSE est_s END) FROM watches "
                 "WHERE local_date BETWEEN ? AND ?")[0][0] or 0) / 3600

    most_repeated = [dict(zip(("video_id", "count", "title", "brand", "thumb", "first", "last"), row))
                     for row in q(f"""
        SELECT e.video_id, COUNT(*) n, COALESCE(v.title, MAX(e.title)), {_BRAND}, v.thumb_small,
               MIN(e.local_date), MAX(e.local_date)
        FROM entries e LEFT JOIN videos v ON v.video_id = e.video_id AND v.status = 'ok'
        WHERE e.local_date BETWEEN ? AND ? AND e.kind = 'ad' AND e.video_id IS NOT NULL
        GROUP BY e.video_id ORDER BY n DESC, e.video_id LIMIT ?""", limit)]

    brands = [{"brand": b, "count": n, "distinct_ads": d} for b, n, d in q(f"""
        SELECT {_BRAND} AS b, COUNT(*) n, COUNT(DISTINCT e.video_id) d
        FROM entries e LEFT JOIN videos v ON v.video_id = e.video_id AND v.status = 'ok'
        WHERE e.local_date BETWEEN ? AND ? AND e.kind IN ('ad', 'ad_click') AND b IS NOT NULL
        GROUP BY b ORDER BY n DESC, b LIMIT ?""", limit)]
    identified = q(f"""SELECT COUNT(*) FROM entries e
        LEFT JOIN videos v ON v.video_id = e.video_id AND v.status = 'ok'
        WHERE e.local_date BETWEEN ? AND ? AND e.kind = 'ad' AND {_BRAND} IS NOT NULL""")[0][0]

    busiest = q("SELECT local_date, COUNT(*) n FROM entries WHERE local_date BETWEEN ? AND ? "
                "AND kind='ad' GROUP BY 1 ORDER BY n DESC, 1 LIMIT 1")
    clicks = [dict(zip(("local_iso", "title", "brand"), row)) for row in q(
        "SELECT local_iso, title, brand_hint FROM entries WHERE local_date BETWEEN ? AND ? "
        "AND kind='ad_click' ORDER BY epoch DESC, dedupe_key LIMIT ?", limit)]
    by_year = [{"year": int(y), "count": n} for y, n in q(
        "SELECT substr(local_date, 1, 4), COUNT(*) FROM entries WHERE local_date BETWEEN ? AND ? "
        "AND kind='ad' GROUP BY 1 ORDER BY 1")]
    return {
        "ads": n_ads, "homepage_impressions": counts.get("ad_impression", 0),
        "clicks": counts.get("ad_click", 0), "prerolls_linked": prerolls,
        "ads_per_watch_hour": n_ads / watch_h if watch_h else None,
        "brand_identified_pct": identified / n_ads if n_ads else None,
        "most_repeated": most_repeated, "top_brands": brands,
        "busiest_day": {"date": busiest[0][0], "count": busiest[0][1]} if busiest else None,
        "recent_clicks": clicks, "by_year": by_year,
    }
