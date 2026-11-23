"""Download your Crunchyroll watch history.

Crunchyroll has no "download your data" button, so this reads the history the website itself
shows you, from Crunchyroll's own (unofficial) web API, signed in with your browser's `etp_rt`
cookie. It is the same approach open-source tools such as CrunchyExporter use:

  1. POST /auth/v1/token  (grant_type=etp_rt_cookie, the web app's public client id)
       -> a short-lived access token
  2. GET  /accounts/v1/me -> your account id
  3. GET  /content/v2/{account}/watch-history?page_size=100, following meta.next_page

Everything Crunchyroll returns is saved as-is to data/crunchyroll/watch-history.json, so no field
is lost before we know which ones matter. The cookie stays in the OS keychain; tokens are never
written to disk. Requests are spaced out (one a second) and this is meant for reading your own history only.
"""
from __future__ import annotations

import base64
import json
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .. import net

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


class WrongProfile(CrunchyrollError):
    pass


def http_transport(method: str, url: str, headers: dict, form: dict | None) -> tuple[int, dict | None]:
    # Client retries itself (with its own pacing), so one attempt here
    try:
        r = net.request(method, url, headers={"User-Agent": "Mozilla/5.0", **headers}, form=form, retries=0)
    except net.NetError as e:
        raise CrunchyrollError(str(e)) from None
    return r.status, r.json()


class Client:
    def __init__(self, etp_rt: str, transport: Transport = http_transport, client_id: str = WEB_CLIENT_ID,
                 pause_s: float = PAUSE_S, sleep: Callable[[float], None] = time.sleep):
        if not etp_rt:
            raise CookieExpired("No CRUNCHYROLL_ETP_RT saved. Run: python backend/cli.py secrets set CRUNCHYROLL_ETP_RT")
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
                "(DevTools > Application > Cookies > crunchyroll.com), then run: python backend/cli.py secrets set CRUNCHYROLL_ETP_RT")
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

    def selected_profile(self) -> tuple[str | None, list[str]]:
        """(name of the profile this session is on, every profile name on the account).

        A Crunchyroll account can have several profiles (one per person); the history endpoint
        returns the history of the profile the browser session is on."""
        body = self.get(f"{API}/accounts/v1/me/multiprofile")
        profiles = body.get("profiles") or []
        names = [p.get("profile_name") or p.get("username") or "?" for p in profiles]
        current = next((p.get("profile_name") or p.get("username") for p in profiles if p.get("is_selected")), None)
        return current, names

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
                  progress: Callable[[int], None] = lambda n: None, profile: str | None = None) -> dict:
    """Download the whole history into folder/watch-history.json (replacing the last download).
    With `profile`, refuses to download unless the session is on that profile (only your own history)."""
    client = Client(etp_rt, transport, client_id, pause_s, sleep)
    current, names = client.selected_profile()
    if profile and (current or "").casefold() != profile.casefold():
        raise WrongProfile(
            f"This Crunchyroll session is on the profile {current or '(none)'!r}, not {profile!r}. On crunchyroll.com pick "
            f"the {profile} profile, then copy etp_rt again and run: python backend/cli.py secrets set CRUNCHYROLL_ETP_RT. (Profiles on the account: {', '.join(names)})")
    account = client.account_id()
    items = client.history(account, locale, progress)
    folder.mkdir(parents=True, exist_ok=True)
    out = {"source": "crunchyroll watch-history (unofficial web API)", "fetched_at": datetime.now(timezone.utc).isoformat(),
           "profile": current, "locale": locale, "count": len(items), "items": items}
    tmp = folder / (HISTORY_FILE + ".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(folder / HISTORY_FILE)  # only replace the old file once the new one is complete
    dates = sorted(i.get("date_played") for i in items if i.get("date_played"))
    return {"items": len(items), "requests": client.requests, "profile": current, "first": dates[0] if dates else None,
            "last": dates[-1] if dates else None, "file": str(folder / HISTORY_FILE)}
