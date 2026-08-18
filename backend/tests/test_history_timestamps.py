"""Zeitstempel der Druck-Historie: UTC nur MIT Marker.

`datetime.utcnow().isoformat()` liefert "2026-08-18T16:30:00" — UTC, aber ohne
Zeitzonen-Angabe. Der Browser liest das als LOKALE Zeit, im Sommer also zwei Stunden
zu früh. Alles andere in Printloom schreibt lokale Zeit; damit lagen zwei
Konventionen in einer App und es war Zufall, welche Ansicht richtig anzeigte.

Hier wird beides festgehalten: neu geschriebene Stempel tragen einen Marker, und
Bestandseinträge OHNE Marker bekommen ihn beim Lesen nachgetragen (sie waren UTC).
"""
from datetime import datetime, timezone

import pytest

pytest.importorskip("fastapi")

from app.routers import printer                       # noqa: E402


# ── Nachtragen beim Lesen ───────────────────────────────────────────────────

def test_alter_eintrag_ohne_marker_wird_als_utc_gelesen():
    assert printer._utc_marked("2026-08-18T16:30:00") == "2026-08-18T16:30:00+00:00"


def test_ein_vorhandener_offset_bleibt_unangetastet():
    assert printer._utc_marked("2026-08-18T18:30:00+02:00") == "2026-08-18T18:30:00+02:00"


def test_ein_negativer_offset_bleibt_unangetastet():
    """Der Marker darf nicht an der Bindestrich-Prüfung des DATUMS scheitern."""
    assert printer._utc_marked("2026-08-18T12:30:00-05:00") == "2026-08-18T12:30:00-05:00"


def test_z_gilt_als_marker():
    assert printer._utc_marked("2026-08-18T16:30:00Z") == "2026-08-18T16:30:00Z"


def test_mikrosekunden_stoeren_nicht():
    assert printer._utc_marked("2026-08-18T16:30:00.123456") == "2026-08-18T16:30:00.123456+00:00"


@pytest.mark.parametrize("bad", [None, "", 12345, {}])
def test_unbrauchbare_werte_bleiben_wie_sie_sind(bad):
    """Kaputte Bestandsdaten dürfen das Auslesen der Historie nicht sprengen."""
    assert printer._utc_marked(bad) == bad


# ── Eindeutigkeit ───────────────────────────────────────────────────────────

def test_ein_markierter_stempel_meint_denselben_augenblick():
    """Der Kern: mit Marker gelesen ergibt derselbe Text denselben Zeitpunkt —
    ohne Marker wäre er um den lokalen Versatz verschoben."""
    naiv = "2026-08-18T16:30:00"
    a = datetime.fromisoformat(printer._utc_marked(naiv))
    assert a == datetime(2026, 8, 18, 16, 30, tzinfo=timezone.utc)


def test_die_historie_gibt_markierte_stempel_heraus(tmp_path, monkeypatch):
    """Ende zu Ende: geschrieben wird mit Marker, gelesen mit Marker."""
    monkeypatch.setattr(printer, "HISTORY_PATH", str(tmp_path / "print_history.json"))
    printer._append_history({"ts": datetime.now(timezone.utc).isoformat(), "state": "FINISH"})
    printer._append_history({"ts": "2026-01-01T10:00:00", "state": "FAILED"})   # Altbestand
    items = printer.get_history()["items"]
    assert len(items) == 2
    for it in items:
        assert datetime.fromisoformat(it["ts"]).tzinfo is not None
