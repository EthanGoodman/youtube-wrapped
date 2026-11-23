"""A connector made by scripts/new_connector.py passes the connector contract as generated (#14)."""
import importlib.util
import sys
from pathlib import Path

import pytest
from connector_contract import run_contract

from ytw import connectors

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import new_connector  # noqa: E402


def test_scaffolded_connector_passes_the_contract(tmp_path, monkeypatch):
    code, fixture = new_connector.generate("sampleflix", "Sample Flix", "video", root=tmp_path)
    spec = importlib.util.spec_from_file_location("sampleflix_connector", code)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cls = mod.CONNECTOR
    assert cls.__name__ == "SampleFlix" and cls.manifest.id == "sampleflix"
    # register it the way discovery would, for the API part of the contract
    monkeypatch.setitem(connectors.CONNECTORS, "sampleflix", cls)
    monkeypatch.setitem(connectors.PLATFORMS, "sampleflix", cls.manifest)
    run_contract(cls, fixture.parent, tmp_path / "run", monkeypatch)


@pytest.mark.parametrize("pid, name, family", [
    ("Bad", "X", "video"), ("x", "X", "video"), ("ok_id", "X", "cooking"), ("ok_id", 'Bad"Name', "video"),
    ("youtube", "YouTube", "video"),
])
def test_scaffold_refuses_bad_input(pid, name, family):
    with pytest.raises(ValueError):
        new_connector.generate(pid, name, family)          # real repo root: must not write anything
    assert not (ROOT / "backend/ytw/connectors/ok_id").exists()
