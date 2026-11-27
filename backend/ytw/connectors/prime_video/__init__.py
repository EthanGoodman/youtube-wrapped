"""Prime Video: Amazon's data export (times and seconds watched) + each profile's watch history (whose it was),
matched to TMDB like Netflix."""
from __future__ import annotations

from ... import secrets
from ..base import Connector, ConnectorError, Manifest, vocab

MANIFEST = Manifest(
    "prime_video", "Prime Video", True, "prime_video", vocab("show", "shows", "title", "titles"),
    frozenset({"genres", "series"}),
    ("amazon.com/gp/privacycentral/dsar/preview.html → Request your data → Prime Video → the .zip",
     "Your profile's history: primevideo.com/settings/watch-history → F12 → Console → paste "
     "backend/ytw/connectors/prime_video/watch-history.js → a .json",
     "Other profiles you watched on: save theirs the same way, then `python backend/cli.py prime-picks <file>` "
     "and tick what you watched"),
    "a few days to a month (the export)", issue=4, image_hosts=(("image.tmdb.org", "/t/p/"),),
    auth="file", secrets=("TMDB_TOKEN",), order=4)


class PrimeVideo(Connector):
    manifest = MANIFEST

    def ingest(self, **_) -> None:
        from . import ingest as pv
        conn = self.connect()
        try:
            r = pv.ingest(conn, self.folder, self.cfg.tz)
        except (FileNotFoundError, ValueError) as e:
            raise ConnectorError(str(e)) from None
        self.out(f"Prime Video: {r['file']} has {r['playbacks']:,} playbacks on the account. "
                 f"{r['mine']:,} are yours ({r['hours']:,.0f} h) across {r['profiles']} profile histories "
                 f"({r['picks']} with picks); {r['others']:,} were other people's, "
                 f"{r['unknown']:,} were on profiles not saved here.")
        self._derive(conn)

    def build(self) -> None:
        self._derive(self.connect())

    def _derive(self, conn) -> None:
        from ..netflix import ingest as nf
        n = nf.build(conn, self.cfg.tz, self.settings,
                     self.cfg.section("watchtime").get("session_gap_minutes", 30) * 60,
                     search_url="https://www.primevideo.com/search/?phrase=")
        r = conn.execute("SELECT COUNT(DISTINCT channel_id), SUM(kind='episode'), SUM(kind='movie'), "
                         "SUM(est_s)/3600.0, MIN(local_date), MAX(local_date) FROM watches").fetchone()
        self.out(f"Built {n:,} views: {r[1] or 0:,} episodes of {r[0]:,} shows, {r[2] or 0:,} movies, "
                 f"{r[3] or 0:,.0f} h ({r[4]} -> {r[5]})")

    def enrich(self, **_) -> None:
        from ..netflix import tmdb
        token = secrets.get("TMDB_TOKEN")
        if not token:
            raise ConnectorError("No TMDB_TOKEN saved. Get a free API Read Access Token at themoviedb.org "
                                 "(Settings -> API), then run: python backend/cli.py secrets set TMDB_TOKEN")
        conn = self.connect()
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'views'").fetchone():
            raise ConnectorError("No Prime Video data yet. Run `python backend/cli.py ingest --platform prime_video` first.")
        overrides = tmdb.load_overrides(self.folder / "overrides.toml")
        try:
            r = tmdb.enrich(conn, tmdb.http_fetcher(token), overrides,
                            progress=lambda s: print(f"  {s[:70]:<70}", end="\r", flush=True))
        except tmdb.TmdbError as e:
            raise ConnectorError(str(e)) from None
        print(" " * 75, end="\r")
        self.out(f"TMDB: {r['shows_found']}/{r['shows']} shows and {r['movies_found']}/{r['movies']} movies matched "
                 f"({r['requests']} requests). Fix wrong matches in data/prime_video/overrides.toml.")
        self._derive(conn)


CONNECTOR = PrimeVideo
