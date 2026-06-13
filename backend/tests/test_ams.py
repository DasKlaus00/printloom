"""AMS confidence matching — drives the 'manuelle AMS-Festlegung' block."""
import pytest

pytest.importorskip("fastapi")

from app.routers.printer import _ams_match_confident  # noqa: E402


def _ams(tray_type, color):
    return {"ams": [{"id": 0, "tray": [{"id": 0, "tray_type": tray_type,
                                        "tray_color": color, "remain": 50}]}]}


def test_confident_match():
    _, missing = _ams_match_confident(["PLA"], ["#FF0000"], _ams("PLA", "FF0000FF"))
    assert missing == []


def test_near_color_ok():
    _, missing = _ams_match_confident(["PLA"], ["#FE0202"], _ams("PLA", "FF0000FF"))
    assert missing == []


def test_wrong_color_does_not_block():
    """Color mismatch never blocks: same material → auto-pick that slot."""
    mapping, missing = _ams_match_confident(["PLA"], ["#FF0000"], _ams("PLA", "00FF00FF"))
    assert missing == []
    assert mapping == [0]


def test_picks_exact_color_across_slots():
    """With several same-material trays, the closest color wins regardless of slot."""
    ams = {"ams": [{"id": 0, "tray": [
        {"id": 0, "tray_type": "PLA", "tray_color": "00FF00FF", "remain": 50},
        {"id": 1, "tray_type": "PLA", "tray_color": "FF0000FF", "remain": 50},
    ]}]}
    mapping, missing = _ams_match_confident(["PLA"], ["#FF0000"], ams)
    assert missing == []
    assert mapping == [1]  # slot with the matching red, not slot 0


def test_missing_material_flagged():
    _, missing = _ams_match_confident(["TPU"], ["#FFFFFF"], _ams("PETG", "FFFFFFFF"))
    assert len(missing) == 1 and missing[0]["reason"] == "kein passendes Material im AMS"


def test_ams_unreadable_flags_all():
    _, missing = _ams_match_confident(["PLA"], ["#FF0000"], {})
    assert len(missing) == 1
