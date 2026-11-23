"""The one way this app talks to the internet.

Every outgoing request goes through `request()`, so they all get the same safety:
- https only, a timeout on every call, and a cap on how many bytes are read
- retries for network errors, 429 and 5xx: exponential backoff with full jitter, honoring
  Retry-After (capped), so a flaky API isn't hammered
- an optional minimum gap between requests to one host (polite rate limiting)
- a per-host circuit breaker: after repeated failures, calls fail fast for a while instead of
  hanging on a service that's down
- a generic User-Agent (nothing about you), and debug logs with secrets masked

The transport is swappable, so tests never touch the network. Callers decide what a status code
means for them; `request()` only raises `NetError` when there's no usable response at all.
"""
from __future__ import annotations

import http.client
import ipaddress
import json as _json
import logging
import random
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

from .secrets import redact

USER_AGENT = "wrapped-stats/1.0 (personal stats app)"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_BYTES = 20 * 1024 * 1024          # big enough for any JSON page we fetch, small enough to be safe
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
BACKOFF_BASE = 1.0
BACKOFF_CAP = 30.0
RETRY_AFTER_CAP = 120.0
BREAKER_FAILURES = 5                           # consecutive failed calls to one host...
BREAKER_COOLDOWN = 60.0                        # ...make it fail fast for this long

log = logging.getLogger("ytw.net")


class NetError(Exception):
    """No usable response: network failure, the host is failing, or a cap was hit."""


class TooLarge(NetError):
    pass


class Blocked(NetError):
    """The host resolves to an address that isn't on the public internet (SSRF guard)."""


@dataclass
class Request:
    method: str
    url: str
    headers: dict[str, str]
    body: bytes | None
    timeout: float
    max_bytes: int
    follow_redirects: bool
    public_only: bool = False      # resolve, refuse non-public IPs, connect to the vetted IP


@dataclass
class Response:
    status: int
    headers: dict[str, str] = field(default_factory=dict)   # lower-cased names
    body: bytes = b""

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def content_type(self) -> str:
        return self.headers.get("content-type", "").split(";")[0].strip().lower()

    def json(self, default=None):
        """The body as JSON, or `default` when it's empty or not JSON."""
        if not self.body:
            return default
        try:
            return _json.loads(self.body)
        except ValueError:
            return default


# (request) -> response; raises OSError/URLError for network failures
Transport = Callable[[Request], Response]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # hand the 3xx back to the caller instead
        return None


_follow = urllib.request.build_opener()
_no_follow = urllib.request.build_opener(_NoRedirect)


# -- public-only connections (the image relay) ---------------------------------
# (host, port) -> resolved IP strings
Resolver = Callable[[str, int], list[str]]


def system_resolver(host: str, port: int) -> list[str]:
    return [ai[4][0] for ai in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]


resolver: Resolver = system_resolver  # replaced in tests


def vet_addresses(host: str, addrs: list[str]) -> str:
    """The address to connect to, if every address the host resolves to is public; else Blocked.
    (All of them, not just one: a rebinding host can answer with a public and a private IP.)"""
    if not addrs:
        raise NetError(f"{host} doesn't resolve")
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%", 1)[0])
        mapped = getattr(ip, "ipv4_mapped", None)
        if not ip.is_global or (mapped is not None and not mapped.is_global):
            raise Blocked(f"{host} resolves to a non-public address")
    return addrs[0]


class _PinnedHTTPS(http.client.HTTPSConnection):
    """HTTPS to an already-vetted IP, with the certificate still checked against the hostname,
    so DNS can't be swapped between the check and the connection."""

    def __init__(self, host: str, ip: str, port: int, timeout: float):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def pinned_transport(req: Request) -> Response:
    u = urllib.parse.urlsplit(req.url)
    port = u.port or 443
    ip = vet_addresses(u.hostname, resolver(u.hostname, port))
    conn = _PinnedHTTPS(u.hostname, ip, port, req.timeout)
    try:
        conn.request(req.method, (u.path or "/") + (f"?{u.query}" if u.query else ""), body=req.body,
                     headers=req.headers)
        resp = conn.getresponse()               # never follows redirects
        body = resp.read(req.max_bytes + 1)
        return Response(resp.status, {k.lower(): v for k, v in resp.getheaders()}, body)
    finally:
        conn.close()


def default_transport(req: Request) -> Response:
    return pinned_transport(req) if req.public_only else urllib_transport(req)


def urllib_transport(req: Request) -> Response:
    r = urllib.request.Request(req.url, data=req.body, method=req.method, headers=req.headers)
    opener = _follow if req.follow_redirects else _no_follow
    try:
        resp = opener.open(r, timeout=req.timeout)
    except urllib.error.HTTPError as e:   # 4xx/5xx (and unfollowed 3xx) still carry a response
        resp = e
    with resp:
        body = resp.read(req.max_bytes + 1)
        return Response(resp.status if hasattr(resp, "status") else resp.code,
                        {k.lower(): v for k, v in resp.headers.items()}, body)


def _retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return min(max(float(value), 0.0), RETRY_AFTER_CAP)
    except ValueError:
        return None                                  # HTTP-date form: fall back to our own backoff


class Http:
    def __init__(self, transport: Transport = default_transport, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic, rand: Callable[[], float] = random.random):
        self.transport = transport
        self.sleep = sleep
        self.clock = clock
        self.rand = rand
        self._lock = threading.Lock()
        self._min_gap: dict[str, float] = {}
        self._last: dict[str, float] = {}
        self._fails: dict[str, int] = {}
        self._open_until: dict[str, float] = {}

    def rate_limit(self, host: str, min_gap_s: float) -> None:
        """Leave at least `min_gap_s` seconds between requests to `host`."""
        self._min_gap[host] = min_gap_s

    def _backoff(self, attempt: int) -> float:
        return self.rand() * min(BACKOFF_CAP, BACKOFF_BASE * 2 ** attempt)   # "full jitter"

    def _wait_turn(self, host: str) -> None:
        gap = self._min_gap.get(host)
        if not gap:
            return
        with self._lock:
            now = self.clock()
            start = max(now, self._last.get(host, -gap) + gap)
            self._last[host] = start
        if start > now:
            self.sleep(start - now)

    def _check_breaker(self, host: str) -> None:
        with self._lock:
            until = self._open_until.get(host)
            if until is None:
                return
            if self.clock() < until:
                raise NetError(f"{host} keeps failing; try again in a minute")
            del self._open_until[host]               # cooled down: let one call through to test it

    def _record(self, host: str, failed: bool) -> None:
        with self._lock:
            if not failed:
                self._fails.pop(host, None)
                return
            self._fails[host] = self._fails.get(host, 0) + 1
            if self._fails[host] >= BREAKER_FAILURES:
                self._open_until[host] = self.clock() + BREAKER_COOLDOWN
                self._fails[host] = 0
                log.warning("%s failed %d times in a row; pausing calls to it for %ds",
                            host, BREAKER_FAILURES, BREAKER_COOLDOWN)

    def request(self, method: str, url: str, *, params: dict | None = None, headers: dict | None = None,
                json=None, form: dict | None = None, timeout: float = DEFAULT_TIMEOUT,
                max_bytes: int = DEFAULT_MAX_BYTES, retries: int = 3,
                follow_redirects: bool = True, public_only: bool = False) -> Response:
        """Send a request; retry what's worth retrying. Returns the final response, whatever its
        status (after retries, a 429/5xx is returned for the caller to explain). Raises NetError
        when no response arrives, the body is over `max_bytes`, or the host's breaker is open.
        public_only: for URLs that come from data rather than code (the image relay): refuse hosts
        that resolve to private/loopback/link-local addresses (Blocked) and never follow redirects."""
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        u = urllib.parse.urlsplit(url)
        if u.scheme != "https" or not u.hostname:
            raise NetError("only https URLs are allowed")
        host = u.hostname
        hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        body = None
        if json is not None:
            body = _json.dumps(json).encode()
            hdrs["Content-Type"] = "application/json"
        elif form is not None:
            body = urllib.parse.urlencode(form).encode()
            hdrs["Content-Type"] = "application/x-www-form-urlencoded"
        hdrs.update(headers or {})
        req = Request(method.upper(), url, hdrs, body, timeout, max_bytes,
                      follow_redirects and not public_only, public_only)

        self._check_breaker(host)
        for attempt in range(retries + 1):
            last = attempt == retries
            self._wait_turn(host)
            try:
                resp = self.transport(req)
            except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
                reason = getattr(e, "reason", e)
                log.debug("%s %s -> network error %s", req.method, redact(url), reason)
                if last:
                    self._record(host, failed=True)
                    raise NetError(f"Network error reaching {host}: {reason}") from None
                self.sleep(self._backoff(attempt))
                continue
            log.debug("%s %s -> %s", req.method, redact(url), resp.status)
            if len(resp.body) > max_bytes:
                raise TooLarge(f"response from {host} is over {max_bytes:,} bytes")
            if resp.status in RETRY_STATUSES and not last:
                self.sleep(_retry_after(resp.headers.get("retry-after")) or self._backoff(attempt))
                continue
            self._record(host, failed=resp.status >= 500)
            return resp
        raise AssertionError("unreachable")


client = Http()


def request(method: str, url: str, **kwargs) -> Response:
    return client.request(method, url, **kwargs)
