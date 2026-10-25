"""Abkuehlen vor dem Auswerfen — der Sequenz-Schritt "wait_cool".

Die Magnete halten eine WARME Platte nicht. Faehrt der Arm zu frueh los, bleibt
die Platte im Drucker liegen und er kommt leer zurueck — ohne Fehlermeldung, denn
er kann nicht fuehlen, ob etwas am Greifer haengt. Der Zyklus liefe weiter, als
waere nichts gewesen. Genau das verhindert die Wartezeit.

Der Schritt steht im Sequenz-Editor VOR dem Auswurf — sichtbar und verschiebbar.
Als unsichtbare Automatik haette niemand verstanden, warum die Farm nach dem
Druck erst einmal nichts tut.

Drei Zusagen stehen hier fest:
  • Gewartet wird, bis die Bett-Temperatur unter dem Zielwert liegt.
  • Kein Messwert → nicht blockieren (fail-open, wie bei den Schritt-Bedingungen).
  • Zeitlimit erreicht → trotzdem weiter, aber sichtbar melden.
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
    return zustand


def warte(zustand, temps, ziel=30.0, timeout_s=1800):
    zustand["temps"] = temps
    asyncio.run(af._await_bed_cool(FakeDevice(), ziel, timeout_s))
    return zustand


def log():
    return " | ".join(af._farm.get("log") or [])


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


def test_der_eigene_zielwert_gilt(bett):
    z = warte(bett, [50.0, 44.0], ziel=45.0)
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
    z = warte(bett, [90.0] * 5, timeout_s=0.006)      # wird nie kalt
    assert z["gelesen"] >= 1
    assert "trotzdem weiter" in log()


def test_ohne_zeitlimit_wird_weiter_gewartet(bett):
    """0 = ohne Zeitlimit — dann wird bis zum kalten Bett gewartet."""
    z = warte(bett, [90.0] * 20 + [25.0], timeout_s=0)
    assert z["gelesen"] == 21


def test_stoppen_bricht_das_warten_ab(bett, monkeypatch):
    """Wer Stopp drueckt, soll nicht erst auf ein kaltes Bett warten muessen."""
    monkeypatch.setitem(af._farm, "stopping", True)
    with pytest.raises(RuntimeError):
        warte(bett, [90.0])


# ── Leere Felder im Schritt ───────────────────────────────────────────

@pytest.mark.parametrize("leer", (None, "", "abc", 0))
def test_ein_leeres_feld_wird_zur_vorgabe_nicht_zur_null(leer):
    """0 °C waere ein Ziel, das nie kommt — der Zyklus stuende bis zum Zeitlimit."""
    assert af._num_or(leer, af.COOL_DEFAULT_C) == af.COOL_DEFAULT_C


def test_eingetragene_werte_gelten():
    assert af._num_or("45", af.COOL_DEFAULT_C) == 45.0
    assert af._num_or(600, af.COOL_DEFAULT_S) == 600.0


def test_abkuehlen_ist_keine_vorpositionierung():
    """Eine Minute vor Druckende ist das Bett heiss — als prep-Schritt wuerde er
    die ganze Vorbereitung blockieren."""
    assert "wait_cool" in af._PREP_FORBIDDEN
