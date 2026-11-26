"""All games (combined): matching the same game across platforms, and the combined view adding up real numbers."""
import copy
import json
import shutil
from pathlib import Path
from zoneinfo import ZoneInfo

from ytw import db
from ytw.connectors.allgames import rebuild
from ytw.connectors.allgames.match import clean, group, numerals, similar

FIX = Path(__file__).parent / "fixtures"
NY = ZoneInfo("America/New_York")


def test_clean_strips_symbols_platform_tags_and_editions():
    assert clean("Grand Theft Auto V (PlayStation®5)") == "grand theft auto v"
    assert clean("Rocket League®") == "rocket league"
    assert clean("Terraria – PlayStation®4 Edition") == "terraria"
    assert clean("DARK SOULS™ III: Deluxe Edition") == "dark souls iii"


def test_same_game_across_stores():
    assert similar("Grand Theft Auto V", "Grand Theft Auto V (PlayStation®5)")
    assert similar("UNO", "UNO®") and similar("Apex Legends", "Apex Legends™")
    assert similar("Tom Clancy's Rainbow Six Siege", "Tom Clancys Rainbow Six Siege")


def test_sequels_stay_apart():
    assert numerals(clean("Call of Duty: Black Ops III")) == {"iii"}
    assert not similar("Call of Duty: Black Ops II", "Call of Duty®: Black Ops III")
    assert not similar("Call of Duty®: Black Ops 4", "Call of Duty®: Black Ops III")
    assert not similar("FIFA 17", "FIFA 18")
    assert not similar("STAR WARS™ Battlefront™", "STAR WARS™ Battlefront™ II")
    assert not similar("Monopoly Plus", "MONOPOLY FAMILY FUN PACK")


def test_overrides_join_and_split():
    names = ["Fall Guys", "Fall Guys: Ultimate Knockout", "Rust", "Rust Console Edition"]
    assert len(set(group(names))) == 4                                    # a rename isn't guessed
    g = group(names, same=[{clean("Fall Guys"), clean("Fall Guys: Ultimate Knockout")}])
    assert g[0] == g[1]
    # "Rust Console Edition" cleans to "rust console": different unless said otherwise; and "different" wins
    g = group(["Rust", "Rust"], different=[{"rust"}])
    assert g[0] == g[1]                                                   # identical names are one game regardless


def _cfg(tmp_path):
    from ytw.config import load_config
    cfg = load_config()
    cfg.raw = copy.deepcopy(cfg.raw)
    cfg.raw["general"]["data_dir"] = str(tmp_path)
    cfg.root = tmp_path                                                   # no game-matches.toml here: names only
    return cfg


def _platform(tmp_path, pid, built):
    conn, _, _ = built(tmp_path / pid)
    conn.close()
    shutil.copy(tmp_path / pid / f"{pid}.db", tmp_path / f"{pid}.db")


def test_combined_adds_up_each_platforms_real_numbers(tmp_path):
    from test_epic import _built as epic_built
    from test_playstation import _built as ps_built
    _platform(tmp_path, "epic", epic_built)
    _platform(tmp_path, "playstation", ps_built)
    n = rebuild(_cfg(tmp_path))
    conn = db.connect(tmp_path / "allgames.db")
    titles = {t: json.loads(e) for t, e in conn.execute("SELECT title, extra FROM items")}
    assert n == len(titles) and {"Sugar Rush", "Kart Rally", "Old Quest", "Ghost"} <= set(titles)
    # lifetime hours: every platform's minutes, dated and undated, nothing invented
    total = conn.execute("SELECT SUM(est_s) / 60 FROM (SELECT est_s FROM watches UNION ALL SELECT est_s FROM undated_watches)").fetchone()[0]
    assert total == sum(t["minutes"] for t in titles.values()) == 690 + 30 + 690
    assert titles["Kart Rally"]["platforms"] == {"playstation": 690} and titles["Kart Rally"]["plays"] == 40
    # achievements and trophies together, ids kept apart per platform
    assert conn.execute("SELECT COUNT(unlocked) FROM game_achievements").fetchone()[0] == 1 + 3
    assert {a.split(":")[0] for (a,) in conn.execute("SELECT api FROM game_achievements")} == {"epic", "playstation"}
    assert db.get_meta(conn, "sources") == "epic,playstation"


def test_same_game_on_two_platforms_is_one(tmp_path):
    """The same name on Epic and PlayStation: one game, hours added, the split kept."""
    from test_epic import _built as epic_built
    from test_playstation import _built as ps_built
    _platform(tmp_path, "epic", epic_built)
    _platform(tmp_path, "playstation", ps_built)
    c = db.connect(tmp_path / "epic.db")
    c.execute("UPDATE items SET title = 'Kart Rally®' WHERE item_id = 'game:Sugar'")
    c.commit()
    c.close()
    rebuild(_cfg(tmp_path))
    conn = db.connect(tmp_path / "allgames.db")
    rows = {t: json.loads(e) for t, e in conn.execute("SELECT title, extra FROM items")}
    kart = rows["Kart Rally"]
    assert kart["platforms"] == {"epic": 690, "playstation": 690} and kart["minutes"] == 1380
    assert "Kart Rally®" not in rows


def test_hub_leaves_it_off_the_shelf_and_out_of_yearly_totals(tmp_path):
    from conftest import make_client
    from ytw.api import create_app
    from test_playstation import _built as ps_built
    _platform(tmp_path, "playstation", ps_built)
    cfg = _cfg(tmp_path)
    rebuild(cfg)
    client = make_client(create_app(cfg, db_paths={"playstation": tmp_path / "playstation.db", "allgames": tmp_path / "allgames.db"},
                                    static_dir=tmp_path / "x"))
    hub = {p["id"]: p for p in client.get("/api/platforms").json()}
    assert hub["allgames"]["shelf"] is False and hub["allgames"]["has_data"]
    years = client.get("/api/hub/years").json()
    assert sum(y["est_s"] for y in years) == sum(y["by_platform"].get("playstation", 0) for y in years)   # not doubled
    assert client.get("/api/games/timeline?platform=allgames").status_code == 200
