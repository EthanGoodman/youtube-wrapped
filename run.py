"""Start YouTube Wrapped: builds the frontend if needed, then serves it at http://localhost:8000.

    python run.py              # build if needed + serve + open the browser
    python run.py --rebuild    # force a fresh frontend build
    python run.py --port 9000 --no-browser
    python run.py --dev        # for `npm run dev`: API docs on, no app token needed (still localhost only)
    python run.py --lan        # also answer other devices on your network (app token still required)
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
DIST = FRONTEND / "dist"


def _reexec_in_venv() -> None:
    """If a .venv exists and we're not in it, rerun this script with its Python."""
    venv_py = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if venv_py.exists() and Path(sys.executable).resolve() != venv_py.resolve():
        sys.exit(subprocess.call([str(venv_py), __file__, *sys.argv[1:]]))


def _newest_mtime(path: Path) -> float:
    return max((p.stat().st_mtime for p in path.rglob("*") if p.is_file()), default=0)


def build_frontend(force: bool) -> None:
    index = DIST / "index.html"
    sources = [FRONTEND / "src", FRONTEND / "index.html", FRONTEND / "package.json"]
    newest_src = max(_newest_mtime(p) if p.is_dir() else p.stat().st_mtime for p in sources if p.exists())
    if not force and index.exists() and index.stat().st_mtime >= newest_src:
        return
    npm = shutil.which("npm")
    if not npm:
        sys.exit("Node.js/npm not found. Install Node 20+ from https://nodejs.org, then rerun.")
    if not (FRONTEND / "node_modules").exists():
        print("Installing frontend dependencies (first run only)...")
        subprocess.check_call([npm, "install", "--no-fund", "--no-audit"], cwd=FRONTEND)
    print("Building frontend...")
    subprocess.check_call([npm, "run", "build"], cwd=FRONTEND)


def main() -> None:
    _reexec_in_venv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--rebuild", action="store_true", help="force a frontend rebuild")
    ap.add_argument("--dev", action="store_true", help="development: API docs on, no app token (localhost only)")
    ap.add_argument("--lan", action="store_true", help="listen on your network too (other devices need the app token)")
    args = ap.parse_args()

    sys.path.insert(0, str(ROOT / "backend"))
    from ytw.config import force_utf8_stdout, load_config, migrate_legacy_layout
    force_utf8_stdout()
    cfg = load_config()
    for m in migrate_legacy_layout(cfg):
        print(f"Moved {m}")
    if not cfg.db_path.exists():
        sys.exit("No database yet. Put your Takeout files in data/youtube/ and run:\n"
                 "  python backend/cli.py ingest\n  python backend/cli.py enrich   (optional, needs an API key)")
    build_frontend(args.rebuild)

    import uvicorn
    from ytw.api import create_app

    if args.dev and args.lan:
        sys.exit("--dev turns the app token off, so it can't be combined with --lan.")
    if args.lan:
        print("WARNING: --lan is on. Other devices on your network can reach this app. Every API call still "
              "needs the app token, but only use this on a network you trust.")
    url = f"http://localhost:{args.port}"
    print(f"\nYouTube Wrapped is running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    # localhost only unless --lan: your history is never exposed to the network by default
    uvicorn.run(create_app(cfg, dev=args.dev, lan=args.lan), host="0.0.0.0" if args.lan else "127.0.0.1",
                port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
