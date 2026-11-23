"""Protection for the local server.

The app serves your whole history on localhost, and any website you visit can try to reach it:
- DNS rebinding: a site re-points its own hostname at 127.0.0.1 and reads the API "same-origin".
  Stopped by only answering requests whose Host header is localhost / 127.0.0.1.
- Cross-site requests: any page can send simple GETs/POSTs to localhost (no CORS needed to *send*).
  Stopped by a per-install token that only the app's own page has (injected into index.html), and by
  rejecting writes whose Origin is another site.
- Clickjacking / injected content: strict security headers on every response.
"""
from __future__ import annotations

import hmac
import os
import secrets
from pathlib import Path

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

TOKEN_HEADER = "X-Wrapped-Token"
TOKEN_PARAM = "t"            # only for /api/img: <img src> can't send headers
LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "[::1]"})
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# API paths that need no token: they expose nothing personal
PUBLIC_API = frozenset({"/api/build"})

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",      # a few inline <style>/style attributes (keyframes, charts)
    "img-src 'self' data: blob: https:",     # posters/thumbnails load straight from the platforms' image hosts
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",             # no other site may frame the app (clickjacking)
])
HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "SAMEORIGIN",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}


def load_or_create_token(path: Path) -> str:
    """The per-install secret: made once, kept in a file only this user can read.
    (Moves to the OS keychain with the secrets store.)"""
    try:
        token = path.read_text(encoding="utf-8").strip()
        if len(token) >= 32:
            return token
    except OSError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(token)
    return token


def _host(request: Request) -> str:
    host = request.headers.get("host", "")
    if host.startswith("["):                       # [::1]:8000
        return host[: host.find("]") + 1]
    return host.rsplit(":", 1)[0] if ":" in host else host


def _same(a: str | None, b: str) -> bool:
    return a is not None and hmac.compare_digest(a.encode(), b.encode())


class SecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, token: str, allowed_hosts: frozenset[str] = LOCAL_HOSTS,
                 require_token: bool = True, any_host: bool = False):
        super().__init__(app)
        self.token = token
        self.allowed_hosts = allowed_hosts
        self.require_token = require_token
        self.any_host = any_host            # --lan: other devices use the machine's IP; the token still guards everything

    def _deny(self, status: int, message: str) -> Response:
        return self._secure(JSONResponse({"detail": message}, status_code=status))

    def _secure(self, response: Response) -> Response:
        for k, v in HEADERS.items():
            response.headers.setdefault(k, v)
        return response

    async def dispatch(self, request: Request, call_next) -> Response:
        if not self.any_host and _host(request) not in self.allowed_hosts:
            return self._deny(400, "invalid host")
        path = request.url.path
        if request.method not in SAFE_METHODS:
            origin = request.headers.get("origin")
            if origin and origin != f"{request.url.scheme}://{request.headers.get('host', '')}":
                return self._deny(403, "cross-origin request refused")
        if self.require_token and path.startswith("/api/") and path not in PUBLIC_API:
            sent = request.headers.get(TOKEN_HEADER)
            if sent is None and path == "/api/img":
                sent = request.query_params.get(TOKEN_PARAM)
            if not _same(sent, self.token):
                return self._deny(401, "missing or invalid app token")
        return self._secure(await call_next(request))


def inject_token(html: str, token: str) -> str:
    """Give the app's own page the token (other sites can't read this page: no CORS, Host-checked)."""
    tag = f'<meta name="wrapped-token" content="{token}">'
    return html.replace("</head>", f"  {tag}\n  </head>", 1) if "</head>" in html else tag + html
