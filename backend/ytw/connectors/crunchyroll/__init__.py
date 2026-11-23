"""Crunchyroll: no export, so history is read from crunchyroll.com with the user's own cookie
(unofficial), then enriched from Crunchyroll's catalog and AniList."""
from __future__ import annotations

from ... import secrets
from ..base import Connector, ConnectorError, Manifest, vocab

MANIFEST = Manifest(
    "crunchyroll", "Crunchyroll", True, "crunchyroll", vocab("series", "series", "episode", "episodes"),
    frozenset({"genres", "series", "anime"}),
    ("No official export. Log in at crunchyroll.com, open DevTools (F12) > Application > Cookies and copy etp_rt",
     "Save it with: python backend/cli.py secrets set CRUNCHYROLL_ETP_RT (treat it like a password)",
     "Run: python backend/cli.py fetch --platform crunchyroll (unofficial: reads your own history from Crunchyroll's site)"),
    "a minute (unofficial)", issue=7, image_hosts=(("www.crunchyroll.com", "/imgsrv/"),),
    auth="cookie", secrets=("CRUNCHYROLL_ETP_RT",), order=7)


class Crunchyroll(Connector):
    manifest = MANIFEST

    def fetch(self, **_) -> None:
        """Download history straight from crunchyroll.com (there's no data export)."""
        from .fetch import WEB_CLIENT_ID, CrunchyrollError, fetch_history
        sec = self.settings
        cookie = secrets.get("CRUNCHYROLL_ETP_RT") or ""
        if not cookie:
            raise ConnectorError(
                "No CRUNCHYROLL_ETP_RT saved. Log in at crunchyroll.com, open DevTools (F12) > Application > "
                "Cookies > https://www.crunchyroll.com, copy the value of etp_rt, then run:\n"
                "  python backend/cli.py secrets set CRUNCHYROLL_ETP_RT\nTreat it like a password.")
        try:
            res = fetch_history(self.folder, cookie, client_id=sec.get("client_id", WEB_CLIENT_ID),
                                locale=sec.get("locale", "en-US"), profile=sec.get("profile") or None,
                                progress=lambda n: print(f"  {n:,} history entries...", end="\r", flush=True))
        except CrunchyrollError as e:
            raise ConnectorError(f"\n{e}") from None
        span = f" ({res['first'][:10]} -> {res['last'][:10]})" if res["first"] else ""
        self.out(f"\nCrunchyroll: saved {res['items']:,} history entries for profile {res['profile']}{span} "
                 f"to {res['file']} ({res['requests']} requests)")
        self.build()  # import it straight away

    def ingest(self, **_) -> None:
        self.build()  # the fetched file is the raw store; nothing else to read

    def build(self) -> None:
        from . import ingest as cr
        try:
            r = cr.build(self.connect(), self.folder, self.cfg.tz)
        except FileNotFoundError as e:
            raise ConnectorError(str(e)) from None
        self.out(f"Built {r['plays']:,} episodes of {r['series']:,} series, {r['hours']:,.0f} h watched "
                 f"({r['first']} -> {r['last']}); {r['skipped']} removed or few-second plays skipped")

    def enrich(self, retry_missing: bool = False, **_) -> None:
        """Posters + episode lists from Crunchyroll's catalog, then studios / season / tags from AniList."""
        from . import anilist, catalog
        from .fetch import WEB_CLIENT_ID, Client, CrunchyrollError
        conn = self.connect()
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'watches'").fetchone() or \
                not conn.execute("SELECT 1 FROM watches LIMIT 1").fetchone():
            raise ConnectorError("No Crunchyroll data yet. Run `python backend/cli.py fetch --platform crunchyroll` first.")
        series = [(cid.split(":", 1)[1], title) for cid, title in conn.execute(
            "SELECT creator_id, title FROM creators WHERE creator_id LIKE 'series:%' ORDER BY title")]
        sec = self.settings
        cookie = secrets.get("CRUNCHYROLL_ETP_RT") or ""
        try:
            client = Client(cookie, client_id=sec.get("client_id", WEB_CLIENT_ID))
            r = catalog.fetch_catalog(conn, client, [sid for sid, _ in series], refresh=retry_missing,
                                      locale=sec.get("locale", "en-US"),
                                      progress=lambda m: print(f"  Crunchyroll catalog: {m:<30}", end="\r", flush=True))
        except CrunchyrollError as e:
            raise ConnectorError(f"\n{e}") from None
        self.out(f"\nCrunchyroll catalog: {r['fetched']} of {r['series']} series fetched ({r['episodes']:,} episodes, "
                 f"{r['requests']} requests); the rest were cached")
        try:
            a = anilist.enrich(conn, series, overrides=anilist.load_overrides(self.folder / "overrides.toml"),
                               refresh=retry_missing,
                               progress=lambda m: print(f"  AniList {m[:60]:<60}", end="\r", flush=True))
        except anilist.AniListError as e:
            raise ConnectorError(f"\n{e}") from None
        print(" " * 75, end="\r")
        self.out(f"AniList: {a['matched']} of {a['series']} series matched ({a['requests']} requests). "
                 "Fix wrong matches in data/crunchyroll/overrides.toml ([anilist] \"Title\" = id).")
        self.build()


CONNECTOR = Crunchyroll
