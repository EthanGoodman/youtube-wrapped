"""Background sync (#18) with a fake clock: intervals, backoff, auto-pause, user pause, busy sources."""
import copy
import time

import pytest
from conftest import make_client
from test_secrets import FakeKeyring

from ytw import secrets
from ytw.api import create_app
from ytw.config import load_config
from ytw.connectors import CONNECTORS, PLATFORMS
from ytw.connectors.base import Connector, ConnectorError, Manifest, vocab
from ytw.scheduler import AUTO_PAUSE_AFTER, MAX_BACKOFF_S, MIN_INTERVAL_S, Scheduler, is_live
from ytw.sources import Job


class Live(Connector):
    manifest = Manifest("livefm", "Live FM", True, "livefm", vocab("artist", "artists", "track", "tracks"),
                        export_steps=("Connect it",), family="music", auth="api_key", sync_every=900)
    fail_with: str | None = None
    calls = 0

    def sync(self, **_):
        type(self).calls += 1
        conn = self.connect()
        conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
        self.set_cursor(conn, str(type(self).calls))
        conn.commit()
        self.out(f"synced, cursor {self.cursor(conn)}")
        if type(self).fail_with:
            raise ConnectorError(type(self).fail_with)


class Quick(Live):
    manifest = Manifest("quickfm", "Quick FM", True, "quickfm", vocab("a", "b", "c", "d"),
                        export_steps=("x",), family="music", auth="api_key", sync_every=10)   # asks for 10 s


class NotLive(Connector):
    manifest = Manifest("notlive", "Not Live", True, "notlive", vocab("a", "b", "c", "d"),
                        export_steps=("x",), sync_every=900)                              # no sync(): not live


class FakeRunner:
    def __init__(self):
        self.started: list[tuple[str, str]] = []
        self.running: set[str] = set()

    def busy(self, pid):
        return pid in self.running

    def start(self, pid, step):
        self.started.append((pid, step))


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture
def sched(tmp_path, monkeypatch):
    # only the fake connectors below: real live ones (Steam's daily sync) aren't part of these tests
    for pid in [p for p, c in CONNECTORS.items() if is_live(c)]:
        monkeypatch.delitem(CONNECTORS, pid)
    for cls in (Live, Quick, NotLive):
        monkeypatch.setitem(CONNECTORS, cls.manifest.id, cls)
        monkeypatch.setitem(PLATFORMS, cls.manifest.id, cls.manifest)
    monkeypatch.setattr(Live, "fail_with", None)
    clock = Clock()
    s = Scheduler(FakeRunner(), tmp_path / ".sync.json", clock=clock)
    s.clock_ = clock
    return s


def finish(s, pid, state="done", error=None):
    j = Job(pid, "sync")
    j.state, j.error = state, error
    s.on_finish(j)


def test_only_live_sources_and_first_sync_right_away(sched):
    assert set(sched.live()) >= {"livefm", "quickfm"} and "notlive" not in sched.live()
    assert "youtube" not in sched.live()
    assert sorted(sched.tick()) == ["livefm", "quickfm"]


def test_interval_and_floor(sched):
    sched.tick()
    finish(sched, "livefm")
    finish(sched, "quickfm")
    sched.runner.started.clear()
    sched.clock_.t += MIN_INTERVAL_S                     # 5 min: Quick FM's 10 s is raised to the floor
    assert sched.tick() == ["quickfm"]
    sched.clock_.t += 900 - MIN_INTERVAL_S - 1
    assert "livefm" not in sched.tick()
    sched.clock_.t += 1
    assert "livefm" in sched.tick()


def test_backoff_then_auto_pause_then_resume(sched):
    delays = []
    for _ in range(AUTO_PAUSE_AFTER):
        before = sched.clock_.t
        finish(sched, "livefm", "failed", "the API said no")
        delays.append(sched.state("livefm").next_due - before)
    assert delays[:3] == [1800, 3600, 7200] and all(d <= MAX_BACKOFF_S for d in delays)
    st = sched.describe("livefm")
    assert st["auto_paused"] and st["failures"] == AUTO_PAUSE_AFTER and st["last_error"] == "the API said no"
    sched.clock_.t += MAX_BACKOFF_S * 2
    assert "livefm" not in sched.tick()                   # paused: never retried on its own
    sched.resume("livefm")
    assert "livefm" in sched.tick() and sched.describe("livefm")["failures"] == 0


def test_success_resets_failures(sched):
    finish(sched, "livefm", "failed", "x")
    finish(sched, "livefm", "failed", "x")
    finish(sched, "livefm")
    st = sched.state("livefm")
    assert st.failures == 0 and st.last_error is None and st.next_due == sched.clock_.t + 900


def test_backoff_caps_at_a_day(sched):
    s = sched.state("livefm")
    s.failures = 3
    finish(sched, "livefm", "failed", "x")
    assert s.next_due - sched.clock_.t == min(900 * 2 ** 4, MAX_BACKOFF_S)
    assert sched.backoff(Live, 20) == MAX_BACKOFF_S


def test_user_pause_is_remembered(sched, tmp_path):
    sched.pause("livefm")
    assert "livefm" not in sched.tick()
    again = Scheduler(FakeRunner(), tmp_path / ".sync.json", clock=sched.clock_)
    assert again.state("livefm").paused and "livefm" not in again.tick()
    assert again.describe("livefm")["next_due"] is None


def test_busy_source_waits_for_the_next_tick(sched):
    sched.runner.running.add("livefm")
    assert "livefm" not in sched.tick()
    sched.runner.running.clear()
    assert "livefm" in sched.tick()


def test_other_jobs_dont_move_the_schedule(sched):
    j = Job("livefm", "build")
    j.state = "failed"
    sched.on_finish(j)
    assert sched.state("livefm").failures == 0


def test_cancelled_sync_keeps_the_normal_pace(sched):
    finish(sched, "livefm", "cancelled")
    assert sched.state("livefm").failures == 0 and sched.state("livefm").next_due == sched.clock_.t + 900


def test_broken_state_file_is_ignored(tmp_path):
    (tmp_path / ".sync.json").write_text("{not json")
    assert Scheduler(FakeRunner(), tmp_path / ".sync.json").states == {}


def test_thread_starts_and_stops(sched, monkeypatch):
    import ytw.scheduler as mod
    monkeypatch.setattr(mod, "TICK_S", 0.01)
    sched.start()
    time.sleep(0.1)
    sched.stop()
    assert ("livefm", "sync") in sched.runner.started and sched._thread is None


# ------------------------------------------------------------------ through the real app

@pytest.fixture
def app(tmp_path, monkeypatch):
    for pid in [p for p, c in CONNECTORS.items() if is_live(c)]:
        monkeypatch.delitem(CONNECTORS, pid)
    for cls in (Live,):
        monkeypatch.setitem(CONNECTORS, cls.manifest.id, cls)
        monkeypatch.setitem(PLATFORMS, cls.manifest.id, cls.manifest)
    monkeypatch.setattr(Live, "fail_with", None)
    monkeypatch.setattr(Live, "calls", 0)
    monkeypatch.setattr(secrets, "_store", secrets.Store(tmp_path / ".secrets.json", keyring=FakeKeyring()))
    cfg = load_config()
    cfg.raw = copy.deepcopy(cfg.raw)
    cfg.raw["general"]["data_dir"] = str(tmp_path / "data")
    return make_client(create_app(cfg, static_dir=tmp_path / "nodist"))


def wait(client, pid):
    for _ in range(400):
        job = client.get(f"/api/sources/{pid}").json()["job"]
        if job and job["state"] != "running":
            return job
        time.sleep(0.01)
    raise AssertionError("sync didn't finish")


def test_scheduled_and_manual_syncs_through_the_app(app):
    sched = app.app.state.scheduler
    assert sched.tick() == ["livefm"]
    assert wait(app, "livefm")["lines"] == ["synced, cursor 1"]
    src = app.get("/api/sources/livefm").json()
    assert src["can"]["sync"] and src["sync"]["every"] == 900 and src["sync"]["last_ok"]
    assert sched.tick() == []                                       # not due again yet
    Live.fail_with = "rate limited"
    assert app.post("/api/sources/livefm/run/sync").status_code == 200   # "Sync now"
    assert wait(app, "livefm")["state"] == "failed"
    assert app.get("/api/sources/livefm").json()["sync"]["failures"] == 1
    assert app.post("/api/sources/livefm/sync/pause").json()["paused"] is True
    assert app.post("/api/sources/livefm/sync/resume").json()["failures"] == 0
    assert app.post("/api/sources/youtube/sync/pause").status_code == 404
    assert app.post("/api/sources/youtube/run/sync").status_code == 404
