from pathlib import Path
from zoneinfo import ZoneInfo

from ytw import db
from ytw.watchtime import Raw, WatchConfig, build_watches, compute

C = WatchConfig(bg_keywords=("sleep", "rain"))
H = 3600
_id = iter(range(1, 10_000))


def v(t, dur=600, **kw):
    """A watched video starting at t seconds."""
    return Raw(next(_id), kw.pop("kind", "video"), float(t), video_id=kw.pop("vid", f"v{t}"),
               channel_id="UC1", duration_s=dur, **kw)


def ad(t):
    return Raw(next(_id), "ad", float(t))


def est(rows, c=C):
    return [w["est_s"] for w in compute(rows, c)]


def test_gap_limits_estimate():
    # 10-min video, next one 4 min later -> watched 4 min
    assert est([v(0, 600), v(240, 600)])[0] == 240


def test_duration_limits_estimate():
    # 5-min video, next one 20 min later (same session) -> watched the whole 5 min
    out = compute([v(0, 300), v(1200, 300)], C)
    assert out[0]["est_s"] == 300 and out[0]["est_method"] == "full"


def test_last_in_session_uses_duration_capped():
    # gap > 30 min ends the session: use min(duration, 3h)
    assert est([v(0, 900), v(5 * H, 60)])[0] == 900
    assert est([v(0, 10 * H), v(20 * H, 60)])[0] == 3 * H
    # the very last video ever: same rule
    assert est([v(0, 900)]) == [900]


def test_ads_are_dropped_before_gaps():
    # ads every few seconds must not shrink the first video's gap
    rows = [v(0, 600), ad(100), ad(130), ad(395), v(400, 600)]
    out = compute(rows, C)
    assert len(out) == 2
    assert out[0]["est_s"] == 400


def test_unknown_duration_fallback():
    # deleted video: min(gap, 10 min) in session, 10 min at the end of a session
    rows = [v(0, None, kind="unavailable"), v(300, None, kind="unavailable"), v(300 + 2 * H, 60)]
    out = compute(rows, C)
    assert [w["est_s"] for w in out[:2]] == [300, 600]
    assert {w["est_method"] for w in out[:2]} == {"fallback"}
    assert out[0]["duration_s"] is None and out[0]["max_s"] is None


def test_live_stream_treated_as_unknown_duration():
    out = compute([v(0, 0, live="live", was_live=1), v(20 * 60, 60)], C)
    assert out[0]["est_s"] == 600 and out[0]["is_live"] == 1 and out[0]["est_method"] == "fallback"


def test_max_possible_caps_archived_streams():
    out = compute([v(0, 35_000 * H, was_live=1), v(30 * H, 600)], C)
    assert out[0]["max_s"] == 12 * H
    assert out[0]["est_s"] == 3 * H
    assert out[1]["max_s"] == 600


def test_sessions():
    rows = [v(0), v(600), v(1200), v(1200 + 31 * 60), v(1200 + 40 * 60), v(10 * H)]
    assert [w["session_id"] for w in compute(rows, C)] == [1, 1, 1, 2, 2, 3]


def test_session_gap_exactly_at_threshold_stays_in_session():
    assert [w["session_id"] for w in compute([v(0), v(1800)], C)] == [1, 1]


def test_delayed_log_fixed():
    # the real pattern: pre-roll ad, then a 10h sleep video logged 6h later
    rows = [ad(0), v(6 * H + 14, 10 * H, title="Rain sounds for sleeping"), v(16 * H, 300)]
    out = compute(rows, C)
    assert out[0]["delayed_fix"] == 1
    assert out[0]["start_epoch"] == 0
    assert out[0]["is_background"] == 1
    assert out[0]["est_s"] == 3 * H  # last of its session -> capped


def test_delayed_log_fixed_for_unknown_and_live():
    out = compute([ad(0), v(6 * H - 30, None, kind="unavailable")], C)
    assert out[0]["delayed_fix"] == 1
    out = compute([ad(0), v(6 * H + 90, 0, live="live")], C)
    assert out[0]["delayed_fix"] == 1


def test_delayed_log_not_applied_when_it_does_not_fit():
    # short video: a 6h gap after an ad is just a coincidence
    assert compute([ad(0), v(6 * H, 600)], C)[0]["delayed_fix"] == 0
    # gap not ~6h
    assert compute([ad(0), v(5 * H, 10 * H)], C)[0]["delayed_fix"] == 0
    # a video between the ad and this one: the ad belongs to the other video
    rows = [ad(0), v(60, 300), v(6 * H, 10 * H)]
    assert compute(rows, C)[1]["delayed_fix"] == 0
    # disabled in config
    off = WatchConfig(delay_enabled=False)
    assert compute([ad(0), v(6 * H, 10 * H)], off)[0]["delayed_fix"] == 0


def test_delayed_fix_changes_gap_of_previous_video():
    # previous video's gap must be measured to the corrected start
    rows = [v(0, 3 * H), ad(600), v(600 + 6 * H, 10 * H)]
    out = compute(rows, C)
    assert out[0]["gap_next_s"] == 600 and out[0]["est_s"] == 600


def test_shorts_detection():
    s = compute([
        v(0, 45, embed_w=563, embed_h=1000),            # vertical -> Short
        v(100, 150, embed_w=1000, embed_h=1000),        # square, <=180s -> Short
        v(200, 120, embed_w=1778, embed_h=1000),        # landscape short video -> not a Short
        v(300, 200, embed_w=563, embed_h=1000),         # vertical but too long
        v(400, 120, title="cool trick #shorts"),        # no shape: title hint
        v(500, 50),                                     # no shape, no hint, <=60s
        v(600, 90),                                     # no shape, 90s, no hint -> not a Short
        v(700, 30, kind="music"),                       # music is never a Short
    ], C)
    assert [w["short_basis"] for w in s] == ["shape", "shape", None, None, "hint", "duration", None, None]
    assert [w["bucket"] for w in s] == ["short", "short", "long", "long", "short", "short", "long", "music"]


def test_background_detection():
    c = WatchConfig(bg_keywords=("sleep", "rain"), bg_channels=frozenset({"UCsleepy"}))
    out = compute([
        v(0, 2 * H, title="Rain sounds"),               # long + keyword
        v(10 * H, 300, title="rain in the city vlog"),  # keyword but short -> no
        v(20 * H, 2 * H, title="Podcast ep 4"),         # long, no keyword -> no
        v(30 * H, 2 * H, title="x", tags=("deep sleep",)),  # keyword in tags
        v(40 * H, 0, title="Sleep music", live="live"),  # live counts as long
        Raw(next(_id), "video", 50 * H, "x", "UCsleepy", duration_s=60),  # listed channel
    ], c)
    assert [w["is_background"] for w in out] == [1, 0, 0, 1, 1, 1]


def test_build_writes_local_fields():
    conn = db.connect(Path(":memory:"))
    db.init_db(conn)
    conn.executemany(
        "INSERT INTO entries (id, dedupe_key, kind, time_utc, epoch, local_iso, local_date, local_hour, "
        "local_minute, local_dow, video_id, channel_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [
            (1, "a", "ad", "", 1710041400.0, "", "", 0, 0, 0, None, None),          # 2024-03-10 03:30Z
            (2, "b", "video", "", 1710041400.0 + 6 * H + 5, "", "", 0, 0, 0, "vid1", "UC1"),
        ])
    conn.execute("INSERT INTO videos (video_id, status, fetched_at, duration_s, title) "
                 "VALUES ('vid1', 'ok', '', 36000, 'Rain')")
    build_watches(conn, C, ZoneInfo("America/New_York"))
    r = conn.execute("SELECT * FROM watches").fetchone()
    # corrected start 03:30Z on Mar 10 = 22:30 EST on Mar 9
    assert (r["local_date"], r["local_hour"], r["month"], r["year"]) == ("2024-03-09", 22, "2024-03", 2024)
    assert r["delayed_fix"] == 1 and r["is_background"] == 1
