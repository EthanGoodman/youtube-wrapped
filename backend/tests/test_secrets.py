"""Secrets store (fake keychain, no OS access), .env migration and log redaction."""
import logging
import os
import stat

import pytest

from ytw import secrets
from ytw.secrets import MASK, SecretsError, Store, migrate_env, migrate_file, redact


class FakeKeyring:
    def __init__(self):
        self.d = {}

    def get_password(self, service, name):
        return self.d.get((service, name))

    def set_password(self, service, name, value):
        self.d[(service, name)] = value

    def delete_password(self, service, name):
        del self.d[(service, name)]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in list(secrets.KNOWN) + ["MY_TOKEN"]:
        monkeypatch.delenv(name, raising=False)


def test_keychain_store(tmp_path, monkeypatch):
    kr = FakeKeyring()
    st = Store(tmp_path / ".secrets.json", keyring=kr)
    assert st.get("TMDB_TOKEN") is None
    st.set("TMDB_TOKEN", "  tmdb-secret-value \n")
    assert st.get("TMDB_TOKEN") == "tmdb-secret-value"
    assert kr.d[("wrapped", "TMDB_TOKEN")] == "tmdb-secret-value"
    assert not (tmp_path / ".secrets.json").exists()            # nothing on disk with a keychain
    assert st.names() == {"TMDB_TOKEN": "keychain"}
    # an environment variable overrides the keychain
    monkeypatch.setenv("TMDB_TOKEN", "from-env-override")
    assert st.get("TMDB_TOKEN") == "from-env-override"
    assert st.names()["TMDB_TOKEN"] == "environment / .env"
    monkeypatch.delenv("TMDB_TOKEN")
    assert st.delete("TMDB_TOKEN") and not st.delete("TMDB_TOKEN")
    assert st.get("TMDB_TOKEN") is None and st.names() == {}


def test_names_never_values(tmp_path):
    st = Store(tmp_path / ".secrets.json", keyring=FakeKeyring())
    st.set("MY_TOKEN", "do-not-print-this-value")
    assert "do-not-print-this-value" not in repr(st.names())


def test_bad_input(tmp_path):
    st = Store(tmp_path / ".secrets.json", keyring=FakeKeyring())
    with pytest.raises(SecretsError):
        st.set("TMDB_TOKEN", "   ")
    with pytest.raises(SecretsError):
        st.set("not a name; rm -rf", "x")


def test_file_fallback(tmp_path):
    f = tmp_path / ".secrets.json"
    st = Store(f, keyring=None)
    st.set("TMDB_TOKEN", "fallback-secret-value")
    assert st.get("TMDB_TOKEN") == "fallback-secret-value"
    assert st.names() == {"TMDB_TOKEN": "fallback file"}
    if os.name != "nt":                                         # Windows has no POSIX modes
        assert stat.S_IMODE(f.stat().st_mode) == 0o600
    assert st.delete("TMDB_TOKEN") and st.get("TMDB_TOKEN") is None


def test_migrate_env(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text('# my settings\nTMDB_TOKEN="eyJ-tmdb-token-value"\nCRUNCHYROLL_ETP_RT=etp-cookie-value-123\n'
                   "OTHER_SETTING=keep-me\nYOUTUBE_API_KEY=\n", encoding="utf-8")
    monkeypatch.setenv("TMDB_TOKEN", "eyJ-tmdb-token-value")     # as load_dotenv would have set it
    st = Store(tmp_path / ".secrets.json", keyring=FakeKeyring())
    assert migrate_env(env, st) == ["TMDB_TOKEN", "CRUNCHYROLL_ETP_RT"]
    assert st.get("TMDB_TOKEN") == "eyJ-tmdb-token-value" and st.get("CRUNCHYROLL_ETP_RT") == "etp-cookie-value-123"
    left = env.read_text(encoding="utf-8")
    assert "eyJ" not in left and "etp-cookie" not in left
    assert "OTHER_SETTING=keep-me" in left and "# my settings" in left
    assert migrate_env(env, st) == []                            # running it again changes nothing
    assert migrate_env(tmp_path / "missing.env", st) == []


def test_migrate_keeps_env_if_keychain_fails(tmp_path):
    class Forgetful(FakeKeyring):
        def set_password(self, service, name, value):
            pass
    env = tmp_path / ".env"
    env.write_text("TMDB_TOKEN=eyJ-tmdb-token-value\n", encoding="utf-8")
    with pytest.raises(SecretsError):
        migrate_env(env, Store(tmp_path / ".secrets.json", keyring=Forgetful()))
    assert "eyJ-tmdb-token-value" in env.read_text(encoding="utf-8")


def test_fallback_file_moves_to_keychain(tmp_path):
    f = tmp_path / ".secrets.json"
    Store(f, keyring=None).set("TMDB_TOKEN", "was-in-the-fallback-file")
    st = Store(f, keyring=FakeKeyring())
    assert migrate_file(st) == ["TMDB_TOKEN"]
    assert not f.exists() and st.get("TMDB_TOKEN") == "was-in-the-fallback-file"
    assert migrate_file(st) == []


def test_missing_keyring_package_is_an_error(tmp_path, monkeypatch):
    import builtins
    real = builtins.__import__

    def no_keyring(name, *a, **k):
        if name.startswith("keyring"):
            raise ImportError(name)
        return real(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", no_keyring)
    with pytest.raises(SecretsError, match="keyring"):
        Store(tmp_path / ".secrets.json")


@pytest.mark.parametrize("text, secret", [
    ("GET https://www.googleapis.com/youtube/v3/videos?id=abc&key=AIzaSyFAKEKEY123", "AIzaSyFAKEKEY123"),
    ("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload", "eyJhbGciOiJIUzI1NiJ9"),
    ("headers={'authorization': 'Basic Y2xpZW50OnNlY3JldA=='}", "Y2xpZW50OnNlY3JldA=="),
    ("Cookie: etp_rt=abc123; session_id=zzz", "abc123"),
    ("refresh with access_token=tok_live_999 now", "tok_live_999"),
    ('{"refresh_token": "rt-555-xyz"}', "rt-555-xyz"),
    ("npsso=PSN-SECRET-64", "PSN-SECRET-64"),
])
def test_redact_patterns(text, secret):
    out = redact(text)
    assert secret not in out and MASK in out


def test_redact_known_values():
    secrets.register("plain-value-without-a-label-42")
    assert redact("oops: plain-value-without-a-label-42 leaked") == f"oops: {MASK} leaked"
    secrets.register("short")                                   # too short to mask safely
    assert redact("a short word") == "a short word"
    assert redact("nothing secret here, 120 videos") == "nothing secret here, 120 videos"


def test_logs_are_redacted(caplog):
    secrets.install_log_redaction()
    secrets.install_log_redaction()                             # idempotent
    secrets.register("registered-secret-value-7")
    log = logging.getLogger("ytw.some.module")
    with caplog.at_level(logging.INFO):
        log.info("calling %s with %s", "https://api.example/x?token=abcdef123", "registered-secret-value-7")
        try:
            raise ValueError("bad key=AIzaInsideTheException")
        except ValueError:
            log.exception("failed")
    text = caplog.text
    assert "abcdef123" not in text and "registered-secret-value-7" not in text
    assert "AIzaInsideTheException" not in text and text.count(MASK) >= 3
