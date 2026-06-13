"""Tests for the atomic JSON storage layer. Pure stdlib — runs without app deps."""
import os
from app.services import storage


def test_write_read_roundtrip(tmp_path):
    p = str(tmp_path / "x.json")
    storage.write_json(p, {"a": 1, "b": [1, 2, 3]})
    assert storage.read_json(p) == {"a": 1, "b": [1, 2, 3]}


def test_read_missing_returns_default(tmp_path):
    p = str(tmp_path / "nope.json")
    assert storage.read_json(p, {"d": True}) == {"d": True}


def test_read_corrupt_returns_default(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{ not valid json")
    assert storage.read_json(str(p), {"fallback": 1}) == {"fallback": 1}


def test_overwrite(tmp_path):
    p = str(tmp_path / "z.json")
    storage.write_json(p, {"v": 1})
    storage.write_json(p, {"v": 2})
    assert storage.read_json(p)["v"] == 2


def test_no_tempfile_left_behind(tmp_path):
    p = str(tmp_path / "y.json")
    storage.write_json(p, {"ok": 1})
    leftovers = [f for f in os.listdir(tmp_path) if ".tmp." in f]
    assert leftovers == []


def test_creates_parent_dirs(tmp_path):
    p = str(tmp_path / "sub" / "deep" / "f.json")
    storage.write_json(p, {"n": 5})
    assert storage.read_json(p) == {"n": 5}
