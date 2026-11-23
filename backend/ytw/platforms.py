"""Every platform the app knows about. The definitions live with each connector
(ytw/connectors/<id>/__init__.py) and the planned ones in ytw/connectors/planned.py.

Only platforms with `implemented=True` can be imported; the rest are listed so the hub page
can show what's coming (each links to its GitHub issue).
"""
from __future__ import annotations

from .connectors import CONNECTORS, PLATFORMS, connector
from .connectors.base import CAPABILITIES, Manifest

Platform = Manifest  # the name the API and stats use

DEFAULT = "youtube"

__all__ = ["CAPABILITIES", "CONNECTORS", "DEFAULT", "PLATFORMS", "Platform", "connector", "get"]


def get(platform_id: str) -> Platform | None:
    return PLATFORMS.get(platform_id)
