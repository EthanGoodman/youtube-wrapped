"""The connector template: one shape for every platform.

A connector is a package in ytw/connectors/<id>/ whose __init__ defines `MANIFEST` (what the
platform is) and `CONNECTOR` (how its data gets in). The registry finds it automatically.

Data flow, the same for every platform:

    acquire  fetch()   download history, for platforms with no export file (optional)
    raw      ingest()  read the export files in data/<id>/ into the raw tables, then build()
    extra    enrich()  look up details from public APIs: posters, runtimes, genres (optional)
    derive   build()   raw tables -> the generic tables every stat reads (watches, items, creators,
                       item_genres, catalog_episodes) -> finish_build() stamps built_at

Steps raise ConnectorError with a message for the person running the CLI. Start a new one with
`python scripts/new_connector.py <id> "<Name>"`; tests/connector_contract.py checks it.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from .. import db
from ..oauth import OAuthSpec

if TYPE_CHECKING:
    from ..config import Config

# Features a platform can have. The UI shows or hides parts of the dashboard by these.
CAPABILITIES = {
    "shorts",          # long-form vs Shorts split and the All/Videos/Shorts switch
    "music",           # a separate music bucket (YouTube Music)
    "ads",             # an ads section (ads are logged in the export)
    "search",          # search history
    "estimated_time",  # watch time is estimated (else exact durations)
    "time_of_day",     # real start times (watch clock, heatmap, latest night…)
    "background",      # sleep/background audio detection
    "categories",      # platform categories (YouTube's Gaming, Music, …)
    "genres",
    "tags",
    "series",          # episodic shows with seasons (show progress, binges, episodes vs movies)
    "anime",           # sub vs dub and simulcast stats (Crunchyroll)
    "achievements",    # achievements / trophies with unlock times (games)
}
FAMILIES = ("video", "music", "games", "social", "reading", "fitness")
# how the data gets in: an export file, an API key, a browser cookie, OAuth, the browser extension,
# or a server the user runs (Plex/Jellyfin)
AUTH_KINDS = ("file", "api_key", "cookie", "oauth", "extension", "server")


@dataclass(frozen=True)
class Manifest:
    """What a platform is: wording, features, theme and how to get its data."""
    id: str
    name: str
    implemented: bool
    theme: str                      # frontend theme id
    vocab: dict[str, str]           # wording used across the UI
    capabilities: frozenset[str] = field(default_factory=frozenset)
    export_steps: tuple[str, ...] = ()
    export_wait: str = ""
    issue: int | None = None        # GitHub issue tracking it
    # where its posters/thumbnails live: (exact host, path prefix). The image relay allows only these.
    image_hosts: tuple[tuple[str, str], ...] = ()
    family: str = "video"
    auth: str = "file"
    secrets: tuple[str, ...] = ()   # names in the secrets store this connector reads
    official: bool = True           # False when the data comes from an unofficial method (say so in the UI)
    oauth: OAuthSpec | None = None  # for "Connect" sign-ins: endpoints + least-privilege scopes
    sync_every: int | None = None   # live sources: seconds between background syncs (floor 5 min)
    order: int = 100                # position on the hub page

    def __post_init__(self):
        if self.family not in FAMILIES:
            raise ValueError(f"{self.id}: unknown family {self.family!r}")
        if self.auth not in AUTH_KINDS:
            raise ValueError(f"{self.id}: unknown auth kind {self.auth!r}")
        unknown = set(self.capabilities) - CAPABILITIES
        if unknown:
            raise ValueError(f"{self.id}: unknown capabilities {sorted(unknown)}")
        if self.oauth and self.oauth.client_id_name not in self.secrets:
            raise ValueError(f"{self.id}: list {self.oauth.client_id_name} in secrets so it can be entered")

    def has(self, capability: str) -> bool:
        return capability in self.capabilities

    def with_extra(self, extra: str | None) -> "Manifest":
        """Add capabilities the imported data turned out to have (recorded by the build)."""
        more = {c for c in (extra or "").split(",") if c in CAPABILITIES}
        return replace(self, capabilities=self.capabilities | more) if more else self

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "implemented": self.implemented, "theme": self.theme,
                "vocab": self.vocab, "capabilities": sorted(self.capabilities),
                "export_steps": list(self.export_steps), "export_wait": self.export_wait, "issue": self.issue,
                "family": self.family}


def vocab(creator: str, creators: str, item: str, items: str, verb: str = "watch", verbed: str = "watched",
          time: str = "watch time") -> dict[str, str]:
    return {"creator": creator, "creators": creators, "item": item, "items": items,
            "verb": verb, "verbed": verbed, "time": time}


class ConnectorError(Exception):
    """A problem the person running the CLI can fix; the message says how."""


class Connector:
    """Base class: override the steps the platform has. `out` receives progress lines."""
    manifest: Manifest

    def __init__(self, cfg: "Config", out: Callable[[str], None] = print):
        self.cfg = cfg
        self.out = out
        self._conns: list[sqlite3.Connection] = []

    @property
    def id(self) -> str:
        return self.manifest.id

    @property
    def folder(self) -> Path:
        """Where the raw exports go: data/<id>/."""
        return self.cfg.platform_dir(self.id)

    @property
    def settings(self) -> dict:
        """The platform's [<id>] section of config.toml."""
        return self.cfg.section(self.id)

    def connect(self) -> sqlite3.Connection:
        conn = db.connect(self.cfg.platform_db(self.id))
        self._conns.append(conn)
        return conn

    def close(self) -> None:
        """Close every database connection the steps opened (Windows can't delete open files)."""
        for c in self._conns:
            try:
                c.close()
            except sqlite3.Error:
                pass
        self._conns.clear()

    # -- steps ----------------------------------------------------------------
    def fetch(self, **opts) -> None:
        raise ConnectorError(f"{self.manifest.name} has a data export instead: "
                             + "; ".join(self.manifest.export_steps))

    def ingest(self, **opts) -> None:
        raise ConnectorError(f"{self.manifest.name} has no import step yet")

    def enrich(self, **opts) -> None:
        raise ConnectorError(f"{self.manifest.name} has nothing to look up")

    def build(self) -> None:
        raise ConnectorError(f"{self.manifest.name} has no build step yet")

    def sync(self, **opts) -> None:
        """Live sources: fetch only what's new since the cursor, then build (run by the scheduler)."""
        raise ConnectorError(f"{self.manifest.name} doesn't sync on its own")

    # -- incremental sync position, kept with the data ------------------------------------
    @staticmethod
    def cursor(conn: sqlite3.Connection, name: str = "default") -> str | None:
        return db.get_meta(conn, f"sync_cursor:{name}")

    @staticmethod
    def set_cursor(conn: sqlite3.Connection, value: str, name: str = "default") -> None:
        db.set_meta(conn, f"sync_cursor:{name}", value)


def finish_build(conn: sqlite3.Connection, analyze: bool = True) -> None:
    """Every build ends here: refresh the query planner's statistics (big databases) and stamp
    built_at (which also clears the API's result cache)."""
    if analyze:
        conn.execute("ANALYZE")
    db.set_meta(conn, "built_at", datetime.now(timezone.utc).isoformat())
    conn.commit()
