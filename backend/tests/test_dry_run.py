"""Trockenlauf: die Sequenz durchspielen, ohne etwas zu senden.

Sinn der Sache ist, dass man VOR dem ersten echten Lauf sieht, wohin der Arm
fahren würde. Deshalb ist der wichtigste Test hier: es geht wirklich nichts an
die Hardware raus — weder an Klipper noch an den Drucker."""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers import autofarm  # noqa: E402
from app.services import storage  # noqa: E402

SEQ = {
    "seq_new": [
        {"id": 1, "type": "macro", "value": "OTTOEJECT_HOME", "label": "Homen"},
        {"id": 2, "type": "app_op", "value": "grab_magazine", "label": "Aus Magazin holen"},
    ],
    "seq_next": [
        {"id": 1, "type": "app_op", "value": "grab_magazine", "label": "Aus Magazin holen"},
        {"id": 2, "type": "app_op", "value": "place", "label": "Platte einlegen"},
        {"id": 3, "type": "wait_print", "value": "", "label": "Auf Druckende warten"},
        {"id": 4, "type": "app_op", "value": "eject", "label": "Auswerfen"},
        {"id": 5, "type": "app_op", "value": "store", "label": "Platte ablegen"},
        {"id": 6, "type": "delay", "value": "", "seconds": 5, "label": "Warten"},
    ],
}


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Regal + Sequenz + Geometrie in einem eigenen Ordner; alle Ausgänge blockiert."""
    slots = {f"1-{s}": {"status": "free"} for s in range(1, 8)}
    storage.write_json(str(tmp_path / "rack.json"), {
        "num_racks": 1, "slots_per_rack": 6, "slot_height_mm": 50,
        "magazine_slot": 7, "magazine_counts": [4], "magazine_defaults": [4],
        "slots": slots,
    })
    storage.write_json(str(tmp_path / "seq.json"), SEQ)
    monkeypatch.setattr(autofarm, "SLOTS_PATH", str(tmp_path / "rack.json"))
    monkeypatch.setattr(autofarm, "SEQ_PATH", str(tmp_path / "seq.json"))
    monkeypatch.setitem(autofarm._farm, "jobs", [])

    # Jeder Weg nach draußen wird zur Fehlermeldung — schlägt der Trockenlauf
    # zu, fliegt der Test.
    async def _boom(*a, **kw):
        raise AssertionError("Trockenlauf hat etwas gesendet!")

    monkeypatch.setattr(autofarm, "_do_macro", _boom)
    monkeypatch.setattr(autofarm, "_do_bambu_gcode", _boom)
    return tmp_path


def _run(**body):
    return asyncio.run(autofarm.dry_run(body))


def test_sendet_nichts(store):
    """Der Kern: kein Aufruf an Klipper oder Drucker (siehe _boom in der Fixture)."""
    r = _run()
    assert r["success"] is True
    assert len(r["steps"]) == 8          # 2 aus seq_new + 6 aus seq_next


def test_zeigt_quelle_und_ziel(store):
    r = _run()
    assert r["start"]["source"] == "R1 Fach 7"      # Magazin-Fach
    assert r["start"]["from_magazine"] is True
    assert r["start"]["target_slot"] == "1-1"       # unterstes freies Fach
    assert r["start"]["plates_available"] == 4


def test_schritte_tragen_ihr_ziel(store):
    steps = {s["label"]: s for s in _run()["steps"]}
    assert steps["Aus Magazin holen"]["target"] == "R1 Fach 7"
    assert steps["Platte ablegen"]["target"] == "R1 Fach 1"
    assert steps["Warten"]["target"] == "5 s"


def test_bewegungen_bekommen_gcode(store):
    steps = {s["label"]: s for s in _run()["steps"]}
    assert "G1" in steps["Auswerfen"]["script"]
    # Ein Geräte-Macro erzeugt keinen Printloom-G-code (solange use_gcode aus ist).
    assert steps["Homen"]["script"] == ""


def test_achsfehler_werden_gemeldet(store, monkeypatch):
    """Eine Position außerhalb der Achse muss im Trockenlauf auffallen — genau
    dafür macht man ihn."""
    geom = autofarm._motion.merge_defaults({
        "printer": {"eject": {"x": 4250, "y": 319, "z": 21}},
        "machine_limits": {"x": 485, "y": 407, "z": 365},
    })
    monkeypatch.setattr(autofarm, "_load_farm_geometry", lambda: geom)
    r = _run()
    assert r["errors"], "Achsfehler nicht gemeldet"
    assert any("485" in e["message"] for e in r["errors"])


def test_ohne_platten_kommt_ein_hinweis(store):
    d = storage.read_json(str(store / "rack.json"))
    d["magazine_counts"] = [0]
    storage.write_json(str(store / "rack.json"), d)
    assert any("leere" in w.lower() or "platten" in w.lower() for w in _run()["warnings"])


def test_volles_regal_meldet_kein_fach(store):
    d = storage.read_json(str(store / "rack.json"))
    for s in range(1, 7):
        d["slots"][f"1-{s}"]["status"] = "done"
    storage.write_json(str(store / "rack.json"), d)
    r = _run()
    assert r["start"]["target_slot"] == ""
    assert any("Fach" in w for w in r["warnings"])


def test_nur_eine_sequenz(store):
    assert len(_run(which="seq_new")["steps"]) == 2
    assert len(_run(which="seq_next")["steps"]) == 6


def test_ohne_magazin_wird_der_magazin_griff_umgedeutet(store):
    """Ohne Magazin gibt es keinen Stapel — der Griff geht ins markierte Fach."""
    d = storage.read_json(str(store / "rack.json"))
    d["magazine_slot"] = 0
    d["empty_plates_migrated"] = True
    d["slots"]["1-4"]["empty_plate"] = True
    storage.write_json(str(store / "rack.json"), d)
    r = _run(which="seq_next")
    grab = next(s for s in r["steps"] if s["label"] == "Aus Magazin holen")
    assert grab["target"] == "R1 Fach 4"
    assert "kein Magazin" in grab["note"]


def test_leere_sequenz_meldet_es(store):
    storage.write_json(str(store / "seq.json"), {"seq_new": [], "seq_next": []})
    r = _run()
    assert r["steps"] == []
    assert any("Schritte" in w for w in r["warnings"])
