"""Regal-Zustand (rack_store): Neuinstallation und gleichzeitige Änderungen.

Bis v1.1.34 lasen und schrieben Regalverwaltung und Farm `rack_slots.json` jede
für sich („lesen, ändern, schreiben"). Liefen zwei Änderungen gleichzeitig — der
Nutzer räumt ein Fach, die Farm reserviert ein anderes —, überschrieb die zweite
die erste. Seit v1.1.35 gehen alle Änderungen durch `rack_store.edit()`.

(Die Datei hieß nach dem entfernten Mehrregal-Modell; dessen Liste bewirkte nichts
und ist mit v1.1.35 weg.)
"""
import threading

import pytest

pytest.importorskip("fastapi")

from app.routers import rack_manager as rm  # noqa: E402
from app.services import rack_store  # noqa: E402


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(rack_store, "SLOTS_PATH", str(tmp_path / "rack_slots.json"))
    return tmp_path


def test_neuinstallation_bekommt_ein_vollstaendiges_regal(store):
    data = rack_store.load()
    assert data["num_racks"] == rack_store.DEFAULT_NUM_RACKS
    assert len(data["slots"]) == rack_store.DEFAULT_NUM_RACKS * rack_store.DEFAULT_SLOTS_PER_RACK
    assert len(data["magazine_counts"]) == data["num_racks"]


def test_die_uebersicht_einer_neuinstallation_laedt(store):
    r = rm.get_all()
    assert r["num_slots"] == len(r["slots"])
    assert r["slot_height_mm"] > 0


def test_eine_datei_ohne_fachhoehe_bricht_nichts(store):
    """Vorher griff die Übersicht direkt auf data["slot_height_mm"] zu."""
    rack_store.save({"num_racks": 1, "slots_per_rack": 2, "slots": {}})
    assert rm.get_all()["slot_height_mm"] == rack_store.DEFAULT_SLOT_H


def test_gleichzeitige_aenderungen_gehen_nicht_verloren(store):
    rack_store.save(rack_store.default_data(1, 20))
    faecher = [f"1-{s}" for s in range(1, 21)]

    def belegen(key):
        rack_store.update_slot(key, "done", file_name=key)

    threads = [threading.Thread(target=belegen, args=(k,)) for k in faecher]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    data = rack_store.load()
    assert all(data["slots"][k]["status"] == "done" for k in faecher)


def test_ein_abgebrochenes_edit_schreibt_nichts(store):
    rack_store.save(rack_store.default_data(1, 2))
    with pytest.raises(RuntimeError):
        with rack_store.edit() as data:
            data["slots"]["1-1"]["status"] = "locked"
            raise RuntimeError("halb fertig")
    assert rack_store.load()["slots"]["1-1"]["status"] == "free"


def test_ohne_regal_datei_schreibt_die_farm_nichts(store):
    """Die Farm legt keine Regal-Datei an — das ist Sache der Einrichtung."""
    assert rack_store.update_slot("1-1", "done") is False
    assert not rack_store.exists()
