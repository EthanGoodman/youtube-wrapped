"""Reading people's exports safely: ZIPs, JSON, CSV and X's .js-wrapped JSON.

Exports come from outside and can be broken or hostile. Nothing here extracts to disk or runs
anything from an archive; members are read in memory through capped streams. Refused, with a
clear message (ImportRejected), are:
- member names that are absolute, use `..`, a drive letter, NUL, or are symlinks; encrypted members
- more data than the limits allow: upload size, file count, total and per-file uncompressed size,
  compression ratio (zip bombs), JSON size and nesting depth, CSV rows and field size, time spent
- content that isn't what it claims (sniffed from the first bytes; .tgz asks for a .zip instead)

Usage:
    with Source(path) as src:                 # a .zip, or a single .json / .csv / .js file
        data = src.read_json(src.find("watch-history.json")[0])

New formats (e.g. Bluesky's CAR) register a reader in READERS.
"""
from __future__ import annotations

import csv
import io
import re
import secrets
import shutil
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import orjson

GiB = 1024 ** 3
MiB = 1024 ** 2


class ImportRejected(Exception):
    """The file can't be imported safely; the message says why."""


@dataclass(frozen=True)
class Limits:
    max_upload: int = 8 * GiB          # the archive itself (Takeout zips can carry a lot we skip)
    max_files: int = 200_000
    max_total: int = 16 * GiB          # all members, uncompressed
    max_member: int = 2 * GiB          # one member, uncompressed
    max_ratio: float = 200.0           # uncompressed / compressed, for members over 1 MiB
    max_json: int = 1 * GiB
    max_depth: int = 64
    max_csv_rows: int = 5_000_000
    max_csv_field: int = 1 * MiB
    seconds: float = 900.0             # one import, start to finish


DEFAULT = Limits()
_CHUNK = 1 * MiB
_ALLOWED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA}


def check_name(name: str) -> str:
    """A member name that stays inside the archive, with / separators; else ImportRejected."""
    if not name or "\x00" in name:
        raise ImportRejected("an archive entry has an empty or invalid name")
    norm = name.replace("\\", "/")
    parts = norm.split("/")
    if norm.startswith("/") or re.match(r"^[A-Za-z]:", norm) or ".." in parts:
        raise ImportRejected(f"unsafe path in the archive: {name[:80]!r}")
    return norm


def sniff(head: bytes) -> str:
    """What a file is from its first bytes: zip | json | js | gzip | text | binary."""
    h = head.lstrip(b"\xef\xbb\xbf").lstrip()
    if head.startswith((b"PK\x03\x04", b"PK\x05\x06")):
        return "zip"
    if head.startswith(b"\x1f\x8b"):
        return "gzip"
    if h[:1] in (b"{", b"["):
        return "json"
    if h.startswith(b"window."):
        return "js"
    if b"\x00" in head:
        return "binary"
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as e:
        if e.start < len(head) - 4:       # a cut-off multi-byte char at the end is fine
            return "binary"
    return "text"


def _depth_ok(obj, max_depth: int) -> bool:
    stack = [(obj, 1)]
    while stack:
        x, d = stack.pop()
        if isinstance(x, (dict, list)):
            if d > max_depth:
                return False
            stack.extend((v, d + 1) for v in (x.values() if isinstance(x, dict) else x))
    return True


def parse_json(data: bytes, limits: Limits = DEFAULT):
    """JSON (or X's `window.YTD.x.part0 = [...]`) -> Python objects, within the limits."""
    if len(data) > limits.max_json:
        raise ImportRejected(f"JSON file over {limits.max_json // MiB:,} MiB")
    body = data.lstrip(b"\xef\xbb\xbf").lstrip()
    if body.startswith(b"window."):
        eq = body.find(b"=")
        if eq < 0:
            raise ImportRejected("not valid JSON")
        body = body[eq + 1:]
    try:
        obj = orjson.loads(body)
    except orjson.JSONDecodeError as e:
        raise ImportRejected("too deeply nested" if "recursion" in str(e).lower() else "not valid JSON") from None
    if not _depth_ok(obj, limits.max_depth):
        raise ImportRejected(f"JSON nested more than {limits.max_depth} levels deep")
    return obj


def parse_csv(data: bytes, limits: Limits = DEFAULT) -> list[dict[str, str]]:
    """CSV with a header row -> list of dicts, within the limits."""
    text = decode_text(data)
    old = csv.field_size_limit()
    csv.field_size_limit(limits.max_csv_field)
    try:
        rows = []
        for row in csv.DictReader(io.StringIO(text, newline="")):
            rows.append(row)
            if len(rows) > limits.max_csv_rows:
                raise ImportRejected(f"CSV has more than {limits.max_csv_rows:,} rows")
        return rows
    except csv.Error as e:
        raise ImportRejected(f"malformed CSV: {e}") from None
    finally:
        csv.field_size_limit(old)


def decode_text(data: bytes) -> str:
    if b"\x00" in data:
        raise ImportRejected("expected a text file, got binary data")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ImportRejected("text isn't UTF-8") from None


# kind -> reader; Source.read() picks one by sniffing the member
READERS: dict[str, Callable[[bytes, Limits], object]] = {"json": parse_json, "js": parse_json, "text": parse_csv}


class Source:
    """An export to read: one .zip, or a single file. Use as a context manager."""

    def __init__(self, path: Path, limits: Limits = DEFAULT):
        self.path = Path(path)
        self.limits = limits
        self.deadline = time.monotonic() + limits.seconds
        self._total = 0
        try:
            size = self.path.stat().st_size
            with self.path.open("rb") as f:
                head = f.read(64)
        except OSError as e:
            raise ImportRejected(f"can't read {self.path.name}: {e.strerror}") from None
        if size > limits.max_upload:
            raise ImportRejected(f"{self.path.name} is over {limits.max_upload // GiB} GiB")
        self.kind = sniff(head)
        self._zip: zipfile.ZipFile | None = None
        self._members: dict[str, zipfile.ZipInfo | None] = {}
        if self.kind == "gzip":
            raise ImportRejected("this is a .tgz/.gz archive; export as .zip instead")
        if self.kind == "binary":
            raise ImportRejected(f"{self.path.name} isn't a ZIP, JSON or CSV file")
        if self.kind == "zip":
            self._open_zip()
        else:
            self._members[self.path.name] = None

    def _open_zip(self) -> None:
        try:
            self._zip = zipfile.ZipFile(self.path)
            infos = self._zip.infolist()
        except (zipfile.BadZipFile, OSError, ValueError) as e:
            raise ImportRejected(f"broken ZIP file: {e}") from None
        if len(infos) > self.limits.max_files:
            raise ImportRejected(f"ZIP has more than {self.limits.max_files:,} files")
        declared = 0
        for info in infos:
            name = check_name(info.filename)
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ImportRejected(f"ZIP contains a symlink: {name[:80]!r}")
            if info.flag_bits & 0x1:
                raise ImportRejected("ZIP is password-protected")
            if info.is_dir():
                continue
            if info.compress_type not in _ALLOWED_COMPRESSION:
                raise ImportRejected("ZIP uses an unsupported compression method")
            self._check_ratio(name, info.file_size, info.compress_size)
            if info.file_size > self.limits.max_member:
                raise ImportRejected(f"{name[:80]} is over {self.limits.max_member // GiB} GiB uncompressed")
            declared += info.file_size
            if name in self._members:
                raise ImportRejected(f"ZIP lists {name[:80]!r} twice")
            self._members[name] = info
        if declared > self.limits.max_total:
            raise ImportRejected(f"ZIP would unpack to more than {self.limits.max_total // GiB} GiB")

    def _check_ratio(self, name: str, size: int, compressed: int) -> None:
        if size > MiB and size / max(compressed, 1) > self.limits.max_ratio:
            raise ImportRejected(f"{name[:80]} is compressed suspiciously well (possible zip bomb)")

    def _tick(self) -> None:
        if time.monotonic() > self.deadline:
            raise ImportRejected("import took too long")

    # -- reading ----------------------------------------------------------------
    def names(self) -> list[str]:
        return list(self._members)

    def find(self, basename: str) -> list[str]:
        """Members whose file name is `basename` (any folder, any case), shortest path first."""
        b = basename.lower()
        return sorted((n for n in self._members if n.rsplit("/", 1)[-1].lower() == b), key=len)

    def read_bytes(self, name: str) -> bytes:
        if name not in self._members:
            raise ImportRejected(f"{name[:80]!r} isn't in {self.path.name}")
        info = self._members[name]
        cap = self.limits.max_member
        out = bytearray()
        try:
            stream = self._zip.open(info) if info is not None else self.path.open("rb")
            with stream:
                while chunk := stream.read(_CHUNK):
                    out += chunk
                    self._total += len(chunk)
                    if len(out) > cap or self._total > self.limits.max_total:
                        raise ImportRejected(f"{name[:80]} is larger than allowed")
                    if info is not None:
                        self._check_ratio(name, len(out), info.compress_size)
                    self._tick()
        except (zipfile.BadZipFile, OSError, EOFError, zipfile.LargeZipFile) as e:
            raise ImportRejected(f"couldn't read {name[:80]}: {e}") from None
        return bytes(out)

    def read_json(self, name: str):
        return parse_json(self.read_bytes(name), self.limits)

    def read_csv(self, name: str) -> list[dict[str, str]]:
        return parse_csv(self.read_bytes(name), self.limits)

    def read_text(self, name: str) -> str:
        return decode_text(self.read_bytes(name))

    def read(self, name: str):
        """Any supported member, by what its bytes look like."""
        data = self.read_bytes(name)
        reader = READERS.get(sniff(data[:64]))
        if reader is None:
            raise ImportRejected(f"{name[:80]}: unsupported file type")
        return reader(data, self.limits)

    def close(self) -> None:
        if self._zip is not None:
            self._zip.close()

    def __enter__(self) -> "Source":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def safe_basename(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", name.replace("\\", "/").rsplit("/", 1)[-1]).strip("._")
    return (base or "upload")[:100]


def store_original(src: Path, platform_dir: Path, limits: Limits = DEFAULT) -> Path:
    """Keep a copy of an upload under data/<platform>/imports/<random>/ (data/ is never served)."""
    if src.stat().st_size > limits.max_upload:
        raise ImportRejected(f"{src.name} is over {limits.max_upload // GiB} GiB")
    dest = platform_dir / "imports" / secrets.token_hex(8) / safe_basename(src.name)
    dest.parent.mkdir(parents=True)
    shutil.copyfile(src, dest)
    return dest


def locate(folder: Path, basename: str, limits: Limits = DEFAULT) -> tuple[Source, str] | None:
    """Find an export file in data/<platform>/: the file itself, else inside a .zip there
    (newest zip first). Returns an open Source and the member name; the caller closes it."""
    plain = folder / basename
    if plain.is_file():
        src = Source(plain, limits)
        return src, src.names()[0]
    for z in sorted(folder.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True):
        src = Source(z, limits)
        hits = src.find(basename)
        if hits:
            return src, hits[0]
        src.close()
    return None


__all__ = ["DEFAULT", "ImportRejected", "Limits", "READERS", "Source", "check_name", "decode_text", "locate",
           "parse_csv", "parse_json", "sniff", "store_original"]
