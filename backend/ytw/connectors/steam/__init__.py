"""Steam: your library and achievements from Steam's official Web API (your own key), snapshotted daily."""
from __future__ import annotations

from datetime import datetime

from ... import secrets
from ...imports import ImportRejected
from ..base import Connector, ConnectorError, Manifest, vocab

MANIFEST = Manifest(
    "steam", "Steam", True, "steam", vocab("game", "games", "game", "games", "play", "played", "playtime"),
    frozenset({"achievements"}),
    ("Get a free Steam Web API key at steamcommunity.com/dev/apikey (any domain name, e.g. localhost) and save it: "
     "python backend/cli.py secrets set STEAM_API_KEY",
     "Save your profile link: python backend/cli.py secrets set STEAM_PROFILE (steamcommunity.com/id/... or /profiles/...)",
     "In Steam: Profile > Edit Profile > Privacy > Game details: Public"),
    "instant", issue=59, family="games", auth="api_key", order=5, sync_every=24 * 3600,
    image_hosts=(("shared.cloudflare.steamstatic.com", "/store_item_assets/steam/apps/"),),
    secrets=("STEAM_API_KEY", "STEAM_PROFILE"))


class Steam(Connector):
    manifest = MANIFEST

    def fetch(self, **_) -> None:
        """Today's library snapshot plus achievements and genres for games played since the last fetch."""
        from . import api
        key, who = secrets.get("STEAM_API_KEY"), secrets.get("STEAM_PROFILE")
        if not key or not who:
            raise ConnectorError("Save your Steam API key and profile first: python backend/cli.py secrets set STEAM_API_KEY, "
                                 "then python backend/cli.py secrets set STEAM_PROFILE (your steamcommunity.com profile link)")
        fetch = api.http_fetcher(key)
        try:
            steam_id = api.resolve_id(fetch, who)
            r = api.fetch_all(self.folder, fetch, steam_id, datetime.now(self.cfg.tz).date(),
                              progress=lambda s: print(f"  {s:<30}", end="\r", flush=True))
        except api.SteamError as e:
            raise ConnectorError(str(e)) from None
        print(" " * 35, end="\r")
        self.out(f"Steam: {r['games']:,} games ({r['played']:,} played, {r['hours']:,} h); details refreshed for {r['refreshed']:,}")
        if r["achievements_hidden"]:
            self.out(f"Achievements were hidden for {r['achievements_hidden']:,} games: in Steam, set Profile > Edit Profile > Privacy > "
                     "Game details to Public, then fetch again. Until then, past hours can only be placed on each game's last-played day.")
        self.ingest()

    def sync(self, **opts) -> None:
        self.fetch(**opts)

    def ingest(self, **_) -> None:
        from . import ingest as st
        conn = self.connect()
        try:
            res = st.ingest(conn, self.folder)
        except (FileNotFoundError, ValueError, ImportRejected) as e:
            raise ConnectorError(str(e)) from None
        self.out(f"Steam: {res['snapshots']} daily snapshot(s), {res['games']:,} games, {res['achievements']:,} achievements unlocked")
        self._derive(conn)

    def build(self) -> None:
        self._derive(self.connect())

    def _derive(self, conn) -> None:
        from . import ingest as st
        n = st.build(conn, self.cfg.tz)
        r = conn.execute("SELECT COUNT(DISTINCT video_id), SUM(est_s)/3600.0, MIN(local_date), MAX(local_date) FROM watches").fetchone()
        self.out(f"Built {n:,} play days: {r[0] or 0:,} games, {r[1] or 0:,.0f} h ({r[2]} -> {r[3]})")


CONNECTOR = Steam
