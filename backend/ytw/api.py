"""HTTP API for the dashboard, plus the built frontend.

Every stats endpoint takes the same query parameters:
    range   4w | 6m | this_year | all | custom | <year>     (default: all)
    start, end   YYYY-MM-DD, for range=custom
    buckets comma list of long,short,music                  (default: all three)
    bg      1 = exclude background audio from watch time    (default: 1)
    metric  count | time                                    (ranking order, default: count)
Responses are cached in memory until the database is rebuilt.
"""
from __future__ import annotations

import re
import sqlite3
import threading
from collections import OrderedDict
from datetime import date, datetime
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, HTTPException, Request
import tomllib

from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import db, images, platforms
from .config import Config
from .stats import ads, details, evolution, overview, patterns, records, search, shows, tops
from .stats.common import ALL_BUCKETS, Filters, Range, data_bounds, resolve_range
from .wrapped import (MODES as WRAPPED_MODES, METRICS as YT_METRICS, NETFLIX_METRICS, load_personalities,
                      netflix_wrapped, personalities_file, wrapped as wrapped_data)

TOP_KINDS: dict[str, Callable] = {
    "channels": tops.top_channels, "videos": tops.top_videos, "categories": tops.top_categories,
    "genres": tops.top_genres, "tags": tops.top_tags, "artists": tops.top_artists, "songs": tops.top_songs,
    "movies": shows.top_movies,
}
SHOW_KINDS: dict[str, Callable] = {
    "progress": lambda c, r, f, n: shows.progress(c, r, f, n),
    "binges": lambda c, r, f, n: shows.binges(c, r, f, min(n, 50)),
    "days": lambda c, r, f, n: shows.episode_days(c, r, f, min(n, 20)),
    "rewatches": lambda c, r, f, n: shows.rewatches(c, r, f, n),
    "split": lambda c, r, f, n: shows.split(c, r, f),
    "home": lambda c, r, f, n: shows.home(c, r, f),
}
PATTERN_KINDS: dict[str, Callable] = {
    "clock": patterns.clock, "heatmap": patterns.heatmap, "calendar": patterns.calendar,
    "monthly": patterns.monthly, "weekday_weekend": patterns.weekday_weekend,
}


class ResultCache:
    """Small LRU cache keyed by request; cleared whenever the database build changes."""

    def __init__(self, size: int = 512):
        self.size = size
        self.data: OrderedDict = OrderedDict()
        self.stamp: str | None = None
        self.lock = threading.Lock()

    def get_or_compute(self, stamp: str | None, key: tuple, fn: Callable):
        with self.lock:
            if stamp != self.stamp:
                self.data.clear()
                self.stamp = stamp
            if key in self.data:
                self.data.move_to_end(key)
                return self.data[key]
        value = fn()
        with self.lock:
            self.data[key] = value
            if len(self.data) > self.size:
                self.data.popitem(last=False)
        return value


def create_app(cfg: Config, db_path: Path | None = None, static_dir: Path | None = None,
               db_paths: dict[str, Path] | None = None) -> FastAPI:
    """db_path / db_paths override where a platform's database is (tests); default data/<platform>.db."""
    overrides = dict(db_paths or {})
    if db_path:
        overrides.setdefault(platforms.DEFAULT, db_path)
    app = FastAPI(title="YouTube Wrapped", docs_url="/api/docs", openapi_url="/api/openapi.json")
    caches: dict[str, ResultCache] = {}
    local = threading.local()

    def path_for(platform_id: str) -> Path:
        return overrides.get(platform_id, cfg.platform_db(platform_id))

    def platform_of(request: Request) -> platforms.Platform:
        """?platform=<id> (default youtube). Unknown -> 404; not built yet -> 404 with a hint."""
        pid = request.query_params.get("platform", platforms.DEFAULT)
        p = platforms.get(pid)
        if p is None:
            raise HTTPException(404, f"unknown platform: {pid}")
        if not p.implemented:
            raise HTTPException(404, f"{p.name} isn't supported yet" + (f" (issue #{p.issue})" if p.issue else ""))
        return p

    def conn(request: Request) -> sqlite3.Connection:
        """Read-only connection to the request's platform database (one per thread per platform)."""
        p = platform_of(request)
        conns = getattr(local, "conns", None)
        if conns is None:
            conns = local.conns = {}
        c = conns.get(p.id)
        if c is None:
            path = path_for(p.id)
            if not path.exists():
                raise HTTPException(503, f"No {p.name} data yet. Run `python backend/cli.py ingest --platform {p.id}`.")
            c = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
            c.row_factory = sqlite3.Row
            conns[p.id] = c
        return c

    def require(request: Request, capability: str) -> None:
        p = platform_of(request)
        if not p.has(capability):
            raise HTTPException(404, f"{p.name} has no {capability} data")

    def today() -> date:
        return datetime.now(cfg.tz).date()

    def parse(request: Request) -> tuple[Range, Filters]:
        q = request.query_params
        try:
            r = resolve_range(conn(request), q.get("range", "all"), q.get("start"), q.get("end"), today())
            buckets = tuple(b for b in q.get("buckets", ",".join(ALL_BUCKETS)).split(",") if b)
            f = Filters(buckets=buckets, exclude_bg_time=q.get("bg", "1") != "0",
                        metric=q.get("metric", "count"))
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        return r, f

    def cache_for(request: Request) -> ResultCache:
        return caches.setdefault(platform_of(request).id, ResultCache())

    def cached(request: Request, fn: Callable):
        stamp = db.get_meta(conn(request), "built_at")
        key = (request.url.path, tuple(sorted(request.query_params.multi_items())))
        return cache_for(request).get_or_compute(stamp, key, fn)

    def limit(request: Request, default: int = 50) -> int:
        try:
            return max(1, min(int(request.query_params.get("limit", default)), 1000))
        except ValueError:
            raise HTTPException(400, "limit must be a number") from None

    # ------------------------------------------------------------------ meta

    @app.get("/api/platforms")
    def get_platforms():
        """Every platform, with a headline for the ones that have data (for the hub page)."""
        out = []
        for p in platforms.PLATFORMS.values():
            d = p.to_dict()
            d["has_data"] = False
            path = path_for(p.id)
            if p.implemented and path.exists():
                try:
                    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
                    try:
                        extra = c.execute("SELECT value FROM meta WHERE key = 'extra_capabilities'").fetchone()
                        d.update(p.with_extra(extra[0] if extra else None).to_dict())
                        n, est, first, last = c.execute(
                            "SELECT COUNT(*), SUM(CASE WHEN is_background = 1 THEN 0 ELSE est_s END), "
                            "MIN(local_date), MAX(local_date) FROM watches").fetchone()
                    finally:
                        c.close()
                    d.update(has_data=bool(n), items=n, est_s=est or 0, first_date=first, last_date=last)
                except sqlite3.Error:
                    pass
            out.append(d)
        return out

    @app.get("/api/meta")
    def meta(request: Request):
        c = conn(request)
        p = platform_of(request).with_extra(db.get_meta(c, "extra_capabilities"))
        has_table = lambda t: c.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (t,)).fetchone()  # noqa: E731
        bounds = data_bounds(c)
        q = lambda sql: c.execute(sql).fetchone()[0]  # noqa: E731
        w = cfg.section("watchtime")
        return {
            "timezone": cfg.tz.key,
            "today": today().isoformat(),
            "first_date": bounds[0].isoformat() if bounds else None,
            "last_date": bounds[1].isoformat() if bounds else None,
            "years": [r[0] for r in c.execute("SELECT DISTINCT year FROM watches ORDER BY 1")],
            "watches": q("SELECT COUNT(*) FROM watches"),
            "platform": p.to_dict(),
            "enriched": q("SELECT COUNT(*) FROM items WHERE status='ok'") > 0,
            "has_music": q("SELECT COUNT(*) FROM watches WHERE bucket='music'") > 0,
            "by_bucket": dict(c.execute("SELECT bucket, COUNT(*) FROM watches GROUP BY bucket").fetchall()),
            "has_search": p.has("search") and bool(has_table("searches"))
                          and q("SELECT COUNT(*) FROM searches WHERE kind='search'") > 0,
            "built_at": db.get_meta(c, "built_at"),
            "watchtime": {
                "session_gap_minutes": w.get("session_gap_minutes", 30),
                "max_seconds_per_video": w.get("max_seconds_per_video", 10800),
                "unknown_duration_fallback_seconds": w.get("unknown_duration_fallback_seconds", 600),
                "max_possible_cap_seconds": w.get("max_possible_cap_seconds", 43200),
            },
        }

    # ------------------------------------------------------------------ stats

    @app.get("/api/overview")
    def get_overview(request: Request):
        r, f = parse(request)
        return cached(request, lambda: overview.overview(conn(request), r, f))

    @app.get("/api/recent")
    def get_recent(request: Request):
        _, f = parse(request)
        off = int(request.query_params.get("offset", 0))
        return cached(request, lambda: overview.recent(conn(request), f, limit(request, 20), off))

    @app.get("/api/top/{kind}")
    def get_top(kind: str, request: Request):
        if kind not in TOP_KINDS:
            raise HTTPException(404, f"unknown list: {kind}")
        r, f = parse(request)
        return cached(request, lambda: {"range": r.to_dict(), "metric": f.metric,
                                        "items": TOP_KINDS[kind](conn(request), r, f, limit(request))})

    @app.get("/api/patterns/{kind}")
    def get_pattern(kind: str, request: Request):
        if kind not in PATTERN_KINDS:
            raise HTTPException(404, f"unknown pattern: {kind}")
        r, f = parse(request)
        return cached(request, lambda: {"range": r.to_dict(), "data": PATTERN_KINDS[kind](conn(request), r, f)})

    @app.get("/api/records")
    def get_records(request: Request):
        r, f = parse(request)
        return cached(request, lambda: {"range": r.to_dict(), **records.records(conn(request), r, f, today())})

    @app.get("/api/milestones")
    def get_milestones(request: Request):
        _, f = parse(request)
        return cached(request, lambda: records.milestones(conn(request), f))

    @app.get("/api/evolution/{kind}")
    def get_evolution(kind: str, request: Request):
        r, f = parse(request)
        c = conn(request)
        fns = {
            "top_per_year": lambda: evolution.top_channel_per_year(c, f),
            "bar_race": lambda: evolution.bar_race(c, r, f, limit(request, 10)),
            "discoveries": lambda: evolution.new_discoveries(c, r, f, limit(request, 30)),
            "loyalty": lambda: evolution.loyalty(c, f, limit=limit(request, 30)),
            "fell_off": lambda: evolution.fell_off(c, f, limit=limit(request, 30)),
            "mix": lambda: evolution.mix_by_year(c, f, request.query_params.get("by", "category")),
        }
        if kind not in fns:
            raise HTTPException(404, f"unknown evolution view: {kind}")
        try:
            return cached(request, fns[kind])
        except ValueError as e:
            raise HTTPException(400, str(e)) from None

    @app.get("/api/shows/{kind}")
    def get_shows(kind: str, request: Request):
        require(request, "series")
        if kind not in SHOW_KINDS:
            raise HTTPException(404, f"unknown show stat: {kind}")
        r, f = parse(request)
        n = limit(request, 10 if kind in ("binges", "days") else 50)
        return cached(request, lambda: {"range": r.to_dict(), "data": SHOW_KINDS[kind](conn(request), r, f, n)})

    @app.get("/api/ads")
    def get_ads(request: Request):
        require(request, "ads")
        r, _ = parse(request)
        return cached(request, lambda: {"range": r.to_dict(), **ads.ads(conn(request), r)})

    @app.get("/api/search")
    def get_search(request: Request):
        require(request, "search")
        r, _ = parse(request)
        all_time = request.query_params.get("range", "all") == "all"
        return cached(request, lambda: {"range": r.to_dict(),
                                        **search.search_stats(conn(request), r, limit(request, 30), all_time)})

    # ------------------------------------------------------------------ details

    def _or_404(value, what: str):
        if value is None:
            raise HTTPException(404, f"{what} not found")
        return value

    @app.get("/api/channel/{channel_id}")
    def get_channel(channel_id: str, request: Request):
        r, f = parse(request)
        return _or_404(cached(request, lambda: details.channel(conn(request), channel_id, r, f)), "channel")

    @app.get("/api/video/{video_id}")
    def get_video(video_id: str, request: Request):
        return _or_404(cached(request, lambda: details.video(conn(request), video_id)), "video")

    @app.get("/api/category/{category_id}")
    def get_category(category_id: str, request: Request):
        r, f = parse(request)
        return _or_404(cached(request, lambda: details.category(conn(request), category_id, r, f)), "category")

    @app.get("/api/genre/{topic:path}")
    def get_genre(topic: str, request: Request):
        r, f = parse(request)
        return _or_404(cached(request, lambda: details.genre(conn(request), topic, r, f)), "genre")

    @app.get("/api/year/{year}")
    def get_year(year: int, request: Request):
        _, f = parse(request)
        return cached(request, lambda: details.year(conn(request), year, f, today()))

    # ------------------------------------------------------------------ wrapped

    @app.get("/api/wrapped/{year}")
    def get_wrapped(year: int, request: Request):
        _, f = parse(request)
        p = platform_of(request)
        personalities_path = personalities_file(cfg.root, p.id)
        try:
            mtime = personalities_path.stat().st_mtime
            pcfg = load_personalities(personalities_path, NETFLIX_METRICS if p.id == "netflix" else YT_METRICS)
        except FileNotFoundError:
            mtime, pcfg = 0, {}
        except (ValueError, tomllib.TOMLDecodeError) as e:
            raise HTTPException(500, f"{personalities_path.name}: {e}") from None
        stamp = db.get_meta(conn(request), "built_at")
        key = (request.url.path, tuple(sorted(request.query_params.multi_items())), mtime)
        mode = request.query_params.get("mode", "all")
        if mode not in WRAPPED_MODES:
            raise HTTPException(400, f"mode must be one of {', '.join(WRAPPED_MODES)}")
        if p.id == "netflix":
            return cache_for(request).get_or_compute(stamp, key, lambda: netflix_wrapped(
                conn(request), year, f, pcfg, today(), p.has("time_of_day")))
        return cache_for(request).get_or_compute(stamp, key, lambda: wrapped_data(conn(request), year, f, pcfg, today(), mode))

    @app.get("/api/img")
    def get_image(u: str):
        """Relay a YouTube thumbnail/avatar so the browser can export Wrapped cards as PNG
        (images from other origins can't be drawn into an exportable canvas).
        Only YouTube's image hosts are allowed: this is not an open proxy."""
        try:
            data, ctype = images.fetch(u)
        except images.NotAllowed as e:
            raise HTTPException(400, str(e)) from None
        except images.FetchFailed as e:
            raise HTTPException(502, str(e)) from None
        return Response(content=data, media_type=ctype, headers={"Cache-Control": "public, max-age=604800"})

    @app.exception_handler(sqlite3.OperationalError)
    def db_error(_request, exc):
        return JSONResponse({"detail": f"database error: {exc}. Try `python backend/cli.py build`."},
                            status_code=500)

    # ------------------------------------------------------------------ frontend

    static_dir = static_dir or cfg.root / "frontend" / "dist"

    @app.get("/api/build")
    def get_build():
        """Which frontend build the server is handing out (the main script's hashed name), so an
        open tab still running an older build can notice and reload itself."""
        try:
            m = re.search(r'src="(/assets/index-[^"]+\.js)"', (static_dir / "index.html").read_text(encoding="utf-8"))
        except OSError:
            m = None
        return {"build": m.group(1) if m else None}

    if static_dir.exists():
        app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
            file = static_dir / path
            if path and file.is_file() and static_dir in file.resolve().parents:
                return FileResponse(file)
            # always recheck the page so a rebuilt frontend shows up on a normal refresh
            # (the hashed files under /assets it points to can be cached forever)
            return FileResponse(static_dir / "index.html", headers={"Cache-Control": "no-cache"})

    return app
