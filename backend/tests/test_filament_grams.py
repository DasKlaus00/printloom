"""Filamentverbrauch je Datei — Grundlage der Materialkosten.

Der Filamentpreis stand bis v1.1.18 in den Einstellungen, wurde angezeigt und
NIRGENDS verrechnet. Damit er das kann, braucht die Farm die Gramm je Job. Gelesen
werden sie aus dem G-code-HEADER — plattengenau, denn bei einer Multi-Plate-Datei
bekäme sonst jede Platte den Verbrauch der ersten zugerechnet.

`None` heißt ausdrücklich „nicht ermittelbar" und nicht 0: als 0 g verbucht sähe eine
unvollständige Materialrechnung vollständig aus.
"""
import zipfile

import pytest

pytest.importorskip("fastapi")

from app.routers.files import filament_grams          # noqa: E402


def head(grams):
    return (f"; filament used [g] = {grams}\n"
            "; total estimated time: 1h 0m 0s\n"
            "G1 X0 Y0\n")


def make_3mf(tmp_path, plates: dict, name="job.3mf"):
    p = tmp_path / name
    with zipfile.ZipFile(p, "w") as zf:
        for idx, grams in plates.items():
            zf.writestr(f"Metadata/plate_{idx}.gcode", head(grams))
    return str(p)


# ── Auslesen ────────────────────────────────────────────────────────────────

def test_gramm_kommen_aus_dem_header(tmp_path):
    assert filament_grams(make_3mf(tmp_path, {1: "12.5"}), ".3mf") == 12.5


def test_mehrere_filamente_werden_summiert(tmp_path):
    """Mehrfarbige Drucke schreiben eine Liste — der Verbrauch ist die Summe."""
    assert filament_grams(make_3mf(tmp_path, {1: "10.0;5.5"}), ".3mf") == 15.5


def test_reine_gcode_datei_geht_auch(tmp_path):
    p = tmp_path / "job.gcode"
    p.write_text(head("7.25"), encoding="utf-8")
    assert filament_grams(str(p), ".gcode") == 7.25


# ── Plattengenau ────────────────────────────────────────────────────────────

def test_die_gedruckte_platte_zaehlt(tmp_path):
    path = make_3mf(tmp_path, {1: "10.0", 2: "40.0", 3: "90.0"})
    assert filament_grams(path, ".3mf", plate=2) == 40.0
    assert filament_grams(path, ".3mf", plate=3) == 90.0


def test_ohne_plattenangabe_gilt_die_erste(tmp_path):
    path = make_3mf(tmp_path, {1: "10.0", 2: "40.0"})
    assert filament_grams(path, ".3mf") == 10.0


def test_eine_nicht_vorhandene_platte_faellt_auf_die_erste_zurueck(tmp_path):
    """Besser der Wert der ersten Platte als ein Absturz mitten in der Buchhaltung."""
    path = make_3mf(tmp_path, {1: "10.0"})
    assert filament_grams(path, ".3mf", plate=9) == 10.0


def test_die_plattennummer_wird_nicht_als_praefix_verwechselt(tmp_path):
    """plate_1 darf nicht plate_10 treffen."""
    path = make_3mf(tmp_path, {1: "10.0", 10: "99.0"})
    assert filament_grams(path, ".3mf", plate=1) == 10.0
    assert filament_grams(path, ".3mf", plate=10) == 99.0


# ── Nicht ermittelbar ist nicht 0 ───────────────────────────────────────────

def test_header_ohne_angabe_ergibt_none(tmp_path):
    p = tmp_path / "job.gcode"
    p.write_text("; total estimated time: 1h\nG1 X0\n", encoding="utf-8")
    assert filament_grams(str(p), ".gcode") is None


def test_fremdformat_ergibt_none(tmp_path):
    p = tmp_path / "modell.stl"
    p.write_text("solid\n", encoding="utf-8")
    assert filament_grams(str(p), ".stl") is None


def test_kaputte_datei_ergibt_none_statt_absturz(tmp_path):
    p = tmp_path / "kaputt.3mf"
    p.write_bytes(b"das ist kein zip")
    assert filament_grams(str(p), ".3mf") is None


def test_fehlende_datei_ergibt_none(tmp_path):
    assert filament_grams(str(tmp_path / "gibtsnicht.3mf"), ".3mf") is None


def test_3mf_ohne_gcode_ergibt_none(tmp_path):
    p = tmp_path / "leer.3mf"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("Metadata/model_settings.config", "<config/>")
    assert filament_grams(str(p), ".3mf") is None


def test_null_gramm_gelten_als_unbekannt(tmp_path):
    """Ein Slicer, der 0 schreibt, hat nichts gemessen — 0 g druckt niemand."""
    assert filament_grams(make_3mf(tmp_path, {1: "0"}), ".3mf") is None
