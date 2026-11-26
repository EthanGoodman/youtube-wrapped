"""Rankings must not depend on row order or the query plan (#85): the same data inserted in a different order,
with fresh ANALYZE statistics, gives byte-identical API responses on every platform."""
import json
import random
import sqlite3
from pathlib import Path

from conftest import make_client

from test_crunchyroll import _cr_db
from test_shows import _built
from test_stats import populate
from ytw import db
from ytw.api import create_app
from ytw.config import load_config


def _shuffled_copy(src: Path, dst: Path, seed: int) -> None:
    """Copy a database, reinsert every table's rows in a random order, then ANALYZE (as a build does)."""
    s = sqlite3.connect(src)
    d = sqlite3.connect(dst)
    s.backup(d)
    s.close()
    rnd = random.Random(seed)
    tables = [r[0] for r in d.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
    for t in tables:
        rows = d.execute(f'SELECT * FROM "{t}"').fetchall()  # nosec B608 - table names come from sqlite_master
        if not rows:
            continue
        rnd.shuffle(rows)
        d.execute(f'DELETE FROM "{t}"')  # nosec B608
        d.executemany(f'INSERT INTO "{t}" VALUES ({",".join("?" * len(rows[0]))})', rows)  # nosec B608
    d.execute("ANALYZE")
    d.commit()
    d.close()


def _paths(client, platform: str) -> list[str]:
    q = f"platform={platform}"
    years = client.get(f"/api/meta?{q}").json()["years"]
    out = []
    for r in ["all", *map(str, years)]:
        rq = f"{q}&range={r}"
        out += [f"/api/overview?{rq}", f"/api/recent?{rq}&limit=100", f"/api/records?{rq}", f"/api/ads?{rq}"]
        for m in ("count", "time"):
            mq = f"{rq}&metric={m}&limit=200"
            out += [f"/api/top/{k}?{mq}" for k in ("channels", "videos", "genres", "categories", "tags", "movies", "albums")]
            out += [f"/api/evolution/{k}?{mq}" for k in ("top_per_year", "bar_race", "discoveries", "loyalty", "fell_off", "mix")]
            out += [f"/api/shows/{k}?{mq}" for k in ("home", "progress", "binges", "days", "rewatches", "split", "anime", "anime_page")]
        out += [f"/api/patterns/{k}?{rq}" for k in ("clock", "heatmap", "weekday_weekend", "calendar", "monthly")]
        out += [f"/api/music/records?{rq}", f"/api/games/achievements?{rq}"]
    out += [f"/api/wrapped/{y}?{q}" for y in years] + [f"/api/year/{y}?{q}" for y in years]
    for c in client.get(f"/api/top/channels?{q}&range=all&limit=10").json()["items"]:
        out += [f"/api/channel/{c['key']}?{q}&range=all", f"/api/show/{c['key']}?{q}&range=all"]
    out += [f"/api/games/game/{c['key']}?{q}" for c in client.get(f"/api/top/channels?{q}&range=all&limit=5").json()["items"]]
    for a in client.get(f"/api/top/albums?{q}&range=all&limit=5").json().get("items", []):
        out.append(f"/api/album/{a['key']}?{q}&range=all")
    return out


def _same_everywhere(tmp_path: Path, platform: str, built: Path) -> None:
    clients = {}
    for seed in (1, 2):
        path = tmp_path / f"{platform}-{seed}.db"
        _shuffled_copy(built, path, seed)
        # the other platforms point at files that don't exist (YouTube's database has its own argument)
        others = {p: tmp_path / f"none-{p}.db" for p in ("netflix", "crunchyroll", "spotify", "steam", "epic") if p != platform}
        app = (create_app(load_config(), db_path=path, db_paths=others, static_dir=tmp_path / "nodist") if platform == "youtube"
               else create_app(load_config(), db_paths={platform: path, **others}, static_dir=tmp_path / "nodist"))
        clients[seed] = make_client(app)
    checked = 0
    for path in _paths(clients[1], platform):
        a, b = clients[1].get(path), clients[2].get(path)
        assert a.status_code == b.status_code and a.status_code < 500, path
        if a.status_code == 200:
            assert json.dumps(a.json(), sort_keys=True) == json.dumps(b.json(), sort_keys=True), path
            checked += 1
    assert checked > 50


def test_youtube_order_independent(tmp_path):
    path = tmp_path / "youtube.db"
    populate(db.connect(path)).close()
    _same_everywhere(tmp_path, "youtube", path)


def test_netflix_order_independent(tmp_path):
    conn, _, _ = _built(tmp_path)
    db.init_db(conn)
    conn.close()
    _same_everywhere(tmp_path, "netflix", tmp_path / "netflix.db")


def test_netflix_ties_order_independent(tmp_path):
    """Every show watched exactly as much on the same days, all sharing genres: a page of ties."""
    shows = ["Cyberpunk: Edgerunners", "Peaky Blinders", "Money Heist", "Broadchurch", "HIS & HERS",
             "My Little Pony: Friendship Is Magic", "Stranger Things"]
    rows = "".join(f'"{s}: Season 1: Episode {e}","3/{d}/26"\n' for s in shows for d in (1, 8) for e in (1, 2))
    rows += '"Don\'t Look Up","3/1/26"\n"Spider-Man: Into the Spider-Verse","3/1/26"\n'
    conn, _, _ = _built(tmp_path, "Title,Date\n" + rows)
    db.init_db(conn)
    conn.close()
    _same_everywhere(tmp_path, "netflix", tmp_path / "netflix.db")


def test_crunchyroll_order_independent(tmp_path):
    conn, _ = _cr_db(tmp_path)
    conn.close()
    _same_everywhere(tmp_path, "crunchyroll", tmp_path / "crunchyroll.db")


def test_spotify_order_independent(tmp_path):
    from test_spotify import _built as spotify_built
    conn, _, _ = spotify_built(tmp_path)
    conn.close()
    _same_everywhere(tmp_path, "spotify", tmp_path / "spotify.db")


def test_steam_order_independent(tmp_path):
    from test_steam import _built as steam_built
    conn, _, _ = steam_built(tmp_path)
    conn.close()
    _same_everywhere(tmp_path, "steam", tmp_path / "steam.db")
