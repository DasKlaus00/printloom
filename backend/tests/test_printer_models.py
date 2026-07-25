"""Drucker-Modell-Registry: Erkennung aus Modellcode/Klartext/Seriennummer.

Sicherheitsrelevant ist vor allem, dass NICHTS falsch erkannt wird: ein falsch
zugeordnetes Modell würde das falsche Kamera-Protokoll wählen. Lieber "" (dann
probt die Kamera wie vorher) als ein falscher Treffer."""
from app.services import printer_models as pm


def test_ids_sind_eindeutig():
    ids = [m["id"] for m in pm.MODELS]
    assert len(ids) == len(set(ids))


def test_jedes_modell_hat_die_pflichtfelder():
    for m in pm.MODELS:
        assert m["label"] and isinstance(m["label"], str)
        for f in ("camera", "enclosed", "ams", "calibration", "serial_prefixes",
                  "dev_models", "aliases", "series"):
            assert f in m, f"{m['id']} fehlt {f}"
        assert m["camera"] in (pm.RTSP, pm.BAMBU, None)


def test_normalize_eigene_id():
    assert pm.normalize("x1c") == "x1c"
    assert pm.normalize("X1C") == "x1c"
    assert pm.normalize(" p1s ") == "p1s"


def test_normalize_bambu_modellcode():
    """Die Netzwerk-Suche liefert DevModel-Codes, keine Klarnamen."""
    assert pm.normalize("C11") == "p1p"
    assert pm.normalize("C12") == "p1s"
    assert pm.normalize("N1") == "a1mini"
    assert pm.normalize("N2S") == "a1"
    assert pm.normalize("BL-P001") == "x1c"


def test_normalize_klartext():
    assert pm.normalize("Bambu Lab P1S") == "p1s"
    assert pm.normalize("3DPrinter-X1-Carbon") == "x1c"


def test_normalize_laengster_alias_gewinnt():
    """Sonst würde „A1 mini" als „a1" und „X1 Carbon" als „x1" durchgehen."""
    assert pm.normalize("Bambu Lab A1 mini") == "a1mini"
    assert pm.normalize("Bambu Lab A1") == "a1"
    assert pm.normalize("Bambu Lab X1 Carbon") == "x1c"
    assert pm.normalize("Bambu Lab X1E") == "x1e"


def test_normalize_unbekannt_gibt_leer():
    for raw in (None, "", "   ", "Prusa MK4", "irgendwas"):
        assert pm.normalize(raw) == ""


def test_from_serial():
    assert pm.from_serial("00M09A123456") == "x1c"
    assert pm.from_serial("01S00C123456") == "p1s"
    assert pm.from_serial("01P00C123456") == "p1p"
    assert pm.from_serial("03900A123456") == "a1"
    assert pm.from_serial("03000A123456") == "a1mini"
    assert pm.from_serial("00W12345") == "x1"
    assert pm.from_serial("03W12345") == "x1e"


def test_from_serial_unbekannt_und_muell():
    assert pm.from_serial("ZZZ999") == ""
    assert pm.from_serial(None) == ""
    assert pm.from_serial("") == ""
    assert pm.from_serial(123) == ""     # kein Crash bei Nicht-String


def test_camera_backend():
    assert pm.camera_backend("x1c") == "rtsp"
    assert pm.camera_backend("x1e") == "rtsp"
    assert pm.camera_backend("p1s") == "bambu"
    assert pm.camera_backend("a1mini") == "bambu"
    # Unbekanntes/offenes Modell → "" heißt „proben wie bisher", NICHT rtsp raten.
    assert pm.camera_backend("h2d") == ""
    assert pm.camera_backend("other") == ""
    assert pm.camera_backend("") == ""
    assert pm.camera_backend(None) == ""
    assert pm.camera_backend("gibtsnicht") == ""


def test_serien_und_kamera_passen_zusammen():
    """X1-Serie = RTSP, P1/A1 = Bambu-Protokoll. Ein Widerspruch hier wäre der
    Grund für „Kamera geht nicht" beim Nutzer."""
    for m in pm.MODELS:
        if m["series"] == "x1":
            assert m["camera"] == pm.RTSP, m["id"]
        elif m["series"] in ("p1", "a1"):
            assert m["camera"] == pm.BAMBU, m["id"]


def test_capability():
    assert pm.capability("p1s", "enclosed") is True
    assert pm.capability("a1", "enclosed") is False
    assert pm.capability("x1c", "calibration") is True
    assert pm.capability("p1s", "calibration") is False
    assert pm.capability("gibtsnicht", "enclosed", "fallback") == "fallback"


def test_public_list_ohne_interna():
    lst = pm.public_list()
    assert len(lst) == len(pm.MODELS)
    assert all("serial_prefixes" not in e and "aliases" not in e for e in lst)
    assert lst[0]["id"] == "x1c"     # feste Reihenfolge für die Auswahl
