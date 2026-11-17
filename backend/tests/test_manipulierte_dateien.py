"""Manipulierte Dateien richten nichts an (seit v1.1.63, Umbauplan Schritt 16).

- Zip-Einträge werden nie unbegrenzt in den Speicher gelesen (gefälschte Größe hilft nicht).
- Eine Zip-Bombe wird beim Upload abgelehnt, die Datei gelöscht, nichts eingetragen.
- Der Dateiname auf dem Drucker hat immer die geprüfte Endung.
- Profil-Links sind nur http(s).
"""
import io
import zipfile

import pytest

from app.services import print_file, profiles


def _zip(path, eintraege):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in eintraege.items():
            z.writestr(name, data)
    return path


# ── Zip-Einträge begrenzt lesen ──────────────────────────────────────────────

def test_zu_grosser_eintrag_wird_nicht_gelesen(tmp_path):
    p = _zip(tmp_path / "a.3mf", {"Metadata/slice_info.config": b"x" * 2000})
    with zipfile.ZipFile(p) as zf:
        with pytest.raises(ValueError):
            print_file.read_member(zf, "Metadata/slice_info.config", 1000)
        assert print_file.read_member(zf, "Metadata/slice_info.config", 5000) == b"x" * 2000


def test_gefaelschte_groesse_hilft_nicht(tmp_path, monkeypatch):
    p = _zip(tmp_path / "a.3mf", {"Metadata/slice_info.config": b"y" * 5000})
    with zipfile.ZipFile(p) as zf:
        zf.getinfo("Metadata/slice_info.config").file_size = 10   # Angabe gefälscht
        # Nie mehr als die Grenze: zipfile bricht an der (falschen) Angabe mit CRC-Fehler ab.
        with pytest.raises((ValueError, zipfile.BadZipFile)):
            print_file.read_member(zf, "Metadata/slice_info.config", 1000)


def test_kaputte_plattennamen_sind_nur_leer(tmp_path, monkeypatch):
    monkeypatch.setattr(print_file, "MAX_META_BYTES", 10)
    p = _zip(tmp_path / "a.3mf", {"Metadata/model_settings.config": b"<config>" + b" " * 100 + b"</config>"})
    with zipfile.ZipFile(p) as zf:
        assert print_file.plate_names(zf) == {}


# ── Zip-Bombe beim Upload ────────────────────────────────────────────────────

def test_stark_gepackter_eintrag_ist_eine_bombe(tmp_path):
    p = _zip(tmp_path / "bombe.3mf", {"Metadata/plate_1.gcode": b"\0" * (5 * 1024 * 1024)})
    with pytest.raises(ValueError, match="stark gepackt"):
        print_file.zip_guard(p)


def test_normale_druckdatei_geht_durch(tmp_path):
    gcode = "".join(f"G1 X{i % 200} Y{(i * 7) % 200} Z{i / 1000:.3f} E{i * 0.01:.2f}\n" for i in range(20000))
    p = _zip(tmp_path / "ok.3mf", {"Metadata/plate_1.gcode": gcode})
    print_file.zip_guard(p)


def test_kein_zip_ist_kein_fall(tmp_path):
    g = tmp_path / "teil.gcode"
    g.write_text("G1 X1\n", encoding="utf-8")
    print_file.zip_guard(g)


def test_bombe_im_upload_wird_geloescht_und_nicht_eingetragen(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from app.main import app
    from app.routers import files
    monkeypatch.setattr(files, "UPLOAD_DIR", tmp_path)
    eingetragen = []
    monkeypatch.setattr(files, "register_upload", lambda *a, **kw: eingetragen.append(a))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Metadata/plate_1.gcode", b"\0" * (5 * 1024 * 1024))
    r = TestClient(app).post("/api/files/upload",
                             files={"file": ("bombe.3mf", buf.getvalue(), "application/octet-stream")})
    assert r.status_code == 400 and eingetragen == []
    assert list(tmp_path.iterdir()) == []


# ── Dateiname auf dem Drucker ────────────────────────────────────────────────

@pytest.mark.parametrize("name,typ,erwartet", [
    ("teil", ".3mf", "teil.3mf"),
    ("x.exe", ".3mf", "x_exe.3mf"),
    ("a/../b.3mf", ".3mf", "b.3mf"),
    ("Halter.gcode.3mf", ".3mf", "Halter_gcode.3mf"),     # wie bisher
    ("Deckel V2.gcode", ".gcode", "Deckel_V2.gcode"),
])
def test_druckname_hat_die_gepruefte_endung(name, typ, erwartet):
    assert print_file.make_print_name(name, typ) == erwartet


def test_druckname_ohne_druckformat_wird_abgelehnt():
    with pytest.raises(ValueError):
        print_file.make_print_name("teil.stl", ".stl")


# ── Profil-Links ─────────────────────────────────────────────────────────────

def test_profil_links_nur_http():
    out = profiles.clean_components([
        {"name": "Greifer", "url": "javascript:alert(1)"},
        {"name": "Halter", "url": "https://example.org/halter"},
        {"name": "Bild", "url": "data:text/html,x"},
        "kein Objekt",
    ])
    assert [c.get("url") for c in out] == [None, "https://example.org/halter", None]
    assert [c["name"] for c in out] == ["Greifer", "Halter", "Bild"]
