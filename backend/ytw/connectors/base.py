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
    order: int = 100                # position on the hub page

    def __post_init__(self):
        if self.family not in FAMILIES:
            raise ValueError(f"{self.id}: unknown family {self.family!r}")
        if self.auth not in AUTH_KINDS:
            raise ValueError(f"{self.id}: unknown auth kind {self.auth!r}")
        unknown = set(self.capabilities) - CAPABILITIES
        if unknown:
            raise ValueError(f"{self.id}: unknown capabilities {sorted(unknown)}")

    def has(self, capability: str) -> bool:
        return capability in self.capabilities

    def with_extra(self, extra: str | None) -> "Manifest":
        """Add capabilities the imported data turned out to have (recorded by the build)."""
        more = {c for c in (extra or "").split(",") if c in CAPABILITIES}
        return replace(self, capabilities=self.capabilities | more) if more else self

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "implemented": self.implemented, "theme": self.theme,
                "vocab": self.vocab, "capabilities": sorted(self.capabilities),
                "export_steps": list(self.export_steps), "export_wait": self.export_wait, "issue": self.issue}


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
        return db.connect(self.cfg.platform_db(self.id))

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


def finish_build(conn: sqlite3.Connection) -> None:
    """Every build ends here: refresh the query planner's statistics and stamp built_at (which
    also clears the API's result cache)."""
    conn.execute("ANALYZE")
    db.set_meta(conn, "built_at", datetime.now(timezone.utc).isoformat())
    conn.commit()
