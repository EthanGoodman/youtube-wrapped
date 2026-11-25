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


def test_hours_dated_by_snapshots_and_achievements(tmp_path):
    conn, res, _ = _built(tmp_path)
    assert res == {"snapshots": 2, "games": 4, "achievements": 4}
    by_game = {g: (n, t) for g, n, t in conn.execute(
        "SELECT video_id, COUNT(*), SUM(est_s) FROM watches GROUP BY video_id")}
    # every minute of lifetime playtime is somewhere: 1290 + 300 + 90 (the unplayed gift has none)
    assert {g: t // 60 for g, (_, t) in by_game.items()} == {"game:900001": 1290, "game:900002": 300, "game:900003": 90}
    days = dict(((g, d), (m // 60, how)) for g, d, m, how in conn.execute(
        "SELECT video_id, local_date, est_s, est_method FROM watches"))
    # Starfall: 1200 min before tracking spread over its 3 unlocks (2 on Mar 2, 1 on Jan 12), +90 tracked on Nov 21
    assert days[("game:900001", "2024-03-02")] == (800, "estimate")
    assert days[("game:900001", "2025-01-12")] == (400, "estimate")
    assert days[("game:900001", "2026-11-21")] == (90, "snapshot")
    # Harbor Kart: one unlock (May 1, 2023 local); Quiet Orchard: no achievements -> its last-played day
    assert days[("game:900002", "2023-05-01")] == (300, "estimate")
    assert days[("game:900003", "2021-08-10")] == (90, "estimate")


def test_time_of_day_from_achievements(tmp_path):
    conn, _, _ = _built(tmp_path)
    hour = conn.execute("SELECT local_hour FROM watches WHERE video_id = 'game:900002'").fetchone()[0]
    # first unlock 17:00 UTC = 1pm New York; the estimated 300 min are centred on it (capped at 6 h either side)
    assert hour == 10
    assert db.get_meta(conn, "tracked_since") == "2026-11-20"
    caps = db.get_meta(conn, "extra_capabilities").split(",")
    assert {"estimated_time", "achievements", "genres"} <= set(caps)


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
    assert top[0]["title"] == "Starfall Tactics" and round(top[0]["time_s"] / 3600, 1) == 21.5
    assert client.get("/api/games/achievements?platform=spotify").status_code in (404, 503)


def test_games_wrapped(tmp_path):
    from conftest import make_client
    from ytw.api import create_app
    from ytw.config import load_config
    conn, _, _ = _built(tmp_path)
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"steam": tmp_path / "steam.db"}, static_dir=tmp_path / "x"))
    w = client.get("/api/wrapped/2024?platform=steam").json()
    assert w["kind"] == "games" and w["platform"] == "steam" and not w["empty"] and w["estimated"]
    assert w["top_games"][0]["title"] == "Starfall Tactics" and w["achievements"]["unlocked"] == 2
    assert w["personality"]["name"] and "top_game_share" in w["metrics"]
    assert client.get("/api/wrapped/2019?platform=steam").json()["empty"] is True
