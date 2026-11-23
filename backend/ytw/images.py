"""Fetch YouTube thumbnails/avatars on behalf of the browser (for PNG export of Wrapped cards).

Strict allowlist: https only, YouTube image hosts only, no redirects followed, images only,
size-capped. Results are kept in a small in-memory cache.
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Callable
from urllib.parse import urlparse

from . import net

ALLOWED_HOSTS = ("i.ytimg.com", "i1.ytimg.com", "i2.ytimg.com", "i3.ytimg.com", "i4.ytimg.com",
                 "i9.ytimg.com", "yt3.ggpht.com", "yt3.googleusercontent.com",
                 "image.tmdb.org")  # TMDB posters (Netflix)
# hosts allowed only under one path (Crunchyroll serves images from its main site)
ALLOWED_PATHS = {"www.crunchyroll.com": "/imgsrv/"}
MAX_BYTES = 5 * 1024 * 1024
_CACHE_SIZE = 300


class NotAllowed(Exception):
    pass


class FetchFailed(Exception):
    pass


def check_url(url: str) -> None:
    try:
        u = urlparse(url)
    except ValueError:
        raise NotAllowed("not a URL") from None
    if u.scheme != "https":
        raise NotAllowed("only https image URLs are allowed")
    host_ok = u.hostname in ALLOWED_HOSTS or (u.hostname in ALLOWED_PATHS and u.path.startswith(ALLOWED_PATHS[u.hostname]))
    if not host_ok or u.username or u.password or (u.port not in (None, 443)):
        raise NotAllowed("only the platforms' image hosts are allowed")


def _http_get(url: str) -> tuple[bytes, str]:
    # one attempt, no redirects (a redirect could leave the allowlist), size-capped, images only
    try:
        r = net.request("GET", url, headers={"Accept": "image/*"}, timeout=15, max_bytes=MAX_BYTES,
                        retries=0, follow_redirects=False)
    except net.TooLarge:
        raise FetchFailed("image too large") from None
    except net.NetError as e:
        raise FetchFailed(f"could not fetch image: {e}") from None
    if r.status != 200:
        raise FetchFailed(f"could not fetch image: HTTP {r.status}")
    if not r.content_type.startswith("image/"):
        raise FetchFailed("not an image")
    return r.body, r.content_type


_cache: OrderedDict[str, tuple[bytes, str]] = OrderedDict()
_lock = threading.Lock()
getter: Callable[[str], tuple[bytes, str]] = _http_get  # replaced in tests


def fetch(url: str) -> tuple[bytes, str]:
    check_url(url)
    with _lock:
        if url in _cache:
            _cache.move_to_end(url)
            return _cache[url]
    result = getter(url)
    with _lock:
        _cache[url] = result
        if len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return result
