"""OAuth (#17) against a fake provider: PKCE, state, replay, expiry, refresh, rotation, revoke, device flow.
No real provider is ever contacted."""
import base64
import copy
import hashlib
import json
import urllib.parse

import pytest
from conftest import make_client
from test_secrets import FakeKeyring

from ytw import net, secrets
from ytw.api import create_app
from ytw.config import load_config
from ytw.connectors import CONNECTORS, PLATFORMS
from ytw.connectors.base import Connector, Manifest, vocab
from ytw.oauth import NotConnected, OAuth, OAuthError, OAuthSpec, pkce_pair

SPEC = OAuthSpec("https://auth.example/authorize", "https://auth.example/token", ("read-history",),
                 "DEMO_CLIENT_ID", revoke_url="https://auth.example/revoke", device_url="https://auth.example/device")


class Demo(Connector):
    manifest = Manifest("demo", "Demo", True, "demo", vocab("artist", "artists", "track", "tracks"),
                        export_steps=("Connect your account",), auth="oauth", secrets=("DEMO_CLIENT_ID",), oauth=SPEC)


class FakeProvider:
    """Token, revoke and device endpoints; checks PKCE and the client id like a real one."""

    def __init__(self):
        self.challenges: dict[str, str] = {}           # code -> challenge it was issued for
        self.n = 0
        self.refresh_ok = True
        self.revoked: list[tuple[str, str]] = []
        self.device_answers: list[dict] = []
        self.down = False
        self.seen: list[dict] = []

    def issue(self, code: str, challenge: str):
        self.challenges[code] = challenge

    def tokens(self, **extra):
        self.n += 1
        return {"access_token": f"access-{self.n}", "refresh_token": f"refresh-{self.n}", "expires_in": 3600,
                "token_type": "Bearer", "scope": "read-history", **extra}

    def __call__(self, req: net.Request) -> net.Response:
        if self.down:
            raise OSError("provider unreachable")
        form = {k: v[0] for k, v in urllib.parse.parse_qs((req.body or b"").decode()).items()}
        self.seen.append(form)
        ok = lambda body: net.Response(200, {"content-type": "application/json"}, json.dumps(body).encode())  # noqa: E731
        bad = lambda err, status=400: net.Response(status, {}, json.dumps({"error": err}).encode())  # noqa: E731
        if form.get("client_id") != "demo-client":
            return bad("invalid_client", 401)
        if req.url == SPEC.revoke_url:
            self.revoked.append((form["token"], form["token_type_hint"]))
            return ok({})
        if req.url == SPEC.device_url:
            return ok({"device_code": "dev-123", "user_code": "WXYZ-1234", "verification_uri": "https://auth.example/activate",
                       "interval": 5, "expires_in": 600})
        g = form.get("grant_type")
        if g == "authorization_code":
            challenge = self.challenges.pop(form.get("code"), None)     # codes are single use too
            verifier = form.get("code_verifier", "")
            if challenge is None:
                return bad("invalid_grant")
            if base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode() != challenge:
                return bad("invalid_grant")                              # PKCE mismatch
            return ok(self.tokens())
        if g == "refresh_token":
            if not self.refresh_ok or form.get("refresh_token") != f"refresh-{self.n}":
                return bad("invalid_grant")
            return ok(self.tokens())                                     # rotates the refresh token
        if g == "urn:ietf:params:oauth:grant-type:device_code":
            return ok(self.device_answers.pop(0)) if self.device_answers[0].get("access_token") else bad(
                self.device_answers.pop(0)["error"])
        return bad("unsupported_grant_type")


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture
def env(tmp_path, monkeypatch):
    kr = FakeKeyring()
    monkeypatch.setattr(secrets, "_store", secrets.Store(tmp_path / ".secrets.json", keyring=kr))
    monkeypatch.delenv("DEMO_CLIENT_ID", raising=False)
    provider = FakeProvider()
    monkeypatch.setattr(net, "client", net.Http(provider, sleep=lambda s: None))
    monkeypatch.setitem(CONNECTORS, "demo", Demo)
    monkeypatch.setitem(PLATFORMS, "demo", Demo.manifest)
    cfg = load_config()
    cfg.raw = copy.deepcopy(cfg.raw)
    cfg.raw["general"]["data_dir"] = str(tmp_path / "data")
    client = make_client(create_app(cfg, static_dir=tmp_path / "nodist"))
    clock = Clock()
    client.app.state.oauth.clock = clock
    client.kr, client.provider, client.clock = kr, provider, clock
    client.put("/api/secrets/DEMO_CLIENT_ID", json={"value": "demo-client"})
    return client


def begin(env) -> dict:
    """Start a sign-in; the fake provider 'logs the user in' and issues a code for this challenge."""
    url = env.post("/api/oauth/demo/start").json()["authorize_url"]
    q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).items()}
    env.provider.issue("code-ok", q["code_challenge"])
    return q


def tokens(env):
    return {k[1]: v for k, v in env.kr.d.items() if k[1].startswith("OAUTH_DEMO")}


# ------------------------------------------------------------------ building blocks

def test_pkce_pair():
    verifier, challenge = pkce_pair()
    assert 43 <= len(verifier) <= 128 and set(verifier) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    assert challenge == base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert pkce_pair()[0] != verifier


def test_specs_are_checked():
    with pytest.raises(ValueError, match="https"):
        OAuthSpec("http://auth.example/a", "https://auth.example/t", ("x",), "C")
    with pytest.raises(ValueError, match="scopes"):
        OAuthSpec("https://auth.example/a", "https://auth.example/t", (), "C")
    with pytest.raises(ValueError, match="DEMO_CLIENT_ID"):
        Manifest("demo2", "Demo", True, "demo", vocab("a", "b", "c", "d"), auth="oauth", oauth=SPEC)


# ------------------------------------------------------------------ authorization code + PKCE

def test_sign_in(env):
    q = begin(env)
    assert q["response_type"] == "code" and q["code_challenge_method"] == "S256" and q["client_id"] == "demo-client"
    assert q["redirect_uri"] == "http://127.0.0.1:80/oauth/callback" and q["scope"] == "read-history"
    assert len(q["state"]) >= 40
    page = env.get(f"/oauth/callback?code=code-ok&state={q['state']}")
    assert page.status_code == 200 and "Connected to Demo" in page.text
    assert tokens(env)["OAUTH_DEMO_ACCESS"] == "access-1" and tokens(env)["OAUTH_DEMO_REFRESH"] == "refresh-1"
    listing = env.get("/api/sources").text
    assert "access-1" not in listing and "refresh-1" not in listing          # tokens never leave the server
    demo = next(s for s in env.get("/api/sources").json()["sources"] if s["id"] == "demo")
    assert demo["oauth"]["connected"] is True and demo["oauth"]["scopes"] == ["read-history"]


def test_replayed_callback_refused(env):
    q = begin(env)
    assert env.get(f"/oauth/callback?code=code-ok&state={q['state']}").status_code == 200
    env.provider.issue("code-ok", q["code_challenge"])
    again = env.get(f"/oauth/callback?code=code-ok&state={q['state']}")
    assert again.status_code == 400 and "already used" in again.text


def test_state_mismatch_refused_and_doesnt_burn_the_real_one(env):
    q = begin(env)
    forged = env.get("/oauth/callback?code=code-ok&state=attacker-made-this-up")
    assert forged.status_code == 400 and not tokens(env)
    assert env.get(f"/oauth/callback?code=code-ok&state={q['state']}").status_code == 200


def test_expired_sign_in_refused(env):
    q = begin(env)
    env.clock.t += 601
    r = env.get(f"/oauth/callback?code=code-ok&state={q['state']}")
    assert r.status_code == 400 and "too long" in r.text and not tokens(env)


def test_cancelled_sign_in(env):
    q = begin(env)
    r = env.get(f"/oauth/callback?error=access_denied&state={q['state']}")
    assert r.status_code == 400 and "cancelled" in r.text


def test_wrong_verifier_is_refused_by_the_provider(env):
    q = begin(env)
    env.provider.issue("code-ok", "a-challenge-for-some-other-verifier")
    r = env.get(f"/oauth/callback?code=code-ok&state={q['state']}")
    assert r.status_code == 400 and "refused" in r.text and not tokens(env)


def test_callback_page_escapes_and_still_checks_the_host(env):
    q = begin(env)
    r = env.get("/oauth/callback", params={"state": q["state"], "error": "<script>alert(1)</script>"})
    assert "<script>" not in r.text and "&lt;script&gt;" in r.text
    assert env.get("/oauth/callback?state=x", headers={"Host": "evil.example"}).status_code == 400


def test_needs_a_client_id_first(env):
    env.delete("/api/secrets/DEMO_CLIENT_ID")
    r = env.post("/api/oauth/demo/start")
    assert r.status_code == 400 and "DEMO_CLIENT_ID" in r.json()["detail"]
    assert env.post("/api/oauth/youtube/start").status_code == 404          # YouTube uses no sign-in


# ------------------------------------------------------------------ using tokens

def connected(env):
    q = begin(env)
    env.get(f"/oauth/callback?code=code-ok&state={q['state']}")
    return env.app.state.oauth


def test_token_used_until_it_nearly_expires_then_refreshed_and_rotated(env):
    auth = connected(env)
    assert auth.access_token("demo", SPEC) == "access-1"
    env.clock.t += 3600 - 30                                  # inside the last minute: refresh first
    assert auth.access_token("demo", SPEC) == "access-2"
    assert tokens(env)["OAUTH_DEMO_REFRESH"] == "refresh-2"  # rotated refresh token replaced the old one
    assert env.provider.seen[-1]["refresh_token"] == "refresh-1"


def test_refused_refresh_wipes_and_asks_to_reconnect(env):
    auth = connected(env)
    env.provider.refresh_ok = False
    env.clock.t += 7200
    with pytest.raises(NotConnected, match="Connect again"):
        auth.access_token("demo", SPEC)
    assert not tokens(env)
    with pytest.raises(NotConnected):
        auth.access_token("demo", SPEC)


def test_disconnect_revokes_then_wipes(env):
    connected(env)
    r = env.post("/api/oauth/demo/disconnect").json()
    assert r == {"revoked": True, "connected": False}
    assert env.provider.revoked == [("refresh-1", "refresh_token")] and not tokens(env)


def test_disconnect_wipes_even_if_the_provider_is_down(env):
    connected(env)
    env.provider.down = True
    assert env.post("/api/oauth/demo/disconnect").json()["revoked"] is False
    assert not tokens(env)


def test_deleting_the_platform_revokes_the_sign_in(env):
    connected(env)
    r = env.delete("/api/sources/demo").json()
    assert "sign-in" in r["removed"] and env.provider.revoked and not tokens(env)


# ------------------------------------------------------------------ device code

def test_device_flow(env):
    start = env.post("/api/oauth/demo/device/start").json()
    assert start["user_code"] == "WXYZ-1234" and start["verification_uri"].startswith("https://")
    auth = env.app.state.oauth
    env.provider.device_answers = [{"error": "authorization_pending"}, {"error": "slow_down"},
                                   env.provider.tokens()]
    assert env.post("/api/oauth/demo/device/poll").json() == {"status": "pending"}
    assert env.post("/api/oauth/demo/device/poll").json() == {"status": "pending"}   # too soon: no request
    env.clock.t += 5
    assert env.post("/api/oauth/demo/device/poll").json() == {"status": "pending"}   # slow_down: +5s
    assert auth._devices["demo"].interval == 10
    env.clock.t += 10
    assert env.post("/api/oauth/demo/device/poll").json() == {"status": "connected"}
    assert tokens(env)["OAUTH_DEMO_ACCESS"].startswith("access-")


@pytest.mark.parametrize("answer, message", [({"error": "access_denied"}, "cancelled"),
                                             ({"error": "expired_token"}, "expired")])
def test_device_flow_ends(env, answer, message):
    env.post("/api/oauth/demo/device/start")
    env.provider.device_answers = [answer]
    r = env.post("/api/oauth/demo/device/poll")
    assert r.status_code == 400 and message in r.json()["detail"]
    assert env.post("/api/oauth/demo/device/poll").status_code == 400                # nothing in progress now


def test_device_code_expires_locally(env):
    env.post("/api/oauth/demo/device/start")
    env.clock.t += 601
    assert "expired" in env.post("/api/oauth/demo/device/poll").json()["detail"]


def test_oauth_class_alone():
    with pytest.raises(OAuthError):
        OAuth().finish(None, None, None, {})
