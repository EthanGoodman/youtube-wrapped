"""OAuth for a desktop app, done once and correctly (RFC 8252, RFC 7636, RFC 8628, RFC 7009).

- Authorization code + PKCE (S256). The browser comes back to the app itself on the loopback
  address: http://127.0.0.1:{port}/oauth/callback. Each sign-in has a random, single-use `state`
  that expires after 10 minutes, so a forged or replayed callback is refused.
- Device-code flow for providers that offer it (show a code, the user enters it on the site).
- Tokens live only in the secrets store (OS keychain), as separate entries because Windows
  Credential Manager caps the size of one entry. They're refreshed a minute before expiry; a
  rotated refresh token replaces the old one; a refused refresh wipes them and asks to reconnect.
- Disconnect revokes the token at the provider (if it has an endpoint), then wipes it locally.
- Scopes are declared per connector (OAuthSpec in its manifest): ask for the least needed.

The person signs in themselves, in their own browser; the app only builds the link.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets as _random
import threading
import time
import urllib.parse
from dataclasses import dataclass, field

from . import net, secrets

STATE_TTL_S = 600
REFRESH_EARLY_S = 60


class OAuthError(Exception):
    """Sign-in or token problem; the message is safe to show."""


class NotConnected(OAuthError):
    pass


@dataclass(frozen=True)
class OAuthSpec:
    authorize_url: str
    token_url: str
    scopes: tuple[str, ...]                  # least privilege: only what the stats need
    client_id_name: str                      # secrets-store name of the user's app client id
    client_secret_name: str | None = None    # only for providers that insist on one (PKCE apps don't)
    revoke_url: str | None = None
    device_url: str | None = None            # RFC 8628 device authorization endpoint, if offered
    scope_separator: str = " "
    extra_params: tuple[tuple[str, str], ...] = ()

    def __post_init__(self):
        for u in (self.authorize_url, self.token_url, self.revoke_url, self.device_url):
            if u is not None and not u.startswith("https://"):
                raise ValueError(f"OAuth endpoints must be https: {u}")
        if not self.scopes:
            raise ValueError("declare the scopes the connector needs")


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def pkce_pair() -> tuple[str, str]:
    """(code_verifier, S256 code_challenge)."""
    verifier = _b64url(_random.token_bytes(48))           # 64 chars, within RFC 7636's 43..128
    return verifier, _b64url(hashlib.sha256(verifier.encode()).digest())


@dataclass
class _Pending:
    platform: str
    verifier: str
    redirect_uri: str
    created: float = field(default_factory=time.time)


@dataclass
class _Device:
    device_code: str
    interval: float
    expires: float
    next_poll: float = 0.0


def _names(pid: str) -> tuple[str, str, str]:
    p = pid.upper()
    return f"OAUTH_{p}_ACCESS", f"OAUTH_{p}_REFRESH", f"OAUTH_{p}_META"


class OAuth:
    def __init__(self, clock=time.time):
        self.clock = clock
        self._pending: dict[str, _Pending] = {}
        self._devices: dict[str, _Device] = {}
        self._lock = threading.Lock()

    # -- helpers ------------------------------------------------------------------
    @staticmethod
    def _client(spec: OAuthSpec) -> dict[str, str]:
        cid = secrets.get(spec.client_id_name)
        if not cid:
            raise OAuthError(f"Save the app's client ID ({spec.client_id_name}) first.")
        out = {"client_id": cid}
        if spec.client_secret_name:
            sec = secrets.get(spec.client_secret_name)
            if not sec:
                raise OAuthError(f"Save the app's client secret ({spec.client_secret_name}) first.")
            out["client_secret"] = sec
        return out

    def _token_call(self, spec: OAuthSpec, form: dict) -> tuple[int, dict]:
        try:
            r = net.request("POST", spec.token_url, form=form, retries=2)
        except net.NetError as e:
            raise OAuthError(f"Couldn't reach the sign-in server: {e}") from None
        body = r.json({})
        return r.status, body if isinstance(body, dict) else {}

    def _save(self, pid: str, body: dict, keep_refresh: str | None = None) -> None:
        access = body.get("access_token")
        if not isinstance(access, str) or not access:
            raise OAuthError("The provider didn't return an access token.")
        a, r, m = _names(pid)
        st = secrets.store()
        st.set(a, access)
        refresh = body.get("refresh_token") or keep_refresh     # rotated -> the new one wins
        if refresh:
            st.set(r, refresh)
        expires_in = body.get("expires_in")
        meta = {"expires_at": self.clock() + float(expires_in) if isinstance(expires_in, (int, float)) else None,
                "scope": body.get("scope"), "token_type": body.get("token_type", "Bearer")}
        st.set(m, json.dumps(meta))

    def wipe(self, pid: str) -> None:
        st = secrets.store()
        for n in _names(pid):
            st.delete(n)

    def connected(self, pid: str) -> bool:
        return bool(secrets.store().get(_names(pid)[0]))

    # -- authorization code + PKCE -----------------------------------------------
    def start(self, pid: str, spec: OAuthSpec, redirect_uri: str) -> str:
        """The URL to open in the user's browser."""
        client = self._client(spec)
        verifier, challenge = pkce_pair()
        state = _random.token_urlsafe(32)
        now = self.clock()
        with self._lock:
            # one sign-in in flight per platform; drop expired ones
            self._pending = {s: p for s, p in self._pending.items()
                             if now - p.created < STATE_TTL_S and p.platform != pid}
            self._pending[state] = _Pending(pid, verifier, redirect_uri, now)
        q = {"response_type": "code", "client_id": client["client_id"], "redirect_uri": redirect_uri,
             "scope": spec.scope_separator.join(spec.scopes), "state": state,
             "code_challenge": challenge, "code_challenge_method": "S256", **dict(spec.extra_params)}
        return spec.authorize_url + ("&" if "?" in spec.authorize_url else "?") + urllib.parse.urlencode(q)

    def finish(self, state: str | None, code: str | None, error: str | None, specs: dict[str, OAuthSpec]) -> str:
        """Handle the browser coming back. Returns the platform id that's now connected."""
        with self._lock:
            pending = self._pending.pop(state or "", None)        # single use, even when it fails
        if pending is None:
            raise OAuthError("This sign-in link is unknown or was already used. Start again from Data sources.")
        if self.clock() - pending.created > STATE_TTL_S:
            raise OAuthError("This sign-in took too long. Start again from Data sources.")
        if error:
            raise OAuthError("Sign-in was cancelled." if error == "access_denied" else f"Sign-in failed ({error[:40]}).")
        if not code:
            raise OAuthError("The provider didn't send a sign-in code.")
        spec = specs[pending.platform]
        status, body = self._token_call(spec, {
            "grant_type": "authorization_code", "code": code, "redirect_uri": pending.redirect_uri,
            "code_verifier": pending.verifier, **self._client(spec)})
        if status != 200:
            raise OAuthError(f"The provider refused the sign-in ({body.get('error', status)}).")
        self._save(pending.platform, body)
        return pending.platform

    # -- device code ----------------------------------------------------------------
    def device_start(self, pid: str, spec: OAuthSpec) -> dict:
        if not spec.device_url:
            raise OAuthError("This provider has no device sign-in.")
        client = self._client(spec)
        try:
            r = net.request("POST", spec.device_url, retries=2,
                            form={"client_id": client["client_id"], "scope": spec.scope_separator.join(spec.scopes)})
        except net.NetError as e:
            raise OAuthError(f"Couldn't reach the sign-in server: {e}") from None
        body = r.json({})
        if r.status != 200 or not isinstance(body, dict) or "device_code" not in body:
            raise OAuthError("The provider didn't start a device sign-in.")
        now = self.clock()
        self._devices[pid] = _Device(body["device_code"], float(body.get("interval", 5)),
                                     now + float(body.get("expires_in", 600)))
        return {"user_code": body.get("user_code"),
                "verification_uri": body.get("verification_uri_complete") or body.get("verification_uri"),
                "expires_in": body.get("expires_in"), "interval": body.get("interval", 5)}

    def device_poll(self, pid: str, spec: OAuthSpec) -> str:
        """pending | connected (raises OAuthError when it can't succeed any more)."""
        d = self._devices.get(pid)
        if d is None:
            raise OAuthError("No device sign-in in progress.")
        now = self.clock()
        if now > d.expires:
            self._devices.pop(pid, None)
            raise OAuthError("The code expired. Start again.")
        if now < d.next_poll:
            return "pending"
        d.next_poll = now + d.interval
        status, body = self._token_call(spec, {
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": d.device_code,
            **self._client(spec)})
        if status == 200 and body.get("access_token"):
            self._devices.pop(pid, None)
            self._save(pid, body)
            return "connected"
        err = body.get("error")
        if err == "authorization_pending":
            return "pending"
        if err == "slow_down":
            d.interval += 5
            d.next_poll = now + d.interval
            return "pending"
        self._devices.pop(pid, None)
        raise OAuthError({"access_denied": "Sign-in was cancelled.",
                          "expired_token": "The code expired. Start again."}.get(err, f"Sign-in failed ({err or status})."))

    # -- using and ending a connection -------------------------------------------
    def access_token(self, pid: str, spec: OAuthSpec) -> str:
        """A valid access token, refreshed first if it's about to expire."""
        a, r, m = _names(pid)
        st = secrets.store()
        access = st.get(a)
        if not access:
            raise NotConnected("Not connected. Connect it on the Data sources page.")
        try:
            meta = json.loads(st.get(m) or "{}")
        except ValueError:
            meta = {}
        expires_at = meta.get("expires_at")
        if expires_at is None or self.clock() < expires_at - REFRESH_EARLY_S:
            return access
        refresh = st.get(r)
        if not refresh:
            self.wipe(pid)
            raise NotConnected("The sign-in expired. Connect again on the Data sources page.")
        status, body = self._token_call(spec, {"grant_type": "refresh_token", "refresh_token": refresh,
                                               **self._client(spec)})
        if status != 200:
            if body.get("error") in ("invalid_grant", "invalid_token", "unauthorized_client") or status in (400, 401):
                self.wipe(pid)
                raise NotConnected("The provider ended this sign-in. Connect again on the Data sources page.")
            raise OAuthError(f"Couldn't refresh the sign-in ({body.get('error', status)}); try again later.")
        self._save(pid, body, keep_refresh=refresh)
        return st.get(a)

    def disconnect(self, pid: str, spec: OAuthSpec) -> bool:
        """Revoke at the provider (best effort), then wipe locally. True if the provider confirmed."""
        a, r, _ = _names(pid)
        st = secrets.store()
        token, hint = (st.get(r), "refresh_token") if st.get(r) else (st.get(a), "access_token")
        revoked = False
        if token and spec.revoke_url:
            try:
                form = {"token": token, "token_type_hint": hint}
                try:
                    form.update(self._client(spec))
                except OAuthError:
                    pass
                revoked = net.request("POST", spec.revoke_url, form=form, retries=1).status == 200
            except net.NetError:
                revoked = False                       # still wipe locally: the user asked to disconnect
        self.wipe(pid)
        return revoked
