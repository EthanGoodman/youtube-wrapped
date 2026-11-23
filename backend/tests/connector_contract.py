"""The contract every connector passes (#14): build from its fixtures with the network blocked, then

- the manifest is complete and consistent
- ingest fills the generic tables and stamps built_at
- importing the same files again changes nothing (no duplicates, nothing lost)
- build() alone reproduces the same tables
- unknown extra fields/columns in the export (schema drift) are ignored, not fatal
- the API answers for it: meta, overview, top lists, patterns, records and Wrapped for each year

Each connector ships raw sample files in tests/fixtures/<id>/ (made-up data, never real exports).
"""
from __future__ import annotations

import copy
import csv
import json
import re
import shutil
import sqlite3
from pathlib import Path

from conftest import make_client

from ytw import net
from ytw.api import create_app
from ytw.config import load_config
from ytw.connectors.base import AUTH_KINDS, FAMILIES, Connector

FIXTURES = Path(__file__).parent / "fixtures"
TABLES = ("watches", "items", "creators", "item_genres", "catalog_episodes")


def _no_network(req):
    raise AssertionError(f"connector tried the network during a build: {req.url[:60]}")


def _dump(db_path: Path) -> dict:
    conn = sqlite3.connect(db_path)
    try:
        out = {}
        for t in TABLES:
            try:
                out[t] = sorted(conn.execute(f"SELECT * FROM {t}").fetchall(), key=repr)
            except sqlite3.OperationalError:
                out[t] = None
        return out
    finally:
        conn.close()


def _drift(folder: Path) -> None:
    """Add fields/columns the connector has never seen to every export file."""
    def walk(x):
        if isinstance(x, dict):
            for v in x.values():
                walk(v)
            x["zz_new_field_from_the_future"] = {"nested": [1, "two"]}
        elif isinstance(x, list):
            for v in x:
                walk(v)
    for p in folder.rglob("*.json"):
        data = json.loads(p.read_text(encoding="utf-8"))
        walk(data)
        p.write_text(json.dumps(data), encoding="utf-8")
    for p in folder.rglob("*.csv"):
        with p.open(encoding="utf-8", newline="") as f:
            rows = list(csv.reader(f))
        rows = [r + (["Brand New Column"] if i == 0 else ["?"]) for i, r in enumerate(rows) if r]
        with p.open("w", encoding="utf-8", newline="") as f:
            csv.writer(f, quoting=csv.QUOTE_ALL).writerows(rows)


def check_manifest(cls: type[Connector]) -> None:
    m = cls.manifest
    assert re.fullmatch(r"[a-z][a-z0-9_]{1,30}", m.id), m.id
    assert m.name and m.implemented and m.theme
    assert {"creator", "creators", "item", "items", "verb", "verbed", "time"} <= set(m.vocab)
    assert m.family in FAMILIES and m.auth in AUTH_KINDS
    assert m.export_steps, "tell people how to get their data"
    for host, prefix in m.image_hosts:
        assert "/" not in host and ":" not in host and prefix.startswith("/"), (host, prefix)
    for name in m.secrets:
        assert re.fullmatch(r"[A-Z][A-Z0-9_]+", name), name


def run_contract(cls: type[Connector], fixtures: Path, tmp: Path, monkeypatch) -> None:
    check_manifest(cls)
    pid = cls.manifest.id
    assert fixtures.is_dir() and any(fixtures.iterdir()), f"{pid}: ship sample exports in {fixtures}"
    monkeypatch.setattr(net, "client", net.Http(_no_network))
    monkeypatch.setattr(net, "resolver", lambda host, port: _no_network(type("R", (), {"url": host})))

    def fresh(name: str, drift: bool = False):
        data = tmp / name
        shutil.copytree(fixtures, data / pid)
        if drift:
            _drift(data / pid)
        cfg = load_config()
        cfg.raw = copy.deepcopy(cfg.raw)
        cfg.raw["general"]["data_dir"] = str(data)
        lines: list[str] = []
        return cls(cfg, out=lines.append), cfg, lines

    c, cfg, lines = fresh("first")
    c.ingest()
    db_path = cfg.platform_db(pid)
    base = _dump(db_path)
    assert base["watches"], f"{pid}: ingest produced no watches"
    assert base["items"], f"{pid}: ingest produced no items"
    assert lines, f"{pid}: say what was imported"
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT value FROM meta WHERE key = 'built_at'").fetchone(), "finish_build() not called"
    assert conn.execute("SELECT COUNT(*) FROM watches WHERE est_s < 0 OR local_date NOT LIKE '____-__-__'").fetchone()[0] == 0
    conn.close()

    c.ingest()
    assert _dump(db_path) == base, f"{pid}: importing the same files twice changed the data"
    c.build()
    assert _dump(db_path) == base, f"{pid}: build() alone didn't reproduce the tables"

    d, dcfg, _ = fresh("drift", drift=True)
    d.ingest()
    drifted = _dump(dcfg.platform_db(pid))
    assert drifted["watches"] == base["watches"], f"{pid}: unknown fields in the export changed the result"

    client = make_client(create_app(cfg, db_paths={pid: db_path}, static_dir=tmp / "nodist"))
    q = f"platform={pid}&range=all"
    meta = client.get(f"/api/meta?platform={pid}")
    assert meta.status_code == 200, meta.text
    for url in (f"/api/overview?{q}", f"/api/top/channels?{q}", f"/api/top/videos?{q}",
                f"/api/patterns/calendar?{q}", f"/api/patterns/monthly?{q}", f"/api/records?{q}",
                f"/api/recent?platform={pid}", f"/api/milestones?platform={pid}"):
        r = client.get(url)
        assert r.status_code == 200, (url, r.status_code, r.text[:200])
    for year in meta.json()["years"]:
        r = client.get(f"/api/wrapped/{year}?platform={pid}")
        assert r.status_code == 200, (year, r.status_code, r.text[:200])
