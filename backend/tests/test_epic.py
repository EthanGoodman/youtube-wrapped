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
                return 200, {"records": [{"appName": "Sugar", "namespace": "ns1", "catalogItemId": "cat1"}],
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


def test_build_dates_hours_like_steam(tmp_path):
    conn, res, _ = _built(tmp_path)
    assert res == {"snapshots": 2, "games": 2, "achievements": 1}
    days = {(g, d): (s // 60, how) for g, d, s, how in conn.execute("SELECT video_id, local_date, est_s, est_method FROM watches")}
    # 600 min before tracking on the one unlock day (Jun 1 7:30pm New York), +90 tracked on Nov 26
    assert days[("game:Sugar", "2024-06-01")] == (600, "estimate")
    assert days[("game:Sugar", "2026-11-26")] == (90, "snapshot")
    # no achievements and Epic gives no last-played day: the day before tracking began
    assert days[("game:Ghost", "2026-11-24")] == (30, "estimate")
    row = conn.execute("SELECT title, thumb_small, url FROM items WHERE item_id = 'game:Sugar'").fetchone()
    assert row[0] == "Sugar Rush" and row[1].endswith("/tall.jpg") and row[2].endswith("/sugar-rush")
    from ytw.images import check_url
    check_url(row[1])                                            # the image relay allows Epic's art host
    assert "achievements" in db.get_meta(conn, "extra_capabilities")


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
    w = client.get("/api/wrapped/2024?platform=epic").json()
    assert w["kind"] == "games" and w["top_games"][0]["title"] == "Sugar Rush"


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
