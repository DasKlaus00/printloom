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
    defs = [max(0, int(c)) for c in defs] if isinstance(defs, list) else []
    data["magazine_defaults"] = (defs + [seed] * nr)[:nr]
    # Live-Bestand je Rack; bei geänderter Rack-Zahl auf die Sollwerte auffüllen.
    if "magazine_counts" not in data:
        data["magazine_counts"] = list(data["magazine_defaults"])
    else:
        counts = [max(0, int(c)) for c in data["magazine_counts"]]
        counts += [data["magazine_defaults"][i] for i in range(len(counts), nr)]
        data["magazine_counts"] = counts[:nr]
    if _migrate_empty_plates(data):
        changed = True
    return changed


def load() -> dict:
    """Normalisierter Regal-Zustand. Ohne (lesbare) Datei: die Vorgabe."""
    with _lock:
        if os.path.exists(SLOTS_PATH):
            data = storage.read_json(SLOTS_PATH, None)
            if isinstance(data, dict):
                try:
                    if _normalize(data):
                        save(data)
                    return data
                except Exception as e:
                    logger.warning(f"rack_slots.json unlesbar: {e}")
        return default_data()


def save(data: dict) -> None:
    with _lock:
        try:
            storage.write_json(SLOTS_PATH, data)
        except Exception as e:
            logger.error(f"rack_slots.json save failed: {e}")


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


def apply_config(data: dict, body: dict) -> dict:
    """Regal-Einstellungen aus `body` übernehmen (geklemmt) und das Fach-Raster
    nachziehen. Dieselbe Funktion für die Regalverwaltung und den Profil-Import —
    vorher hatte der Import eine eigene, kürzere Fassung, die u. a. das Magazin-Fach
    nicht kannte: ein Profil sagte also nicht, ob es überhaupt ein Magazin gibt."""
    if "num_racks" in body:
        data["num_racks"] = max(1, min(10, int(body["num_racks"])))
    if "slots_per_rack" in body:
        data["slots_per_rack"] = max(1, min(20, int(body["slots_per_rack"])))
    if "slot_height_mm" in body:
        data["slot_height_mm"] = max(1.0, float(body["slot_height_mm"]))
    if "slot_tolerance_mm" in body:
        data["slot_tolerance_mm"] = max(0.0, min(100.0, float(body["slot_tolerance_mm"])))
    if "slot_stacked_pct" in body:
        data["slot_stacked_pct"] = max(0.0, min(100.0, float(body["slot_stacked_pct"])))
    if "stack_rack" in body:
        data["stack_rack"] = max(1, int(body["stack_rack"]))
    if "stack_slot" in body:
        data["stack_slot"] = max(1, int(body["stack_slot"]))
    if "max_plates" in body:
        data["max_plates"] = max(1, int(body["max_plates"]))
    if "height_margin_pct" in body:
        data["height_margin_pct"] = max(0.0, min(100.0, float(body["height_margin_pct"])))
    if "magazine_slot" in body:
        # 0 = KEIN Magazin (alle Fächer lagern; leere Platten werden manuell eingelegt).
        data["magazine_slot"] = max(0, int(body["magazine_slot"]))
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
    # Sollwerte je Magazin. Werden sie gesetzt, gilt der Live-Bestand als frisch
    # bestückt („so viele Platten liegen im Magazin").
    if isinstance(body.get("magazine_defaults"), list):
        defs = [max(0, int(c)) for c in body["magazine_defaults"]]
        data["magazine_defaults"] = defs
        data["magazine_counts"] = list(defs)
    if isinstance(body.get("magazine_counts"), list):
        data["magazine_counts"] = [max(0, int(c)) for c in body["magazine_counts"]]

    nr = int(data.get("num_racks", DEFAULT_NUM_RACKS))
    spr = int(data.get("slots_per_rack", DEFAULT_SLOTS_PER_RACK))
    existing = data.get("slots", {})
    data["slots"] = {f"{r}-{s}": existing.get(f"{r}-{s}", default_slot())
                     for r in range(1, nr + 1) for s in range(1, spr + 1)}
    # Magazin-Arrays an die (evtl. neue) Rack-Zahl anpassen.
    defs = [max(0, int(c)) for c in data.get("magazine_defaults", [])]
    defs = (defs + [DEFAULT_MAGAZINE_DEFAULT] * nr)[:nr]
    data["magazine_defaults"] = defs
    cnts = [max(0, int(c)) for c in data.get("magazine_counts", [])]
    data["magazine_counts"] = (cnts + [defs[i] for i in range(len(cnts), nr)])[:nr]
    return data


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
