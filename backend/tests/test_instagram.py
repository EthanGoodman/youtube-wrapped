"""Instagram (#6): reading the export (only counts, times and who; never text), and the social stats and Wrapped."""
import io
import shutil
import sqlite3
import zipfile
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from ytw import db
from ytw.connectors.instagram import ingest as ig

FIX = Path(__file__).parent / "fixtures" / "instagram"
NY = ZoneInfo("America/New_York")


def _built(tmp_path, zipped=False):
    folder = tmp_path / "instagram"
    if zipped:                                       # the .zip Instagram sends
        folder.mkdir(parents=True)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for p in FIX.rglob("*.json"):
                z.writestr(p.relative_to(FIX).as_posix(), p.read_bytes())
        (folder / "instagram-test.zip").write_bytes(buf.getvalue())
    else:
        shutil.copytree(FIX, folder)
    conn = db.connect(tmp_path / "instagram.db")
    res = ig.ingest(conn, folder)
    n = ig.build(conn, NY)
    return conn, res, n


@pytest.mark.parametrize("zipped", [False, True])
def test_reads_folder_or_zip(tmp_path, zipped):
    conn, res, _ = _built(tmp_path, zipped)
    assert (res["like"], res["save"], res["comment"], res["follow"], res["follower"]) == (4, 1, 1, 1, 1)
    assert (res["post"], res["story"], res["message"], res["watched"]) == (1, 1, 4, 1)
    # two messages in the same second are both kept; who sent them, and the shared reel
    assert [tuple(r) for r in conn.execute("SELECT mine, shared FROM ig_events WHERE kind = 'message' ORDER BY at, mine DESC, shared")] == \
        [(1, 0), (1, 1), (0, 0), (0, 0)]


def test_never_keeps_text_or_login_data(tmp_path):
    conn, _, _ = _built(tmp_path)
    dump = "\n".join(str(tuple(r)) for r in conn.execute("SELECT * FROM ig_events"))
    assert "never stored" not in dump and "caption" not in dump.lower() and "203.0.113.9" not in dump
    cols = {r[1] for r in conn.execute("PRAGMA table_info(ig_events)")}
    assert cols == {"kind", "at", "account", "name", "mine", "shared", "tags"}


def test_names_repaired_and_owner_found(tmp_path):
    conn, _, _ = _built(tmp_path)
    chats = dict(conn.execute("SELECT account, name FROM ig_events WHERE kind = 'message'").fetchall())
    assert chats == {"palone_123": "Pal Oné", "group_456": "Weekend plans"}       # Meta's double-encoding undone
    assert conn.execute("SELECT DISTINCT tags FROM ig_events WHERE kind = 'like' AND tags IS NOT NULL").fetchall()


def test_views_are_your_actions(tmp_path):
    conn, _, n = _built(tmp_path)
    kinds = dict(conn.execute("SELECT kind, COUNT(*) FROM watches GROUP BY kind").fetchall())
    # likes, save, comment, follow, post, story, and the 2 messages you sent; not received messages, not watching
    assert kinds == {"like": 4, "save": 1, "comment": 1, "follow": 1, "post": 1, "story": 1, "message": 2} and n == 11
    assert conn.execute("SELECT SUM(est_s) FROM watches").fetchone()[0] == 0           # no time spent is invented


def _client(tmp_path):
    from conftest import make_client
    from ytw.api import create_app
    from ytw.config import load_config
    conn, _, _ = _built(tmp_path)
    conn.close()
    return make_client(create_app(load_config(), db_paths={"instagram": tmp_path / "instagram.db"}, static_dir=tmp_path / "x"))


def test_social_pages(tmp_path):
    c = _client(tmp_path)
    q = "platform=instagram&range=all"
    s = c.get(f"/api/social/summary?{q}").json()
    assert (s["likes"], s["messages"], s["messages_sent"], s["shared"], s["chats"]) == (4, 4, 2, 1, 2)
    p = c.get(f"/api/social/people?{q}").json()
    assert p["liked"][0] == {**p["liked"][0], "key": "trail_cam", "count": 3}
    assert p["chats"][0]["name"] == "Pal Oné" and (p["chats"][0]["sent"], p["chats"][0]["received"]) == (2, 1)
    assert p["shared_with"][0]["name"] == "Pal Oné"
    assert [t["tag"] for t in c.get(f"/api/social/tags?{q}").json()][:1] == ["nature"]
    r = c.get(f"/api/social/recent?{q}").json()
    assert r["watched"]["count"] == 1 and r["watched"]["top"][0]["account"] == "fast_cars"
    assert {y["year"] for y in c.get(f"/api/social/years?{q}").json()} == {2019, 2020}
    assert c.get("/api/social/summary?platform=steam").status_code in (404, 503)


def test_social_wrapped(tmp_path):
    c = _client(tmp_path)
    w = c.get("/api/wrapped/2020?platform=instagram").json()
    assert w["kind"] == "social" and not w["empty"] and w["summary"]["likes"] == 3
    assert w["people"]["chats"][0]["name"] == "Pal Oné" and w["personality"]["name"]
    assert c.get("/api/wrapped/2015?platform=instagram").json()["empty"] is True


def test_not_an_instagram_export(tmp_path):
    folder = tmp_path / "instagram"
    folder.mkdir()
    (folder / "random.json").write_text("[]")
    with pytest.raises(Exception, match="doesn't look like an Instagram export"):
        ig.ingest(sqlite3.connect(":memory:"), folder)
