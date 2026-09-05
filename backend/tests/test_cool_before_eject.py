"""Abkuehlen vor dem Auswerfen — nur beim Magnet-Greifer.

Die Magnete halten eine WARME Platte nicht. Faehrt der Arm zu frueh los, bleibt
die Platte im Drucker liegen und er kommt leer zurueck — ohne Fehlermeldung, denn
er kann nicht fuehlen, ob etwas am Greifer haengt. Der Zyklus liefe weiter, als
waere nichts gewesen. Genau das verhindert die Wartezeit.

Vier Zusagen stehen hier fest:
  • Warten NUR mit dem Magnet-Greifer (der Klemm-Greifer haelt mechanisch).
  • Gewartet wird, bis die Bett-Temperatur unter dem Zielwert liegt.
  • Kein Messwert → nicht blockieren (fail-open, wie bei den Schritt-Bedingungen).
  • Zeitlimit erreicht → trotzdem auswerfen, aber sichtbar melden.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers import autofarm as af  # noqa: E402


class FakeDevice:
    name = "X1C"
    id = 1


@pytest.fixture
def bett(tmp_path, monkeypatch):
    """Temperatur-Verlauf vorgeben; die Schlafphasen fallen weg."""
    zustand = {"temps": [], "gelesen": 0}

    async def read(device, max_age=8.0):
        i = min(zustand["gelesen"], len(zustand["temps"]) - 1)
        zustand["gelesen"] += 1
        wert = zustand["temps"][i] if zustand["temps"] else None
        return {} if wert is None else {"bed_temper": wert}

    monkeypatch.setattr(af, "_read_live_print", read)
    # Nicht asyncio.sleep ersetzen — daran haengt die Ereignisschleife selbst.
    # Stattdessen den Abfrage-Abstand auf fast Null: gewartet wird an der Zahl der
    # Abfragen ablesbar, nicht an der Uhr.
    monkeypatch.setattr(af, "COOL_POLL_S", 0.001)
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setitem(af._farm, "log", [])
    monkeypatch.setitem(af._farm, "stopping", False)
    monkeypatch.setitem(af._farm, "cool_before_eject", True)
    monkeypatch.setitem(af._farm, "cool_temp_c", 30.0)
    monkeypatch.setitem(af._farm, "cool_timeout_min", 30)
    monkeypatch.setitem(af._farm, "geometry", {"gripper": "magnet"})
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: {"gripper": "magnet"})
    return zustand


def warte(zustand, temps):
    zustand["temps"] = temps
    asyncio.run(af._await_bed_cool(FakeDevice()))
    return zustand


def log():
    return " | ".join(af._farm.get("log") or [])


# ── Nur der Magnet wartet ────────────────────────────────────────────────────

def test_der_klemm_greifer_wartet_nicht(bett, monkeypatch):
    """Er haelt die Platte mechanisch — warten waere bei jedem Zyklus verschenkte
    Zeit, und zwar genau so viel, wie das Bett zum Abkuehlen braucht."""
    monkeypatch.setitem(af._farm, "geometry", {"gripper": "standard"})
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: {"gripper": "standard"})
    z = warte(bett, [90.0])
    assert z["gelesen"] == 0


def test_ausgeschaltet_wird_nicht_gewartet(bett, monkeypatch):
    monkeypatch.setitem(af._farm, "cool_before_eject", False)
    z = warte(bett, [90.0])
    assert z["gelesen"] == 0


# ── Warten, bis es kalt genug ist ────────────────────────────────────────────

def test_kaltes_bett_faehrt_sofort(bett):
    """Eine Abfrage, kein Warten."""
    z = warte(bett, [28.0])
    assert z["gelesen"] == 1


def test_warmes_bett_wird_abgewartet(bett):
    z = warte(bett, [90.0, 60.0, 40.0, 29.0])
    assert z["gelesen"] == 4


def test_die_grenze_gilt_einschliesslich(bett):
    """Genau der Zielwert reicht — sonst wartete der Zyklus auf ein Zehntel Grad."""
    z = warte(bett, [30.0])
    assert z["gelesen"] == 1


def test_der_eigene_zielwert_gilt(bett, monkeypatch):
    monkeypatch.setitem(af._farm, "cool_temp_c", 45.0)
    z = warte(bett, [50.0, 44.0])
    assert z["gelesen"] == 2


# ── Was schiefgehen kann ─────────────────────────────────────────────────────

def test_ohne_messwert_wird_nicht_blockiert(bett):
    """Fail-open wie bei den Schritt-Bedingungen: ein Lesefehler darf keinen
    Zyklus anhalten."""
    z = warte(bett, [None])
    assert z["gelesen"] == 1
    assert "nicht lesbar" in log()


def test_nach_dem_zeitlimit_wird_trotzdem_ausgeworfen(bett, monkeypatch):
    """Ein Zyklus, der ewig steht, waere schlimmer als ein Versuch — aber es muss
    dabeistehen, dass die Platte liegen bleiben koennte."""
    monkeypatch.setitem(af._farm, "cool_timeout_min", 0.0001)   # 6 ms
    z = warte(bett, [90.0] * 5)      # wird nie kalt
    assert z["gelesen"] >= 1
    assert "trotzdem ausgeworfen" in log()


def test_ein_halbes_minutenlimit_bleibt_ein_limit(bett, monkeypatch):
    """Vorher machte int() aus 0,5 min eine 0 — und 0 heisst „ohne Zeitlimit".
    Aus einem knappen Limit wurde damit das Gegenteil: unbegrenztes Warten."""
    monkeypatch.setitem(af._farm, "cool_timeout_min", 0.5 / 60 / 100)   # 0,3 ms
    warte(bett, [90.0] * 5)
    assert "trotzdem ausgeworfen" in log()


def test_ohne_zeitlimit_wird_weiter_gewartet(bett, monkeypatch):
    """0 = ohne Zeitlimit. Sonst braeche der Lauf nach der Vorgabe ab, obwohl der
    Nutzer das Limit ausdruecklich abgeschaltet hat."""
    monkeypatch.setitem(af._farm, "cool_timeout_min", 0)
    z = warte(bett, [90.0] * 20 + [25.0])
    assert z["gelesen"] == 21


def test_stoppen_bricht_das_warten_ab(bett, monkeypatch):
    """Wer Stopp drueckt, soll nicht erst auf ein kaltes Bett warten muessen."""
    monkeypatch.setitem(af._farm, "stopping", True)
    with pytest.raises(RuntimeError):
        warte(bett, [90.0])
