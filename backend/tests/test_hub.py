"""The hub's year boxes: hours per year summed across platform databases."""
import copy
import shutil
import sqlite3

from conftest import make_client
from connector_contract import FIXTURES

from ytw.api import create_app
from ytw.config import load_config
from ytw.connectors import CONNECTORS


def test_hub_years_sum_every_platform(tmp_path):
    cfg = load_config()
    cfg.raw = copy.deepcopy(cfg.raw)
    cfg.raw["general"]["data_dir"] = str(tmp_path / "data")
    for pid in ("netflix", "crunchyroll"):
        shutil.copytree(FIXTURES / pid, cfg.platform_dir(pid))
        c = CONNECTORS[pid](cfg, out=lambda s: None)
        c.ingest()
        c.close()
    client = make_client(create_app(cfg, static_dir=tmp_path / "nodist"))
    years = client.get("/api/hub/years").json()

    expected: dict[int, dict[str, int]] = {}
    for pid in ("netflix", "crunchyroll"):
        conn = sqlite3.connect(cfg.platform_db(pid))
        for y, s in conn.execute("SELECT year, SUM(CASE WHEN is_background = 1 THEN 0 ELSE est_s END) FROM watches GROUP BY year"):
            expected.setdefault(y, {})[pid] = s
        conn.close()
    assert [y["year"] for y in years] == sorted(expected)                       # oldest first
    for y in years:
        assert y["by_platform"] == expected[y["year"]]
        assert y["est_s"] == sum(expected[y["year"]].values())
    assert any(len(y["by_platform"]) == 2 for y in years)                       # a year with both apps


def test_hub_years_empty_without_data(tmp_path):
    cfg = load_config()
    cfg.raw = copy.deepcopy(cfg.raw)
    cfg.raw["general"]["data_dir"] = str(tmp_path / "data")
    client = make_client(create_app(cfg, static_dir=tmp_path / "nodist"))
    assert client.get("/api/hub/years").json() == []
    assert client.get("/api/hub/years", headers={"X-Wrapped-Token": ""}).status_code == 401
