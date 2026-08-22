"""Stresstest mit Drucker-Umweg: die REIHENFOLGE, die wirklich gefahren wird.

Der Plan (test_stress_test.py) rechnet nur. Hier laeuft der Runner — mit
abgefangenen Bewegungen statt echter Mechanik. Was hier festgenagelt ist:

  • Erst das Bett auf Z200, DANN die Tuer, DANN erst der Arm in den Drucker.
  • Pro Platte: greifen → auflegen → herunternehmen → einlagern.
  • Homing und Tuer genau EINMAL, nicht pro Platte.
  • Die Tuer geht am Ende zu — auch wenn der Lauf mit einem Fehler endet.
  • Ohne Haken passiert nichts davon.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers import autofarm  # noqa: E402


MOVES = [
    {"from": "1-7", "to": "2-3", "from_rack": 1, "from_slot": 7,
     "to_rack": 2, "to_slot": 3, "from_magazine": True},
    {"from": "1-7", "to": "3-1", "from_rack": 1, "from_slot": 7,
     "to_rack": 3, "to_slot": 1, "from_magazine": True},
]


@pytest.fixture
def spur(tmp_path, monkeypatch):
    """Alles Bewegende abfangen und mitschreiben."""
    log = []

    async def do_macro(script, *a, **kw):
        log.append(("macro", script))

    async def start_homing(device):
        log.append(("homing", getattr(device, "name", "?")))

    async def wait_finish(device, label="", timeout=0):
        log.append(("wait", label))

    def build_op(g, op, **kw):
        return op        # der G-code selbst ist anderswo geprueft

    monkeypatch.setattr(autofarm, "_do_macro", do_macro)
    monkeypatch.setattr(autofarm, "_start_homing_print", start_homing)
    monkeypatch.setattr(autofarm, "_wait_bambu_finish", wait_finish)
    monkeypatch.setattr(autofarm._motion, "build_op", build_op)
    monkeypatch.setattr(autofarm, "_magazine_take", lambda r: None)
    monkeypatch.setattr(autofarm, "_rack_update", lambda *a, **kw: None)
    monkeypatch.setattr(autofarm, "_set_arm", lambda *a, **kw: None)
    monkeypatch.setattr(autofarm, "_magazine_slot_cfg", lambda: 7)
    monkeypatch.setattr(autofarm, "_persist_state", lambda: None)
    monkeypatch.setattr(autofarm, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setitem(autofarm._farm, "log", [])
    return log


def ops(log):
    return [v for kind, v in log if kind == "macro"]


class FakeDevice:
    name = "X1C"


def lauf(mit_drucker=True, tuer=True, monkeypatch=None):
    monkeypatch.setattr(autofarm._stress_service, "has_door", lambda g, p=None: tuer)
    monkeypatch.setattr(autofarm, "_stress_geometry", lambda: {})
    monkeypatch.setattr(autofarm, "_farm_printer", lambda g=None: None)
    asyncio.run(autofarm._run_stress_test(MOVES, mit_drucker, FakeDevice()))


def test_ohne_haken_faehrt_nur_der_regal_lauf(spur, monkeypatch):
    """Wer den Haken nicht setzt, bekommt kein Bett auf Z200 und keine Tuer."""
    lauf(mit_drucker=False, monkeypatch=monkeypatch)
    assert ops(spur) == ["grab_magazine", "store", "grab_magazine", "store"]
    assert not [k for k, _ in spur if k == "homing"]


def test_mit_haken_geht_jede_platte_ueber_den_drucker(spur, monkeypatch):
    lauf(monkeypatch=monkeypatch)
    assert ops(spur) == [
        "open_door",
        "grab_magazine", "place", "eject", "store",
        "grab_magazine", "place", "eject", "store",
        "close_door",
    ]


def test_das_bett_faehrt_vor_der_tuer_auf_z200(spur, monkeypatch):
    """Solange das Bett faehrt, hat der Arm im Gehaeuse nichts zu suchen."""
    lauf(monkeypatch=monkeypatch)
    arten = [k for k, _ in spur]
    assert arten.index("homing") < arten.index("wait") < arten.index("macro")


def test_homing_und_tuer_genau_einmal(spur, monkeypatch):
    """Pro Platte homen und Tuer klappern waere nur Verschleiss."""
    lauf(monkeypatch=monkeypatch)
    assert [k for k, _ in spur].count("homing") == 1
    assert ops(spur).count("open_door") == 1
    assert ops(spur).count("close_door") == 1


def test_ohne_tuer_wird_keine_gefahren(spur, monkeypatch):
    """Ein offener Drucker hat nichts zu oeffnen."""
    lauf(tuer=False, monkeypatch=monkeypatch)
    assert "open_door" not in ops(spur)
    assert "close_door" not in ops(spur)


def test_die_tuer_geht_auch_nach_einem_fehler_zu(spur, monkeypatch):
    """Eine offene Tuer ist ein offener Drucker — der Abbruch darf sie nicht so
    stehen lassen."""
    echt = autofarm._do_macro

    async def kaputt(script, *a, **kw):
        await echt(script)
        if script == "eject":
            raise RuntimeError("Bewegung fehlgeschlagen")

    monkeypatch.setattr(autofarm, "_do_macro", kaputt)
    lauf(monkeypatch=monkeypatch)
    assert ops(spur)[-1] == "close_door"
    assert autofarm._stress["error"]


def test_eine_nie_geoeffnete_tuer_wird_nicht_zugefahren(spur, monkeypatch):
    """Scheitert das Homing, war die Tuer nie offen. „Tuer zu" zu fahren hiesse,
    mit dem Arm gegen eine geschlossene Tuer zu druecken."""
    async def kaputt(device):
        raise RuntimeError("Drucker nicht erreichbar")

    monkeypatch.setattr(autofarm, "_start_homing_print", kaputt)
    lauf(monkeypatch=monkeypatch)
    assert ops(spur) == []
    assert autofarm._stress["error"]


# ── Welches Geraet gehoert zu den Koordinaten? ───────────────────────────────

class FakeQuery:
    def __init__(self, geraete):
        self._g = geraete

    def filter(self, *a, **kw):
        return self

    def all(self):
        return self._g

    def first(self):
        return self._g[0] if self._g else None


def db_mit(geraete, monkeypatch):
    class FakeDB:
        def query(self, *a, **kw):
            return FakeQuery(geraete)

        def close(self):
            pass

    monkeypatch.setattr(autofarm, "SessionLocal", lambda: FakeDB())


def test_das_geraet_kommt_aus_dem_drucker_block(monkeypatch):
    """Gefahren werden die Koordinaten des Geometrie-Blocks — dann muss auch das
    Geraet aus DIESEM Block kommen. Zwei Wege koennten auf zwei Maschinen zeigen:
    „erstes Geraet in der Datenbank" ist nicht zwingend „der eingemessene Drucker"."""
    gefragt = []

    class Q:
        def filter(self, *bedingungen, **kw):
            # Die zweite Filterung traegt den Geraete-Vergleich — dessen rechte
            # Seite ist die gesuchte ID.
            for b in bedingungen:
                try:
                    gefragt.append(b.right.value)
                except AttributeError:
                    pass
            return self

        def all(self):
            return [FakeDevice()]

        def first(self):
            return FakeDevice()

    class FakeDB:
        def query(self, *a, **kw):
            return Q()

        def close(self):
            pass

    monkeypatch.setattr(autofarm, "SessionLocal", lambda: FakeDB())
    monkeypatch.setattr(autofarm, "_stress_geometry", lambda: {})
    monkeypatch.setattr(autofarm, "_farm_printer", lambda g=None: {"device_id": 42})
    autofarm._stress_bambu()
    assert 42 in gefragt, f"nach der ID aus dem Block wurde nicht gefragt: {gefragt}"


def test_ohne_drucker_startet_der_umweg_gar_nicht(monkeypatch):
    """Lieber vorher sagen als mitten im Lauf stehenbleiben."""
    import fastapi
    db_mit([], monkeypatch)
    monkeypatch.setattr(autofarm, "_stress_geometry", lambda: {})
    monkeypatch.setattr(autofarm, "_farm_printer", lambda g=None: {})
    with pytest.raises(fastapi.HTTPException):
        autofarm._stress_bambu()
