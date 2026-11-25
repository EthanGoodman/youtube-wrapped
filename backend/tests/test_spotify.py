"""Spotify (#3): reading both exports, what becomes a stream, and what is never stored."""
import json
import shutil
from pathlib import Path
from zoneinfo import ZoneInfo

from ytw import db
from ytw.connectors.spotify import ingest as sp

FIX = Path(__file__).parent / "fixtures" / "spotify"
NY = ZoneInfo("America/New_York")


def _built(tmp_path, files=None):
    folder = tmp_path / "spotify"
    folder.mkdir()
    for p in FIX.iterdir():
        if files is None or p.name in files:
            shutil.copy(p, folder / p.name)
    conn = db.connect(tmp_path / "spotify.db")
    res = sp.ingest(conn, folder)
    n = sp.build(conn, NY)
    return conn, res, n


def test_reads_both_exports_music_only(tmp_path):
    conn, res, _ = _built(tmp_path)
    assert res["files"] == 3 and res["sources"] == ["account", "extended"]
    # the podcast and the removed track (no id) aren't plays; the account file adds its 3 rows
    assert res["plays"] == 6 + 3


def test_streams_skips_and_account_overlap(tmp_path):
    conn, _, n = _built(tmp_path)
    rows = conn.execute("SELECT video_id, channel_id, est_s, local_date FROM watches ORDER BY start_epoch").fetchall()
    # 5 extended streams (the 12 s play is a skip) + Undertow on Apr 10 from the account file; the account copy of
    # Harbor Lights on Mar 2 is dropped (that day is in the extended history) and Brine (20 s) is a skip
    assert n == 6 and [r[0] for r in rows].count("track:T1") == 3
    assert rows[-1][0] == "track:T3" and rows[-1][3] == "2025-04-10"    # the account row reuses the extended id
    extra = {k: json.loads(e) for k, e in conn.execute("SELECT item_id, extra FROM items")}
    assert extra["track:T2"] == {"plays": 2, "skips": 1}
    brine = next(k for k in extra if k.startswith("track:low-tide-choir"))
    assert extra[brine] == {"plays": 1, "skips": 1}


def test_start_is_end_minus_played(tmp_path):
    conn, _, _ = _built(tmp_path, {"Streaming_History_Audio_2024.json"})
    first = conn.execute("SELECT local_iso, est_s, session_id FROM watches ORDER BY start_epoch").fetchall()
    # ended 23:10:00 UTC after 201 s -> started 23:06:39 UTC = 18:06:39 in New York, still Dec 31
    assert first[0][0].startswith("2024-12-31T18:06:39") and first[0][1] == 201
    assert first[0][2] == first[1][2]                                   # back to back = one session


def test_albums_artists_devices(tmp_path):
    conn, _, _ = _built(tmp_path)
    albums = dict(conn.execute("SELECT album_id, title FROM albums").fetchall())
    assert albums["album:the-paper-lanterns|night-ferry"] == "Night Ferry"
    assert conn.execute("SELECT album_id FROM items WHERE item_id = 'track:T1'").fetchone()[0] in albums
    assert conn.execute("SELECT title FROM creators WHERE creator_id = 'artist:mira-vale'").fetchone()[0] == "Mira Vale"
    devices = {d for (d,) in conn.execute("SELECT DISTINCT device FROM plays WHERE source = 'extended'")}
    assert devices == {"phone", "computer", "console"}


def test_never_stores_ip_or_country(tmp_path):
    conn, _, _ = _built(tmp_path)
    dump = "\n".join(str(tuple(r)) for t in ("plays", "watches", "items", "creators", "albums")
                     for r in conn.execute(f"SELECT * FROM {t}"))  # nosec B608 - fixed table names
    assert "203.0.113.7" not in dump and "'US'" not in dump


def test_music_stats_and_api(tmp_path):
    from conftest import make_client
    from ytw.api import create_app
    from ytw.config import load_config
    from ytw.stats import music
    from ytw.stats.common import Filters, resolve_range

    conn, _, _ = _built(tmp_path)
    r, f = resolve_range(conn, "all"), Filters()
    albums = music.top_albums(conn, r, f)
    assert albums[0]["title"] == "Night Ferry" and albums[0]["artist"] == "The Paper Lanterns" and albums[0]["count"] == 3
    rec = music.records(conn, r, f)
    assert rec["on_repeat"]["title"] == "Harbor Lights" and rec["on_repeat"]["count"] == 2
    assert rec["most_skipped"]["skips"] == 1
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"spotify": tmp_path / "spotify.db"}, static_dir=tmp_path / "x"))
    q = "platform=spotify&range=all"
    assert client.get("/api/meta?platform=spotify").json()["platform"]["family"] == "music"
    a = client.get(f"/api/album/{albums[0]['key']}?{q}").json()
    assert a["album"]["title"] == "Night Ferry" and a["all_time"]["videos"] == 3
    assert client.get(f"/api/music/records?{q}").status_code == 200
    assert client.get("/api/music/records?platform=netflix").status_code == 404   # not a music platform


class FakeArt:
    """Spotify oEmbed (by track id: knows T1 and T3, not T2) and Deezer search (by name)."""
    def __init__(self):
        self.calls = []

    def oembed(self, track_id):
        self.calls.append(("oembed", track_id))
        if track_id not in ("T1", "T3"):
            return {}
        return {"title": "x", "thumbnail_url": f"https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02{track_id[1]}c1aaaa"}

    def deezer(self, name):
        self.calls.append(("deezer", name))
        if name == "The Paper Lanterns":   # an exact match (other case) after a near miss
            return {"data": [{"name": "Paper Lanterns", "picture_medium": "https://cdn-images.dzcdn.net/images/artist/zz/250.jpg"},
                             {"name": "the paper lanterns", "picture_medium": "https://cdn-images.dzcdn.net/images/artist/ab/250.jpg",
                              "picture_big": "https://cdn-images.dzcdn.net/images/artist/ab/500.jpg"}]}
        if name == "Mira Vale":            # Deezer's blank silhouette: no photo
            return {"data": [{"name": "Mira Vale", "picture_medium": "https://cdn-images.dzcdn.net/images/artist//250.jpg"}]}
        return {"data": []}


def fake_lastfm(artist):
    tags = {"The Paper Lanterns": [{"name": "indie folk", "count": 100}, {"name": "seen live", "count": 90},
                                   {"name": "dream pop", "count": 40}, {"name": "2010s", "count": 30},
                                   {"name": "rare tag", "count": 3}]}
    return {"toptags": {"tag": tags[artist]}} if artist in tags else {"error": 6, "message": "not found"}


def test_enrich_quick_then_rest(tmp_path):
    from ytw.connectors.spotify import art, lastfm
    conn, _, _ = _built(tmp_path)
    fake = FakeArt()
    first = art.enrich(conn, fake.oembed, fake.deezer, limit=1)     # the quick pass: the most-played album and artist
    assert fake.calls == [("oembed", "T1"), ("deezer", "The Paper Lanterns")] and first["left"] > 0
    r = art.enrich(conn, fake.oembed, fake.deezer)                   # everything else
    assert r["albums_found"] == 2 and r["artists_found"] == 1 and r["left"] == 0
    assert ("oembed", "T2") in fake.calls                            # asked, not found: cached as not found
    n = len(fake.calls)
    art.enrich(conn, fake.oembed, fake.deezer)
    assert len(fake.calls) == n                                      # all cached: no new requests
    g = lastfm.enrich(conn, fake_lastfm)
    assert g["artists_with_genres"] == 1 and g["left"] == 0
    sp.build(conn, NY)
    t1 = conn.execute("SELECT thumb_small, thumb_large FROM items WHERE item_id = 'track:T1'").fetchone()
    # moved to Spotify's main image host; the 640 px version from the same image id
    assert tuple(t1) == ("https://i.scdn.co/image/ab67616d00001e021c1aaaa", "https://i.scdn.co/image/ab67616d0000b2731c1aaaa")
    photos = dict(conn.execute("SELECT creator_id, avatar_url FROM creators").fetchall())
    assert photos["artist:the-paper-lanterns"] == "https://cdn-images.dzcdn.net/images/artist/ab/250.jpg"
    assert photos["artist:mira-vale"] is None                         # placeholder skipped
    # tags that aren't genres (seen live, a decade, light ones) are dropped
    assert {g for (g,) in conn.execute("SELECT genre FROM item_genres WHERE item_id = 'track:T1'")} == {"Indie Folk", "Dream Pop"}
    assert db.get_meta(conn, "extra_capabilities") == "time_of_day,genres"


def test_art_urls_are_relay_safe():
    from ytw.connectors.spotify import art
    from ytw.images import check_url
    good = art.album_art({"thumbnail_url": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02deadbeef"})
    check_url(good["small"])                                         # allowed by the image relay (raises if not)
    check_url(good["large"])
    assert art.album_art({"thumbnail_url": "https://evil.example/image/ab67616d00001e02deadbeef"}) is None
    assert art.album_art({"thumbnail_url": "https://i.scdn.co/image/../../etc"}) is None


def test_music_wrapped(tmp_path):
    from conftest import make_client
    from ytw.api import create_app
    from ytw.config import load_config
    conn, _, _ = _built(tmp_path)
    conn.close()
    client = make_client(create_app(load_config(), db_paths={"spotify": tmp_path / "spotify.db"}, static_dir=tmp_path / "x"))
    w = client.get("/api/wrapped/2025?platform=spotify").json()
    assert w["kind"] == "music" and w["platform"] == "spotify" and not w["empty"]
    assert w["top_tracks"][0]["title"] == "Harbor Lights" and w["top_artists"][0]["title"] == "The Paper Lanterns"
    assert w["top_albums"][0]["title"] == "Night Ferry" and w["on_repeat"]["count"] == 2
    assert w["personality"]["name"] and "new_artist_share" in w["metrics"]
    assert client.get("/api/wrapped/2023?platform=spotify").json()["empty"] is True
