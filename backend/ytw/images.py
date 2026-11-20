"""Fetch YouTube thumbnails/avatars on behalf of the browser (for PNG export of Wrapped cards).

Strict allowlist: https only, YouTube image hosts only, no redirects followed, images only,
size-capped. Results are kept in a small in-memory cache.
"""
from __future__ import annotations

import threading
import urllib.error
import urllib.request
from collections import OrderedDict
from typing import Callable
from urllib.parse import urlparse

ALLOWED_HOSTS = ("i.ytimg.com", "i1.ytimg.com", "i2.ytimg.com", "i3.ytimg.com", "i4.ytimg.com",
                 "i9.ytimg.com", "yt3.ggpht.com", "yt3.googleusercontent.com")
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
    if u.hostname not in ALLOWED_HOSTS or u.username or u.password or (u.port not in (None, 443)):
        raise NotAllowed("only YouTube image hosts are allowed")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # never follow a redirect off the allowlist
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _http_get(url: str) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "youtube-wrapped-local"})
    try:
        with _opener.open(req, timeout=15) as r:
            ctype = r.headers.get_content_type()
            data = r.read(MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise FetchFailed(f"could not fetch image: {e}") from None
    if len(data) > MAX_BYTES:
        raise FetchFailed("image too large")
    if not ctype.startswith("image/"):
        raise FetchFailed("not an image")
    return data, ctype


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
