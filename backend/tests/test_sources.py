"""Data sources API (#16): upload, run, cancel, secrets and delete, without a terminal."""
import copy
import io
import threading
import time
import zipfile

import pytest
from conftest import make_client
from connector_contract import FIXTURES
from test_secrets import FakeKeyring

from ytw import secrets, sources
from ytw.api import create_app
from ytw.config import load_config
from ytw.connectors import CONNECTORS
from ytw.imports import Limits


@pytest.fixture
def env(tmp_path, monkeypatch):
    cfg = load_config()
    cfg.raw = copy.deepcopy(cfg.raw)
    cfg.raw["general"]["data_dir"] = str(tmp_path / "data")
    kr = FakeKeyring()
    monkeypatch.setattr(secrets, "_store", secrets.Store(tmp_path / ".secrets.json", keyring=kr))
    for name in ("TMDB_TOKEN", "YOUTUBE_API_KEY", "CRUNCHYROLL_ETP_RT"):
        monkeypatch.delenv(name, raising=False)
    client = make_client(create_app(cfg, static_dir=tmp_path / "nodist"))
    client.cfg, client.kr = cfg, kr
    return client


def wait(client, pid, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        job = client.get(f"/api/sources/{pid}").json()["job"]
        if job and job["state"] != "running":
            return job
        time.sleep(0.05)
    raise AssertionError("job didn't finish")


def upload(client, pid, name, data: bytes):
    return client.post(f"/api/sources/{pid}/upload", content=data, headers={"X-Filename": name})


def takeout_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in (FIXTURES / "youtube").iterdir():
            z.writestr(f"Takeout/YouTube and YouTube Music/history/{p.name}", p.read_bytes())
    return buf.getvalue()


def test_list(env):
    d = env.get("/api/sources").json()
    by = {s["id"]: s for s in d["sources"]}
    assert list(by) == ["youtube", "netflix", "spotify", "steam", "epic", "crunchyroll"]
    assert by["netflix"]["can"] == {"upload": True, "fetch": False, "enrich": True, "sync": False}
    assert by["netflix"]["sync"] is None                                   # not a live source
    assert by["crunchyroll"]["can"]["upload"] is False and by["crunchyroll"]["can"]["fetch"] is True
    assert by["crunchyroll"]["official"] is False and by["youtube"]["official"] is True
    assert by["netflix"]["status"]["has_data"] is False and by["netflix"]["secrets"][0] == {
        "name": "TMDB_TOKEN", "label": secrets.KNOWN["TMDB_TOKEN"], "set": False, "where": None}


def test_new_user_adds_youtube_and_netflix_without_a_terminal(env):
    r = upload(env, "netflix", "NetflixViewingHistory.csv", (FIXTURES / "netflix/NetflixViewingHistory.csv").read_bytes())
    assert r.status_code == 200, r.text
    assert wait(env, "netflix")["state"] == "done"
    r = upload(env, "youtube", "takeout-20260101T000000Z-001.zip", takeout_zip())
    assert r.status_code == 200, r.text
    job = wait(env, "youtube")
    assert job["state"] == "done" and any("Watch history" in line for line in job["lines"])
    by = {s["id"]: s for s in env.get("/api/sources").json()["sources"]}
    assert by["netflix"]["status"]["has_data"] and by["youtube"]["status"]["has_data"]
    hub = {p["id"]: p for p in env.get("/api/platforms").json()}
    assert hub["netflix"]["has_data"] and hub["youtube"]["has_data"]
    assert env.get("/api/overview?platform=netflix&range=all").json()["videos"] > 0
    kept = list((env.cfg.platform_dir("netflix") / "imports").glob("*/NetflixViewingHistory.csv"))
    assert len(kept) == 1                                       # the original is kept, under a random folder
    # the same file again: no duplicates
    upload(env, "netflix", "NetflixViewingHistory.csv", (FIXTURES / "netflix/NetflixViewingHistory.csv").read_bytes())
    wait(env, "netflix")
    assert env.get("/api/sources/netflix").json()["status"]["rows"] == by["netflix"]["status"]["rows"]


@pytest.mark.parametrize("name, data, message", [
    ("evil.zip", None, "unsafe path"),
    ("photo.json", b"\x89PNG\r\n\x1a\n\x00\x00\x00", "ZIP, JSON or CSV"),
    ("empty.csv", b"", "empty"),
])
def test_bad_uploads_refused_and_not_kept(env, name, data, message):
    if data is None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("../../evil.json", "[]")
        data = buf.getvalue()
    r = upload(env, "youtube", name, data)
    assert r.status_code == 400 and message in r.json()["detail"]
    imports = env.cfg.platform_dir("youtube") / "imports"
    assert not [p for p in imports.rglob("*") if p.is_file()]
    assert not (env.cfg.data_root.parent / "evil.json").exists()


def test_upload_size_limit(env, monkeypatch):
    monkeypatch.setattr(sources, "LIMITS", Limits(max_upload=100))
    assert upload(env, "netflix", "big.csv", b"Title,Date\n" + b"x,1/1/25\n" * 50).status_code == 413


def test_uploads_only_for_file_platforms(env):
    assert upload(env, "crunchyroll", "x.json", b"{}").status_code == 400
    assert upload(env, "nope", "x.json", b"{}").status_code == 404


def test_failed_job_says_why(env):
    upload(env, "netflix", "notes.json", b'{"not": "a netflix file"}')
    job = wait(env, "netflix")
    assert job["state"] == "failed" and "NetflixViewingHistory.csv" in job["error"]


def test_one_job_at_a_time_and_cancel(env, monkeypatch):
    started, cls = threading.Event(), CONNECTORS["netflix"]

    def slow(self, **_):
        started.set()
        while True:
            self.out("working…")
            time.sleep(0.01)
    monkeypatch.setattr(cls, "build", slow)
    assert env.post("/api/sources/netflix/run/build").status_code == 200
    started.wait(5)
    assert env.post("/api/sources/netflix/run/build").status_code == 409
    assert env.delete("/api/sources/netflix").status_code == 409            # can't delete mid-job
    env.post("/api/sources/netflix/cancel")
    assert wait(env, "netflix")["state"] == "cancelled"
    assert env.post("/api/sources/youtube/run/fetch").status_code == 404     # YouTube has no fetch step


def test_secrets_are_write_only(env):
    r = env.put("/api/secrets/TMDB_TOKEN", json={"value": "  tmdb-secret-value-123  "})
    assert r.status_code == 200 and "tmdb-secret-value" not in r.text
    assert env.kr.d[("wrapped", "TMDB_TOKEN")] == "tmdb-secret-value-123"
    listing = env.get("/api/sources").text
    assert "tmdb-secret-value" not in listing
    assert {s["id"]: s for s in env.get("/api/sources").json()["sources"]}["netflix"]["secrets"][0]["set"] is True
    assert env.put("/api/secrets/SOME_OTHER_KEY", json={"value": "x"}).status_code == 404
    assert env.put("/api/secrets/TMDB_TOKEN", json={"value": "   "}).status_code == 400
    assert env.put("/api/secrets/TMDB_TOKEN", content=b"not json").status_code == 400
    assert env.delete("/api/secrets/TMDB_TOKEN").json() == {"name": "TMDB_TOKEN", "deleted": True}


def test_writes_need_the_token_and_same_origin(env):
    from fastapi.testclient import TestClient
    bare = TestClient(env.app, base_url="http://127.0.0.1")
    assert bare.delete("/api/sources").status_code == 401
    assert bare.put("/api/secrets/TMDB_TOKEN", json={"value": "x"}).status_code == 401
    r = env.delete("/api/sources/netflix", headers={"Origin": "http://evil.example"})
    assert r.status_code == 403


def test_delete_removes_database_files_and_secrets(env):
    upload(env, "netflix", "NetflixViewingHistory.csv", (FIXTURES / "netflix/NetflixViewingHistory.csv").read_bytes())
    wait(env, "netflix")
    upload(env, "youtube", "takeout.zip", takeout_zip())
    wait(env, "youtube")
    env.put("/api/secrets/TMDB_TOKEN", json={"value": "tmdb-secret-value-123"})
    assert env.get("/api/overview?platform=netflix&range=all").status_code == 200   # opens a read connection
    r = env.delete("/api/sources/netflix")
    assert r.status_code == 200 and "netflix.db" in r.json()["removed"] and "TMDB_TOKEN" in r.json()["removed"]
    cfg = env.cfg
    assert not cfg.platform_db("netflix").exists() and not cfg.platform_dir("netflix").exists()
    assert ("wrapped", "TMDB_TOKEN") not in env.kr.d
    assert env.get("/api/overview?platform=netflix&range=all").status_code == 503
    assert env.get("/api/overview?platform=youtube&range=all").status_code == 200   # others untouched
    # and everything
    r = env.delete("/api/sources")
    assert r.status_code == 200 and not cfg.platform_db("youtube").exists() and not cfg.platform_dir("youtube").exists()
    assert not any(p.suffix == ".db" for p in cfg.data_root.iterdir())
