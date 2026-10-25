"""Notaus — hält er wirklich an?

Bis v1.1.33 setzte der Notaus nur `is_active = False` in der Datenbank. Das
beachtete allein der manuelle Makro-Endpunkt: Farm, Stresstest, Joggen und
Einlernen fuhren weiter. Und weil der Notaus die Position als unbekannt
markierte, fuhr die nächste Farm-Bewegung sogar erst eine Referenzfahrt und
machte dann einfach weiter. Dazu ein NameError in der eigenen Fehlerbehandlung.

Die Zusagen hier:
  • ZUERST der Arm (Klipper M112), dann alles andere.
  • Jeder Ablauf in Printloom, der den Arm bewegen kann, wird angehalten.
  • Drucker werden PAUSIERT, nicht abgebrochen (eine Pause ist umkehrbar).
  • Konnte der Arm nicht angehalten werden, sagt die Antwort das — nie ein 500,
    nie ein stilles „aktiviert".
  • „Fortsetzen" startet Klipper neu; ohne das bliebe der Arm nach M112 stumm.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.models.models import PrinterType  # noqa: E402
from app.routers import autofarm as af  # noqa: E402
from app.routers import control  # noqa: E402


# ── Abläufe anhalten ─────────────────────────────────────────────────────────

@pytest.fixture
def ablaeufe(monkeypatch, tmp_path):
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setitem(af._farm, "log", [])
    monkeypatch.setitem(af._farm, "running", True)
    monkeypatch.setitem(af._farm, "stopping", False)
    monkeypatch.setitem(af._farm, "paused", True)
    monkeypatch.setitem(af._stress, "running", True)
    monkeypatch.setattr(af, "_stress_task", None)


def test_alle_ablaeufe_werden_angehalten(ablaeufe):
    angehalten = af.halt_all("Notaus")
    assert set(angehalten) == {"farm", "stress_test"}
    assert af._farm["stopping"] is True
    assert af._stress["running"] is False


def test_eine_pausierte_farm_haengt_nicht_in_der_pause_fest(ablaeufe):
    """Sonst wartete die Schleife ewig in der Pause und käme nie zum Stopp."""
    af.halt_all("Notaus")
    assert af._farm["paused"] is False


def test_ohne_laufenden_ablauf_passiert_nichts(monkeypatch, tmp_path):
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setitem(af._farm, "log", [])
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setitem(af._farm, "stopping", False)
    monkeypatch.setitem(af._stress, "running", False)
    monkeypatch.setattr(af, "_stress_task", None)
    assert af.halt_all("Notaus") == []
    assert af._farm["stopping"] is False


# ── Der Endpunkt ─────────────────────────────────────────────────────────────

class Geraet:
    def __init__(self, gid, name, typ):
        self.id, self.name, self.device_type = gid, name, typ
        self.ip_address, self.port, self.is_active = "127.0.0.1", 7125, True


class FakeDB:
    def __init__(self, geraete):
        self.geraete = geraete
        self.committed = False

    def query(self, *a):
        db = self

        class Q:
            def __init__(self, liste):
                self.liste = liste

            def filter(self, bedingung):
                typ = bedingung.right.value
                return Q([g for g in self.liste if g.device_type == typ])

            def all(self):
                return list(self.liste)

        return Q(db.geraete)

    def add(self, _):
        pass

    def commit(self):
        self.committed = True


@pytest.fixture
def anlage(monkeypatch, tmp_path):
    """Ein OTTOeject, ein Drucker; jeder Aufruf wird in Reihenfolge mitgeschrieben."""
    reihenfolge = []
    zustand = {"m112_ok": True, "neustart_ok": True, "pause_ok": True}

    class FakeMoonraker:
        def __init__(self, d):
            self.d = d

        async def emergency_stop(self):
            reihenfolge.append("M112")
            return zustand["m112_ok"]

        async def firmware_restart(self):
            reihenfolge.append("FIRMWARE_RESTART")
            return zustand["neustart_ok"]

    def print_command(d, cmd):
        reihenfolge.append(f"drucker:{cmd}")
        return zustand["pause_ok"]

    def halt_all(reason):
        reihenfolge.append("abläufe")
        return ["farm"]

    import app.services.moonraker as mr
    import app.services.bambu_manager as bm
    monkeypatch.setattr(mr, "MoonrakerAPI", FakeMoonraker)
    monkeypatch.setattr(bm, "print_command", print_command)
    monkeypatch.setattr(af, "halt_all", halt_all)
    monkeypatch.setattr(af, "mark_position_unknown", lambda r="": None)

    db = FakeDB([Geraet(1, "OTTOeject", PrinterType.KLIPPER),
                 Geraet(2, "X1C", PrinterType.BAMBU_LAB)])
    return db, reihenfolge, zustand


def test_zuerst_der_arm(anlage):
    """In den ersten Millisekunden zählt nur der Arm — alles andere ist Nachsorge."""
    db, reihenfolge, _ = anlage
    asyncio.run(control.emergency_stop(db))
    assert reihenfolge[0] == "M112"
    assert reihenfolge.index("M112") < reihenfolge.index("abläufe")


def test_drucker_werden_pausiert_nicht_abgebrochen(anlage):
    """Eine Pause lässt sich fortsetzen, ein abgebrochener Druck nicht."""
    db, reihenfolge, _ = anlage
    asyncio.run(control.emergency_stop(db))
    assert "drucker:pause" in reihenfolge
    assert "drucker:stop" not in reihenfolge


def test_erfolg_wird_gemeldet(anlage):
    db, _, _ = anlage
    r = asyncio.run(control.emergency_stop(db))
    assert r["arm_stopped"] is True
    assert r["success"] is True
    assert r["halted"] == ["farm"]


def test_ein_nicht_angehaltener_arm_wird_nicht_verschwiegen(anlage):
    """Das Wichtigste an der ganzen Datei: Bestätigt Klipper den Notaus nicht,
    darf die Antwort nicht „aktiviert" sagen."""
    db, _, zustand = anlage
    zustand["m112_ok"] = False
    r = asyncio.run(control.emergency_stop(db))
    assert r["arm_stopped"] is False
    assert r["success"] is False
    assert "NICHT" in r["message"]


def test_der_rest_laeuft_auch_wenn_der_arm_nicht_antwortet(anlage):
    """Ein toter Klipper darf nicht verhindern, dass Farm und Drucker anhalten."""
    db, reihenfolge, zustand = anlage
    zustand["m112_ok"] = False
    asyncio.run(control.emergency_stop(db))
    assert "abläufe" in reihenfolge
    assert "drucker:pause" in reihenfolge
    assert db.committed


def test_ein_drucker_der_nicht_antwortet_haelt_nichts_auf(anlage):
    db, _, zustand = anlage
    zustand["pause_ok"] = False
    r = asyncio.run(control.emergency_stop(db))
    assert r["arm_stopped"] is True
    assert r["printers"] == [{"name": "X1C", "ok": False}]


def test_die_eigene_fehlerbehandlung_stuerzt_nicht_ab(anlage, monkeypatch):
    """Bis v1.1.33 fehlte `logger` in control.py: schlug das Markieren der Position
    fehl, kam statt einer Warnung ein NameError — und der Notaus antwortete mit 500."""
    db, _, _ = anlage

    def kaputt(r=""):
        raise RuntimeError("Zustandsdatei gesperrt")

    monkeypatch.setattr(af, "mark_position_unknown", kaputt)
    r = asyncio.run(control.emergency_stop(db))
    assert r["arm_stopped"] is True


def test_ohne_ottoeject_wird_ehrlich_geantwortet(anlage):
    db, _, _ = anlage
    db.geraete = [g for g in db.geraete if g.device_type != PrinterType.KLIPPER]
    r = asyncio.run(control.emergency_stop(db))
    assert r["arms"] == []
    assert "Kein OTTOeject" in r["message"]


def test_geraete_werden_gesperrt(anlage):
    db, _, _ = anlage
    asyncio.run(control.emergency_stop(db))
    assert all(g.is_active is False for g in db.geraete)


# ── Fortsetzen ───────────────────────────────────────────────────────────────

def test_fortsetzen_startet_klipper_neu(anlage):
    """Nach M112 nimmt Klipper keinen Befehl an, bis die Firmware neu startet."""
    db, reihenfolge, _ = anlage
    r = asyncio.run(control.resume_operations(db))
    assert "FIRMWARE_RESTART" in reihenfolge
    assert r["success"] is True
    assert all(g.is_active for g in db.geraete)


def test_fehlgeschlagener_neustart_wird_gemeldet(anlage):
    db, _, zustand = anlage
    zustand["neustart_ok"] = False
    r = asyncio.run(control.resume_operations(db))
    assert r["success"] is False
    assert r["failed"] == ["OTTOeject"]


def test_der_zustand_uebersteht_das_neuladen_der_seite(anlage):
    db, _, _ = anlage
    assert asyncio.run(control.emergency_state(db)) == {"active": False}
    db.geraete[0].is_active = False
    assert asyncio.run(control.emergency_state(db)) == {"active": True}
