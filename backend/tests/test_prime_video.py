"""Prime Video: only your own playbacks count (made-up data)."""
import json
import zipfile
from zoneinfo import ZoneInfo

import pytest

from ytw import db
from ytw.connectors.netflix import ingest as nf
from ytw.connectors.prime_video import ingest as pv
from ytw.connectors.prime_video.picks import page

UTC = ZoneInfo("UTC")
HEAD = ("Title,Material Type Description,Playback Start Datetime (UTC),Playback End Datetime (UTC),Seconds Viewed,"
        "City,ISP Name\n")


def ms(iso: str) -> int:
    from datetime import datetime
    return int(datetime.fromisoformat(iso + "+00:00").timestamp() * 1000)


def ep(show: str, n: int, name: str, at: str) -> dict:
    return {"title": show, "id": "g1", "type": "Series", "episodeTitle": f"Episode {n}: {name}",
            "episodeId": f"e{n}", "watchedAt": ms(at)}


def movie(title: str, at: str) -> dict:
    return {"title": title, "id": "m1", "type": "Movie", "episodeTitle": "", "episodeId": "", "watchedAt": ms(at)}


def play(title: str, start: str, secs: int, kind: str = "Full") -> str:
    return f"{title},{kind},{start}Z,{start}Z,{secs},Springfield,Some ISP\n"


def setup(tmp_path, csv: str, files: dict) -> tuple:
    folder = tmp_path / "prime_video"
    folder.mkdir()
    with zipfile.ZipFile(folder / "Prime Video.zip", "w") as z:
        z.writestr("Your Prime Video Viewing Activity/Viewing History.csv", HEAD + csv)
    for name, data in files.items():
        (folder / name).write_text(json.dumps(data), encoding="utf-8")
    return db.connect(tmp_path / "prime_video.db"), folder


MINE = [ep("Glass Harbor - Season 1", 1, "Low Tide", "2025-03-01T20:50:00"),
        ep("Glass Harbor - Season 1", 2, "Undertow", "2025-03-01T21:40:00"),
        movie("Paper Comet", "2025-03-05T22:00:00")]
OTHER = [ep("Glass Harbor - Season 1", 2, "Undertow", "2024-01-10T21:00:00"),      # also on yours: counts once
         ep("Glass Harbor - Season 1", 3, "Breakwater", "2024-01-11T21:00:00"),    # only here, ticked: yours
         movie("Paper Comet", "2024-02-01T22:00:00"),                              # on both: another watch
         movie("Kitchen Wars", "2024-02-02T20:00:00")]                             # not ticked: someone else's
PLAYS = (play("Low Tide-Glass Harbor - Season 1", "2025-03-01T20:05:00", 2700)
         + play("Undertow-Glass Harbor - Season 1", "2025-03-01T20:55:00", 2600)
         + play("Paper Comet", "2025-03-05T20:00:00", 6000)
         + play("Undertow-Glass Harbor - Season 1", "2024-01-10T20:10:00", 2600)
         + play("Breakwater-Glass Harbor - Season 1", "2024-01-11T20:10:00", 2500)
         + play("Paper Comet", "2024-02-01T20:00:00", 6100)
         + play("Kitchen Wars", "2024-02-02T18:30:00", 5000)
         + play("Paper Comet", "2024-02-01T19:00:00", 30, "Trailer")                # trailers never count
         + play("Ferry Lights", "2023-06-01T20:00:00", 4000))                      # no saved profile has it


def test_split_names():
    assert pv.split_show("Glass Harbor - Season 2") == ("Glass Harbor", "Season 2")
    assert pv.split_show("Glass Harbor Season 3") == ("Glass Harbor", "Season 3")
    assert pv.split_show("Seasons of Rain") == ("Seasons of Rain", None)
    assert pv.split_show("Harbor Town: The Complete Second Season") == ("Harbor Town", "Season 2")
    assert pv.clean_title("Paper Comet (2013) (With Bonus Features)") == "Paper Comet"
    assert pv.clean_title("Paper Comet (Extended Version)") == "Paper Comet"
    assert pv.clean_title("Comet (Part 2)") == "Comet (Part 2)"
    assert pv.clean_title("Paper Comet (2013) With Bonus Features") == "Paper Comet"
    assert pv.clean_title("Paper Comet Extended Version") == "Paper Comet"
    assert pv.clean_title("Space Saga (Episode VIII)") == "Space Saga (Episode VIII)"
    assert pv.split_episode("Episode 8: The Long Way") == ("The Long Way", 8)
    assert pv.split_episode("Episode 4") == ("Episode 4", 4)
    assert pv.item_key(MINE[0]) == pv.norm("Low Tide-Glass Harbor - Season 1")


def test_only_your_viewing_counts(tmp_path):
    picks = {"profile": "Family", "of": pv.fingerprint(OTHER), "picks": ["Glass Harbor - Season 1", "Paper Comet"]}
    conn, folder = setup(tmp_path, PLAYS, {"mine.json": MINE, "family.json": OTHER, "prime-picks-family.json": picks})
    r = pv.ingest(conn, folder, UTC)
    assert (r["playbacks"], r["mine"], r["others"], r["unknown"]) == (8, 5, 2, 1)
    rows = conn.execute("SELECT title, show, season, episode, kind, duration_s, profile FROM views "
                        "ORDER BY start_epoch").fetchall()
    assert [tuple(x) for x in rows] == [
        ("Breakwater-Glass Harbor - Season 1", "Glass Harbor", "Season 1", "Breakwater", "episode", 2500, "Family"),
        ("Paper Comet", None, None, None, "movie", 6100, "Family"),
        ("Low Tide-Glass Harbor - Season 1", "Glass Harbor", "Season 1", "Low Tide", "episode", 2700, pv.OWN),
        ("Undertow-Glass Harbor - Season 1", "Glass Harbor", "Season 1", "Undertow", "episode", 2600, pv.OWN),
        ("Paper Comet", None, None, None, "movie", 6000, pv.OWN)]
    # nothing about places or networks is kept
    assert not conn.execute("SELECT COUNT(*) FROM views WHERE device IS NOT NULL OR country IS NOT NULL").fetchone()[0]
    assert "Springfield" not in json.dumps([tuple(x) for x in conn.execute("SELECT * FROM views")])
    assert nf.build(conn, UTC, {}, search_url="https://www.primevideo.com/search/?phrase=") == 5
    shows = conn.execute("SELECT title, url FROM creators").fetchall()
    assert [tuple(s) for s in shows] == [("Glass Harbor", "https://www.primevideo.com/search/?phrase=Glass%20Harbor")]
    assert db.get_meta(conn, "extra_capabilities") == "time_of_day"


def test_picks_found_by_title_without_fingerprint(tmp_path):
    picks = {"profile": "Family", "picks": ["Kitchen Wars"]}
    conn, folder = setup(tmp_path, PLAYS, {"mine.json": MINE, "family.json": OTHER, "picks.json": picks})
    assert pv.ingest(conn, folder, UTC)["mine"] == 4      # yours 3 + Kitchen Wars


def test_needs_your_profile_to_be_clear(tmp_path):
    conn, folder = setup(tmp_path, PLAYS, {"mine.json": MINE, "family.json": OTHER})
    with pytest.raises(ValueError, match="which profile is yours"):
        pv.ingest(conn, folder, UTC)
    conn, folder = setup(tmp_path / "b", PLAYS, {}) if (tmp_path / "b").mkdir() is None else (None, None)
    with pytest.raises(FileNotFoundError, match="watch history"):
        pv.ingest(conn, folder, UTC)


def test_checklist_page_is_inert():
    html = page(OTHER + [movie("</script><script>alert(1)</script>", "2024-03-01T20:00:00")], "Family")
    assert "</script><script>alert(1)" not in html
    assert "Glass Harbor" in html and "Kitchen Wars" in html and "fetch(" not in html
