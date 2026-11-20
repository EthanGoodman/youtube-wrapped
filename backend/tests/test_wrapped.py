from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ytw import db, images
from ytw.api import create_app
from ytw.config import ROOT, load_config
from ytw.stats.common import Filters, Range
from ytw.wrapped import METRICS, load_personalities, personality_metrics, pick_personality, wrapped

from test_stats import populate

CFG = {
    "personality": [
        {"id": "owl", "name": "Owl", "metric": "night_share", "threshold": 0.2, "reason": "{pct} at night"},
        {"id": "scroll", "name": "Scroller", "metric": "shorts_share", "threshold": 0.5, "reason": "{pct} shorts"},
        {"id": "explorer", "name": "Explorer", "metric": "explorer_ratio", "threshold": 0.5,
         "reason": "new channel every {inverse} videos"},
    ],
    "fallback": {"id": "all", "name": "All-Rounder", "reason": "balanced"},
}


def test_pick_highest_ratio_wins():
    m = dict.fromkeys(METRICS, 0.0) | {"night_share": 0.3, "shorts_share": 0.9}
    p = pick_personality(m, CFG)
    assert p["id"] == "scroll"                 # 0.9/0.5 = 1.8 beats 0.3/0.2 = 1.5
    assert p["reason"] == "90% shorts"
    assert [a["id"] for a in p["also"]] == ["owl"]


def test_pick_fallback_when_nothing_reaches_threshold():
    p = pick_personality(dict.fromkeys(METRICS, 0.01), CFG)
    assert p["id"] == "all" and p["reason"] == "balanced"


def test_reason_placeholders():
    p = pick_personality(dict.fromkeys(METRICS, 0.0) | {"explorer_ratio": 0.5}, CFG)
    assert p["reason"] == "new channel every 2 videos"


def test_shipped_personalities_file_is_valid():
    cfg = load_personalities(ROOT / "personalities.toml")
    assert len(cfg["personality"]) >= 8 and cfg["fallback"]["name"]


def test_bad_metric_rejected(tmp_path):
    f = tmp_path / "p.toml"
    f.write_text('[[personality]]\nid="x"\nname="X"\nmetric="nope"\nthreshold=1\n')
    with pytest.raises(ValueError):
        load_personalities(f)


@pytest.fixture(scope="module")
def conn():
    return populate(db.connect(Path(":memory:")))


def test_metrics_by_hand(conn):
    m = personality_metrics(conn, Range(date(2024, 1, 1), date(2024, 12, 31)), Filters())
    # 9 watches in 2024; one at 04:30 local (night); none 5-9am; 2 on weekends; 1 Short
    assert m["night_share"] == pytest.approx(1 / 9)
    assert m["early_share"] == pytest.approx(1 / 9)  # a1 at 06:42 on Jan 11
    assert m["weekend_share"] == pytest.approx(2 / 9)
    assert m["shorts_share"] == pytest.approx(1 / 9)
    # 8 watches with a channel, 3 channels; top 5 channels = all of them
    assert m["explorer_ratio"] == pytest.approx(3 / 8) and m["top5_share"] == 1
    assert m["background_share"] == pytest.approx(7200 / (3345 + 7200))


def test_wrapped_payload(conn):
    w = wrapped(conn, 2024, Filters(), CFG, today=date(2024, 12, 31))
    assert not w["empty"]
    assert w["overview"]["videos"] == 9
    assert w["top_channels"][0]["key"] == "UCa"
    assert all(c["shorts"] == 0 for c in w["top_channels"])         # long-form only
    assert [c["key"] for c in w["top_shorts_channels"]] == ["UCc"]  # c2 is the only Short
    assert w["discovery"]["channel_id"] == "UCc"
    assert w["streak"]["days"] == 4 and w["latest_night"]["video_id"] == "c2"
    assert w["personality"]["id"] in {"owl", "scroll", "explorer", "all"}
    assert wrapped(conn, 2019, Filters(), CFG) == {"year": 2019, "mode": "all", "empty": True}


def test_wrapped_modes(conn):
    v = wrapped(conn, 2024, Filters(), CFG, today=date(2024, 12, 31), mode="videos")
    assert v["overview"]["videos"] == 7                    # 9 minus the Short and the removed video
    assert v["top_shorts_channels"] == []
    s = wrapped(conn, 2024, Filters(), CFG, today=date(2024, 12, 31), mode="shorts")
    assert s["overview"]["videos"] == 1
    assert [c["key"] for c in s["top_channels"]] == ["UCc"]  # Shorts mode ranks Shorts channels
    assert s["latest_night"]["video_id"] == "c2"
    assert s["personality"]["id"] != "scroll"              # Shorts Scroller is skipped outside "all"
    with pytest.raises(ValueError):
        wrapped(conn, 2024, Filters(), CFG, mode="podcasts")


def test_skip_metrics():
    m = dict.fromkeys(METRICS, 0.0) | {"shorts_share": 1.0, "night_share": 0.3}
    assert pick_personality(m, CFG)["id"] == "scroll"
    assert pick_personality(m, CFG, frozenset({"shorts_share"}))["id"] == "owl"


# ------------------------------------------------------------------ image relay

@pytest.mark.parametrize("url", [
    "http://i.ytimg.com/vi/x/mqdefault.jpg",          # not https
    "https://evil.example.com/a.jpg",                 # other host
    "https://i.ytimg.com.evil.com/a.jpg",             # lookalike host
    "https://user:pw@i.ytimg.com/a.jpg",              # credentials
    "https://i.ytimg.com:8443/a.jpg",                 # other port
    "file:///etc/passwd", "ftp://i.ytimg.com/a", "not a url",
])
def test_image_relay_refuses(url):
    with pytest.raises(images.NotAllowed):
        images.check_url(url)


def test_image_relay_allows_youtube_hosts():
    images.check_url("https://i.ytimg.com/vi/abc/mqdefault.jpg")
    images.check_url("https://yt3.ggpht.com/abc=s88-c-k")


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / "w.db"
    c = db.connect(path)
    populate(c)
    c.close()
    calls = []
    monkeypatch.setattr(images, "getter", lambda u: calls.append(u) or (b"\x89PNG", "image/png"))
    monkeypatch.setattr(images, "_cache", images.OrderedDict())
    client = TestClient(create_app(load_config(), db_path=path, static_dir=tmp_path / "nodist"))
    client.calls = calls
    return client


def test_image_endpoint(client):
    r = client.get("/api/img", params={"u": "https://i.ytimg.com/vi/a1/mqdefault.jpg"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == b"\x89PNG"
    client.get("/api/img", params={"u": "https://i.ytimg.com/vi/a1/mqdefault.jpg"})
    assert len(client.calls) == 1  # cached
    assert client.get("/api/img", params={"u": "https://example.com/x.png"}).status_code == 400
    assert client.calls == ["https://i.ytimg.com/vi/a1/mqdefault.jpg"]


def test_wrapped_endpoint(client):
    w = client.get("/api/wrapped/2024").json()
    assert w["year"] == 2024 and w["overview"]["videos"] == 9 and w["personality"]["name"]
    assert client.get("/api/wrapped/2019").json()["empty"] is True
    assert client.get("/api/wrapped/2024?mode=shorts").json()["overview"]["videos"] == 1
    assert client.get("/api/wrapped/2024?mode=nope").status_code == 400
