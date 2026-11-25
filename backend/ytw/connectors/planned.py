"""Platforms on the roadmap but not built yet: listed on the hub with how to get their data.
A platform moves out of here when its connector package exists."""
from .base import Manifest, vocab

PLANNED = (
    Manifest(
        "prime_video", "Prime Video", False, "prime_video", vocab("show", "shows", "episode", "episodes"),
        frozenset({"genres"}),
        ("amazon.com → Request your data → Prime Video",
         "Put the Digital.PrimeVideo.ViewingHistory CSV in data/prime_video/"),
        "up to a month", issue=4, order=4),
    Manifest(
        "tiktok", "TikTok", False, "tiktok", vocab("creator", "creators", "video", "videos"),
        frozenset({"search", "estimated_time"}),
        ("TikTok → Settings and privacy → Account → Download your data → JSON",
         "Put the export JSON in data/tiktok/"),
        "a few days (link expires after ~4 days)", issue=5, family="social", order=5),
    Manifest(
        "instagram", "Instagram", False, "instagram", vocab("account", "accounts", "video", "videos"),
        frozenset({"search"}),
        ("Accounts Center → Your information and permissions → Download your information → JSON, all time",
         "Put the export folder in data/instagram/"),
        "up to ~14 days", issue=6, family="social", order=6),
)
