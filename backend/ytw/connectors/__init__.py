"""Platform connectors, found automatically: every package in this folder with a CONNECTOR.

    PLATFORMS    {id: Manifest} for every platform, built or planned, in hub order
    CONNECTORS   {id: Connector class} for the ones that can import data
"""
from __future__ import annotations

import importlib
import pkgutil
from typing import TYPE_CHECKING

from .base import Connector, Manifest
from .allgames import MANIFEST as ALLGAMES
from .planned import PLANNED

if TYPE_CHECKING:
    from ..config import Config


def _discover() -> dict[str, type[Connector]]:
    found: dict[str, type[Connector]] = {}
    for m in pkgutil.iter_modules(__path__):
        if not m.ispkg:
            continue
        cls = getattr(importlib.import_module(f"{__name__}.{m.name}"), "CONNECTOR", None)
        if cls is None:
            continue
        if cls.manifest.id != m.name:
            raise ValueError(f"connectors/{m.name}: manifest id is {cls.manifest.id!r}; they must match")
        found[m.name] = cls
    return found


CONNECTORS: dict[str, type[Connector]] = _discover()
# platforms without a connector of their own: planned ones, and views built from others (All games)
_all = [c.manifest for c in CONNECTORS.values()] + [p for p in PLANNED if p.id not in CONNECTORS] + [ALLGAMES]
PLATFORMS: dict[str, Manifest] = {p.id: p for p in sorted(_all, key=lambda p: (p.order, p.id))}


def connector(platform_id: str, cfg: "Config") -> Connector | None:
    cls = CONNECTORS.get(platform_id)
    return cls(cfg) if cls else None
