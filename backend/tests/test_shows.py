"""Netflix-only stats: show progress, binges, big episode days, rewatches, episodes vs movies."""
from fastapi.testclient import TestClient

from test_netflix import NY, FakeTmdb, _db
from ytw import db
from ytw.api import create_app
from ytw.config import load_config
from ytw.netflix import ingest as nf
from ytw.netflix import tmdb
from ytw.stats import shows
from ytw.stats.common import Filters, resolve_range

# FakeTmdb gives Peaky Blinders 2 seasons x 6 episodes; Money Heist has no episode list (16 in total)
QUICK = '''Title,Date
"Peaky Blinders: Season 2: Episode 1","3/10/26"
"Don't Look Up","3/5/26"
"Peaky Blinders: Season 1: Episode 6","3/2/26"
"Peaky Blinders: Season 1: Episode 5","3/2/26"
"Peaky Blinders: Season 1: Episode 4","3/2/26"
"Peaky Blinders: Season 1: Episode 3","3/2/26"
"Peaky Blinders: Season 1: Episode 2","3/1/26"
"Peaky Blinders: Season 1: Episode 1","3/1/26"
"Money Heist: Part 1: Episode 1","1/1/26"
'''

FULL = '''Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country
Ethan,2026-03-01 02:00:00,01:50:00,,Ex Machina,,TV,01:50:00,01:50:00,US (United States)
Ethan,2026-03-02 02:00:00,00:20:00,,Ex Machina,,TV,00:20:00,00:20:00,US (United States)
Ethan,2026-03-20 02:00:00,01:50:00,,Ex Machina,,TV,01:50:00,01:50:00,US (United States)
'''


def _built(tmp_path, text=QUICK, name="NetflixViewingHistory.csv", enrich=True):
    conn, folder = _db(tmp_path, text, name)
    nf.ingest(conn, folder, NY)
    if enrich:
        tmdb.enrich(conn, FakeTmdb())
    nf.build(conn, NY, {})
    return conn, resolve_range(conn, "all"), Filters()


def test_progress_and_status(tmp_path):
    conn, r, f = _built(tmp_path)
    p = shows.progress(conn, r, f)
    by = {s["title"]: s for s in p["shows"]}
    peaky = by["Peaky Blinders"]
    assert (peaky["watched"], peaky["total"], peaky["seasons_finished"], peaky["seasons_total"]) == (7, 12, 1, 2)
    assert peaky["status"] == "watching"                     # watched on the last day of the data
    heist = by["Money Heist"]
    assert (heist["watched"], heist["total"], heist["status"]) == (1, 16, "dropped")  # count-only fallback
    assert p["summary"] == {"finished": 0, "watching": 1, "dropped": 1}


def test_finished_show(tmp_path):
    rows = "".join(f'"Peaky Blinders: Season {s}: Episode {e}","3/{s}/26"\n' for s in (1, 2) for e in range(1, 7))
    conn, r, f = _built(tmp_path, "Title,Date\n" + rows)
    peaky = shows.progress(conn, r, f)["shows"][0]
    assert peaky["status"] == "finished" and peaky["pct"] == 1.0


def test_binges_and_episode_days(tmp_path):
    conn, r, f = _built(tmp_path)
    b = shows.binges(conn, r, f)
    assert [(x["title"], x["season"], x["episodes"], x["days"]) for x in b] == [("Peaky Blinders", 1, 6, 2)]
    d = shows.episode_days(conn, r, f)
    assert (d[0]["date"], d[0]["title"], d[0]["episodes"]) == ("2026-03-02", "Peaky Blinders", 4)
    # a season finished before the period doesn't count in it
    assert shows.binges(conn, resolve_range(conn, "custom", "2026-03-05", "2026-03-10"), f) == []


def test_no_tmdb_falls_back(tmp_path):
    conn, r, f = _built(tmp_path, enrich=False)
    assert shows.binges(conn, r, f) == []
    peaky = next(s for s in shows.progress(conn, r, f)["shows"] if s["title"] == "Peaky Blinders")
    assert peaky["watched"] == 7 and peaky["total"] is None and peaky["pct"] is None


def test_split_and_top_movies(tmp_path):
    conn, r, f = _built(tmp_path)
    s = shows.split(conn, r, f)
    assert (s["episode"]["count"], s["episode"]["titles"], s["movie"]["count"], s["movie"]["titles"]) == (8, 2, 1, 1)
    assert [m["title"] for m in shows.top_movies(conn, r, f)] == ["Don't Look Up"]


def test_rewatches(tmp_path):
    # quick download: every title appears once, so rewatches can't be seen
    conn, r, f = _built(tmp_path)
    assert shows.rewatches(conn, r, f) == {"detectable": False, "items": []}
    # full export: the next-day viewing is finishing it; 18 days later is a rewatch
    (tmp_path / "full").mkdir()
    conn2, r2, f2 = _built(tmp_path / "full", FULL, "ViewingActivity.csv", enrich=False)
    rw = shows.rewatches(conn2, r2, f2)
    assert rw["detectable"] and [(i["title"], i["times"]) for i in rw["items"]] == [("Ex Machina", 2)]


def test_api(tmp_path):
    conn, _, _ = _built(tmp_path)
    db.init_db(conn)
    conn.close()
    client = TestClient(create_app(load_config(), db_paths={"netflix": tmp_path / "netflix.db"},
                                   static_dir=tmp_path / "nodist"))
    assert "series" in client.get("/api/meta?platform=netflix").json()["platform"]["capabilities"]
    for kind in ("progress", "binges", "days", "rewatches", "split"):
        assert client.get(f"/api/shows/{kind}?platform=netflix&range=all").status_code == 200, kind
    assert client.get("/api/shows/nope?platform=netflix").status_code == 404
    top = client.get("/api/top/movies?platform=netflix&range=all").json()["items"]
    assert top[0]["title"] == "Don't Look Up"


def test_netflix_wrapped(tmp_path):
    from pathlib import Path
    from ytw.wrapped import NETFLIX_METRICS, load_personalities, netflix_wrapped
    conn, _, f = _built(tmp_path)
    cfg = load_personalities(Path(__file__).parents[2] / "personalities-netflix.toml", NETFLIX_METRICS)
    d = netflix_wrapped(conn, 2026, f, cfg)
    assert not d["empty"] and d["top_channels"][0]["title"] == "Peaky Blinders"
    assert d["binge"]["season"] == 1 and d["kind_split"]["movie"]["count"] == 1
    assert d["progress"]["summary"] == {"finished": 0, "watching": 1, "dropped": 1}
    # dates-only data: every view sits at midnight, so time-of-day personalities must not win
    assert d["metrics"]["night_share"] == 1.0 and d["personality"]["metric"] != "night_share"
    assert d["clock"] == [] and d["peak_hour"] is None
    assert netflix_wrapped(conn, 2019, f, cfg)["empty"]


def test_netflix_wrapped_api(tmp_path):
    conn, _, _ = _built(tmp_path)
    db.init_db(conn)
    conn.close()
    client = TestClient(create_app(load_config(), db_paths={"netflix": tmp_path / "netflix.db"},
                                   static_dir=tmp_path / "nodist"))
    d = client.get("/api/wrapped/2026?platform=netflix").json()
    assert d["platform"] == "netflix" and d["personality"]["name"]


def test_home(tmp_path):
    conn, r, f = _built(tmp_path)
    h = shows.home(conn, r, f)
    assert h["billboard"]["title"] == "Peaky Blinders" and h["billboard"]["kind"] == "show"
    assert [i["title"] for i in h["top10"]] == ["Peaky Blinders", "Money Heist"]
    assert h["top10"][0]["count"] == 7 and h["top10"][0]["rank"] == 1
    assert [i["title"] for i in h["movies"]] == ["Don't Look Up"]
    assert h["new"] == []                                                     # whole history: everything is "new"
    march = shows.home(conn, resolve_range(conn, "custom", "2026-03-01", "2026-03-31"), f)
    assert [i["title"] for i in march["new"]] == ["Peaky Blinders"]


def test_show_detail(tmp_path):
    conn, _, f = _built(tmp_path)
    d = shows.show_detail(conn, "show:peaky-blinders", f)
    assert d["show"]["title"] == "Peaky Blinders" and d["episodes_watched"] == 7
    s1, s2 = d["seasons"]
    assert (s1["season"], s1["watched"], s1["aired"]) == (1, 6, 6) and (s2["watched"], s2["aired"]) == (1, 6)
    assert s1["episodes"][0]["watched"] and s1["episodes"][0]["first"] == "2026-03-01"
    assert not s2["episodes"][1]["watched"]
    assert d["pace"]["best_day"] == {"date": "2026-03-02", "episodes": 4}
    assert d["pace"]["fastest_season"]["season"] == 1 and d["pace"]["fastest_season"]["days"] == 2
    assert [x["title"] for x in d["similar"]] == ["Money Heist"]          # FakeTmdb gives every show Drama + Crime
    assert shows.show_detail(conn, "show:nope", f) is None
