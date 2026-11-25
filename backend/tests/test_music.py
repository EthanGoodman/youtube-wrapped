"""Music family (#20): what counts as a stream, one listen per play across sources, albums on tracks."""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from ytw import db
from ytw.connectors.music import Album, dedupe_listens, is_stream, write_albums
from ytw.connectors.store import Item, View, write_items


def _view(i: int, track: str, start: float) -> View:
    return View(entry_id=i, kind="track", item_id=track, creator_id="artist:a", start_epoch=start,
                local=datetime.fromtimestamp(start, timezone.utc), est_s=180, est_method="exact", bucket="music")


def test_stream_threshold():
    assert is_stream(30_000) and is_stream(200_000)
    assert not is_stream(29_999) and not is_stream(0) and not is_stream(None)


def test_dedupe_same_play_from_two_sources():
    export = [_view(1, "t:a", 1000), _view(2, "t:b", 1200)]
    scrobbles = [_view(3, "t:a", 1012), _view(4, "t:b", 1260)]  # 12 s later: same play; 60 s later: another one
    kept = dedupe_listens(export + scrobbles)
    assert [(v.entry_id, v.item_id) for v in kept] == [(1, "t:a"), (2, "t:b"), (4, "t:b")]


def test_dedupe_keeps_real_repeats_and_first_source():
    plays = [_view(1, "t:a", 0), _view(2, "t:a", 200), _view(3, "t:a", 400)]   # on repeat: three plays
    assert len(dedupe_listens(plays)) == 3
    a, b = _view(1, "t:a", 500), _view(2, "t:a", 500)                      # same start: the first given wins
    assert [v.entry_id for v in dedupe_listens([a, b])] == [1]


def test_albums_and_track_album(tmp_path):
    conn = db.connect(tmp_path / "music.db")
    db.init_db(conn)
    write_albums(conn, [Album("al:1", "Night Drive", "artist:a", "s.jpg", "l.jpg", "2020")])
    write_items(conn, [Item("t:a", "ok", "Song A", "artist:a", album_id="al:1")])
    row = conn.execute("SELECT a.title, a.released FROM items i JOIN albums a ON a.album_id = i.album_id "
                       "WHERE i.item_id = 't:a'").fetchone()
    assert tuple(row) == ("Night Drive", "2020")


def test_old_database_gets_album_column(tmp_path):
    """A database made before #20 has items without album_id: init_db adds it, and writing items still works."""
    path = Path(tmp_path / "old.db")
    raw = sqlite3.connect(path)
    raw.execute("CREATE TABLE items (item_id TEXT PRIMARY KEY, status TEXT NOT NULL, title TEXT, creator_id TEXT, "
                "thumb_small TEXT, thumb_large TEXT, duration_s INTEGER, published_at TEXT, category_id TEXT, "
                "url TEXT, extra TEXT)")
    raw.commit()
    raw.close()
    conn = db.connect(path)
    db.init_db(conn)
    write_items(conn, [Item("v1", "ok", "A video"), Item("t1", "ok", "A track", album_id="al:9")])
    assert dict(conn.execute("SELECT item_id, album_id FROM items").fetchall()) == {"v1": None, "t1": "al:9"}
