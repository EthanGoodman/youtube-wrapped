"""Enrich watched videos and channels with the YouTube Data API v3.

Every response is cached in SQLite right away, so a run can stop at any point
(quota, Ctrl+C, network) and the next run continues with whatever is left.
IDs the API does not return are stored as status='missing' and never refetched
unless asked.
"""
from __future__ import annotations

import json
import re
import sqlite3
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Iterable
from zoneinfo import ZoneInfo

from ... import net
from .parser import clean_text

API_BASE = "https://www.googleapis.com/youtube/v3/"
PACIFIC = ZoneInfo("America/Los_Angeles")
_VALID_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_DURATION_RE = re.compile(
    r"^P(?:(?P<w>\d+)W)?(?:(?P<d>\d+)D)?(?:T(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+(?:\.\d+)?)S)?)?$")


class QuotaExceeded(Exception):
    pass


class ApiKeyError(Exception):
    pass


class ApiError(Exception):
    pass


def parse_duration(iso: str | None) -> int | None:
    """ISO 8601 duration -> seconds. None for missing/unparseable; 0 for P0D (ongoing live)."""
    if not iso:
        return None
    m = _DURATION_RE.match(iso)
    if not m or iso in ("P", "PT"):
        return None
    g = {k: float(v) if v else 0.0 for k, v in m.groupdict().items()}
    return int(g["w"] * 604800 + g["d"] * 86400 + g["h"] * 3600 + g["m"] * 60 + g["s"])


def topic_name(url: str) -> str:
    """'https://en.wikipedia.org/wiki/Action_game' -> 'Action game'"""
    return urllib.parse.unquote(url.rsplit("/", 1)[-1]).replace("_", " ")


def _best_thumb(thumbs: dict, order: Iterable[str]) -> str | None:
    for k in order:
        if thumbs.get(k, {}).get("url"):
            return thumbs[k]["url"]
    return None


def _int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ HTTP

Fetcher = Callable[[str, dict], dict]


def http_fetch(endpoint: str, params: dict) -> dict:
    """GET an API endpoint. Raises QuotaExceeded / ApiKeyError / ApiError."""
    try:
        r = net.request("GET", API_BASE + endpoint, params=params)
    except net.NetError as e:
        raise ApiError(str(e)) from None
    body = r.json({})
    if r.ok:
        return body
    err = body.get("error", {}) if isinstance(body, dict) else {}
    err = err if isinstance(err, dict) else {}
    reasons = {x.get("reason") for x in err.get("errors", []) if isinstance(x, dict)}
    msg = err.get("message") or f"HTTP {r.status}"
    if reasons & {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"}:
        raise QuotaExceeded(msg)
    if r.status in (400, 403) and (reasons & {"keyInvalid", "accessNotConfigured", "forbidden",
                                              "ipRefererBlocked", "keyExpired"} or "API key" in msg):
        raise ApiKeyError(msg)
    raise ApiError(f"HTTP {r.status}: {msg}")


# ------------------------------------------------------------------ quota

def quota_day(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(PACIFIC).strftime("%Y-%m-%d")


def units_used_today(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT COALESCE(SUM(units), 0) FROM api_calls WHERE quota_day=?",
                       (quota_day(),)).fetchone()
    return row[0]


def _log_call(conn, endpoint: str, n_ids: int, status: str) -> None:
    conn.execute("INSERT INTO api_calls(called_at, quota_day, endpoint, units, n_ids, status) "
                 "VALUES (?, ?, ?, 1, ?, ?)",
                 (datetime.now(timezone.utc).isoformat(), quota_day(), endpoint, n_ids, status))


# ------------------------------------------------------------------ row mapping

def video_row(item: dict, now: str) -> tuple:
    sn = item.get("snippet", {})
    cd = item.get("contentDetails", {})
    st = item.get("statistics", {})
    td = item.get("topicDetails", {})
    thumbs = sn.get("thumbnails", {})
    return (
        item["id"], "ok", now, clean_text(sn.get("title")), sn.get("channelId"),
        clean_text(sn.get("channelTitle")),
        sn.get("publishedAt"), cd.get("duration"), parse_duration(cd.get("duration")),
        sn.get("liveBroadcastContent"), 1 if "liveStreamingDetails" in item else 0,
        sn.get("categoryId"), json.dumps(sn.get("tags", []), ensure_ascii=False),
        json.dumps(sorted({topic_name(u) for u in td.get("topicCategories", [])})),
        _best_thumb(thumbs, ("medium", "high", "default")),
        _best_thumb(thumbs, ("maxres", "standard", "high", "medium", "default")),
        _int(st.get("viewCount")), _int(st.get("likeCount")),
        _int(item.get("player", {}).get("embedWidth")), _int(item.get("player", {}).get("embedHeight")),
    )


def channel_row(item: dict, now: str) -> tuple:
    sn = item.get("snippet", {})
    st = item.get("statistics", {})
    td = item.get("topicDetails", {})
    subs = None if st.get("hiddenSubscriberCount") else _int(st.get("subscriberCount"))
    return (
        item["id"], "ok", now, clean_text(sn.get("title")), sn.get("customUrl"),
        _best_thumb(sn.get("thumbnails", {}), ("medium", "high", "default")),
        subs, _int(st.get("videoCount")), _int(st.get("viewCount")), sn.get("country"),
        sn.get("publishedAt"),
        json.dumps(sorted({topic_name(u) for u in td.get("topicCategories", [])})),
    )


VIDEO_COLS = ("video_id, status, fetched_at, title, channel_id, channel_title, published_at, "
              "duration_raw, duration_s, live, was_live, category_id, tags, topics, thumb_small, "
              "thumb_large, view_count, like_count, embed_w, embed_h")
VIDEO_PARTS = "snippet,contentDetails,statistics,topicDetails,liveStreamingDetails,player"
PLAYER_PARAMS = {"maxHeight": 1000}  # makes the API report the video's real aspect ratio
CHANNEL_COLS = ("channel_id, status, fetched_at, title, handle, avatar_url, subscriber_count, "
                "video_count, view_count, country, created_at, topics")


# ------------------------------------------------------------------ work lists

def pending_video_ids(conn: sqlite3.Connection, include_ads: bool, retry_missing: bool) -> list[str]:
    """IDs still to fetch, in priority order: watched, unavailable, ads."""
    done_filter = "status='ok'" if retry_missing else "1=1"
    done = {r[0] for r in conn.execute(f"SELECT video_id FROM videos WHERE {done_filter}")}
    kinds = [("video", "music"), ("unavailable",)] + ([("ad",)] if include_ads else [])
    out, seen = [], set(done)
    for group in kinds:
        q = (f"SELECT video_id FROM entries WHERE kind IN ({','.join('?' * len(group))}) "
             f"AND video_id IS NOT NULL GROUP BY video_id ORDER BY MAX(epoch) DESC")
        for (vid,) in conn.execute(q, group):
            if vid not in seen and _VALID_ID.match(vid):
                seen.add(vid)
                out.append(vid)
    return out


def pending_channel_ids(conn: sqlite3.Connection, retry_missing: bool) -> list[str]:
    done_filter = "status='ok'" if retry_missing else "1=1"
    done = {r[0] for r in conn.execute(f"SELECT channel_id FROM channels WHERE {done_filter}")}
    ids = [r[0] for r in conn.execute(
        "SELECT channel_id FROM entries WHERE kind IN ('video','music') AND channel_id IS NOT NULL "
        "UNION SELECT channel_id FROM videos WHERE status='ok' AND channel_id IS NOT NULL")]
    return sorted(c for c in ids if c not in done and c.startswith("UC") and _VALID_ID.match(c))


# ------------------------------------------------------------------ runner

@dataclass
class EnrichResult:
    videos_ok: int = 0
    videos_missing: int = 0
    channels_ok: int = 0
    channels_missing: int = 0
    categories: int = 0
    shapes: int = 0  # short videos whose aspect ratio was backfilled
    units: int = 0
    stopped: str | None = None  # reason if stopped early
    videos_left: int = 0
    channels_left: int = 0


class Enricher:
    def __init__(self, conn: sqlite3.Connection, api_key: str, fetch: Fetcher = http_fetch,
                 budget: int = 9500, batch_size: int = 50, progress: Callable | None = None):
        self.conn = conn
        self.key = api_key
        self.fetch = fetch
        self.budget = budget
        self.batch = min(50, batch_size)
        self.progress = progress  # progress(total, desc) -> object with update(n) and close()
        self.res = EnrichResult()

    def _call(self, endpoint: str, params: dict, n_ids: int) -> dict:
        if units_used_today(self.conn) >= self.budget:
            raise QuotaExceeded(f"daily budget of {self.budget} units reached")
        try:
            data = self.fetch(endpoint, {**params, "key": self.key})
        except QuotaExceeded:
            _log_call(self.conn, endpoint, n_ids, "error:quota")
            self.conn.commit()
            raise
        except (ApiError, ApiKeyError) as e:
            _log_call(self.conn, endpoint, n_ids, f"error:{type(e).__name__}")
            self.conn.commit()
            raise
        _log_call(self.conn, endpoint, n_ids, "ok")
        self.res.units += 1
        return data

    def _run_batches(self, ids: list[str], endpoint: str, part: str, cols: str, row_fn,
                     table: str, key_col: str, desc: str, extra: dict | None = None) -> None:
        """Fetch ids in batches; counts go to self.res.<desc>_ok / <desc>_missing as we go."""
        bar = self.progress(len(ids), desc) if self.progress and ids else None
        try:
            for i in range(0, len(ids), self.batch):
                chunk = ids[i:i + self.batch]
                data = self._call(endpoint, {"part": part, "id": ",".join(chunk),
                                             "maxResults": self.batch, **(extra or {})}, len(chunk))
                now = datetime.now(timezone.utc).isoformat()
                rows = [row_fn(it, now) for it in data.get("items", [])]
                got = {r[0] for r in rows}
                gone = [c for c in chunk if c not in got]
                ph = ",".join("?" * len(cols.split(",")))
                self.conn.executemany(f"INSERT OR REPLACE INTO {table} ({cols}) VALUES ({ph})", rows)
                self.conn.executemany(
                    f"INSERT OR REPLACE INTO {table} ({key_col}, status, fetched_at) VALUES (?, 'missing', ?)",
                    ((g, now) for g in gone))
                self.conn.commit()
                setattr(self.res, f"{desc}_ok", getattr(self.res, f"{desc}_ok") + len(rows))
                setattr(self.res, f"{desc}_missing", getattr(self.res, f"{desc}_missing") + len(gone))
                if bar:
                    bar.update(len(chunk))
        finally:
            if bar:
                bar.close()

    def fetch_categories(self) -> None:
        if self.conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]:
            return
        data = self._call("videoCategories", {"part": "snippet", "regionCode": "US"}, 0)
        rows = [(it["id"], it["snippet"]["title"]) for it in data.get("items", [])]
        self.conn.executemany("INSERT OR REPLACE INTO categories VALUES (?, ?)", rows)
        self.conn.commit()
        self.res.categories = len(rows)

    def backfill_player(self, max_duration: int) -> None:
        """Fetch only the player part for short watched videos cached before it was requested."""
        ids = [r[0] for r in self.conn.execute(
            "SELECT v.video_id FROM videos v WHERE v.status='ok' AND v.embed_w IS NULL "
            "AND v.duration_s BETWEEN 1 AND ? AND EXISTS (SELECT 1 FROM entries e WHERE "
            "e.video_id=v.video_id AND e.kind IN ('video','music','unavailable'))", (max_duration,))]
        bar = self.progress(len(ids), "shapes") if self.progress and ids else None
        try:
            for i in range(0, len(ids), self.batch):
                chunk = ids[i:i + self.batch]
                data = self._call("videos", {"part": "player", "id": ",".join(chunk), **PLAYER_PARAMS},
                                  len(chunk))
                got = {it["id"]: it.get("player", {}) for it in data.get("items", [])}
                self.conn.executemany("UPDATE videos SET embed_w=?, embed_h=? WHERE video_id=?", (
                    (_int(got[v].get("embedWidth")) if v in got else -1,
                     _int(got[v].get("embedHeight")) if v in got else -1, v) for v in chunk))
                self.conn.commit()
                self.res.shapes += len(chunk)
                if bar:
                    bar.update(len(chunk))
        finally:
            if bar:
                bar.close()

    def run(self, include_ads: bool = True, retry_missing: bool = False,
            shorts_max_duration: int | None = 180) -> EnrichResult:
        r = self.res
        try:
            self.fetch_categories()
            vids = pending_video_ids(self.conn, include_ads, retry_missing)
            self._run_batches(
                vids, "videos", VIDEO_PARTS, VIDEO_COLS, video_row, "videos", "video_id", "videos",
                extra=PLAYER_PARAMS)
            chans = pending_channel_ids(self.conn, retry_missing)
            self._run_batches(
                chans, "channels", "snippet,statistics,topicDetails",
                CHANNEL_COLS, channel_row, "channels", "channel_id", "channels")
            if shorts_max_duration:
                self.backfill_player(shorts_max_duration)
        except QuotaExceeded as e:
            r.stopped = f"quota: {e}"
        except KeyboardInterrupt:
            r.stopped = "interrupted"
        r.videos_left = len(pending_video_ids(self.conn, include_ads, False))
        r.channels_left = len(pending_channel_ids(self.conn, False))
        return r


def coverage(conn: sqlite3.Connection) -> dict:
    q = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
    return {
        "watched_ids": q("SELECT COUNT(DISTINCT video_id) FROM entries WHERE kind IN ('video','music','unavailable')"),
        "watched_ok": q("SELECT COUNT(DISTINCT e.video_id) FROM entries e JOIN videos v USING(video_id) "
                        "WHERE e.kind IN ('video','music','unavailable') AND v.status='ok'"),
        "unavailable_recovered": q("SELECT COUNT(DISTINCT e.video_id) FROM entries e JOIN videos v USING(video_id) "
                                   "WHERE e.kind='unavailable' AND v.status='ok'"),
        "videos_missing": q("SELECT COUNT(*) FROM videos WHERE status='missing'"),
        "channels_ok": q("SELECT COUNT(*) FROM channels WHERE status='ok'"),
        "units_today": units_used_today(conn),
        "units_total": q("SELECT COALESCE(SUM(units),0) FROM api_calls"),
    }
