"""Games family (#21): dating lifetime playtime from snapshots and achievement activity."""
from datetime import date

from ytw.connectors.games import snapshot_deltas, spread

D = date.fromisoformat


def test_snapshot_deltas():
    snaps = {D("2026-11-25"): {"a": 100, "b": 50},
             D("2026-11-26"): {"a": 160, "b": 50, "c": 30},     # a +60, c new +30
             D("2026-11-28"): {"a": 150, "b": 80, "c": 30}}     # a went down: no play; b +30 (dated on the 28th)
    assert snapshot_deltas(snaps) == [(D("2026-11-26"), "a", 60), (D("2026-11-26"), "c", 30), (D("2026-11-28"), "b", 30)]
    assert snapshot_deltas({D("2026-11-25"): {"a": 100}}) == []          # one snapshot is only a baseline


def test_spread_weights_and_keeps_total():
    days = [D("2020-01-01")] * 3 + [D("2020-01-05")]          # 3 achievements one day, 1 another
    assert spread(100, days, None) == [(D("2020-01-01"), 75), (D("2020-01-05"), 25)]
    odd = spread(10, [D("2020-01-01"), D("2020-01-02"), D("2020-01-03")], None)
    assert sum(m for _, m in odd) == 10 and odd[0] == (D("2020-01-01"), 4)   # remainder to the earliest busiest day


def test_spread_fallbacks():
    assert spread(90, [], D("2023-06-01")) == [(D("2023-06-01"), 90)]        # no activity: the last-played day
    assert spread(90, [], None) == []                                        # nothing to date it by
    assert spread(0, [D("2020-01-01")], None) == []
