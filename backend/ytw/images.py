"""Fetch posters, thumbnails and avatars for the browser (for PNG export of Wrapped cards).

The URLs come from imported data, so this is built not to be an open proxy (SSRF):
- only https, only the image hosts and path prefixes the platforms declare (platforms.py), no
  credentials, no other ports, no dot-segment or encoded-slash tricks in the path
- the host's DNS answer is checked: any private, loopback or link-local address is refused, and
  the connection goes to the vetted IP (net.request(public_only=True)); no redirects followed
- 5 s timeout, byte cap, and the bytes must really be a PNG, JPEG, WebP or GIF (never SVG,
  which can carry script); the server's Content-Type is ignored
- the /api/img route also needs the app token, so other sites can't use it either
Results are kept in a small in-memory cache.
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Callable
from urllib.parse import unquote, urlsplit

from . import net, platforms

MAX_BYTES = 5 * 1024 * 1024
TIMEOUT_S = 5.0
_CACHE_SIZE = 300
_CACHE_BYTES = 64 * 1024 * 1024


class NotAllowed(Exception):
    pass


class FetchFailed(Exception):
    pass


def allowed_hosts() -> dict[str, tuple[str, ...]]:
    """{host: allowed path prefixes}, from every platform's declared image hosts."""
    out: dict[str, tuple[str, ...]] = {}
    for p in platforms.PLATFORMS.values():
        for host, prefix in p.image_hosts:
            out[host] = out.get(host, ()) + (prefix,)
    return out


def check_url(url: str) -> None:
    try:
        u = urlsplit(url)
        port = u.port
    except ValueError:
        raise NotAllowed("not a URL") from None
    if u.scheme != "https":
        raise NotAllowed("only https image URLs are allowed")
    prefixes = allowed_hosts().get(u.hostname or "")
    if not prefixes or u.username or u.password or port not in (None, 443):
        raise NotAllowed("only the platforms' image hosts are allowed")
    path = u.path or "/"
    decoded = unquote(path)
    # the path must mean exactly what it says: no ../, no backslashes, no encoded slashes
    if ("\\" in decoded or "%2f" in path.lower() or "%5c" in path.lower()
            or any(seg in (".", "..") for seg in decoded.split("/"))):
        raise NotAllowed("odd image path")
    if not any(path.startswith(p) for p in prefixes):
        raise NotAllowed("only the platforms' image paths are allowed")


def sniff(data: bytes) -> str | None:
    """The image type from its first bytes; None for anything else (SVG, HTML, …)."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def _http_get(url: str) -> tuple[bytes, str]:
    try:
        r = net.request("GET", url, headers={"Accept": "image/webp,image/png,image/jpeg,image/gif"},
                        timeout=TIMEOUT_S, max_bytes=MAX_BYTES, retries=0, public_only=True)
    except net.Blocked as e:
        raise NotAllowed(str(e)) from None
    except net.TooLarge:
        raise FetchFailed("image too large") from None
    except net.NetError as e:
        raise FetchFailed(f"could not fetch image: {e}") from None
    if r.status != 200:
        raise FetchFailed(f"could not fetch image: HTTP {r.status}")
    ctype = sniff(r.body)
    if not ctype:
        raise FetchFailed("not a PNG, JPEG, WebP or GIF image")
    return r.body, ctype


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
        while len(_cache) > _CACHE_SIZE or (len(_cache) > 1 and sum(len(d) for d, _ in _cache.values()) > _CACHE_BYTES):
            _cache.popitem(last=False)
    return result
