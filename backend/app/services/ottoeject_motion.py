"""OTTOeject-Bewegungen als G-code — zentral in Printloom.

Statt Klipper-Macros auf dem Gerät (slots.cfg / printer_calibration_variables.cfg)
kennt Printloom ALLE Koordinaten (Geometrie-Speicher) und erzeugt die kompletten
G-code-Sequenzen daraus. Nur OTTOEJECT_HOME bleibt ein Geräte-Macro (Homing/Endstops).

Die Bewegungsabläufe sind 1:1 aus den getesteten OTTOmat3D-Macros portiert
(ottoeject_macros.cfg): _GRAB_FROM_SLOT, _GRAB_FROM_SLOT_NOLIFT, _STORE_TO_SLOT,
_EJECT_FROM_PRINTER, _LOAD_ONTO_PRINTER, _OPEN_DOOR, _CLOSE_DOOR.

Aufbau: Home ist ganz RECHTS (X 0, Endschalter — fester Anker), die Module stehen
in einer Reihe nach links. R1 = Regal DIREKT am Drucker, Rn = Regal am Home-Anker.

Positionen (seit v1.1.9)
────────────────────────
Jeder Drucker und jedes Regal hat seine EIGENE, ABSOLUTE X-Position in mm:

    geometry["printers"] = [{"id": "printer-1", "eject": {...}, "load": {...}, …}, …]
    geometry["rack_geo"] = {"1": {"x": …, "y_engage": …, "first_z": …, "slot_gap": …}}

Vorher gab es genau EINEN Drucker und die Regal-X kamen aus einer Formel
(x_unclamp + (Regale−r)·rack_x_gap + Δ), während die Drucker-X als BASIS gespeichert
war und beim Fahren um (Regale−1)·rack_x_gap verschoben wurde. Das ging nur, solange
alle Regale gleich breit sind und genau ein Drucker am Ende steht — bei zwei Druckern
oder unterschiedlichen Regalen beschreibt die Formel den Aufbau nicht mehr. Außerdem
verschob ein zusätzliches Regal stillschweigend die Drucker-Position.

Bestandsanlagen ohne diese Blöcke werden weiter über die Formel gerechnet
(`_legacy_printer` / `rack_x`) — sie liefert exakt dieselben Zahlen wie vorher, damit
sich beim Update keine einzige Position verschiebt.

    z_flat(slot) = first_z(rack) + (slot-1)*(slot_gap(rack)+30) + rack_z_trim[rack]
"""
from __future__ import annotations
import math
import re
from copy import deepcopy

SLOT_Z_EXTRA = 30   # effektiver Z-Schritt = slot_gap + 30

DEFAULT_GEOMETRY = {
    "printer_id": "x1c",
    "printer_name": "Bambu Lab X1C",
    "enclosed": True,
    # Verbaute Komponenten (Setup-Assistent -> services/hardware.js).
    # "holder"  = Regal-Halterung. Bestimmt nur die REGALSTRUKTUR (Fachzahl, Z-Schritt)
    #             und ist hier rein informativ.
    # "gripper" = Greifarm samt Greifmechanismus. Bestimmt die BEWEGUNG:
    #               "standard" -> geklemmt (seitlich, clamp_push_mm)
    #               "magnet"   -> nur Z: absenken/anheben, kein Weg nach links/rechts
    #             Der Greifer ist die EINE Quelle dafuer; "gripper_motion" gibt es nur
    #             als ausdrueckliche Uebersteuerung und steht deshalb bewusst NICHT in
    #             den Defaults -- sonst haette merge_defaults schon "clamp" eingesetzt
    #             und eine Geometrie mit nur "gripper" koennte nie anders fahren.
    "holder": "standard",
    "gripper": "standard",
    "racks": 1,
    "storage_slots": 6,      # Lager-Fächer (ohne Magazin)
    "magazine": True,        # oberstes Fach = Magazin (NOLIFT)
    "storage": {
        "x_unclamp": 43, "y_engage": 335, "first_z_flat": 7,
        "slot_gap": 25, "y_pullback_limit": 5, "rack_x_gap": 250,
    },
    "rack_x_trim": {},       # {"2": -1, ...} optionale Feinkorrektur pro Regal (Alt-Modell)
    "rack_z_trim": {},
    # Werte JE REGAL (seit v1.1.9): {"1": {"x", "y_engage", "first_z", "slot_gap",
    # "printer", "name"}, …}. Was hier fehlt, kommt aus `storage` bzw. der Formel —
    # so rechnen Bestandsanlagen unverändert weiter.
    "rack_geo": {},
    # Mehrere Drucker (seit v1.1.9). Leer = Alt-Modell: der einzelne Block `printer`
    # unten, dessen X noch die BASIS ohne Regal-Versatz ist (siehe _legacy_printer).
    "printers": [],
    "printer": {
        "eject": {"x": 442, "y": 319, "z": 21},
        "load":  {"x": 425, "y": 340, "z": 17.5},
        "door":  {"open":  {"x": 104, "y": 319, "z": 105, "d": 370},
                  "close": {"x": 103, "y": 322, "z": 105, "d": 375}},
    },
    "speed_factor": 100,     # globaler M220-Vorschub in % (100 = normal, bis 500 schneller) — Fallback
    "speed_factors": {},     # {op: %} — Vorschub PRO Operation (überschreibt speed_factor); für schnellen, feinjustierten Wechsel
    "gcode_override": {},    # {op: "roher G-code"} — Feinjustage, überschreibt die berechnete Bewegung
    # Magazin-Durchbiegung: die flach gestapelten Platten hängen durch — der Stapel
    # liegt pro Platte ~1 mm tiefer. Beim Greifen aus dem Magazin wird Z um
    # (Plattenzahl × magazine_sag_mm) ABGESENKT: 6 Platten → −6 mm, 4 → −4 mm.
    # Plattenzahl je Regal kommt live aus der Rack-Konfiguration (magazine_counts).
    "magazine_sag_mm": 1.0,
    # Klemm-Andruck: der Arm fährt beim Greifen/Ablegen um diesen Weg über die Fach-/
    # Drucker-X hinaus, um den Greifer in die Platten-Halterung zu drücken bzw. die Platte
    # abzuschieben. Drucker-Seite (eject/load) = +push, Regal-Seite (grab/store) = −push.
    # Im Original fix 30 mm; jetzt einstellbar (0 = ohne Andruck, Greifpunkt = Start-X).
    "clamp_push_mm": 30.0,
    # Magnet-Greifer: Z-Wege statt X-Klemmweg (siehe MAGNET_HOVER_MM / MAGNET_LIFT_MM).
    # Magnet-Greifer, gemessen an Regal 3 Fach 1 (z_flat = 15):
    #   Greifen  Z15 -> Y300 -> Y342 -> Z30 -> Y20
    #   Ablegen  Z50 -> Y342 -> Z10  -> Y300
    # Daraus: der Arm fährt UNTER die Platte und hebt sie an (lift). Beim Ablegen
    # kommt er HÖHER herein (store_z) und senkt UNTER die Fachhöhe (release) —
    # dabei bleibt die Platte auf dem Fach liegen und löst sich vom Magneten.
    "magnet_lift_mm": 15.0,      # Anheben über die Fachhöhe beim Greifen
    "magnet_store_z_mm": 35.0,   # Einfahrhöhe über der Fachhöhe beim Ablegen
    "magnet_release_mm": 5.0,    # Absenken UNTER die Fachhöhe zum Ablösen
    "magnet_y_clear_mm": 42.0,   # Abstand vor dem Fach (Y-Vorposition)
    "magnet_y_travel_mm": 280.0, # Y, auf der die X-Ausrichtung passiert
    "magnet_y_retract_mm": 25.0, # Y, auf die nach dem Greifen zurückgezogen wird
    "magnet_store_x_mm": 0.0,    # X-Versatz beim Ablegen (0 = wie beim Greifen)
    # Achsgrenzen des Geräts in mm ({} = unbekannt) — für die Plausibilitätsprüfung
    # (geometry_check). Am besten per „Grenzen vom Gerät holen" aus Klipper geholt,
    # dann wird eine Bewegung außerhalb der Achse gar nicht erst gesendet. Leer
    # gelassen wird nur nach unten geprüft (unter 0 ist immer falsch).
    "machine_limits": {},
}


# Kanonische Liste der App-Operationen — genutzt vom Drucker-Tab, dem Sequenz-Schritt
# „app_op" (frei in Sequenzen nutzbar) und dem /app-ops-Endpoint. `rack_slot` = ob die
# Op ein Fach/Regal braucht (grab/store). Reihenfolge = Wechselablauf.
APP_OPS = [
    {"key": "open_door",       "label_de": "Tür öffnen",         "label_en": "Open door",       "rack_slot": False},
    {"key": "close_door",      "label_de": "Tür schließen",      "label_en": "Close door",      "rack_slot": False},
    {"key": "move_to_printer", "label_de": "Vor Drucker fahren", "label_en": "Move to printer", "rack_slot": False},
    {"key": "eject",           "label_de": "Auswerfen",          "label_en": "Eject plate",     "rack_slot": False},
    {"key": "place",           "label_de": "Einlegen",           "label_en": "Place plate",     "rack_slot": False},
    {"key": "grab",            "label_de": "Platte holen",       "label_en": "Grab from rack",  "rack_slot": True},
    {"key": "grab_magazine",   "label_de": "Aus Magazin holen",  "label_en": "Grab from magazine", "rack_slot": True},
    {"key": "store",           "label_de": "Platte ablegen",     "label_en": "Store to rack",   "rack_slot": True},
]
APP_OP_KEYS = {o["key"] for o in APP_OPS}


# ── Helfer ──────────────────────────────────────────────────────────────────
def _num(v, d=0.0):
    """Robuste Float-Konvertierung: None/NaN/leer/ungültig → Default. Verhindert 500,
    wenn ein Eingabefeld im Drucker-Tab leer/halbfertig ist (JSON null / NaN)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return float(d)
    return f if f == f else float(d)   # NaN (f != f) → Default


def _n(v):
    """Zahl hübsch runden (Klipper mag keine langen Floats)."""
    r = round(_num(v), 3)
    return int(r) if r == int(r) else r


# Zahlenfelder der Geometrie (Pfade relativ zu DEFAULT_GEOMETRY) für die Sanitisierung.
def _sanitize_geometry(g: dict) -> dict:
    """Alle Zahlenfelder robust machen (None/NaN/leer → Default), damit ein
    halbfertiges Eingabefeld keine 500 auslöst."""
    d = DEFAULT_GEOMETRY
    for k in ("racks", "storage_slots", "magazine_slot", "speed_factor", "clamp_push_mm",
              "magnet_lift_mm", "magnet_store_z_mm", "magnet_release_mm",
              "magnet_y_clear_mm", "magnet_store_x_mm",
              "magnet_y_travel_mm", "magnet_y_retract_mm"):
        if g.get(k) is not None:
            g[k] = _num(g.get(k), d.get(k, 0))
    sf = g.get("speed_factors")
    if isinstance(sf, dict):
        g["speed_factors"] = {k: _num(v, 100) for k, v in sf.items() if v is not None}
    ml = g.get("machine_limits")
    if isinstance(ml, dict):
        # 0/leer/Müll = „unbekannt" → Eintrag fällt weg (nicht 0 speichern, sonst wäre
        # jede Bewegung über 0 mm plötzlich ein Fehler).
        g["machine_limits"] = {k: _num(v) for k, v in ml.items()
                               if k in ("x", "y", "z") and _num(v) > 0}
    else:
        g["machine_limits"] = {}
    s = g.setdefault("storage", {})
    for k, dv in d["storage"].items():
        s[k] = _num(s.get(k), dv)
    p = g.setdefault("printer", {})
    for key in ("eject", "load"):
        node = p.setdefault(key, {})
        for k, dv in d["printer"][key].items():
            node[k] = _num(node.get(k), dv)
    # „move" (Anfahr-Position) NUR sanitisieren, wenn vorhanden — nicht anlegen,
    # sonst bräche der Fallback move_to_printer → eject für Altbestand ohne „move".
    if isinstance(p.get("move"), dict):
        for k, dv in d["printer"]["eject"].items():
            p["move"][k] = _num(p["move"].get(k), dv)
    door = p.get("door")
    if isinstance(door, dict):
        for kind in ("open", "close"):
            node = door.get(kind)
            if isinstance(node, dict):
                for k, dv in d["printer"]["door"][kind].items():
                    node[k] = _num(node.get(k), dv)
    # Mehrere Drucker: jeder Block wie oben robust machen (halbfertige Eingabefelder).
    if isinstance(g.get("printers"), list):
        for blk in g["printers"]:
            if not isinstance(blk, dict):
                continue
            for key in ("eject", "load", "move"):
                node = blk.get(key)
                if isinstance(node, dict):
                    for k, dv in d["printer"]["eject"].items():
                        node[k] = _num(node.get(k), dv)
            bdoor = blk.get("door")
            if isinstance(bdoor, dict):
                for kind in ("open", "close"):
                    node = bdoor.get(kind)
                    if isinstance(node, dict):
                        for k, dv in d["printer"]["door"][kind].items():
                            node[k] = _num(node.get(k), dv)
            bsf = blk.get("speed_factors")
            if isinstance(bsf, dict):
                blk["speed_factors"] = {k: _num(v, 100) for k, v in bsf.items() if v is not None}
    # Werte je Regal: nur vorhandene Schlüssel anfassen — ein fehlender Schlüssel
    # bedeutet „gilt der gemeinsame Wert", nicht „0".
    if isinstance(g.get("rack_geo"), dict):
        for blk in g["rack_geo"].values():
            if not isinstance(blk, dict):
                continue
            for k in ("x", "y_engage", "first_z", "slot_gap"):
                if blk.get(k) is not None:
                    blk[k] = _num(blk[k], 0)
    return g


def merge_defaults(g: dict | None) -> dict:
    """Gespeicherte Geometrie mit den Defaults auffüllen (fehlende Felder)."""
    out = deepcopy(DEFAULT_GEOMETRY)
    if not g:
        return out
    for k, v in g.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
            for kk, vv in v.items():
                if isinstance(vv, dict) and isinstance(out[k].get(kk), dict):
                    out[k][kk] = {**out[k][kk], **vv}
        elif isinstance(v, list):
            # Listen (printers) kopieren: _sanitize_geometry macht die Zahlenfelder
            # robust und würde sonst in den Dictionaries des Aufrufers schreiben.
            out[k] = deepcopy(v)
        else:
            out[k] = v
    return out


def magazine_slot(g: dict) -> int:
    ms = g.get("magazine_slot")
    if ms:
        return int(ms)
    return (int(g["storage_slots"]) + 1) if g.get("magazine") else 0


def apply_layout(g: dict, layout: dict | None) -> dict:
    """Nur noch ein Aufräumer (seit v1.1.8).

    Bis v1.1.7 hat das Farm-Layout die X-Positionen der Geometrie ÜBERLAGERT.
    Damit gab es zwei Quellen für dieselbe Zahl: Drucker-Tab und Layout-Seite.
    Sie wurden getrennt gepflegt und liefen auseinander — der Test-Knopf im
    Drucker-Tab fuhr nach der Formel, die Farm nach dem Layout, und niemand sah,
    welcher Wert gilt. Jetzt ist die Geometrie die einzige Quelle; das Layout
    wird daraus abgeleitet (farm_layout.from_geometry). Ein evtl. noch
    gespeicherter Überlagerungs-Block wird hier entfernt."""
    g.pop("layout", None)
    return g


def apply_rack_config(g: dict, rack_cfg: dict | None) -> dict:
    """Regalzahl / Fächer / Magazin-Fach aus der GLOBALEN Rack-Konfiguration übernehmen
    (Configuration → Rack Configuration) — eine Quelle. Physische mm (x_unclamp,
    rack_x_gap, first_z_flat, slot_gap …) bleiben in der Geometrie."""
    if not rack_cfg:
        return g
    if rack_cfg.get("num_racks"):
        g["racks"] = int(rack_cfg["num_racks"])
    if rack_cfg.get("slots_per_rack"):
        g["storage_slots"] = int(rack_cfg["slots_per_rack"])
    ms = rack_cfg.get("magazine_slot")
    if ms:
        g["magazine_slot"] = int(ms)
        g["magazine"] = True
    # Platten pro Magazin (je Regal) — für die Z-Absenkung beim Magazin-Griff
    # (Durchbiegung, siehe magazine_z_offset). Rack Manager pflegt die Zähler.
    counts = rack_cfg.get("magazine_counts")
    if isinstance(counts, list):
        try:
            g["magazine_counts"] = [max(0, int(c)) for c in counts]
        except (TypeError, ValueError):
            pass
    return g


# ── Drucker & Regale als Module (seit v1.1.9) ───────────────────────────────
# Operationen, die zu einem DRUCKER gehören — sie fahren dessen Positionen und
# nutzen dessen eigenen G-code/Geschwindigkeit. Alles andere (Greifen/Ablegen/
# Magazin/Anfahren) gehört zum Regal und ist druckerunabhängig.
PRINTER_OPS = ("open_door", "close_door", "move_to_printer", "eject", "place")

# Alias → kanonischer Name. „load"/„move" sind die alten Schreibweisen aus den
# Geräte-Macros; gespeichert wird immer der kanonische Name.
_OP_ALIASES = {"load": "place", "move": "move_to_printer",
               "opendoor": "open_door", "closedoor": "close_door",
               "grab_mag": "grab_magazine"}


def canon_op(op) -> str:
    o = str(op or "").strip().lower()
    return _OP_ALIASES.get(o, o)


def _printer_x_off(g: dict) -> float:
    """Regal-Versatz des ALTEN Modells (nur noch für Bestandsanlagen).

    Bis v1.1.8 war die Drucker-X eine BASIS: der Drucker saß hinter dem letzten
    Regal und wanderte mit der Regalzahl mit, also X += (Regale−1)·rack_x_gap.
    Seit v1.1.9 speichert jeder Drucker seine absolute X; dieser Versatz wird nur
    noch gebraucht, um einen Alt-Block einmalig in absolute Werte umzurechnen
    (siehe `_legacy_printer`). Für neue Geometrien ist er bedeutungslos.
    """
    return (int(g.get("racks", 1)) - 1) * float(g["storage"]["rack_x_gap"])


def _sub(d, dflt) -> dict | None:
    """X/Y/Z(/D)-Block übernehmen; None/kein dict → Default (darf None sein)."""
    if not isinstance(d, dict):
        return deepcopy(dflt) if isinstance(dflt, dict) else None
    return {k: _num(v) for k, v in d.items() if k in ("x", "y", "z", "d")}


def _norm_printer(raw: dict, idx: int) -> dict:
    """Einen Drucker-Block auf feste Felder bringen. Koordinaten sind ABSOLUT."""
    raw = raw if isinstance(raw, dict) else {}
    dp = DEFAULT_GEOMETRY["printer"]
    door = raw.get("door")
    out = {
        "id": str(raw.get("id") or f"printer-{idx + 1}"),
        "name": str(raw.get("name") or f"Drucker {idx + 1}"),
        "model": str(raw.get("model") or ""),
        "preset": str(raw.get("preset") or ""),
        "device_id": raw.get("device_id"),
        "enclosed": bool(raw.get("enclosed", True)),
        "eject": _sub(raw.get("eject"), dp["eject"]),
        "load": _sub(raw.get("load"), dp["load"]),
        "move": _sub(raw.get("move"), None),
        "door": None,
        "use_gcode": dict(raw.get("use_gcode") or {}),
        "gcode_override": dict(raw.get("gcode_override") or {}),
        "speed_factors": dict(raw.get("speed_factors") or {}),
    }
    if isinstance(door, dict) and (door.get("open") or door.get("close")):
        out["door"] = {"open": _sub(door.get("open"), dp["door"]["open"]),
                       "close": _sub(door.get("close"), dp["door"]["close"])}
    return out


def _legacy_printer(g: dict) -> dict:
    """Alt-Modell (EIN Drucker, X als Basis) → Drucker-Block mit absoluter X.

    Der Versatz, den die Bewegung früher beim Fahren addierte, wird hier EINMAL
    eingerechnet. Damit fährt eine Bestandsanlage nach dem Update exakt dieselben
    Koordinaten wie vorher — nur stehen sie jetzt so da, wie sie gefahren werden.
    """
    off = _printer_x_off(g)
    p = g.get("printer") or {}

    def shift(node):
        if not isinstance(node, dict):
            return None
        out = {k: _num(v) for k, v in node.items() if k in ("x", "y", "z", "d")}
        out["x"] = _num(node.get("x")) + off
        return out

    door = p.get("door") if isinstance(p.get("door"), dict) else None
    ug, ov = g.get("use_gcode") or {}, g.get("gcode_override") or {}
    sf = g.get("speed_factors") or {}
    keys = set(PRINTER_OPS) | {"load", "move"}
    return _norm_printer({
        "id": "printer-1",
        "name": g.get("printer_name") or "Drucker",
        "model": g.get("printer_model") or "",
        "preset": g.get("printer_id") or "",
        "enclosed": g.get("enclosed", True),
        "eject": shift(p.get("eject")), "load": shift(p.get("load")),
        "move": shift(p.get("move")),
        "door": {"open": shift(door.get("open")), "close": shift(door.get("close"))} if door else None,
        "use_gcode": {canon_op(k): v for k, v in ug.items() if k in keys},
        "gcode_override": {canon_op(k): v for k, v in ov.items() if k in keys},
        "speed_factors": {canon_op(k): v for k, v in sf.items() if k in keys},
    }, 0)


def printer_list(g: dict) -> list:
    """Alle Drucker, normalisiert und mit ABSOLUTEN Koordinaten (mindestens einer).

    Bewusst bei jedem Zugriff frisch abgeleitet statt einmal beim Laden: der
    Alt-Fallback braucht die Regalzahl, und die kommt erst aus der globalen
    Rack-Konfiguration (apply_rack_config) — also nach merge_defaults.
    """
    raw = g.get("printers")
    if isinstance(raw, list) and raw:
        return [_norm_printer(p, i) for i, p in enumerate(raw) if isinstance(p, dict)] \
            or [_legacy_printer(g)]
    return [_legacy_printer(g)]


def printer_block(g: dict, ref=None) -> dict:
    """Ein Drucker: per id, per Index (0-basiert) oder ohne Angabe der erste."""
    ps = printer_list(g)
    if ref is None or ref == "":
        return ps[0]
    if isinstance(ref, dict):
        ref = ref.get("id")
    txt = str(ref)
    for p in ps:
        if p["id"] == txt:
            return p
    if txt.lstrip("-").isdigit():
        i = int(txt)
        if 0 <= i < len(ps):
            return ps[i]
    return ps[0]


def rack_block(g: dict, rack: int) -> dict:
    """Werte EINES Regals — eigene, sonst die gemeinsamen aus `storage`."""
    s = g.get("storage") or {}
    ds = DEFAULT_GEOMETRY["storage"]
    raw = (g.get("rack_geo") or {}).get(str(int(rack)))
    raw = raw if isinstance(raw, dict) else {}

    def pick(key, skey):
        v = raw.get(key)
        return _num(v) if v is not None else _num(s.get(skey), ds[skey])

    return {
        "nr": int(rack),
        "name": str(raw.get("name") or "") or None,
        "x": rack_x(g, rack),
        "y_engage": pick("y_engage", "y_engage"),
        "first_z": pick("first_z", "first_z_flat"),
        "slot_gap": pick("slot_gap", "slot_gap"),
        "printer": raw.get("printer") or None,
    }


def rack_numbers(g: dict) -> list:
    return list(range(1, max(1, int(_num(g.get("racks"), 1))) + 1))


def racks_of_printer(g: dict, printer_id: str) -> list:
    """Regal-Nummern dieses Druckers. Ohne jede Zuordnung gilt: gemeinsamer Pool
    (jeder Drucker darf jedes Regal) — sonst stünde eine frische Anlage ohne
    Ablageplatz da."""
    all_nr = rack_numbers(g)
    assigned = [r for r in all_nr if rack_block(g, r)["printer"] == printer_id]
    if assigned:
        return assigned
    free = [r for r in all_nr if not rack_block(g, r)["printer"]]
    return free or all_nr


def expand(g: dict) -> dict:
    """Geometrie in der VOLLEN Form: für jeden Drucker und jedes Regal ein
    ausgeschriebener Block mit absoluten Koordinaten.

    Damit muss die Oberfläche die Umrechnung des Alt-Modells (Basis + Regal-Versatz,
    Formel + Δ) nicht ein zweites Mal können — sie liest genau die Zahlen, die auch
    gefahren werden. Muss NACH apply_rack_config laufen, sonst stimmt die Regalzahl
    nicht. Idempotent: eine bereits volle Geometrie kommt unverändert zurück.
    """
    g = merge_defaults(g)
    blocks = printer_list(g)
    g["printers"] = deepcopy(blocks)
    rg = {}
    for r in rack_numbers(g):
        b = rack_block(g, r)
        prev = (g.get("rack_geo") or {}).get(str(r))
        rg[str(r)] = {
            **(prev if isinstance(prev, dict) else {}),
            "x": round(b["x"], 3), "y_engage": b["y_engage"],
            "first_z": b["first_z"], "slot_gap": b["slot_gap"],
            "printer": b["printer"] or blocks[0]["id"],
        }
        if b["name"]:
            rg[str(r)]["name"] = b["name"]
    g["rack_geo"] = rg
    return g


def op_uses_gcode(g: dict, op: str, printer=None) -> bool:
    """Fährt die Farm diese Operation als Printloom-G-code (statt Geräte-Macro)?
    Drucker-Operationen fragen den jeweiligen Drucker, Regal-Operationen die
    gemeinsame Liste."""
    op = canon_op(op)
    if op in PRINTER_OPS:
        v = (printer_block(g, printer).get("use_gcode") or {}).get(op)
        if v is not None:
            return bool(v)
    ug = g.get("use_gcode") or {}
    return bool(ug.get(op) if ug.get(op) is not None else ug.get("load" if op == "place" else op))


# Regal-Nr. in GERÄTE-Macro-Aufrufen (RACK=…) spiegeln: Printloom zählt seit v1.0.103
# R1 = Regal DIREKT am Drucker, die Klipper-Macros auf dem OTTOeject (slots.cfg vom
# alten Konfigurator) zählen Regal 1 = am Homing-Punkt (ganz rechts) — genau andersherum.
# Deshalb wird JEDE RACK=-Angabe erst beim Senden ans Gerät übersetzt:
# Geräte-Nr. = Regalzahl − Nr. + 1 (3 Regale: R1→3, R2→2, R3→1; 1 Regal = unverändert).
# Anzeige, Logs, Fach-Buchhaltung und Printloom-eigener G-code bleiben in
# Printloom-Zählung — Nummern außerhalb 1…Regalzahl werden nicht angefasst.
_RACK_PARAM_RE = re.compile(r"\bRACK=(\d+)", re.IGNORECASE)


def mirror_rack_params(script: str, racks) -> str:
    try:
        nr = int(racks or 1)
    except (TypeError, ValueError):
        return script
    if nr <= 1 or not script or "rack=" not in script.lower():
        return script

    def _sub(m):
        r = int(m.group(1))
        return f"RACK={nr - r + 1}" if 1 <= r <= nr else m.group(0)

    return _RACK_PARAM_RE.sub(_sub, script)


def magazine_z_offset(g: dict, rack: int) -> float:
    """Z-Absenkung beim Greifen aus dem Magazin: die flach gestapelten Platten biegen
    sich durch, der Stapel liegt pro Platte ~magazine_sag_mm tiefer. 6 Platten → −6 mm,
    4 → −4 mm (bei 1 mm/Platte). Zähler je Regal aus magazine_counts; ohne Zähler 0."""
    try:
        counts = g.get("magazine_counts") or []
        cnt = max(0, int(counts[int(rack) - 1]))
    except (TypeError, ValueError, IndexError):
        return 0.0
    sag = _num(g.get("magazine_sag_mm"), 1.0)
    return -cnt * sag


def rack_x(g: dict, rack: int) -> float:
    """X-Position eines Regals — die EINZIGE Quelle dafür.

    Steht in `rack_geo[r]["x"]` ein eigener Wert, gilt der (absolut, so wie er
    gefahren wird). Sonst die Formel des Alt-Modells:

        x_unclamp + (Regale − r)·rack_x_gap + Δ-Korrektur[r]

    R1 = Regal DIREKT am Drucker, Rn = am Home-Anker (rechts). Der Fallback ist
    kein zweiter Speicher, sondern die Startbelegung für Anlagen, die noch keine
    eigenen Regal-Werte haben — er liefert exakt dieselben Zahlen wie bisher.
    """
    raw = (g.get("rack_geo") or {}).get(str(int(rack)))
    if isinstance(raw, dict) and raw.get("x") is not None:
        return _num(raw["x"])
    s = g["storage"]
    nr = int(g.get("racks", 1) or 1)
    xt = float(g.get("rack_x_trim", {}).get(str(rack), 0) or 0)
    return float(s["x_unclamp"]) + (nr - int(rack)) * float(s["rack_x_gap"]) + xt


def slot_position(g: dict, rack: int, slot: int) -> tuple[float, float, float, float]:
    """(x_unclamp, y_engage, z_flat, y_pullback_limit) für ein Fach.

    X/Y/Fachhöhe/Fach-Abstand kommen aus dem Regal (`rack_block`), damit
    unterschiedlich gebaute Regale nebeneinander stehen dürfen. Der Rückzugs-Y
    hängt an der PLATTE, nicht am Regal, und bleibt deshalb gemeinsam.
    """
    r = rack_block(g, rack)
    zt = float(g.get("rack_z_trim", {}).get(str(rack), 0) or 0)
    z = r["first_z"] + (int(slot) - 1) * (r["slot_gap"] + SLOT_Z_EXTRA) + zt
    return r["x"], r["y_engage"], z, float((g.get("storage") or {}).get("y_pullback_limit", 5))


def _magnet_z(g: dict) -> tuple[float, float, float]:
    """(lift, store_z, release) des Magnet-Greifers in mm.

    Grenzen, die eine Kollision verhindern und deshalb nicht der Eingabe überlassen
    bleiben: der Anhebeweg muss über 0 liegen (sonst hebt der Arm die Platte gar
    nicht an), und die Einfahrhöhe beim Ablegen muss über dem Anhebeweg liegen
    (sonst streift die getragene Platte das Fach darüber).
    """
    lift = max(1.0, _num(g.get("magnet_lift_mm"), MAGNET_LIFT_MM))
    store_z = max(lift + 1.0, _num(g.get("magnet_store_z_mm"), MAGNET_STORE_Z_MM))
    release = max(0.0, _num(g.get("magnet_release_mm"), MAGNET_RELEASE_MM))
    return lift, store_z, release


def _magnet_y(g: dict) -> tuple[float, float, float]:
    """(travel, clear, retract) des Magnet-Greifers in mm.

    travel  = Y, auf der die X-Fahrt zwischen den Regalen stattfindet. NICHT der
              Rückzugsanschlag: dort steht der Arm ganz hinten, und von da aus auf
              Fachhöhe zu gehen kostet nur Weg. 280 ist dieselbe Reise-Y, die auch
              der Original-Greifer benutzt.
    clear   = Abstand vor dem Fach, aus dem heraus langsam eingefahren wird.
    retract = Y nach dem Anheben. Der Arm trägt hier eine Platte und muss nur weit
              genug heraus, um frei zu sein — nicht bis an den Anschlag.
    """
    travel = max(0.0, _num(g.get("magnet_y_travel_mm"), MAGNET_Y_TRAVEL_MM))
    clear = max(1.0, _num(g.get("magnet_y_clear_mm"), MAGNET_Y_CLEAR_MM))
    retract = max(0.0, _num(g.get("magnet_y_retract_mm"), MAGNET_Y_RETRACT_MM))
    return travel, clear, retract


def _clamp_push(g: dict) -> float:
    """Klemm-Andruck-Weg (mm) — konfigurierbar, Default 30 (Original). 0 = ohne Andruck."""
    return _num(g.get("clamp_push_mm", 30), 30)


# Magnet-Greifer: Z-Wege statt X-Klemmweg.
#   HOVER = Höhe über der Platte, in der der Arm ins Fach einfährt bzw. sich nach dem
#           Ablegen wieder löst. Muss über der Platte liegen, sonst schiebt der Arm sie.
#   LIFT  = Anhebeweg mit Platte (wie beim Original-Griff).
# Beides ist über die Geometrie einstellbar (magnet_hover_mm / magnet_lift_mm) —
# die Konstanten sind nur die Startwerte. Beim Freischalten des Greifers (v1.1.21)
# waren sie am realen Aufbau noch nicht gemessen; fest eingebaut würde jeder
# danebenliegende Testlauf eine Code-Änderung erzwingen.
MAGNET_LIFT_MM = 15.0
MAGNET_STORE_Z_MM = 35.0
MAGNET_RELEASE_MM = 5.0
MAGNET_Y_CLEAR_MM = 42.0
MAGNET_Y_TRAVEL_MM = 280.0
MAGNET_Y_RETRACT_MM = 25.0


# Greifer, die magnetisch aufnehmen (Kennung aus hardware.js).
MAGNET_GRIPPERS = {"magnet"}


def gripper_motion(g: dict) -> str:
    """Greif-Art des verbauten Greifers: "clamp" (Original) oder "magnet".

    Maßgeblich ist der Greifer (gripper); gripper_motion übersteuert ihn nur,
    wenn es ausdrücklich gesetzt ist. Alles, was nicht als magnetisch bekannt ist,
    gilt als Original-Klemmung — eine unbekannte Kennung darf nie stillschweigend
    eine andere Bewegung fahren, als der Nutzer gebaut hat.
    """
    override = str(g.get("gripper_motion") or "").strip().lower()
    if override:
        return "magnet" if override == "magnet" else "clamp"
    return "magnet" if str(g.get("gripper") or "").strip().lower() in MAGNET_GRIPPERS else "clamp"


# ── Bewegungen (1:1 aus ottoeject_macros.cfg) ───────────────────────────────
def grab_from_rack(g: dict, rack: int, slot: int, nolift=None) -> list[str]:
    x_unclamp, y_engage, z_flat, y_pb = slot_position(g, rack, slot)
    mag = magazine_slot(g)
    if nolift is None:
        nolift = (mag > 0 and int(slot) == mag)
    # Magazin-Griff: Stapel hängt durch → Z pro Platte im Magazin absenken
    # (6 Platten → −6 mm). Gilt NUR für das Magazin-Fach, nie für normale Fächer.
    if mag > 0 and int(slot) == mag:
        z_flat += magazine_z_offset(g, rack)
    if gripper_motion(g) == "magnet":
        return _grab_magnet(g, rack, slot, x_unclamp, y_engage, z_flat, y_pb)
    x_mid = x_unclamp - _clamp_push(g)
    L = [f"M117 Grab rack {rack} slot {slot}..."]
    if nolift:
        L += [
            f"G1 X{_n(x_unclamp)} Y280 Z{_n(z_flat)} F4000", "M400",
            f"G1 Y{_n(y_engage-35)} F4000", "M400",
            f"G1 Y{_n(y_engage-25)} F600", "M400",
            f"G1 Y{_n(y_engage)} F300", "M400",
            f"G1 X{_n(x_mid)} F800", "M400",
            "M117 Picking up new bed (no lift)...",
            "G1 Y250 F1000", "M400",
            f"G1 Y{_n(y_pb)} F2000", "M400",
        ]
    else:
        L += [
            f"G1 X{_n(x_unclamp)} Y280 F4000", "M400",
            f"G1 Z{_n(z_flat)} F1000", "M400",
            f"G1 Y{_n(y_engage-35)} F4000", "M400",
            f"G1 Y{_n(y_engage-25)} F600", "M400",
            f"G1 Y{_n(y_engage)} F300", "M400",
            f"G1 X{_n(x_mid)} F800", "M400",
            "M117 Picking up new bed...",
            f"G1 Z{_n(z_flat+25)} F600", "M400",
            f"G1 Y250 Z{_n(z_flat+20)} F1000", "M400",
            f"G1 Y{_n(y_pb)} F2000", "M400",
        ]
    return L


def _grab_magnet(g, rack, slot, x_slot, y_engage, z_flat, y_pb) -> list[str]:
    """Platte mit dem Magnet-Greifer holen — nur Z, kein Weg nach links/rechts.

    Gemessen an Regal 3 Fach 1 (z_flat 15, y_engage 342):

        G1 Y280 · G1 Z15 · G1 Y300 · G1 Y342 · G1 Z30 · G1 Y25

    Der Arm fährt UNTER die Platte, schiebt sich unter sie und HEBT sie an — der
    Magnet zieht sie beim Anheben an den Greifer. Damit fällt die Unterscheidung
    Magazin/Lagerfach weg: flach gestapelt oder einzeln liegend ist dieselbe
    Bewegung — beim Original-Greifer brauchte nur das Magazin den NOLIFT-Sonderweg.

    Die X-Ausrichtung passiert auf der REISE-Y (280), nicht am Rückzugsanschlag:
    dort steht der Arm ganz hinten, und der Weg von da auf Fachhöhe ist verschenkt.
    """
    lift, _store_z, _release = _magnet_z(g)
    y_travel, y_clear, y_retract = _magnet_y(g)
    return [
        f"M117 Grab rack {rack} slot {slot} (magnet)...",
        f"G1 X{_n(x_slot)} Y{_n(y_travel)} F4000", "M400",   # X ausrichten, auf Reise-Y
        f"G1 Z{_n(z_flat)} F1000", "M400",                   # unter die Platte
        f"G1 Y{_n(y_engage - y_clear)} F4000", "M400",       # vor das Fach
        f"G1 Y{_n(y_engage)} F600", "M400",                  # unter die Platte einfahren
        "M117 Picking up new bed (magnet)...",
        f"G1 Z{_n(z_flat + lift)} F600", "M400",             # anheben → Platte haftet
        f"G1 Y{_n(y_retract)} F2000", "M400",                # mit Platte herausziehen
    ]


def _store_magnet(g, rack, slot, x_slot, y_engage, z_flat, y_pb) -> list[str]:
    """Platte mit dem Magnet-Greifer ablegen — nur Z, kein Weg nach links/rechts.

    Gemessen an Regal 3 Fach 1 (z_flat 15, y_engage 342):

        G1 Z50 · G1 Y342 · G1 Z10 · G1 Y300

    Der Arm kommt HÖHER herein als die Fachhöhe (store_z) und senkt sich dann UNTER
    sie (release). Damit ist auch das Ablösen geklärt, das vorher offen war: die
    Platte setzt auf dem Fach auf, der Arm fährt darunter weg und der Magnet lässt
    sie los — es braucht keinen Abstreifer.

    `magnet_store_x_mm` verschiebt die Ablege-X gegenüber der Greif-X (Standard 0 =
    dieselbe). Der Wert steht getrennt, weil die gemessene Bewegung keine X-Fahrt
    enthält, das Ablegen aber je nach Aufbau versetzt sein kann.

    Die X-Ausrichtung passiert hier BEWUSST am Rückzugsanschlag und nicht auf der
    Reise-Y wie beim Greifen: der Arm trägt an dieser Stelle einen fertigen Druck.
    Ihn 275 mm weiter vorn quer durch die Anlage zu fahren, ist eine andere Zusage
    als mit leerem Greifer — die gehört gemessen, nicht abgeleitet.
    """
    _lift, store_z, release = _magnet_z(g)
    _y_travel, y_clear, _y_retract = _magnet_y(g)
    x_store = x_slot + _num(g.get("magnet_store_x_mm"), 0.0)
    return [
        f"M117 Store rack {rack} slot {slot} (magnet)...",
        f"G1 X{_n(x_store)} Y{_n(y_pb)} F4000", "M400",      # X ausrichten, zurückgezogen
        f"G1 Z{_n(z_flat + store_z)} F1000", "M400",         # über Fachhöhe anheben
        f"G1 Y{_n(y_engage - y_clear)} F2000", "M400",       # vor das Fach
        f"G1 Y{_n(y_engage)} F600", "M400",                  # über das Fach einfahren
        f"G1 Z{_n(z_flat - release)} F300", "M400",          # absenken → Platte bleibt liegen
        f"G1 Y{_n(y_engage - y_clear)} F2000", "M400",       # unter der Platte herausziehen
    ]


def store_to_rack(g: dict, rack: int, slot: int) -> list[str]:
    x_unclamp, y_engage, z_flat, y_pb = slot_position(g, rack, slot)
    if gripper_motion(g) == "magnet":
        return _store_magnet(g, rack, slot, x_unclamp, y_engage, z_flat, y_pb)
    x_mid = x_unclamp - _clamp_push(g)
    return [
        f"M117 Store rack {rack} slot {slot}...",
        f"G1 X{_n(x_mid)} Y{_n(y_pb)} Z{_n(z_flat+35)} F4000", "M400",
        "G1 Y60 F2000", "M400",
        f"G1 Y{_n(y_engage-15)} Z{_n(z_flat+25)} F1000", "M400",
        f"G1 Y{_n(y_engage+2)} F500", "M400",
        f"G1 Z{_n(z_flat+10)} F300", "M400",
        f"G1 Z{_n(z_flat)} Y{_n(y_engage+1)} F600", "M400",
        f"G1 Y{_n(y_engage)} F600",
        f"G1 X{_n(x_unclamp)} F800", "M400",
        "G1 Y300 F800",
        "G1 Y280 F3000", "M400",
    ]


def move_to_printer(g: dict, printer=None) -> list[str]:
    """Nur VOR den Drucker fahren (sichere Anfahrt) — greift/wirft nicht.
    Eigene Operation für einen schnellen, feinjustierbaren Wechsel: erst hierher fahren,
    dann eject bzw. place mit eigener Geschwindigkeit. Eigene Anfahr-Position `move`
    (Fallback: eject-Position)."""
    pb = printer_block(g, printer)
    p = pb.get("move") or pb["eject"]
    x = float(p["x"])
    y_engage, z_flat = float(p["y"]), float(p["z"])
    y_pb = float(g["storage"]["y_pullback_limit"])
    return [
        f"M117 Moving to {pb['name']}...",
        f"G1 Z{_n(z_flat)} Y{_n(y_pb)} F3000", "M400",   # sichere Höhe + auf y_pullback zurückziehen (=5)
        f"G1 X{_n(x)} F3000", "M400",                     # auf Drucker-X ausrichten; Y bleibt bei y_pullback
        # ENDET bei Y=y_pullback (5) — NICHT vorne an der Druckerfront (Nutzerwunsch):
        # eject/place fahren selbst aus dieser zurückgezogenen Position an die Front.
    ]


def eject_from_printer(g: dict, printer=None) -> list[str]:
    pb = printer_block(g, printer)
    p = pb["eject"]
    x_unclamp = float(p["x"])
    y_engage, z_flat = float(p["y"]), float(p["z"])
    y_pb = float(g["storage"]["y_pullback_limit"])
    x_mid = x_unclamp + _clamp_push(g)
    return [
        f"M117 Removing build plate from {pb['name']}...",
        f"G1 Z{_n(z_flat)} Y{_n(y_engage-90)} F3000", "M400",
        f"G1 Y{_n(y_engage-80)} F3000", "M400",
        f"G1 X{_n(x_unclamp)} F3000", "M400",
        f"G1 Y{_n(y_engage-20)} F3000",
        f"G1 Y{_n(y_engage)} F600", "M400",
        f"G1 X{_n(x_unclamp+5)} F600", "M400",
        f"G1 X{_n(x_mid)} F2000", "M400",
        f"G1 Z{_n(z_flat+52)} F1000",
        f"G1 Y{_n(y_engage-100)} Z{_n(z_flat+49)} F3000",
        f"G1 Y{_n(y_engage-150)} Z{_n(z_flat+45)} F3000",
        f"G1 Y{_n(y_engage-200)} Z{_n(z_flat+35)} F3000",
        f"G1 Y{_n(y_engage-250)} Z{_n(z_flat+30)} F3000",
        f"G1 Y{_n(y_engage-300)} Z{_n(z_flat+15)} F3000",
        f"G1 Y{_n(y_pb)} Z30 F3000", "M400",
    ]


def load_onto_printer(g: dict, printer=None) -> list[str]:
    pb = printer_block(g, printer)
    p = pb["load"]
    x_unclamp = float(p["x"])
    y_engage, z_flat = float(p["y"]), float(p["z"])
    y_pb = float(g["storage"]["y_pullback_limit"])
    x_mid = x_unclamp + _clamp_push(g)
    return [
        f"M117 Moving build plate to {pb['name']}...",
        f"G1 Z{_n(z_flat+55)} Y{_n(y_pb)} F1000", "M400",
        f"G1 X{_n(x_mid)} F3000", "M400",
        f"G1 Y50 Z{_n(z_flat+40)} F1000", "M400",
        f"G1 Y{_n(y_engage-20)} F3000", "M400",
        f"G1 Y{_n(y_engage+3)} F600",
        f"G1 Z{_n(z_flat)} Y{_n(y_engage+0.5)} F1500", "M400",
        f"G1 Y{_n(y_engage)} F600",
        f"G1 X{_n(x_unclamp+15)} F600",
        f"G1 X{_n(x_unclamp)} F1500", "M400",
        "G1 Y320 F1500",
        "G1 Y280 F4000", "M400",
    ]


# ── Tür (Form gemessen am Referenz-Aufbau) ──────────────────────────────────
# Die Bewegung ist 1:1 die gemessene; die EINGEGEBENEN X/Y/Z sind der erste
# Fahrpunkt, alles andere sind Versätze davon. Damit wandert die ganze Form mit,
# wenn der Drucker woanders steht — ohne dass jemand die Zwischenpunkte kennt.
#
# Referenz „Tür öffnen" (erster Fahrpunkt X720 Y280, Z85, Bogenradius 356.6):
#   Z85 · X720 Y280 · Y343 · Z115 · Y323 · X720 Y323 · G3 X1075 Y0 I355 J33.6
#   · Z85 · X970 · Z120 · X1020
DOOR_REACH_MM = 63.0      # Y-Zustellung zum Türblatt (Y343 = 280+63)
DOOR_ENGAGE_MM = 30.0     # Z-Hub, mit dem der Stift hinter die Tür greift (115 = 85+30)
DOOR_HOOK_MM = 43.0       # Y, auf dem der Bogen beginnt (Y323 = 280+43)
DOOR_CLEAR_MM = 35.0      # Z-Hub beim Freifahren nach dem Öffnen (120 = 85+35)
DOOR_BACKOFF_MM = 105.0   # X-Rückzug vom Bogenende (970 = 1075−105)
DOOR_PARK_MM = 55.0       # X-Endposition vom Bogenende (1020 = 1075−55)
#
# Referenz „Tür schließen" (erster Fahrpunkt X1065 Y0, Z85):
#   Z85 · X1065 Y0 · Z115 · X965 · G2 X723 Y280 I109.1 J338.9 · Z85 · X815 Y119
#   · Z135 · X735 Y330 · Y250
DOOR_CLOSE_RUNUP_MM = 100.0   # X-Anlauf vor dem Bogen (965 = 1065−100)
DOOR_CLOSE_PUSH_MM = 3.0      # Bogenende drückt über die Zu-Position hinaus (723 = 720+3)
DOOR_CLOSE_LIFT_MM = 50.0     # Z-Hub beim Freifahren (135 = 85+50)
DOOR_CLOSE_OFF = ((92.0, -161.0), (12.0, 50.0))   # Rückzugspunkte relativ zur Zu-Position
DOOR_CLOSE_END_Y_MM = -30.0                        # letzte Y-Fahrt (250 = 280−30)


def _door_open_arc(x_start: float, y_start: float, d: float) -> tuple[float, float, float]:
    """(I, J, Ziel-X) des Öffnungs-Bogens.

    Die Tür schwingt um ihr Scharnier (Abstand `d`) bis auf Y 0 — dort steht sie
    offen. Der Mittelpunkt liegt also senkrecht über dem Bogenende, und aus
    |Mitte−Ende| = d folgt J = d − y_start und daraus I. Bei einem `d`, das kleiner
    als y_start ist, gäbe es keinen solchen Bogen; dann bleibt der Arm auf y_start
    (I = d), statt eine Wurzel aus einer negativen Zahl zu ziehen.
    """
    j = d - y_start
    inner = d * d - j * j
    i = math.sqrt(inner) if inner > 0 else d
    return i, j, x_start + i


def _door_close_arc(sx, sy, ex, ey, d):
    """(I, J) des Schließ-Bogens von (sx,sy) nach (ex,ey) mit Radius d.

    Der Mittelpunkt liegt auf der Mittelsenkrechten der Sehne; von den zwei
    möglichen Seiten ist die mit dem GRÖSSEREN Y die richtige — die Tür schwingt
    um ein Scharnier hinter der Maschine. Ist der Radius für die Sehne zu klein
    (unmögliche Geometrie durch einen Zahlendreher), wird auf den Halbkreis
    zurückgefallen, statt eine negative Wurzel zu ziehen.
    """
    mx, my = (sx + ex) / 2.0, (sy + ey) / 2.0
    dx, dy = ex - sx, ey - sy
    chord = math.hypot(dx, dy)
    if chord == 0:
        return d, 0.0
    h2 = d * d - (chord / 2.0) ** 2
    h = math.sqrt(h2) if h2 > 0 else 0.0
    px, py = -dy / chord, dx / chord          # Einheits-Normale der Sehne
    if py < 0:
        px, py = -px, -py                      # immer die Seite mit größerem Y
    cx, cy = mx + h * px, my + h * py
    return cx - sx, cy - sy


def open_door(g: dict, printer=None) -> list[str]:
    door = (printer_block(g, printer).get("door") or {}).get("open")
    if not door:
        return ["M117 (no door macro)"]
    fx, fy, fz = float(door["x"]), float(door["y"]), float(door["z"])
    d = float(door["d"])
    z_engage = fz + DOOR_ENGAGE_MM
    y_hook = fy + DOOR_HOOK_MM
    i_val, j_val, arc_x = _door_open_arc(fx, y_hook, d)
    return [
        "M117 Opening door...",
        f"G1 Z{_n(fz)} F1000", "M400",
        f"G1 X{_n(fx)} Y{_n(fy)} F3000", "M400",
        f"G1 Y{_n(fy + DOOR_REACH_MM)} F3000", "M400",
        f"G1 Z{_n(z_engage)} F1000", "M400",
        f"G1 Y{_n(y_hook)} F1000", "M400",
        f"G1 X{_n(fx)} Y{_n(y_hook)} F500", "M400",
        f"G3 X{_n(arc_x)} Y0 I{_n(i_val)} J{_n(j_val)} F3000", "M400",
        f"G1 Z{_n(fz)} F3000", "M400",
        f"G1 X{_n(arc_x - DOOR_BACKOFF_MM)} F5000", "M400",
        f"G1 Z{_n(fz + DOOR_CLEAR_MM)} F10000", "M400",
        f"G1 X{_n(arc_x - DOOR_PARK_MM)} F3000", "M400",
        "M117 Door opened",
    ]


def close_door(g: dict, printer=None) -> list[str]:
    doors = printer_block(g, printer).get("door") or {}
    door = doors.get("close") or doors.get("open")
    if not door:
        return ["M117 (no door macro)"]
    kx, ky, kz = float(door["x"]), float(door["y"]), float(door["z"])
    d = float(door["d"])
    # Die ZU-Position ist der erste Fahrpunkt von „Tür öffnen": dort steht der Arm
    # an der geschlossenen Tür. Ohne diesen Bezug bräuchte das Schließen einen
    # zweiten, getrennt gepflegten Punkt für dieselbe Stelle — zwei Speicher für
    # eine Zahl, die auseinanderlaufen. Fehlt „öffnen", gilt der eigene Punkt.
    op = doors.get("open") or door
    ex = float(op["x"]) + DOOR_CLOSE_PUSH_MM
    ey = float(op["y"])
    sx = kx - DOOR_CLOSE_RUNUP_MM
    i_val, j_val = _door_close_arc(sx, ky, ex, ey, d)
    (ax, ay), (bx, by) = DOOR_CLOSE_OFF
    return [
        "M117 Closing door...",
        f"G1 Z{_n(kz)} F1000", "M400",
        f"G1 X{_n(kx)} Y{_n(ky)} F3000", "M400",
        f"G1 Z{_n(kz + DOOR_ENGAGE_MM)} F3000", "M400",
        f"G1 X{_n(sx)} F3000", "M400",
        f"G2 X{_n(ex)} Y{_n(ey)} I{_n(i_val)} J{_n(j_val)}", "M400",
        f"G1 Z{_n(kz)} F3000", "M400",
        f"G1 X{_n(ex + ax)} Y{_n(ey + ay)}", "M400",
        f"G1 Z{_n(kz + DOOR_CLOSE_LIFT_MM)} F3000", "M400",
        f"G1 X{_n(ex + bx)} Y{_n(ey + by)} F3000", "M400",
        f"G1 Y{_n(ey + DOOR_CLOSE_END_Y_MM)} F5000",
        "M117 Door closed",
    ]


def approach_slot(g: dict, rack: int, slot: int) -> list[str]:
    """Nur vor das Fach fahren (zum Kalibrieren) — greift nicht."""
    x_unclamp, y_engage, z_flat, _ = slot_position(g, rack, slot)
    return [
        "G90",
        f"G1 X{_n(x_unclamp)} Y280 Z{_n(z_flat)} F3000",
    ]


def park() -> list[str]:
    return ["M117 Parking...", "G1 X10 Y280 Z10 F3000", "M400", "M84"]


# ── Dispatcher ──────────────────────────────────────────────────────────────
def _speed_prefix(g: dict, op: str | None = None, printer=None) -> str:
    """M220-Vorschubfaktor (%) für den App-G-code. Reihenfolge: Drucker-eigener Wert
    (nur Drucker-Ops) → speed_factors[op] → globaler speed_factor → 100.
    100 = normal → kein Prefix."""
    val = None
    if op:
        key = canon_op(op)
        if key in PRINTER_OPS:
            val = (printer_block(g, printer).get("speed_factors") or {}).get(key)
        sf = g.get("speed_factors")
        if val is None and isinstance(sf, dict):
            val = sf.get(op, sf.get(key))
    if val is None:
        val = g.get("speed_factor", 100)
    try:
        f = int(val or 100)
    except (TypeError, ValueError):
        f = 100
    f = max(10, min(500, f))
    return f"M220 S{f}\n" if f != 100 else ""


def _guard(script: str, g: dict, op: str, rack: int, slot: int, check: bool) -> str:
    """Letzte Instanz vor dem Senden: verlässt die Bewegung die Achsen, wird sie NICHT
    ausgeliefert, sondern als GeometryError gemeldet (mit Achse, Wert und Grenze).
    Sonst bräche Klipper sie mitten im Ablauf ab — womöglich mit Platte im Greifer.
    Import bewusst hier drin: geometry_check baut selbst G-code über build_op."""
    if not check:
        return script
    from app.services import geometry_check
    problems = geometry_check.check_script(script, g, op, rack, slot)
    errors = [p for p in problems if p.get("severity") == "error"]
    if errors:
        raise geometry_check.GeometryError(errors)
    return script


# ── Platzhalter im eigenen G-code ───────────────────────────────────────────
# Damit EIN eigener G-code über alle Regale und Fächer skaliert, statt fixe
# Koordinaten zu enthalten, die jedes Regal an dieselbe Stelle schicken. Seit
# v1.1.11 mit Rechenweg: {slot_z+25} ist die Fachhöhe plus 25 mm. Ohne das ließe
# sich die eingebaute Bewegung (die genau solche Versätze fährt) nicht als
# bearbeitbare Vorlage ausdrücken.
_PLACEHOLDER_RE = re.compile(
    r"\{(rack_x|slot_z|mag_z|y_engage|y_pullback|rack|slot)\s*([+-]\s*\d+(?:\.\d+)?)?\}")


def fill_placeholders(text: str, g: dict, rack: int, slot: int) -> str:
    rx, ry, rz, ypb = slot_position(g, rack, slot)
    mag = magazine_slot(g)
    # {mag_z} inkl. Durchbiegungs-Absenkung (pro Platte im Magazin, s. magazine_z_offset)
    magz = (slot_position(g, rack, mag)[2] + magazine_z_offset(g, rack)) if mag > 0 else rz
    values = {"rack_x": rx, "slot_z": rz, "mag_z": magz, "y_engage": ry,
              "y_pullback": ypb, "rack": int(rack), "slot": int(slot)}

    def _sub(m):
        name, off = m.group(1), m.group(2)
        val = values[name]
        if off:
            if name in ("rack", "slot"):
                return m.group(0)      # Nummern rechnen nicht — das wäre ein anderes Fach
            val = float(val) + float(off.replace(" ", ""))
        return f"{val:g}" if isinstance(val, float) else str(val)

    return _PLACEHOLDER_RE.sub(_sub, text)


# Weit auseinanderliegende Marker: der erzeugte G-code rechnet mit Versätzen von
# höchstens ein paar hundert mm, damit bleibt jeder Wert eindeutig einem Marker
# zuzuordnen (siehe _to_placeholders).
_TPL_MARK = {"rack_x": 100000.0, "y_engage": 200000.0, "slot_z": 300000.0,
             "y_pullback": 400000.0}
_COORD_RE = re.compile(r"\b([XYZ])(-?\d+(?:\.\d+)?)", re.IGNORECASE)


def _to_placeholders(script: str) -> str:
    """Marker-Zahlen wieder in Platzhalter zurückübersetzen."""
    def _sub(m):
        try:
            v = float(m.group(2))
        except ValueError:
            return m.group(0)
        for name, base in _TPL_MARK.items():
            d = round(v - base, 3)
            if abs(d) < 5000:
                return f"{m.group(1)}{{{name}}}" if d == 0 else f"{m.group(1)}{{{name}{d:+g}}}"
        return m.group(0)
    return _COORD_RE.sub(_sub, script)


def op_template(g: dict, op: str, rack: int = 1, slot: int = 1) -> str:
    """Die EINGEBAUTE Bewegung als bearbeitbare Vorlage — mit Platzhaltern statt
    fertiger Koordinaten.

    Ohne das wäre ein eigener G-code fürs Ablegen unbrauchbar: die Vorschau eines
    Fachs enthält dessen konkrete Zahlen, ein daraus bearbeiteter G-code führe
    jedes Regal und jedes Fach an dieselbe Stelle. So bleibt die Zuordnung
    „Regal 1 Fach 3" Sache von Printloom, und nur die Bewegung danach gehört dem
    Nutzer. G90/M220 fehlen bewusst — die setzt build_op selbst davor.
    """
    g = merge_defaults(deepcopy(g or {}))
    g["gcode_override"] = {}          # die Vorlage ist die berechnete Bewegung
    for p in g.get("printers") or []:
        if isinstance(p, dict):
            p["gcode_override"] = {}
    rg = dict(g.get("rack_geo") or {})
    rg[str(rack)] = {**(rg.get(str(rack)) or {}),
                     "x": _TPL_MARK["rack_x"], "y_engage": _TPL_MARK["y_engage"],
                     "first_z": _TPL_MARK["slot_z"]}
    g["rack_geo"] = rg
    g["storage"] = {**(g.get("storage") or {}), "y_pullback_limit": _TPL_MARK["y_pullback"]}
    g["magazine_counts"] = []         # keine Durchbiegung in die Vorlage einrechnen
    script = build_op(g, op, rack=rack, slot=1, check=False)
    lines = [ln for ln in _to_placeholders(script).splitlines()
             if not ln.startswith("G90") and not ln.startswith("M220")]
    # Das abschließende M400 bleibt bewusst doppelt stehen: build_op hängt es an den
    # eingebauten Ablauf an, der selbst schon damit endet. Wer die Vorlage unverändert
    # übernimmt, bekommt dadurch Zeichen für Zeichen dieselbe Sendung — das ist mehr
    # wert als eine aufgeräumt aussehende Vorlage.
    # Auch der Anzeigetext soll mitwandern statt „rack 1 slot 1" zu behaupten.
    out = re.sub(r"(?im)^(M117\s+.*?)\brack\s+\d+\s+slot\s+\d+",
                 r"\1rack {rack} slot {slot}", "\n".join(lines))
    return out.strip()


def op_override(g: dict, op: str, printer=None):
    """Eigener G-code dieser Operation (oder None). Drucker-Operationen liegen beim
    jeweiligen Drucker, Regal-Operationen gemeinsam."""
    key = canon_op(op)
    if key in PRINTER_OPS:
        ov = (printer_block(g, printer).get("gcode_override") or {})
        v = ov.get(key, ov.get(op))
        if isinstance(v, str) and v.strip():
            return v
        if key in ov or op in ov:
            return None     # Drucker hat einen (leeren) Eintrag → gilt, kein Rückfall
    ov = g.get("gcode_override") or {}
    v = ov.get(op, ov.get(key))
    return v if isinstance(v, str) and v.strip() else None


def build_op(g: dict, op: str, rack: int = 1, slot: int = 1, nolift=None,
             check: bool = True, printer=None) -> str:
    """G-code einer Operation aus der Geometrie. `check=False` überspringt die
    Achsprüfung (Vorschau/Anzeige — die soll auch kaputte Werte zeigen können).
    `printer` = id/Index des Druckers bei Drucker-Operationen (ohne Angabe: der erste)."""
    g = _sanitize_geometry(merge_defaults(g))
    op = (op or "").lower()
    if op == "speed":   # nur den globalen Vorschubfaktor live setzen
        s = _speed_prefix(g)
        return (s or "M220 S100\n").rstrip() + "\nM400"
    # Absolute Positionierung ERZWINGEN, G90 ZUERST: Der OTTOeject/Klipper kann durch
    # manuelles Jog in Mainsail im relativen Modus (G91) stehen — dann würde „G1 X1020"
    # als +1020 ab Ist-Position ausgeführt → „Move out of range". G90 macht ALLE
    # Op-Koordinaten verlässlich absolut. G90 an den ANFANG (vor M220), damit der
    # Transport-Guard (startswith G90) es erkennt und kein zweites G90 voranstellt.
    speed = "G90\n" + _speed_prefix(g, op, printer)   # Vorschub PRO Operation (Fallback global)
    # Eigener G-code hat Vorrang, sobald für DIESE Operation ein Override gesetzt ist —
    # beim „Custom Printer" ist das der einzige Modus, bei benannten Druckern eine
    # optionale Feinjustage pro Op (Tür/Move/Eject/Place). Kein Override → berechnete
    # Bewegung aus den Positions-Werten.
    ov = op_override(g, op, printer)
    if isinstance(ov, str) and ov.strip():
        # Platzhalter, damit EIN eigener G-code über alle Regale/Fächer skaliert — statt fixer
        # Koordinaten, die jedes Regal an denselben Punkt schicken. Werte aus der Kalibrierung
        # (x_unclamp/rack_x_gap/first_z_flat/slot_gap); R1 = druckerseitig (siehe slot_position):
        #   {rack_x}=X-Position des Regals · {slot_z}=Z-Höhe des Fachs · {mag_z}=Z des Magazin-
        #   fachs · {y_engage}/{y_pullback}=Y-Werte · {rack}/{slot}=Nummern.
        s = fill_placeholders(ov, g, rack, slot).strip()
        return _guard(speed + (s if s.rstrip().endswith("M400") else s + "\nM400"),
                      g, op, rack, slot, check)
    if op == "grab":
        lines = grab_from_rack(g, rack, slot, nolift)
    elif op in ("grab_magazine", "grab_mag"):
        # Frische Platte aus dem Magazin-Fach (global, z. B. 7) des Regals — IMMER NOLIFT
        # (die Platten liegen flach gestapelt, kein Anheben ins Fach nötig).
        mag = magazine_slot(g)
        lines = grab_from_rack(g, rack, mag if mag > 0 else slot, nolift=True)
    elif op == "store":
        lines = store_to_rack(g, rack, slot)
    elif op in ("move_to_printer", "move"):
        lines = move_to_printer(g, printer)
    elif op == "eject":
        lines = eject_from_printer(g, printer)
    elif op in ("place", "load"):   # place = neuer Name, load = Alias (Rückwärtskompat.)
        lines = load_onto_printer(g, printer)
    elif op in ("open_door", "opendoor"):
        lines = open_door(g, printer)
    elif op in ("close_door", "closedoor"):
        lines = close_door(g, printer)
    elif op == "approach":
        lines = approach_slot(g, rack, slot)
    elif op == "park":
        lines = park()
    elif op == "home":
        lines = ["OTTOEJECT_HOME"]
    else:
        raise ValueError(f"Unbekannte Operation: {op}")
    return _guard(speed + "\n".join(lines) + "\nM400", g, op, rack, slot, check)
