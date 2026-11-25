"""Spotify: the extended streaming history (lifetime) and/or the account-data download, read offline."""
from __future__ import annotations

from ... import secrets
from ...imports import ImportRejected
from ..base import Connector, ConnectorError, Manifest, vocab

MANIFEST = Manifest(
    "spotify", "Spotify", True, "spotify",
    vocab("artist", "artists", "track", "tracks", "listen", "listened", "listening time"),
    frozenset(),
    ("spotify.com → Account → Privacy settings → Extended streaming history (lifetime; recommended)",
     "Or the quicker Account data download (about the last year)",
     "Add the .zip Spotify emails you, or the Streaming_History_Audio_*.json files"),
    "up to 30 days (extended), about 5 days (account data)", issue=3, family="music", auth="file", order=3,
    image_hosts=(("i.scdn.co", "/image/"),), secrets=("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "LASTFM_API_KEY"))


class Spotify(Connector):
    manifest = MANIFEST

    def ingest(self, **_) -> None:
        from . import ingest as sp
        conn = self.connect()
        try:
            res = sp.ingest(conn, self.folder)
        except (FileNotFoundError, ValueError, ImportRejected) as e:
            raise ConnectorError(str(e)) from None
        self.out(f"Spotify: read {res['files']} file(s), {res['plays']:,} plays ({', '.join(res['sources'])})")
        self._derive(conn)

    def build(self) -> None:
        self._derive(self.connect())

    def _derive(self, conn) -> None:
        from . import ingest as sp
        n = sp.build(conn, self.cfg.tz, self.cfg.section("watchtime").get("session_gap_minutes", 30) * 60)
        r = conn.execute("SELECT COUNT(DISTINCT video_id), COUNT(DISTINCT channel_id), SUM(est_s)/3600.0, "
                         "MIN(local_date), MAX(local_date) FROM watches").fetchone()
        self.out(f"Built {n:,} streams: {r[0]:,} tracks by {r[1]:,} artists, {r[2] or 0:,.0f} h ({r[3]} -> {r[4]})")


    def enrich(self, **_) -> None:
        """Pictures from Spotify's Web API (an app-only token: no sign-in) and genres from Last.fm. A quick pass over
        the most-played albums and artists first, then the pages are rebuilt so they have pictures within a minute
        or so; then everything else, rebuilt again at the end. Stopped or rate-limited runs keep what they found."""
        from . import api, lastfm
        cid, secret, key = secrets.get("SPOTIFY_CLIENT_ID"), secrets.get("SPOTIFY_CLIENT_SECRET"), secrets.get("LASTFM_API_KEY")
        if not (cid and secret) and not key:
            raise ConnectorError("No keys saved. Pictures: create a free app at developer.spotify.com/dashboard and run "
                                 "python backend/cli.py secrets set SPOTIFY_CLIENT_ID (and SPOTIFY_CLIENT_SECRET). "
                                 "Genres: get a free key at last.fm/api/account/create and run "
                                 "python backend/cli.py secrets set LASTFM_API_KEY")
        conn = self.connect()
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'plays'").fetchone():
            raise ConnectorError("No Spotify data yet. Run `python backend/cli.py ingest --platform spotify` first.")
        sp = api.http_fetcher(cid, secret) if cid and secret else None
        lf = lastfm.http_fetcher(key) if key else None
        if not sp:
            self.out("Pictures skipped: no Spotify app keys saved (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)")
        if not lf:
            self.out("Genres skipped: no Last.fm key saved (LASTFM_API_KEY)")
        show = lambda s: print(f"  {s:<40}", end="\r", flush=True)  # noqa: E731
        try:
            for limit, label in ((QUICK, "Quick pass (most played)"), (None, "Everything else")):
                parts = []
                if sp:
                    r = api.enrich(conn, sp, limit, show)
                    parts.append(f"pictures for {r['albums_found']:,} albums and {r['artists_found']:,} artists")
                if lf:
                    r = lastfm.enrich(conn, lf, limit, show)
                    parts.append(f"genres for {r['artists_with_genres']:,} artists")
                print(" " * 45, end="\r")
                self.out(f"{label}: {', '.join(parts)}")
                self._derive(conn)
        except (api.SpotifyError, lastfm.LastfmError) as e:
            self._derive(conn)              # use what was found before stopping
            raise ConnectorError(str(e)) from None


QUICK = 300   # albums / artists in the first pass: enough for every list the pages show


CONNECTOR = Spotify
