"""Vor der Bewegung prüfen (seit v1.1.60, Umbauplan Schritt 14).

- Der Crash-Check urteilt mit der Bettbreite DES Druckers (bis v1.1.59 immer 256 mm).
- Die Farm druckt eine Datei mit Crash-Risiko nicht unbeaufsichtigt (Strategie „crash_risk").
- Relative Bewegungen (G91/G92) in eigenem G-code werden abgelehnt.
- `klipper_gcode`-Schritte laufen durch dieselbe Achsprüfung wie Printloom-Ops.
"""
import asyncio
import types
import zipfile

import pytest

pytest.importorskip("fastapi")

from app.db import database  # noqa: E402
from app.routers import autofarm as af  # noqa: E402
from app.services import crash_check  # noqa: E402
from app.services import geometry_check as gc  # noqa: E402
from app.services import ottoeject_motion as motion  # noqa: E402

LIMITS = {"x": 485, "y": 407, "z": 360}
# Z klettert über 30 mm und fährt dann in den linken Randstreifen (X5) → Crash-Risiko
GEFAEHRLICH = "G90\nG1 Z0.2\nG1 X100 Y100\nG1 Z40\nG1 X5 Y100\n"
HARMLOS = "G90\nG1 Z0.2\nG1 X100 Y100\nG1 Z40\nG1 X128 Y100\n"


def _drucker(model="", serial=""):
    # Form eines echten Device-Eintrags (nur die gelesenen Felder)
    return types.SimpleNamespace(id=2, name="X", model=model, serial_number=serial)


# ── Bettbreite je Drucker ────────────────────────────────────────────────────

def test_a1_mini_hat_180_mm():
    assert crash_check.x_max_for(_drucker("a1mini")) == 180.0


def test_modell_aus_der_seriennummer():
    assert crash_check.x_max_for(_drucker("", "00M09A000000000")) == 256.0     # X1C


def test_unbekanntes_modell_ist_unbekannt():
    assert crash_check.x_max_for(_drucker("other")) is None
    assert crash_check.x_max_for(None) is None


def test_randzone_rechts_haengt_an_der_bettbreite(tmp_path):
    # X 175 liegt bei 256 mm Bett in der Mitte, bei 180 mm (A1 mini) im rechten Streifen
    g = tmp_path / "teil.gcode"
    g.write_text("G90\nG1 Z40\nG1 X175 Y90\n", encoding="utf-8")
    assert crash_check.scan_file(str(g), ".gcode", None, 256.0)["crash_risk"] is False
    assert crash_check.scan_file(str(g), ".gcode", None, 180.0)["crash_risk"] is True


# ── Farm: kein unbeaufsichtigter Druck mit Crash-Risiko ─────────────────────

@pytest.fixture
def datei(tmp_path, monkeypatch):
    lage = {"gcode": GEFAEHRLICH, "notified": []}

    def baue():
        p = tmp_path / "teil.gcode.3mf"
        with zipfile.ZipFile(p, "w") as z:
            z.writestr("Metadata/plate_1.gcode", lage["gcode"])
        return p

    class Zeile:
        id, file_type, original_filename = 3, ".3mf", "teil.gcode.3mf"

        @property
        def file_path(self):
            return str(baue())

    class DB:
        def query(self, *a):
            class Q:
                def filter(self, *a, **kw):
                    return self

                def first(self):
                    return Zeile()
            return Q()

        def close(self):
            pass

    async def notify(text):
        lage["notified"].append(text)
    monkeypatch.setattr(database, "SessionLocal", DB)
    monkeypatch.setattr(af, "_notify", notify)
    monkeypatch.setitem(af._farm, "log", [])
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setitem(af._farm, "paused", False)
    from app.routers import files
    monkeypatch.setattr(files, "_CRASH_CACHE", {})
    monkeypatch.setattr(files, "_save_crash_cache", lambda: None)
    return lage


def _tor(strategie, monkeypatch):
    monkeypatch.setitem(af._farm, "error_strategy", {"crash_risk": strategie})
    job = {"id": 7, "fileId": 3, "fileName": "teil.gcode.3mf", "plate": 1}
    return asyncio.run(af._crash_gate(job, _drucker("x1c")))


def test_crash_risiko_wird_nicht_unbeaufsichtigt_gedruckt(datei, monkeypatch):
    with pytest.raises(RuntimeError, match="Nicht gedruckt: Kollisionsgefahr"):
        _tor("skip", monkeypatch)
    assert datei["notified"] and "nicht gedruckt" in datei["notified"][0]


def test_vorgabe_ist_nicht_drucken(datei, monkeypatch):
    monkeypatch.setitem(af._farm, "error_strategy", {})
    with pytest.raises(RuntimeError, match="Nicht gedruckt"):
        asyncio.run(af._crash_gate({"id": 7, "fileId": 3, "fileName": "t", "plate": 1}, _drucker("x1c")))


def test_mit_ignorieren_laeuft_der_zyklus(datei, monkeypatch):
    assert _tor("ignore", monkeypatch) is None
    assert any("trotzdem gedruckt" in z for z in af._farm["log"])


def test_harmlose_datei_geht_durch(datei, monkeypatch):
    datei["gcode"] = HARMLOS
    assert _tor("skip", monkeypatch) is None


def test_unbekannter_drucker_heisst_nicht_geprueft(datei, monkeypatch):
    monkeypatch.setitem(af._farm, "error_strategy", {"crash_risk": "skip"})
    datei["gcode"] = HARMLOS
    with pytest.raises(RuntimeError, match="nicht möglich"):
        asyncio.run(af._crash_gate({"id": 7, "fileId": 3, "fileName": "t", "plate": 1}, _drucker("other")))


# ── Relative Bewegungen ──────────────────────────────────────────────────────

def _geom(**over):
    return motion.merge_defaults({"racks": 1, "storage_slots": 6, "magazine_slot": 7,
                                  "machine_limits": LIMITS, **over})


@pytest.mark.parametrize("script", ["G91\nG1 Z10\nG90", "G92 X0", "SET_KINEMATIC_POSITION X=10"])
def test_relative_bewegung_wird_abgelehnt(script):
    codes = [p["code"] for p in gc.check_script(script, _geom(), "klipper_gcode")]
    assert "relative_move_unchecked" in codes


def test_g91_ohne_bewegung_und_kommentare_sind_kein_fehler():
    assert gc.check_script("G91\nG90\nG1 X10 ; G91 im Kommentar", _geom(), "klipper_gcode") == []


def test_relative_werte_gelten_nicht_als_ziel():
    # „G91 / G1 Z-5" ist kein Ziel unter null, sondern 5 mm abwärts
    assert ("z", -5.0) not in gc.script_coords("G91\nG1 Z-5\nG90")


def test_keine_eingebaute_op_faehrt_relativ():
    g = _geom()
    for op in gc._CHECK_OPS:
        script = motion.build_op(g, op, rack=1, slot=1, check=False)
        assert not gc.script_relative(script), op


# ── klipper_gcode-Schritte ───────────────────────────────────────────────────

def test_klipper_gcode_schritt_ausserhalb_der_achse_wird_verweigert(monkeypatch):
    gesendet = []

    async def do_macro(script, *a, **kw):
        gesendet.append(script)
    monkeypatch.setattr(af, "_do_macro", do_macro)
    monkeypatch.setitem(af._farm, "geometry", _geom())
    monkeypatch.setitem(af._farm, "log", [])
    step = {"type": "klipper_gcode", "value": "G1 X600 F3000", "label": "Weit raus"}
    job = {"id": 1, "fileId": 3, "fileName": "t", "slot": "1-1"}
    with pytest.raises(gc.GeometryError):
        asyncio.run(af._exec_step(step, job, None, False, 1, 0, [], []))
    assert gesendet == []


def test_trockenlauf_meldet_klipper_gcode_fehler(monkeypatch):
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: _geom())
    steps = [{"id": 1, "type": "klipper_gcode", "value": "G91\nG1 X5", "label": "Relativ"}]
    monkeypatch.setattr(af, "_read_checked", lambda path, default, expect=dict: {
        **default, "seq_new": [], "seq_next": steps, "schema_version": af.SEQ_SCHEMA_VERSION})
    r = asyncio.run(af.dry_run({"which": "seq_next"}))
    entry = next(s for s in r["steps"] if s["type"] == "klipper_gcode")
    assert [p["code"] for p in entry["problems"]] == ["relative_move_unchecked"]
