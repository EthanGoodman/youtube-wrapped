from ytw.config import Config, migrate_legacy_layout


def cfg_at(tmp_path):
    return Config(raw={"general": {"timezone": "America/New_York", "data_dir": "data"}}, root=tmp_path)


def test_platform_paths(tmp_path):
    c = cfg_at(tmp_path)
    assert c.platform_dir("netflix") == tmp_path / "data" / "netflix"
    assert c.platform_db("netflix") == tmp_path / "data" / "netflix.db"
    assert c.db_path == tmp_path / "data" / "youtube.db" and c.data_dir == tmp_path / "data" / "youtube"


def test_migrates_old_layout(tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    for name in ("watch-history.json", "search-history.json", "wrapped.db", "wrapped.db-wal"):
        (d / name).write_text(name)
    moved = migrate_legacy_layout(cfg_at(tmp_path))
    assert len(moved) == 3
    assert (d / "youtube" / "watch-history.json").read_text() == "watch-history.json"
    assert (d / "youtube.db").read_text() == "wrapped.db"
    assert (d / "youtube.db-wal").read_text() == "wrapped.db-wal"
    assert not (d / "wrapped.db").exists()
    assert migrate_legacy_layout(cfg_at(tmp_path)) == []  # second run: nothing to do


def test_never_overwrites(tmp_path):
    d = tmp_path / "data"
    (d / "youtube").mkdir(parents=True)
    (d / "watch-history.json").write_text("old")
    (d / "youtube" / "watch-history.json").write_text("new")
    (d / "wrapped.db").write_text("old db")
    (d / "youtube.db").write_text("new db")
    assert migrate_legacy_layout(cfg_at(tmp_path)) == []
    assert (d / "youtube" / "watch-history.json").read_text() == "new"
    assert (d / "youtube.db").read_text() == "new db"
