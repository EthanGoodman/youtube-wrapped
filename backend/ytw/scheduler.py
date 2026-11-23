"""Background sync for live sources (Last.fm, Steam, Trakt, Plex…), inside the app: no extra service.

- A connector is live when its manifest sets `sync_every` (seconds) and it implements sync(),
  which fetches only what's new since its cursor (Connector.cursor / set_cursor).
- One thread ticks every 30 s and starts due syncs through the same job runner the Data sources
  page uses, so a scheduled sync never collides with a button click.
- Never more often than the platform needs (and never under 5 minutes).
- A failed sync is retried later and later (interval x 2^failures, at most a day); after 5 failures
  in a row the source pauses itself and the page says why. Network retries and the per-host
  circuit breaker are in net.py.
- People can pause and resume any source; that choice is saved in data/.sync.json.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from . import platforms
from .connectors.base import Connector

if TYPE_CHECKING:
    from .sources import Job, JobRunner

log = logging.getLogger("ytw.scheduler")
MIN_INTERVAL_S = 300
MAX_BACKOFF_S = 86_400
AUTO_PAUSE_AFTER = 5
TICK_S = 30


@dataclass
class SyncState:
    paused: bool = False          # by the person
    auto_paused: bool = False     # by us, after repeated failures
    failures: int = 0
    last_ok: float | None = None
    last_error: str | None = None
    next_due: float = 0.0         # 0 = as soon as possible


def is_live(cls: type[Connector]) -> bool:
    return bool(cls.manifest.sync_every) and cls.sync is not Connector.sync


class Scheduler:
    def __init__(self, runner: "JobRunner", state_file: Path, clock: Callable[[], float] = time.time):
        self.runner = runner
        self.state_file = state_file
        self.clock = clock
        self.lock = threading.Lock()
        self.states: dict[str, SyncState] = self._load()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- state ----------------------------------------------------------------------
    def _load(self) -> dict[str, SyncState]:
        try:
            raw = json.loads(self.state_file.read_text(encoding="utf-8"))
            return {pid: SyncState(**{k: v for k, v in s.items() if k in SyncState.__dataclass_fields__})
                    for pid, s in raw.items() if isinstance(s, dict)}
        except (OSError, ValueError, TypeError):
            return {}

    def _save(self) -> None:
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps({p: asdict(s) for p, s in self.states.items()}), encoding="utf-8")
        except OSError as e:
            log.warning("couldn't save sync state: %s", e)

    def state(self, pid: str) -> SyncState:
        return self.states.setdefault(pid, SyncState())

    @staticmethod
    def interval(cls: type[Connector]) -> float:
        return max(float(cls.manifest.sync_every or 0), MIN_INTERVAL_S)

    def backoff(self, cls: type[Connector], failures: int) -> float:
        return min(self.interval(cls) * 2 ** failures, MAX_BACKOFF_S)

    def live(self) -> dict[str, type[Connector]]:
        return {pid: cls for pid, cls in platforms.CONNECTORS.items() if is_live(cls)}

    # -- running ----------------------------------------------------------------------
    def tick(self) -> list[str]:
        """Start every due sync. Returns the platforms started."""
        started, now = [], self.clock()
        for pid in self.live():
            with self.lock:
                s = self.state(pid)
                if s.paused or s.auto_paused or now < s.next_due or self.runner.busy(pid):
                    continue
            try:
                self.runner.start(pid, "sync")
                started.append(pid)
            except Exception as e:  # Busy (a click won the race) or unknown: try again next tick
                log.debug("sync %s not started: %s", pid, e)
        return started

    def on_finish(self, job: "Job") -> None:
        """Called by the job runner after every job; only sync results move the schedule."""
        cls = platforms.CONNECTORS.get(job.platform)
        if job.step != "sync" or cls is None or not is_live(cls):
            return
        now = self.clock()
        with self.lock:
            s = self.state(job.platform)
            if job.state == "done":
                s.failures, s.last_error, s.last_ok = 0, None, now
                s.next_due = now + self.interval(cls)
            elif job.state == "failed":
                s.failures += 1
                s.last_error = job.error
                s.next_due = now + self.backoff(cls, s.failures)
                if s.failures >= AUTO_PAUSE_AFTER:
                    s.auto_paused = True
                    log.warning("%s paused after %d failed syncs: %s", job.platform, s.failures, job.error)
            else:                                          # cancelled: try again at the normal pace
                s.next_due = now + self.interval(cls)
            self._save()

    def pause(self, pid: str) -> SyncState:
        with self.lock:
            s = self.state(pid)
            s.paused = True
            self._save()
            return s

    def resume(self, pid: str) -> SyncState:
        with self.lock:
            s = self.state(pid)
            s.paused = s.auto_paused = False
            s.failures, s.last_error, s.next_due = 0, None, 0.0     # sync on the next tick
            self._save()
            return s

    def forget(self, pid: str) -> None:
        """The platform's data was deleted: start over (keep a pause the person chose)."""
        with self.lock:
            paused = self.states.get(pid, SyncState()).paused
            self.states[pid] = SyncState(paused=paused)
            self._save()

    def describe(self, pid: str) -> dict | None:
        cls = self.live().get(pid)
        if cls is None:
            return None
        s = self.state(pid)
        return {"every": self.interval(cls), "paused": s.paused, "auto_paused": s.auto_paused,
                "failures": s.failures, "last_ok": s.last_ok, "last_error": s.last_error,
                "next_due": max(s.next_due, self.clock()) if not (s.paused or s.auto_paused) else None}

    # -- the thread -------------------------------------------------------------------
    def start(self) -> None:
        if self._thread or not self.live():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="sync-scheduler", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception:
                log.exception("scheduler tick failed")
            self._stop.wait(TICK_S)

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None
