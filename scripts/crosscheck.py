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
print("\nALL CHECKS PASSED" if ok else "\nMISMATCHES FOUND")
sys.exit(0 if ok else 1)
