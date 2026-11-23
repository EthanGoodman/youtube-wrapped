"""Stats math on a small hand-built history. Times are UTC; local is America/New_York
(EST = UTC-5 in winter). Every expected number below is worked out by hand."""
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from ytw import db
from ytw.connectors.youtube.lookups import build_lookups
from ytw.connectors.youtube.parser import Entry
from ytw.connectors.youtube.ingest import insert_entries
from ytw.stats import ads, details, evolution, overview, patterns, records, search, tops
from ytw.stats.common import Filters, Range, resolve_range
from ytw.stats.records import current_streak, longest_break, longest_streak
from ytw.connectors.youtube.watchtime import WatchConfig, build_watches

NY = ZoneInfo("America/New_York")
D = date.fromisoformat


def entry(kind, utc, vid=None, ch=None, title=None, brand=None):
    dt = datetime.fromisoformat(utc).replace(tzinfo=timezone.utc)
    loc = dt.astimezone(NY)
    return Entry(kind=kind, time_utc=utc, epoch=dt.timestamp(), local_iso=loc.isoformat(),
                 local_date=loc.strftime("%Y-%m-%d"), local_hour=loc.hour,
                 local_minute=loc.hour * 60 + loc.minute, local_dow=loc.weekday(), header="YouTube",
                 title=title or vid, url=None, video_id=vid, channel_id=ch, channel_name=ch and f"Name {ch}",
                 brand_hint=brand, dedupe_key=f"{utc}|{vid}|{kind}")


VIDEOS = {
    # id: (channel, duration, category, topics, title, published, (w, h))
    "a1": ("UCa", 600, "20", ["Action game"], "A one", "2024-01-11T11:30:00Z", (1778, 1000)),
    "a2": ("UCa", 600, "20", ["Action game"], "A two", "2015-06-01T00:00:00Z", (1778, 1000)),
    "a0": ("UCa", 600, "20", ["Action game"], "A old", "2020-01-01T00:00:00Z", (1778, 1000)),
    "b1": ("UCb", 300, "24", ["Entertainment"], "B one", "2020-01-01T00:00:00Z", (1778, 1000)),
    "b2": ("UCb", 300, "24", ["Entertainment"], "B two", "2020-01-01T00:00:00Z", (1778, 1000)),
    "c1": ("UCc", 7200, "10", ["Music"], "Rain sounds for sleep", "2020-01-01T00:00:00Z", (1778, 1000)),
    "c2": ("UCc", 45, "10", ["Music"], "tiny #shorts", "2020-01-01T00:00:00Z", (563, 1000)),
    "adX": ("UCbrand", 30, "22", [], "Buy BrandCo", "2020-01-01T00:00:00Z", (1778, 1000)),
}

ENTRIES = [
    # 2023 (the previous period when looking at 2024)
    entry("video", "2023-03-01T15:00:00", "a0", "UCa"),
    entry("video", "2023-03-02T15:00:00", "a0", "UCa"),
    entry("video", "2023-03-03T15:00:00", "a0", "UCa"),
    entry("video", "2023-05-01T15:00:00", "b1", "UCb"),
    # 2024-01-10 (local): a 3-video B session, 5 min apart; each video is 5 min
    entry("video", "2024-01-10T15:00:00", "b1", "UCb"),
    entry("video", "2024-01-10T15:05:00", "b2", "UCb"),
    entry("video", "2024-01-10T15:10:00", "b1", "UCb"),
    # 2024-01-11: one A video, 12 min after upload (early bird); an ad 5s before it (pre-roll)
    entry("ad", "2024-01-11T11:41:55", "adX", None, "Buy BrandCo"),
    entry("video", "2024-01-11T11:42:00", "a1", "UCa"),
    # 2024-01-12: A video, then a 2h rain/sleep video (background) 20 min later
    entry("video", "2024-01-12T15:00:00", "a2", "UCa"),
    entry("video", "2024-01-12T15:20:00", "c1", "UCc"),
    # 2024-01-13 04:30 local = 09:30Z: a Short (latest-night watch)
    entry("video", "2024-01-13T09:30:00", "c2", "UCc"),
    # gap: nothing on 01-14 .. 01-16; then 01-17 (Wed)
    entry("video", "2024-01-17T15:00:00", "a1", "UCa"),
    # 2024-01-20 01:00 local is still 06:00Z on the 20th; 2024-01-21 00:30 local = 05:30Z
    entry("ad", "2024-01-20T06:00:00", "adX", None),
    entry("ad", "2024-01-20T06:10:00", None, None, "Video Ad", brand="shop.com"),
    entry("unavailable", "2024-01-21T04:30:00", "gone1", None),  # 23:30 local on Jan 20
]


def populate(c):
    """Fill a fresh database with the hand-built history and build derived tables."""
    db.init_db(c)
    insert_entries(c, ENTRIES)
    for vid, (ch, dur, cat, topics, title, pub, (w, h)) in VIDEOS.items():
        c.execute("INSERT INTO videos (video_id, status, fetched_at, title, channel_id, channel_title, "
                  "published_at, duration_s, live, was_live, category_id, tags, topics, embed_w, embed_h) "
                  "VALUES (?, 'ok', '', ?, ?, ?, ?, ?, 'none', 0, ?, '[]', ?, ?, ?)",
                  (vid, title, ch, "BrandCo" if ch == "UCbrand" else f"Chan {ch}", pub, dur, cat,
                   __import__("json").dumps(topics), w, h))
    for ch in ("UCa", "UCb", "UCc"):
        c.execute("INSERT INTO channels (channel_id, status, fetched_at, title) VALUES (?, 'ok', '', ?)",
                  (ch, f"Chan {ch}"))
    c.executemany("INSERT INTO categories VALUES (?, ?)", [("20", "Gaming"), ("24", "Entertainment"),
                                                           ("10", "Music")])
    c.executemany("INSERT INTO searches (dedupe_key, kind, time_utc, epoch, local_iso, local_date, "
                  "local_hour, local_dow, query) VALUES (?, ?, '', 0, '', ?, 0, 0, ?)", [
                      ("s1", "search", "2016-05-01", "First Search"),
                      ("s2", "search", "2024-01-10", "lofi beats"),
                      ("s3", "search", "2024-01-11", "Lofi  Beats"),
                      ("s4", "ad", "2024-01-11", None)])
    c.commit()
    build_watches(c, WatchConfig(bg_keywords=("rain", "sleep")), NY)
    build_lookups(c, frozenset(), 1)
    db.set_meta(c, "built_at", "test")
    c.commit()
    return c


@pytest.fixture(scope="module")
def conn():
    return populate(db.connect(Path(":memory:")))


Y2024 = Range(D("2024-01-01"), D("2024-12-31"), "2024")
F = Filters()


# ------------------------------------------------------------------ pure streak math

def test_longest_streak():
    days = [D("2024-01-01"), D("2024-01-02"), D("2024-01-05"), D("2024-01-06"), D("2024-01-07")]
    assert longest_streak(days) == {"days": 3, "start": "2024-01-05", "end": "2024-01-07"}
    assert longest_streak([D("2024-01-01")])["days"] == 1
    assert longest_streak([]) is None


def test_current_streak():
    days = [D("2024-01-01"), D("2024-01-03"), D("2024-01-04"), D("2024-01-05")]
    assert current_streak(days, D("2024-01-05"))["days"] == 3
    assert current_streak(days, D("2024-01-06"))["days"] == 3   # today not over yet
    assert current_streak(days, D("2024-01-07"))["days"] == 0   # missed a full day
    assert current_streak(days, D("2024-01-03"))["days"] == 1   # as of a past date
    assert current_streak([], D("2024-01-03"))["days"] == 0


def test_longest_break():
    days = [D("2024-01-01"), D("2024-01-02"), D("2024-01-10"), D("2024-01-12")]
    assert longest_break(days) == {"days": 7, "start": "2024-01-03", "end": "2024-01-09"}
    assert longest_break([D("2024-01-01"), D("2024-01-02")]) is None


# ------------------------------------------------------------------ ranges and filters

def test_range_previous():
    r = Range(D("2024-01-01"), D("2024-01-28"))
    assert r.days == 28
    p = r.previous()
    assert (p.start, p.end, p.days) == (D("2023-12-04"), D("2023-12-31"), 28)


def test_resolve_range(conn):
    today = D("2024-06-15")
    assert resolve_range(conn, "4w", today=today).days == 28
    assert resolve_range(conn, "12m", today=today).days == 365
    assert resolve_range(conn, "4w", today=today).end == today
    assert resolve_range(conn, "this_year", today=today).start == D("2024-01-01")
    y = resolve_range(conn, "2023", today=today)
    assert (y.start, y.end) == (D("2023-01-01"), D("2023-12-31"))
    a = resolve_range(conn, "all", today=today)
    assert (a.start, a.end) == (D("2023-03-01"), D("2024-01-20"))
    c = resolve_range(conn, "custom", "2024-02-01", "2024-01-01")  # swapped
    assert (c.start, c.end) == (D("2024-01-01"), D("2024-02-01"))
    with pytest.raises(ValueError):
        resolve_range(conn, "bogus")


def test_filters_validation():
    with pytest.raises(ValueError):
        Filters(metric="likes")
    with pytest.raises(ValueError):
        Filters(buckets=("podcasts",))


# ------------------------------------------------------------------ watch table sanity

def test_local_dates_and_buckets(conn):
    got = dict(conn.execute("SELECT video_id, local_date FROM watches WHERE video_id IN ('c2', 'gone1')"))
    assert got == {"c2": "2024-01-13", "gone1": "2024-01-20"}
    assert conn.execute("SELECT bucket FROM watches WHERE video_id='c2'").fetchone()[0] == "short"
    assert conn.execute("SELECT is_background FROM watches WHERE video_id='c1'").fetchone()[0] == 1
    assert conn.execute("SELECT bucket FROM watches WHERE video_id='gone1'").fetchone()[0] == "unknown"


# ------------------------------------------------------------------ overview

def test_overview_2024(conn):
    o = overview.overview(conn, Y2024, F)
    assert o["videos"] == 9
    assert o["unique_videos"] == 7          # b1 twice, a1 twice
    assert o["unique_channels"] == 3        # unavailable has no channel
    # est: b1 300, b2 300, b1 300 | a1 600 | a2 600 (gap 20m > 10m duration), c1 bg -> 0
    #      c2 45 | a1 600 | gone1: unknown duration, last of session -> 600 fallback
    assert o["est_s"] == 300 * 3 + 600 + 600 + 0 + 45 + 600 + 600 == 3345
    assert o["background_s"] == 7200        # last of its session: min(2h, 3h cap)
    assert o["active_days"] == 6            # 10, 11, 12, 13, 17, 20
    assert o["days"] == 366
    assert o["split"]["short"]["videos"] == 1 and o["split"]["long"]["videos"] == 7
    assert o["split"]["unknown"]["videos"] == 1     # the removed video
    assert o["first_watch"]["video_id"] == "b1"
    assert o["last_watch"]["video_id"] == "gone1"
    # vs 2023: 4 videos -> 9 videos
    assert o["previous"]["videos"] == 4
    assert o["change"]["videos"] == pytest.approx(9 / 4 - 1)


def test_overview_background_toggle(conn):
    o = overview.overview(conn, Y2024, Filters(exclude_bg_time=False))
    assert o["est_s"] == 3345 + 7200


def test_overview_bucket_filter(conn):
    o = overview.overview(conn, Y2024, Filters(buckets=("short",)))
    assert (o["videos"], o["est_s"]) == (1, 45)


# ------------------------------------------------------------------ top lists

def test_top_channels_count_and_rank_change(conn):
    t = tops.top_channels(conn, Y2024, F)
    assert [(i["key"], i["count"]) for i in t] == [("UCa", 3), ("UCb", 3), ("UCc", 2)]
    assert [i["shorts"] for i in t] == [0, 0, 1]          # c2 is a Short
    # 2023: UCa #1 (3), UCb #2 (1). Tie in 2024 broken by key -> UCa #1, UCb #2.
    assert [i["rank_change"] for i in t] == [0, 0, None]
    assert [i["is_new"] for i in t] == [False, False, True]   # UCc is new
    assert t[0]["share"] == pytest.approx(3 / 9)
    assert t[0]["title"] == "Chan UCa" and t[0]["first_watched"] == "2023-03-01"


def test_no_new_badges_without_previous_data(conn):
    t = tops.top_channels(conn, Range(D("2023-01-01"), D("2024-12-31")), F)  # previous period is empty
    assert not any(i["is_new"] for i in t) and not any(i["comparable"] for i in t)


def test_top_channels_by_time(conn):
    t = tops.top_channels(conn, Y2024, Filters(metric="time"))
    assert [(i["key"], i["time_s"]) for i in t] == [("UCa", 1800), ("UCb", 900), ("UCc", 45)]


def test_top_videos_rewatches(conn):
    t = tops.top_videos(conn, Y2024, F)
    assert {(i["key"], i["count"]) for i in t if i["count"] > 1} == {("a1", 2), ("b1", 2)}


def test_top_categories_and_genres(conn):
    cats = {i["title"]: i["count"] for i in tops.top_categories(conn, Y2024, F)}
    assert cats == {"Gaming": 3, "Entertainment": 3, "Music": 2}
    genres = {i["title"]: (i["count"], i["time_s"]) for i in tops.top_genres(conn, Y2024, F)}
    assert genres == {"Action game": (3, 1800), "Entertainment": (3, 900), "Music": (2, 45)}


# ------------------------------------------------------------------ patterns

def test_clock_and_heatmap(conn):
    c = patterns.clock(conn, Y2024, F)
    assert len(c) == 24 and sum(h["count"] for h in c) == 9
    assert c[4]["count"] == 1          # the 04:30 Short
    assert c[10]["count"] == 6         # B session (3), a2 + c1 on the 12th, a1 on the 17th
    hm = patterns.heatmap(conn, Y2024, F)
    assert hm["count"][2][10] == 4     # Wednesdays (Jan 10 + Jan 17) at 10:00
    assert sum(map(sum, hm["count"])) == 9


def test_calendar_and_monthly_fill_gaps(conn):
    r = Range(D("2024-01-10"), D("2024-01-17"))
    cal = patterns.calendar(conn, r, F)
    assert [d["count"] for d in cal] == [3, 1, 2, 1, 0, 0, 0, 1]
    m = patterns.monthly(conn, Range(D("2023-12-01"), D("2024-02-29")), F)
    assert [(x["month"], x["count"]) for x in m] == [("2023-12", 0), ("2024-01", 9), ("2024-02", 0)]


def test_weekday_weekend(conn):
    ww = patterns.weekday_weekend(conn, Range(D("2024-01-08"), D("2024-01-21")), F)  # 2 full weeks
    assert ww["weekday"]["days"] == 10 and ww["weekend"]["days"] == 4
    assert ww["weekend"]["count"] == 2  # Sat 13th Short + Sat 20th unavailable
    assert ww["weekday"]["count"] == 7


# ------------------------------------------------------------------ records

def test_records(conn):
    rec = records.records(conn, Y2024, F, today=D("2024-01-21"))
    assert rec["biggest_day"]["by_count"] == {"date": "2024-01-10", "count": 3, "time_s": 900}
    assert rec["biggest_day"]["by_time"]["date"] == "2024-01-10"
    s = rec["longest_session"]
    assert (s["videos"], s["time_s"]) == (3, 900)
    st = rec["streaks"]
    assert st["longest"] == {"days": 4, "start": "2024-01-10", "end": "2024-01-13"}
    assert st["current"]["days"] == 1           # Jan 20, as of Jan 21
    assert st["longest_break"]["days"] == 3     # 14-16
    assert rec["latest_night"]["video_id"] == "c2"
    assert rec["earliest_morning"]["video_id"] == "a1"    # 06:42 local on Jan 11
    assert rec["channel_day"]["count"] == 3 and rec["channel_day"]["channel_id"] == "UCb"
    assert rec["oldest"]["video_id"] == "a2"
    assert rec["early_bird_count"] == 1                    # a1, 12 min after upload
    assert rec["fastest"]["seconds_after_upload"] == 12 * 60
    assert rec["counts"]["ads"] == 3 and rec["counts"]["unavailable"] == 1


def test_milestones(conn):
    m = records.milestones(conn, F)
    assert [x["n"] for x in m] == [1]
    assert m[0]["video_id"] == "a0"


# ------------------------------------------------------------------ evolution

def test_top_channel_per_year(conn):
    assert [(y["year"], y["channel_id"]) for y in evolution.top_channel_per_year(conn, F)] == \
        [(2023, "UCa"), (2024, "UCa")]


def test_new_discoveries(conn):
    found = evolution.new_discoveries(conn, Y2024, F)
    assert [d["channel_id"] for d in found] == ["UCc"]


def test_loyalty(conn):
    loyal = evolution.loyalty(conn, F, min_per_year=1)
    assert loyal[0]["channel_id"] == "UCa" and loyal[0]["year_list"] == [2023, 2024]


def test_fell_off(conn):
    # cutoff = 2024-06-01: before it UCa has 6 watches and UCb 4; neither has any after
    gone = evolution.fell_off(conn, F, asof=D("2025-06-01"), recent_days=365, min_before=5)
    assert [g["channel_id"] for g in gone] == ["UCa"]
    assert gone[0]["count_before"] == 6 and gone[0]["last_watched"] == "2024-01-17"
    # with a cutoff in Dec 2023, UCa's January watches are "recent", so it didn't fall off
    assert evolution.fell_off(conn, F, asof=D("2024-06-01"), recent_days=180, min_before=3) == []


def test_bar_race_is_cumulative(conn):
    race = evolution.bar_race(conn, Range(D("2023-01-01"), D("2024-12-31")), F, top_n=2)
    last = {t["channel_id"]: t["value"] for t in race["frames"][-1]["top"]}
    assert last == {"UCa": 6, "UCb": 4}


def test_mix_by_year(conn):
    mix = evolution.mix_by_year(conn, F, "category")
    assert mix["years"] == [2023, 2024]
    assert mix["series"]["Gaming"] == [3, 3]


# ------------------------------------------------------------------ details

def test_channel_detail(conn):
    d = details.channel(conn, "UCa", Y2024, F)
    assert d["in_range"]["videos"] == 3 and d["all_time"]["videos"] == 6
    tv = {v["key"]: v for v in d["top_videos"]}
    assert tv["a1"]["share"] == pytest.approx(2 / 3)  # share within the channel
    assert [(h["year"], h["rank"]) for h in d["rank_history"]] == [(2023, 1), (2024, 1)]
    assert details.channel(conn, "UCnope", Y2024, F) is None


def test_video_detail(conn):
    v = details.video(conn, "a1")
    assert v["watch_count"] == 2 and v["video"]["category"] == "Gaming"
    assert v["url"].endswith("v=a1")
    gone = details.video(conn, "gone1")
    assert gone["watch_count"] == 1 and gone["video"]["status"] == "unknown"


def test_genre_detail(conn):
    g = details.genre(conn, "Action game", Y2024, F)
    assert g["in_range"]["videos"] == 3
    assert [c["key"] for c in g["top_channels"]] == ["UCa"]


# ------------------------------------------------------------------ ads & search

def test_ads(conn):
    a = ads.ads(conn, Y2024)
    assert a["ads"] == 3
    assert a["prerolls_linked"] == 0  # pre-roll links are made at ingest, not here
    assert a["most_repeated"][0]["video_id"] == "adX" and a["most_repeated"][0]["count"] == 2
    assert {b["brand"]: b["count"] for b in a["top_brands"]} == {"BrandCo": 2, "shop.com": 1}
    assert a["ads_per_watch_hour"] == pytest.approx(3 / (3345 / 3600))


def test_search(conn):
    s = search.search_stats(conn, Y2024)
    assert s["searches"] == 2 and s["top_searches"][0] == {"query": "lofi beats", "count": 2}
    assert s["first_ever"]["query"] == "First Search"
    assert search.search_stats(conn, Y2024, all_time=True)["searches"] == 3
