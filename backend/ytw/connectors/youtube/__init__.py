"""YouTube: Google Takeout watch + search history, enriched from the YouTube Data API."""
from __future__ import annotations

import time
from pathlib import Path

from ... import db, secrets
from ...imports import Source, locate
from ..base import Connector, ConnectorError, Manifest, finish_build, vocab

MANIFEST = Manifest(
    "youtube", "YouTube", True, "youtube", vocab("channel", "channels", "video", "videos"),
    frozenset({"shorts", "music", "ads", "search", "estimated_time", "time_of_day", "background",
               "categories", "genres", "tags"}),
    ("takeout.google.com → Deselect all → YouTube and YouTube Music",
     "All YouTube data included → only history; Multiple formats → History: JSON",
     "Put the Takeout .zip (or watch-history.json and search-history.json) in data/youtube/"),
    "minutes to hours",
    image_hosts=(("i.ytimg.com", "/"), ("i1.ytimg.com", "/"), ("i2.ytimg.com", "/"), ("i3.ytimg.com", "/"),
                 ("i4.ytimg.com", "/"), ("i9.ytimg.com", "/"), ("yt3.ggpht.com", "/"),
                 ("yt3.googleusercontent.com", "/")),
    auth="file", secrets=("YOUTUBE_API_KEY",), order=0)


class YouTube(Connector):
    manifest = MANIFEST

    def ingest(self, watch: str | None = None, search: str | None = None, **_) -> None:
        from .ingest import ingest_search_history, ingest_watch_history, kind_counts
        from .preroll import link_prerolls
        cfg, out = self.cfg, self.out
        conn = self.connect()
        db.init_db(conn)
        if cfg.tz.key != (db.get_meta(conn, "timezone") or cfg.tz.key):
            out(f"Timezone changed to {cfg.tz.key}; rebuilding entries.")
            conn.execute("DELETE FROM entries")
            conn.execute("DELETE FROM searches")

        t = time.perf_counter()
        history = self._read(watch, "watch-history.json")
        if history is None:
            raise ConnectorError(f"Not found: {watch or self.folder / 'watch-history.json'}\n"
                                 f"Put your Takeout watch-history.json (or the whole Takeout .zip) in {self.folder}")
        res = ingest_watch_history(conn, history, cfg.tz)
        out(f"Watch history: parsed {res['parsed']:,}, added {res['added']:,} new "
            f"({time.perf_counter() - t:.1f}s)")

        n = link_prerolls(conn, cfg.section("ads").get("preroll_window_seconds", 60))
        out(f"Pre-roll ads linked to a video: {n:,}")

        searches = self._read(search, "search-history.json")
        if searches is not None:
            res = ingest_search_history(conn, searches, cfg.tz)
            out(f"Search history: parsed {res['parsed']:,} ({res['searches']:,} real searches), "
                f"added {res['added']:,} new")
        else:
            out("Search history: not found (optional)")

        out("\nEntries by type:")
        for kind, n in kind_counts(conn).items():
            out(f"  {kind:<15}{n:>10,}")
        row = conn.execute("SELECT MIN(local_iso), MAX(local_iso) FROM entries").fetchone()
        out(f"\nRange: {row[0]}  ->  {row[1]}")
        self._derive(conn)
        conn.close()

    def _read(self, explicit: str | None, basename: str):
        """The export as parsed JSON: from --watch/--search, else data/youtube/<basename>, else
        inside a Takeout .zip there. None when it isn't anywhere."""
        if explicit:
            p = Path(explicit)
            if not p.is_file():
                return None
            src = Source(p)
            hits = src.find(basename) if src.kind == "zip" else src.names()
            if not hits:
                src.close()
                return None
            member = hits[0]
        else:
            found = locate(self.folder, basename)
            if found is None:
                return None
            src, member = found
        with src:
            return src.read_json(member)

    def _derive(self, conn) -> None:
        """Recompute derived tables (watch time, sessions, rollups)."""
        from .lookups import build_lookups
        from .watchtime import WatchConfig, build_watches
        t = time.perf_counter()
        n = build_watches(conn, WatchConfig.from_config(self.cfg), self.cfg.tz)
        tg = self.cfg.section("tags")
        nt, ng = build_lookups(conn, frozenset(tg.get("stopwords", [])), tg.get("min_videos", 2))
        finish_build(conn)
        self.out(f"Built {n:,} watches, {nt:,} genre and {ng:,} tag links ({time.perf_counter() - t:.1f}s)")

    def build(self) -> None:
        conn = self.connect()
        db.init_db(conn)
        self._derive(conn)
        r = conn.execute(
            "SELECT COUNT(*), TOTAL(est_s)/3600.0, TOTAL(max_s)/3600.0, COUNT(DISTINCT session_id), "
            "TOTAL(delayed_fix), TOTAL(is_background), TOTAL(bucket='short'), TOTAL(bucket='music') FROM watches"
        ).fetchone()  # TOTAL, not SUM: 0 instead of NULL before enrich / on an empty table
        self.out(f"  estimated watch time: {r[1]:,.0f} h (max possible {r[2]:,.0f} h)")
        self.out(f"  sessions: {r[3]:,}  delayed logs fixed: {r[4]:,.0f}  background: {r[5]:,.0f}  "
                 f"Shorts: {r[6]:,.0f}  music: {r[7]:,.0f}")

    def enrich(self, retry_missing: bool = False, skip_ads: bool = False, budget: int | None = None, **_) -> None:
        from tqdm import tqdm

        from . import enrich
        out = self.out
        conn = self.connect()
        db.init_db(conn)
        if not conn.execute("SELECT 1 FROM entries LIMIT 1").fetchone():
            raise ConnectorError("No data yet. Run `python backend/cli.py ingest` first.")
        key = secrets.get("YOUTUBE_API_KEY")
        if not key:
            out("No YOUTUBE_API_KEY saved (python backend/cli.py secrets set YOUTUBE_API_KEY), skipping enrichment. "
                "The app still works with reduced stats (no durations, categories, genres or thumbnails).")
            return
        api = self.cfg.section("api")
        budget = budget or api.get("daily_budget_units", 9500)
        used = enrich.units_used_today(conn)
        out(f"Quota used today (Pacific day {enrich.quota_day()}): {used:,} / budget {budget:,}")
        e = enrich.Enricher(
            conn, key, budget=budget, batch_size=api.get("batch_size", 50),
            progress=lambda total, desc: tqdm(total=total, desc=f"{desc:<8}", unit="id", ncols=90))
        try:
            r = e.run(include_ads=api.get("fetch_ad_videos", True) and not skip_ads,
                      retry_missing=retry_missing,
                      shorts_max_duration=self.cfg.section("shorts").get("max_duration_seconds", 180))
        except enrich.ApiKeyError as err:
            raise ConnectorError(
                f"The API rejected your key: {err}\nSave it again (python backend/cli.py secrets set YOUTUBE_API_KEY) "
                "and check that 'YouTube Data API v3' is enabled for the key's project.") from None
        except enrich.ApiError as err:
            raise ConnectorError(f"API error: {err}\nProgress so far is saved; rerun to continue.") from None

        out(f"\nThis run: {r.units:,} units. Videos found {r.videos_ok:,}, missing {r.videos_missing:,}. "
            f"Channels found {r.channels_ok:,}, missing {r.channels_missing:,}."
            + (f" Categories: {r.categories}." if r.categories else "")
            + (f" Video shapes checked: {r.shapes:,}." if r.shapes else ""))
        if r.stopped:
            out(f"Stopped early ({r.stopped}). {r.videos_left:,} videos and {r.channels_left:,} channels "
                "left; rerun after the quota resets (midnight Pacific) to continue.")
        c = enrich.coverage(conn)
        pct = 100 * c["watched_ok"] / max(1, c["watched_ids"])
        out(f"Coverage: {c['watched_ok']:,} of {c['watched_ids']:,} watched video IDs enriched ({pct:.1f}%); "
            f"{c['unavailable_recovered']:,} 'unavailable' videos recovered; "
            f"{c['channels_ok']:,} channels. Quota used today: {c['units_today']:,}.")
        self._derive(conn)


CONNECTOR = YouTube
