"""Schritt-Arten: Ablauf, Editor und Profil-Import kennen DIESELBEN.

Bis v1.1.34 hatte der Profil-Import eine eigene Liste. Sie war beim Dazukommen
von `app_op`, `wait_homing` und `wait_cool` nicht mitgewachsen: ein exportiertes
und wieder eingespieltes Profil verlor genau diese Schritte — fast alle Bewegungen
eines aktuellen Zyklus — und das Feld `nowait`, ohne jede Meldung.
"""
import inspect
import os
import re

import pytest

pytest.importorskip("fastapi")

from app.routers import autofarm as af  # noqa: E402
from app.services import farm_settings, profiles, rack_store, storage  # noqa: E402
from app.services.sequence_steps import STEP_TYPES  # noqa: E402

EDITOR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src",
                      "pages", "SequenceEditor.jsx")


def test_der_ablauf_kennt_jede_schritt_art():
    quelle = inspect.getsource(af._exec_step)
    behandelt = set(re.findall(r't == "(\w+)"', quelle))
    for tupel in re.findall(r"t in \(([^)]*)\)", quelle):
        behandelt |= set(re.findall(r'"(\w+)"', tupel))
    assert STEP_TYPES == behandelt


def test_der_editor_kennt_jede_schritt_art():
    if not os.path.exists(EDITOR):
        pytest.skip("Frontend nicht vorhanden")
    with open(EDITOR, encoding="utf-8") as f:
        src = f.read()
    block = src[src.index("const TYPE_META = {"):]
    block = block[:block.index("\n}\n")]
    im_editor = set(re.findall(r"^\s{2}(\w+)\s*:", block, re.MULTILINE))
    assert im_editor == STEP_TYPES


@pytest.mark.parametrize("typ", ["app_op", "wait_homing", "wait_cool"])
def test_aktuelle_schritte_ueberleben_den_import(typ):
    assert profiles._sanitize_step({"type": typ, "value": "eject"})["type"] == typ


def test_nowait_ueberlebt_den_import():
    s = profiles._sanitize_step({"type": "send_homing_file", "nowait": True})
    assert s["nowait"] is True


@pytest.fixture
def ablage(tmp_path, monkeypatch):
    monkeypatch.setattr(rack_store, "SLOTS_PATH", str(tmp_path / "rack.json"))
    monkeypatch.setattr(farm_settings, "PATH", str(tmp_path / "settings.json"))
    monkeypatch.setattr(af, "SEQ_PATH", str(tmp_path / "seq.json"))
    return tmp_path


def test_profil_sagt_ob_es_ein_magazin_gibt(ablage):
    rack_store.save(rack_store.default_data(2, 6))
    with rack_store.edit() as d:
        rack_store.apply_config(d, {"magazine_slot": 0})
    assert profiles.build_profile("p", "", "", [])["rack_config"]["magazine_slot"] == 0

    rack_store.save(rack_store.default_data(2, 6))       # Zielanlage MIT Magazin
    assert profiles._apply_rack_config({"magazine_slot": 0})
    d = rack_store.load()
    assert d["magazine_slot"] == 0
    assert d["empty_plates_migrated"] is True             # wie in der Regalverwaltung


def test_belegung_der_faecher_bleibt_beim_import(ablage):
    d = rack_store.default_data(1, 6)
    d["slots"]["1-3"]["status"] = "done"
    rack_store.save(d)
    profiles._apply_rack_config({"slot_height_mm": 60, "slots": {"1-3": {"status": "free"}}})
    d = rack_store.load()
    assert d["slot_height_mm"] == 60
    assert d["slots"]["1-3"]["status"] == "done"


def test_einstellungen_werden_zusammengefuehrt(ablage):
    """Ein Profil aus einer älteren Version nennt nicht jedes Feld — was fehlt,
    darf nicht auf die Vorgabe zurückspringen."""
    storage.write_json(farm_settings.PATH, {**farm_settings.DEFAULTS,
                                            "power_price_eur_kwh": 0.42})
    assert profiles._apply_settings({"poll_interval": 30})
    s = farm_settings.read()
    assert s["poll_interval"] == 30
    assert s["power_price_eur_kwh"] == 0.42


def test_alte_kalibrierung_allein_ist_kein_profil(ablage):
    assert not any(profiles.apply_profile({"macro_config": {"open_door_x1c": {}}}).values())


def test_sequenzen_rundlauf(ablage):
    zyklus = [{"id": 1, "type": "app_op", "value": "eject"},
              {"id": 2, "type": "wait_cool", "value": "30", "seconds": 1800},
              {"id": 3, "type": "send_homing_file", "nowait": True}]
    assert profiles._apply_sequences({"seq_new": [], "seq_next": zyklus})
    gelesen = storage.read_json(af.SEQ_PATH, {})
    assert [s["type"] for s in gelesen["seq_next"]] == ["app_op", "wait_cool", "send_homing_file"]
    assert gelesen["seq_next"][2]["nowait"] is True
    assert gelesen["schema_version"] == af.SEQ_SCHEMA_VERSION
