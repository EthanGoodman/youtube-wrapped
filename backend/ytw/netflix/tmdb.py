"""Match Netflix shows and movies to TMDB (The Movie Database) for posters, genres and runtimes.

Uses a free TMDB API Read Access Token (TMDB_TOKEN, kept in the OS keychain). Every result is cached in
netflix.db, so each title is looked up once. Wrong matches can be fixed in
data/netflix/overrides.toml:

    [shows]
    "Money Heist" = 71446        # TMDB TV id
    [movies]
    "Bugonia" = 701387           # TMDB movie id
    "Some Netflix Special" = 0   # 0 = don't match this title
"""
from __future__ import annotations

import json
import re
import sqlite3
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

API = "https://api.themoviedb.org/3/"
IMG = "https://image.tmdb.org/t/p/"

from .. import net
from .parser import UNKNOWN_SHOW

SCHEMA = """
CREATE TABLE IF NOT EXISTS tmdb_titles (
    query          TEXT PRIMARY KEY,   -- "tv|show name" or "movie|title"
    media_type     TEXT NOT NULL,      -- tv | movie | none (not found)
    tmdb_id        INTEGER,
    name           TEXT,
    year           TEXT,
    poster_path    TEXT,
    backdrop_path  TEXT,
    genres         TEXT,               -- JSON list of names
    overview       TEXT,
    runtime_min    INTEGER,            -- movie runtime, or typical episode length for a show
    seasons        INTEGER,
    episodes       INTEGER,
    first_air_date TEXT,
    country        TEXT,
    fetched_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tmdb_episodes (    -- every episode of each matched show
    show_id     INTEGER NOT NULL,
    season      INTEGER NOT NULL,
    number      INTEGER NOT NULL,
    name        TEXT,
    runtime_min INTEGER,
    still_path  TEXT,
    air_date    TEXT,
    PRIMARY KEY (show_id, season, number)
);
CREATE TABLE IF NOT EXISTS show_parent (        -- "One Piece: East Blue" is really One Piece, arc East Blue
    show   TEXT PRIMARY KEY,
    parent TEXT NOT NULL,
    season TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS title_resolution (   -- how one-off titles were settled
    title    TEXT PRIMARY KEY,
    kind     TEXT NOT NULL,                     -- movie | episode
    show     TEXT,
    episode  TEXT
);
"""

Fetcher = Callable[[str, dict], dict]


class TmdbError(Exception):
    pass


def http_fetcher(token: str) -> Fetcher:
    def fetch(path: str, params: dict) -> dict:
        try:
            r = net.request("GET", API + path, params=params or None, headers={"Authorization": f"Bearer {token}"},
                            timeout=20, retries=4)
        except net.NetError as e:
            raise TmdbError(str(e)) from None
        if r.status == 401:
            raise TmdbError("TMDB rejected the token - save it again with python backend/cli.py secrets set TMDB_TOKEN "
                            "(use the API Read Access Token)")
        if r.status == 404:
            return {}
        if r.status == 429:
            raise TmdbError("TMDB kept rate-limiting; try again later")
        if not r.ok:
            raise TmdbError(f"TMDB HTTP {r.status}")
        return r.json({})
    return fetch


def img(path: str | None, size: str = "w342") -> str | None:
    return f"{IMG}{size}{path}" if path else None


_NORM = re.compile(r"[^0-9a-z]+")


def norm(s: str) -> str:
    return _NORM.sub(" ", s.lower().replace("&", "and")).strip()


def load_overrides(path: Path) -> dict:
    if not path.exists():
        return {"shows": {}, "movies": {}}
    with open(path, "rb") as f:
        data = tomllib.load(f)
    return {"shows": data.get("shows", {}), "movies": data.get("movies", {})}


class Matcher:
    def __init__(self, conn: sqlite3.Connection, fetch: Fetcher, overrides: dict | None = None,
                 language: str = "en-US"):
        self.conn = conn
        self.fetch = fetch
        self.overrides = overrides or {"shows": {}, "movies": {}}
        self.language = language
        self.requests = 0
        conn.executescript(SCHEMA)

    def _get(self, path: str, **params) -> dict:
        self.requests += 1
        return self.fetch(path, {"language": self.language, **params})

    def _cached(self, key: str) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM tmdb_titles WHERE query = ?", (key,)).fetchone()

    def _store(self, key: str, media: str, d: dict | None) -> None:
        now = datetime.now(timezone.utc).isoformat()
        if not d:
            self.conn.execute("INSERT OR REPLACE INTO tmdb_titles (query, media_type, fetched_at) VALUES (?, 'none', ?)",
                              (key, now))
            return
        if media == "tv":
            runs = d.get("episode_run_time") or []
            runtime = round(sum(runs) / len(runs)) if runs else (d.get("last_episode_to_air") or {}).get("runtime")
            name, date_ = d.get("name"), d.get("first_air_date")
            country = (d.get("origin_country") or [None])[0]
        else:
            runtime, name, date_ = d.get("runtime"), d.get("title"), d.get("release_date")
            country = ((d.get("production_countries") or [{}])[0]).get("iso_3166_1")
        self.conn.execute(
            "INSERT OR REPLACE INTO tmdb_titles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (key, media, d.get("id"), name, (date_ or "")[:4] or None, d.get("poster_path"), d.get("backdrop_path"),
             json.dumps([g["name"] for g in d.get("genres", [])]), d.get("overview"), runtime or None,
             d.get("number_of_seasons"), d.get("number_of_episodes"), date_ or None, country, now))

    def _search(self, media: str, query: str) -> dict | None:
        """Best search hit: an exact (normalized) name match if any, else the top result."""
        res = self._get(f"search/{media}", query=query).get("results", [])
        if not res:
            return None
        field = "name" if media == "tv" else "title"
        exact = [r for r in res if norm(r.get(field, "")) == norm(query)
                 or norm(r.get("original_" + field, "")) == norm(query)]
        return (exact or res)[0] | {"_exact": bool(exact)}

    def _details(self, media: str, tmdb_id: int) -> dict:
        return self._get(f"{media}/{tmdb_id}")

    def match(self, media: str, query: str) -> sqlite3.Row:
        """Look up a show (media='tv') or movie by name, cached."""
        key = f"{media}|{norm(query)}"
        hit = self._cached(key)
        if hit:
            return hit
        forced = self.overrides["shows" if media == "tv" else "movies"].get(query)
        if forced == 0:
            self._store(key, media, None)
        else:
            tmdb_id = forced or (self._search(media, query) or {}).get("id")
            self._store(key, media, self._details(media, tmdb_id) if tmdb_id else None)
        self.conn.commit()
        return self._cached(key)

    def ensure_episodes(self, show: sqlite3.Row) -> int:
        """Fetch every season's episode list for a matched show once (runtimes + screenshots).
        Also sets the show's typical episode length to the real average."""
        sid = show["tmdb_id"]
        if self.conn.execute("SELECT 1 FROM tmdb_episodes WHERE show_id = ? LIMIT 1", (sid,)).fetchone():
            return 0
        rows = []
        for n in range(1, (show["seasons"] or 0) + 1):
            for ep in self._get(f"tv/{sid}/season/{n}").get("episodes", []):
                rows.append((sid, n, ep.get("episode_number"), ep.get("name"), ep.get("runtime"),
                             ep.get("still_path"), ep.get("air_date")))
        if not rows:  # no season data: remember that, so we don't ask again
            rows = [(sid, 0, 0, None, None, None, None)]
        self.conn.executemany("INSERT OR REPLACE INTO tmdb_episodes VALUES (?,?,?,?,?,?,?)", rows)
        runs = [r[4] for r in rows if r[4]]
        if runs:
            self.conn.execute("UPDATE tmdb_titles SET runtime_min = ? WHERE query = ?",
                              (round(sum(runs) / len(runs)), show["query"]))
        self.conn.commit()
        return len(rows)

    def parent_of(self, show: str, row: sqlite3.Row) -> tuple[str, str] | None:
        """Netflix names some seasons after an arc or subtitle ("One Piece: East Blue",
        "Is It Cake?: Is It Cake, Too?"), which then looks like its own show. When such a name has
        no exact TMDB match but a shorter prefix does, that prefix is the show and the rest is the
        season. Returns (parent, season) or None. Shows named in overrides are left alone."""
        if ": " not in show or show in self.overrides["shows"]:
            return None
        if row["media_type"] == "tv" and norm(row["name"] or "") == norm(show):
            return None
        head, rest = show, []
        while ": " in head:
            head, tail = head.rsplit(": ", 1)
            rest.insert(0, tail)
            p = self.match("tv", head)
            if p["media_type"] == "tv" and norm(p["name"] or "") == norm(head):
                self.ensure_episodes(p)
                return head, ": ".join(rest)
        return None

    def resolve_unknown(self, title: str) -> tuple[str, str | None, str | None]:
        """A one-off title with a colon: movie, or an episode of a show? Returns (kind, show, episode)."""
        found = self.conn.execute("SELECT kind, show, episode FROM title_resolution WHERE title = ?", (title,)).fetchone()
        if found:
            return found["kind"], found["show"], found["episode"]
        if title in self.overrides["movies"]:
            kind, show, ep = "movie", None, None
        else:
            movie = self._search("movie", title)
            show_name, _, ep_name = title.rpartition(": ")
            tv = self._search("tv", show_name) if show_name else None
            if movie and movie["_exact"]:
                kind, show, ep = "movie", None, None
            elif tv and tv["_exact"]:
                kind, show, ep = "episode", show_name, ep_name
            else:
                kind, show, ep = "movie", None, None
        self.conn.execute("INSERT OR REPLACE INTO title_resolution VALUES (?,?,?,?)", (title, kind, show, ep))
        self.conn.commit()
        return kind, show, ep


_EP_NUM = re.compile(r"^episode\s+(\d+)$", re.I)
_SEASON_NUM = re.compile(r"^season\s+(\d+)$", re.I)


def episode_lookup(conn: sqlite3.Connection) -> Callable[[int, str | None, str | None], sqlite3.Row | None]:
    """Find TMDB's episode for a Netflix (season, episode title): by name, else "Season N" + "Episode M"."""
    by_name: dict[tuple[int, str], sqlite3.Row] = {}
    by_season_name: dict[tuple[int, int, str], sqlite3.Row] = {}
    by_num: dict[tuple[int, int, int], sqlite3.Row] = {}
    for r in conn.execute("SELECT * FROM tmdb_episodes WHERE season > 0 ORDER BY season, number"):
        if r["name"]:
            by_name.setdefault((r["show_id"], norm(r["name"])), r)
            by_season_name[(r["show_id"], r["season"], norm(r["name"]))] = r
        by_num[(r["show_id"], r["season"], r["number"])] = r

    def find(show_id: int, season: str | None, episode: str | None) -> sqlite3.Row | None:
        if not episode:
            return None
        s = _SEASON_NUM.match((season or "").strip())
        if s:  # season known: look inside it first (shows reuse names like "Episode 1" every season)
            n = int(s.group(1))
            hit = by_season_name.get((show_id, n, norm(episode)))
            e = _EP_NUM.match(episode.strip())
            if not hit and e:
                hit = by_num.get((show_id, n, int(e.group(1))))
            if hit:
                return hit
        return by_name.get((show_id, norm(episode)))
    return find


def enrich(conn: sqlite3.Connection, fetch: Fetcher, overrides: dict | None = None,
           progress: Callable[[str], None] = lambda s: None) -> dict:
    """Resolve one-off titles, then match every show and movie. Safe to rerun (all cached)."""
    m = Matcher(conn, fetch, overrides)
    unknown = [r[0] for r in conn.execute("SELECT DISTINCT title FROM views WHERE kind = 'unknown'")]
    for t in unknown:
        m.resolve_unknown(t)
    shows = {r[0] for r in conn.execute("SELECT DISTINCT show FROM views WHERE kind = 'episode' AND show IS NOT NULL")}
    shows.discard(UNKNOWN_SHOW)
    shows |= {r[0] for r in conn.execute("SELECT show FROM title_resolution WHERE kind = 'episode'")}
    movies = {r[0] for r in conn.execute("SELECT DISTINCT title FROM views WHERE kind = 'movie'")}
    movies |= {r[0] for r in conn.execute("SELECT title FROM title_resolution WHERE kind = 'movie'")}
    found = {"tv": 0, "movie": 0}
    parents: list[tuple[str, str, str]] = []
    for i, s in enumerate(sorted(shows)):
        progress(f"show {i + 1}/{len(shows)}: {s}")
        row = m.match("tv", s)
        parent = m.parent_of(s, row)
        if parent:
            parents.append((s, *parent))
            found["tv"] += 1
        elif row["media_type"] == "tv":
            found["tv"] += 1
            m.ensure_episodes(row)
    for i, t in enumerate(sorted(movies)):
        progress(f"movie {i + 1}/{len(movies)}: {t}")
        found["movie"] += m.match("movie", t)["media_type"] == "movie"
    conn.execute("DELETE FROM show_parent")
    conn.executemany("INSERT INTO show_parent VALUES (?, ?, ?)", parents)
    conn.commit()
    return {"shows": len(shows), "shows_found": found["tv"], "merged": len(parents), "movies": len(movies), "movies_found": found["movie"],
            "one_offs": len(unknown), "requests": m.requests}
