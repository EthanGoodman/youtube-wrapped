"""Hostile and broken exports are refused cleanly (#15): nothing crashes, fills the disk or escapes."""
import copy
import json
import shutil
import sqlite3
import zipfile
from pathlib import Path

import pytest
from connector_contract import FIXTURES

from ytw.config import load_config
from ytw.connectors.youtube import YouTube
from ytw.imports import (ImportRejected, Limits, Source, check_name, locate, parse_csv, parse_json, sniff,
                         store_original)


def make_zip(path: Path, members: dict, **infos) -> Path:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in members.items():
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            for k, v in infos.get(name, {}).items():
                setattr(info, k, v)
            z.writestr(info, data)
    return path


# ------------------------------------------------------------------ names

@pytest.mark.parametrize("name", ["../evil.txt", "a/../../evil", "/etc/passwd", "C:/Windows/x", "c:evil",
                                  "a\\..\\..\\evil", "\\\\server\\share", "", "a\x00b"])
def test_escaping_names_refused(name):
    with pytest.raises(ImportRejected):
        check_name(name)


def test_normal_names_kept():
    assert check_name("Takeout\\YouTube\\history\\watch-history.json") == "Takeout/YouTube/history/watch-history.json"
    assert check_name("a/b..c/d.json") == "a/b..c/d.json"


@pytest.mark.parametrize("name", ["../../evil.json", "/abs.json"])
def test_zip_slip_refused(tmp_path, name):
    z = make_zip(tmp_path / "x.zip", {"ok.json": "[]", name: "[]"})
    with pytest.raises(ImportRejected, match="unsafe path"):
        Source(z)
    assert not (tmp_path.parent / "evil.json").exists()


# ------------------------------------------------------------------ archive tricks

def test_symlink_refused(tmp_path):
    z = make_zip(tmp_path / "x.zip", {"link": "/etc/passwd"}, link={"external_attr": 0o120777 << 16})
    with pytest.raises(ImportRejected, match="symlink"):
        Source(z)


def test_password_protected_refused(tmp_path):
    z = make_zip(tmp_path / "x.zip", {"a.json": "[]"})
    raw = bytearray(z.read_bytes())
    for sig in (b"PK\x03\x04", b"PK\x01\x02"):            # set the "encrypted" bit in both headers
        i = raw.find(sig)
        off = i + (6 if sig == b"PK\x03\x04" else 8)
        raw[off] |= 0x1
    z.write_bytes(bytes(raw))
    with pytest.raises(ImportRejected, match="password"):
        Source(z)


def test_zip_bomb_refused(tmp_path):
    z = make_zip(tmp_path / "bomb.zip", {"zeros.json": b"0" * (3 * 1024 * 1024)})
    with pytest.raises(ImportRejected, match="zip bomb"):
        Source(z, Limits(max_ratio=200))


def test_too_many_files(tmp_path):
    z = make_zip(tmp_path / "x.zip", {f"f{i}.json": "[]" for i in range(11)})
    with pytest.raises(ImportRejected, match="more than 10 files"):
        Source(z, Limits(max_files=10))


def test_total_size_limit(tmp_path):
    z = make_zip(tmp_path / "x.zip", {"a.json": "[" + "1," * 300 + "1]", "b.json": "[" + "1," * 300 + "1]"})
    with pytest.raises(ImportRejected, match="unpack to more"):
        Source(z, Limits(max_total=1000))


def test_member_size_limit_while_reading(tmp_path):
    big = json.dumps(list(range(500))).encode()
    with Source(make_zip(tmp_path / "x.zip", {"a.json": big}), Limits(max_member=10_000)) as s:
        assert len(s.read_json("a.json")) == 500
    with pytest.raises(ImportRejected):
        Source(make_zip(tmp_path / "y.zip", {"a.json": big}), Limits(max_member=100))


def test_duplicate_member_refused(tmp_path):
    p = tmp_path / "x.zip"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("a.json", "[1]")
        with pytest.warns(UserWarning):
            z.writestr("a.json", "[2]")
    with pytest.raises(ImportRejected, match="twice"):
        Source(p)


def test_broken_zip(tmp_path):
    p = tmp_path / "x.zip"
    p.write_bytes(b"PK\x03\x04" + b"garbage" * 10)
    with pytest.raises(ImportRejected, match="broken ZIP"):
        Source(p)


def test_upload_size_limit(tmp_path):
    p = tmp_path / "a.json"
    p.write_text("[" + "1," * 100 + "1]")
    with pytest.raises(ImportRejected, match="over"):
        Source(p, Limits(max_upload=50))


def test_deadline(tmp_path):
    p = tmp_path / "a.json"
    p.write_text("[1]")
    with Source(p, Limits(seconds=-1)) as s, pytest.raises(ImportRejected, match="too long"):
        s.read_json("a.json")


# ------------------------------------------------------------------ what's inside

@pytest.mark.parametrize("head, kind", [(b"PK\x03\x04", "zip"), (b"\x1f\x8b\x08", "gzip"), (b'\xef\xbb\xbf  [1]', "json"),
                                        (b'{"a":1}', "json"), (b"window.YTD.tweets.part0 = [", "js"),
                                        (b"Title,Date\n", "text"), (b"\x89PNG\r\n\x1a\n\x00", "binary")])
def test_sniff(head, kind):
    assert sniff(head) == kind


def test_wrong_file_types_refused(tmp_path):
    (tmp_path / "a.tgz").write_bytes(b"\x1f\x8b\x08\x00" + b"\0" * 20)
    with pytest.raises(ImportRejected, match=".zip instead"):
        Source(tmp_path / "a.tgz")
    (tmp_path / "a.json").write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00")
    with pytest.raises(ImportRejected, match="isn't a ZIP"):
        Source(tmp_path / "a.json")


def test_json_limits():
    assert parse_json(b"window.YTD.tweets.part0 = [{\"id\": 1}]") == [{"id": 1}]
    assert parse_json(b"\xef\xbb\xbf[1, 2]") == [1, 2]
    with pytest.raises(ImportRejected, match="64 levels"):
        parse_json(b"[" * 100 + b"]" * 100)
    with pytest.raises(ImportRejected):
        parse_json(b"[" * 100_000)                        # far past any parser's recursion limit
    with pytest.raises(ImportRejected, match="MiB"):
        parse_json(b"[" + b"1," * 1000 + b"1]", Limits(max_json=100))
    with pytest.raises(ImportRejected, match="not valid JSON"):
        parse_json(b'{"a": ')


def test_csv_limits():
    assert parse_csv(b"Title,Date\nA,1/1/25\n") == [{"Title": "A", "Date": "1/1/25"}]
    with pytest.raises(ImportRejected, match="field"):
        parse_csv(b'Title,Date\n"' + b"x" * 5000 + b'",1/1/25\n', Limits(max_csv_field=1000))
    with pytest.raises(ImportRejected, match="rows"):
        parse_csv(b"A\n" + b"x\n" * 20, Limits(max_csv_rows=10))
    with pytest.raises(ImportRejected, match="binary"):
        parse_csv(b"A,B\n\x00\x01,2\n")
    with pytest.raises(ImportRejected, match="UTF-8"):
        parse_csv(b"A,B\n\xff\xfe,2\n")


# ------------------------------------------------------------------ originals + finding files

def test_store_original_stays_inside(tmp_path):
    src = tmp_path / "..evil name;rm -rf.zip"
    src.write_bytes(b"PK\x05\x06" + b"\0" * 18)
    dest = store_original(src, tmp_path / "data" / "youtube")
    assert dest.parent.parent == tmp_path / "data" / "youtube" / "imports"
    assert dest.name == "evil_name_rm_-rf.zip" and dest.read_bytes() == src.read_bytes()
    assert store_original(src, tmp_path / "data" / "youtube").parent != dest.parent      # never overwrites


def test_locate_takes_the_newest_file_or_zip(tmp_path):
    import os
    z = make_zip(tmp_path / "takeout.zip", {"Takeout/YouTube/history/watch-history.json": "[1]"})
    os.utime(z, (1_700_000_000, 1_700_000_000))
    src, member = locate(tmp_path, "watch-history.json")
    with src:
        assert member.endswith("history/watch-history.json") and src.read_json(member) == [1]
    (tmp_path / "watch-history.json").write_text("[2]")
    os.utime(tmp_path / "watch-history.json", (1_800_000_000, 1_800_000_000))
    src, member = locate(tmp_path, "watch-history.json")
    with src:
        assert src.read_json(member) == [2]
    assert locate(tmp_path, "nothing.json") is None


def test_youtube_reads_a_takeout_zip_like_the_plain_files(tmp_path):
    """Dropping the Takeout .zip in data/youtube/ gives the same result as the unzipped files."""
    def build(name, setup):
        data = tmp_path / name
        (data / "youtube").mkdir(parents=True)
        setup(data / "youtube")
        cfg = load_config()
        cfg.raw = copy.deepcopy(cfg.raw)
        cfg.raw["general"]["data_dir"] = str(data)
        YouTube(cfg, out=lambda s: None).ingest()
        conn = sqlite3.connect(data / "youtube.db")
        rows = conn.execute("SELECT * FROM watches ORDER BY entry_id").fetchall()
        n = conn.execute("SELECT COUNT(*) FROM searches").fetchone()[0]
        conn.close()
        return rows, n

    fx = FIXTURES / "youtube"
    plain = build("plain", lambda d: [shutil.copy(p, d) for p in fx.iterdir()])
    zipped = build("zipped", lambda d: make_zip(d / "takeout-20260101T000000Z-001.zip", {
        f"Takeout/YouTube and YouTube Music/history/{p.name}": p.read_bytes() for p in fx.iterdir()}))
    assert plain == zipped and plain[0] and plain[1] == 1
