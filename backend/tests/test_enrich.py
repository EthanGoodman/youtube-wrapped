import json
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from ytw import db, enrich
from ytw.enrich import Enricher, QuotaExceeded, parse_duration, topic_name
from ytw.ingest import insert_entries
from ytw.parser import load_watch_history

FIXTURE = Path(__file__).parent / "fixtures" / "watch-history.json"


@pytest.mark.parametrize("iso,secs", [
    ("PT4M13S", 253), ("PT1H", 3600), ("PT1H2M3S", 3723), ("P1DT2H", 93600),
    ("PT10H0M1S", 36001), ("PT0S", 0), ("P0D", 0), ("PT45S", 45), ("P1W", 604800),
    ("PT1.5S", 1), (None, None), ("", None), ("garbage", None), ("PT", None),
])
def test_parse_duration(iso, secs):
    assert parse_duration(iso) == secs


def test_topic_name():
    assert topic_name("https://en.wikipedia.org/wiki/Action_game") == "Action game"
    assert topic_name("https://en.wikipedia.org/wiki/Hip_hop_music") == "Hip hop music"
    assert topic_name("https://en.wikipedia.org/wiki/Pok%C3%A9mon") == "Pokémon"


class FakeApi:
    """Pretends to be the YouTube API. Knows some IDs; others are 'deleted'."""

    def __init__(self, known_videos, quota_after=None):
        self.known = known_videos
        self.calls = []
        self.quota_after = quota_after

    def __call__(self, endpoint, params):
        self.calls.append((endpoint, params))
        if self.quota_after is not None and len(self.calls) > self.quota_after:
            raise QuotaExceeded("quotaExceeded")
        assert params["key"] == "test-key"
        if endpoint == "videoCategories":
            return {"items": [{"id": "20", "snippet": {"title": "Gaming"}},
                              {"id": "10", "snippet": {"title": "Music"}}]}
        ids = params["id"].split(",")
        assert len(ids) <= 50
        if endpoint == "videos":
            return {"items": [self._video(i) for i in ids if i in self.known]}
        if endpoint == "channels":
            return {"items": [{"id": c, "snippet": {"title": f"Channel {c}", "thumbnails": {
                "medium": {"url": f"https://img/{c}.jpg"}}},
                "statistics": {"subscriberCount": "1000", "hiddenSubscriberCount": False}}
                for c in ids if c != "UCchan000002"]}  # pretend this one was terminated
        raise AssertionError(endpoint)

    def _video(self, vid):
        item = {"id": vid, "snippet": {
            "title": f"Title {vid}", "channelId": "UCchan000001", "channelTitle": "Chan One",
            "publishedAt": "2020-01-01T00:00:00Z", "categoryId": "20", "tags": ["fifa", "ultimate team"],
            "liveBroadcastContent": "none",
            "thumbnails": {"medium": {"url": "m.jpg"}, "maxres": {"url": "x.jpg"}}},
            "contentDetails": {"duration": self.known[vid]},
            "statistics": {"viewCount": "123", "likeCount": "4"},
            "topicDetails": {"topicCategories": ["https://en.wikipedia.org/wiki/Video_game_culture"]}}
        if self.known[vid] == "P0D":
            item["snippet"]["liveBroadcastContent"] = "live"
            item["liveStreamingDetails"] = {"actualStartTime": "2024-01-01T00:00:00Z"}
        return item


@pytest.fixture
def conn():
    c = db.connect(Path(":memory:"))
    db.init_db(c)
    insert_entries(c, load_watch_history(FIXTURE, ZoneInfo("America/New_York")))
    return c


KNOWN = {"ns5dln3dlr8": "PT12M3S", "videoAAAA01": "PT5M", "videoBBBB01": "PT10H",
         "videoCCCC01": "P0D", "musicvid001": "PT3M30S", "unavail0001": "PT1M",
         "adbrand0001": "PT30S"}


def test_priority_order(conn):
    ids = enrich.pending_video_ids(conn, include_ads=True, retry_missing=False)
    watched = {"ns5dln3dlr8", "videoAAAA01", "videoBBBB01", "videoCCCC01", "musicvid001"}
    assert set(ids[:5]) == watched
    assert ids[5] == "unavail0001"
    assert set(ids[6:]) == {"preroll0001", "preroll0002", "adbrand0001", "earlyad0001"}
    assert "unavail0001" not in enrich.pending_video_ids(conn, include_ads=False, retry_missing=False)[:5]


def test_full_run(conn):
    api = FakeApi(KNOWN)
    r = Enricher(conn, "test-key", fetch=api).run()
    assert r.stopped is None
    assert (r.videos_ok, r.videos_missing) == (7, 3)
    v = dict(conn.execute("SELECT video_id, duration_s FROM videos WHERE status='ok'").fetchall())
    assert v["videoBBBB01"] == 36000
    assert v["videoCCCC01"] == 0  # ongoing live stream: P0D
    live = conn.execute("SELECT live, was_live FROM videos WHERE video_id='videoCCCC01'").fetchone()
    assert tuple(live) == ("live", 1)
    row = conn.execute("SELECT * FROM videos WHERE video_id='ns5dln3dlr8'").fetchone()
    assert json.loads(row["tags"]) == ["fifa", "ultimate team"]
    assert json.loads(row["topics"]) == ["Video game culture"]
    assert (row["thumb_small"], row["thumb_large"], row["view_count"]) == ("m.jpg", "x.jpg", 123)
    # deleted ads are marked missing, with no duration
    miss = conn.execute("SELECT status, duration_s FROM videos WHERE video_id='preroll0001'").fetchone()
    assert tuple(miss) == ("missing", None)
    # the unavailable video turned out to exist
    assert conn.execute("SELECT status FROM videos WHERE video_id='unavail0001'").fetchone()[0] == "ok"
    # channels: from entries, plus the channel of every enriched video
    ch = dict(conn.execute("SELECT channel_id, status FROM channels").fetchall())
    assert ch["UCchan000002"] == "missing" and ch["UCchan000001"] == "ok"
    assert conn.execute("SELECT title FROM categories WHERE category_id='20'").fetchone()[0] == "Gaming"
    assert r.units == len(api.calls) == enrich.units_used_today(conn)


def test_never_refetches(conn):
    Enricher(conn, "test-key", fetch=FakeApi(KNOWN)).run()
    api2 = FakeApi(KNOWN)
    r = Enricher(conn, "test-key", fetch=api2).run()
    assert api2.calls == [] and r.units == 0
    # --retry-missing only asks again for the missing ones
    api3 = FakeApi(KNOWN)
    Enricher(conn, "test-key", fetch=api3).run(retry_missing=True)
    asked = {i for ep, p in api3.calls if ep == "videos" for i in p["id"].split(",")}
    assert asked == {"preroll0001", "preroll0002", "earlyad0001"}


def test_resume_after_quota(conn):
    # batch size 2 -> several calls; the API dies after the 2nd call (1 categories + 1 videos)
    api = FakeApi(KNOWN, quota_after=2)
    r = Enricher(conn, "test-key", fetch=api, batch_size=2).run()
    assert r.stopped and r.stopped.startswith("quota")
    assert r.videos_ok == 2  # counts survive an early stop
    done_first = conn.execute("SELECT COUNT(*) FROM videos").fetchone()[0]
    assert done_first == 2
    assert r.videos_left == 8
    # next day: picks up where it left off, never re-asking for finished IDs
    api2 = FakeApi(KNOWN)
    r2 = Enricher(conn, "test-key", fetch=api2, batch_size=2).run()
    assert r2.stopped is None and r2.videos_left == 0
    asked = [i for ep, p in api2.calls if ep == "videos" for i in p["id"].split(",")]
    assert len(asked) == len(set(asked)) == 8
    assert not any(ep == "videoCategories" for ep, _ in api2.calls)


def test_budget_stops_before_calling(conn):
    api = FakeApi(KNOWN)
    r = Enricher(conn, "test-key", fetch=api, budget=1, batch_size=2).run()
    assert len(api.calls) == 1  # only the categories call fit
    assert r.stopped and "budget" in r.stopped
