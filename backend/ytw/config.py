"""Loads config.toml and .env from the repo root."""
from __future__ import annotations

import os
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Config:
    raw: dict = field(default_factory=dict)
    root: Path = ROOT

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.raw["general"]["timezone"])

    @property
    def data_root(self) -> Path:
        """Top-level data folder (gitignored). Each platform has a subfolder and a database."""
        return self.root / self.raw["general"].get("data_dir", "data")

    def platform_dir(self, platform: str) -> Path:
        """Where that platform's raw exports go, e.g. data/youtube/watch-history.json."""
        return self.data_root / platform

    def platform_db(self, platform: str) -> Path:
        """That platform's processed database, e.g. data/youtube.db (rebuildable from the exports)."""
        return self.data_root / f"{platform}.db"

    # YouTube shortcuts (the original single-platform names)
    @property
    def data_dir(self) -> Path:
        return self.platform_dir("youtube")

    @property
    def db_path(self) -> Path:
        return self.platform_db("youtube")

    def section(self, name: str) -> dict:
        return self.raw.get(name, {})

    @property
    def api_key(self) -> str | None:
        return os.environ.get("YOUTUBE_API_KEY") or None


def load_config(path: Path | None = None) -> Config:
    path = path or ROOT / "config.toml"
    with open(path, "rb") as f:
        raw = tomllib.load(f)
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        pass
    return Config(raw=raw, root=ROOT)


def migrate_legacy_layout(cfg: Config) -> list[str]:
    """Move files from the original single-platform layout (data/watch-history.json,
    data/wrapped.db) into the per-platform layout (data/youtube/…, data/youtube.db).
    Never overwrites anything. Returns a description of each move."""
    moved = []
    root = cfg.data_root
    yt_dir = cfg.platform_dir("youtube")
    for name in ("watch-history.json", "search-history.json"):
        old, new = root / name, yt_dir / name
        if old.exists() and not new.exists():
            yt_dir.mkdir(parents=True, exist_ok=True)
            old.rename(new)
            moved.append(f"{old.relative_to(cfg.root)} -> {new.relative_to(cfg.root)}")
    old_db, new_db = root / "wrapped.db", cfg.platform_db("youtube")
    if old_db.exists() and not new_db.exists():
        for suffix in ("", "-wal", "-shm"):  # SQLite's side files move with it
            o = old_db.with_name(old_db.name + suffix)
            if o.exists():
                o.rename(new_db.with_name(new_db.name + suffix))
        moved.append(f"{old_db.relative_to(cfg.root)} -> {new_db.relative_to(cfg.root)}")
    return moved


def force_utf8_stdout() -> None:
    """Windows consoles default to cp1252, which can't print many video titles."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
