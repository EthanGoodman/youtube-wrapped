from conftest import make_client
import pytest
from fastapi.testclient import TestClient

from ytw import db
from ytw.api import ResultCache, create_app
from ytw.config import load_config

from test_stats import populate


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "wrapped.db"
    c = db.connect(path)
    populate(c)
    c.close()
    static = tmp_path_factory.mktemp("dist")
    (static / "assets").mkdir()
    (static / "index.html").write_text("<html>app</html>")
    # other platforms point at files that don't exist, so tests never read real data
    others = {p: path.parent / f"no-{p}.db" for p in ("netflix", "spotify", "prime_video", "tiktok", "instagram",
                                                       "crunchyroll")}
    return make_client(create_app(load_config(), db_path=path, static_dir=static, db_paths=others))


def test_meta(client):
    m = client.get("/api/meta").json()
    assert m["years"] == [2023, 2024]
    assert m["first_date"] == "2023-03-01" and m["has_search"] is True and m["has_music"] is False


def test_overview_with_params(client):
    o = client.get("/api/overview?range=2024").json()
    assert o["videos"] == 9 and o["est_s"] == 3345
    assert client.get("/api/overview?range=2024&bg=0").json()["est_s"] == 3345 + 7200
    assert client.get("/api/overview?range=2024&buckets=short").json()["videos"] == 1
    c = client.get("/api/overview?range=custom&start=2024-01-10&end=2024-01-10").json()
    assert c["videos"] == 3


@pytest.mark.parametrize("kind", ["channels", "videos", "categories", "genres", "tags", "artists", "songs"])
def test_top_lists(client, kind):
    r = client.get(f"/api/top/{kind}?range=2024&limit=5")
    assert r.status_code == 200 and "items" in r.json()


def test_top_by_time(client):
    items = client.get("/api/top/channels?range=2024&metric=time").json()["items"]
    assert [i["key"] for i in items] == ["UCa", "UCb", "UCc"]


@pytest.mark.parametrize("kind", ["clock", "heatmap", "calendar", "monthly", "weekday_weekend"])
def test_patterns(client, kind):
    assert client.get(f"/api/patterns/{kind}?range=2024").status_code == 200


@pytest.mark.parametrize("path", [
    "/api/records?range=2024", "/api/milestones", "/api/recent?limit=3", "/api/ads?range=2024",
    "/api/search", "/api/evolution/top_per_year", "/api/evolution/bar_race", "/api/evolution/discoveries",
    "/api/evolution/loyalty", "/api/evolution/fell_off", "/api/evolution/mix?by=genre",
    "/api/channel/UCa?range=2024", "/api/video/a1", "/api/category/20", "/api/genre/Action game",
    "/api/year/2024",
])
def test_endpoints_ok(client, path):
    r = client.get(path)
    assert r.status_code == 200, r.text


def test_search_all_time_by_default(client):
    assert client.get("/api/search").json()["searches"] == 3
    assert client.get("/api/search?range=2024").json()["searches"] == 2


@pytest.mark.parametrize("path,code", [
    ("/api/top/nope", 404), ("/api/patterns/nope", 404), ("/api/evolution/nope", 404),
    ("/api/channel/UCnope", 404), ("/api/video/nope", 404), ("/api/category/999", 404),
    ("/api/overview?range=bogus", 400), ("/api/overview?metric=likes", 400),
    ("/api/overview?buckets=podcasts", 400), ("/api/top/channels?limit=abc", 400),
    ("/api/evolution/mix?by=nope", 400), ("/api/overview?range=custom", 400),
])
def test_errors(client, path, code):
    assert client.get(path).status_code == code


def test_spa_fallback(client):
    page = client.get("/channel/UCa")
    assert "<html>app</html>" in page.text
    assert page.headers["cache-control"] == "no-store"            # carries the install token: never cached
    assert client.get("/api/unknown").status_code == 404


# ------------------------------------------------------------------ local server protection (#8)

from conftest import TEST_TOKEN  # noqa: E402


def test_page_carries_the_token(client):
    assert f'<meta name="wrapped-token" content="{TEST_TOKEN}">' in client.get("/").text


def test_dns_rebinding_host_refused(client):
    r = client.get("/api/meta", headers={"host": "evil.example"})
    assert r.status_code == 400
    assert client.get("/api/meta", headers={"host": "localhost:8000"}).status_code == 200


def test_api_needs_the_token(client):
    assert client.get("/api/meta", headers={"X-Wrapped-Token": "wrong"}).status_code == 401
    plain = TestClient(client.app, base_url="http://127.0.0.1")  # a page that doesn't have the token
    assert plain.get("/api/meta").status_code == 401
    assert plain.get("/api/build").status_code == 200               # nothing personal: no token needed
    assert plain.get("/api/img?u=https://i.ytimg.com/vi/x/mqdefault.jpg").status_code == 401
    assert plain.get(f"/api/img?u=https://evil.example/x.png&t={TEST_TOKEN}").status_code == 400  # token ok, host refused


def test_cross_origin_writes_refused(client):
    r = client.post("/api/meta", headers={"origin": "https://evil.example"})
    assert r.status_code == 403


def test_security_headers(client):
    for path in ("/", "/api/meta", "/api/nope"):
        h = client.get(path).headers
        assert "frame-ancestors 'self'" in h["content-security-policy"] and h["x-frame-options"] == "SAMEORIGIN"
        assert h["x-content-type-options"] == "nosniff" and h["referrer-policy"] == "no-referrer"


def test_api_docs_off(client):
    assert client.get("/api/docs").status_code == 404 and client.get("/api/openapi.json").status_code == 404


def test_dev_mode_skips_token(tmp_path):
    from ytw.api import create_app as _make
    app = _make(load_config(), db_paths={}, static_dir=tmp_path / "none", dev=True)
    c = TestClient(app, base_url="http://127.0.0.1")
    assert c.get("/api/platforms").status_code == 200 and c.get("/api/openapi.json").status_code == 200
    assert c.get("/api/platforms", headers={"host": "evil.example"}).status_code == 400   # host check stays on


def test_cache_clears_on_new_build():
    cache = ResultCache(size=2)
    calls = []
    fn = lambda: calls.append(1) or len(calls)  # noqa: E731
    assert cache.get_or_compute("b1", ("k",), fn) == 1
    assert cache.get_or_compute("b1", ("k",), fn) == 1      # cached
    assert cache.get_or_compute("b2", ("k",), fn) == 2      # rebuilt -> recomputed
    cache.get_or_compute("b2", ("x",), fn)
    cache.get_or_compute("b2", ("y",), fn)                  # evicts ("k",)
    assert cache.get_or_compute("b2", ("k",), fn) == 5


# ------------------------------------------------------------------ platforms

def test_platforms_list(client):
    ps = {p["id"]: p for p in client.get("/api/platforms").json()}
    assert {"youtube", "netflix", "spotify", "prime_video", "tiktok", "instagram", "crunchyroll"} <= set(ps)
    assert ps["youtube"]["implemented"] and ps["youtube"]["has_data"] and ps["youtube"]["items"] == 13
    assert ps["netflix"]["implemented"] is True and ps["netflix"]["has_data"] is False
    assert ps["spotify"]["implemented"] is False and ps["spotify"]["issue"] == 3 and ps["spotify"]["export_steps"]


def test_platform_param(client):
    assert client.get("/api/overview?range=2024&platform=youtube").json()["videos"] == 9
    assert client.get("/api/meta").json()["platform"]["vocab"]["creator"] == "channel"
    assert client.get("/api/overview?platform=spotify").status_code == 404     # not supported yet
    assert "#3" in client.get("/api/overview?platform=spotify").json()["detail"]
    assert client.get("/api/overview?platform=netflix").status_code == 503     # supported, no data imported
    assert client.get("/api/overview?platform=myspace").status_code == 404     # unknown


def test_capability_gating():
    from ytw.platforms import PLATFORMS
    yt, nf = PLATFORMS["youtube"], PLATFORMS["netflix"]
    assert yt.has("ads") and yt.has("search") and yt.has("shorts")
    assert not nf.has("ads") and not nf.has("shorts")
    assert PLATFORMS["spotify"].vocab["verb"] == "listen"


def test_build_endpoint(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text('<script type="module" crossorigin src="/assets/index-AbC123.js"></script>')
    client = make_client(create_app(load_config(), db_paths={}, static_dir=dist))
    assert client.get("/api/build").json() == {"build": "/assets/index-AbC123.js"}
    # no frontend built: nothing to compare against
    client2 = make_client(create_app(load_config(), db_paths={}, static_dir=tmp_path / "none"))
    assert client2.get("/api/build").json() == {"build": None}
