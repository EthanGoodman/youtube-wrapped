"""Games family (#21): only play that can really be dated gets a date."""
from datetime import date

from ytw.connectors.games import snapshot_deltas

D = date.fromisoformat


def test_snapshot_deltas_date_only_consecutive_days():
    snaps = {D("2026-11-25"): {"a": 100, "b": 50},
             D("2026-11-26"): {"a": 160, "b": 50, "c": 30},     # the next day: a +60, c new +30, both that day's play
             D("2026-11-28"): {"a": 150, "b": 80, "c": 30}}     # a went down: no play; b +30 over a 2-day gap: undated
    assert snapshot_deltas(snaps) == [(D("2026-11-26"), "a", 60, True), (D("2026-11-26"), "c", 30, True),
                                      (D("2026-11-28"), "b", 30, False)]
    assert snapshot_deltas({D("2026-11-25"): {"a": 100}}) == []          # one snapshot is only a baseline
