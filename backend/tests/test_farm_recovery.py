"""Dauerbetrieb: Zustand überlebt den Neustart, Arm-Zustand, hängende Bewegung.

Das teuerste Szenario dieser Software: Printloom startet neu (Container-Neustart
oder das EIGENE In-App-Update), während ein Zyklus läuft. Der Drucker druckt
weiter, der Arm steht irgendwo — vielleicht mit einer Platte im Greifer. Bis
v1.1.1 war danach nichts davon bekannt.

Zwei Regeln, die hier festgenagelt sind:
  • Nach einem Neustart wird NIE automatisch weitergefahren — nur gemeldet.
  • Nach Notaus/Abbruch/Timeout gilt die Position als unbekannt, und die nächste
    Bewegung referenziert zuerst."""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

import httpx  # noqa: E402

from app.routers import autofarm  # noqa: E402
from app.services import storage  # noqa: E402


@pytest.fixture(autouse=True)
def state(tmp_path, monkeypatch):
    monkeypatch.setattr(autofarm, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setattr(autofarm, "HMS_PATH", str(tmp_path / "farm_hms.json"))
    monkeypatch.setitem(autofarm._farm, "arm", dict(autofarm._ARM_EMPTY))
    monkeypatch.setitem(autofarm._farm, "recovery", None)
    monkeypatch.setitem(autofarm._farm, "needs_home", False)
    monkeypatch.setitem(autofarm._farm, "running", False)
    monkeypatch.setitem(autofarm._farm, "log", [])
    return tmp_path


def _saved(state):
    return storage.read_json(str(state / "farm_state.json"), {})


# ── Zustand sichern ──────────────────────────────────────────────────────────
def test_zustand_wird_geschrieben(state):
    autofarm._farm.update({"running": True, "current_job_id": 7,
                           "_current_job_name": "teil.3mf", "seq_step_label": "Auswerfen"})
    autofarm._persist_state()
    s = _saved(state)
    assert s["running"] is True and s["job_name"] == "teil.3mf"
    assert s["step_label"] == "Auswerfen"
    assert s["saved_at"]


def test_sauberes_ende_hinterlaesst_nichts_zu_bergen(state):
    autofarm._farm.update({"running": True})
    autofarm._persist_state()
    autofarm._clear_state()
    assert autofarm._load_recovery() is None


# ── Wiederaufnahme ───────────────────────────────────────────────────────────
def test_unterbrochener_lauf_wird_erkannt(state):
    autofarm._farm.update({"running": True, "_current_job_name": "teil.3mf",
                           "seq_step_label": "Platte holen"})
    autofarm._persist_state()
    rec = autofarm._load_recovery()
    assert rec and rec["job_name"] == "teil.3mf"


def test_platte_im_greifer_ueberlebt_den_neustart(state):
    autofarm._farm["running"] = True
    autofarm._set_arm("printed", "", 3)
    rec = autofarm._load_recovery()
    assert rec["arm"]["holding"] == "printed"


def test_greifer_haelt_etwas_zaehlt_auch_ohne_laufende_farm(state):
    """Farm gestoppt, aber Platte hängt noch → trotzdem melden."""
    autofarm._farm["running"] = False
    autofarm._set_arm("empty", "1-3", 1)
    rec = autofarm._load_recovery()
    assert rec is not None and rec["arm"]["from"] == "1-3"


def test_init_faehrt_nichts_von_allein_weiter(state):
    """Der kritische Test: nach dem Erkennen darf die Farm NICHT laufen."""
    autofarm._farm.update({"running": True, "_current_job_name": "x.3mf"})
    autofarm._set_arm("printed")
    autofarm._farm.update({"running": False, "recovery": None, "needs_home": False})
    autofarm._init_recovery()
    assert autofarm._farm["recovery"] is not None
    assert autofarm._farm["running"] is False       # nichts gestartet
    assert autofarm._farm["needs_home"] is True     # Position gilt als unbekannt


def test_ohne_gesicherten_zustand_keine_meldung(state):
    autofarm._init_recovery()
    assert autofarm._farm["recovery"] is None


def test_recovery_endpoint_beschreibt_die_lage(state):
    autofarm._farm.update({"running": True, "_current_job_name": "teil.3mf",
                           "seq_step_label": "Auswerfen"})
    autofarm._set_arm("printed", "", 2)
    autofarm._farm["recovery"] = autofarm._load_recovery()
    r = asyncio.run(autofarm.get_recovery())
    assert r["pending"] is True
    assert "FERTIGEN" in r["arm_hint"]
    assert r["job"] == "teil.3mf" and r["step"] == "Auswerfen"


def test_quittieren_raeumt_auf(state):
    autofarm._farm["running"] = True
    autofarm._set_arm("printed")
    autofarm._farm["recovery"] = autofarm._load_recovery()
    asyncio.run(autofarm.dismiss_recovery({"arm_cleared": True}))
    assert autofarm._farm["recovery"] is None
    assert autofarm._farm["arm"]["holding"] == "none"
    assert autofarm._farm["needs_home"] is True     # trotzdem erst referenzieren
    assert asyncio.run(autofarm.get_recovery())["pending"] is False


# ── Arm-Zustand ──────────────────────────────────────────────────────────────
def test_arm_zustaende(state):
    autofarm._set_arm("empty", "1-4", 5)
    assert autofarm._farm["arm"] == {"holding": "empty", "from": "1-4", "job_id": 5}
    autofarm._set_arm("none")
    assert autofarm._farm["arm"]["holding"] == "none"
    assert _saved(state)["arm"]["holding"] == "none"


# ── Position unbekannt / Referenzfahrt erzwingen ─────────────────────────────
def test_notaus_markiert_die_position_als_unbekannt(state):
    autofarm.mark_position_unknown("Notaus")
    assert autofarm._farm["needs_home"] is True
    assert _saved(state)["needs_home"] is True
    assert any("Notaus" in line for line in autofarm._farm["log"])


def test_naechste_bewegung_referenziert_zuerst(state, monkeypatch):
    """needs_home → vor dem eigentlichen Befehl kommt OTTOEJECT_HOME."""
    sent = []

    class Resp:
        status_code = 200
        text = ""

    class Client:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, **kw):
            sent.append((json or {}).get("script", ""))
            return Resp()

    class Mod:
        AsyncClient = Client
        ReadTimeout = httpx.ReadTimeout
        HTTPError = httpx.HTTPError

    class FakeDev:
        ip_address, port = "127.0.0.1", 7125

    class FakeQ:
        def filter(self, *a, **kw): return self
        def first(self): return FakeDev()

    class FakeSession:
        def query(self, *a, **kw): return FakeQ()
        def close(self): pass

    monkeypatch.setattr(autofarm, "httpx", Mod)
    monkeypatch.setattr(autofarm, "SessionLocal", lambda: FakeSession())
    autofarm._farm["needs_home"] = True
    asyncio.run(autofarm._do_macro("PARK_OTTOEJECT"))
    assert any("OTTOEJECT_HOME" in s for s in sent)
    assert any("PARK_OTTOEJECT" in s for s in sent)
    assert autofarm._farm["needs_home"] is False        # erledigt


def test_homing_selbst_raeumt_das_flag_ab(state, monkeypatch):
    """OTTOEJECT_HOME darf sich nicht selbst rekursiv vorschalten."""
    sent = []

    class Resp:
        status_code = 200
        text = ""

    class Client:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, **kw):
            sent.append((json or {}).get("script", ""))
            return Resp()

    class Mod:
        AsyncClient = Client
        ReadTimeout = httpx.ReadTimeout
        HTTPError = httpx.HTTPError

    class FakeDev:
        ip_address, port = "127.0.0.1", 7125

    class FakeQ:
        def filter(self, *a, **kw): return self
        def first(self): return FakeDev()

    class FakeSession:
        def query(self, *a, **kw): return FakeQ()
        def close(self): pass

    monkeypatch.setattr(autofarm, "httpx", Mod)
    monkeypatch.setattr(autofarm, "SessionLocal", lambda: FakeSession())
    autofarm._farm["needs_home"] = True
    asyncio.run(autofarm._do_macro("OTTOEJECT_HOME"))
    assert len(sent) == 1
    assert autofarm._farm["needs_home"] is False


# ── Hängende Bewegung ────────────────────────────────────────────────────────
def test_haengende_bewegung_wird_zum_eigenen_fehler(state, monkeypatch):
    """Vorher lief das in einen nackten httpx-Timeout („Network Error") — ohne
    dass jemand merkte, dass der Arm steht."""
    class Client:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **kw): raise httpx.ReadTimeout("timeout")

    class Mod:
        AsyncClient = Client
        ReadTimeout = httpx.ReadTimeout
        HTTPError = httpx.HTTPError

    class FakeDev:
        ip_address, port = "127.0.0.1", 7125

    class FakeQ:
        def filter(self, *a, **kw): return self
        def first(self): return FakeDev()

    class FakeSession:
        def query(self, *a, **kw): return FakeQ()
        def close(self): pass

    monkeypatch.setattr(autofarm, "httpx", Mod)
    monkeypatch.setattr(autofarm, "SessionLocal", lambda: FakeSession())
    with pytest.raises(autofarm._MoveTimeout) as e:
        asyncio.run(autofarm._do_macro("GRAB_FROM_RACK RACK=1 SLOT=1"))
    assert "hängt" in str(e.value)


def test_zeitlimit_wird_begrenzt(monkeypatch):
    monkeypatch.setitem(autofarm._farm, "move_timeout_s", 5)
    assert autofarm._move_timeout() == 30.0        # Untergrenze
    monkeypatch.setitem(autofarm._farm, "move_timeout_s", 99999)
    assert autofarm._move_timeout() == 900.0       # Obergrenze
    monkeypatch.setitem(autofarm._farm, "move_timeout_s", "quatsch")
    assert autofarm._move_timeout() == 180.0       # Rückfall


# ── HMS-Historie ─────────────────────────────────────────────────────────────
def test_hms_wird_mit_zeitstempel_gespeichert(state):
    autofarm._record_hms("0300_0100_0002_0001", "serious", "Achse blockiert", "pause")
    items = asyncio.run(autofarm.get_hms_history())["items"]
    assert len(items) == 1
    assert items[0]["code"] == "0300_0100_0002_0001"
    assert items[0]["severity"] == "serious" and items[0]["ts"]


def test_hms_neueste_zuerst_und_gedeckelt(state):
    for i in range(5):
        autofarm._record_hms(f"code{i}", "serious", "x")
    items = asyncio.run(autofarm.get_hms_history())["items"]
    assert items[0]["code"] == "code4"
    assert asyncio.run(autofarm.get_hms_history(limit=2))["items"].__len__() == 2


def test_hms_historie_leeren(state):
    autofarm._record_hms("c", "fatal", "x")
    asyncio.run(autofarm.clear_hms_history())
    assert asyncio.run(autofarm.get_hms_history())["items"] == []
