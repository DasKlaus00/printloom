"""Was die App reaktionsfähig hält — geprüft, damit es nicht zurückfällt.

Hintergrund: Printloom läuft in EINEM uvicorn-Prozess. Alles, was in einem
`async def`-Endpunkt blockiert, blockiert damit ALLE anderen Requests gleichzeitig —
auch die ausgelieferten JS-Chunks und /api/health. Genau daher kam „die Seite lädt
manchmal nicht, ich muss neu laden oder lange warten": beim Öffnen der Datei-
Bibliothek liefen pro Datei Thumbnail + quick-meta + Crash-Check los, und die lasen
alle im Event-Loop in großen .3mf-Archiven.

Die Tests hier halten die zwei Regeln fest, die das verhindern:
  1. Datei-lastige Endpunkte sind SYNCHRON (`def`) → FastAPI führt sie im Threadpool
     aus, der Event-Loop bleibt frei.
  2. Teure Vollscans werden gecacht — auch über einen Neustart hinweg.
"""
import inspect

import pytest

pytest.importorskip("fastapi")

from app.routers import files as files_router     # noqa: E402
from app.routers import printer as printer_router  # noqa: E402


# ── 1. Kein Datei-Zugriff im Event-Loop ──────────────────────────────────────

# Diese Endpunkte öffnen ZIP-Archive oder lesen G-code. Als `async def` liefen sie
# direkt im Event-Loop und legten damit den ganzen Server für ihre Dauer still.
BLOCKING_ENDPOINTS = [
    (files_router, "get_thumbnail"),
    (files_router, "get_quick_meta"),
    (files_router, "get_plates_meta"),
    (files_router, "get_file_ams_info"),
    (files_router, "deep_analyze_file"),
    (files_router, "crash_check"),
    (printer_router, "list_file_plates"),
]


@pytest.mark.parametrize("module,name", BLOCKING_ENDPOINTS,
                         ids=[n for _, n in BLOCKING_ENDPOINTS])
def test_datei_endpunkte_laufen_im_threadpool(module, name):
    fn = getattr(module, name)
    assert not inspect.iscoroutinefunction(fn), (
        f"{name} liest Dateien und muss `def` bleiben (Threadpool). Als `async def` "
        f"blockiert es den Event-Loop und die ganze App wird währenddessen zäh.")


def test_gleichzeitige_vollscans_sind_begrenzt():
    """Ein Crash-Check ist reine Python-Arbeit über Millionen G-code-Zeilen. Ohne
    Begrenzung streiten N Bibliothekszeilen um den GIL und hungern den Event-Loop
    aus — dann ist auch der Threadpool keine Rettung mehr."""
    assert files_router._HEAVY_SCAN._initial_value <= 4


# ── 2. Teure Ergebnisse überleben den Neustart ───────────────────────────────

def _seed_cache(monkeypatch, tmp_path, gcode_path):
    monkeypatch.setattr(files_router, "_crash_cache_file", lambda: tmp_path / "crash_cache.json")
    files_router._CRASH_CACHE.clear()
    sig = files_router._qmeta_sig(str(gcode_path))
    files_router._CRASH_CACHE[(7, None, 256.0)] = (sig, {"crash_risk": True, "max_z_mm": 42.0})
    files_router._save_crash_cache()
    return sig


def test_crash_cache_ueberlebt_den_neustart(tmp_path, monkeypatch):
    gcode = tmp_path / "teil.gcode"
    gcode.write_text("G1 X5 Z40\n", encoding="utf-8")
    sig = _seed_cache(monkeypatch, tmp_path, gcode)

    files_router._CRASH_CACHE.clear()          # „Neustart"
    files_router._load_crash_cache()

    assert files_router._CRASH_CACHE[(7, None, 256.0)] == (sig, {"crash_risk": True, "max_z_mm": 42.0})


def test_crash_cache_verfaellt_wenn_die_datei_sich_aendert(tmp_path, monkeypatch):
    """Die Signatur (Pfad/Größe/mtime) bleibt maßgeblich — ein geladener Eintrag
    darf niemals ein VERALTETES Ergebnis liefern."""
    gcode = tmp_path / "teil.gcode"
    gcode.write_text("G1 X5 Z40\n", encoding="utf-8")
    sig = _seed_cache(monkeypatch, tmp_path, gcode)

    gcode.write_text("G1 X5 Z40\nG1 X250 Z90\n", encoding="utf-8")   # Datei ausgetauscht
    files_router._CRASH_CACHE.clear()
    files_router._load_crash_cache()

    geladen = files_router._CRASH_CACHE.get((7, None, 256.0))
    assert geladen is not None                                  # Eintrag ist noch da…
    assert geladen[0] != files_router._qmeta_sig(str(gcode))     # …gilt aber nicht mehr
    assert geladen[0] == sig


def test_crash_cache_vergisst_geloeschte_dateien(tmp_path, monkeypatch):
    gcode = tmp_path / "teil.gcode"
    gcode.write_text("G1 X5 Z40\n", encoding="utf-8")
    _seed_cache(monkeypatch, tmp_path, gcode)

    gcode.unlink()
    files_router._CRASH_CACHE.clear()
    files_router._load_crash_cache()

    assert (7, None, 256.0) not in files_router._CRASH_CACHE


def test_thumbnail_bekommt_browser_cache():
    """Ohne Cache-Control holt der Browser bei JEDEM Öffnen der Bibliothek alle
    Vorschaubilder neu — und jedes davon ist ein ZIP-Zugriff."""
    resp = files_router._png(b"\x89PNG\r\n\x1a\n")
    assert resp.media_type == "image/png"
    assert "max-age" in resp.headers.get("cache-control", "")


# ── 3. Upload landet stückweise auf der Platte ───────────────────────────────

def test_upload_wird_stueckweise_geschrieben(tmp_path):
    """Vorher wurde die ganze Datei in den RAM gelesen und dann synchron im
    Event-Loop geschrieben. `_save_upload` liest in Blöcken und läuft im Threadpool."""
    import io
    daten = b"x" * (files_router._UPLOAD_CHUNK * 2 + 123)
    ziel = tmp_path / "hochgeladen.3mf"

    groesse = files_router._save_upload(io.BytesIO(daten), ziel)

    assert groesse == len(daten)
    assert ziel.read_bytes() == daten


def test_upload_liest_von_vorne(tmp_path):
    """Der Upload-Strom steht nach dem Einlesen durch Starlette am Ende — ohne
    seek(0) landete eine leere Datei auf der Platte."""
    import io
    quelle = io.BytesIO(b"3MF-Inhalt")
    quelle.read()                                   # Position ist jetzt am Ende
    ziel = tmp_path / "hochgeladen.3mf"

    assert files_router._save_upload(quelle, ziel) == len(b"3MF-Inhalt")
    assert ziel.read_bytes() == b"3MF-Inhalt"
