"""Every registered connector passes the same contract (see connector_contract.py)."""
import pytest
from connector_contract import FIXTURES, run_contract

from ytw.connectors import CONNECTORS, PLATFORMS


@pytest.mark.parametrize("pid", sorted(CONNECTORS))
def test_contract(pid, tmp_path, monkeypatch):
    run_contract(CONNECTORS[pid], FIXTURES / pid, tmp_path, monkeypatch)


def test_registry():
    assert list(CONNECTORS) == sorted(CONNECTORS) or set(CONNECTORS) == {"youtube", "netflix", "crunchyroll"}
    assert {"youtube", "netflix", "crunchyroll"} <= set(CONNECTORS)
    assert all(PLATFORMS[p].implemented for p in CONNECTORS)
    # implemented without a connector: only views built from other platforms (All games), which stay off the shelf
    assert not any(p.implemented for pid, p in PLATFORMS.items() if pid not in CONNECTORS and p.shelf)
    orders = [p.order for p in PLATFORMS.values()]
    assert orders == sorted(orders)                     # hub order
