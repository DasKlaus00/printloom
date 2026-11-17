"""Ein Fehler hält den Ablauf an (seit v1.1.46).

- ∥-Gruppen: Arm-Schritte laufen in Listenreihenfolge, beim ersten Fehler bricht die
  Gruppe ab. Bis v1.1.45 kamen „Platte einlegen ∥ Tür schließen" in beliebiger
  Reihenfolge an den Arm, und die Tür schloss auch nach einem gescheiterten Einlegen.
- Eine hängende Bewegung ist nie „optional".
- Ungültige Werte und unbekannte Schritte beenden den Job, nicht die Farm.
- Vorziehen (⏱) nur für Schritte, die den Drucker nicht berühren.
- Der Start prüft die Sequenz.
"""
import asyncio
import json
import re
from pathlib import Path

import httpx
import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402

from app.routers import autofarm as af  # noqa: E402
from app.services import printer_guard, sequence_steps  # noqa: E402

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"


class Arm:
    device_type = None
    ip_address, port, name = "127.0.0.1", 7125, "OTTOeject"
    is_active = True


class FakeDB:
    def query(self, *a):
        class Q:
            def filter(self, *a, **kw):
                return self

            def first(self):
                return Arm()

            def all(self):
                return [Arm()]
        return Q()

    def close(self):
        pass


class Drucker:
    id, name = 2, "X1C"
    ip_address, serial_number, access_code = "10.0.0.5", "00M00A000000000", "12345678"


def _job():
    return af.JobIn(id=7, fileId=3, fileName="teil.3mf", slot="2-3").model_dump()


@pytest.fixture
def arm(monkeypatch, tmp_path):
    """Echte _exec_step/_do_macro bis zur HTTP-Grenze; Klipper-Anfragen mitgeschrieben."""
    lage = {"sent": [], "haengt": set()}

    class Client:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            script = json["script"]
            if any(h in script for h in lage["haengt"]):
                raise httpx.ReadTimeout("hängt")
            lage["sent"].append(script.replace("G90\n", ""))

            class R:
                status_code, text = 200, ""
            return R()

    class Mod:
        AsyncClient = Client
        ReadTimeout = httpx.ReadTimeout
        HTTPError = httpx.HTTPError
    monkeypatch.setattr(af, "httpx", Mod)
    monkeypatch.setattr(af, "SessionLocal", lambda: FakeDB())
    monkeypatch.setattr(af._motion, "build_op", lambda g, op, **kw: f"OP_{op.upper()}")
    monkeypatch.setattr(af._motion, "mirror_rack_params", lambda name, n: name)
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: {})
    monkeypatch.setattr(af, "_farm_printer", lambda g=None: None)
    monkeypatch.setattr(printer_guard, "live_state", lambda d, **kw: "FINISH")
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setattr(af, "_rack_update", lambda *a, **kw: None)
    monkeypatch.setattr(af, "_decrement_magazine", lambda *a, **kw: None)

    async def magazin():
        return ("1", "7")
    monkeypatch.setattr(af, "_magazine_gate", magazin)
    for key, val in {"running": True, "paused": False, "stopping": False, "bed": "empty",
                     "arm": dict(af._ARM_EMPTY), "log": [], "needs_home": False,
                     "_in_first_start": False, "geometry": {}, "jobs": [_job()]}.items():
        monkeypatch.setitem(af._farm, key, val)
    return lage


def _seq(steps):
    return asyncio.run(af._exec_sequence(steps, _job(), Drucker(), True, 20, 0, []))


PLACE = {"type": "app_op", "value": "place", "label": "Platte einlegen"}
CLOSE = {"type": "app_op", "value": "close_door", "label": "Tür schließen", "parallel": True}


def test_parallel_gruppe_bricht_nach_fehler_ab(arm):
    arm["haengt"].add("OP_PLACE")
    with pytest.raises(af._MoveTimeout):
        _seq([PLACE, CLOSE])
    assert "OP_CLOSE_DOOR" not in arm["sent"]
    assert af._farm["needs_home"] is True


def test_parallel_gruppe_haelt_die_reihenfolge_bei_referenzfahrt(arm):
    af._farm["needs_home"] = True
    _seq([PLACE, CLOSE])
    assert arm["sent"] == ["OTTOEJECT_HOME", "OP_PLACE", "OP_CLOSE_DOOR"]


def test_optionaler_schritt_mit_haengender_bewegung_bricht_ab(arm):
    arm["haengt"].add("OP_OPEN_DOOR")
    with pytest.raises(af._MoveTimeout):
        _seq([{"type": "app_op", "value": "open_door", "label": "Tür öffnen", "optional": True},
              {"type": "app_op", "value": "grab_magazine", "label": "Aus Magazin holen"}])
    assert not any("GRAB" in s for s in arm["sent"])
    assert af._farm["needs_home"] is True


def test_optionaler_schritt_mit_normalem_fehler_bleibt_optional(arm, monkeypatch):
    async def nein(*a, **kw):
        raise RuntimeError("Tür schon offen")
    echt = af._exec_step

    async def step(st, *a, **kw):
        if st.get("value") == "open_door":
            return await nein()
        return await echt(st, *a, **kw)
    monkeypatch.setattr(af, "_exec_step", step)
    _seq([{"type": "app_op", "value": "open_door", "label": "Tür öffnen", "optional": True},
          {"type": "app_op", "value": "grab_magazine", "label": "Aus Magazin holen"}])
    assert arm["sent"] == ["OP_GRAB_MAGAZINE"]


def test_drucker_schritt_laeuft_neben_dem_arm(arm, monkeypatch):
    """Datei senden ∥ Parken: das eine Drucker, das andere Arm — beide laufen."""
    gesendet = []

    async def send(job, device, use_ams):
        gesendet.append(job["id"])

    async def ams(*a, **kw):
        return None
    monkeypatch.setattr(af, "_do_send_file", send)
    monkeypatch.setattr(af, "_ensure_ams_ready", ams)
    _seq([{"type": "send_file", "value": "", "label": "Druckdatei senden"},
          {"type": "macro", "value": "PARK_OTTOEJECT", "label": "Parken", "parallel": True}])
    assert gesendet == [7] and arm["sent"] == ["PARK_OTTOEJECT"]


# ── Ungültige Werte, unbekannte Schritte ──────────────────────────────────────

def test_ungueltiger_wert_wird_zum_job_fehler(arm):
    with pytest.raises(RuntimeError, match="ungültiger Wert"):
        _seq([{"type": "delay", "seconds": "abc", "label": "Warten"}])


def test_unbekannter_schritt_wird_zum_job_fehler(arm):
    with pytest.raises(RuntimeError, match="Unbekannter Schritt"):
        _seq([{"type": "auswerfn", "label": "Tippfehler"}])


# ── Vorziehen (⏱) ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("step", [
    {"type": "app_op", "value": "eject"}, {"type": "app_op", "value": "place"},
    {"type": "app_op", "value": "store"}, {"type": "app_op", "value": "grab"},
    {"type": "bambu_move", "value": ""}, {"type": "gcode", "value": "G28"},
    {"type": "macro", "value": "EJECT_FROM_BAMBULAB_X_ONE_C"}, {"type": "wait_cool", "value": "30"},
])
def test_drucker_schritte_lassen_sich_nicht_vorziehen(step, monkeypatch):
    monkeypatch.setitem(af._farm, "log", [])
    monkeypatch.setitem(af._farm, "_prep_warned", set())
    normal, prep = af._split_prep([{**step, "prep": True, "label": "X"}])
    assert prep == [] and len(normal) == 1
    assert any("ignoriert" in z for z in af._farm["log"])


@pytest.mark.parametrize("step", [
    {"type": "delay", "seconds": 5}, {"type": "app_op", "value": "move_to_printer"},
    {"type": "macro", "value": "OTTOEJECT_HOME"}, {"type": "macro", "value": "PARK_OTTOEJECT"},
    {"type": "macro", "value": "MOVE_TO_PRINTER_X1C"},
])
def test_ungefaehrliche_schritte_lassen_sich_vorziehen(step):
    normal, prep = af._split_prep([{**step, "prep": True}])
    assert normal == [] and len(prep) == 1


def test_editor_und_ablauf_haben_dieselbe_vorzieh_regel():
    js = (FRONTEND / "services" / "sequenceRules.js").read_text(encoding="utf-8")

    def liste(name):
        m = re.search(rf"export const {name}\s*=\s*\[([^\]]*)\]", js)
        assert m, name
        return tuple(re.findall(r"'([^']+)'", m.group(1)))
    assert liste("PREP_APP_OPS") == sequence_steps.PREP_APP_OPS
    assert liste("PREP_MACROS") == sequence_steps.PREP_MACROS
    assert liste("PREP_MACRO_PREFIXES") == sequence_steps.PREP_MACRO_PREFIXES


def test_standard_zyklus_bleibt_gueltig():
    """Die Vorgabe-Sequenz zieht nur Homen und Vor-den-Drucker-Fahren vor."""
    js = (FRONTEND / "services" / "sequenceData.js").read_text(encoding="utf-8")
    vorgezogen = re.findall(r"s\(\d+,\s*'(\w+)',\s*'[^']*',\s*'([^']*)'[^)]*prep: true", js)
    assert vorgezogen
    for typ, wert in vorgezogen:
        assert sequence_steps.prep_allowed({"type": typ, "value": wert}), (typ, wert)


# ── Vorstart endet mit dem Druck ──────────────────────────────────────────────

def test_hängender_vorstart_wird_weitergeworfen(arm):
    arm["haengt"].add("OTTOEJECT_HOME")
    with pytest.raises(af._MoveTimeout):
        asyncio.run(af._run_prep([{"type": "macro", "value": "OTTOEJECT_HOME"},
                                  {"type": "app_op", "value": "move_to_printer"}], "2-3", Drucker()))
    assert arm["sent"] == []       # nach dem Hänger keine weitere Vorstart-Fahrt


# ── Startprüfung ──────────────────────────────────────────────────────────────

def _defaults():
    js = (FRONTEND / "services" / "sequenceData.js").read_text(encoding="utf-8")
    nxt = re.findall(r"s\((\d+),\s*'(\w+)',\s*'([^']*)',\s*'([^']*)'", js.split("DEFAULT_SEQ_NEXT")[1])
    return [{"id": int(i), "type": t, "label": lbl, "value": v} for i, t, lbl, v in nxt]


def test_leerer_zyklus_ist_nicht_startklar():
    probleme = af._validate_sequences({"seq_new": [], "seq_next": []})
    codes = {p["code"] for p in probleme}
    assert {"seq_wait_print", "seq_no_send"} <= codes


def test_zyklus_ohne_senden_ist_nicht_startklar():
    zyklus = [s for s in _defaults() if s["type"] != "send_file"]
    assert {p["code"] for p in af._validate_sequences({"seq_next": zyklus})} == {"seq_no_send"}


def test_standard_zyklus_ist_startklar():
    assert af._validate_sequences({"seq_new": [], "seq_next": _defaults()}) == []


def test_kaputte_werte_werden_vor_dem_start_gemeldet():
    zyklus = _defaults() + [{"type": "delay", "seconds": "abc", "label": "Warten"},
                            {"type": "app_op", "value": "ejekt", "label": "Auswerfen"},
                            {"type": "teleport", "label": "?"}]
    codes = [p["code"] for p in af._validate_sequences({"seq_next": zyklus})]
    assert codes == ["seq_not_a_number", "seq_unknown_op", "seq_unknown_type"]


def test_start_verweigert_zyklus_ohne_druck(monkeypatch, tmp_path):
    seq = tmp_path / "sequences.json"
    seq.write_text(json.dumps({"schema_version": af.SEQ_SCHEMA_VERSION, "seq_new": [], "seq_next": []}),
                   encoding="utf-8")
    monkeypatch.setattr(af, "SEQ_PATH", str(seq))
    monkeypatch.setattr(af, "SessionLocal", lambda: FakeDB())
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setitem(af._stress, "running", False)
    monkeypatch.setattr(af, "_stress_task", None)
    with pytest.raises(HTTPException) as e:
        asyncio.run(af.start_farm(af.StartRequest(bambu_id=2, jobs=[])))
    assert e.value.status_code == 400 and "Druckdatei" in e.value.detail
