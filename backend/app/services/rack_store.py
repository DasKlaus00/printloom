"""Regal-Zustand (`rack_slots.json`) — EINE Stelle zum Lesen und Schreiben.

Was drinsteht: Regal- und Fachzahl, Fachhöhe, Magazin-Fach und -Bestand, und je
Fach der Zustand (frei / druckt / fertig / gesperrt, Objekthöhe, Leerplatten-Marke).

Warum ein eigenes Modul: Bis v1.1.34 lasen und schrieben die Regalverwaltung
(Oberfläche) und die Farm die Datei unabhängig voneinander — die Farm an acht
Stellen roh mit `open()`, ohne die Normalisierung der Regalverwaltung. Jede
Änderung war „lesen, ändern, schreiben"; liefen zwei davon gleichzeitig (der
Nutzer räumt ein Fach, während die Farm ein anderes reserviert), gewann die
zweite und die erste war verloren. Das hier serialisiert solche Änderungen über
eine Sperre (`edit()`), und alle sehen dieselbe, normalisierte Fassung.
"""
from __future__ import annotations

import logging
import os
import threading
from contextlib import contextmanager

from app.paths import db_path
from app.services import rack_logic, storage
from app.services.rack_logic import DEFAULT_SLOT_TOLERANCE_MM, DEFAULT_STACKED_PCT

logger = logging.getLogger(__name__)

SLOTS_PATH = db_path("rack_slots.json")

DEFAULT_NUM_RACKS = 3
DEFAULT_SLOTS_PER_RACK = 6
DEFAULT_SLOT_H = 50
DEFAULT_MAGAZINE_SLOT = 7
# Fest konfigurierte Platten pro Magazin (je Rack) — die „Sollzahl". `magazine_counts`
# ist der LIVE-Bestand (sinkt beim Drucken, steigt beim Entnehmen), `magazine_defaults`
# ist der in den Einstellungen fest gesetzte Ausgangswert, auf den ein Reset zurückgeht
# und der die Magazin-Obergrenze (Badge-Nenner + Auffüll-Deckel) bildet.
DEFAULT_MAGAZINE_DEFAULT = 4

# Reentrant: load() speichert bei einer Migration selbst — innerhalb von edit().
_lock = threading.RLock()


def default_slot() -> dict:
    # `empty_plate`: In diesem Fach liegt eine LEERE Druckplatte als Nachschub.
    # Nur im Aufbau OHNE Magazin („alle Fächer = Lagerfächer") relevant — dort
    # markiert der Nutzer selbst, welche Fächer bestückt sind. Das Fach zählt
    # dann als physisch belegt, obwohl der Status „free" ist.
    return {"status": "free", "file_id": None, "file_name": None,
            "object_height_mm": None, "note": "", "empty_plate": False}


def default_data(num_racks=DEFAULT_NUM_RACKS, slots_per_rack=DEFAULT_SLOTS_PER_RACK) -> dict:
    return {
        "num_racks":         num_racks,
        "slots_per_rack":    slots_per_rack,
        "slot_height_mm":    DEFAULT_SLOT_H,
        "slot_tolerance_mm": DEFAULT_SLOT_TOLERANCE_MM,
        "slot_stacked_pct":  DEFAULT_STACKED_PCT,
        "stack_rack":        1,
        "stack_slot":        DEFAULT_MAGAZINE_SLOT,
        "magazine_slot":     DEFAULT_MAGAZINE_SLOT,
        "magazine_defaults": [DEFAULT_MAGAZINE_DEFAULT] * num_racks,
        "magazine_counts":   [DEFAULT_MAGAZINE_DEFAULT] * num_racks,
        "max_plates":        4,
        "slots": {f"{r}-{s}": default_slot()
                  for r in range(1, num_racks + 1) for s in range(1, slots_per_rack + 1)},
    }


def _migrate_empty_plates(data: dict) -> bool:
    """Aufbau OHNE Magazin: aus dem alten Zähler einmalig Fach-Markierungen machen.

    Bis v1.0.162 war nur bekannt, WIE VIELE leere Platten in einem Regal liegen —
    welche Fächer das sind, wurde geraten („die untersten n"). Seit v1.0.163 steht
    es am Fach (`empty_plate`). Damit ein bestehender Aufbau nach dem Update nicht
    plötzlich „keine Platten" meldet, wird die alte Annahme einmal übernommen.
    Danach ist der Nutzer die Quelle der Wahrheit — es wird nie wieder überschrieben.
    Der Merker `empty_plates_migrated` MUSS mitgespeichert werden, sonst würden die
    Markierungen nach dem Griff der letzten Platte erneut gesetzt (Endlos-Nachschub).
    Rückgabe: True, wenn sich etwas geändert hat (Aufrufer speichert dann).
    """
    if rack_logic.magazine_slot_of(data) > 0:
        return False
    if data.get("empty_plates_migrated") or rack_logic.marked_empty_plates(data):
        return False
    slots = data.get("slots") or {}
    spr = int(data.get("slots_per_rack", DEFAULT_SLOTS_PER_RACK))
    for i, cnt in enumerate(data.get("magazine_counts") or []):
        try:
            cnt = max(0, min(spr, int(cnt)))
        except (TypeError, ValueError):
            continue
        for s in range(1, cnt + 1):
            slot = slots.get(f"{i + 1}-{s}")
            # Nur wirklich freie Fächer markieren — wo ein Druck liegt, liegt
            # keine leere Platte.
            if isinstance(slot, dict) and slot.get("status", "free") == "free":
                slot["empty_plate"] = True
    data["empty_plates_migrated"] = True
    return True


def _normalize(data: dict) -> bool:
    """Fehlende Fächer/Felder ergänzen, Überzähliges kappen. → True, wenn sich etwas
    geändert hat, das gespeichert werden muss (Migrationen)."""
    changed = False
    # Altes flaches Format (rows/cols) → Mehrregal-Format.
    if "rows" in data and "num_racks" not in data:
        old_slots = data.get("slots", {})
        sp_rack = int(data.get("cols", DEFAULT_SLOTS_PER_RACK))
        data["num_racks"] = 1
        data["slots_per_rack"] = sp_rack
        data["slots"] = {f"1-{s}": old_slots.get(str(s), default_slot())
                         for s in range(1, sp_rack + 1)}
        for key in ("rows", "cols"):
            data.pop(key, None)
        changed = True

    nr = int(data.get("num_racks", DEFAULT_NUM_RACKS))
    spr = int(data.get("slots_per_rack", DEFAULT_SLOTS_PER_RACK))
    data["num_racks"], data["slots_per_rack"] = nr, spr
    data.setdefault("slot_height_mm", DEFAULT_SLOT_H)
    valid = {f"{r}-{s}" for r in range(1, nr + 1) for s in range(1, spr + 1)}
    slots = data.get("slots") if isinstance(data.get("slots"), dict) else {}
    for k in valid:
        slots.setdefault(k, default_slot())
    data["slots"] = {k: v for k, v in slots.items() if k in valid}
    data.setdefault("max_plates", 4)
    data.pop("magazine_count", None)  # wird berechnet, nicht gespeichert
    data.setdefault("magazine_slot", DEFAULT_MAGAZINE_SLOT)
    # Soll-Platten je Magazin. Bestehende Installationen ohne dieses Feld erben
    # `max_plates` als Ausgangswert — der Nutzer setzt seine echte Zahl danach.
    seed = int(data.get("max_plates", DEFAULT_MAGAZINE_DEFAULT)) or DEFAULT_MAGAZINE_DEFAULT
    defs = data.get("magazine_defaults")
    defs = [_count(c, seed) for c in defs] if isinstance(defs, list) else []
    data["magazine_defaults"] = (defs + [seed] * nr)[:nr]
    # Live-Bestand je Rack; bei geänderter Rack-Zahl auf die Sollwerte auffüllen.
    if not isinstance(data.get("magazine_counts"), list):
        data["magazine_counts"] = list(data["magazine_defaults"])
    else:
        # Ein ungültiger Bestand (null, Text) zählt als 0: Die Farm meldet dann
        # „Magazin leer", statt ins Leere zu greifen oder abzustürzen (bis v1.1.47
        # machte ein einziges null die ganze Regal-Datei „unlesbar").
        counts = [_count(c, 0) for c in data["magazine_counts"]]
        counts += [data["magazine_defaults"][i] for i in range(len(counts), nr)]
        data["magazine_counts"] = counts[:nr]
    if _migrate_empty_plates(data):
        changed = True
    return changed


def _count(value, fallback: int) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        logger.warning(f"rack_slots.json: ungültige Platten-Zahl {value!r} — nehme {fallback}")
        return fallback


def load() -> dict:
    """Normalisierter Regal-Zustand. Ohne Datei: die Vorgabe. Mit kaputter Datei:
    storage.BrokenFile. Bis v1.1.47 kam dann still ein Standard-Regal zurück, und
    das nächste Speichern (jede Fach-Änderung der Farm) überschrieb die echte
    Belegung damit: Platten lagen im Regal, das Regal galt als leer."""
    with _lock:
        if not os.path.exists(SLOTS_PATH):
            return default_data()
        data = storage.read_json_checked(SLOTS_PATH, None, expect=dict)
        try:
            changed = _normalize(data)
        except (TypeError, ValueError, AttributeError) as e:
            raise storage.BrokenFile(SLOTS_PATH, f"Aufbau unlesbar ({e})")
        if changed:
            save(data)
        return data


def save(data: dict) -> None:
    """Schreibfehler gehen an den Aufrufer: Ein still verlorenes Speichern hieße,
    die nächste Ablage geht in ein Fach, das schon belegt ist."""
    with _lock:
        storage.write_json(SLOTS_PATH, data)


def ensure_file() -> None:
    """Fehlt die Regal-Datei, einmal die Vorgabe anlegen: Dann sehen Oberfläche und
    Farm dasselbe Regal (vorher zeigte load() ein Standard-Regal, die Farm {})."""
    with _lock:
        if not os.path.exists(SLOTS_PATH):
            storage.write_json(SLOTS_PATH, default_data())


def reset_broken() -> str:
    """Kaputte Regal-Datei sichern und durch die Vorgabe ersetzen (nur auf ausdrückliche
    Anweisung, System → Datenspeicher). → Pfad der Sicherungskopie."""
    with _lock:
        backup = storage.backup_broken(SLOTS_PATH)
        storage.write_json(SLOTS_PATH, default_data())
        return backup


def exists() -> bool:
    return os.path.exists(SLOTS_PATH)


@contextmanager
def edit():
    """`with rack_store.edit() as data:` — lesen, ändern, schreiben als EIN Schritt.
    Niemand sonst kann dazwischen schreiben."""
    with _lock:
        data = load()
        yield data
        save(data)


# Grenzen der Regal-Eingaben — EINE Quelle: apply_config klemmt damit, und die
# Oberfläche bekommt sie über GET /api/rack-manager/ (limits) für ihre Formulare.
LIMITS = {
    "num_racks":         (1, 10),
    # Bis 40: Das Kompakt-Regal hat ~24 Fächer (bis v1.1.79 war bei 20 Schluss).
    "slots_per_rack":    (1, 40),
    "compact_clearance_mm": (0.0, 60.0),
    "slot_height_mm":    (1.0, 500.0),
    "slot_tolerance_mm": (0.0, 100.0),
    "slot_stacked_pct":  (0.0, 100.0),
    "height_margin_pct": (0.0, 100.0),
    "max_plates":        (1, 200),
    "magazine_count":    (0, 200),
}


class RackShrinkConflict(ValueError):
    """Verkleinern würde Fächer löschen, in denen etwas liegt."""

    def __init__(self, slots: list):
        super().__init__("Belegte Fächer würden wegfallen: " + ", ".join(slots))
        self.slots = slots


def _number(body: dict, key: str, cast=float):
    """Zahl aus der Eingabe, geklemmt auf LIMITS. Leer oder Text → ValueError mit
    Feldname (bis v1.1.49 ein int()-Absturz, oder aus „" wurde 0)."""
    v = body.get(key)
    if isinstance(v, str):
        v = v.strip().replace(",", ".")
    try:
        n = cast(float(v))
    except (TypeError, ValueError):
        raise ValueError(f"{key}: keine Zahl ({body.get(key)!r})")
    lo, hi = LIMITS.get(key, (None, None))
    if lo is not None:
        n = max(cast(lo), min(cast(hi), n))
    return n


def _counts(values: list, key: str) -> list:
    """Platten-Zahlen je Magazin; ein leeres oder ungültiges Feld → ValueError."""
    out = []
    for i, v in enumerate(values):
        try:
            out.append(_number({"magazine_count": v}, "magazine_count", int))
        except ValueError:
            raise ValueError(f"{key}[{i + 1}]: keine Zahl ({v!r})")
    return out


def _slot_in_use(s) -> bool:
    if not isinstance(s, dict):
        return False
    return (s.get("status", "free") not in ("free", "ready") or bool(s.get("empty_plate"))
            or bool(s.get("object_height_mm")))


def apply_config(data: dict, body: dict) -> dict:
    """Regal-Einstellungen aus `body` übernehmen (geklemmt) und das Fach-Raster
    nachziehen. Dieselbe Funktion für die Regalverwaltung und den Profil-Import —
    vorher hatte der Import eine eigene, kürzere Fassung, die u. a. das Magazin-Fach
    nicht kannte: ein Profil sagte also nicht, ob es überhaupt ein Magazin gibt.

    Seit v1.1.50:
    - Verkleinern über belegte Fächer → RackShrinkConflict (bis dahin wurden sie still
      gelöscht: Die Platte lag noch im Regal, Printloom wusste nichts mehr davon).
    - Ungültige Zahl → ValueError mit Feldname.
    - Das Magazin-Fach muss über den Lagerfächern liegen (sonst wäre es Ablageziel).
    - Eine neue Sollzahl setzt den Live-Bestand NICHT zurück; das tut nur
      `reset_counts: true` (bzw. „Magazin auffüllen"). Sinkt sie darunter, wird gekappt."""
    if "num_racks" in body:
        data["num_racks"] = _number(body, "num_racks", int)
    if "slots_per_rack" in body:
        data["slots_per_rack"] = _number(body, "slots_per_rack", int)
    if "slot_height_mm" in body:
        data["slot_height_mm"] = _number(body, "slot_height_mm")
    if "slot_tolerance_mm" in body:
        data["slot_tolerance_mm"] = _number(body, "slot_tolerance_mm")
    if "slot_stacked_pct" in body:
        data["slot_stacked_pct"] = _number(body, "slot_stacked_pct")
    if "stack_rack" in body:
        data["stack_rack"] = max(1, _number(body, "stack_rack", int))
    if "stack_slot" in body:
        data["stack_slot"] = max(1, _number(body, "stack_slot", int))
    if "max_plates" in body:
        data["max_plates"] = _number(body, "max_plates", int)
    if "height_margin_pct" in body:
        data["height_margin_pct"] = _number(body, "height_margin_pct")
    # Bauart (seit v1.1.80): „standard" oder „compact" (dichte Halterung, kein Magazin,
    # siehe rack_logic „Kompakt-Regal"). Die EINE Quelle dafür — die Geometrie
    # übernimmt sie über ottoeject_motion.apply_rack_config.
    if "rack_type" in body:
        rt = str(body.get("rack_type") or "standard").strip().lower()
        if rt not in ("standard", rack_logic.COMPACT):
            raise ValueError(f"rack_type: unbekannte Bauart ({body.get('rack_type')!r})")
        if rt == rack_logic.COMPACT and not rack_logic.is_compact(data):
            data["empty_plates_migrated"] = True     # nichts aus Magazin-Zählern erfinden
        data["rack_type"] = rt
    if rack_logic.is_compact(data):
        # Kein Magazin: Die leeren Platten liegen in den Fächern (compact_fill_order).
        # Auch wenn ein altes Formular ein Magazin-Fach mitschickt — dessen Zweig unten
        # würde sonst alle Leerplatten-Marken löschen.
        body = {k: v for k, v in body.items() if k != "magazine_slot"}
        data["magazine_slot"] = 0
        data["stack_slot"] = 1
    if "compact_clearance_mm" in body:
        data["compact_clearance_mm"] = _number(body, "compact_clearance_mm")
    if "compact_top_open" in body:
        data["compact_top_open"] = bool(body.get("compact_top_open"))
    if "magazine_slot" in body:
        # 0 = KEIN Magazin (alle Fächer lagern; leere Platten werden manuell eingelegt).
        data["magazine_slot"] = max(0, _number(body, "magazine_slot", int))
        if data["magazine_slot"]:
            data["stack_slot"] = data["magazine_slot"]  # keep in sync
            # Mit Magazin gibt es keine Fach-Markierungen (der Nachschub kommt aus dem
            # Stapel) — alte Markierungen löschen, damit sie nicht als „Platte liegt
            # hier" hängen bleiben und Ablageplätze blockieren.
            for s in (data.get("slots") or {}).values():
                if isinstance(s, dict):
                    s["empty_plate"] = False
            data.pop("empty_plates_migrated", None)
        else:
            # Frisch auf „alle Fächer = Lagerfächer" umgestellt: NICHTS aus dem
            # Magazin-Zähler erfinden. Der Nutzer markiert selbst, wo Platten liegen.
            data["empty_plates_migrated"] = True
    # Sollwerte je Magazin. Bis v1.1.49 setzte jede neue Sollzahl auch den Live-Bestand
    # („frisch bestückt") — wer nur die Zahl korrigierte, hatte danach einen Bestand,
    # der nicht stimmt, und der Arm griff ins leere Magazin.
    if isinstance(body.get("magazine_defaults"), list):
        data["magazine_defaults"] = _counts(body["magazine_defaults"], "magazine_defaults")
    if isinstance(body.get("magazine_counts"), list):
        data["magazine_counts"] = _counts(body["magazine_counts"], "magazine_counts")
    if body.get("reset_counts") is True:
        data["magazine_counts"] = list(data.get("magazine_defaults") or [])

    nr = int(data.get("num_racks", DEFAULT_NUM_RACKS))
    spr = int(data.get("slots_per_rack", DEFAULT_SLOTS_PER_RACK))
    mag = int(data.get("magazine_slot") or 0)
    if mag and mag <= spr:
        raise ValueError(f"magazine_slot: Das Magazin-Fach ({mag}) muss über den Lagerfächern "
                         f"liegen (> {spr}) oder 0 sein (kein Magazin)")
    existing = data.get("slots", {})
    weg = sorted(k for k, s in existing.items()
                 if _slot_in_use(s) and k not in
                 {f"{r}-{s2}" for r in range(1, nr + 1) for s2 in range(1, spr + 1)})
    if weg:
        raise RackShrinkConflict(weg)
    data["slots"] = {f"{r}-{s}": existing.get(f"{r}-{s}", default_slot())
                     for r in range(1, nr + 1) for s in range(1, spr + 1)}
    # Magazin-Arrays an die (evtl. neue) Rack-Zahl anpassen.
    defs = [max(0, int(c)) for c in data.get("magazine_defaults", [])]
    defs = (defs + [DEFAULT_MAGAZINE_DEFAULT] * nr)[:nr]
    data["magazine_defaults"] = defs
    cnts = [max(0, int(c)) for c in data.get("magazine_counts", [])]
    cnts = (cnts + [defs[i] for i in range(len(cnts), nr)])[:nr]
    # Sinkt in DIESER Eingabe die Sollzahl, wird der Bestand darauf gekappt. Sonst
    # bleibt er, wie er ist — auch über der Sollzahl, wenn der Nutzer ihn so
    # eingetragen hat (ein stilles Kappen wäre wieder eine Änderung ohne Auftrag).
    if isinstance(body.get("magazine_defaults"), list) and not isinstance(body.get("magazine_counts"), list):
        cnts = [min(c, defs[i]) for i, c in enumerate(cnts)]
    data["magazine_counts"] = cnts
    return data


def place_empty_plates(data: dict, count: int) -> list:
    """Kompakt-Regal: „Ich habe `count` leere Platten eingelegt." Markiert genau so
    viele Fächer in der Einlege-Reihenfolge (rack_logic.compact_fill_order: letztes
    Regal von unten, dann das davor) und löscht alle anderen Leerplatten-Marken.
    Fächer mit einem Druck werden übersprungen — dort liegt keine leere Platte.
    → markierte Fächer als ["3-1", …]. Zu viele Platten → ValueError."""
    if not rack_logic.is_compact(data):
        raise ValueError("Leere Platten nach Reihenfolge einlegen gibt es nur beim Kompakt-Regal")
    try:
        count = int(count)
    except (TypeError, ValueError):
        raise ValueError(f"count: keine Zahl ({count!r})")
    if count < 0:
        raise ValueError("count: darf nicht negativ sein")
    slots = data.get("slots") or {}
    for s in slots.values():
        if isinstance(s, dict):
            s["empty_plate"] = False
    marked = []
    for r, s in rack_logic.compact_fill_order(data):
        if len(marked) >= count:
            break
        slot = slots.get(f"{r}-{s}")
        if not isinstance(slot, dict) or slot.get("status", "free") not in ("free", "ready") \
                or slot.get("object_height_mm"):
            continue
        slot["empty_plate"] = True
        marked.append(f"{r}-{s}")
    if len(marked) < count:
        raise ValueError(f"Nur {len(marked)} freie Fächer für {count} leere Platten")
    data["empty_plates_migrated"] = True
    return marked


def update_slot(slot: str, status: str, file_name: str = None,
                object_height_mm: float = None, empty_plate: bool = None) -> bool:
    """Fach-Zustand setzen (Farm). `empty_plate` nur mitgeben, wenn sich die Marke
    „hier liegt eine leere Platte" wirklich ändert. → False, wenn es das Fach nicht
    gibt oder noch gar keine Regal-Datei existiert (dann schreibt die Farm nichts)."""
    if not exists():
        return False
    with edit() as data:
        s = data["slots"].get(str(slot))
        if s is None:
            return False
        s["status"] = status
        if file_name is not None:
            s["file_name"] = file_name
        if object_height_mm is not None:
            s["object_height_mm"] = object_height_mm
        if status == "free":
            s["object_height_mm"] = None
        if empty_plate is not None:
            s["empty_plate"] = bool(empty_plate)
    return True
