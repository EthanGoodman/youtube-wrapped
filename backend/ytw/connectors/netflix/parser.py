"""Parse Netflix viewing history: the quick download or the full data export.

Quick download (netflix.com/viewingactivity -> "Download all"): NetflixViewingHistory.csv
    Title,Date            dates are M/D/YY in the US (other regions: D/M/YYYY or YYYY-MM-DD),
                          newest first, one profile, no times or durations.
Full export (Account -> Download your personal information): CONTENT_INTERACTION/ViewingActivity.csv
    Profile Name, Start Time (UTC "YYYY-MM-DD HH:MM:SS"), Duration ("HH:MM:SS"), Attributes, Title,
    Supplemental Video Type (blank for real titles; HOOK, TRAILER, TEASER_TRAILER, RECAP, …),
    Device Type, Bookmark, Latest Bookmark, Country. Columns are looked up by name.
"""
from __future__ import annotations

import csv
import io
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

SIMPLE = "simple"
FULL = "full"

# A segment that names a season of a show: "Season 2", "Part 5", "Limited Series", "Volume 1", …
_SEASON_RE = re.compile(
    # ("Chapter One" is NOT a season: Stranger Things names episodes that way)
    r"^(season|part|volume|vol\.|book|series|collection)\s+[\w\d]+$"
    r"|^limited series$|^miniseries$|^season \d+ \(.*\)$", re.I)
_EPISODE_NUM_RE = re.compile(r"\bepisode\s+(\d+)\b", re.I)
_TRAILING_NUM_RE = re.compile(r"^(.*\S)\s+(\d+)$")


@dataclass(slots=True)
class View:
    source: str               # simple | full
    title: str                # as Netflix wrote it
    show: str | None          # None for movies
    season: str | None        # "Season 2", "Part 5", "Limited Series", "Stranger Things 5", …
    episode: str | None       # episode title (or "Episode 3")
    kind: str                 # episode | movie | unknown (one-off with a colon: TMDB decides)
    local_date: str           # YYYY-MM-DD (local)
    start_utc: datetime | None   # full export only
    duration_s: int | None       # full export only
    profile: str | None
    device: str | None
    country: str | None
    supplemental: str | None  # TRAILER, HOOK, … (None for real viewing)
    attributes: str | None
    bookmark_s: int | None
    order: int                # position in the file (keeps same-day order for the quick file)


# ------------------------------------------------------------------ format detection

def detect_format(header: list[str]) -> str:
    cols = {c.strip().lower() for c in header}
    if {"start time", "duration", "title"} <= cols:
        return FULL
    if {"title", "date"} <= cols:
        return SIMPLE
    raise ValueError(f"not a Netflix viewing history file (columns: {', '.join(header)})")


def read_rows(text: str) -> tuple[str, list[dict[str, str]]]:
    text = text.lstrip("﻿")
    reader = csv.DictReader(io.StringIO(text))
    fmt = detect_format(reader.fieldnames or [])
    rows = [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in reader
            if any((v or "").strip() for v in r.values())]
    return fmt, rows


# ------------------------------------------------------------------ dates and durations

def date_order(values: list[str]) -> str:
    """'mdy', 'dmy' or 'iso' for the quick file's Date column (Netflix uses the account's locale)."""
    if values and all(re.match(r"^\d{4}-\d{2}-\d{2}$", v) for v in values):
        return "iso"
    firsts, seconds = [], []
    for v in values:
        parts = v.split("/")
        if len(parts) == 3:
            firsts.append(int(parts[0]))
            seconds.append(int(parts[1]))
    if any(f > 12 for f in firsts) and not any(s > 12 for s in seconds):
        return "dmy"
    return "mdy"


def parse_date(value: str, order: str) -> date:
    if order == "iso":
        return date.fromisoformat(value)
    a, b, y = (int(x) for x in value.split("/"))
    if y < 100:
        y += 1900 if y > 70 else 2000
    m, d = (a, b) if order == "mdy" else (b, a)
    return date(y, m, d)


def parse_hms(value: str) -> int | None:
    """'01:02:03' -> 3723. Empty or malformed -> None."""
    parts = value.split(":") if value else []
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    h, m, s = (int(p) for p in parts)
    return h * 3600 + m * 60 + s


def parse_start(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


# ------------------------------------------------------------------ titles

def _segments(title: str) -> list[str]:
    return [s.strip() for s in title.split(": ")]


def _is_season(segment: str, show_segments: list[str]) -> bool:
    if _SEASON_RE.match(segment):
        return True
    # "Stranger Things 5": the show's name followed by a number
    m = _TRAILING_NUM_RE.match(segment)
    return bool(m and show_segments and m.group(1).lower() == ": ".join(show_segments).lower())


def split_titles(titles: list[str]) -> dict[str, tuple[str | None, str | None, str | None, str]]:
    """Split every distinct title into (show, season, episode, kind).

    Rules, in order:
    1. A season segment ("Season 2", "Part 5", "Limited Series", "Stranger Things 5") after the
       first segment: everything before it is the show, everything after is the episode.
    2. Otherwise the show is the longest prefix (whole segments) shared by 2+ different titles,
       e.g. "Cyberpunk: Edgerunners" from "Cyberpunk: Edgerunners: Stronger" and siblings.
    3. "Show: Episode 3" is an episode even alone.
    4. No colon: a movie. A one-off with a colon ("Spider-Man: Into the Spider-Verse") is
       'unknown' and treated as a movie until TMDB says otherwise.
    """
    distinct = sorted(set(titles))
    prefix_count: dict[str, set[str]] = defaultdict(set)
    for t in distinct:
        segs = _segments(t)
        for k in range(1, len(segs)):
            prefix_count[": ".join(segs[:k]).lower()].add(t)

    out = {}
    for t in distinct:
        segs = _segments(t)
        if len(segs) == 1:
            out[t] = (None, None, None, "movie")
            continue
        season_at = next((i for i in range(1, len(segs) - 1) if _is_season(segs[i], segs[:i])), None)
        if season_at is not None:
            out[t] = (": ".join(segs[:season_at]), segs[season_at], ": ".join(segs[season_at + 1:]), "episode")
            continue
        shared = next((k for k in range(len(segs) - 1, 0, -1)
                       if len(prefix_count[": ".join(segs[:k]).lower()]) >= 2), None)
        if shared:
            out[t] = (": ".join(segs[:shared]), None, ": ".join(segs[shared:]), "episode")
        elif _EPISODE_NUM_RE.search(segs[-1]):
            out[t] = (": ".join(segs[:-1]), None, segs[-1], "episode")
        else:
            out[t] = (None, None, None, "unknown")
    return out


# ------------------------------------------------------------------ parsing

UNKNOWN_SHOW = "Unknown show"  # Netflix sometimes leaves the show name out (": Episode 5")

def parse_history(text: str, tz, profile: str | None = None) -> tuple[str, list[View]]:
    """Parse one file of either format. Returns (format, views oldest-first)."""
    fmt, views, _ = parse_files([text], tz, profile)
    return fmt, views


def parse_files(texts: list[str], tz, profile: str | None = None) -> tuple[str, list[View], int]:
    """Parse and merge several history files (e.g. two accounts, or a quick download next to a
    full export). Returns (format, views oldest-first, duplicates dropped).

    Titles from all files are split together, so a show seen in both files is one show. A row
    with the same title on the same day as a row in an earlier file is the same viewing showing
    up twice and is dropped (full exports come first, so their exact times win). Supplemental
    rows (trailers, previews…) are kept but flagged; `profile` filters full exports to one profile.
    format is "full", "simple", or "mixed" when both kinds were merged."""
    parsed = [read_rows(t) for t in texts]
    parsed.sort(key=lambda p: p[0] != FULL)  # full exports first
    if profile:
        parsed = [(fmt, [r for r in rows if r.get("profile name", "").lower() == profile.lower()] if fmt == FULL else rows)
                  for fmt, rows in parsed]
    parts = split_titles([r["title"] for _, rows in parsed for r in rows if r.get("title")])
    views: list[View] = []
    seen: set[tuple[str, str]] = set()
    dropped = 0
    for fmt, rows in parsed:
        file_views: list[View] = []
        if fmt == SIMPLE:
            order = date_order([r["date"] for r in rows])
            n = len(rows)
            for i, r in enumerate(rows):
                if not r.get("title") or not r.get("date"):
                    continue
                show, season, ep, kind = parts[r["title"]]
                if show is not None and not show.strip():
                    show = UNKNOWN_SHOW
                file_views.append(View(SIMPLE, r["title"], show, season, ep, kind,
                                       parse_date(r["date"], order).isoformat(), None, None, None, None, None,
                                       None, None, None, n - i))  # file is newest first
        else:
            for i, r in enumerate(rows):
                if not r.get("title") or not r.get("start time"):
                    continue
                start = parse_start(r["start time"])
                show, season, ep, kind = parts[r["title"]]
                if show is not None and not show.strip():
                    show = UNKNOWN_SHOW
                file_views.append(View(
                    FULL, r["title"], show, season, ep, kind, start.astimezone(tz).date().isoformat(), start,
                    parse_hms(r.get("duration", "")), r.get("profile name") or None, r.get("device type") or None,
                    r.get("country") or None, r.get("supplemental video type") or None,
                    r.get("attributes") or None, parse_hms(r.get("bookmark", "")), -i))  # file is newest first
        # same title, same day as an earlier file: the same viewing (only checked across files)
        keys = {(v.title, v.local_date) for v in file_views}
        for v in file_views:
            if (v.title, v.local_date) in seen:
                dropped += 1
            else:
                views.append(v)
        seen |= keys
    # oldest first: by day, then real start time, then the file's own order; `order` becomes the
    # position within the day so same-day quick rows from different files don't collide
    views.sort(key=lambda v: (v.local_date, v.start_utc.timestamp() if v.start_utc else 0, v.order))
    day, pos = None, 0
    for v in views:
        pos = pos + 1 if v.local_date == day else 1
        day = v.local_date
        v.order = pos
    kinds = {fmt for fmt, _ in parsed}
    return (kinds.pop() if len(kinds) == 1 else "mixed") if kinds else SIMPLE, views, dropped


def profiles_in(text: str) -> list[str]:
    fmt, rows = read_rows(text)
    if fmt != FULL:
        return []
    return sorted({r.get("profile name", "") for r in rows if r.get("profile name")})


def find_files(folder: Path) -> list[Path]:
    """Every history file under folder: full exports (ViewingActivity.csv, any depth) first,
    then quick downloads (NetflixViewingHistory*.csv, e.g. one per account)."""
    quick = [p for p in folder.rglob("NetflixViewingHistory*.csv") if ".incoming" not in p.parts]
    return sorted(folder.rglob("ViewingActivity.csv")) + sorted(quick)
