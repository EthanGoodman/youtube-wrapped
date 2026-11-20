"""YouTube Wrapped command line.

    python backend/cli.py ingest
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ytw import db, platforms  # noqa: E402
from ytw.config import force_utf8_stdout, load_config, migrate_legacy_layout  # noqa: E402
from ytw.ingest import ingest_search_history, ingest_watch_history, kind_counts  # noqa: E402
from ytw import enrich  # noqa: E402
from ytw.investigate import report as delay_report  # noqa: E402
from ytw.preroll import link_prerolls  # noqa: E402
from ytw.lookups import build_lookups  # noqa: E402
from ytw.watchtime import WatchConfig, build_watches  # noqa: E402


def netflix_ingest(args, cfg) -> None:
    from ytw.netflix import ingest as nf
    folder = cfg.platform_dir("netflix")
    conn = db.connect(cfg.platform_db("netflix"))
    nf.init(conn)
    profile = getattr(args, "profile", None) or cfg.section("netflix").get("profile") or None
    try:
        res = nf.ingest(conn, folder, cfg.tz, profile)
    except (FileNotFoundError, ValueError) as e:
        sys.exit(str(e))
    kind = "full export (times + durations)" if res["format"] == "full" else "quick download (dates only)"
    print(f"Netflix: read {res['file']} - {kind}: {res['rows']:,} rows, "
          f"{res['supplemental']:,} trailers/previews skipped")
    netflix_build(conn, cfg)


def netflix_build(conn, cfg) -> None:
    from ytw.netflix import ingest as nf
    n = nf.build(conn, cfg.tz, cfg.section("netflix"), cfg.section("watchtime").get("session_gap_minutes", 30) * 60)
    r = conn.execute("SELECT COUNT(DISTINCT channel_id), SUM(kind='episode'), SUM(kind='movie'), SUM(est_s)/3600.0, "
                     "MIN(local_date), MAX(local_date) FROM watches").fetchone()
    print(f"Built {n:,} views: {r[1]:,} episodes of {r[0]:,} shows, {r[2]:,} movies, "
          f"{r[3]:,.0f} h ({r[4]} -> {r[5]})")


def netflix_enrich(args, cfg) -> None:
    import os
    from ytw.netflix import tmdb
    token = os.environ.get("TMDB_TOKEN")
    if not token:
        sys.exit("No TMDB_TOKEN in .env. Get a free API Read Access Token at themoviedb.org "
                 "(Settings -> API) - see the README.")
    conn = db.connect(cfg.platform_db("netflix"))
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'views'").fetchone():
        sys.exit("No Netflix data yet. Run `python backend/cli.py ingest --platform netflix` first.")
    overrides = tmdb.load_overrides(cfg.platform_dir("netflix") / "overrides.toml")
    try:
        r = tmdb.enrich(conn, tmdb.http_fetcher(token), overrides,
                        progress=lambda s: print(f"  {s[:70]:<70}", end="\r", flush=True))
    except tmdb.TmdbError as e:
        sys.exit(str(e))
    print(" " * 75, end="\r")
    print(f"TMDB: {r['shows_found']}/{r['shows']} shows and {r['movies_found']}/{r['movies']} movies matched, "
          f"{r['one_offs']} one-off titles settled ({r['requests']} requests). "
          "Fix wrong matches in data/netflix/overrides.toml.")
    netflix_build(conn, cfg)


def cmd_ingest(args, cfg) -> None:
    if args.platform == "netflix":
        return netflix_ingest(args, cfg)
    conn = db.connect(cfg.db_path)
    db.init_db(conn)
    if cfg.tz.key != (db.get_meta(conn, "timezone") or cfg.tz.key):
        print(f"Timezone changed to {cfg.tz.key}; rebuilding entries.")
        conn.execute("DELETE FROM entries")
        conn.execute("DELETE FROM searches")

    watch = Path(args.watch) if args.watch else cfg.data_dir / "watch-history.json"
    if not watch.exists():
        sys.exit(f"Not found: {watch}\nPut your Takeout watch-history.json in {cfg.data_dir}")
    t = time.perf_counter()
    res = ingest_watch_history(conn, watch, cfg.tz)
    print(f"Watch history: parsed {res['parsed']:,}, added {res['added']:,} new "
          f"({time.perf_counter() - t:.1f}s)")

    n = link_prerolls(conn, cfg.section("ads").get("preroll_window_seconds", 60))
    print(f"Pre-roll ads linked to a video: {n:,}")

    search = Path(args.search) if args.search else cfg.data_dir / "search-history.json"
    if search.exists():
        res = ingest_search_history(conn, search, cfg.tz)
        print(f"Search history: parsed {res['parsed']:,} ({res['searches']:,} real searches), "
              f"added {res['added']:,} new")
    else:
        print("Search history: not found (optional)")

    print("\nEntries by type:")
    for kind, n in kind_counts(conn).items():
        print(f"  {kind:<15}{n:>10,}")
    row = conn.execute("SELECT MIN(local_iso), MAX(local_iso) FROM entries").fetchone()
    print(f"\nRange: {row[0]}  ->  {row[1]}")
    rebuild(conn, cfg)
    conn.close()


def cmd_investigate_delay(args, cfg) -> None:
    conn = db.connect(cfg.db_path)
    print(delay_report(conn, cfg.section("background").get("keywords", []), args.min_gap_hours))


def cmd_enrich(args, cfg) -> None:
    if args.platform == "netflix":
        return netflix_enrich(args, cfg)
    conn = db.connect(cfg.db_path)
    db.init_db(conn)
    if not conn.execute("SELECT 1 FROM entries LIMIT 1").fetchone():
        sys.exit("No data yet. Run `python backend/cli.py ingest` first.")
    if not cfg.api_key:
        print("No YOUTUBE_API_KEY in .env, skipping enrichment. The app still works with "
              "reduced stats (no durations, categories, genres or thumbnails).")
        return
    from tqdm import tqdm

    api = cfg.section("api")
    budget = args.budget or api.get("daily_budget_units", 9500)
    used = enrich.units_used_today(conn)
    print(f"Quota used today (Pacific day {enrich.quota_day()}): {used:,} / budget {budget:,}")
    e = enrich.Enricher(
        conn, cfg.api_key, budget=budget, batch_size=api.get("batch_size", 50),
        progress=lambda total, desc: tqdm(total=total, desc=f"{desc:<8}", unit="id", ncols=90))
    try:
        r = e.run(include_ads=api.get("fetch_ad_videos", True) and not args.skip_ads,
                  retry_missing=args.retry_missing,
                  shorts_max_duration=cfg.section("shorts").get("max_duration_seconds", 180))
    except enrich.ApiKeyError as err:
        sys.exit(f"The API rejected your key: {err}\nCheck YOUTUBE_API_KEY in .env and that "
                 "'YouTube Data API v3' is enabled for the key's project.")
    except enrich.ApiError as err:
        sys.exit(f"API error: {err}\nProgress so far is saved; rerun to continue.")

    print(f"\nThis run: {r.units:,} units. Videos found {r.videos_ok:,}, missing {r.videos_missing:,}. "
          f"Channels found {r.channels_ok:,}, missing {r.channels_missing:,}."
          + (f" Categories: {r.categories}." if r.categories else "")
          + (f" Video shapes checked: {r.shapes:,}." if r.shapes else ""))
    if r.stopped:
        print(f"Stopped early ({r.stopped}). {r.videos_left:,} videos and {r.channels_left:,} channels "
              "left; rerun after the quota resets (midnight Pacific) to continue.")
    c = enrich.coverage(conn)
    pct = 100 * c["watched_ok"] / max(1, c["watched_ids"])
    print(f"Coverage: {c['watched_ok']:,} of {c['watched_ids']:,} watched video IDs enriched ({pct:.1f}%); "
          f"{c['unavailable_recovered']:,} 'unavailable' videos recovered; "
          f"{c['channels_ok']:,} channels. Quota used today: {c['units_today']:,}.")
    rebuild(conn, cfg)


def rebuild(conn, cfg) -> None:
    """Recompute derived tables (watch time, sessions, rollups)."""
    t = time.perf_counter()
    n = build_watches(conn, WatchConfig.from_config(cfg), cfg.tz)
    tg = cfg.section("tags")
    nt, ng = build_lookups(conn, frozenset(tg.get("stopwords", [])), tg.get("min_videos", 2))
    conn.execute("ANALYZE")
    db.set_meta(conn, "built_at", datetime.now(timezone.utc).isoformat())
    conn.commit()
    print(f"Built {n:,} watches, {nt:,} genre and {ng:,} tag links ({time.perf_counter() - t:.1f}s)")


def cmd_build(args, cfg) -> None:
    if args.platform == "netflix":
        conn = db.connect(cfg.platform_db("netflix"))
        return netflix_build(conn, cfg)
    conn = db.connect(cfg.db_path)
    db.init_db(conn)
    rebuild(conn, cfg)
    r = conn.execute(
        "SELECT COUNT(*), SUM(est_s)/3600.0, SUM(max_s)/3600.0, COUNT(DISTINCT session_id), "
        "SUM(delayed_fix), SUM(is_background), SUM(bucket='short'), SUM(bucket='music') FROM watches").fetchone()
    print(f"  estimated watch time: {r[1]:,.0f} h (max possible {r[2]:,.0f} h)")
    print(f"  sessions: {r[3]:,}  delayed logs fixed: {r[4]:,}  background: {r[5]:,}  "
          f"Shorts: {r[6]:,}  music: {r[7]:,}")


def main() -> None:
    force_utf8_stdout()
    ap = argparse.ArgumentParser(prog="ytw")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ingest", help="Load Takeout JSON into the database")
    p.add_argument("--watch", help="path to watch-history.json (default: data/youtube/)")
    p.add_argument("--search", help="path to search-history.json (default: data/youtube/)")
    p.add_argument("--profile", help="Netflix: which profile to import from a full export")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("enrich", help="Fetch video/channel details from the YouTube Data API")
    p.add_argument("--retry-missing", action="store_true", help="refetch IDs the API didn't return before")
    p.add_argument("--skip-ads", action="store_true", help="don't look up ad videos")
    p.add_argument("--budget", type=int, help="max quota units to use today")
    p.set_defaults(func=cmd_enrich)

    p = sub.add_parser("build", help="Recompute watch time, sessions and rollups (after editing config)")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("investigate-delay", help="Report on videos logged hours after their pre-roll ad")
    p.add_argument("--min-gap-hours", type=float, default=1.0)
    p.set_defaults(func=cmd_investigate_delay)

    for name, sp in sub.choices.items():
        if name != "investigate-delay":
            sp.add_argument("--platform", default=platforms.DEFAULT, choices=sorted(platforms.PLATFORMS),
                            help="which platform (default: youtube)")

    args = ap.parse_args()
    p = platforms.get(getattr(args, "platform", platforms.DEFAULT))
    if not p.implemented:
        sys.exit(f"{p.name} isn't supported yet - see issue #{p.issue}.\n"
                 f"How to get the data when it is: " + "; ".join(p.export_steps))
    cfg = load_config()
    for m in migrate_legacy_layout(cfg):
        print(f"Moved {m}")
    args.func(args, cfg)


if __name__ == "__main__":
    main()
