"""Version comparison helpers — ensure the 0.x line ignores legacy 4.x releases."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers.system import _ver_tuple, _is_newer, _same_release_line  # noqa: E402


def test_ver_tuple_strips_v():
    assert _ver_tuple("v0.4.3") == (0, 4, 3)
    assert _ver_tuple("4.3.5") == (4, 3, 5)


def test_is_newer():
    assert _is_newer("0.4.4", "0.4.3")
    assert not _is_newer("0.4.3", "0.4.4")
    assert not _is_newer("0.4.3", "0.4.3")


def test_same_release_line_ignores_legacy():
    # Running 0.4.3 must not treat old 4.x as an update candidate.
    assert _same_release_line("0.5.0", "0.4.3")
    assert not _same_release_line("4.3.5", "0.4.3")


def test_unknown_current_allows_all():
    assert _same_release_line("4.3.5", "unknown")
