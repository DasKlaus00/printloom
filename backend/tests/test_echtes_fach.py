"""Jede Platte bekommt ein echtes Fach (seit v1.1.49).

- Die Höhe kommt aus der Datei, immer mit demselben Zuschlag; nie 1 mm geraten.
- Abgelegt wird nur in Fächer, die es gibt (nie „1-0", nie ins Magazin).
- Ohne Regal-Daten wird nicht an eine geratene Stelle gegriffen.
- Job-IDs beim Einreihen sind eindeutig, auch bei gleichzeitigen Aufrufen.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402

from app.routers import autofarm as af  # noqa: E402
from app.services import ottoeject_motion as motion  # noqa: E402
from app.services import print_file, printer_guard, rack_store  # noqa: E402


def test_zuschlag_eine_formel():
    assert print_file.with_margin(65, 20) == 78.0
    assert print_file.with_margin(40, 15) == 46.0


# ── build_op: nur echte Fächer ────────────────────────────────────────────────

G = motion.merge_defaults(None)


@pytest.mark.parametrize("op,rack,slot", [
    ("store", 1, 0), ("store", 1, motion.magazine_slot(G)), ("store", 0, 1),
    ("store", int(G["racks"]) + 1, 1), ("approach", 1, 0), ("grab", 1, 99),
])
def test_ablage_nur_in_faecher_die_es_gibt(op, rack, slot):
    with pytest.raises(ValueError):
        motion.build_op(G, op, rack=rack, slot=slot, check=False)


def test_gueltige_faecher_gehen():
    assert motion.build_op(G, "store", rack=1, slot=1, check=False)
    assert motion.build_op(G, "grab_magazine", rack=1, slot=1, check=False)


# ── Einlagern ohne Fach ───────────────────────────────────────────────────────

class Drucker:
    id, name = 2, "X1C"
    ip_address, serial_number, access_code = "10.0.0.5", "00M00A000000000", "12345678"


@pytest.fixture
def farm(monkeypatch, tmp_path):
    gesendet = []

    async def do_macro(script, *a, **kw):
        gesendet.append(script)
    regal = rack_store.default_data()
    monkeypatch.setattr(af, "_do_macro", do_macro)
    monkeypatch.setattr(af, "_rack_data", lambda: regal)
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: motion.merge_defaults(None))
    monkeypatch.setattr(af, "_farm_printer", lambda g=None: None)
    monkeypatch.setattr(printer_guard, "live_state", lambda d, **kw: "FINISH")
    for key, val in {"running": True, "paused": False, "stopping": False, "bed": "empty",
                     "arm": {"holding": "printed", "from": "", "job_id": 7}, "log": [],
                     "_in_first_start": False, "geometry": motion.merge_defaults(None)}.items():
        monkeypatch.setitem(af._farm, key, val)
    return gesendet


def _job(slot):
    return af.JobIn(id=7, fileId=3, fileName="teil.3mf", slot=slot).model_dump()


@pytest.mark.parametrize("step", [
    {"type": "app_op", "value": "store", "label": "Platte zurücklegen"},
    {"type": "macro", "value": "STORE_TO_RACK RACK={rack} SLOT={slot}", "label": "Einlagern"},
])
@pytest.mark.parametrize("slot", ["1-0", "9-9"])
def test_einlagern_nie_in_ein_fach_das_es_nicht_gibt(step, slot, farm):
    with pytest.raises(RuntimeError, match="Platte bleibt im Greifer"):
        asyncio.run(af._exec_step(step, _job(slot), Drucker(), True, 20, 0, []))
    assert farm == []
    assert af._farm["arm"]["holding"] == "printed"


def test_einlagern_in_ein_echtes_fach(farm, monkeypatch):
    monkeypatch.setattr(af, "_rack_update", lambda *a, **kw: None)
    asyncio.run(af._exec_step({"type": "app_op", "value": "store"}, _job("1-2"), Drucker(), True, 20, 0, []))
    assert len(farm) == 1
    assert af._farm["arm"]["holding"] == "none"


# ── Keine geratenen Werte ohne Regal-Daten ────────────────────────────────────

def test_ohne_regal_daten_keine_geratene_plattenquelle(monkeypatch):
    monkeypatch.setattr(af, "_rack_data", lambda: {})
    monkeypatch.setitem(af._farm, "log", [])
    with pytest.raises(RuntimeError, match="Regal"):
        af._stack_vars()
    assert af._magazine_count() == 0


def test_fachsuche_fehler_ist_nicht_regal_voll(monkeypatch):
    kaputt = rack_store.default_data()
    kaputt["slot_height_mm"] = "fünfzig"
    monkeypatch.setattr(af, "_rack_data", lambda: kaputt)
    with pytest.raises(af._SlotLookupError, match="Fachsuche fehlgeschlagen"):
        af._find_slot_for_height(40)


# ── Eindeutige Job-IDs ────────────────────────────────────────────────────────

@pytest.fixture
def laufende_farm(monkeypatch):
    monkeypatch.setitem(af._farm, "running", True)
    monkeypatch.setitem(af._farm, "jobs", [])
    monkeypatch.setitem(af._farm, "log", [])

    async def langsam(job):
        await asyncio.sleep(0.05)     # Höhen-Analyse dauert, der andere Aufruf läuft dazwischen
        return 40.0, 0.2
    monkeypatch.setattr(af, "_job_height", langsam)


def _req(**kw):
    return af.EnqueueRequest(fileId=3, fileName="teil.3mf", slot="1-0", **kw)


def test_paralleles_einreihen_erzeugt_keine_doppelten_ids(laufende_farm):
    """Zwei Seiten schicken dieselbe (selbst gezählte) ID: Seit v1.1.58 vergibt nur
    der Server IDs, beide Jobs kommen an, jeder mit eigener."""
    async def beide():
        return await asyncio.gather(af.enqueue_job(_req(id=5)), af.enqueue_job(_req(id=5)))
    a, b = asyncio.run(beide())
    assert a["id"] != b["id"]
    assert sorted(j["id"] for j in af._farm["jobs"]) == sorted([a["id"], b["id"]])


def test_ohne_id_vergibt_der_server_eindeutige(laufende_farm):
    async def drei():
        return await asyncio.gather(*(af.enqueue_job(_req()) for _ in range(3)))
    ids = [r["id"] for r in asyncio.run(drei())]
    assert len(set(ids)) == 3
    assert all(j["object_height_mm"] == 40.0 for j in af._farm["jobs"])


def test_hoehe_ohne_datei_ist_null(monkeypatch):
    class Q:
        def filter(self, *a, **kw):
            return self

        def first(self):
            return None

    class DB:
        def query(self, *a):
            return Q()

        def close(self):
            pass
    monkeypatch.setattr(af, "SessionLocal", lambda: DB())
    assert asyncio.run(af._job_height({"fileId": 999})) == (0.0, 0.0)
