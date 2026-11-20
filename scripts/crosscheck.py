"""Independent sanity check: count things straight from the raw Takeout JSON
(stdlib only, no app code) and compare with what's in the database."""
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
raw = json.loads((ROOT / "data" / "watch-history.json").read_text(encoding="utf-8"))
conn = sqlite3.connect(ROOT / "data" / "wrapped.db")
q = lambda sql, *a: conn.execute(sql, a).fetchone()[0]  # noqa: E731

ok = True
def check(label, raw_n, db_n):
    global ok
    same = raw_n == db_n
    ok &= same
    print(f"{'OK ' if same else 'BAD'} {label:<52} raw={raw_n:>7,}  db={db_n:>7,}")

marker = lambda e: any(d.get("name") == "From Google Ads" for d in e.get("details", []))  # noqa: E731

check("total entries", len(raw), q("SELECT COUNT(*) FROM entries"))
check("ad-marked entries, excluding ad clicks/surveys",
      sum(1 for e in raw if marker(e) and not e["title"].startswith(("Visited ", "Answered survey"))),
      q("SELECT COUNT(*) FROM entries WHERE kind IN ('ad','ad_impression')"))
check("non-ad watch.v= entries with a channel (videos)",
      sum(1 for e in raw if not marker(e) and "watch?v=" in e.get("titleUrl", "")
          and e.get("subtitles") and not e["title"].startswith(("Visited ", "Answered"))),
      q("SELECT COUNT(*) FROM entries WHERE kind IN ('video','music')"))
check("non-ad watch?v= entries without a channel (unavailable)",
      sum(1 for e in raw if not marker(e) and "watch?v=" in e.get("titleUrl", "")
          and not e.get("subtitles") and not e["title"].startswith("Visited ")),
      q("SELECT COUNT(*) FROM entries WHERE kind='unavailable'"))
check("unique video IDs among videos",
      len({e["titleUrl"].split("v=")[1].split("&")[0] for e in raw
           if not marker(e) and e.get("subtitles") and "watch?v=" in e.get("titleUrl", "")}),
      q("SELECT COUNT(DISTINCT video_id) FROM entries WHERE kind IN ('video','music')"))
check("unique channel URLs among videos",
      len({e["subtitles"][0]["url"] for e in raw
           if not marker(e) and e.get("subtitles") and "watch?v=" in e.get("titleUrl", "")}),
      q("SELECT COUNT(DISTINCT channel_id) FROM entries WHERE kind IN ('video','music')"))

# Specific local days, with the UTC->local window done by hand
for day, utc_offset in (("2025-11-15", 5), ("2024-07-04", 4)):  # EST is UTC-5, EDT is UTC-4
    y, m, d = map(int, day.split("-"))
    start = datetime(y, m, d, utc_offset, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    in_day = [e for e in raw if start <= datetime.fromisoformat(e["time"].replace("Z", "+00:00")) < end]
    check(f"entries on local day {day} (hand-computed window)", len(in_day),
          q("SELECT COUNT(*) FROM entries WHERE local_date=?", day))
    check(f"videos on {day}",
          sum(1 for e in in_day if not marker(e) and e.get("subtitles") and "watch?v=" in e.get("titleUrl", "")),
          q("SELECT COUNT(*) FROM entries WHERE local_date=? AND kind IN ('video','music')", day))

first = min(raw, key=lambda e: e["time"])
print(f"\nFirst entry in raw file: {first['time']}  {first['title']}")
print("First in db:           ", conn.execute(
    "SELECT time_utc, title FROM entries ORDER BY epoch LIMIT 1").fetchone())
# Watch-time estimate for whole days, recomputed from the raw JSON with the documented rule
# (independent of the app's code; durations come from the API cache):
#   in a session (gap <= 30 min): min(duration, gap); last of a session: min(duration, 3h);
#   unknown duration: min(gap, 10 min) in a session, else 10 min.
# Days are chosen without delayed-log fixes so the simple rule applies exactly.
def utc(e):
    return datetime.fromisoformat(e["time"].replace("Z", "+00:00"))


watch_raw = sorted((e for e in raw if not marker(e) and "watch?v=" in e.get("titleUrl", "")
                    and not e["title"].startswith(("Visited ", "Answered"))
                    and "/post/" not in e.get("titleUrl", "")), key=utc)
durations = dict(conn.execute("SELECT video_id, duration_s FROM videos WHERE status='ok' "
                              "AND live='none' AND duration_s > 0"))
for day, utc_offset, show in (("2025-11-15", 5, True), ("2024-07-04", 4, False), ("2021-03-03", 5, False)):
    y, m, d = map(int, day.split("-"))
    start = datetime(y, m, d, utc_offset, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    total = 0
    lines = []
    for i, e in enumerate(watch_raw):
        if not (start <= utc(e) < end):
            continue
        vid = e["titleUrl"].split("v=")[1].split("&")[0]
        gap = (utc(watch_raw[i + 1]) - utc(e)).total_seconds() if i + 1 < len(watch_raw) else None
        dur = durations.get(vid)
        in_session = gap is not None and gap <= 1800
        if dur is None:
            est = min(gap, 600) if in_session else 600
        else:
            est = min(dur, gap) if in_session else min(dur, 10800)
        est = round(min(est, 10800))
        total += est
        lines.append(f"    {utc(e) - timedelta(hours=utc_offset):%H:%M:%S}  dur={dur}  "
                     f"gap={gap and round(gap)}  est={est}  {e['title'][8:58]}")
    db_total = q("SELECT COALESCE(SUM(est_s), 0) FROM watches WHERE local_date=?", day)
    check(f"estimated seconds on {day} (rule redone by hand)", total, db_total)
    if show:
        print("\n".join(lines))

print("\nALL CHECKS PASSED" if ok else "\nMISMATCHES FOUND")
sys.exit(0 if ok else 1)
