"""OTTOeject-Geometrie (Drucker-Tab): EINE Datei, gespeichert mit Revision.

Bis v1.1.51 schrieben Drucker-Tab, Setup-Assistent und Erstkalibrierung jeweils ihre
ganze Kopie zurück. War eine Seite schon länger offen, überschrieb sie neuere
Positionen mit ihrer alten Kopie (etwa den eben im Setup geänderten Fach-Abstand).
Jetzt nennt jeder Lesevorgang die Revision, und gespeichert wird nur, wenn die Datei
noch genau diesen Stand hat (If-Match); sonst 409 mit dem aktuellen Stand.
"""
from typing import Optional

from app.paths import db_path
from app.services import storage

PATH = db_path("ottoeject_geometry.json")


def load_raw(path: str = None) -> Optional[dict]:
    """Die gespeicherte Datei (ohne Vorgaben). Kaputt → storage.BrokenFile."""
    return storage.read_json_checked(path or PATH, None, expect=dict)


def revision(raw) -> str:
    return storage.etag(raw)


def save(data: dict, if_match: str, path: str = None) -> str:
    """Nur schreiben, wenn die Datei noch Revision `if_match` hat. → neue Revision.
    storage.Conflict, wenn sie sich inzwischen geändert hat."""
    return storage.write_json_if(path or PATH, data, if_match)


# Positionsfelder, die eine Zahl sein MÜSSEN, wenn sie vorkommen. Ein leeres Feld
# war bis v1.1.51 im Drucker-Tab die Koordinate 0 (der Arm fuhr auf X=0).
_POS_KEYS = ("x", "y", "z")


def invalid_positions(g: dict) -> list:
    """Pfade der Positionsfelder ohne Zahl, z. B. 'printers[0].eject.x'."""
    bad = []

    def num_ok(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool)

    for i, p in enumerate(g.get("printers") or []):
        if not isinstance(p, dict):
            continue
        for k in ("eject", "load", "move"):
            o = p.get(k)
            if isinstance(o, dict):
                bad += [f"printers[{i}].{k}.{a}" for a in _POS_KEYS if a in o and not num_ok(o[a])]
        door = p.get("door")
        if isinstance(door, dict):
            for s in ("open", "close"):
                o = door.get(s)
                if isinstance(o, dict):
                    bad += [f"printers[{i}].door.{s}.{a}" for a in _POS_KEYS if a in o and not num_ok(o[a])]
    for r, o in (g.get("rack_geo") or {}).items():
        if isinstance(o, dict):
            bad += [f"rack_geo[{r}].{a}" for a in ("x", "first_z", "slot_gap") if a in o and not num_ok(o[a])]
    return bad
