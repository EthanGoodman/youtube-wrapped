"""The games family's shared pieces (#21): turning lifetime playtime into dated play.

Game platforms (Steam, PlayStation, Xbox) give running totals, not a log of sessions. Two sources date the hours:
  - daily snapshots of every game's total: the growth from one day to the next is real play that day (exact);
  - before the first snapshot, a game's hours are spread over the days it showed activity (achievement unlocks),
    weighted by how much happened each day; a game with no dated activity goes on its last-played day. These
    are estimates and are marked so (est_method "estimate").

A games connector's build() writes the shared tables like every platform: one View per game per day played
(kind "play", item = creator = the game, so top lists rank games), Items/Creators for the games, plus its own
achievements table for the achievement pages.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Iterable


def snapshot_deltas(snapshots: dict[date, dict[str, int]]) -> list[tuple[date, str, int]]:
    """Daily totals {day: {game: minutes}} -> (day, game, minutes played that day): the growth since the previous
    snapshot, dated on the later day. The first snapshot is the baseline (nothing before it is dated here); a total
    that goes down (refunds, family sharing) counts as no play."""
    out: list[tuple[date, str, int]] = []
    prev: dict[str, int] | None = None
    for day in sorted(snapshots):
        cur = snapshots[day]
        if prev is not None:
            for game in sorted(cur):
                grew = cur[game] - prev.get(game, 0)
                if grew > 0:
                    out.append((day, game, grew))
        prev = cur
    return out


def spread(minutes: int, activity: Iterable[date], fallback: date | None) -> list[tuple[date, int]]:
    """Spread `minutes` over activity days, weighted by how often each day appears (e.g. one entry per achievement).
    No activity -> all on `fallback` (the last-played day); no fallback either -> nothing can be dated. Whole minutes,
    and the parts always add up to `minutes` (the remainder goes to the busiest days first)."""
    if minutes <= 0:
        return []
    weight: dict[date, int] = defaultdict(int)
    for d in activity:
        weight[d] += 1
    if not weight:
        return [(fallback, minutes)] if fallback else []
    total = sum(weight.values())
    days = sorted(weight, key=lambda d: (-weight[d], d))
    parts = {d: minutes * weight[d] // total for d in days}
    left = minutes - sum(parts.values())
    for d in days[:left]:
        parts[d] += 1
    return sorted((d, m) for d, m in parts.items() if m > 0)
