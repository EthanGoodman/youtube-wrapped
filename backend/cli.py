"""YouTube Wrapped command line.

    python backend/cli.py ingest
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ytw import db  # noqa: E402
from ytw.config import force_utf8_stdout, load_config  # noqa: E402
from ytw.ingest import ingest_search_history, ingest_watch_history, kind_counts  # noqa: E402
from ytw.investigate import report as delay_report  # noqa: E402
from ytw.preroll import link_prerolls  # noqa: E402


def cmd_ingest(args, cfg) -> None:
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
    conn.close()


def cmd_investigate_delay(args, cfg) -> None:
    conn = db.connect(cfg.db_path)
    print(delay_report(conn, cfg.section("background").get("keywords", []), args.min_gap_hours))


def main() -> None:
    force_utf8_stdout()
    ap = argparse.ArgumentParser(prog="ytw")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ingest", help="Load Takeout JSON into the database")
    p.add_argument("--watch", help="path to watch-history.json (default: data/)")
    p.add_argument("--search", help="path to search-history.json (default: data/)")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("investigate-delay", help="Report on videos logged hours after their pre-roll ad")
    p.add_argument("--min-gap-hours", type=float, default=1.0)
    p.set_defaults(func=cmd_investigate_delay)

    args = ap.parse_args()
    args.func(args, load_config())


if __name__ == "__main__":
    main()
