"""Crunchyroll history fetcher, against a fake Crunchyroll (never the real one)."""
import json
import urllib.parse

import pytest

from ytw.crunchyroll.fetch import API, HISTORY_FILE, CookieExpired, CrunchyrollError, fetch_history

COOKIE = "good-cookie"


def item(n: int) -> dict:
    return {"id": f"h{n}", "date_played": f"2026-01-{n:02d}T20:00:00Z", "fully_watched": n % 2 == 0, "playhead": 600 + n,
            "panel": {"id": f"ep{n}", "title": f"Episode {n}",
                      "episode_metadata": {"series_id": "S1", "series_title": "Frieren", "season_number": 1, "episode_number": n}}}


class FakeCrunchyroll:
    """Answers like Crunchyroll: token from the cookie, /me, and a 3-page cursor-paged history."""

    def __init__(self, expire_after: int | None = None, flaky: int = 0):
        self.calls: list[tuple[str, str]] = []
        self.tokens = 0
        self.expire_after = expire_after  # first token stops working after this many history calls
        self.history_calls = 0
        self.flaky = flaky                # how many 429s to send before answering

    def __call__(self, method, url, headers, form):
        path = urllib.parse.urlparse(url).path
        self.calls.append((method, path))
        if self.flaky:
            self.flaky -= 1
            return 429, None
        if path == "/auth/v1/token":
            assert method == "POST" and form["grant_type"] == "etp_rt_cookie"
            assert headers["Authorization"].startswith("Basic ")
            if headers.get("Cookie") != f"etp_rt={COOKIE}":
                return 401, {"error": "invalid_grant"}
            self.tokens += 1
            return 200, {"access_token": f"tok{self.tokens}", "refresh_token": "never-saved", "expires_in": 300}
        token = headers.get("Authorization", "")
        if path == "/accounts/v1/me":
            return 200, {"account_id": "acc-123"}
        if path == "/content/v2/acc-123/watch-history":
            self.history_calls += 1
            if self.expire_after and self.history_calls > self.expire_after and token == "Bearer tok1":
                return 401, {"error": "expired"}
            q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            cursor = q.get("cursor", ["0"])[0]
            pages = {"0": ([item(1), item(2)], "/content/v2/acc-123/watch-history?cursor=a&page_size=100"),
                     "a": ([item(3), item(4)], f"{API}/content/v2/acc-123/watch-history?cursor=b&page_size=100"),
                     "b": ([item(5)], "")}
            data, nxt = pages[cursor]
            return 200, {"data": data, "meta": {"next_page": nxt}}
        return 404, None


def run(tmp_path, fake, cookie=COOKIE):
    return fetch_history(tmp_path / "crunchyroll", cookie, transport=fake, pause_s=0, sleep=lambda s: None)


def test_fetches_every_page(tmp_path):
    fake = FakeCrunchyroll()
    res = run(tmp_path, fake)
    assert res["items"] == 5 and res["first"].startswith("2026-01-01") and res["last"].startswith("2026-01-05")
    saved = json.loads((tmp_path / "crunchyroll" / HISTORY_FILE).read_text(encoding="utf-8"))
    assert [i["id"] for i in saved["items"]] == ["h1", "h2", "h3", "h4", "h5"]
    assert saved["items"][0]["playhead"] == 601          # raw fields are kept as-is
    text = json.dumps(saved)
    assert "tok1" not in text and "never-saved" not in text and COOKIE not in text  # no secrets on disk


def test_expired_token_logs_in_again(tmp_path):
    fake = FakeCrunchyroll(expire_after=1)
    assert run(tmp_path, fake)["items"] == 5
    assert fake.tokens == 2


def test_bad_cookie(tmp_path):
    with pytest.raises(CookieExpired, match="fresh etp_rt"):
        run(tmp_path, FakeCrunchyroll(), cookie="stale")
    assert not (tmp_path / "crunchyroll" / HISTORY_FILE).exists()
    with pytest.raises(CookieExpired):
        run(tmp_path, FakeCrunchyroll(), cookie="")


def test_rate_limit_is_retried(tmp_path):
    assert run(tmp_path, FakeCrunchyroll(flaky=2))["items"] == 5


def test_failed_fetch_keeps_previous_file(tmp_path):
    run(tmp_path, FakeCrunchyroll())
    before = (tmp_path / "crunchyroll" / HISTORY_FILE).read_text(encoding="utf-8")

    def broken(method, url, headers, form):
        if "watch-history" in url:
            return 500, None
        return FakeCrunchyroll()(method, url, headers, form)
    with pytest.raises(CrunchyrollError):
        run(tmp_path, broken)
    assert (tmp_path / "crunchyroll" / HISTORY_FILE).read_text(encoding="utf-8") == before
