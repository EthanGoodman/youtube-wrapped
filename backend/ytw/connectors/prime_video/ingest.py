"""Load Prime Video viewing into data/prime_video.db: only your own viewing, not everyone's on the account.

Amazon's data export (Viewing History.csv) lists every playback on the account with real start/end times
and seconds watched, but not which profile played it. Each profile's watch-history page
(primevideo.com/settings/watch-history, saved with watch-history.js) says which titles that profile watched
and when, but not for how long. Together:

* each playback goes to the profile item with the same title whose watch time is the nearest at or after
  the playback's start (10 minutes' slack); every exported profile's items compete for it, so other
  people's playbacks don't land on you
* items on your own profile (the one history file without a picks file) are yours
* on another profile, the shows and movies you ticked in its checklist (a picks file) are yours too,
  except episodes that are also on your own profile: those count once, from yours
* a movie on both profiles is two watches

Kept per playback: the title, start time and seconds watched. Nothing about devices, places or networks.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sqlite3
from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from ... import db
from ...imports import ImportRejected, Source
from ..netflix import ingest as nf

EXPORT_CSV = "Viewing History.csv"
COUNTED = frozenset({"Full", "Feature", "Live", "LiveStreaming"})   # not trailers or promos
SLACK_S = 600                    # a profile's watch time can be logged a little before the playback starts
EARLIEST = 946684800             # 2000-01-01: Amazon fills unknown dates with 1970
OWN = "your profile"

_NORM = re.compile(r"[^a-z0-9]+")
_SEASON = re.compile(r"^(.*?)\s*(?:[-–:,]\s*)?\b(?:season|series|staffel|temporada|saison)\s*(\d+)\b.*$", re.I)
_EPISODE = re.compile(r"^episode\s+(\d+)\s*(?::\s*(.*))?$", re.I)


def norm(s: str | None) -> str:
    return _NORM.sub(" ", (s or "").lower()).strip()


@dataclass(frozen=True)
class ProfileItem:
    key: str              # how the export names it: "<episode title>-<show> - Season N", or the movie title
    watched_at: float     # epoch seconds
    profile: str
    mine: bool
    kind: str             # episode | movie
    show: str | None
    season: str | None
    episode: str | None
    number: int | None


_ORDINALS = ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth")
_COMPLETE = re.compile(r"^(.*?)\s*[-–:,]\s*the complete (" + "|".join(_ORDINALS) + r") season\b.*$", re.I)
# Amazon's extras on a store title: "(Extended Version)", "(2013) (With Bonus Features)", "(4K UHD)"
_EXTRAS = re.compile(r"\s*(?:\((?:\d{4}|[^)]*(?:version|edition|cut|bonus|features|uhd|4k|hd|subtitled|dubbed)[^)]*)\)"
                     r"|[-–:]?\s*(?:with bonus features|bonus features|(?:extended|theatrical|unrated|special) (?:version|edition|cut)"
                     r"|director'?s cut|4k uhd))\s*$", re.I)


def clean_title(title: str) -> str:
    """'Prisoners (2013) (With Bonus Features)' -> 'Prisoners'."""
    t = title.strip()
    while (u := _EXTRAS.sub("", t)) != t and u:
        t = u
    return t


def split_show(title: str) -> tuple[str, str | None]:
    """'The Boys - Season 1' -> ('The Boys', 'Season 1'); a title without a season stays whole."""
    m = _SEASON.match(title.strip())
    if m and m.group(1).strip():
        return clean_title(m.group(1)), f"Season {int(m.group(2))}"
    m = _COMPLETE.match(title.strip())
    if m and m.group(1).strip():
        return clean_title(m.group(1)), f"Season {_ORDINALS.index(m.group(2).lower()) + 1}"
    return clean_title(title), None


def split_episode(title: str) -> tuple[str, int | None]:
    """'Episode 8: You Found Me' -> ('You Found Me', 8)."""
    m = _EPISODE.match(title.strip())
    if not m:
        return title.strip(), None
    return (m.group(2) or "").strip() or f"Episode {m.group(1)}", int(m.group(1))


def item_key(x: dict) -> str:
    if x.get("type") == "Movie":
        return norm(x.get("title"))
    ep = re.sub(r"^episode\s+\d+:\s*", "", x.get("episodeTitle") or "", flags=re.I)
    return norm(f"{ep}-{x.get('title')}")


def fingerprint(items: list[dict]) -> str:
    """Names one profile's history file, so a picks file can say which profile it is for."""
    rows = sorted(f"{x.get('id')}|{x.get('episodeId')}|{x.get('watchedAt')}" for x in items)
    return hashlib.sha256("\n".join(rows).encode()).hexdigest()[:16]


def _is_history(data) -> bool:
    return (isinstance(data, list) and bool(data) and isinstance(data[0], dict)
            and {"title", "type", "watchedAt"} <= data[0].keys())


def _is_picks(data) -> bool:
    return isinstance(data, dict) and isinstance(data.get("picks"), list)


def find_files(folder: Path) -> tuple[list[tuple[Path, str]], list[tuple[Path, list]], list[tuple[Path, dict]]]:
    """(exports as (file, member), profile histories, picks files) anywhere under folder."""
    exports, histories, picks = [], [], []
    for p in sorted(folder.rglob("*")):
        if not p.is_file() or ".incoming" in p.parts or p.suffix.lower() not in (".zip", ".csv", ".json"):
            continue
        try:
            with Source(p) as src:
                if src.kind == "zip":
                    exports += [(p, m) for m in src.find(EXPORT_CSV)[:1]]
                elif p.name.lower() == EXPORT_CSV.lower():
                    exports.append((p, src.names()[0]))
                elif src.kind == "json":
                    data = src.read(src.names()[0])
                    if _is_history(data):
                        histories.append((p, data))
                    elif _is_picks(data):
                        picks.append((p, data))
        except ImportRejected:
            continue
    return exports, histories, picks


def _owner(pick: dict, histories: list[tuple[Path, list]]) -> int | None:
    """Which history a picks file is for: by fingerprint, else the only history holding every ticked title."""
    for i, (_, items) in enumerate(histories):
        if pick.get("of") and pick["of"] == fingerprint(items):
            return i
    ticked = set(pick["picks"])
    holders = [i for i, (_, items) in enumerate(histories) if ticked <= {x.get("title") for x in items}]
    return holders[0] if len(holders) == 1 else None


def profile_items(histories: list[tuple[Path, list]], picks: list[tuple[Path, dict]]) -> list[ProfileItem]:
    owners: dict[int, dict] = {}
    for path, pick in picks:
        i = _owner(pick, histories)
        if i is None:
            raise ValueError(f"{path.name}: can't tell which profile's history these picks are for. "
                             "Make the checklist again with `python backend/cli.py prime-picks <history .json>`.")
        owners[i] = pick
    own = [i for i in range(len(histories)) if i not in owners]
    if len(own) > 1:
        raise ValueError("Several watch histories have no picks file, so it's unclear which profile is yours: "
                         + ", ".join(histories[i][0].name for i in own)
                         + ". For each one that isn't yours, run `python backend/cli.py prime-picks <file>` "
                         "and tick what you watched (tick nothing if none of it was you).")
    own_eps = {item_key(x) for i in own for x in histories[i][1] if x.get("type") != "Movie"}
    out = []
    for i, (_, items) in enumerate(histories):
        pick = owners.get(i)
        ticked = set(pick["picks"]) if pick else set()
        label = OWN if pick is None else str(pick.get("profile") or histories[i][0].stem)
        for x in items:
            try:
                at = float(x["watchedAt"]) / 1000
            except (TypeError, ValueError, KeyError):
                continue
            movie = x.get("type") == "Movie"
            k = item_key(x)
            mine = pick is None or (x.get("title") in ticked and (movie or k not in own_eps))
            if movie:
                out.append(ProfileItem(k, at, label, mine, "movie", None, None, None, None))
            else:
                show, season = split_show(x.get("title") or "")
                episode, number = split_episode(x.get("episodeTitle") or "")
                out.append(ProfileItem(k, at, label, mine, "episode", show, season, episode or None, number))
    return out


def _ts(s: str | None) -> float | None:
    try:
        return datetime.fromisoformat((s or "").replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _secs(v: str | None) -> float:
    try:
        return max(float(v), 0.0)
    except (TypeError, ValueError):
        return 0.0


def playbacks(text: str) -> list[tuple[float, float, str, str]]:
    """(start, seconds watched, export title, normalized title) for every counted playback."""
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        a = _ts(r.get("Playback Start Datetime (UTC)"))
        s = _secs(r.get("Seconds Viewed"))
        if a and a >= EARLIEST and s > 0 and r.get("Material Type Description") in COUNTED:
            out.append((a, s, r.get("Title") or "", norm(r.get("Title"))))
    return out


def attribute(plays: list[tuple[float, float, str, str]], items: list[ProfileItem]):
    """Your playbacks with the profile item each belongs to, and counts of the rest."""
    by_key: dict[str, list[ProfileItem]] = {}
    for it in sorted(items, key=lambda it: it.watched_at):
        by_key.setdefault(it.key, []).append(it)
    times = {k: [it.watched_at for it in v] for k, v in by_key.items()}
    mine, others, unknown = [], 0, 0
    for p in plays:
        cands = by_key.get(p[3])
        j = bisect_left(times[p[3]], p[0] - SLACK_S) if cands else 0
        if not cands or j == len(cands):
            unknown += 1
        elif cands[j].mine:
            mine.append((p, cands[j]))
        else:
            others += 1
    return mine, others, unknown


def ingest(conn: sqlite3.Connection, folder: Path, tz: ZoneInfo) -> dict:
    """Replace the stored viewing with what the files in `folder` say is yours."""
    exports, histories, picks = find_files(folder)
    if not exports:
        raise FileNotFoundError(f"No Prime Video data export (with {EXPORT_CSV}) in {folder}")
    if not histories:
        raise FileNotFoundError(
            f"No profile watch history in {folder}. The export covers everyone on the account; save your "
            "profile's history from primevideo.com/settings/watch-history so only your viewing counts.")
    path, member = exports[-1]                       # newest name last; exports are complete snapshots
    with Source(path) as src:
        plays = playbacks(src.read_text(member))
    items = profile_items(histories, picks)
    mine, others, unknown = attribute(plays, items)
    mine.sort(key=lambda m: m[0][0])
    rows = []
    for i, ((start, secs, title, _), it) in enumerate(mine):
        local = datetime.fromtimestamp(start, timezone.utc).astimezone(tz)
        rows.append(("full", clean_title(title) if it.kind == "movie" else title, it.show, it.season, it.episode, it.kind, local.date().isoformat(), start,
                     round(secs), it.profile, None, None, None,
                     json.dumps({"episode_number": it.number}) if it.number else None, None, i))
    nf.init(conn)
    conn.execute("DELETE FROM views")
    conn.executemany(
        "INSERT INTO views (source, title, show, season, episode, kind, local_date, start_epoch, duration_s, "
        "profile, device, country, supplemental, attributes, bookmark_s, file_order) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    db.set_meta(conn, "prime_video_files", ", ".join([path.name] + [p.name for p, _ in histories + picks]))
    db.set_meta(conn, "timezone", str(tz))
    conn.commit()
    return {"file": path.name, "playbacks": len(plays), "mine": len(rows), "others": others, "unknown": unknown,
            "profiles": len(histories), "picks": len(picks), "hours": sum(r[8] for r in rows) / 3600}
