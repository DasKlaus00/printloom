"""Mehrregal-Liste (/rack-manager/racks) bei einer Neuinstallation.

DEFAULT_ROWS / DEFAULT_COLS waren beim Umbau auf num_racks/slots_per_rack
verschwunden, die Endpunkte nicht. Ohne racks.json kam beim Laden ein NameError,
und „Regal anlegen" scheiterte IMMER — der Ersatzwert in body.get(…, DEFAULT_ROWS)
wird ausgewertet, auch wenn der Wert im Body steht. Die Oberfläche schluckte den
Fehler still („multi-rack is an enhancement")."""
import pytest

pytest.importorskip("fastapi")

from app.routers import rack_manager as rm  # noqa: E402


def test_neuinstallation_bekommt_ein_standardregal(tmp_path, monkeypatch):
    monkeypatch.setattr(rm, "RACKS_PATH", str(tmp_path / "racks.json"))
    racks = rm._load_racks()
    assert len(racks) == 1
    assert racks[0]["rows"] == rm.DEFAULT_SLOTS_PER_RACK
    assert racks[0]["cols"] == 1


def test_die_standardwerte_existieren():
    """Der eigentliche Fehler war ein fehlender Name — hier festgenagelt."""
    assert rm.DEFAULT_ROWS > 0
    assert rm.DEFAULT_COLS > 0
