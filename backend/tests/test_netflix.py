from conftest import make_client
from datetime import date
from zoneinfo import ZoneInfo

import pytest

from ytw import db
from ytw.api import create_app
from ytw.config import load_config
from ytw.connectors.netflix import ingest as nf
from ytw.connectors.netflix.parser import (FULL, SIMPLE, date_order, detect_format, parse_date, parse_history,
                                parse_hms, split_titles)

NY = ZoneInfo("America/New_York")

QUICK = '''Title,Date
"Cyberpunk: Edgerunners: Stronger","11/5/26"
"Cyberpunk: Edgerunners: Girl on Fire","11/4/26"
"Peaky Blinders: Season 2: Episode 1","9/11/26"
"Peaky Blinders: Season 1: Episode 6","9/10/26"
"Money Heist: Part 5: Pillow Talk","8/26/26"
"Don't Look Up","8/27/26"
"Spider-Man: Into the Spider-Verse","6/25/26"
"Broadchurch: Episode 3","6/16/26"
"HIS & HERS: Limited Series: Episode 6","2/17/26"
"My Little Pony: Friendship Is Magic: Season 1: Friendship Is Magic: Part 2","11/26/25"
"Stranger Things: Stranger Things 2: Chapter One: MADMAX","11/22/25"
"Stranger Things: Chapter Two: The Weirdo on Maple Street","11/20/25"
"Stranger Things: Chapter One: The Vanishing of Will Byers","11/20/25"
'''

FULL_CSV = '''Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country
Ethan,2026-03-02 03:10:00,00:44:10,,The Walking Dead: Season 4: Infected,,Samsung TV,00:44:10,00:44:10,US (United States)
Ethan,2026-03-02 02:20:00,00:02:19,Autoplayed: user action: None;,The Walking Dead: Season 4 (Trailer),TRAILER,Samsung TV,00:02:19,00:02:19,US (United States)
Ethan,2026-03-02 02:23:00,00:45:00,,The Walking Dead: Season 4: 30 Days Without an Accident,,Samsung TV,00:45:00,00:45:00,US (United States)
Ethan,2026-03-05 01:00:00,01:50:00,,Ex Machina,,iPhone,01:50:00,01:50:00,US (United States)
Mom,2026-03-03 20:00:00,00:30:00,,Bridgerton: Season 1: Diamond of the First Water,,Chrome PC,00:30:00,00:30:00,US (United States)
'''


# ------------------------------------------------------------------ parsing helpers

def test_detect_format():
    assert detect_format(["Title", "Date"]) == SIMPLE
    assert detect_format(["Profile Name", "Start Time", "Duration", "Title"]) == FULL
    with pytest.raises(ValueError):
        detect_format(["foo", "bar"])


def test_dates():
    assert date_order(["11/5/26", "9/11/26"]) == "mdy"
    assert date_order(["25/12/2025", "3/1/2026"]) == "dmy"
    assert date_order(["2026-01-05"]) == "iso"
    assert parse_date("11/5/26", "mdy") == date(2026, 11, 5)
    assert parse_date("25/12/2025", "dmy") == date(2025, 12, 25)
    assert parse_date("2026-01-05", "iso") == date(2026, 1, 5)


def test_hms():
    assert parse_hms("00:44:10") == 2650 and parse_hms("01:50:00") == 6600
    assert parse_hms("") is None and parse_hms("abc") is None


def test_title_splitting():
    titles = [line.split('","')[0].strip('"') for line in QUICK.splitlines()[1:]]
    s = split_titles(titles)
    assert s["Cyberpunk: Edgerunners: Stronger"] == ("Cyberpunk: Edgerunners", None, "Stronger", "episode")
    assert s["Peaky Blinders: Season 2: Episode 1"] == ("Peaky Blinders", "Season 2", "Episode 1", "episode")
    assert s["Money Heist: Part 5: Pillow Talk"] == ("Money Heist", "Part 5", "Pillow Talk", "episode")
    assert s["HIS & HERS: Limited Series: Episode 6"][:2] == ("HIS & HERS", "Limited Series")
    assert s["My Little Pony: Friendship Is Magic: Season 1: Friendship Is Magic: Part 2"] == \
        ("My Little Pony: Friendship Is Magic", "Season 1", "Friendship Is Magic: Part 2", "episode")
    assert s["Stranger Things: Stranger Things 2: Chapter One: MADMAX"] == \
        ("Stranger Things", "Stranger Things 2", "Chapter One: MADMAX", "episode")
    # "Chapter One" is an episode, not a season
    assert s["Stranger Things: Chapter One: The Vanishing of Will Byers"] == \
        ("Stranger Things", None, "Chapter One: The Vanishing of Will Byers", "episode")
    assert s["Broadchurch: Episode 3"] == ("Broadchurch", None, "Episode 3", "episode")
    assert s["Don't Look Up"] == (None, None, None, "movie")
    assert s["Spider-Man: Into the Spider-Verse"] == (None, None, None, "unknown")


# ------------------------------------------------------------------ formats

def test_quick_download():
    fmt, views = parse_history(QUICK, NY)
    assert fmt == SIMPLE and len(views) == 13
    assert views[0].title == "Stranger Things: Chapter One: The Vanishing of Will Byers"   # oldest first
    assert views[1].title == "Stranger Things: Chapter Two: The Weirdo on Maple Street"     # same day, file order kept
    assert views[-1].local_date == "2026-11-05"
    assert all(v.start_utc is None and v.duration_s is None for v in views)


def test_full_export_profile_and_supplemental():
    fmt, views = parse_history(FULL_CSV, NY, profile="Ethan")
    assert fmt == FULL and len(views) == 4                 # Mom's row filtered out
    trailer = next(v for v in views if v.supplemental)
    assert trailer.supplemental == "TRAILER" and trailer.duration_s == 139
    ex = next(v for v in views if v.title == "Ex Machina")
    assert ex.kind == "movie" and ex.duration_s == 6600 and ex.device == "iPhone"
    # 01:00 UTC on Mar 5 is 20:00 EST on Mar 4
    assert ex.local_date == "2026-03-04"


# ------------------------------------------------------------------ ingest + build

def _db(tmp_path, csv_text, name):
    folder = tmp_path / "netflix"
    folder.mkdir()
    (folder / name).write_text(csv_text, encoding="utf-8")
    conn = db.connect(tmp_path / "netflix.db")
    nf.init(conn)
    return conn, folder


def test_build_quick(tmp_path):
    conn, folder = _db(tmp_path, QUICK, "NetflixViewingHistory.csv")
    res = nf.ingest(conn, folder, NY)
    assert res["format"] == SIMPLE and res["rows"] == 13
    n = nf.build(conn, NY, {"fallback_episode_minutes": 40, "fallback_movie_minutes": 100})
    assert n == 13
    shows = dict(conn.execute("SELECT c.title, COUNT(*) FROM watches w JOIN creators c ON c.creator_id = w.channel_id "
                              "GROUP BY 1").fetchall())
    assert shows["Stranger Things"] == 3 and shows["Cyberpunk: Edgerunners"] == 2 and shows["Peaky Blinders"] == 2
    # movies (and the one-off "unknown") have no show
    assert conn.execute("SELECT COUNT(*) FROM watches WHERE channel_id IS NULL").fetchone()[0] == 2
    est = dict(conn.execute("SELECT kind, MIN(est_s) FROM watches GROUP BY kind").fetchall())
    assert est == {"episode": 2400, "movie": 6000}
    # one session per day for dates-only data
    assert conn.execute("SELECT COUNT(DISTINCT session_id) FROM watches").fetchone()[0] == \
        conn.execute("SELECT COUNT(DISTINCT local_date) FROM watches").fetchone()[0]
    assert db.get_meta(conn, "extra_capabilities") == "estimated_time"


def test_build_full(tmp_path):
    conn, folder = _db(tmp_path, FULL_CSV, "ViewingActivity.csv")
    with pytest.raises(ValueError, match="several profiles"):
        nf.ingest(conn, folder, NY)
    nf.ingest(conn, folder, NY, profile="Ethan")
    assert nf.build(conn, NY, {}) == 3                    # trailer skipped
    rows = conn.execute("SELECT est_s, est_method, session_id, local_hour FROM watches ORDER BY start_epoch").fetchall()
    assert [r[0] for r in rows] == [2700, 2650, 6600] and {r[1] for r in rows} == {"exact"}
    # 02:23 + 45 min ends 03:08, next starts 03:10 -> same session; Ex Machina days later -> new one
    assert [r[2] for r in rows] == [1, 1, 2]
    assert rows[0][3] == 21                                # 02:23 UTC = 21:23 EST
    assert db.get_meta(conn, "extra_capabilities") == "time_of_day"


def test_api_on_netflix(tmp_path):
    conn, folder = _db(tmp_path, QUICK, "NetflixViewingHistory.csv")
    nf.ingest(conn, folder, NY)
    nf.build(conn, NY, {})
    db.init_db(conn)
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"netflix": tmp_path / "netflix.db"},
                                   static_dir=tmp_path / "nodist"))
    m = client.get("/api/meta?platform=netflix").json()
    assert m["platform"]["vocab"]["creators"] == "shows"
    assert "estimated_time" in m["platform"]["capabilities"] and "time_of_day" not in m["platform"]["capabilities"]
    o = client.get("/api/overview?platform=netflix&range=all").json()
    assert o["videos"] == 13 and o["unique_channels"] == 7
    top = client.get("/api/top/channels?platform=netflix&range=all").json()["items"]
    assert top[0]["title"] == "Stranger Things" and top[0]["count"] == 3
    assert client.get("/api/ads?platform=netflix").status_code == 404
    assert client.get("/api/wrapped/2026?platform=netflix").status_code == 200


# ------------------------------------------------------------------ TMDB enrichment (fake TMDB)

from ytw.connectors.netflix import tmdb  # noqa: E402

TV = {"Cyberpunk: Edgerunners": 105248, "Peaky Blinders": 60574, "Money Heist": 71446, "Broadchurch": 1427,
      "HIS & HERS": 9001, "My Little Pony: Friendship Is Magic": 33765, "Stranger Things": 66732}
MOVIES = {"Don't Look Up": 646380, "Spider-Man: Into the Spider-Verse": 324857}


class FakeTmdb:
    def __init__(self):
        self.calls = []

    def __call__(self, path, params):
        self.calls.append(path)
        if path.startswith("search/"):
            media, q = path.split("/")[1], params["query"]
            names = TV if media == "tv" else MOVIES
            field = "name" if media == "tv" else "title"
            hits = [{"id": i, field: n} for n, i in names.items() if tmdb.norm(q) in tmdb.norm(n)]
            # a decoy that is NOT an exact match comes first, to check exact matches are preferred
            return {"results": [{"id": 1, field: q + " (Decoy)"}] + hits}
        if "/season/" in path:  # tv/<id>/season/<n>: Peaky Blinders has real per-episode runtimes
            tid, n = int(path.split("/")[1]), int(path.split("/")[3])
            if tid != 60574:
                return {"episodes": []}
            return {"episodes": [{"episode_number": e, "name": "Episode %d" % e, "runtime": 58 + e + n * 10,
                                  "still_path": "/s%d%d.jpg" % (n, e)} for e in range(1, 7)]}
        media, tid = path.split("/")
        tid = int(tid)
        if media == "tv":
            name = next(n for n, i in TV.items() if i == tid) if tid in TV.values() else "Decoy"
            return {"id": tid, "name": name, "first_air_date": "2020-01-01", "episode_run_time": [50, 60],
                    "genres": [{"name": "Drama"}, {"name": "Crime"}], "poster_path": "/p.jpg",
                    "number_of_seasons": 2, "number_of_episodes": 16, "origin_country": ["GB"]}
        name = next(n for n, i in MOVIES.items() if i == tid) if tid in MOVIES.values() else "Decoy"
        return {"id": tid, "title": name, "release_date": "2021-12-24", "runtime": 138,
                "genres": [{"name": "Comedy"}], "poster_path": "/m.jpg"}


def _quick_db(tmp_path):
    conn, folder = _db(tmp_path, QUICK, "NetflixViewingHistory.csv")
    nf.ingest(conn, folder, NY)
    return conn


def test_enrich_matches_and_settles_one_offs(tmp_path):
    conn = _quick_db(tmp_path)
    fake = FakeTmdb()
    r = tmdb.enrich(conn, fake)
    assert r["one_offs"] == 1 and r["shows_found"] == r["shows"] and r["movies_found"] == 2
    # the exact match wins over the decoy listed first
    assert conn.execute("SELECT tmdb_id FROM tmdb_titles WHERE query = 'tv|money heist'").fetchone()[0] == 71446
    # "Spider-Man: Into the Spider-Verse" is an exact movie title -> movie
    assert conn.execute("SELECT kind FROM title_resolution WHERE title LIKE 'Spider-Man%'").fetchone()[0] == "movie"
    nf.build(conn, NY, {})
    w = dict(conn.execute("SELECT video_id, est_s FROM watches").fetchall())
    assert w["mv:don-t-look-up"] == 138 * 60                        # real runtime replaces the 110-min guess
    assert w["ep:cyberpunk-edgerunners||stronger"] == 55 * 60         # no episode data: show's typical length (50, 60)
    assert conn.execute("SELECT est_method FROM watches WHERE video_id = 'mv:don-t-look-up'").fetchone()[0] == "runtime"
    show = conn.execute("SELECT avatar_url, item_count, country FROM creators WHERE title = 'Peaky Blinders'").fetchone()
    assert show[0] == "https://image.tmdb.org/t/p/w185/p.jpg" and show[1] == 16 and show[2] == "GB"
    assert {g for (g,) in conn.execute("SELECT DISTINCT genre FROM item_genres")} == {"Drama", "Crime", "Comedy"}
    # everything cached: a second run makes no requests
    fake2 = FakeTmdb()
    assert tmdb.enrich(conn, fake2)["requests"] == 0 and fake2.calls == []


def test_one_off_becomes_episode(tmp_path):
    conn, folder = _db(tmp_path, 'Title,Date\n"Peaky Blinders: Sick Puppy","1/2/26"\n', "NetflixViewingHistory.csv")
    nf.ingest(conn, folder, NY)
    tmdb.enrich(conn, FakeTmdb())
    nf.build(conn, NY, {})
    row = conn.execute("SELECT w.kind, c.title FROM watches w JOIN creators c ON c.creator_id = w.channel_id").fetchone()
    assert tuple(row) == ("episode", "Peaky Blinders")


def test_overrides(tmp_path):
    conn = _quick_db(tmp_path)
    tmdb.enrich(conn, FakeTmdb(), {"shows": {"Money Heist": 60574}, "movies": {"Don't Look Up": 0}})
    assert conn.execute("SELECT tmdb_id FROM tmdb_titles WHERE query = 'tv|money heist'").fetchone()[0] == 60574
    assert conn.execute("SELECT media_type FROM tmdb_titles WHERE query = 'movie|don t look up'").fetchone()[0] == "none"


def test_load_overrides(tmp_path):
    f = tmp_path / "overrides.toml"
    f.write_text('[shows]\n"Money Heist" = 71446\n[movies]\n"Bugonia" = 0\n')
    assert tmdb.load_overrides(f) == {"shows": {"Money Heist": 71446}, "movies": {"Bugonia": 0}}
    assert tmdb.load_overrides(tmp_path / "missing.toml") == {"shows": {}, "movies": {}}


def test_episode_runtimes_and_stills(tmp_path):
    conn = _quick_db(tmp_path)
    tmdb.enrich(conn, FakeTmdb())
    nf.build(conn, NY, {})
    # Peaky Blinders S1E6 -> 58 + 6 + 10 = 74 min, S2E1 -> 58 + 1 + 20 = 79 min (matched by season + number)
    w = dict(conn.execute("SELECT video_id, est_s FROM watches WHERE video_id LIKE 'ep:peaky%'").fetchall())
    assert w == {"ep:peaky-blinders|season-1|episode-6": 74 * 60, "ep:peaky-blinders|season-2|episode-1": 79 * 60}
    thumb = conn.execute("SELECT thumb_small FROM items WHERE item_id = 'ep:peaky-blinders|season-1|episode-6'").fetchone()[0]
    assert thumb == "https://image.tmdb.org/t/p/w300/s16.jpg"
    # the show's typical length becomes the real average of its episodes
    avg = conn.execute("SELECT runtime_min FROM tmdb_titles WHERE query = 'tv|peaky blinders'").fetchone()[0]
    assert avg == round(sum(58 + e + n * 10 for n in (1, 2) for e in range(1, 7)) / 12)


def test_two_accounts_merge(tmp_path):
    # a second account's quick download: one viewing in both files (same title, same day) counts once
    other = 'Title,Date\n"Stranger Things: Chapter Three: Holly, Jolly","11/21/25"\n"Don\'t Look Up","8/27/26"\n"Heroes: Season 1: Genesis","1/2/17"\n'
    conn, folder = _db(tmp_path, QUICK, "NetflixViewingHistory.csv")
    (folder / "NetflixViewingHistory (1).csv").write_text(other, encoding="utf-8")
    res = nf.ingest(conn, folder, NY)
    assert res["files"] == 2 and res["rows"] == 15 and res["duplicates"] == 1
    nf.build(conn, NY, {})
    rows = conn.execute("SELECT local_date, video_id FROM watches ORDER BY start_epoch").fetchall()
    assert [r[0] for r in rows] == sorted(r[0] for r in rows)          # one timeline, in date order
    assert rows[0][1].startswith("ep:heroes")
    # the other account's Stranger Things episode joins the same show
    assert conn.execute("SELECT COUNT(*) FROM watches WHERE channel_id = 'show:stranger-things'").fetchone()[0] == 4


def test_arc_names_join_their_show(tmp_path):
    # "Peaky Blinders: Small Heath Arc" has no TMDB match of its own, "Peaky Blinders" does
    text = ('Title,Date\n"Peaky Blinders: Small Heath Arc: Episode 2","3/2/26"\n'
            '"Peaky Blinders: Small Heath Arc: Episode 1","3/1/26"\n"Peaky Blinders: Season 1: Episode 6","2/1/26"\n')
    conn, folder = _db(tmp_path, text, "NetflixViewingHistory.csv")
    nf.ingest(conn, folder, NY)
    assert tmdb.enrich(conn, FakeTmdb())["merged"] == 1
    nf.build(conn, NY, {})
    assert {r[0] for r in conn.execute("SELECT title FROM creators")} == {"Peaky Blinders"}
    assert conn.execute("SELECT COUNT(*) FROM items WHERE json_extract(extra, '$.season') = 'Small Heath Arc'").fetchone()[0] == 2


def test_nameless_episodes(tmp_path):
    from ytw.stats import shows
    from ytw.stats.common import Filters, resolve_range
    text = 'Title,Date\n": Episode 5","3/20/26"\n": Episode 5","3/1/26"\n"Peaky Blinders: Season 1: Episode 6","2/1/26"\n'
    conn, folder = _db(tmp_path, text, "NetflixViewingHistory.csv")
    nf.ingest(conn, folder, NY)
    tmdb.enrich(conn, FakeTmdb())
    nf.build(conn, NY, {})
    assert conn.execute("SELECT COUNT(*) FROM watches WHERE channel_id = 'show:unknown-show'").fetchone()[0] == 2
    r, f = resolve_range(conn, "all"), Filters()
    assert [s["title"] for s in shows.progress(conn, r, f)["shows"]] == ["Peaky Blinders"]
    assert shows.rewatches(conn, r, f)["items"] == []   # two different shows' "Episode 5", not a rewatch
