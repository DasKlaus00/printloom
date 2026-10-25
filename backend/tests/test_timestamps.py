"""Zeitstempel, die den Server verlassen, müssen ihre Zeitzone MITBRINGEN.

In der Datenbank steht `uploaded_at` ohne Zeitzone (Column-Default
`datetime.utcnow`), ist aber UTC. Ginge es unmarkiert raus, läse JavaScript
`new Date("2026-08-03T18:14:55")` als ORTSZEIT — die Datei-Bibliothek zeigte dann
im Sommer 18:14 statt 20:14. Deshalb hängt die Serialisierung den UTC-Offset an;
das stimmt auch für alle längst gespeicherten Einträge, die stehen ja schon in UTC.
"""
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("fastapi")

from app.schemas.schemas import FileUploadResponse    # noqa: E402


def _datei(**kw):
    daten = dict(id=1, filename="a.3mf", original_filename="Teil.3mf",
                 file_type=".3mf", file_size=123,
                 uploaded_at=datetime(2026, 8, 3, 18, 14, 55))
    daten.update(kw)
    return FileUploadResponse(**daten)


def test_zeitstempel_traegt_die_zeitzone_mit():
    roh = _datei().model_dump(mode="json")["uploaded_at"]
    assert roh.endswith("Z") or "+00:00" in roh, (
        f"{roh!r} hat keine Zeitzone — der Browser liest das als Ortszeit und "
        f"zeigt die falsche Uhrzeit an.")


def test_die_uhrzeit_selbst_bleibt_unveraendert():
    """Nur KENNZEICHNEN, nicht umrechnen: der gespeicherte Wert ist bereits UTC."""
    wert = _datei().model_dump()["uploaded_at"]
    assert wert.utcoffset() == timedelta(0)
    assert (wert.hour, wert.minute, wert.second) == (18, 14, 55)


def test_bereits_gekennzeichnete_zeit_bleibt_wie_sie_ist():
    """Falls ein Feld später mal zeitzonenbewusst gespeichert wird, darf ihm
    nicht nachträglich UTC übergestülpt werden."""
    berlin = timezone(timedelta(hours=2))
    wert = _datei(uploaded_at=datetime(2026, 8, 3, 20, 14, 55, tzinfo=berlin)) \
        .model_dump()["uploaded_at"]
    assert wert.utcoffset() == timedelta(hours=2)
    assert wert.hour == 20
