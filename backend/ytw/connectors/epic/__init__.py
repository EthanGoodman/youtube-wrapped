"""Epic Games: your playtime, library and achievements from the Epic Games Launcher's own endpoints (unofficial,
read-only), snapshotted daily like Steam."""
from __future__ import annotations

from datetime import datetime

from ... import secrets
from ...imports import ImportRejected
from ..base import Connector, ConnectorError, Manifest, vocab

MANIFEST = Manifest(
    "epic", "Epic Games", True, "epic", vocab("game", "games", "game", "games", "play", "played", "playtime"),
    frozenset({"achievements"}),
    ("No official export, so this reads your own playtime from the Epic Games Launcher's endpoints (unofficial, read-only)",
     "Sign in at epicgames.com in your browser, then open "
     "https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code",
     "Copy the authorizationCode it shows and save it: python backend/cli.py secrets set EPIC_AUTH_CODE",
     "Fetch within a few minutes (the code works once): python backend/cli.py fetch --platform epic"),
    "a minute (unofficial)", issue=108, family="games", auth="cookie", order=6, sync_every=3600,
    image_hosts=(("cdn1.epicgames.com", "/"), ("cdn2.unrealengine.com", "/"), ("cdn1.unrealengine.com", "/")),
    secrets=("EPIC_AUTH_CODE", "EPIC_REFRESH_TOKEN"), official=False)


class Epic(Connector):
    manifest = MANIFEST

    def _session(self, call) -> dict:
        """Sign in with a fresh one-time code if one was saved (then forget it), else with the saved refresh token;
        keep the new refresh token for next time."""
        from . import api
        st = secrets.store()
        code, refresh = secrets.get("EPIC_AUTH_CODE"), secrets.get("EPIC_REFRESH_TOKEN")
        if not code and not refresh:
            raise api.SignInNeeded(api.SIGN_IN)
        try:
            s = api.sign_in(call, code=api.auth_code(code)) if code else api.sign_in(call, refresh=refresh)
        finally:
            if code:
                st.delete("EPIC_AUTH_CODE")           # single-use either way
        for v in (s["access_token"], s["refresh_token"]):
            secrets.register(v)                        # never in logs
        st.set("EPIC_REFRESH_TOKEN", s["refresh_token"])
        return s

    def fetch(self, **_) -> None:
        """Today's playtime snapshot plus names, art and achievements for games played since the last fetch."""
        from . import api
        call = api.http()
        try:
            s = self._session(call)
            r = api.fetch_all(self.folder, call, s, datetime.now(self.cfg.tz).date(),
                              progress=lambda t: print(f"  {t:<30}", end="\r", flush=True))
        except api.EpicError as e:
            raise ConnectorError(str(e)) from None
        print(" " * 35, end="\r")
        self.out(f"Epic: {r['played']:,} games played ({r['hours']:,} h); details refreshed for {r['refreshed']:,}")
        if r["unknown"]:
            self.out(f"{r['unknown']:,} of them aren't in your library any more (shown by their app name)")
        self.ingest()

    def sync(self, **opts) -> None:
        self.fetch(**opts)

    def ingest(self, **_) -> None:
        from . import ingest as ep
        conn = self.connect()
        try:
            res = ep.ingest(conn, self.folder)
        except (FileNotFoundError, ValueError, ImportRejected) as e:
            raise ConnectorError(str(e)) from None
        self.out(f"Epic: {res['snapshots']} daily snapshot(s), {res['games']:,} games, {res['achievements']:,} achievements unlocked")
        self._derive(conn)

    def build(self) -> None:
        self._derive(self.connect())

    def _derive(self, conn) -> None:
        from . import ingest as ep
        n = ep.build(conn, self.cfg.tz)
        games, lifetime = conn.execute("SELECT COUNT(DISTINCT video_id), SUM(est_s) / 3600.0 FROM "
                                       "(SELECT video_id, est_s FROM watches UNION ALL SELECT video_id, est_s FROM undated_watches)").fetchone()
        self.out(f"Built: {games or 0:,} games, {lifetime or 0:,.0f} h lifetime; {n:,} tracked play days")


CONNECTOR = Epic
