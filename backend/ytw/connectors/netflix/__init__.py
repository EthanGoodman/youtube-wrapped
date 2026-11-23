"""Netflix: the viewing-activity download (quick) and/or the full data export, matched to TMDB."""
from __future__ import annotations

from ... import secrets
from ..base import Connector, ConnectorError, Manifest, vocab

MANIFEST = Manifest(
    "netflix", "Netflix", True, "netflix", vocab("show", "shows", "title", "titles"),
    frozenset({"genres", "series"}),
    ("Quick: netflix.com/viewingactivity → Download all → NetflixViewingHistory.csv (dates only)",
     "Full (adds times and durations): netflix.com/account → Download your personal information "
     "→ CONTENT_INTERACTION/ViewingActivity.csv"),
    "instant (quick) or a few days (full)", issue=2, image_hosts=(("image.tmdb.org", "/t/p/"),),
    auth="file", secrets=("TMDB_TOKEN",), order=2)


class Netflix(Connector):
    manifest = MANIFEST

    def ingest(self, profile: str | None = None, **_) -> None:
        from . import ingest as nf
        conn = self.connect()
        nf.init(conn)
        profile = profile or self.settings.get("profile") or None
        try:
            res = nf.ingest(conn, self.folder, self.cfg.tz, profile)
        except (FileNotFoundError, ValueError) as e:
            raise ConnectorError(str(e)) from None
        kind = {"full": "full export (times + durations)", "simple": "quick download (dates only)",
                "mixed": "full export + quick download"}[res["format"]]
        self.out(f"Netflix: read {res['file']} - {kind}: {res['rows']:,} rows, "
                 f"{res['supplemental']:,} trailers/previews skipped"
                 + (f", {res['duplicates']:,} duplicates across files dropped" if res["duplicates"] else ""))
        self._derive(conn)

    def build(self) -> None:
        self._derive(self.connect())

    def _derive(self, conn) -> None:
        from . import ingest as nf
        n = nf.build(conn, self.cfg.tz, self.settings,
                     self.cfg.section("watchtime").get("session_gap_minutes", 30) * 60)
        r = conn.execute("SELECT COUNT(DISTINCT channel_id), SUM(kind='episode'), SUM(kind='movie'), "
                         "SUM(est_s)/3600.0, MIN(local_date), MAX(local_date) FROM watches").fetchone()
        self.out(f"Built {n:,} views: {r[1]:,} episodes of {r[0]:,} shows, {r[2]:,} movies, "
                 f"{r[3]:,.0f} h ({r[4]} -> {r[5]})")

    def enrich(self, **_) -> None:
        from . import tmdb
        token = secrets.get("TMDB_TOKEN")
        if not token:
            raise ConnectorError("No TMDB_TOKEN saved. Get a free API Read Access Token at themoviedb.org "
                                 "(Settings -> API), then run: python backend/cli.py secrets set TMDB_TOKEN")
        conn = self.connect()
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'views'").fetchone():
            raise ConnectorError("No Netflix data yet. Run `python backend/cli.py ingest --platform netflix` first.")
        overrides = tmdb.load_overrides(self.folder / "overrides.toml")
        try:
            r = tmdb.enrich(conn, tmdb.http_fetcher(token), overrides,
                            progress=lambda s: print(f"  {s[:70]:<70}", end="\r", flush=True))
        except tmdb.TmdbError as e:
            raise ConnectorError(str(e)) from None
        print(" " * 75, end="\r")
        self.out(f"TMDB: {r['shows_found']}/{r['shows']} shows and {r['movies_found']}/{r['movies']} movies matched, "
                 f"{r['one_offs']} one-off titles settled ({r['requests']} requests). "
                 "Fix wrong matches in data/netflix/overrides.toml.")
        self._derive(conn)


CONNECTOR = Netflix
