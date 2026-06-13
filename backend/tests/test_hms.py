"""HMS decoding — pure stdlib, runs without app deps."""
from app.services import hms


def test_code_str():
    assert hms.code_str(0x03000100, 0x00020001) == "0300_0100_0002_0001"


def test_severity_levels():
    assert hms.severity(0x00010000) == "fatal"
    assert hms.severity(0x00020000) == "serious"
    assert hms.severity(0x00030000) == "common"
    assert hms.severity(0x00040000) == "info"
    assert hms.severity(0x00000000) == "unknown"


def test_severe_entries_filters_to_fatal_serious():
    entries = [
        {"attr": 0x03000100, "code": 0x00010001},  # fatal
        {"attr": 0x03000200, "code": 0x00020001},  # serious
        {"attr": 0x03000300, "code": 0x00040001},  # info → ignored
    ]
    severe = hms.severe_entries(entries)
    assert len(severe) == 2
    assert {s[1] for s in severe} == {"fatal", "serious"}


def test_severe_entries_handles_garbage():
    assert hms.severe_entries([{"bad": "data"}, None]) == []
    assert hms.severe_entries([]) == []


def test_normalize_code_ignores_separators_and_case():
    assert hms.normalize_code("0c00-0100-0001-0004") == "0C00010000010004"
    assert hms.normalize_code("0C00_0100_0001_0004") == "0C00010000010004"
    assert hms.normalize_code(" 0C00 0100 0001 0004 ") == "0C00010000010004"
    assert hms.normalize_code(None) == ""


def test_known_soft_code_is_in_default_list():
    # The harmless AMS notice the user reported must default to non-blocking.
    cs = hms.code_str(0x0C000100, 0x00010004)
    assert hms.normalize_code(cs) in hms.HMS_SOFT_DEFAULT
