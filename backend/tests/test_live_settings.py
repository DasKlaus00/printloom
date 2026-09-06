"""Einstellungen wirken bei LAUFENDER Farm — und Filament wird mitgezählt.

Bis v1.1.18 nahm `POST /autofarm/start` einen Schnappschuss der Einstellungen; alles
darin war für den ganzen Lauf eingefroren. Wer im Dauerbetrieb die Fehlerstrategie
oder die Betriebszeiten änderte, sah „Gespeichert." — wirksam wurde es erst beim
nächsten Start, und das stand nirgends.

Nachgezogen werden nur ENTSCHEIDUNGSGRUNDLAGEN. Laufzeit-Zustand (Jobs, Greifer,
Fach-Belegung) darf eine Einstellungsänderung nie anfassen — das wäre ein Neustart
mitten im Druck.
"""
import json

import pytest

pytest.importorskip("fastapi")

from app.routers import autofarm as af                # noqa: E402


@pytest.fixture
def settings_file(tmp_path, monkeypatch):
    p = tmp_path / "farm_settings.json"
    monkeypatch.setattr(af, "SETTINGS_PATH", str(p))
    return p


def write(p, **vals):
    p.write_text(json.dumps({**af._DEFAULT_SETTINGS, **vals}), encoding="utf-8")


# ── Nachziehen ──────────────────────────────────────────────────────────────

def test_geaenderte_fehlerstrategie_wirkt_ohne_neustart(settings_file):
    write(settings_file, error_strategy={"print_failed": "eject"})
    af._farm.pop("_settings_mtime", None)
    af._refresh_live_settings()
    assert af._farm["error_strategy"]["print_failed"] == "eject"

    write(settings_file, error_strategy={"print_failed": "pause"})
    af._farm.pop("_settings_mtime", None)     # Datei-Zeitstempel kann gleich sein
    af._refresh_live_settings()
    assert af._farm["error_strategy"]["print_failed"] == "pause"


def test_hms_liste_wird_normalisiert_nachgezogen(settings_file):
    write(settings_file, hms_ignore=["0300-0100-0002-0001"])
    af._farm.pop("_settings_mtime", None)
    af._refresh_live_settings()
    assert af._farm["hms_ignore"]


def test_alle_entscheidungswerte_sind_dabei(settings_file):
    """Ein neuer Wert im Schnappschuss, der hier fehlt, wäre wieder eingefroren —
    ohne dass es jemand merkt."""
    write(settings_file)
    keys = set(af._live_settings(af._DEFAULT_SETTINGS))
    assert keys == {
        "hms_ignore", "conn_alarm", "progress_stall_min", "error_strategy",
        "failed_retries", "operating_hours_enabled", "move_timeout_s",
        "operating_schedule", "operating_tz", "exact_color_only",
    }


def test_laufzeit_zustand_wird_nicht_angefasst(settings_file):
    """Der eigentliche Schutz: Nachziehen darf keine Jobs oder Greifer-Merker ersetzen."""
    write(settings_file)
    af._farm["jobs"] = [{"id": "j1", "status": "printing"}]
    af._farm["arm"] = {"has_plate": True}
    af._farm.pop("_settings_mtime", None)
    af._refresh_live_settings()
    assert af._farm["jobs"] == [{"id": "j1", "status": "printing"}]
    assert af._farm["arm"] == {"has_plate": True}


def test_unveraenderte_datei_wird_nicht_neu_geparst(settings_file):
    """Sonst läge hier ein JSON-Lesevorgang je Schleifendurchlauf."""
    write(settings_file)
    af._farm.pop("_settings_mtime", None)
    af._refresh_live_settings()
    af._farm["error_strategy"] = {"markiert": "ja"}
    af._refresh_live_settings()               # mtime unverändert → kein Neuparsen
    assert af._farm["error_strategy"] == {"markiert": "ja"}


def test_fehlende_datei_laesst_alles_stehen(tmp_path, monkeypatch):
    monkeypatch.setattr(af, "SETTINGS_PATH", str(tmp_path / "gibtsnicht.json"))
    af._farm["error_strategy"] = {"unberuehrt": "ja"}
    af._farm.pop("_settings_mtime", None)
    af._refresh_live_settings()
    assert af._farm["error_strategy"] == {"unberuehrt": "ja"}


# ── Filament in der Statistik ───────────────────────────────────────────────

@pytest.fixture
def stats_file(tmp_path, monkeypatch):
    monkeypatch.setattr(af, "STATS_PATH", str(tmp_path / "farm_stats.json"))
    return tmp_path / "farm_stats.json"


def test_filament_wird_aufsummiert(stats_file):
    af._record_success(60, 0.5, 12.5)
    af._record_success(30, 0.2, 7.5)
    s = af._read_stats()
    assert s["total_filament_g"] == 20.0
    assert s["filament_jobs"] == 2


def test_unbekanntes_filament_wird_nicht_als_null_verbucht(stats_file):
    """None heißt „nicht ermittelbar" (Fremdformat, alter Slicer) — als 0 g verbucht
    sähe eine unvollständige Materialrechnung vollständig aus."""
    af._record_success(60, 0.5, 10.0)
    af._record_success(60, 0.5, None)
    s = af._read_stats()
    assert s["total_filament_g"] == 10.0
    assert s["filament_jobs"] == 1          # nur EIN Job konnte beitragen
    assert s["successful_jobs"] == 2


def test_ohne_filamentangabe_bleibt_die_statistik_gueltig(stats_file):
    af._record_success(60, 0.5)
    s = af._read_stats()
    assert s["total_filament_g"] == 0.0
    assert s.get("filament_jobs", 0) == 0
