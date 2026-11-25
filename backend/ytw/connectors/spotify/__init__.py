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
    image_hosts=(("i.scdn.co", "/image/"),), secrets=("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"))


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
        """Album art, artist photos and genres from Spotify's Web API (an app-only token: no sign-in)."""
        from . import api
        cid, secret = secrets.get("SPOTIFY_CLIENT_ID"), secrets.get("SPOTIFY_CLIENT_SECRET")
        if not cid or not secret:
            raise ConnectorError("No Spotify app saved. Create a free app at developer.spotify.com/dashboard (any name, "
                                 "redirect URI http://127.0.0.1:8000/callback), then run: python backend/cli.py secrets set "
                                 "SPOTIFY_CLIENT_ID and python backend/cli.py secrets set SPOTIFY_CLIENT_SECRET")
        conn = self.connect()
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'plays'").fetchone():
            raise ConnectorError("No Spotify data yet. Run `python backend/cli.py ingest --platform spotify` first.")
        try:
            r = api.enrich(conn, api.http_fetcher(cid, secret), progress=lambda s: print(f"  {s:<40}", end="\r", flush=True))
        except api.SpotifyError as e:
            raise ConnectorError(str(e)) from None
        print(" " * 45, end="\r")
        self.out(f"Spotify: {r['tracks_found']:,}/{r['tracks']:,} tracks and {r['artists_found']:,}/{r['artists']:,} artists "
                 f"found ({r['requests']} requests)")
        self._derive(conn)


CONNECTOR = Spotify
