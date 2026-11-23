"""The shared HTTP client, with a fake transport (no network)."""
import re
import urllib.error
from pathlib import Path

import pytest

from ytw import net
from ytw.net import Http, NetError, Response, TooLarge


class Fake:
    """Answers with the given responses/exceptions in order; records every request."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.seen = []

    def __call__(self, req):
        self.seen.append(req)
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


class Clock:
    def __init__(self):
        self.t = 0.0
        self.slept = []

    def now(self):
        return self.t

    def sleep(self, s):
        self.slept.append(round(s, 3))
        self.t += s


def make(*answers, rand=lambda: 1.0):
    fake, clock = Fake(*answers), Clock()
    return Http(fake, sleep=clock.sleep, clock=clock.now, rand=rand), fake, clock


def ok(body=b"{}", status=200, **headers):
    return Response(status, {k.replace("_", "-"): v for k, v in headers.items()}, body)


def test_basic_request():
    h, fake, clock = make(ok(b'{"a": 1}'))
    r = h.request("POST", "https://api.example/x", params={"q": "a b"}, json={"k": 1}, headers={"X-Extra": "1"})
    assert r.ok and r.json() == {"a": 1} and clock.slept == []
    req = fake.seen[0]
    assert req.url == "https://api.example/x?q=a+b" and req.method == "POST" and req.body == b'{"k": 1}'
    assert req.headers["User-Agent"] == net.USER_AGENT and req.headers["Content-Type"] == "application/json"
    assert req.headers["X-Extra"] == "1" and req.timeout == net.DEFAULT_TIMEOUT


def test_form_body_and_json_default():
    h, fake, _ = make(ok(b"not json"))
    r = h.request("POST", "https://api.example/x", form={"a": "1", "b": "two words"})
    assert fake.seen[0].body == b"a=1&b=two+words" and r.json({}) == {}


def test_https_only():
    h, fake, _ = make()
    for url in ("http://api.example/x", "file:///etc/passwd", "ftp://x/y", "https:///nohost"):
        with pytest.raises(NetError):
            h.request("GET", url)
    assert fake.seen == []


def test_retries_5xx_and_429_with_backoff():
    h, fake, clock = make(ok(status=503), ok(status=429), ok(b'{"done": true}'))
    assert h.request("GET", "https://api.example/x").json() == {"done": True}
    assert len(fake.seen) == 3 and clock.slept == [1.0, 2.0]          # base * 2^attempt (jitter = 1.0 here)


def test_jitter_spreads_waits():
    h, _, clock = make(ok(status=500), ok(status=500), ok(), rand=lambda: 0.25)
    h.request("GET", "https://api.example/x")
    assert clock.slept == [0.25, 0.5]


def test_retry_after_honored_and_capped():
    h, _, clock = make(ok(status=429, retry_after="7"), ok(status=429, retry_after="99999"), ok())
    h.request("GET", "https://api.example/x")
    assert clock.slept == [7.0, net.RETRY_AFTER_CAP]


def test_gives_back_last_status_after_retries():
    h, fake, _ = make(*[ok(status=429)] * 3)
    r = h.request("GET", "https://api.example/x", retries=2)
    assert r.status == 429 and len(fake.seen) == 3


def test_client_errors_not_retried():
    h, fake, _ = make(ok(status=404))
    assert h.request("GET", "https://api.example/x").status == 404 and len(fake.seen) == 1


def test_network_errors_retried_then_raised():
    h, fake, _ = make(urllib.error.URLError("down"), TimeoutError(), ok())
    assert h.request("GET", "https://api.example/x").ok and len(fake.seen) == 3
    h, _, _ = make(*[urllib.error.URLError("down")] * 2)
    with pytest.raises(NetError, match="down"):
        h.request("GET", "https://api.example/x", retries=1)


def test_size_cap():
    h, _, _ = make(ok(b"x" * 11))
    with pytest.raises(TooLarge):
        h.request("GET", "https://api.example/x", max_bytes=10)


def test_rate_limit_per_host():
    h, _, clock = make(ok(), ok(), ok())
    h.rate_limit("slow.example", 1.5)
    h.request("GET", "https://slow.example/a")
    h.request("GET", "https://slow.example/b")
    h.request("GET", "https://other.example/c")                          # other hosts aren't held up
    assert clock.slept == [1.5]


def test_circuit_breaker():
    h, fake, clock = make(*[ok(status=500)] * net.BREAKER_FAILURES, ok())
    for _ in range(net.BREAKER_FAILURES):
        assert h.request("GET", "https://down.example/x", retries=0).status == 500
    with pytest.raises(NetError, match="keeps failing"):
        h.request("GET", "https://down.example/x", retries=0)              # fails fast, no request sent
    assert len(fake.seen) == net.BREAKER_FAILURES
    clock.t += net.BREAKER_COOLDOWN
    assert h.request("GET", "https://down.example/x", retries=0).ok      # cooled down: tries again


def test_redirects_not_followed_when_asked():
    h, fake, _ = make(ok(status=302, location="https://evil.example/"))
    assert h.request("GET", "https://i.ytimg.com/a.jpg", follow_redirects=False).status == 302
    assert fake.seen[0].follow_redirects is False


def test_logs_are_redacted(caplog):
    import logging
    from ytw import secrets
    secrets.install_log_redaction()
    h, _, _ = make(ok())
    with caplog.at_level(logging.DEBUG, logger="ytw.net"):
        h.request("GET", "https://www.googleapis.com/youtube/v3/videos", params={"id": "a", "key": "fake-key-for-test"})
    assert "fake-key-for-test" not in caplog.text and "videos" in caplog.text


def test_api_errors_mapped(monkeypatch):
    from ytw.connectors.youtube import enrich
    from ytw.connectors.netflix import tmdb
    yt_quota = b'{"error": {"message": "quota", "errors": [{"reason": "quotaExceeded"}]}}'
    yt_key = b'{"error": {"message": "API key not valid", "errors": [{"reason": "keyInvalid"}]}}'
    fake = Fake(ok(b'{"items": []}'), ok(yt_quota, status=403), ok(yt_key, status=400),
                ok(status=401), ok(status=404), ok(b'{"id": 1}'))
    monkeypatch.setattr(net, "client", Http(fake, sleep=lambda s: None))
    assert enrich.http_fetch("videos", {"id": "a"}) == {"items": []}
    with pytest.raises(enrich.QuotaExceeded):
        enrich.http_fetch("videos", {"id": "a"})
    with pytest.raises(enrich.ApiKeyError):
        enrich.http_fetch("videos", {"id": "a"})
    f = tmdb.http_fetcher("tok")
    with pytest.raises(tmdb.TmdbError, match="rejected"):
        f("/movie/1", {})
    assert f("/movie/1", {}) == {} and f("/movie/1", {}) == {"id": 1}
    assert fake.seen[-1].headers["Authorization"] == "Bearer tok"


def test_no_http_outside_net():
    """Every outgoing request goes through ytw/net.py (the CI grep in #13)."""
    root = Path(__file__).resolve().parents[1] / "ytw"
    banned = re.compile(r"^\s*(import (urllib\.request|urllib\.error|requests|httpx|http\.client|aiohttp)"
                        r"|from (urllib\.request|urllib\.error|requests|httpx|http\.client|aiohttp)\b)|urlopen\(",
                        re.M)
    offenders = [str(p.relative_to(root)) for p in root.rglob("*.py")
                 if p.name != "net.py" and banned.search(p.read_text(encoding="utf-8"))]
    assert offenders == []
