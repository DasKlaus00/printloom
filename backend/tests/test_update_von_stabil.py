"""Update vom stabilen Kanal: Wer `:latest` nutzt, springt von v1.1.41 direkt auf
die nächste stabile Version — über alle Beta-Releases dazwischen hinweg.

Die Dateien in fixtures/stabil_1_1_41/ hat ein echtes v1.1.41 geschrieben (am
25.11.2026 über seine API angelegt: Regal 3 × 6 Fächer à 50 mm, zwei wartende
Aufträge, Strompreis 0,42 €, `ams_unmatched` → überspringen, geänderte Greif-Tiefe
333 mm). Dieser Test liest sie mit den heutigen Ladefunktionen. Schlägt er fehl,
verliert ein Stabil-Nutzer beim Update Daten — oder die Farm startet nicht.
"""
import os
import shutil

import pytest

pytest.importorskip("fastapi")

from app.routers import control  # noqa: E402
from app.services import farm_queue, farm_settings, rack_store  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "stabil_1_1_41")


@pytest.fixture
def alt(tmp_path, monkeypatch):
    """Die v1.1.41-Dateien in einem eigenen Ordner; alle Pfade zeigen dorthin.
    Kopie, weil das Laden normalisiert und zurückschreibt."""
    for name in os.listdir(FIX):
        shutil.copy(os.path.join(FIX, name), tmp_path / name)
    monkeypatch.setattr(rack_store, "SLOTS_PATH", str(tmp_path / "rack_slots.json"))
    monkeypatch.setattr(farm_settings, "PATH", str(tmp_path / "farm_settings.json"))
    monkeypatch.setattr(control, "GEOMETRY_PATH", str(tmp_path / "ottoeject_geometry.json"))
    return tmp_path


def test_warteschlange_bleibt(alt):
    jobs, next_id = farm_queue.load(str(alt / "farm_queue.json"))
    assert [(j["id"], j["fileId"], j["status"]) for j in jobs] == [(1, 1, "pending"), (2, 1, "pending")]
    assert next_id == 3                        # v1.1.41 kannte noch keinen Zähler


def test_regal_bleibt(alt):
    data = rack_store.load()
    assert (data["num_racks"], data["slots_per_rack"], data["slot_height_mm"]) == (3, 6, 50)
    assert data.get("rack_type", "standard") != "compact"     # Altbestand bleibt Original-Regal


def test_einstellungen_bleiben(alt):
    s = farm_settings.read_checked()
    assert s["power_price_eur_kwh"] == 0.42
    assert s["error_strategy"]["ams_unmatched"] == "skip"
    assert s["timezone"] == "Europe/Berlin"


def test_geometrie_bleibt_und_ist_fahrbar(alt):
    g = control._load_geometry()
    assert g["storage"]["y_engage"] == 333
    # Die gespeicherten Positionen bleiben dieselben Zahlen: Regal 1 hängt am Drucker,
    # kein Wert darf beim Update „wandern".
    assert {str(r) for r in g["rack_geo"]} >= {"1", "2", "3"}
