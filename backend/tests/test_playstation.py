"""PlayStation (#60): sign-in, fetching through a fake PSN (no network), and building through the games family."""
import json
from datetime import date
from zoneinfo import ZoneInfo

import pytest

from ytw import db
from ytw.connectors.playstation import api
from ytw.connectors.playstation import ingest as ps

NY = ZoneInfo("America/New_York")
NPSSO = "a" * 64
SESSION = {"access_token": "fake-access", "refresh_token": "fake-refresh"}


class FakePsn:
    """Answers like PSN. Kart Rally (PS4) has playtime and trophies; Old Quest (PS3) has trophies only."""

    def __init__(self):
        self.minutes = {"CUSA00001_00": 600}
        self.calls = []

    def __call__(self, method, url, opts):
        self.calls.append(url.split("?")[0].rsplit("/", 1)[-1])
        if url.endswith("/authorize"):
            ok = opts["headers"].get("Cookie") == f"npsso={NPSSO}"
            return (302, None, {"location": "com.scee.psxandroid.scecompcall://redirect/?code=v3.FAKE&cid=x"} if ok else {})
        if url.endswith("/token"):
            f = opts["form"]
            good = f.get("code") == "v3.FAKE" or f.get("refresh_token") == "fake-refresh"
            return (200, SESSION, {}) if good else (400, {"error": "invalid_grant"}, {})
        if url == api.GAMELIST:
            return 200, {"titles": [{"titleId": "CUSA00001_00", "name": "Kart Rally", "localizedName": "Kart Rally",
                                     "imageUrl": "https://image.api.playstation.com/kart.png", "category": "ps4_game",
                                     "playCount": 40, "firstPlayedDateTime": "2019-04-13T18:00:00Z",
                                     "lastPlayedDateTime": "2024-11-06T02:30:00Z",
                                     "playDuration": f"PT{self.minutes['CUSA00001_00'] // 60}H{self.minutes['CUSA00001_00'] % 60}M5S"}],
                         "nextOffset": None}, {}
        if url.endswith("/users/me/trophyTitles"):
            return 200, {"trophyTitles": [
                {"npCommunicationId": "NPWR00001_00", "npServiceName": "trophy", "trophyTitleName": "Kart Rally",
                 "trophyTitlePlatform": "PS4", "trophyTitleIconUrl": "https://image.api.playstation.com/kart-t.png",
                 "lastUpdatedDateTime": "2024-11-06T02:00:00Z"},
                {"npCommunicationId": "NPWR00002_00", "npServiceName": "trophy", "trophyTitleName": "Old Quest",
                 "trophyTitlePlatform": "PS3", "trophyTitleIconUrl": "https://image.api.playstation.com/old.png",
                 "lastUpdatedDateTime": "2012-03-01T20:00:00Z"}]}, {}
        if url.endswith("/titles/trophyTitles"):
            return 200, {"titles": [{"npTitleId": "CUSA00001_00", "trophyTitles": [{"npCommunicationId": "NPWR00001_00"}]}]}, {}
        if "/users/me/npCommunicationIds/" in url:
            if "NPWR00001_00" in url:
                return 200, {"trophies": [
                    {"trophyId": 0, "earned": True, "earnedDateTime": "2020-02-01T23:30:00Z", "trophyEarnedRate": "1.2"},
                    {"trophyId": 1, "earned": True, "earnedDateTime": "2019-04-13T19:00:00Z", "trophyEarnedRate": "80.5"},
                    {"trophyId": 2, "earned": False, "trophyEarnedRate": "30.0"}]}, {}
            return 200, {"trophies": [{"trophyId": 0, "earned": True, "earnedDateTime": "2012-02-29T21:00:00Z", "trophyEarnedRate": "12.0"}]}, {}
        if "/npCommunicationIds/" in url:
            if "NPWR00001_00" in url:
                return 200, {"trophies": [
                    {"trophyId": 0, "trophyType": "platinum", "trophyName": "Kart King", "trophyDetail": "Every trophy"},
                    {"trophyId": 1, "trophyType": "bronze", "trophyName": "First Lap", "trophyDetail": "Finish a race"},
                    {"trophyId": 2, "trophyType": "gold", "trophyName": "Perfect", "trophyDetail": "Win without a hit"}]}, {}
            return 200, {"trophies": [{"trophyId": 0, "trophyType": "silver", "trophyName": "Dungeon", "trophyDetail": "Clear it"}]}, {}
        return 404, None, {}


def test_npsso_from_paste():
    assert api.npsso_value(NPSSO) == NPSSO
    assert api.npsso_value(f'{{"npsso":"{NPSSO}"}}') == NPSSO
    with pytest.raises(api.SignInNeeded):
        api.npsso_value("\x16")                     # Ctrl+V typed at a hidden prompt


def test_sign_in_with_npsso_and_refresh():
    fake = FakePsn()
    assert api.sign_in(fake, npsso=NPSSO)["refresh_token"] == "fake-refresh"
    assert api.sign_in(fake, refresh="fake-refresh")["access_token"] == "fake-access"
    with pytest.raises(api.SignInNeeded, match="npsso"):
        api.sign_in(fake, npsso="b" * 64)
    with pytest.raises(api.SignInNeeded):
        api.sign_in(fake, refresh="old")


def test_play_duration():
    assert api._minutes("PT243H18M48S") == 243 * 60 + 18
    assert api._minutes("P1DT2H") == 26 * 60
    assert api._minutes(None) == 0


def test_fetch_saves_games_and_trophies(tmp_path):
    r = api.fetch_all(tmp_path, FakePsn(), SESSION, date(2026, 11, 25))
    assert (r["games"], r["played"], r["trophy_sets"]) == (2, 1, 2)       # Old Quest: trophies only, no playtime
    snap = {g["id"]: g for g in json.loads((tmp_path / "snapshots" / "2026-11-25.json").read_text())["games"]}
    kart = snap["CUSA00001_00"]
    assert (kart["minutes"], kart["plays"]) == (600, 40) and kart["first_played"] == 1555178400
    assert snap["NPWR00002_00"]["minutes"] == 0
    saved = json.loads((tmp_path / "games" / "CUSA00001_00.json").read_text())
    assert [(a["name"], a["type"], bool(a["unlocked"])) for a in saved["achievements"]] == \
        [("Kart King", "platinum", True), ("First Lap", "bronze", True), ("Perfect", "gold", False)]
    assert saved["rarity"] == {"0": 1.2, "1": 80.5, "2": 30.0}


def _built(tmp_path):
    fake = FakePsn()
    folder = tmp_path / "playstation"
    api.fetch_all(folder, fake, SESSION, date(2026, 11, 25))
    fake.minutes["CUSA00001_00"] = 690
    api.fetch_all(folder, fake, SESSION, date(2026, 11, 26))
    conn = db.connect(tmp_path / "playstation.db")
    res = ps.ingest(conn, folder)
    n = ps.build(conn, NY)
    return conn, res, n


def test_build_is_real_data_only(tmp_path):
    conn, res, _ = _built(tmp_path)
    assert res == {"snapshots": 2, "games": 2, "achievements": 3}
    assert [tuple(r) for r in conn.execute("SELECT video_id, local_date, est_s / 60 FROM watches")] == [("game:CUSA00001_00", "2026-11-26", 90)]
    extra = json.loads(conn.execute("SELECT extra FROM items WHERE item_id = 'game:CUSA00001_00'").fetchone()[0])
    assert (extra["first_played"], extra["plays"]) == ("2019-04-13", 40)
    # first played (2019), the PS3 trophy (2012) and the unlocks are all real activity years
    assert db.get_meta(conn, "activity_years").startswith("2012,2019,2020")
    assert conn.execute("SELECT kind FROM game_achievements WHERE api = '0' AND game = 'CUSA00001_00'").fetchone()[0] == "platinum"


def test_pages_and_wrapped(tmp_path):
    from conftest import make_client
    from ytw.api import create_app
    from ytw.config import load_config
    conn, _, _ = _built(tmp_path)
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"playstation": tmp_path / "playstation.db"}, static_dir=tmp_path / "x"))
    t = {x["game"]["title"]: x for x in client.get("/api/games/timeline?platform=playstation").json()}
    assert (t["Kart Rally"]["first_played"], t["Kart Rally"]["plays"], t["Kart Rally"]["minutes"]) == ("2019-04-13", 40, 690)
    assert t["Old Quest"]["unlocks"] == 1 and t["Old Quest"]["minutes"] == 0       # a PS3 game: trophies, no hours
    rec = client.get("/api/games/records?platform=playstation&range=all").json()
    assert rec["platinums"]["count"] == 1 and rec["platinums"]["latest"]["name"] == "Kart King"
    assert rec["most_sessions"]["plays"] == 40 and rec["longest_sessions"]["minutes"] == round(690 / 40)
    w = client.get("/api/wrapped/2019?platform=playstation").json()
    assert not w["empty"] and [g["title"] for g in w["new_games"]] == ["Kart Rally"]       # first played in 2019
    assert client.get("/api/wrapped/2020?platform=playstation").json()["platinums"]["count"] == 1
