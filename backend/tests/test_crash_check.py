"""Crash-Check: ragt der Druck in die Bahn des OTTOeject-Arms?

Der Arm fährt beim Auswerfen/Einlagern seitlich am Bett vorbei. Ein hohes Objekt im
Randstreifen wird von ihm gerammt — das „!" in der Bibliothek warnt davor. Hier ist
festgehalten, was die reine Scan-Logik liefert (ohne HTTP/DB)."""
import io
import zipfile

import pytest

pytest.importorskip("fastapi")

from app.routers import files as f    # noqa: E402


def _dreimf(tmp_path, platten: dict):
    """Minimale .3mf mit {Plattennummer: gcode-Text}."""
    p = tmp_path / "mehrplatten.3mf"
    with zipfile.ZipFile(p, "w") as z:
        for num, gcode in platten.items():
            z.writestr(f"Metadata/plate_{num}.gcode", gcode)
    return str(p)


# Z klettert über die 30-mm-Grenze und fährt dann in den Randstreifen (X < 10).
GEFAEHRLICH = "G90\nG1 Z50\nG1 X5 Y100\n"
# Hoch, aber immer schön in der Mitte → harmlos.
HOCH_HARMLOS = "G90\nG1 Z90\nG1 X128 Y100\n"
FLACH = "G90\nG1 Z10\nG1 X2 Y100\n"      # im Randstreifen, aber unter der Z-Grenze


def test_flaches_teil_im_randstreifen_ist_harmlos(tmp_path):
    pfad = _dreimf(tmp_path, {1: FLACH})
    r = f._scan_file_for_crash(pfad, ".3mf", None, 256.0)
    assert r["crash_risk"] is False


def test_hohes_teil_im_randstreifen_wird_erkannt(tmp_path):
    pfad = _dreimf(tmp_path, {1: GEFAEHRLICH})
    r = f._scan_file_for_crash(pfad, ".3mf", None, 256.0)
    assert r["crash_risk"] is True
    assert r["hit_x_mm"] == 5.0
    assert r["hit_z_mm"] == 50.0
    assert r["plate"] == 1


def test_eine_gefaehrliche_platte_macht_die_ganze_datei_riskant(tmp_path):
    pfad = _dreimf(tmp_path, {1: HOCH_HARMLOS, 2: GEFAEHRLICH})
    r = f._scan_file_for_crash(pfad, ".3mf", None, 256.0)
    assert r["crash_risk"] is True
    assert r["plate"] == 2


def test_gemeldete_hoehe_gilt_fuer_die_ganze_datei(tmp_path):
    """Platte 1 ist die höchste (90 mm), der Treffer sitzt auf Platte 2 (50 mm).
    Gemeldet werden muss die höchste Höhe der Datei — vorher überschrieb der Treffer
    den bis dahin gesammelten Wert und die Warnung nannte 50 statt 90 mm."""
    pfad = _dreimf(tmp_path, {1: HOCH_HARMLOS, 2: GEFAEHRLICH})
    r = f._scan_file_for_crash(pfad, ".3mf", None, 256.0)
    assert r["max_z_mm"] == 90.0
    assert r["hit_z_mm"] == 50.0      # die Stelle des Treffers bleibt die des Treffers


def test_nur_die_gewaehlte_platte_pruefen(tmp_path):
    pfad = _dreimf(tmp_path, {1: GEFAEHRLICH, 2: HOCH_HARMLOS})
    assert f._scan_file_for_crash(pfad, ".3mf", 2, 256.0)["crash_risk"] is False
    assert f._scan_file_for_crash(pfad, ".3mf", 1, 256.0)["crash_risk"] is True


def test_rechter_randstreifen_haengt_an_der_bettbreite(tmp_path):
    """x_max ist einstellbar (anderer Drucker) — die rechte Zone wandert mit."""
    pfad = _dreimf(tmp_path, {1: "G90\nG1 Z50\nG1 X250 Y100\n"})
    assert f._scan_file_for_crash(pfad, ".3mf", None, 256.0)["crash_risk"] is True   # >246
    assert f._scan_file_for_crash(pfad, ".3mf", None, 350.0)["crash_risk"] is False  # <340


def test_reine_gcode_datei(tmp_path):
    g = tmp_path / "teil.gcode"
    g.write_text(GEFAEHRLICH, encoding="utf-8")
    assert f._scan_file_for_crash(str(g), ".gcode", None, 256.0)["crash_risk"] is True


def test_ohne_gcode_im_archiv_gibt_es_nichts_zu_pruefen(tmp_path):
    p = tmp_path / "leer.3mf"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("Metadata/plate_1.png", b"nicht wirklich ein PNG")
    assert f._scan_file_for_crash(str(p), ".3mf", None, 256.0) is None
