"""PlayStation: your played games (lifetime hours, first and last played) and trophies from the PlayStation app's own
endpoints (unofficial, read-only), checked hourly while the app runs."""
from __future__ import annotations

from datetime import datetime

from ... import secrets
from ...imports import ImportRejected
from ..base import Connector, ConnectorError, Manifest, vocab

MANIFEST = Manifest(
    "playstation", "PlayStation", True, "playstation", vocab("game", "games", "game", "games", "play", "played", "playtime", "trophy", "trophies"),
    frozenset({"achievements"}),
    ("No official export, so this reads your own games and trophies from the PlayStation app's endpoints (unofficial, read-only)",
     "Sign in at playstation.com in your browser, then open https://ca.account.sony.com/api/v1/ssocookie",
     "Copy the npsso value and save it: python backend/cli.py secrets set PSN_NPSSO",
     "Then: python backend/cli.py fetch --platform playstation"),
    "a minute (unofficial)", issue=60, family="games", auth="cookie", order=6, sync_every=3600,
    image_hosts=(("image.api.playstation.com", "/"), ("psnobj.prod.dl.playstation.net", "/")),
    secrets=("PSN_NPSSO", "PSN_REFRESH_TOKEN"), official=False)


class PlayStation(Connector):
    manifest = MANIFEST

    def _session(self, call) -> dict:
        """The saved sign-in if it still works, else a new one from the npsso cookie; the refresh token is kept."""
        from . import api
        st = secrets.store()
        refresh, npsso = secrets.get("PSN_REFRESH_TOKEN"), secrets.get("PSN_NPSSO")
        s = None
        if refresh:
            try:
                s = api.sign_in(call, refresh=refresh)
            except api.SignInNeeded:
                s = None                                   # expired: fall back to the npsso
        if s is None:
            s = api.sign_in(call, npsso=api.npsso_value(npsso) if npsso else None)
        for v in (s["access_token"], s.get("refresh_token")):
            if v:
                secrets.register(v)                        # never in logs
        if s.get("refresh_token"):
            st.set("PSN_REFRESH_TOKEN", s["refresh_token"])
        return s

    def fetch(self, **_) -> None:
        """This check's snapshot of your games, plus trophies for games whose trophies changed since last time."""
        from . import api
        call = api.http()
        try:
            s = self._session(call)
            r = api.fetch_all(self.folder, call, s, datetime.now(self.cfg.tz).date(),
                              progress=lambda t: print(f"  {t:<30}", end="\r", flush=True))
        except api.PsnError as e:
            raise ConnectorError(str(e)) from None
        print(" " * 35, end="\r")
        self.out(f"PlayStation: {r['games']:,} games ({r['played']:,} with playtime, {r['hours']:,} h), "
                 f"{r['trophy_sets']:,} with trophies; details refreshed for {r['refreshed']:,}")
        self.ingest()

    def sync(self, **opts) -> None:
        self.fetch(**opts)

    def ingest(self, **_) -> None:
        from . import ingest as ps
        conn = self.connect()
        try:
            res = ps.ingest(conn, self.folder)
        except (FileNotFoundError, ValueError, ImportRejected) as e:
            raise ConnectorError(str(e)) from None
        self.out(f"PlayStation: {res['snapshots']} snapshot day(s), {res['games']:,} games, {res['achievements']:,} trophies earned")
        self._derive(conn)

    def build(self) -> None:
        self._derive(self.connect())

    def _derive(self, conn) -> None:
        from . import ingest as ps
        n = ps.build(conn, self.cfg.tz)
        games, lifetime = conn.execute("SELECT COUNT(DISTINCT video_id), SUM(est_s) / 3600.0 FROM "
                                       "(SELECT video_id, est_s FROM watches UNION ALL SELECT video_id, est_s FROM undated_watches)").fetchone()
        self.out(f"Built: {games or 0:,} games, {lifetime or 0:,.0f} h lifetime; {n:,} tracked play days")
        from ..allgames import rebuild_quietly
        rebuild_quietly(self.cfg, self.out)


CONNECTOR = PlayStation
