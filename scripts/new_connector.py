"""Start a new platform connector from the template.

    python scripts/new_connector.py letterboxd "Letterboxd" --family video

Creates
    backend/ytw/connectors/<id>/__init__.py   manifest + a working CSV importer to adapt
    backend/tests/fixtures/<id>/history.csv   made-up sample export (replace with the real format)
The contract tests (backend/tests/test_connectors.py) pick it up automatically: run pytest.
Then: fill in the manifest's TODOs, parse the real export format, add the platform's theme.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = ("video", "music", "games", "social", "reading", "fitness")

TEMPLATE = '''"""{name}: TODO one line on where the data comes from (export file, API, extension)."""
from __future__ import annotations

import csv
from datetime import datetime, time

from ytw import db
from ytw.connectors.base import Connector, ConnectorError, Manifest, finish_build, vocab
from ytw.connectors.store import Creator, Item, View, slug, write_creators, write_genres, write_items, write_views

HISTORY_FILE = "history.csv"   # TODO: the real export file(s). Sample columns: date, title, creator, minutes

MANIFEST = Manifest(
    "{pid}", "{name}", True, "{pid}", vocab("creator", "creators", "item", "items"),
    frozenset({{"estimated_time"}}),
    ("TODO: where to request or download the {name} data",
     "Put {{}} in data/{pid}/, then: python backend/cli.py ingest --platform {pid}".format(HISTORY_FILE)),
    "TODO: how long the export takes", family="{family}", auth="file", order=50)


class {cls}(Connector):
    manifest = MANIFEST

    def ingest(self, **_) -> None:
        self.build()  # the export file is the raw store; nothing else to read

    def build(self) -> None:
        path = self.folder / HISTORY_FILE
        if not path.exists():
            raise ConnectorError(f"No {{HISTORY_FILE}} in {{self.folder}}. " + "; ".join(MANIFEST.export_steps))
        with path.open(encoding="utf-8", newline="") as f:
            rows = sorted(csv.DictReader(f), key=lambda r: (r.get("date") or "", r.get("title") or ""))
        tz = self.cfg.tz
        views, items, creators, seen = [], {{}}, {{}}, set()
        for r in rows:
            title, day = (r.get("title") or "").strip(), (r.get("date") or "").strip()
            if not title or not day or (day, title) in seen:   # skip blanks and rows listed twice
                continue
            seen.add((day, title))
            creator = (r.get("creator") or "").strip() or None
            item_id, creator_id = "item:" + slug(title), ("creator:" + slug(creator)) if creator else None
            seconds = round(float(r.get("minutes") or 0) * 60)
            local = datetime.combine(datetime.fromisoformat(day).date(), time(0), tz)
            views.append(View(len(views) + 1, "item", item_id, creator_id, local.timestamp(), local,
                              seconds, "exact" if seconds else "fallback", duration_s=seconds or None))
            items.setdefault(item_id, Item(item_id, "ok", title, creator_id))
            if creator_id:
                creators.setdefault(creator_id, Creator(creator_id, "ok", creator))
        conn = self.connect()
        db.init_db(conn)
        conn.execute("PRAGMA foreign_keys=OFF")  # no YouTube-style raw `entries` table
        write_views(conn, views)
        write_items(conn, items.values())
        write_creators(conn, creators.values())
        write_genres(conn, {{}})
        finish_build(conn)
        self.out(f"Built {{len(views):,}} views of {{len(items):,}} items by {{len(creators):,}} creators")


CONNECTOR = {cls}
'''

SAMPLE = """date,title,creator,minutes
2025-02-01,First Sample Thing,Sample Creator,42
2025-02-01,Second Sample Thing,Sample Creator,
2025-06-15,Another Sample Thing,Other Creator,95
2025-06-15,Another Sample Thing,Other Creator,95
2026-01-03,Newest Sample Thing,,30
"""


def generate(pid: str, name: str, family: str = "video", root: Path = ROOT) -> tuple[Path, Path]:
    """Write the connector package and its sample fixture under `root`. Returns both paths."""
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,30}", pid):
        raise ValueError("id: lowercase letters, digits and _ (e.g. prime_video)")
    if family not in FAMILIES:
        raise ValueError(f"family must be one of {', '.join(FAMILIES)}")
    if not name.strip() or any(c in name for c in '"\\{}'):
        raise ValueError("name: plain text, e.g. \"Prime Video\"")
    pkg = root / "backend/ytw/connectors" / pid
    fixture = root / "backend/tests/fixtures" / pid
    if pkg.exists() or fixture.exists():
        raise ValueError(f"{pid} already exists")
    cls = "".join(w.capitalize() for w in re.split(r"[^A-Za-z0-9]+", name) if w) or pid.title()
    if not cls[0].isalpha():
        cls = "Platform" + cls
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text(TEMPLATE.format(pid=pid, name=name, family=family, cls=cls), encoding="utf-8")
    fixture.mkdir(parents=True)
    (fixture / "history.csv").write_text(SAMPLE, encoding="utf-8")
    return pkg / "__init__.py", fixture / "history.csv"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id", help="platform id, e.g. letterboxd")
    ap.add_argument("name", help='display name, e.g. "Letterboxd"')
    ap.add_argument("--family", default="video", choices=FAMILIES)
    args = ap.parse_args()
    try:
        code, fixture = generate(args.id, args.name, args.family)
    except ValueError as e:
        sys.exit(str(e))
    print(f"Created {code.relative_to(ROOT)} and {fixture.relative_to(ROOT)}.\n"
          "Next: python -m pytest backend/tests/test_connectors.py, then adapt the parser to the real export.")


if __name__ == "__main__":
    main()
