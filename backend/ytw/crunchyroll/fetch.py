"""Download your Crunchyroll watch history.

Crunchyroll has no "download your data" button, so this reads the history the website itself
shows you, from Crunchyroll's own (unofficial) web API, signed in with your browser's `etp_rt`
cookie. It is the same approach open-source tools such as CrunchyExporter use:

  1. POST /auth/v1/token  (grant_type=etp_rt_cookie, the web app's public client id)
       -> a short-lived access token
  2. GET  /accounts/v1/me -> your account id
  3. GET  /content/v2/{account}/watch-history?page_size=100, following meta.next_page

Everything Crunchyroll returns is saved as-is to data/crunchyroll/watch-history.json, so no field
is lost before we know which ones matter. The cookie stays in .env; tokens are never written to
disk. Requests are spaced out (one a second) and this is meant for reading your own history only.
"""
from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

API = "https://beta-api.crunchyroll.com"
# Public client id of Crunchyroll's web app (no secret). Override with [crunchyroll] client_id if it changes.
WEB_CLIENT_ID = "noaihdevm_6iyg0a8l0q"
PAGE_SIZE = 100
PAUSE_S = 1.0
HISTORY_FILE = "watch-history.json"

# (method, url, headers, form body or None) -> (status, parsed JSON or None)
Transport = Callable[[str, str, dict, dict | None], tuple[int, dict | None]]


class CrunchyrollError(Exception):
    pass


class CookieExpired(CrunchyrollError):
    pass


def http_transport(method: str, url: str, headers: dict, form: dict | None) -> tuple[int, dict | None]:
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b"null")
        except ValueError:
            body = None
        return e.code, body
    except urllib.error.URLError as e:
        raise CrunchyrollError(f"Network error: {e.reason}") from None


class Client:
    def __init__(self, etp_rt: str, transport: Transport = http_transport, client_id: str = WEB_CLIENT_ID,
                 pause_s: float = PAUSE_S, sleep: Callable[[float], None] = time.sleep):
        if not etp_rt:
            raise CookieExpired("No CRUNCHYROLL_ETP_RT in .env")
        self.etp_rt = etp_rt.strip()
        self.transport = transport
        self.client_id = client_id.rstrip(":")
        self.pause_s = pause_s
        self.sleep = sleep
        self.device_id = str(uuid.uuid4())
        self.token: str | None = None
        self.requests = 0

    def _call(self, method: str, url: str, headers: dict, form: dict | None = None) -> tuple[int, dict | None]:
        self.requests += 1
        for attempt in range(4):
            status, body = self.transport(method, url, headers, form)
            if status == 429 or status >= 500:  # rate-limited or a hiccup: back off and retry
                self.sleep(2 ** (attempt + 1))
                continue
            return status, body
        raise CrunchyrollError(f"Crunchyroll kept answering HTTP {status}; try again later")

    def login(self) -> None:
        basic = base64.b64encode(f"{self.client_id}:".encode()).decode()
        status, body = self._call("POST", f"{API}/auth/v1/token",
                                  {"Authorization": f"Basic {basic}", "Cookie": f"etp_rt={self.etp_rt}"},
                                  {"grant_type": "etp_rt_cookie", "scope": "offline_access", "device_id": self.device_id,
                                   "device_name": "Wrapped history export", "device_type": "com.crunchyroll.desktop.windows"})
        if status in (400, 401, 403) or not body or "access_token" not in body:
            raise CookieExpired(
                f"Crunchyroll didn't accept the cookie (HTTP {status}). Copy a fresh etp_rt from your logged-in browser "
                "(DevTools > Application > Cookies > crunchyroll.com) into CRUNCHYROLL_ETP_RT in .env.")
        self.token = body["access_token"]

    def get(self, url: str) -> dict:
        """GET with the access token; logs in again once if it expired mid-way (they last minutes)."""
        if not self.token:
            self.login()
        for retry in (False, True):
            status, body = self._call("GET", url, {"Authorization": f"Bearer {self.token}"})
            if status == 401 and not retry:
                self.login()
                continue
            if status != 200 or body is None:
                raise CrunchyrollError(f"HTTP {status} from {urllib.parse.urlparse(url).path}")
            return body
        raise CrunchyrollError("Couldn't stay signed in")

    def account_id(self) -> str:
        me = self.get(f"{API}/accounts/v1/me")
        if not me.get("account_id"):
            raise CrunchyrollError("Couldn't read your account id")
        return me["account_id"]

    def history(self, account_id: str, locale: str = "en-US", progress: Callable[[int], None] = lambda n: None) -> list[dict]:
        """Every watch-history item, newest first, exactly as Crunchyroll sends it."""
        url = f"{API}/content/v2/{account_id}/watch-history?" + urllib.parse.urlencode({"page_size": PAGE_SIZE, "locale": locale})
        items: list[dict] = []
        seen: set[str] = set()
        while url and url not in seen:
            seen.add(url)
            body = self.get(url)
            page = body.get("data") or []
            items.extend(page)
            progress(len(items))
            nxt = (body.get("meta") or {}).get("next_page") or ""
            if not page or not nxt:
                break
            url = nxt if nxt.startswith("http") else API + nxt  # an opaque cursor; numeric pages break on long histories
            self.sleep(self.pause_s)
        return items


def fetch_history(folder: Path, etp_rt: str, transport: Transport = http_transport, client_id: str = WEB_CLIENT_ID,
                  locale: str = "en-US", pause_s: float = PAUSE_S, sleep: Callable[[float], None] = time.sleep,
                  progress: Callable[[int], None] = lambda n: None) -> dict:
    """Download the whole history into folder/watch-history.json (replacing the last download)."""
    client = Client(etp_rt, transport, client_id, pause_s, sleep)
    account = client.account_id()
    items = client.history(account, locale, progress)
    folder.mkdir(parents=True, exist_ok=True)
    out = {"source": "crunchyroll watch-history (unofficial web API)", "fetched_at": datetime.now(timezone.utc).isoformat(),
           "locale": locale, "count": len(items), "items": items}
    tmp = folder / (HISTORY_FILE + ".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(folder / HISTORY_FILE)  # only replace the old file once the new one is complete
    dates = sorted(i.get("date_played") for i in items if i.get("date_played"))
    return {"items": len(items), "requests": client.requests, "first": dates[0] if dates else None,
            "last": dates[-1] if dates else None, "file": str(folder / HISTORY_FILE)}
