"""API keys, tokens and session cookies: kept in the OS keychain, never in plain text in the repo.

Lookup order for a secret NAME:
  1. an environment variable NAME (an explicit override; .env values land here too)
  2. the OS keychain (Windows Credential Manager / macOS Keychain / Secret Service), service "wrapped"
  3. data/.secrets.json, only on systems with no keychain (user-only permissions, a warning on use)

Manage them with `python backend/cli.py secrets set|list|delete|migrate`.
Every value we know about is also masked in logs (see `redact`).
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

SERVICE = "wrapped"
KNOWN = {
    "YOUTUBE_API_KEY": "YouTube Data API key (optional enrichment)",
    "TMDB_TOKEN": "TMDB API Read Access Token (Netflix posters and episodes)",
    "CRUNCHYROLL_ETP_RT": "Crunchyroll etp_rt cookie (treat it like a password)",
    "LASTFM_API_KEY": "Last.fm API key (music genres from listeners' tags)",
    "STEAM_API_KEY": "Steam Web API key (your library, playtime and achievements)",
    "STEAM_PROFILE": "Your Steam profile link or SteamID64 (which library to read)",
}
_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
log = logging.getLogger("ytw.secrets")


class SecretsError(Exception):
    pass


def _check(name: str) -> str:
    if not _NAME.match(name):
        raise SecretsError(f"Bad secret name {name!r}: use UPPER_CASE letters, digits and _")
    return name


def _keyring():
    """The OS keychain, or None when this system truly has none (keyring's 'fail' backend).
    A missing keyring package is an error, not "no keychain": it means the wrong Python is running."""
    try:
        import keyring
        from keyring.backends import fail
    except ImportError:
        raise SecretsError("The keyring package isn't installed for this Python. Use the project's .venv "
                           "(or run: pip install -r requirements.txt).") from None
    kr = keyring.get_keyring()
    return None if isinstance(kr, fail.Keyring) else kr


class Store:
    """Keychain-backed store, with a user-only file as the no-keychain fallback."""

    def __init__(self, fallback: Path, keyring=...):
        self.fallback = fallback
        self.kr = _keyring() if keyring is ... else keyring

    @property
    def where(self) -> str:
        return "the OS keychain" if self.kr else f"{self.fallback} (no OS keychain found)"

    # -- fallback file --------------------------------------------------------
    def _read_file(self) -> dict[str, str]:
        try:
            return json.loads(self.fallback.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _write_file(self, data: dict[str, str]) -> None:
        self.fallback.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.fallback, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)

    # -- the store ------------------------------------------------------------
    def get(self, name: str) -> str | None:
        _check(name)
        if os.environ.get(name):
            return os.environ[name]
        if self.kr:
            return self.kr.get_password(SERVICE, name) or None
        value = self._read_file().get(name)
        if value:
            log.warning("reading %s from %s: no OS keychain on this system", name, self.fallback.name)
        return value or None

    def set(self, name: str, value: str) -> None:
        _check(name)
        value = value.strip()
        if not value:
            raise SecretsError("Empty value; use `secrets delete` to remove a secret")
        if self.kr:
            try:
                self.kr.set_password(SERVICE, name, value)
            except Exception as e:  # keyring backends raise their own types (e.g. a value too big)
                raise SecretsError(f"The keychain refused {name} ({type(e).__name__}); nothing changed") from None
            if self.kr.get_password(SERVICE, name) != value:
                raise SecretsError(f"The keychain didn't keep {name}; nothing changed")
            names = set(self._index()) | {name}
            self.kr.set_password(SERVICE, "_names", ",".join(sorted(names)))
        else:
            data = self._read_file()
            data[name] = value
            self._write_file(data)
        register(value)

    def delete(self, name: str) -> bool:
        _check(name)
        if self.kr:
            if self.kr.get_password(SERVICE, name) is None:
                return False
            self.kr.delete_password(SERVICE, name)
            names = set(self._index()) - {name}
            self.kr.set_password(SERVICE, "_names", ",".join(sorted(names)))
            return True
        data = self._read_file()
        if data.pop(name, None) is None:
            return False
        self._write_file(data)
        return True

    def _index(self) -> list[str]:
        """Keychains can't list entries, so we keep the names (never values) in one entry."""
        raw = self.kr.get_password(SERVICE, "_names") if self.kr else None
        return [n for n in (raw or "").split(",") if n]

    def names(self) -> dict[str, str]:
        """{name: where it's set} for every secret we know of. Never returns values."""
        stored = set(self._index()) if self.kr else set(self._read_file())
        out = {}
        for name in sorted(set(KNOWN) | stored):
            if os.environ.get(name):
                out[name] = "environment / .env"
            elif name in stored:
                out[name] = "keychain" if self.kr else "fallback file"
        return out


_store: Store | None = None


def store() -> Store:
    global _store
    if _store is None:
        from .config import ROOT
        _store = Store(ROOT / "data" / ".secrets.json")
    return _store


def get(name: str) -> str | None:
    """A secret's value, or None. Every value read is masked in logs from then on."""
    value = store().get(name)
    if value:
        register(value)
    return value


# -- .env migration -----------------------------------------------------------
_ENV_LINE = re.compile(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$")


def migrate_env(env_path: Path, st: Store) -> list[str]:
    """Move every known secret in .env into the store, then drop those lines from .env.
    Each value is written and read back before its line is removed. Returns the names moved."""
    if not env_path.exists():
        return []
    lines = env_path.read_text(encoding="utf-8").splitlines(keepends=True)
    keep, moved = [], []
    for line in lines:
        m = _ENV_LINE.match(line)
        name = m.group(1) if m else None
        if name in KNOWN:
            value = m.group(2).strip().strip("'\"")
            if value:
                os.environ.pop(name, None)            # the .env copy must not shadow the keychain
                st.set(name, value)
                if st.get(name) != value:
                    raise SecretsError(f"Couldn't verify {name} in {st.where}; .env left as it was")
                moved.append(name)
                continue
        keep.append(line)
    if moved:
        env_path.write_text("".join(keep), encoding="utf-8")
    return moved


def migrate_file(st: Store) -> list[str]:
    """Move secrets out of the no-keychain fallback file once a keychain is available, then delete it.
    Each value is written and read back first. Returns the names moved."""
    if not st.kr or not st.fallback.exists():
        return []
    data = st._read_file()
    for name, value in data.items():
        if os.environ.get(name) == value:
            os.environ.pop(name)
        st.set(name, value)
        if st.kr.get_password(SERVICE, name) != value:
            raise SecretsError(f"Couldn't verify {name} in the keychain; {st.fallback.name} left as it was")
    st.fallback.unlink()
    return sorted(data)


# -- log redaction ------------------------------------------------------------
MASK = "[redacted]"
_known_values: set[str] = set()
_PATTERNS = [
    # Authorization: Bearer xyz / Basic xyz
    (re.compile(r"(?i)(authorization['\"]?\s*[:=]\s*['\"]?(?:bearer\s+|basic\s+)?)[^\s,;'\"]+"), r"\1" + MASK),
    # Cookie / Set-Cookie headers: the whole value
    (re.compile(r"(?i)((?:set-)?cookie\s*[:=]\s*)[^\r\n]+"), r"\1" + MASK),
    # key=..., token=..., etp_rt=... in URLs, bodies and messages
    (re.compile(r"(?i)\b((?:api[_-]?)?key|(?:access_|refresh_|id_)?token|secret|password|etp_rt|npsso|session(?:id)?)"
                r"(=|\"?\s*:\s*\"?)([^&\s,;'\"]+)"), r"\1\2" + MASK),
]


def register(value: str) -> None:
    """Mask this exact value wherever it shows up in logs (short values would mask too much)."""
    if value and len(value) >= 8:
        _known_values.add(value)


def redact(text: str) -> str:
    for value in sorted(_known_values, key=len, reverse=True):
        text = text.replace(value, MASK)
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text


def _redact_record(record: logging.LogRecord) -> None:
    message = record.getMessage()
    clean = redact(message)
    if clean != message:
        record.msg, record.args = clean, None
    if record.exc_info and record.exc_info[1] is not None and not record.exc_text:
        record.exc_text = redact(logging.Formatter().formatException(record.exc_info))


_installed = False


def install_log_redaction() -> None:
    """Mask secrets in every log record, from the app and its libraries alike (idempotent).
    A record factory sees every record, however loggers and handlers are set up later."""
    global _installed
    if _installed:
        return
    make = logging.getLogRecordFactory()

    def factory(*args, **kwargs):
        record = make(*args, **kwargs)
        _redact_record(record)
        return record

    logging.setLogRecordFactory(factory)
    _installed = True
