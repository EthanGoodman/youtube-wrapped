"""Epic Games (#108): sign-in, fetching through a fake Epic (no network), and building through the games family."""
import json
import sqlite3
from datetime import date
from zoneinfo import ZoneInfo

import pytest

from ytw import db
from ytw.connectors.epic import api
from ytw.connectors.epic import ingest as ep

NY = ZoneInfo("America/New_York")
ACCOUNT = "1" * 32
CODE = "2" * 32
SESSION = {"access_token": "fake-access", "refresh_token": "fake-refresh", "account_id": ACCOUNT}


class FakeEpic:
    """Answers like Epic's endpoints. `minutes` is lifetime play per app name; Ghost isn't in the library any more."""

    def __init__(self):
        self.minutes = {"Sugar": 600, "Ghost": 30}
        self.calls = []

    def __call__(self, method, url, opts):
        self.calls.append(url.split("?")[0].rsplit("/", 1)[-1] if "graphql" not in url else opts["json"]["query"].split("(")[0].split()[-1])
        if url == api.OAUTH:
            f = opts["form"]
            if f["grant_type"] == "authorization_code" and f["code"] == CODE or f.get("refresh_token") == "fake-refresh":
                return 200, {**SESSION, "refresh_token": "fake-refresh"}
            return 400, {"errorCode": "errors.com.epicgames.account.oauth.authorization_code_not_found"}
        if "/playtime/" in url:
            return 200, [{"accountId": ACCOUNT, "artifactId": a, "totalTime": m * 60} for a, m in self.minutes.items()] + \
                        [{"accountId": ACCOUNT, "artifactId": "Barely", "totalTime": 20}]
        if url.endswith("/items") and "/bulk/" not in url:
            if not opts["params"].get("cursor"):
                return 200, {"records": [{"appName": "Sugar", "namespace": "ns1", "catalogItemId": "cat1", "acquisitionDate": "2020-12-25T17:43:32.193Z"}],
                             "responseMetadata": {"nextCursor": "page2"}}
            return 200, {"records": [{"appName": "Unplayed", "namespace": "ns2", "catalogItemId": "cat2"}], "responseMetadata": {}}
        if "/bulk/items" in url:
            return 200, {"cat1": {"title": "Sugar Rush", "keyImages": [
                {"type": "DieselGameBoxTall", "url": "https://cdn1.epicgames.com/offer/ns1/tall.jpg"},
                {"type": "DieselGameBox", "url": "https://cdn1.epicgames.com/offer/ns1/wide.jpg"}],
                "customAttributes": {"com.epicgames.app.productSlug": {"value": "sugar-rush"}}}}
        if "Achievement" in opts.get("json", {}).get("query", "") and "PlayerAchievement" not in opts["json"]["query"]:
            return 200, {"data": {"Achievement": {"productAchievementsRecordBySandbox": {"achievements": [
                {"achievement": {"name": "A1", "unlockedDisplayName": "Sweet Start", "unlockedDescription": "Begin", "rarity": {"percent": 61.2}}},
                {"achievement": {"name": "A2", "unlockedDisplayName": "Sugar High", "unlockedDescription": "Win", "rarity": {"percent": 4.5}}}]}}}}
        if "PlayerAchievement" in opts.get("json", {}).get("query", ""):
            return 200, {"data": {"PlayerAchievement": {"playerAchievementGameRecordsBySandbox": {"records": [{"playerAchievements": [
                {"playerAchievement": {"achievementName": "A1", "unlocked": True, "unlockDate": "2024-06-01T23:30:00.000Z"}},
                {"playerAchievement": {"achievementName": "A2", "unlocked": False, "unlockDate": None}}]}]}}}}
        return 404, None


def test_auth_code_from_paste():
    assert api.auth_code(CODE) == CODE
    assert api.auth_code(f'{{"redirectUrl":"https://localhost","authorizationCode":"{CODE}","sid":null}}') == CODE
    with pytest.raises(api.SignInNeeded):
        api.auth_code("not a code")


def test_sign_in_with_code_and_refresh():
    fake = FakeEpic()
    assert api.sign_in(fake, code=CODE)["account_id"] == ACCOUNT
    assert api.sign_in(fake, refresh="fake-refresh")["refresh_token"] == "fake-refresh"
    with pytest.raises(api.SignInNeeded, match="single-use"):
        api.sign_in(fake, code="3" * 32)
    with pytest.raises(api.SignInNeeded, match="expired"):
        api.sign_in(fake, refresh="old")


def test_fetch_saves_snapshot_names_art_and_achievements(tmp_path):
    fake = FakeEpic()
    r = api.fetch_all(tmp_path, fake, SESSION, date(2026, 11, 25))
    assert (r["played"], r["refreshed"], r["unknown"], r["in_library"]) == (2, 2, 1, 2)     # under a minute isn't play
    snap = json.loads((tmp_path / "snapshots" / "2026-11-25.json").read_text())["games"]
    assert {g["id"]: (g["name"], g["minutes"]) for g in snap} == {"Sugar": ("Sugar Rush", 600), "Ghost": ("Ghost", 30)}
    sugar = json.loads((tmp_path / "games" / "Sugar.json").read_text())
    assert sugar["poster"].endswith("/tall.jpg") and sugar["header"].endswith("/wide.jpg")
    assert sugar["url"] == "https://store.epicgames.com/p/sugar-rush"
    assert sugar["achievements"][0]["unlocked"] == 1717284600 and sugar["achievements"][1]["unlocked"] is None
    assert sugar["rarity"] == {"A1": 61.2, "A2": 4.5}
    n = len(fake.calls)
    api.fetch_all(tmp_path, fake, SESSION, date(2026, 11, 26))
    assert fake.calls[n:] == ["all", "items", "items"]                  # nothing played since: no details asked again
    fake.minutes["Sugar"] = 690
    api.fetch_all(tmp_path, fake, SESSION, date(2026, 11, 27))
    assert json.loads((tmp_path / "games" / "Sugar.json").read_text())["minutes"] == 690


def _built(tmp_path):
    fake = FakeEpic()
    folder = tmp_path / "epic"
    api.fetch_all(folder, fake, SESSION, date(2026, 11, 25))
    fake.minutes["Sugar"] = 690
    api.fetch_all(folder, fake, SESSION, date(2026, 11, 26))
    conn = db.connect(tmp_path / "epic.db")
    res = ep.ingest(conn, folder)
    n = ep.build(conn, NY)
    return conn, res, n


def test_build_dates_only_tracked_play(tmp_path):
    conn, res, _ = _built(tmp_path)
    assert res == {"snapshots": 2, "games": 2, "achievements": 1}
    # the one real day: +90 min between the Nov 25 and Nov 26 checks; everything before tracking has no date
    assert [tuple(r) for r in conn.execute("SELECT video_id, local_date, est_s / 60 FROM watches")] == [("game:Sugar", "2026-11-26", 90)]
    assert sorted(tuple(r) for r in conn.execute("SELECT video_id, est_s / 60 FROM undated_watches")) == [("game:Ghost", 30), ("game:Sugar", 600)]
    row = conn.execute("SELECT title, thumb_small, url, extra FROM items WHERE item_id = 'game:Sugar'").fetchone()
    assert row[0] == "Sugar Rush" and row[1].endswith("/tall.jpg") and row[2].endswith("/sugar-rush")
    assert json.loads(row[3])["acquired"] == "2020-12-25"            # when you got it (Epic's library says)
    from ytw.images import check_url
    check_url(row[1])                                            # the image relay allows Epic's art host
    assert "achievements" in db.get_meta(conn, "extra_capabilities")
    assert db.get_meta(conn, "activity_years") == "2024,2026"     # an unlock in 2024, tracked play in 2026


def test_a_gap_in_tracking_is_not_dated(tmp_path):
    """Two checks three days apart: the growth could be any of those days, so it counts in lifetime totals only."""
    fake = FakeEpic()
    folder = tmp_path / "epic"
    api.fetch_all(folder, fake, SESSION, date(2026, 11, 25))
    fake.minutes["Sugar"] = 900
    api.fetch_all(folder, fake, SESSION, date(2026, 11, 28))
    conn = db.connect(tmp_path / "epic.db")
    ep.ingest(conn, folder)
    ep.build(conn, NY)
    assert conn.execute("SELECT COUNT(*) FROM watches").fetchone()[0] == 0
    assert conn.execute("SELECT SUM(est_s) / 60 FROM undated_watches WHERE video_id = 'game:Sugar'").fetchone()[0] == 900


def test_achievement_pages(tmp_path):
    from conftest import make_client
    from ytw.api import create_app
    from ytw.config import load_config
    conn, _, _ = _built(tmp_path)
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"epic": tmp_path / "epic.db"}, static_dir=tmp_path / "x"))
    q = "platform=epic&range=all"
    assert client.get("/api/meta?platform=epic").json()["platform"]["family"] == "games"
    a = client.get(f"/api/games/achievements?{q}").json()
    assert a["unlocked"] == 1 and a["total"] == 2
    g = client.get(f"/api/games/game/game:Sugar?{q}").json()
    assert (g["unlocked"], g["total"]) == (1, 2)


def test_undated_hours_count_in_lifetime_totals_only(tmp_path):
    """The 630 undated minutes: in all-time hours, top games, a game's page and the hub; never in a year, a calendar
    or a chart over time."""
    from conftest import make_client
    from ytw.api import create_app
    from ytw.config import load_config
    conn, _, _ = _built(tmp_path)
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"epic": tmp_path / "epic.db"}, static_dir=tmp_path / "x"))
    hours = lambda q: client.get(f"/api/overview?platform=epic&{q}").json()["est_s"] // 60   # noqa: E731
    assert hours("range=all") == 600 + 90 + 30
    top = {t["title"]: t["time_s"] // 60 for t in client.get("/api/top/channels?platform=epic&range=all&metric=time").json()["items"]}
    assert top == {"Sugar Rush": 690, "Ghost": 30}
    assert client.get("/api/channel/game:Ghost?platform=epic&range=all").json()["all_time"]["est_s"] == 1800
    hub = {p["id"]: p for p in client.get("/api/platforms").json()}
    assert hub["epic"]["est_s"] == (600 + 90 + 30) * 60
    # anything dated leaves it out: a year (even one holding every tracked day), the calendar
    assert hours("range=2026") == 90 and hours("range=2024") == 0
    assert "Ghost" not in {t["title"] for t in client.get("/api/top/channels?platform=epic&range=2026&metric=time").json()["items"]}
    cal = client.get("/api/patterns/calendar?platform=epic&range=all").json()
    assert sum(d.get("time_s", 0) for d in cal["data"]) // 60 == 90


def test_old_steam_tables_move_over(tmp_path):
    """A Steam database built before the games family shared its tables keeps its rows."""
    from ytw.connectors import games
    conn = sqlite3.connect(tmp_path / "old.db")
    conn.executescript("""
        CREATE TABLE st_snapshots (day TEXT, appid INTEGER, minutes INTEGER, last_played INTEGER);
        CREATE TABLE st_games (appid INTEGER, name TEXT, genres TEXT);
        CREATE TABLE st_achievements (appid INTEGER, api TEXT, name TEXT, description TEXT, unlocked INTEGER, rarity REAL);
        INSERT INTO st_snapshots VALUES ('2026-11-20', 10, 60, NULL);
        INSERT INTO st_games VALUES (10, 'Alpha', '[]');
        INSERT INTO st_achievements VALUES (10, 'A1', 'One', NULL, 1690000000, 5.0);""")
    games.init(conn)
    assert conn.execute("SELECT game, minutes FROM game_snapshots").fetchall() == [("10", 60)]
    assert conn.execute("SELECT game, name FROM game_titles").fetchall() == [("10", "Alpha")]
    assert conn.execute("SELECT game, api FROM game_achievements").fetchall() == [("10", "A1")]
    assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'st_games'").fetchone()


def test_sign_in_code_is_used_once(tmp_path, monkeypatch):
    """The one-time code is deleted after the fetch tries it, and the refresh token is kept for next time."""
    from ytw.connectors.epic import Epic
    saved = {"EPIC_AUTH_CODE": CODE}

    class Store:
        def set(self, k, v):
            saved[k] = v

        def delete(self, k):
            return saved.pop(k, None) is not None
    monkeypatch.setattr("ytw.secrets.store", lambda: Store())
    monkeypatch.setattr("ytw.secrets.get", lambda k: saved.get(k))
    s = Epic._session(object.__new__(Epic), FakeEpic())
    assert s["account_id"] == ACCOUNT and "EPIC_AUTH_CODE" not in saved and saved["EPIC_REFRESH_TOKEN"] == "fake-refresh"
    assert Epic._session(object.__new__(Epic), FakeEpic())["account_id"] == ACCOUNT          # next time: the refresh token
