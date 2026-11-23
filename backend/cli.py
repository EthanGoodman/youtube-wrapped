"""YouTube Wrapped command line.

    python backend/cli.py ingest
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
_VENV_PY = ROOT_DIR / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
if __name__ == "__main__" and _VENV_PY.exists() and Path(sys.executable).resolve() != _VENV_PY.resolve():
    import subprocess  # rerun with the project's Python, which has every dependency (e.g. keyring)
    sys.exit(subprocess.call([str(_VENV_PY), __file__, *sys.argv[1:]]))

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ytw import db, platforms, secrets  # noqa: E402
from ytw.config import force_utf8_stdout, load_config, migrate_legacy_layout  # noqa: E402
from ytw.connectors.base import ConnectorError  # noqa: E402

# CLI options a connector step may use; each connector takes the ones it understands
STEP_OPTIONS = ("watch", "search", "profile", "retry_missing", "skip_ads", "budget")


def run_step(step: str):
    """ingest / build / enrich / fetch: the same command for every platform, run by its connector."""
    def cmd(args, cfg) -> None:
        c = platforms.connector(args.platform, cfg)
        if c is None:
            p = platforms.get(args.platform)
            sys.exit(f"{p.name} isn't supported yet - see issue #{p.issue}.")
        opts = {k: getattr(args, k) for k in STEP_OPTIONS if getattr(args, k, None) is not None}
        try:
            getattr(c, step)(**opts)
        except ConnectorError as e:
            sys.exit(str(e))
    return cmd


def cmd_investigate_delay(args, cfg) -> None:
    from ytw.connectors.youtube.investigate import report as delay_report
    conn = db.connect(cfg.db_path)
    print(delay_report(conn, cfg.section("background").get("keywords", []), args.min_gap_hours))


def cmd_secrets(args, _cfg) -> None:
    """Keys, tokens and cookies live in the OS keychain. Values are typed at a hidden prompt,
    so they never land in shell history, and are never printed."""
    import getpass
    from ytw.config import ROOT
    st = secrets.store()
    if args.action == "list":
        found = st.names()
        print(f"Secrets are kept in {st.where}.")
        for name, desc in secrets.KNOWN.items():
            print(f"  {name:<20} {found.get(name, 'not set'):<20} {desc}")
        for name in sorted(set(found) - set(secrets.KNOWN)):
            print(f"  {name:<20} {found[name]}")
    elif args.action == "set":
        if not args.name:
            sys.exit("Which one? e.g. secrets set TMDB_TOKEN  (known: " + ", ".join(secrets.KNOWN) + ")")
        value = getpass.getpass(f"Paste {args.name} (hidden), then Enter: ")
        st.set(args.name, value)
        print(f"Saved {args.name} in {st.where}.")
        if args.name in os.environ:
            print(f"Note: {args.name} is also set in your environment / .env, which takes precedence. "
                  "Run `secrets migrate` or remove it there.")
    elif args.action == "delete":
        if not args.name:
            sys.exit("Which one? e.g. secrets delete TMDB_TOKEN")
        print(f"Deleted {args.name}." if st.delete(args.name) else f"{args.name} wasn't saved.")
    elif args.action == "migrate":
        from_file = secrets.migrate_file(st)
        if from_file:
            print(f"Moved {', '.join(from_file)} from {st.fallback.name} into {st.where} and deleted the file.")
        moved = secrets.migrate_env(ROOT / ".env", st)
        if moved:
            print(f"Moved {', '.join(moved)} from .env into {st.where}.")
        if not (moved or from_file):
            print("Nothing to move.")


def main() -> None:
    force_utf8_stdout()
    secrets.install_log_redaction()
    ap = argparse.ArgumentParser(prog="ytw")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ingest", help="Load Takeout JSON into the database")
    p.add_argument("--watch", help="path to watch-history.json (default: data/youtube/)")
    p.add_argument("--search", help="path to search-history.json (default: data/youtube/)")
    p.add_argument("--profile", help="Netflix: which profile to import from a full export")
    p.set_defaults(func=run_step("ingest"))

    p = sub.add_parser("enrich", help="Fetch video/channel details from the YouTube Data API")
    p.add_argument("--retry-missing", action="store_true", help="refetch IDs the API didn't return before")
    p.add_argument("--skip-ads", action="store_true", help="don't look up ad videos")
    p.add_argument("--budget", type=int, help="max quota units to use today")
    p.set_defaults(func=run_step("enrich"))

    p = sub.add_parser("build", help="Recompute watch time, sessions and rollups (after editing config)")
    p.set_defaults(func=run_step("build"))

    p = sub.add_parser("fetch", help="Crunchyroll: download your watch history with your browser cookie")
    p.set_defaults(func=run_step("fetch"))

    p = sub.add_parser("secrets", help="Save, list or remove API keys, tokens and cookies (OS keychain)")
    p.add_argument("action", choices=["list", "set", "delete", "migrate"])
    p.add_argument("name", nargs="?", type=str.upper, help="e.g. TMDB_TOKEN")
    p.set_defaults(func=cmd_secrets)

    p = sub.add_parser("investigate-delay", help="Report on videos logged hours after their pre-roll ad")
    p.add_argument("--min-gap-hours", type=float, default=1.0)
    p.set_defaults(func=cmd_investigate_delay)

    for name, sp in sub.choices.items():
        if name not in ("investigate-delay", "secrets"):
            sp.add_argument("--platform", default=platforms.DEFAULT, choices=sorted(platforms.PLATFORMS),
                            help="which platform (default: youtube)")

    args = ap.parse_args()
    p = platforms.get(getattr(args, "platform", platforms.DEFAULT))
    if not p.implemented and args.cmd not in ("fetch", "secrets"):  # fetching comes before a platform is switched on
        sys.exit(f"{p.name} isn't supported yet - see issue #{p.issue}.\n"
                 f"How to get the data when it is: " + "; ".join(p.export_steps))
    cfg = load_config()
    for m in migrate_legacy_layout(cfg):
        print(f"Moved {m}")
    args.func(args, cfg)


if __name__ == "__main__":
    main()
