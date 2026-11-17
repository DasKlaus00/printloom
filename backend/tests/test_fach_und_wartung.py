"""Funde aus dem Review der Schritte 10–15 (seit v1.1.65).

- Nach „↺ Reset" behielt ein Job sein altes Fach und lagerte in ein belegtes ein.
- Ein Job-Fehler gab jedes Fach des Jobs frei, auch eines mit Platte.
- Eigener G-code mit G91 fiel erst mitten im Zyklus auf.
- Ohne Bettbreite erklärte die Farm in Sekunden jeden Job zum Fehler.
- Zwischen Stillstand-Prüfung und Update/Einspielen ließ sich die Farm starten.
- Ein Backup mit kleinerem Regal ersetzte erst Geräte und Sequenzen, dann kam die 409.
"""
import asyncio
import json
import types

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402

from app.routers import autofarm as af  # noqa: E402
from app.routers import system  # noqa: E402
from app.services import farm_queue, rack_store  # noqa: E402
from app.services import ottoeject_motion as motion  # noqa: E402


# ── Fach ─────────────────────────────────────────────────────────────────────

def test_reset_nach_stopp_hat_kein_altes_fach():
    job = farm_queue.normalize_job({"id": 5, "fileId": 3, "fileName": "t", "status": "printing", "slot": "2-3"})
    out = farm_queue.reset_failed(farm_queue.finalize_after_stop([job]))
    assert out[0]["status"] == "pending" and out[0]["slot"] == "1-0"


def test_fehler_gibt_nur_ein_reserviertes_fach_frei(monkeypatch):
    freigegeben = []
    regal = {"slots": {"2-3": {"status": "done"}, "2-4": {"status": "printing"}}}
    monkeypatch.setattr(af, "_rack_data", lambda: regal)
    monkeypatch.setattr(af, "_rack_update", lambda slot, status, *a, **kw: freigegeben.append((slot, status)))
    monkeypatch.setitem(af._farm, "log", [])
    af._release_reserved("2-3")        # liegt eine Platte drin: bleibt
    af._release_reserved("2-4")        # war für den Druck reserviert: frei
    af._release_reserved("1-0")
    assert freigegeben == [("2-4", "free")]


def test_ohne_hoehe_kein_fach():
    with pytest.raises(RuntimeError, match="Höhe"):
        asyncio.run(af._assign_slot_for_height({"id": 1}, 0.0))


def test_kaputter_wert_in_der_warteschlange_verhindert_den_start_nicht():
    job = farm_queue.normalize_job({"id": 1, "fileId": 3, "layerHeightMm": "0,2"})
    assert job["layerHeightMm"] == 0.0


# ── Eigener G-code vor dem Lauf ──────────────────────────────────────────────

def _geom(**over):
    return motion.merge_defaults({"racks": 1, "storage_slots": 6, "magazine_slot": 7,
                                  "machine_limits": {"x": 485, "y": 407, "z": 360}, **over})


def test_zyklus_mit_relativem_eigenem_gcode_ist_nicht_startklar(monkeypatch):
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: _geom())
    zyklus = [{"id": 1, "type": "send_file"}, {"id": 2, "type": "wait_print"},
              {"id": 3, "type": "klipper_gcode", "value": "G91\nG1 Z10\nG90", "label": "Z +10"}]
    codes = [p["code"] for p in af._validate_sequences({"seq_new": [], "seq_next": zyklus})]
    assert codes == ["relative_move_unchecked"]


def test_override_mit_g91_verhindert_den_start(monkeypatch):
    monkeypatch.setattr(af, "_load_farm_geometry",
                        lambda: _geom(use_gcode={"park": True}, gcode_override={"park": "G91\nG1 X5"}))
    with pytest.raises(HTTPException) as e:
        af._assert_overrides_absolute()
    assert e.value.status_code == 400


# ── Bettbreite beim Start ────────────────────────────────────────────────────

class _DB:
    def __init__(self, dev):
        self.dev = dev

    def query(self, *a):
        dev = self.dev

        class Q:
            def filter(self, *a, **kw):
                return self

            def first(self):
                return dev
        return Q()

    def close(self):
        pass


def test_unbekanntes_druckermodell_startet_nicht(monkeypatch):
    dev = types.SimpleNamespace(id=2, model="other", serial_number="")
    monkeypatch.setattr(af, "SessionLocal", lambda: _DB(dev))
    with pytest.raises(HTTPException) as e:
        af._assert_bed_width_known(2, {})
    assert e.value.status_code == 400 and "Druckermodell" in e.value.detail
    af._assert_bed_width_known(2, {"error_strategy": {"crash_risk": "ignore"}})   # bewusst ignoriert


def test_bekanntes_modell_startet(monkeypatch):
    monkeypatch.setattr(af, "SessionLocal", lambda: _DB(types.SimpleNamespace(id=2, model="x1c", serial_number="")))
    af._assert_bed_width_known(2, {})


# ── Wartung ──────────────────────────────────────────────────────────────────

def test_wartung_sperrt_handfahrt_und_start(monkeypatch):
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setitem(af._stress, "running", False)
    monkeypatch.setattr(af, "_stress_task", None)
    af.set_maintenance("Update läuft")
    assert "Update läuft" in af.motion_owner()
    with pytest.raises(HTTPException) as e:
        asyncio.run(af.start_farm(af.StartRequest(bambu_id=1)))
    assert e.value.status_code == 409


def test_wartung_laeuft_von_selbst_ab(monkeypatch):
    af.set_maintenance("Update läuft")
    monkeypatch.setitem(af._farm, "_maintenance_until", 0.0)
    assert af.maintenance_reason() is None


def test_wartung_endet_nach_dem_einspielen(tmp_path, monkeypatch):
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setitem(af._stress, "running", False)
    monkeypatch.setattr(af, "_stress_task", None)
    seq = tmp_path / "seq.json"
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(seq), "sequences")])
    asyncio.run(system.import_backup({"schema": system.BACKUP_SCHEMA,
                                      "sequences": {"seq_new": [], "seq_next": [{"type": "delay"}]}}))
    assert af.maintenance_reason() is None and seq.exists()


# ── Backup: Regal vor dem ersten Schreiben geprüft ───────────────────────────

def test_kleineres_regal_wird_vor_allem_anderen_abgelehnt(tmp_path, monkeypatch):
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setitem(af._stress, "running", False)
    monkeypatch.setattr(af, "_stress_task", None)
    monkeypatch.setattr(rack_store, "SLOTS_PATH", str(tmp_path / "slots.json"))
    seq = tmp_path / "seq.json"
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(seq), "sequences"),
                                                          (rack_store.SLOTS_PATH, "rack_slots")])
    rack_store.ensure_file()
    with rack_store.edit() as data:
        last = f"1-{data['slots_per_rack']}"
        data["slots"][last] = {**data["slots"][last], "status": "done", "file_name": "Teil"}
    kleiner = {**rack_store.default_data(), "slots_per_rack": 2}
    with pytest.raises(HTTPException) as e:
        asyncio.run(system.import_backup({"schema": system.BACKUP_SCHEMA, "rack_slots": kleiner,
                                          "sequences": {"seq_new": [], "seq_next": [{"type": "delay"}]}}))
    assert e.value.status_code == 409
    assert not seq.exists()                               # nichts halb eingespielt
    assert json.loads((tmp_path / "slots.json").read_text(encoding="utf-8"))["slots"][last]["status"] == "done"
