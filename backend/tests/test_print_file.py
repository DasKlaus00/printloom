"""Druckdateien lesen (services/print_file) — was Direktdruck UND Farm teilen.

Bis v1.1.34 stand „welcher G-code gehört zu Platte N" sechsmal im Code, und
Direktdruck und Farm packten Multi-Plate-Dateien je mit eigener Kopie um. Hier
die Zusagen, auf die sich beide verlassen."""
import os
import zipfile

from app.services import print_file


def _3mf(path, plates, header=""):
    with zipfile.ZipFile(path, "w") as z:
        for n in plates:
            z.writestr(f"Metadata/plate_{n}.gcode", header or f"; Platte {n}\nG1 X1\n")
            z.writestr(f"Metadata/plate_{n}.png", b"png")
    return str(path)


def test_platten_numerisch_sortiert():
    """plate_10 gehört HINTER plate_2 — als Text sortiert stünde es davor."""
    names = ["Metadata/plate_10.gcode", "Metadata/plate_2.gcode", "Metadata/plate_1.gcode",
             "Metadata/plate_1.png", "3D/3dmodel.model"]
    assert print_file.plate_gcodes(names) == [
        "Metadata/plate_1.gcode", "Metadata/plate_2.gcode", "Metadata/plate_10.gcode"]


def test_gewuenschte_platte_sonst_die_erste():
    names = ["Metadata/plate_3.gcode", "Metadata/plate_5.gcode"]
    assert print_file.first_gcode(names, plate=5) == "Metadata/plate_5.gcode"
    assert print_file.first_gcode(names, plate=9) == "Metadata/plate_3.gcode"
    assert print_file.first_gcode(["a/x.gcode"]) == "a/x.gcode"


def test_einzelne_platte_wird_nicht_umgepackt(tmp_path):
    f = _3mf(tmp_path / "a.3mf", [1])
    path, tmp, param, note = print_file.upload_plan(f, ".3mf", None)
    assert (path, tmp, param, note) == (f, None, "Metadata/plate_1.gcode", "")


def test_mehrere_platten_nur_die_gewaehlte_geht_raus(tmp_path):
    f = _3mf(tmp_path / "a.3mf", [1, 2, 3])
    path, tmp, param, note = print_file.upload_plan(f, ".3mf", 2)
    try:
        assert tmp == path and path != f
        assert param == "Metadata/plate_1.gcode"
        with zipfile.ZipFile(path) as z:
            assert z.read("Metadata/plate_1.gcode").startswith(b"; Platte 2")
            assert "Metadata/plate_2.gcode" not in z.namelist()
        assert "Platte 2" in note
    finally:
        os.remove(tmp)


def test_unbekannte_platte_faellt_auf_die_erste_zurueck(tmp_path):
    """Vorher lief die Farm hier ins Umpacken einer Platte, die es nicht gibt."""
    f = _3mf(tmp_path / "a.3mf", [1, 2])
    path, tmp, _, note = print_file.upload_plan(f, ".3mf", 7)
    try:
        with zipfile.ZipFile(path) as z:
            assert z.read("Metadata/plate_1.gcode").startswith(b"; Platte 1")
        assert "Platte 1" in note
    finally:
        os.remove(tmp)


def test_gcode_geht_unveraendert_raus(tmp_path):
    f = tmp_path / "a.gcode"
    f.write_text("G28\n")
    assert print_file.upload_plan(str(f), ".gcode", None) == (str(f), None, "", "")


def test_hoehe_mit_zuschlag(tmp_path):
    kopf = "; layer_height = 0.2\n; total layer number: 100\n; max_z_height: 20.00\n"
    f = _3mf(tmp_path / "a.3mf", [1], header=kopf)
    r = print_file.object_height(f, ".3mf", None, margin_pct=10)
    assert r["max_z_mm"] == 20.0
    assert r["computed_height_mm"] == 22.0      # 100 × 0,2 mm × 1,1


def test_hoehe_unbekannt_ist_null_nicht_fehler(tmp_path):
    f = tmp_path / "leer.gcode"
    f.write_text("; nichts\n")
    assert print_file.object_height(str(f), ".gcode")["computed_height_mm"] == 0.0


def test_filamentverbrauch_der_gedruckten_platte(tmp_path):
    p = tmp_path / "a.3mf"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("Metadata/plate_1.gcode", "; filament used [g] = 5.0\n")
        z.writestr("Metadata/plate_2.gcode", "; filament used [g] = 12.5\n")
    assert print_file.filament_grams(str(p), ".3mf", 2) == 12.5
    assert print_file.filament_grams(str(p), ".3mf") == 5.0
