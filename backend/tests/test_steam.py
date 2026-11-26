"""Steam (#59): dating lifetime playtime, achievements, and fetching through a fake Steam (no network)."""
import json
import shutil
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from ytw import db
from ytw.connectors.steam import api
from ytw.connectors.steam import ingest as st

FIX = Path(__file__).parent / "fixtures" / "steam"
NY = ZoneInfo("America/New_York")


def _built(tmp_path):
    folder = tmp_path / "steam"
    shutil.copytree(FIX, folder)
    conn = db.connect(tmp_path / "steam.db")
    res = st.ingest(conn, folder)
    n = st.build(conn, NY)
    return conn, res, n


def test_only_tracked_days_get_dated_hours(tmp_path):
    conn, res, _ = _built(tmp_path)
    assert res == {"snapshots": 2, "games": 4, "achievements": 4}
    # the one real day of play: Starfall grew 90 min between the Nov 20 and Nov 21 snapshots
    assert [tuple(r) for r in conn.execute("SELECT video_id, local_date, est_s / 60, est_method FROM watches")] == \
        [("game:900001", "2026-11-21", 90, "snapshot")]
    # everything from before tracking has no date: lifetime totals only (the unplayed gift has none)
    undated = {g: s // 60 for g, s in conn.execute("SELECT video_id, est_s FROM undated_watches")}
    assert undated == {"game:900001": 1200, "game:900002": 300, "game:900003": 90}


def test_activity_years_and_capabilities(tmp_path):
    conn, _, _ = _built(tmp_path)
    assert db.get_meta(conn, "tracked_since") == "2026-11-20"
    # unlocks in 2023 (Harbor Kart), 2024 and 2025 (Starfall), Quiet Orchard last played in 2021, the tracked day in 2026
    assert db.get_meta(conn, "activity_years") == "2021,2023,2024,2025,2026"
    caps = set(db.get_meta(conn, "extra_capabilities").split(","))
    assert {"achievements", "genres"} <= caps and not caps & {"estimated_time", "time_of_day"}   # nothing estimated, no clock


def test_games_items_art_and_genres(tmp_path):
    conn, _, _ = _built(tmp_path)
    row = conn.execute("SELECT title, thumb_small, url, extra FROM items WHERE item_id = 'game:900001'").fetchone()
    assert row[0] == "Starfall Tactics" and row[1].endswith("/900001/library_600x900.jpg") and row[2].endswith("/app/900001/")
    assert json.loads(row[3])["unlocked"] == 3 and json.loads(row[3])["achievements"] == 4
    assert {g for (g,) in conn.execute("SELECT genre FROM item_genres WHERE item_id = 'game:900001'")} == {"Strategy", "RPG"}
    from ytw.images import check_url
    check_url(row[1])                                            # the image relay allows Steam's art host


class FakeSteam:
    def __init__(self, minutes=600):
        self.calls, self.minutes = [], minutes

    def __call__(self, url, params):
        self.calls.append(url.rsplit("/", 3)[-3] if "api.steampowered" in url else "store")
        if "ResolveVanityURL" in url:
            return {"response": {"success": 1, "steamid": "76561198000000001"}} if params["vanityurl"] == "ethan" else {"response": {"success": 42}}
        if "GetOwnedGames" in url:
            return {"response": {"game_count": 2, "games": [
                {"appid": 10, "name": "Alpha", "playtime_forever": self.minutes, "rtime_last_played": 1700000000},
                {"appid": 20, "name": "Never Played", "playtime_forever": 0}]}}
        if "GetPlayerAchievements" in url:
            return {"playerstats": {"achievements": [{"apiname": "A1", "achieved": 1, "unlocktime": 1690000000, "name": "One"},
                                                     {"apiname": "A2", "achieved": 0, "unlocktime": 0, "name": "Two"}]}}
        if "GetGlobalAchievementPercentages" in url:
            return {"achievementpercentages": {"achievements": [{"name": "A1", "percent": "55.5"}, {"name": "A2", "percent": 2}]}}
        return {"10": {"success": True, "data": {"genres": [{"id": "1", "description": "Action"}]}}}


def test_resolve_id():
    fake = FakeSteam()
    assert api.resolve_id(fake, "https://steamcommunity.com/id/ethan/") == "76561198000000001"
    assert api.resolve_id(fake, "https://steamcommunity.com/profiles/76561198000000002") == "76561198000000002"
    assert api.resolve_id(fake, "76561198000000003") == "76561198000000003"
    with pytest.raises(api.SteamError):
        api.resolve_id(fake, "nobody-here")


def test_fetch_saves_snapshot_and_only_refreshes_played_games(tmp_path):
    fake = FakeSteam()
    r = api.fetch_all(tmp_path, fake, "76561198000000001", date(2026, 11, 25))
    assert (r["games"], r["played"], r["refreshed"]) == (2, 1, 1)
    saved = json.loads((tmp_path / "games" / "10.json").read_text())
    assert saved["achievements"][0]["unlocked"] == 1690000000 and saved["achievements"][1]["unlocked"] is None
    assert saved["rarity"] == {"A1": 55.5, "A2": 2.0} and saved["genres"] == ["Action"]
    assert not (tmp_path / "games" / "20.json").exists()          # never played: nothing to look up
    n = len(fake.calls)
    api.fetch_all(tmp_path, fake, "76561198000000001", date(2026, 11, 26))
    assert len(fake.calls) == n + 1                               # only the library: Alpha wasn't played since
    fake.minutes = 660
    api.fetch_all(tmp_path, fake, "76561198000000001", date(2026, 11, 27))
    assert "store" not in fake.calls[n + 1:]                      # played again: achievements refreshed, genres kept
    assert sorted(p.name for p in (tmp_path / "snapshots").iterdir()) == ["2026-11-25.json", "2026-11-26.json", "2026-11-27.json"]


def test_private_profile_message():
    def private(url, params):
        return {"response": {}}
    with pytest.raises(api.SteamError, match="Game details to Public"):
        api.owned_games(private, "76561198000000001")


def test_achievement_stats_and_api(tmp_path):
    from conftest import make_client
    from ytw.api import create_app
    from ytw.config import load_config
    conn, _, _ = _built(tmp_path)
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"steam": tmp_path / "steam.db"}, static_dir=tmp_path / "x"))
    q = "platform=steam&range=all"
    meta = client.get("/api/meta?platform=steam").json()["platform"]
    assert meta["family"] == "games" and "achievements" in meta["capabilities"]
    a = client.get(f"/api/games/achievements?{q}").json()
    assert a["unlocked"] == 4 and a["total"] == 5
    assert a["rarest"][0]["name"] == "First Lap" and a["rarest"][0]["rarity"] == 3.1
    assert a["best_day"]["count"] == 2 and a["best_day"]["game"]["title"] == "Starfall Tactics"
    assert [p["game"]["title"] for p in a["perfect"]] == ["Harbor Kart"]          # 1 of 1 unlocked
    g = client.get(f"/api/games/game/game:900001?{q}").json()
    assert (g["unlocked"], g["total"]) == (3, 4) and g["achievements"][-1]["name"] == "No Mercy"   # locked last
    top = client.get(f"/api/top/channels?{q}&metric=time").json()["items"]
    assert top[0]["title"] == "Starfall Tactics" and round(top[0]["time_s"] / 3600, 1) == 21.5   # lifetime, undated too
    assert client.get("/api/games/achievements?platform=spotify").status_code in (404, 503)


def _client(tmp_path):
    from conftest import make_client
    from ytw.api import create_app
    from ytw.config import load_config          # config.toml's timezone is America/New_York, like the fixtures
    conn, _, _ = _built(tmp_path)
    conn.close()
    return make_client(create_app(load_config(), db_paths={"steam": tmp_path / "steam.db"}, static_dir=tmp_path / "x"))


def test_activity_from_real_unlocks(tmp_path):
    client = _client(tmp_path)
    a = client.get("/api/games/activity?platform=steam&range=all").json()
    # 4 unlocks on 3 days in 2 games; all time reaches back to the first real day of play (a last-played day in 2021)
    assert (a["unlocks"], a["active_days"], a["games"]) == (4, 3, 2) and a["range"]["start"] == "2021-08-10"
    assert a["days"] == [{"date": "2023-05-01", "count": 1}, {"date": "2024-03-02", "count": 2}, {"date": "2025-01-12", "count": 1}]
    assert a["hours"][13] == 1 and a["hours"][18] == 1 and sum(a["weekdays"]) == 4
    assert a["tracked"] == {"est_s": 90 * 60, "days": 1}
    assert client.get("/api/games/activity?platform=steam&range=2024").json()["unlocks"] == 2


def test_timeline_years_and_records(tmp_path):
    client = _client(tmp_path)
    t = {x["game"]["title"]: x for x in client.get("/api/games/timeline?platform=steam").json()}
    assert (t["Starfall Tactics"]["first_unlock"], t["Starfall Tactics"]["last_unlock"], t["Starfall Tactics"]["unlocks"]) == \
        ("2024-03-02", "2025-01-12", 3)
    assert t["Quiet Orchard"]["unlocks"] == 0 and t["Quiet Orchard"]["minutes"] == 90       # lifetime only, still listed
    assert set(t["Starfall Tactics"]["genres"]) == {"Strategy", "RPG"}                      # for the All games filter
    assert "Unplayed Gift" not in t
    y = {x["year"]: x for x in client.get("/api/games/years?platform=steam").json()}
    assert sorted(y) == [2023, 2024, 2025, 2026]
    assert y[2024]["unlocks"] == 2 and y[2024]["top"]["game"]["title"] == "Starfall Tactics" and y[2024]["tracked_s"] == 0
    assert y[2026]["unlocks"] == 0 and y[2026]["tracked_s"] == 90 * 60
    r = client.get("/api/games/records?platform=steam&range=all").json()
    assert r["rarest"][0]["name"] == "First Lap" and r["best_day"]["count"] == 2
    assert r["streak"]["days"] == 1 and r["latest_night"] is None and r["fastest_perfect"] is None   # Harbor Kart has 1: not 5+
    assert r["tracked_best_day"]["date"] == "2026-11-21" and r["tracked_best_day"]["est_s"] == 90 * 60


def test_games_wrapped_from_unlocks(tmp_path):
    client = _client(tmp_path)
    w = client.get("/api/wrapped/2024?platform=steam").json()
    assert w["kind"] == "games" and w["platform"] == "steam" and not w["empty"]
    assert (w["unlocks"], w["active_days"], w["games"]) == (2, 1, 1)
    assert w["top_games"][0]["game"]["title"] == "Starfall Tactics" and w["new_games"][0]["title"] == "Starfall Tactics"
    assert w["tracked"] is None and w["busiest_hour"] == 15                  # no hours invented for 2024
    assert w["personality"]["name"] and w["metrics"]["top_game_share"] == 1.0
    w26 = client.get("/api/wrapped/2026?platform=steam").json()
    assert not w26["empty"] and w26["unlocks"] == 0 and w26["tracked"]["est_s"] == 90 * 60   # only tracked play
    assert client.get("/api/wrapped/2019?platform=steam").json()["empty"] is True


def test_hidden_achievements_are_not_a_bad_key(tmp_path):
    """A profile with private game details: the library still saves, and those games are asked again next time."""
    fake = FakeSteam()

    def private(url, params):
        if "GetPlayerAchievements" in url:
            return {"_private": True}
        return fake(url, params)
    r = api.fetch_all(tmp_path, private, "76561198000000001", date(2026, 11, 25))
    assert r["achievements_hidden"] == 1 and r["refreshed"] == 1
    assert json.loads((tmp_path / "games" / "10.json").read_text())["minutes"] is None
    r2 = api.fetch_all(tmp_path, fake, "76561198000000001", date(2026, 11, 26))     # made public: asked again
    assert r2["refreshed"] == 1 and r2["achievements_hidden"] == 0
    assert json.loads((tmp_path / "games" / "10.json").read_text())["achievements"]
