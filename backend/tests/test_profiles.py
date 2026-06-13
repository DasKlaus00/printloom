"""Profile import safety — the sequence-step whitelist guards against
arbitrary step types sneaking in via a downloaded profile."""
import pytest

pytest.importorskip("fastapi")

from app.services import profiles  # noqa: E402


def test_schema_constant():
    assert profiles.SCHEMA == "om4d-profile/1"


def test_sanitize_rejects_unknown_type():
    assert profiles._sanitize_step({"type": "shell", "value": "rm -rf /"}) is None


def test_sanitize_rejects_non_dict():
    assert profiles._sanitize_step("nope") is None
    assert profiles._sanitize_step(None) is None


def test_sanitize_allows_known_type_and_stringifies_value():
    s = profiles._sanitize_step({"id": 1, "type": "macro", "value": 123, "label": "x"})
    assert s["type"] == "macro"
    assert s["value"] == "123"
    assert s["label"] == "x"


def test_sanitize_keeps_only_known_fields():
    s = profiles._sanitize_step({"type": "delay", "seconds": 5, "evil": "drop table"})
    assert "evil" not in s
    assert s["seconds"] == 5
