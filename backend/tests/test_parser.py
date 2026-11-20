from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from ytw import db
from ytw.ingest import insert_entries, kind_counts
from ytw.parser import (AD, AD_CLICK, AD_IMPRESSION, MUSIC, OTHER, POST, SURVEY, UNAVAILABLE,
                        VIDEO, clean_text, load_watch_history, parse_search_history,
                        video_id_from_url)
from ytw.preroll import link_prerolls

FIXTURE = Path(__file__).parent / "fixtures" / "watch-history.json"
NY = ZoneInfo("America/New_York")


@pytest.fixture(scope="module")
def entries():
    return load_watch_history(FIXTURE, NY)


def by_vid(entries, vid):
    return next(e for e in entries if e.video_id == vid)


def by_title(entries, title):
    return next(e for e in entries if e.title == title)


def test_kind_counts(entries):
    assert Counter(e.kind for e in entries) == {
        VIDEO: 4, AD: 6, AD_IMPRESSION: 1, AD_CLICK: 1, UNAVAILABLE: 1,
        SURVEY: 2, POST: 2, MUSIC: 1, OTHER: 1,
    }


def test_sorted_ascending(entries):
    epochs = [e.epoch for e in entries]
    assert epochs == sorted(epochs)
    assert entries[0].video_id == "ns5dln3dlr8"


def test_normal_video_fields(entries):
    e = by_vid(entries, "ns5dln3dlr8")
    assert e.kind == VIDEO
    assert e.title == "MY BROTHER DISCARDS MY $20,000 FIFA 18 TEAM!!"
    assert e.channel_name == "W2S"
    assert e.channel_id == "UCjtLOfx1yt1NlnFIDyAX3Ug"


def test_timestamp_without_millis_and_timezone(entries):
    e = by_vid(entries, "ns5dln3dlr8")
    # 05:03:58Z on Dec 1 is 00:03:58 EST the same day
    assert e.local_date == "2018-12-01"
    assert e.local_hour == 0
    assert e.local_iso.startswith("2018-12-01T00:03:58")
    assert e.local_dow == 5  # Saturday


def test_dst_transition(entries):
    # US DST began 2024-03-10 at 07:00Z. 06:30Z is 01:30 EST, 07:30Z is 03:30 EDT.
    a = by_vid(entries, "videoAAAA01")
    b = by_vid(entries, "videoBBBB01")
    assert (a.local_hour, a.local_iso[-6:]) == (1, "-05:00")
    assert (b.local_hour, b.local_iso[-6:]) == (3, "-04:00")
    assert b.epoch - a.epoch == 3600  # one real hour apart despite 2 wall-clock hours


def test_late_night_across_midnight(entries):
    # 13:30Z on 2024-03-11 is 09:30 EDT; local date stays the 11th
    assert by_vid(entries, "videoCCCC01").local_date == "2024-03-11"


def test_zero_width_and_escapes(entries):
    e = by_vid(entries, "videoBBBB01")
    assert "\u200b" not in e.title
    assert e.title == "Hello World ｜ It's fine & good"
    assert e.channel_name == "Chan Two"


def test_ads_detected_by_marker_not_title(entries):
    ads = [e for e in entries if e.kind == AD]
    assert {e.title for e in ads} >= {"Armando V4 16x9 1", "Video Ad", "The Best"}
    # an ad with an advertiser channel is still an ad, not a video
    assert by_vid(entries, "adbrand0001").kind == AD
    assert by_vid(entries, "adbrand0001").channel_id is None


def test_ads_grouped_by_id(entries):
    joy = [e for e in entries if e.title == "Unwrap Joy"]
    assert len({e.video_id for e in joy}) == 2


def test_brand_hints(entries):
    assert by_vid(entries, "adbrand0001").brand_hint == "BigShop"
    assert by_title(entries, "Armando V4 16x9 1").brand_hint == "brand.example.org"
    assert by_title(entries, "Video Ad").brand_hint is None  # doubleclick is a tracker
    click = next(e for e in entries if e.kind == AD_CLICK)
    assert click.brand_hint == "shop.example.com"


def test_ad_impression(entries):
    e = next(e for e in entries if e.kind == AD_IMPRESSION)
    assert e.title == "Ads On YouTube Homepage"
    assert e.url is None


def test_unavailable_video(entries):
    e = by_vid(entries, "unavail0001")
    assert e.kind == UNAVAILABLE
    assert e.title is None and e.channel_id is None


def test_surveys_with_and_without_marker(entries):
    assert sum(e.kind == SURVEY for e in entries) == 2


def test_music_tagged(entries):
    e = by_vid(entries, "musicvid001")
    assert e.kind == MUSIC
    assert e.channel_name == "Test Artist - Topic"


def test_video_id_from_url():
    assert video_id_from_url("https://www.youtube.com/watch?v=abc-_123XYZ") == "abc-_123XYZ"
    assert video_id_from_url("https://www.youtube.com/watch?v=abc&t=10") == "abc"
    assert video_id_from_url("https://www.youtube.com/watch?v=") is None
    assert video_id_from_url(None) is None


def test_clean_text():
    assert clean_text("a\u200bb\u202fc ") == "ab c"
    assert clean_text("\u200b") is None


def _mem_db():
    conn = db.connect(Path(":memory:"))
    db.init_db(conn)
    return conn


def test_ingest_dedupes(entries):
    conn = _mem_db()
    assert insert_entries(conn, entries) == len(entries)
    assert insert_entries(conn, entries) == 0
    assert sum(kind_counts(conn).values()) == len(entries)


def test_preroll_linking(entries):
    conn = _mem_db()
    insert_entries(conn, entries)
    n = link_prerolls(conn, window=60)
    rows = dict(conn.execute(
        "SELECT a.video_id, v.video_id FROM entries a JOIN entries v ON a.preroll_for = v.id").fetchall())
    # both ads 10s and 20s before video B are its pre-rolls (double pre-roll)
    assert rows == {"preroll0001": "videoBBBB01", "preroll0002": "videoBBBB01"}
    assert n == 2
    # the ad 30 min before video A is not a pre-roll
    early = conn.execute("SELECT preroll_for FROM entries WHERE video_id='earlyad0001'").fetchone()[0]
    assert early is None


def test_search_history():
    raw = [
        {"header": "YouTube", "title": "Searched for lofi beats", "titleUrl": "https://www.youtube.com/results?search_query=lofi+beats", "time": "2020-01-02T03:00:00.000Z"},
        {"header": "YouTube", "title": "Watched Some Ad", "titleUrl": "https://www.youtube.com/watch?v=x", "time": "2020-01-01T03:00:00.000Z", "details": [{"name": "From Google Ads"}]},
    ]
    s = parse_search_history(raw, NY)
    assert [x.kind for x in s] == ["ad", "search"]
    assert s[1].query == "lofi beats"
    assert s[1].local_date == "2020-01-01"  # 03:00Z = 22:00 EST previous day


def test_clean_text_object_replacement_char():
    assert clean_text("reacts!\ufffc #shorts \ufffc") == "reacts! #shorts"
