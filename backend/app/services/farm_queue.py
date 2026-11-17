"""Warteschlange der Farm: die Datei und reine Operationen (seit v1.1.57).

Schritt 12 des Umbauplans: Die Warteschlange soll EINE Quelle im Backend haben. Bis
v1.1.56 lag sie zweimal vor (im Speicher der laufenden Farm und in farm_queue.json),
und jede Stelle hatte ihre eigenen Regeln. Hier stehen die Regeln einmal, als reine
Funktionen: Sie ändern nichts außer ihrem Rückgabewert, gespeichert wird mit save().
"""
from __future__ import annotations

from typing import Optional

from app.paths import db_path
from app.services import storage

PATH = db_path("farm_queue.json")
# Jobs, an denen gerade gearbeitet wird (Platte unterwegs oder Druck läuft).
ACTIVE = ("running", "sending", "printing")
# Was man aus der Liste nehmen darf. „done" verschwindet, wenn die Platte aus dem
# Regal genommen wird (das Frontend ruft das beim Fach-Leeren).
REMOVABLE = ("pending", "error", "done")
REASON_STOPPED = "Abgebrochen"
REASON_RESTART = "Unterbrochen (Neustart/Update) — Platte prüfen"


def next_id(jobs: list, stored: Optional[int] = None) -> int:
    """Nächste freie ID. Nie unter dem gespeicherten Zähler: Eine ID wird nach dem
    Entfernen nicht wieder vergeben (sonst bezöge sich eine alte Seite auf einen
    anderen Job)."""
    ids = [int(j["id"]) for j in jobs if j.get("id") is not None]
    try:
        stored = int(stored or 0)
    except (TypeError, ValueError):
        stored = 0
    return max(stored, max(ids, default=0) + 1, 1)


def load(path: str = PATH) -> tuple:
    """→ (jobs, next_id). Das Altformat {"jobs": […]} ohne Zähler wird gelesen.
    Fehlt die Datei: leer. Ist sie kaputt: storage.BrokenFile (nie still leeren)."""
    d = storage.read_json_checked(path, {"jobs": []}, expect=dict)
    jobs = [j for j in (d.get("jobs") or []) if isinstance(j, dict)]
    return jobs, next_id(jobs, d.get("next_id"))


def save(jobs: list, next_id_: int, path: str = PATH) -> None:
    storage.write_json(path, {"jobs": jobs, "next_id": int(next_id_)})


def reorder(jobs: list, ids: list) -> list:
    """Wartende Jobs in die gewünschte Reihenfolge; alle anderen bleiben vorn.
    Eine wartende ID, die fehlt (die Seite kannte den Job noch nicht, etwa frisch aus
    dem OrcaSlicer), kommt hinten dran. Bis v1.1.56 fiel sie still aus der Liste.
    Doppelte IDs zählen einmal."""
    pending = {j["id"]: j for j in jobs if j.get("status") == "pending"}
    seen, ordered = set(), []
    for i in ids or []:
        if i in pending and i not in seen:
            seen.add(i)
            ordered.append(pending[i])
    others = [j for j in jobs if j.get("status") != "pending"]
    rest = [j for j in jobs if j.get("status") == "pending" and j["id"] not in seen]
    return others + ordered + rest


def remove(jobs: list, job_id) -> list:
    """Job entfernen. KeyError = unbekannt, ValueError = läuft gerade."""
    job = next((j for j in jobs if j.get("id") == job_id), None)
    if job is None:
        raise KeyError(job_id)
    if job.get("status") not in REMOVABLE:
        raise ValueError(job.get("status"))
    return [j for j in jobs if j.get("id") != job_id]


def reset_failed(jobs: list) -> list:
    """Fehlerhafte Jobs wieder auf „wartet". Fertige NIE (sonst druckt die Farm sie
    ein zweites Mal)."""
    return [{**j, "status": "pending", "progress": 0, "remaining": 0, "reason": ""}
            if j.get("status") == "error" else j for j in jobs]


def _ended(jobs: list, reason: str) -> list:
    out = []
    for j in jobs:
        status = j.get("status")
        if status == "done":
            continue
        if status in ACTIVE:
            # Was mitten im Ablauf war, ist nicht „wartet": Die Platte kann im Drucker
            # oder Greifer liegen. Als Fehler mit Grund, damit es niemand blind neu druckt.
            j = {**j, "status": "error", "reason": reason}
        out.append(j)
    return out


def finalize_after_stop(jobs: list) -> list:
    """Nach dem Stopp: Fertige fallen weg, laufende werden Fehler „Abgebrochen"."""
    return _ended(jobs, REASON_STOPPED)


def recover_after_restart(jobs: list) -> list:
    """Nach Neustart/Update: wie nach dem Stopp, mit eigenem Grund."""
    return _ended(jobs, REASON_RESTART)
