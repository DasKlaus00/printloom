"""Farm-Zeitstempel mit Zeitzone (seit v1.1.72).

Bis v1.1.71 schrieben Historie, Timeline, HMS-Liste, Statistik und Sende-Diagnose
`datetime.now().isoformat()` — Serverzeit ohne Zone. Im Docker (UTC) zeigte der
Browser die Zeiten im Sommer zwei Stunden daneben. Festgehalten wird:
neu Geschriebenes trägt einen Offset, Bestand ohne Offset kommt als Serverzeit mit
Offset heraus, die Timeline verträgt gemischte Einträge, und das Farm-Log steht in
der Zeitzone aus den Einstellungen.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("fastapi")

from app.routers import autofarm as af            # noqa: E402
from app.routers import printer                   # noqa: E402
from app.services import storage                  # noqa: E402
from app.services.timestamps import aware_iso, as_aware, as_aware_iso, now_iso   # noqa: E402


def _hat_offset(ts) -> bool:
    return datetime.fromisoformat(ts).tzinfo is not None


@pytest.fixture
def pfade(tmp_path, monkeypatch):
    for name in ("TIMELINE_PATH", "COMPLETED_PATH", "HMS_PATH", "STATS_PATH", "LOG_PATH"):
        monkeypatch.setattr(af, name, str(tmp_path / f"{name.lower()}.json"))
    return tmp_path


# ── Baustein ────────────────────────────────────────────────────────────────

def test_now_iso_ist_utc_mit_offset():
    ts = now_iso()
    assert ts.endswith("+00:00")
    assert abs(datetime.fromisoformat(ts) - datetime.now(timezone.utc)) < timedelta(seconds=5)


def test_naive_zeit_gilt_als_serverzeit():
    naiv = datetime(2026, 8, 18, 16, 30)
    assert datetime.fromisoformat(aware_iso(naiv)) == naiv.astimezone()
    assert datetime.fromisoformat(as_aware_iso("2026-08-18T16:30:00")) == naiv.astimezone()


def test_vorhandener_offset_bleibt():
    assert as_aware_iso("2026-08-18T18:30:00+02:00") == "2026-08-18T18:30:00+02:00"


@pytest.mark.parametrize("bad", [None, "", "kaputt", 12345])
def test_unbrauchbares_bleibt_wie_es_ist(bad):
    assert as_aware_iso(bad) == bad
    assert as_aware(bad) is None


# ── Schreiben ───────────────────────────────────────────────────────────────

def test_neue_eintraege_tragen_einen_offset(pfade):
    af._record_event("print_start", "teil.3mf")
    af._record_hms("0300_0100_0001_0001", "serious", "Düse verstopft")
    # Der Zyklus übergibt naive datetime (job_started_at = datetime.now())
    start = datetime(2026, 7, 1, 10, 0)
    af._record_completed({"fileId": 3, "fileName": "teil.3mf"}, "done", start, start + timedelta(minutes=42), 42.0)
    af._record_success(print_min=42, kwh=0.3)

    assert _hat_offset(storage.read_json(af.TIMELINE_PATH, [])[-1]["ts"])
    assert _hat_offset(storage.read_json(af.STATS_PATH, {})["since"])
    assert _hat_offset(storage.read_json(af.HMS_PATH, [])[0]["ts"])
    eintrag = storage.read_json(af.COMPLETED_PATH, [])[0]
    assert datetime.fromisoformat(eintrag["started_at"]) == start.astimezone()
    assert datetime.fromisoformat(eintrag["ended_at"]) - datetime.fromisoformat(eintrag["started_at"]) == timedelta(minutes=42)


# ── Lesen: Bestand ohne Offset ──────────────────────────────────────────────

def test_alte_historie_kommt_mit_offset_heraus(pfade):
    storage.write_json(af.COMPLETED_PATH, [{
        "fileId": 1, "fileName": "alt.3mf", "status": "done",
        "started_at": "2026-08-18T16:30:00", "ended_at": "2026-08-18T17:00:00", "duration_min": 30.0,
    }])
    out = asyncio.run(af.get_completed())["items"][0]
    assert datetime.fromisoformat(out["started_at"]) == datetime(2026, 8, 18, 16, 30).astimezone()
    assert _hat_offset(out["ended_at"])
    # gespeichert bleibt, was da war — markiert wird nur beim Lesen
    assert storage.read_json(af.COMPLETED_PATH, [])[0]["started_at"] == "2026-08-18T16:30:00"


def test_alte_hms_und_statistik_kommen_mit_offset_heraus(pfade):
    storage.write_json(af.HMS_PATH, [{"ts": "2026-08-18T16:30:00", "code": "X", "severity": "fatal", "text": ""}])
    storage.write_json(af.STATS_PATH, {"total_jobs": 1, "since": "2026-08-01T08:00:00"})
    assert _hat_offset(asyncio.run(af.get_hms_history())["items"][0]["ts"])
    assert _hat_offset(asyncio.run(af.get_stats())["since"])


def test_timeline_mit_alten_und_neuen_eintraegen(pfade):
    """Naiv gegen aware zu vergleichen wäre ein TypeError — und der wurde nicht gefangen."""
    jetzt = datetime.now()
    storage.write_json(af.TIMELINE_PATH, [
        {"ts": (jetzt - timedelta(hours=48)).isoformat(), "type": "print_done"},   # zu alt
        {"ts": (jetzt - timedelta(hours=2)).isoformat(), "type": "print_start"},   # alt, ohne Offset
        {"ts": now_iso(), "type": "print_done"},                                    # neu, mit Offset
        {"ts": "kaputt", "type": "error"},
        {"type": "error"},
    ])
    r = asyncio.run(af.get_timeline(24))
    assert [e["type"] for e in r["events"]] == ["print_start", "print_done"]
    assert all(_hat_offset(e["ts"]) for e in r["events"])
    assert _hat_offset(r["now"])


def test_sende_diagnose_mit_offset(monkeypatch):
    monkeypatch.setattr(printer, "_diag_sessions", [{"ts": "2026-11-17 23:44:00", "file": "a.3mf", "steps": []}])
    out = asyncio.run(printer.get_send_diagnostics())["sessions"][0]
    assert datetime.fromisoformat(out["ts"]) == datetime(2026, 11, 17, 23, 44).astimezone()
    sess = printer._diag_begin("b.3mf", 2)
    assert _hat_offset(sess["ts"])


# ── Farm-Log in der Zeitzone des Nutzers ────────────────────────────────────

def test_farm_log_in_der_zeitzone_aus_den_einstellungen(pfade, monkeypatch):
    zoneinfo = pytest.importorskip("zoneinfo")
    try:
        zoneinfo.ZoneInfo("Europe/Berlin")
    except Exception:
        pytest.skip("keine Zeitzonen-Daten")

    class Fest(datetime):
        @classmethod
        def now(cls, tz=None):
            basis = datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc)   # Sommer: Berlin = UTC+2
            return basis.astimezone(tz) if tz else basis.replace(tzinfo=None)

    settings = pfade / "farm_settings.json"
    settings.write_text(json.dumps({"timezone": "Europe/Berlin"}), encoding="utf-8")
    monkeypatch.setattr(af, "SETTINGS_PATH", str(settings))
    monkeypatch.setitem(af._USER_TZ, "mtime", None)
    monkeypatch.setitem(af._farm, "log", [])
    monkeypatch.setattr(af, "datetime", Fest)

    af._log("Test")
    assert af._farm["log"][0] == "12:00:00 — Test"
    assert (pfade / "log_path.json").read_text(encoding="utf-8").startswith("2026-07-01 12:00:00 — Test")


def test_farm_log_ohne_zeitzone_nimmt_serverzeit(pfade, monkeypatch):
    settings = pfade / "farm_settings.json"
    settings.write_text(json.dumps({"timezone": ""}), encoding="utf-8")
    monkeypatch.setattr(af, "SETTINGS_PATH", str(settings))
    monkeypatch.setitem(af._USER_TZ, "mtime", None)
    monkeypatch.setitem(af._farm, "log", [])
    vorher = datetime.now().replace(microsecond=0)
    af._log("Ohne Zone")
    zeit = datetime.strptime(af._farm["log"][0].split(" — ")[0], "%H:%M:%S").time()
    assert abs(datetime.combine(vorher.date(), zeit) - vorher) < timedelta(seconds=5)
