"""Every platform the app knows about: wording, features, theme and how to get the data.

Only platforms with `implemented=True` can be imported; the rest are listed so the hub page
can show what's coming (each links to its GitHub issue).
"""
from __future__ import annotations

from dataclasses import dataclass, field

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
}


@dataclass(frozen=True)
class Platform:
    id: str
    name: str
    implemented: bool
    theme: str                      # frontend theme id
    vocab: dict[str, str]           # wording used across the UI
    capabilities: frozenset[str] = field(default_factory=frozenset)
    export_steps: tuple[str, ...] = ()
    export_wait: str = ""
    issue: int | None = None        # GitHub issue tracking it

    def has(self, capability: str) -> bool:
        return capability in self.capabilities

    def with_extra(self, extra: str | None) -> "Platform":
        """Add capabilities the imported data turned out to have (recorded by the build)."""
        more = {c for c in (extra or "").split(",") if c in CAPABILITIES}
        return Platform(self.id, self.name, self.implemented, self.theme, self.vocab, self.capabilities | more,
                        self.export_steps, self.export_wait, self.issue) if more else self

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "implemented": self.implemented, "theme": self.theme,
                "vocab": self.vocab, "capabilities": sorted(self.capabilities),
                "export_steps": list(self.export_steps), "export_wait": self.export_wait, "issue": self.issue}


def _vocab(creator: str, creators: str, item: str, items: str, verb: str = "watch", verbed: str = "watched",
           time: str = "watch time") -> dict[str, str]:
    return {"creator": creator, "creators": creators, "item": item, "items": items,
            "verb": verb, "verbed": verbed, "time": time}


PLATFORMS: dict[str, Platform] = {p.id: p for p in (
    Platform(
        "youtube", "YouTube", True, "youtube", _vocab("channel", "channels", "video", "videos"),
        frozenset({"shorts", "music", "ads", "search", "estimated_time", "time_of_day", "background",
                   "categories", "genres", "tags"}),
        ("takeout.google.com → Deselect all → YouTube and YouTube Music",
         "All YouTube data included → only history; Multiple formats → History: JSON",
         "Put watch-history.json (and search-history.json) in data/youtube/"),
        "minutes to hours"),
    Platform(
        "netflix", "Netflix", True, "netflix", _vocab("show", "shows", "title", "titles"),
        frozenset({"genres"}),
        ("Quick: netflix.com/viewingactivity → Download all → NetflixViewingHistory.csv (dates only)",
         "Full (adds times and durations): netflix.com/account → Download your personal information "
         "→ CONTENT_INTERACTION/ViewingActivity.csv",
         "Put either file in data/netflix/, then: python backend/cli.py ingest --platform netflix"),
        "instant (quick) or a few days (full)", issue=2),
    Platform(
        "spotify", "Spotify", False, "spotify",
        _vocab("artist", "artists", "track", "tracks", "listen", "listened", "listening time"),
        frozenset({"genres"}),
        ("spotify.com → Account → Privacy settings → Extended streaming history",
         "Put the Streaming_History_Audio_*.json files in data/spotify/"),
        "up to 30 days", issue=3),
    Platform(
        "prime_video", "Prime Video", False, "prime_video", _vocab("show", "shows", "episode", "episodes"),
        frozenset({"genres"}),
        ("amazon.com → Request your data → Prime Video",
         "Put the Digital.PrimeVideo.ViewingHistory CSV in data/prime_video/"),
        "up to a month", issue=4),
    Platform(
        "tiktok", "TikTok", False, "tiktok", _vocab("creator", "creators", "video", "videos"),
        frozenset({"search", "estimated_time"}),
        ("TikTok → Settings and privacy → Account → Download your data → JSON",
         "Put the export JSON in data/tiktok/"),
        "a few days (link expires after ~4 days)", issue=5),
    Platform(
        "instagram", "Instagram", False, "instagram", _vocab("account", "accounts", "video", "videos"),
        frozenset({"search"}),
        ("Accounts Center → Your information and permissions → Download your information → JSON, all time",
         "Put the export folder in data/instagram/"),
        "up to ~14 days", issue=6),
    Platform(
        "crunchyroll", "Crunchyroll", False, "crunchyroll", _vocab("series", "series", "episode", "episodes"),
        frozenset({"genres"}),
        ("No official export: use the history export script (coming with this platform)",),
        "instant (unofficial)", issue=7),
)}

DEFAULT = "youtube"


def get(platform_id: str) -> Platform | None:
    return PLATFORMS.get(platform_id)
