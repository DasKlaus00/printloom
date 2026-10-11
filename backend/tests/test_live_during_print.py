"""Einstellungen, Positionen und Sequenzen wirken WÄHREND des Drucks.

Bis v1.1.33 war fast alles für einen ganzen Job oder sogar für den ganzen Lauf
eingefroren:

  • Sequenzen    — für den GANZEN Lauf (erst nach Stopp + Neustart der Farm)
  • Geometrie    — je Job: eine während des Drucks nachjustierte Position galt
                   für das Auswerfen NACH genau diesem Druck nicht
  • Einstellungen — zwischen zwei Jobs; im Druck selbst nicht

Die Zusagen hier:
  • Vor jedem Schritt werden Einstellungen und Geometrie frisch gelesen.
  • Eine während des Drucks geänderte Zyklus-Sequenz gilt ab dem Druckende —
    aber NUR für die Schritte hinter „Auf Druckende warten". Was schon passiert
    ist, wird nicht nachträglich ersetzt.
  • Ist die neue Fassung nicht eindeutig zuzuordnen, läuft der Rest nach der
    alten — nie nach einer geratenen.
"""
import asyncio
import json

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers import autofarm as af  # noqa: E402


def step(i, typ, value="", **rest):
    return {"id": i, "type": typ, "label": f"{typ}:{value}", "value": value,
            "seconds": 0, "parallel": False, "optional": False, "prep": False, **rest}


ALT = [
    step(1, "app_op", "grab_magazine"),
    step(2, "app_op", "place"),
    step(3, "send_file"),
    step(4, "wait_print"),
    step(5, "app_op", "eject"),
    step(6, "app_op", "store"),
]

# Während des Drucks eingefügt: Abkühlen vor dem Auswerfen.
NEU = ALT[:4] + [step(9, "wait_cool", "30")] + ALT[4:]


@pytest.fixture
def seq_file(tmp_path, monkeypatch):
    p = tmp_path / "farm_sequences.json"
    monkeypatch.setattr(af, "SEQ_PATH", str(p))

    def schreiben(seq_next, version=af.SEQ_SCHEMA_VERSION, seq_new=None):
        p.write_text(json.dumps({"schema_version": version, "seq_new": seq_new or [],
                                 "seq_next": seq_next}), encoding="utf-8")
    return schreiben


# ── Gespeicherte Sequenzen lesen ─────────────────────────────────────────────

def test_aktuelle_sequenz_wird_gelesen(seq_file):
    seq_file(NEU)
    assert af._read_sequences()["seq_next"] == NEU


def test_veraltetes_schema_wird_nicht_nachgeladen(seq_file):
    """Das Starten verweigert ein veraltetes Schema — das Nachladen darf es nicht
    durch die Hintertür hereinlassen."""
    seq_file(NEU, version="0.0.1")
    assert af._read_sequences() is None


def test_leerer_zyklus_wird_nicht_uebernommen(seq_file):
    """Eine leere Liste ist eher ein halbfertiger Speichervorgang als ein Wunsch."""
    seq_file([])
    assert af._read_sequences() is None


def test_fehlende_datei_aendert_nichts(tmp_path, monkeypatch):
    monkeypatch.setattr(af, "SEQ_PATH", str(tmp_path / "gibtsnicht.json"))
    assert af._read_sequences() is None


# ── Rest des Zyklus nach dem Druckende ───────────────────────────────────────

def test_unveraendert_bleibt_alles_wie_es_ist(seq_file):
    seq_file(ALT)
    assert af._fresh_cycle_tail(ALT) is None


def test_geaenderte_sequenz_liefert_den_neuen_rest(seq_file):
    seq_file(NEU)
    rest = af._fresh_cycle_tail(ALT)
    assert [s["type"] for s in rest] == ["wait_cool", "app_op", "app_op"]
    assert [s.get("value") for s in rest] == ["30", "eject", "store"]


def test_ersetzt_wird_nur_was_hinter_dem_druckende_steht(seq_file):
    """Wer während des Drucks auch den ANFANG des Zyklus ändert, darf damit nicht
    die Schritte verdoppeln, die schon gelaufen sind."""
    anders = [step(1, "app_op", "grab")] + NEU[1:]
    seq_file(anders)
    rest = af._fresh_cycle_tail(ALT)
    assert all(s["type"] != "send_file" for s in rest)
    assert all(s.get("value") not in ("grab", "grab_magazine", "place") for s in rest)


@pytest.mark.parametrize("anzahl", (0, 2))
def test_ohne_eindeutiges_druckende_bleibt_die_alte_fassung(seq_file, anzahl):
    """Kein oder zwei „Auf Druckende warten" — dann ist nicht klar, wo „danach"
    beginnt. Lieber die bekannte alte Fassung als eine geratene neue."""
    ohne = [s for s in NEU if s["type"] != "wait_print"]
    zwei = NEU[:4] + [step(8, "wait_print")] + NEU[4:]
    seq_file(ohne if anzahl == 0 else zwei)
    assert af._fresh_cycle_tail(ALT) is None


def test_abgeschaltete_schritte_kommen_nicht_mit(seq_file):
    aus = NEU[:4] + [step(9, "wait_cool", "30", disabled=True)] + NEU[5:]
    seq_file(aus)
    rest = af._fresh_cycle_tail(ALT)
    assert all(s["type"] != "wait_cool" for s in rest)


def test_vorpositionierung_kommt_nicht_doppelt(seq_file):
    """prep-Schritte laufen ~1 min vor Druckende innerhalb der Warteschleife. Im
    nachgeladenen Rest dürfen sie nicht noch einmal auftauchen."""
    mit_prep = NEU[:4] + [step(7, "app_op", "move_to_printer", prep=True)] + NEU[4:]
    seq_file(mit_prep)
    rest = af._fresh_cycle_tail(ALT)
    assert all(s.get("value") != "move_to_printer" for s in rest)


# ── Ablauf: wird der neue Rest wirklich gefahren? ────────────────────────────

@pytest.fixture
def spur(monkeypatch, tmp_path):
    """_exec_step abfangen; mitschreiben, was gefahren wird und mit welcher Geometrie."""
    gefahren, geometrie_geladen = [], []

    async def exec_step(st, *a, **kw):
        gefahren.append((st["type"], st.get("value")))

    def lade():
        geometrie_geladen.append(len(gefahren))
        return {"geladen_vor_schritt": len(gefahren)}

    monkeypatch.setattr(af, "_exec_step", exec_step)
    monkeypatch.setattr(af, "_load_farm_geometry", lade)
    monkeypatch.setattr(af, "_persist_state", lambda: None)
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setattr(af, "SETTINGS_PATH", str(tmp_path / "farm_settings.json"))
    monkeypatch.setitem(af._farm, "stopping", False)
    monkeypatch.setitem(af._farm, "paused", False)
    monkeypatch.setitem(af._farm, "log", [])
    return gefahren, geometrie_geladen


def fahre(steps, started_with=None):
    asyncio.run(af._exec_sequence(steps, {"id": 1}, None, True, 1, 0, [], [],
                                  started_with=started_with))


def test_neuer_rest_wird_nach_dem_druckende_gefahren(seq_file, spur):
    """Der eigentliche Fall: Abkühlen während des Drucks eingefügt → es läuft
    vor dem Auswerfen DIESES Drucks."""
    gefahren, _ = spur
    seq_file(NEU)
    fahre(ALT, started_with=ALT)
    typen = [t for t, _ in gefahren]
    assert typen.index("wait_cool") == typen.index("wait_print") + 1
    assert typen.count("app_op") == 4          # grab, place, eject, store — keins doppelt


def test_ohne_aenderung_laeuft_der_zyklus_wie_gehabt(seq_file, spur):
    gefahren, _ = spur
    seq_file(ALT)
    fahre(ALT, started_with=ALT)
    assert [t for t, _ in gefahren] == [s["type"] for s in ALT]


def test_nur_der_zyklus_wird_ersetzt(seq_file, spur):
    """First Start und Bergung geben `started_with` nicht mit — dort wird nie etwas
    untergeschoben."""
    gefahren, _ = spur
    seq_file(NEU)
    fahre(ALT)                                   # ohne started_with
    assert "wait_cool" not in [t for t, _ in gefahren]


def test_geometrie_wird_vor_jedem_schritt_frisch_gelesen(seq_file, spur):
    """Vorher einmal je Job — eine während des Drucks nachjustierte Position galt
    für das Auswerfen danach nicht."""
    gefahren, geladen = spur
    seq_file(ALT)
    fahre(ALT, started_with=ALT)
    assert len(geladen) == len(ALT)
    assert geladen == list(range(len(ALT)))      # vor Schritt 0, 1, 2, …


def test_einstellungen_werden_vor_jedem_schritt_nachgezogen(seq_file, spur, monkeypatch):
    gefahren, _ = spur
    aufrufe = []
    monkeypatch.setattr(af, "_refresh_live_settings", lambda: aufrufe.append(1))
    seq_file(ALT)
    fahre(ALT, started_with=ALT)
    assert len(aufrufe) == len(ALT)
