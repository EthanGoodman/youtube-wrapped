"""AniList (public GraphQL API, no key): studios, the anime season it aired, format, score and tags for
each series, matched by title. Cached in the database; wrong matches can be fixed in
data/crunchyroll/overrides.toml:

    [anilist]
    "Hunter x Hunter 2011" = 11061   # AniList id (from the anilist.co/anime/<id> URL)
    "Some Title" = 0                 # 0 = don't match

AniList's rate limit is currently 30 requests a minute, so requests are spaced 2.1 seconds apart.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
import tomllib
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

API = "https://graphql.anilist.co"
PAUSE_S = 2.1

SCHEMA = """
CREATE TABLE IF NOT EXISTS anilist (
    series_id   TEXT PRIMARY KEY,   -- Crunchyroll series id
    query       TEXT NOT NULL,      -- the title searched
    anilist_id  INTEGER,            -- NULL = no match
    data        TEXT,               -- JSON of the matched media
    fetched_at  TEXT NOT NULL
);
"""

FIELDS = """id title { romaji english native } synonyms format season seasonYear episodes averageScore
            genres tags { name rank isMediaSpoiler } studios(isMain: true) { nodes { name } }
            coverImage { extraLarge color } bannerImage siteUrl"""
SEARCH = f"query ($q: String) {{ Page(perPage: 8) {{ media(search: $q, type: ANIME, sort: SEARCH_MATCH) {{ {FIELDS} }} }} }}"
BY_ID = f"query ($id: Int) {{ Media(id: $id, type: ANIME) {{ {FIELDS} }} }}"

# (query, variables) -> response JSON
Poster = Callable[[str, dict], dict]


class AniListError(Exception):
    pass


def http_poster(query: str, variables: dict) -> dict:
    body = json.dumps({"query": query, "variables": variables}).encode()
    for attempt in range(5):
        req = urllib.request.Request(API, data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Accept": "application/json",
                                              # AniList refuses Python's default user agent
                                              "User-Agent": "wrapped-stats/1.0 (personal stats app)"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(float(e.headers.get("Retry-After") or 2 ** (attempt + 2)))
                continue
            if e.code == 404:
                return {"data": {"Media": None}}
            raise AniListError(f"AniList HTTP {e.code}") from None
        except urllib.error.URLError as e:
            if attempt < 4:
                time.sleep(2 ** attempt)
                continue
            raise AniListError(f"Network error: {e.reason}") from None
    raise AniListError("AniList kept rate-limiting; try again later")


def norm(s: str | None) -> str:
    # straight and curly apostrophes alike ("Journey's" == "Journey’s"), accents dropped, punctuation ignored
    s = re.sub("['‘’ʼ`]", "", s or "")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def best_match(title: str, results: list[dict]) -> dict | None:
    """An exact (normalized) title match if any (the TV series, earliest, when several); otherwise AniList's
    top result (it sorts by match)."""
    want = norm(title)
    exact = [m for m in results
             if want in {norm(n) for n in (m["title"].get("english"), m["title"].get("romaji"), m["title"].get("native"),
                                           *(m.get("synonyms") or [])) if n}]
    if exact:
        # a special or a later part can carry the series' name as a synonym: prefer the TV series, earliest first
        return min(exact, key=lambda m: (m.get("format") not in ("TV", "TV_SHORT"), m.get("seasonYear") or 9999))
    return results[0] if results else None


def load_overrides(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    with open(path, "rb") as f:
        return {str(k): int(v) for k, v in (tomllib.load(f).get("anilist") or {}).items()}


def enrich(conn: sqlite3.Connection, series: list[tuple[str, str]], post: Poster = http_poster,
           overrides: dict[str, int] | None = None, refresh: bool = False, pause_s: float = PAUSE_S,
           sleep: Callable[[float], None] = time.sleep, progress: Callable[[str], None] = lambda s: None) -> dict:
    """series: [(crunchyroll series id, title)]. Returns counts."""
    conn.executescript(SCHEMA)
    overrides = overrides or {}
    cached = {r[0]: r[1] for r in conn.execute("SELECT series_id, query FROM anilist")}
    found = requests = 0
    for i, (sid, title) in enumerate(series, 1):
        forced = overrides.get(title)
        if not refresh and cached.get(sid) == title and forced is None:
            continue
        progress(f"{i}/{len(series)}: {title}")
        if forced == 0:
            media = None
        elif forced:
            media = (post(BY_ID, {"id": forced}).get("data") or {}).get("Media")
            requests += 1
        else:
            results = (((post(SEARCH, {"q": title}).get("data") or {}).get("Page") or {}).get("media")) or []
            requests += 1
            media = best_match(title, results)
        conn.execute("INSERT OR REPLACE INTO anilist VALUES (?,?,?,?,?)",
                     (sid, title, media["id"] if media else None, json.dumps(media) if media else None,
                      datetime.now(timezone.utc).isoformat()))
        conn.commit()
        sleep(pause_s)
    for (n,) in conn.execute("SELECT COUNT(*) FROM anilist WHERE anilist_id IS NOT NULL"):
        found = n
    return {"series": len(series), "matched": found, "requests": requests}
