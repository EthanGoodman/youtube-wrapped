from conftest import make_client  # noqa: E402
"""Crunchyroll history fetcher, against a fake Crunchyroll (never the real one)."""
import json
import urllib.parse

import pytest

from ytw.crunchyroll.fetch import API, HISTORY_FILE, CookieExpired, CrunchyrollError, WrongProfile, fetch_history

COOKIE = "good-cookie"


def item(n: int) -> dict:
    return {"id": f"h{n}", "date_played": f"2026-01-{n:02d}T20:00:00Z", "fully_watched": n % 2 == 0, "playhead": 600 + n,
            "panel": {"id": f"ep{n}", "title": f"Episode {n}",
                      "episode_metadata": {"series_id": "S1", "series_title": "Frieren", "season_number": 1, "episode_number": n}}}


class FakeCrunchyroll:
    """Answers like Crunchyroll: token from the cookie, /me, and a 3-page cursor-paged history."""

    def __init__(self, expire_after: int | None = None, flaky: int = 0, selected: str = "Ethan"):
        self.selected = selected
        self.calls: list[tuple[str, str]] = []
        self.tokens = 0
        self.expire_after = expire_after  # first token stops working after this many history calls
        self.history_calls = 0
        self.flaky = flaky                # how many 429s to send before answering

    def __call__(self, method, url, headers, form):
        path = urllib.parse.urlparse(url).path
        self.calls.append((method, path))
        if self.flaky:
            self.flaky -= 1
            return 429, None
        if path == "/auth/v1/token":
            assert method == "POST" and form["grant_type"] == "etp_rt_cookie"
            assert headers["Authorization"].startswith("Basic ")
            if headers.get("Cookie") != f"etp_rt={COOKIE}":
                return 401, {"error": "invalid_grant"}
            self.tokens += 1
            return 200, {"access_token": f"tok{self.tokens}", "refresh_token": "never-saved", "expires_in": 300}
        token = headers.get("Authorization", "")
        if path == "/accounts/v1/me/multiprofile":
            return 200, {"profiles": [{"profile_name": "Caleb", "is_selected": False},
                                      {"profile_name": self.selected, "is_selected": True}]}
        if path == "/accounts/v1/me":
            return 200, {"account_id": "acc-123"}
        if path == "/content/v2/acc-123/watch-history":
            self.history_calls += 1
            if self.expire_after and self.history_calls > self.expire_after and token == "Bearer tok1":
                return 401, {"error": "expired"}
            q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            cursor = q.get("cursor", ["0"])[0]
            pages = {"0": ([item(1), item(2)], "/content/v2/acc-123/watch-history?cursor=a&page_size=100"),
                     "a": ([item(3), item(4)], f"{API}/content/v2/acc-123/watch-history?cursor=b&page_size=100"),
                     "b": ([item(5)], "")}
            data, nxt = pages[cursor]
            return 200, {"data": data, "meta": {"next_page": nxt}}
        return 404, None


def run(tmp_path, fake, cookie=COOKIE, profile="Ethan"):
    return fetch_history(tmp_path / "crunchyroll", cookie, transport=fake, pause_s=0, sleep=lambda s: None, profile=profile)


def test_fetches_every_page(tmp_path):
    fake = FakeCrunchyroll()
    res = run(tmp_path, fake)
    assert res["items"] == 5 and res["first"].startswith("2026-01-01") and res["last"].startswith("2026-01-05")
    saved = json.loads((tmp_path / "crunchyroll" / HISTORY_FILE).read_text(encoding="utf-8"))
    assert [i["id"] for i in saved["items"]] == ["h1", "h2", "h3", "h4", "h5"]
    assert saved["items"][0]["playhead"] == 601          # raw fields are kept as-is
    text = json.dumps(saved)
    assert "tok1" not in text and "never-saved" not in text and COOKIE not in text  # no secrets on disk


def test_expired_token_logs_in_again(tmp_path):
    fake = FakeCrunchyroll(expire_after=1)
    assert run(tmp_path, fake)["items"] == 5
    assert fake.tokens == 2


def test_bad_cookie(tmp_path):
    with pytest.raises(CookieExpired, match="fresh etp_rt"):
        run(tmp_path, FakeCrunchyroll(), cookie="stale")
    assert not (tmp_path / "crunchyroll" / HISTORY_FILE).exists()
    with pytest.raises(CookieExpired):
        run(tmp_path, FakeCrunchyroll(), cookie="")


def test_rate_limit_is_retried(tmp_path):
    assert run(tmp_path, FakeCrunchyroll(flaky=2))["items"] == 5


def test_failed_fetch_keeps_previous_file(tmp_path):
    run(tmp_path, FakeCrunchyroll())
    before = (tmp_path / "crunchyroll" / HISTORY_FILE).read_text(encoding="utf-8")

    def broken(method, url, headers, form):
        if "watch-history" in url:
            return 500, None
        return FakeCrunchyroll()(method, url, headers, form)
    with pytest.raises(CrunchyrollError):
        run(tmp_path, broken)
    assert (tmp_path / "crunchyroll" / HISTORY_FILE).read_text(encoding="utf-8") == before


def test_only_the_chosen_profile(tmp_path):
    assert run(tmp_path, FakeCrunchyroll())["profile"] == "Ethan"
    saved = json.loads((tmp_path / "crunchyroll" / HISTORY_FILE).read_text(encoding="utf-8"))
    assert saved["profile"] == "Ethan"
    # the browser session is on someone else's profile: download nothing
    with pytest.raises(WrongProfile, match="pick the Ethan profile"):
        run(tmp_path / "other", FakeCrunchyroll(selected="Caleb"))
    assert not (tmp_path / "other" / "crunchyroll" / HISTORY_FILE).exists()


# ------------------------------------------------------------------ import

from zoneinfo import ZoneInfo  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from ytw import db  # noqa: E402
from ytw.api import create_app  # noqa: E402
from ytw.config import load_config  # noqa: E402
from ytw.crunchyroll import ingest as cr  # noqa: E402
from ytw.stats import shows  # noqa: E402
from ytw.stats.common import Filters, resolve_range  # noqa: E402

NY = ZoneInfo("America/New_York")


def entry(eid, series, n, played, playhead, full, audio="ja-JP", aired="2026-01-01T00:00:00Z", genres=("Action",)):
    return {"id": eid, "date_played": played, "playhead": playhead, "fully_watched": full, "parent_id": series,
            "panel": {"id": eid, "type": "episode", "title": f"Ep {n}", "slug_title": f"ep-{n}",
                      "images": {"thumbnail": [[{"width": 320, "height": 180, "source": f"https://img/{eid}/320"},
                                                {"width": 640, "height": 360, "source": f"https://img/{eid}/640"},
                                                {"width": 1280, "height": 720, "source": f"https://img/{eid}/1280"}]]},
                      "episode_metadata": {"series_id": series, "series_title": "Frieren" if series == "S1" else "Dandadan",
                                           "series_slug_title": "x", "season_id": series + "-1", "season_title": "Season 1",
                                           "season_display_number": "1", "season_number": 1, "episode": str(n),
                                           "episode_number": n, "duration_ms": 1440000, "audio_locale": audio,
                                           "episode_air_date": aired, "tenant_categories": list(genres)}}}


HISTORY = [
    entry("e1", "S1", 1, "2026-01-03T02:00:00Z", 1300, True, aired="2026-01-01T00:00:00Z"),          # 2 days after air
    entry("e2", "S1", 2, "2026-01-03T02:30:00Z", 700, False, aired="2026-01-08T00:00:00Z"),          # half, before air? no: played 01-03
    entry("e3", "S2", 1, "2026-03-10T23:00:00Z", 1440, True, audio="en-US", aired="2024-10-01T00:00:00Z",
          genres=("Action", "Comedy")),                                                                 # dub, long after
    entry("e4", "S2", 2, "2026-03-11T00:00:00Z", 12, False),                                             # a 12-second tap
    {"id": "gone", "date_played": "2026-03-12T00:00:00Z", "playhead": 4, "fully_watched": False},        # removed video
]


def _cr_db(tmp_path):
    folder = tmp_path / "crunchyroll"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / HISTORY_FILE).write_text(json.dumps({"profile": "Ethan", "items": HISTORY}), encoding="utf-8")
    conn = db.connect(tmp_path / "crunchyroll.db")
    res = cr.build(conn, folder, NY)
    return conn, res


def test_build(tmp_path):
    conn, res = _cr_db(tmp_path)
    assert res["plays"] == 3 and res["series"] == 2 and res["skipped"] == 2
    rows = conn.execute("SELECT video_id, est_s, max_s, est_method, local_hour, session_id FROM watches ORDER BY start_epoch").fetchall()
    # finished -> its length; partly watched -> how far you got
    assert [(r[1], r[3]) for r in rows] == [(1440, "complete"), (700, "playhead"), (1440, "complete")]
    assert rows[0][4] == 21                              # 02:00 UTC = 9pm in New York the day before
    assert rows[0][5] == rows[1][5] != rows[2][5]        # two episodes back to back = one session
    thumb = conn.execute("SELECT thumb_small, thumb_large FROM items WHERE item_id = 'ep:e1'").fetchone()
    assert tuple(thumb) == ("https://img/e1/640", "https://img/e1/1280")
    assert {g for (g,) in conn.execute("SELECT DISTINCT genre FROM item_genres")} == {"Action", "Comedy"}
    assert db.get_meta(conn, "extra_capabilities") == "time_of_day"


def test_anime_stats(tmp_path):
    conn, _ = _cr_db(tmp_path)
    a = shows.anime(conn, resolve_range(conn, "all"), Filters())
    assert (a["sub"]["count"], a["dub"]["count"]) == (2, 1)
    assert a["simulcast"] == 1 and a["simulcast_shows"][0]["title"] == "Frieren"
    assert a["dated"] == 2                               # e2 was "played" before its air date: not counted


def test_api_on_crunchyroll(tmp_path):
    conn, _ = _cr_db(tmp_path)
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"crunchyroll": tmp_path / "crunchyroll.db"},
                                   static_dir=tmp_path / "nodist"))
    caps = client.get("/api/meta?platform=crunchyroll").json()["platform"]["capabilities"]
    assert {"series", "anime", "time_of_day", "genres"} <= set(caps) and "estimated_time" not in caps
    assert client.get("/api/overview?platform=crunchyroll&range=all").json()["videos"] == 3
    assert client.get("/api/shows/anime?platform=crunchyroll&range=all").status_code == 200
    w = client.get("/api/wrapped/2026?platform=crunchyroll").json()
    assert w["platform"] == "crunchyroll" and not w["empty"]


def test_show_stats_with_blank_season_labels(tmp_path):
    # Crunchyroll sometimes sends an empty season label; the show stats must still work
    odd = entry("e9", "S1", 3, "2026-01-04T02:00:00Z", 1440, True)
    odd["panel"]["episode_metadata"]["season_display_number"] = ""
    odd["panel"]["episode_metadata"]["season_number"] = None
    folder = tmp_path / "crunchyroll"
    folder.mkdir()
    (folder / HISTORY_FILE).write_text(json.dumps({"profile": "Ethan", "items": HISTORY[:2] + [odd]}), encoding="utf-8")
    conn = db.connect(tmp_path / "crunchyroll.db")
    cr.build(conn, folder, NY)
    r, f = resolve_range(conn, "all"), Filters()
    frieren = shows.progress(conn, r, f)["shows"][0]
    assert frieren["title"] == "Frieren" and frieren["watched"] == 3 and frieren["total"] is None
    assert shows.show_detail(conn, "series:S1", f)["episodes_watched"] == 3
    assert shows.home(conn, r, f)["billboard"]["title"] == "Frieren"


# ------------------------------------------------------------------ catalog + AniList

from ytw.crunchyroll import anilist, catalog  # noqa: E402
from ytw.crunchyroll.fetch import Client  # noqa: E402


class FakeCatalog(FakeCrunchyroll):
    """Frieren (S1): 1 season of 4 episodes, listed twice (original + an English dub season)."""

    def __call__(self, method, url, headers, form):
        path = urllib.parse.urlparse(url).path
        if path == "/content/v2/cms/series/S1":
            return 200, {"data": [{"id": "S1", "title": "Frieren", "description": "An elf mage...", "episode_count": 4,
                                   "season_count": 1, "series_launch_year": 2023, "is_simulcast": True, "keywords": [],
                                   "images": {"poster_tall": [[{"width": 480, "height": 720, "source": "https://img/p480"}]],
                                              "poster_wide": [[{"width": 1200, "height": 675, "source": "https://img/w1200"}]]}}]}
        if path == "/content/v2/cms/series/S1/seasons":
            return 200, {"data": [{"id": "S1-1", "season_sequence_number": 1, "title": "Frieren", "audio_locale": "ja-JP",
                                   "number_of_episodes": 4, "versions": [{}]},
                                  {"id": "S1-dub", "season_sequence_number": 1, "title": "Frieren (English Dub)",
                                   "audio_locale": "en-US", "number_of_episodes": 4}]}
        if path == "/content/v2/cms/seasons/S1-1/episodes":
            return 200, {"data": [{"id": f"e{n}", "episode_number": n, "title": f"Ep {n}", "duration_ms": 1440000,
                                   "episode_air_date": f"2025-0{n}-01T00:00:00Z"} for n in range(1, 5)]}
        if path.startswith("/content/v2/cms/"):
            return 200, {"data": []}
        return super().__call__(method, url, headers, form)


def fake_anilist(query, variables):
    media = {"id": 154587, "title": {"romaji": "Sousou no Frieren", "english": "Frieren: Beyond Journey's End", "native": None},
             "synonyms": ["Frieren"], "format": "TV", "season": "FALL", "seasonYear": 2023, "averageScore": 90,
             "genres": ["Adventure", "Drama"], "tags": [{"name": "Elf", "rank": 95, "isMediaSpoiler": False}],
             "studios": {"nodes": [{"name": "Madhouse"}]}, "coverImage": {"extraLarge": "https://a/c.jpg", "color": "#e4a15d"},
             "bannerImage": None, "siteUrl": "https://anilist.co/anime/154587"}
    decoy = {**media, "id": 1, "title": {"romaji": "Frieren Specials", "english": None, "native": None}, "synonyms": []}
    return {"data": {"Page": {"media": [decoy, media]}}}


def test_catalog_and_anilist(tmp_path):
    conn, _ = _cr_db(tmp_path)
    client = Client(COOKIE, transport=FakeCatalog(), pause_s=0, sleep=lambda s: None)
    r = catalog.fetch_catalog(conn, client, ["S1"])
    assert r["episodes"] == 4                                   # the dub season isn't counted again
    assert catalog.fetch_catalog(conn, client, ["S1"])["fetched"] == 0   # cached
    a = anilist.enrich(conn, [("S1", "Frieren")], post=fake_anilist, pause_s=0, sleep=lambda s: None)
    assert a["matched"] == 1
    cr.build(conn, tmp_path / "crunchyroll", NY)
    show = conn.execute("SELECT avatar_url, item_count, extra FROM creators WHERE creator_id = 'series:S1'").fetchone()
    extra = json.loads(show[2])
    assert show[0] == "https://img/p480" and show[1] == 4
    assert extra["studios"] == ["Madhouse"] and extra["anime_season"] == "Fall 2023" and extra["backdrop"] == "https://img/w1200"
    assert extra["anilist_id"] == 154587                        # the exact title (a synonym) beat the decoy listed first
    f = Filters()
    p = next(s for s in shows.progress(conn, resolve_range(conn, "all"), f)["shows"] if s["key"] == "series:S1")
    assert (p["watched"], p["total"]) == (2, 4)
    d = shows.show_detail(conn, "series:S1", f)
    assert [(s["season"], s["watched"], s["aired"]) for s in d["seasons"]] == [(1, 2, 4)]


def test_anilist_overrides(tmp_path):
    conn, _ = _cr_db(tmp_path)
    calls = []

    def post(q, v):
        calls.append(v)
        return fake_anilist(q, v) if "q" in v else {"data": {"Media": {**fake_anilist(q, v)["data"]["Page"]["media"][1], "id": v["id"]}}}
    anilist.enrich(conn, [("S1", "Frieren"), ("S2", "Dandadan")], post=post, overrides={"Frieren": 999, "Dandadan": 0},
                   pause_s=0, sleep=lambda s: None)
    rows = dict(conn.execute("SELECT series_id, anilist_id FROM anilist").fetchall())
    assert rows == {"S1": 999, "S2": None} and calls == [{"id": 999}]
    f = tmp_path / "o.toml"
    f.write_text('[anilist]\n"Frieren" = 154587\n"Dandadan" = 0\n')
    assert anilist.load_overrides(f) == {"Frieren": 154587, "Dandadan": 0}


def test_anilist_prefers_the_tv_series():
    tv = {"id": 1, "title": {"english": "Frieren: Beyond Journey’s End", "romaji": "Sousou no Frieren"}, "synonyms": [],
          "format": "TV", "seasonYear": 2023}
    special = {"id": 2, "title": {"english": None, "romaji": "Sousou no Frieren: Mini Anime"},
               "synonyms": ["Frieren: Beyond Journey's End"], "format": "ONA", "seasonYear": 2025}
    assert anilist.best_match("Frieren: Beyond Journey's End", [special, tv])["id"] == 1


def test_home_cards_carry_anime_details(tmp_path):
    conn, _ = _cr_db(tmp_path)
    client = Client(COOKIE, transport=FakeCatalog(), pause_s=0, sleep=lambda s: None)
    catalog.fetch_catalog(conn, client, ["S1"])
    anilist.enrich(conn, [("S1", "Frieren")], post=fake_anilist, pause_s=0, sleep=lambda s: None)
    cr.build(conn, tmp_path / "crunchyroll", NY)
    h = shows.home(conn, resolve_range(conn, "all"), Filters())
    frieren = next(i for i in h["top10"] if i["key"] == "series:S1")
    assert frieren["studios"] == ["Madhouse"] and frieren["anime_season"] == "Fall 2023" and frieren["score"] == 90
    assert frieren["dub_share"] == 0.0
    dandadan = next(i for i in h["top10"] if i["key"] == "series:S2")
    assert dandadan["dub_share"] == 1.0                  # its one counted episode was the English dub


def test_anime_page(tmp_path):
    conn, _ = _cr_db(tmp_path)
    client = Client(COOKIE, transport=FakeCatalog(), pause_s=0, sleep=lambda s: None)
    catalog.fetch_catalog(conn, client, ["S1"])
    anilist.enrich(conn, [("S1", "Frieren")], post=fake_anilist, pause_s=0, sleep=lambda s: None)
    cr.build(conn, tmp_path / "crunchyroll", NY)
    a = shows.anime_page(conn, resolve_range(conn, "all"), Filters())
    assert (a["sub_dub"]["sub"], a["sub_dub"]["dub"]) == (2, 1) and a["series_count"] == 2
    assert a["simulcast"]["episodes"] == 1 and a["simulcast"]["series"][0]["title"] == "Frieren"
    assert a["studios"][0]["name"] == "Madhouse" and a["studios"][0]["count"] == 2
    assert a["seasons"][0]["season"] == "Fall 2023" and a["decades"] == [{"decade": "2020s", "count": 2}]
    assert a["scores"]["average"] == 90 and a["tags"][0]["tag"] == "Elf"


def test_show_detail_episode_progress(tmp_path):
    conn, _ = _cr_db(tmp_path)
    client = Client(COOKIE, transport=FakeCatalog(), pause_s=0, sleep=lambda s: None)
    catalog.fetch_catalog(conn, client, ["S1"])
    cr.build(conn, tmp_path / "crunchyroll", NY)
    d = shows.show_detail(conn, "series:S1", Filters())
    eps = d["seasons"][0]["episodes"]
    assert eps[0]["pct"] == 1.0 and eps[0]["dubbed"] is False      # finished, subbed
    assert round(eps[1]["pct"], 2) == 0.49                          # 700 of 1440 seconds
    assert eps[2]["pct"] is None and not eps[2]["watched"]
    assert d["dub_share"] == 0.0


def test_crunchyroll_wrapped(tmp_path):
    from pathlib import Path as _P
    from ytw.wrapped import NETFLIX_METRICS, load_personalities, netflix_wrapped
    conn, _ = _cr_db(tmp_path)
    client = Client(COOKIE, transport=FakeCatalog(), pause_s=0, sleep=lambda s: None)
    catalog.fetch_catalog(conn, client, ["S1"])
    anilist.enrich(conn, [("S1", "Frieren")], post=fake_anilist, pause_s=0, sleep=lambda s: None)
    cr.build(conn, tmp_path / "crunchyroll", NY)
    cfg = load_personalities(_P(__file__).parents[2] / "personalities-crunchyroll.toml", NETFLIX_METRICS)
    d = netflix_wrapped(conn, 2026, Filters(), cfg, has_times=True, anime=True)
    assert d["anime"]["sub"] == 2 and d["anime"]["dub"] == 1 and d["anime"]["studio"]["name"] == "Madhouse"
    m = d["metrics"]
    assert round(m["dub_share"], 2) == 0.33 and round(m["simulcast_share"], 2) == 0.33
    assert d["personality"]["name"]


def test_image_relay_allows_crunchyroll_images_only():
    from ytw.images import NotAllowed, check_url
    check_url("https://www.crunchyroll.com/imgsrv/display/thumbnail/480x720/catalog/crunchyroll/x.png")
    for bad in ("https://www.crunchyroll.com/account", "https://evil.example/imgsrv/x.png"):
        with pytest.raises(NotAllowed):
            check_url(bad)


def test_wrapped_uses_stored_capabilities(tmp_path):
    conn, _ = _cr_db(tmp_path)
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"crunchyroll": tmp_path / "crunchyroll.db"},
                                   static_dir=tmp_path / "nodist"))
    w = client.get("/api/wrapped/2026?platform=crunchyroll").json()
    assert w["has_times"] is True and w["clock"] and w["anime"]["sub"] == 2
