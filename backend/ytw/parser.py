"""Parse Google Takeout YouTube watch history into normalized rows.

Entries are not uniform: almost every field can be missing. Classification is
done by explicit markers (the "From Google Ads" detail, the header, URL shapes),
never by guessing from titles.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import orjson

# Entry kinds
VIDEO = "video"                # normal watch with a known channel
UNAVAILABLE = "unavailable"    # watch with a video ID but no channel (removed/private)
MUSIC = "music"                # YouTube Music
AD = "ad"                      # video ad
AD_IMPRESSION = "ad_impression"  # "Viewed Ads On YouTube Homepage" etc.
AD_CLICK = "ad_click"          # "Visited <landing page>" after clicking an ad
SURVEY = "survey"              # "Answered survey question"
POST = "post"                  # community post
OTHER = "other"                # anything else ("Used Shorts creation tools", ...)

WATCH_KINDS = (VIDEO, UNAVAILABLE, MUSIC)
AD_KINDS = (AD, AD_IMPRESSION, AD_CLICK)

ADS_MARKER = "From Google Ads"
# zero-width characters and U+FFFC (object replacement, shows up in some API titles)
_ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff\ufffc"), None)
_ODD_SPACES = dict.fromkeys(map(ord, "\u00a0\u202f\u2007"), " ")
_VIDEO_ID_RE = re.compile(r"[?&]v=([^&#]+)")
_PREFIXES = ("Watched ", "Viewed ", "Visited ")
# Click trackers / redirectors that say nothing about the advertiser
_TRACKER_HOSTS = ("doubleclick.net", "dartsearch.net", "clickcease.com", "googleadservices.com",
                  "googlesyndication.com", "app.adjust.com", "onelink.me", "bit.ly")


@dataclass(slots=True)
class Entry:
    kind: str
    time_utc: str          # original ISO timestamp
    epoch: float           # seconds since epoch (UTC)
    local_iso: str         # local wall-clock time, ISO 8601 with offset
    local_date: str        # YYYY-MM-DD (local)
    local_hour: int        # 0-23 (local)
    local_minute: int      # minute of day 0-1439 (local)
    local_dow: int         # 0=Monday .. 6=Sunday (local)
    header: str
    title: str | None
    url: str | None
    video_id: str | None
    channel_id: str | None
    channel_name: str | None
    brand_hint: str | None  # ads only: advertiser channel or landing domain
    dedupe_key: str


def clean_text(s: str | None) -> str | None:
    """Strip zero-width characters and normalize odd spaces."""
    if s is None:
        return None
    s = s.translate(_ZERO_WIDTH).translate(_ODD_SPACES).strip()
    return s or None


def strip_prefix(title: str) -> str:
    for p in _PREFIXES:
        if title.startswith(p):
            return title[len(p):]
    return title


def video_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = _VIDEO_ID_RE.search(url)
    return m.group(1) if m else None


def _is_ad(e: dict) -> bool:
    return any(d.get("name") == ADS_MARKER for d in e.get("details") or ())


def _host(url: str) -> str | None:
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    if not host or any(host == t or host.endswith("." + t) for t in _TRACKER_HOSTS):
        return None
    return host


def _brand_hint(e: dict, url: str | None) -> str | None:
    """Best guess at the advertiser: their channel, landing domain, or searched name."""
    subs = e.get("subtitles") or ()
    if subs and subs[0].get("name"):
        return clean_text(subs[0]["name"])
    if not url:
        return None
    if "google.com/url" in url:
        qs = parse_qs(urlparse(url).query)
        for key in ("q", "url", "adurl"):
            if qs.get(key):
                return _host(qs[key][0])
    elif "google.com/search" in url:
        q = parse_qs(urlparse(url).query).get("q")
        return clean_text(q[0]) if q else None
    elif "youtube.com" not in url:
        return _host(url)
    return None


def classify(e: dict) -> str:
    title = e.get("title") or ""
    url = e.get("titleUrl")
    if title.startswith("Answered survey question"):
        return SURVEY
    if title.startswith("Visited "):
        return AD_CLICK
    if _is_ad(e):
        return AD if url else AD_IMPRESSION
    if (url and "/post/" in url) or title.startswith("Viewed a post"):
        return POST
    vid = video_id_from_url(url)
    if vid:
        if e.get("header") == "YouTube Music":
            return MUSIC
        return VIDEO if e.get("subtitles") else UNAVAILABLE
    return OTHER


def parse_entry(e: dict, tz: ZoneInfo) -> Entry:
    kind = classify(e)
    time_utc = e["time"]
    dt = datetime.fromisoformat(time_utc.replace("Z", "+00:00"))
    local = dt.astimezone(tz)
    url = e.get("titleUrl")
    raw_title = e.get("title") or ""
    title = clean_text(strip_prefix(raw_title))

    video_id = channel_id = channel_name = None
    if kind in (VIDEO, UNAVAILABLE, MUSIC, AD):
        video_id = video_id_from_url(url)
    if kind in (VIDEO, MUSIC):
        sub = (e.get("subtitles") or [{}])[0]
        channel_name = clean_text(sub.get("name"))
        curl = sub.get("url")
        if curl:
            channel_id = curl.rstrip("/").rsplit("/", 1)[-1] or None
    if kind == UNAVAILABLE and title and (title.startswith("http") or video_id and video_id in title):
        title = None  # title is just the URL
    brand = _brand_hint(e, url) if kind in AD_KINDS else None

    return Entry(
        kind=kind,
        time_utc=time_utc,
        epoch=dt.timestamp(),
        local_iso=local.isoformat(),
        local_date=local.strftime("%Y-%m-%d"),
        local_hour=local.hour,
        local_minute=local.hour * 60 + local.minute,
        local_dow=local.weekday(),
        header=e.get("header") or "",
        title=title,
        url=url,
        video_id=video_id,
        channel_id=channel_id,
        channel_name=channel_name,
        brand_hint=brand,
        dedupe_key=f"{time_utc}|{url or raw_title}",
    )


def parse_watch_history(raw: bytes | list, tz: ZoneInfo) -> list[Entry]:
    """Parse the whole file. Returns entries sorted oldest-first."""
    data = orjson.loads(raw) if isinstance(raw, (bytes, str)) else raw
    # Takeout is newest-first; on equal timestamps keep the file's relative order reversed.
    indexed = [(parse_entry(e, tz), i) for i, e in enumerate(data) if e.get("time")]
    indexed.sort(key=lambda p: (p[0].epoch, -p[1]))
    return [p[0] for p in indexed]


def load_watch_history(path: Path, tz: ZoneInfo) -> list[Entry]:
    return parse_watch_history(path.read_bytes(), tz)


# ---------------------------------------------------------------- search history

@dataclass(slots=True)
class Search:
    kind: str              # "search" for real searches; "ad" / "other" for the ad noise in the file
    time_utc: str
    epoch: float
    local_iso: str
    local_date: str
    local_hour: int
    local_dow: int
    query: str | None
    url: str | None
    dedupe_key: str


def parse_search_entry(e: dict, tz: ZoneInfo) -> Search:
    title = e.get("title") or ""
    url = e.get("titleUrl")
    if _is_ad(e) or title.startswith(("Visited ", "Answered survey question")):
        kind, query = "ad", None
    elif title.startswith("Searched for "):
        kind, query = "search", clean_text(title[len("Searched for "):])
    else:
        kind, query = "other", None
    dt = datetime.fromisoformat(e["time"].replace("Z", "+00:00"))
    local = dt.astimezone(tz)
    return Search(kind=kind, time_utc=e["time"], epoch=dt.timestamp(), local_iso=local.isoformat(),
                  local_date=local.strftime("%Y-%m-%d"), local_hour=local.hour, local_dow=local.weekday(),
                  query=query, url=url, dedupe_key=f"{e['time']}|{url or title}")


def parse_search_history(raw: bytes | list, tz: ZoneInfo) -> list[Search]:
    data = orjson.loads(raw) if isinstance(raw, (bytes, str)) else raw
    out = [parse_search_entry(e, tz) for e in data if e.get("time")]
    out.sort(key=lambda s: s.epoch)
    return out
