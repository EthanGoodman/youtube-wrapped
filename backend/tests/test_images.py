"""The image relay is not an open proxy (SSRF): hosts, paths, IPs, redirects, types, size, token."""
import pytest
from conftest import make_client

from ytw import images, net
from ytw.api import create_app
from ytw.config import load_config
from ytw.net import Blocked, Http, Request, Response

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 20
JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 20
WEBP = b"RIFF\x10\0\0\0WEBPVP8 " + b"\0" * 8
GIF = b"GIF89a" + b"\0" * 20
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'
YT = "https://i.ytimg.com/vi/abc/mqdefault.jpg"


class Fake:
    def __init__(self, *answers):
        self.answers, self.seen = list(answers), []

    def __call__(self, req):
        self.seen.append(req)
        return self.answers.pop(0)


@pytest.fixture
def relay(monkeypatch):
    def use(*answers):
        fake = Fake(*answers)
        monkeypatch.setattr(net, "client", Http(fake, sleep=lambda s: None))
        return fake
    return use


# ------------------------------------------------------------------ which URLs

@pytest.mark.parametrize("url", [
    "https://www.crunchyroll.com/imgsrv/display/thumbnail/480x720/x.png",
    "https://image.tmdb.org/t/p/w342/abc.jpg",
    "https://yt3.ggpht.com/abc=s88-c-k",
    YT,
])
def test_platform_image_hosts_allowed(url):
    images.check_url(url)


@pytest.mark.parametrize("url", [
    "https://www.crunchyroll.com/account",                    # right host, wrong path
    "https://www.crunchyroll.com/imgsrv/../account",           # dot segments
    "https://www.crunchyroll.com/imgsrv/%2e%2e/account",       # encoded dot segments
    "https://www.crunchyroll.com/imgsrv/a%2f..%2faccount",     # encoded slash
    "https://www.crunchyroll.com/imgsrv/a\\..\\account",        # backslashes
    "https://image.tmdb.org/3/movie/1",                        # TMDB's API, not its images
    "https://169.254.169.254/latest/meta-data/",               # cloud metadata
    "https://127.0.0.1/a.png", "https://localhost/a.png",
    "https://evil.example/imgsrv/x.png",
])
def test_foreign_and_tricky_urls_refused(url):
    with pytest.raises(images.NotAllowed):
        images.check_url(url)


# ------------------------------------------------------------------ which addresses

@pytest.mark.parametrize("addrs", [
    ["127.0.0.1"], ["10.0.0.5"], ["192.168.1.1"], ["172.16.0.1"], ["169.254.169.254"], ["0.0.0.0"],
    ["::1"], ["fe80::1%eth0"], ["fc00::1"], ["::ffff:127.0.0.1"], ["100.64.0.1"],
    ["142.250.72.14", "127.0.0.1"],                               # one bad answer is enough
])
def test_private_addresses_blocked(addrs):
    with pytest.raises(Blocked):
        net.vet_addresses("i.ytimg.com", addrs)


def test_public_address_used():
    assert net.vet_addresses("i.ytimg.com", ["142.250.72.14", "2607:f8b0:4004:c1b::64"]) == "142.250.72.14"


def test_rebinding_host_never_connected(monkeypatch):
    """An allowed hostname whose DNS points inside the network is refused before any connection."""
    monkeypatch.setattr(net, "resolver", lambda host, port: ["192.168.0.10"])
    monkeypatch.setattr(net._PinnedHTTPS, "connect", lambda self: pytest.fail("must not connect"))
    req = Request("GET", YT, {}, None, 5, 100, False, True)
    with pytest.raises(Blocked):
        net.pinned_transport(req)


def test_pinned_connection_uses_vetted_ip(monkeypatch):
    monkeypatch.setattr(net, "resolver", lambda host, port: ["142.250.72.14"])
    made = []

    def fake_connect(self):
        made.append((self._ip, self.host, self.port))
        raise OSError("stop here")
    monkeypatch.setattr(net._PinnedHTTPS, "connect", fake_connect)
    with pytest.raises(OSError):
        net.pinned_transport(Request("GET", YT, {}, None, 5, 100, False, True))
    assert made == [("142.250.72.14", "i.ytimg.com", 443)]       # IP pinned, TLS name still the host


# ------------------------------------------------------------------ what comes back

@pytest.mark.parametrize("body, ctype", [(PNG, "image/png"), (JPEG, "image/jpeg"), (WEBP, "image/webp"),
                                         (GIF, "image/gif")])
def test_real_images_served_by_their_bytes(relay, body, ctype):
    fake = relay(Response(200, {"content-type": "text/html"}, body))   # server's type is ignored
    assert images._http_get(YT) == (body, ctype)
    req = fake.seen[0]
    assert req.public_only and not req.follow_redirects and req.timeout == images.TIMEOUT_S


@pytest.mark.parametrize("body", [SVG, b"<html>hi</html>", b"", b"GIF8"])
def test_non_images_refused(relay, body):
    relay(Response(200, {"content-type": "image/svg+xml"}, body))
    with pytest.raises(images.FetchFailed, match="not a PNG"):
        images._http_get(YT)


def test_redirect_refused(relay):
    relay(Response(302, {"location": "http://169.254.169.254/"}, b""))
    with pytest.raises(images.FetchFailed, match="HTTP 302"):
        images._http_get(YT)


def test_oversize_refused(relay):
    relay(Response(200, {}, PNG + b"\0" * images.MAX_BYTES))
    with pytest.raises(images.FetchFailed, match="too large"):
        images._http_get(YT)


def test_blocked_address_is_not_allowed(monkeypatch):
    def blocked(req):
        raise Blocked("i.ytimg.com resolves to a non-public address")
    monkeypatch.setattr(net, "client", Http(blocked, sleep=lambda s: None))
    with pytest.raises(images.NotAllowed):
        images._http_get(YT)


# ------------------------------------------------------------------ the route

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(images, "getter", lambda u: (PNG, "image/png"))
    monkeypatch.setattr(images, "_cache", images.OrderedDict())
    return make_client(create_app(load_config(), db_path=tmp_path / "w.db", static_dir=tmp_path / "nodist"))


def test_route_needs_the_token(client):
    from fastapi.testclient import TestClient
    img_tag = TestClient(client.app, base_url="http://127.0.0.1")   # like an <img>: no token header
    url = f"/api/img?u={YT}"
    assert img_tag.get(url).status_code == 401
    assert img_tag.get(url + "&t=wrong").status_code == 401
    assert img_tag.get(url + f"&t={client.app.state.token}").status_code == 200


def test_route_refuses_foreign_hosts(client):
    assert client.get("/api/img?u=https://evil.example/a.png").status_code == 400
    r = client.get(f"/api/img?u={YT}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
