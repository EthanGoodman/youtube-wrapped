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
    def data_dir(self) -> Path:
        return self.root / self.raw["general"]["data_dir"]

    @property
    def db_path(self) -> Path:
        return self.root / self.raw["general"]["db_file"]

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


def force_utf8_stdout() -> None:
    """Windows consoles default to cp1252, which can't print many video titles."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
