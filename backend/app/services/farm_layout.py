"""Farm-Layout: Drucker und Regale als Module auf EINER X-Schiene.

Warum das nötig war
───────────────────
Bis v1.1.2 kannte Printloom genau EINEN Drucker und rechnete die X-Position jedes
Regals aus einer Formel:

    rack_x(r) = x_unclamp + (Regale − r) · rack_x_gap + rack_x_trim[r]

Das setzt voraus, dass alle Regale gleich breit sind und in gleichmäßigem Abstand
stehen. Sobald ein zweiter Drucker dazukommt oder ein Regal anders gebaut ist,
stimmt die Formel nicht mehr — und jede Korrektur über `rack_x_trim` ist Kosmetik
an einer falschen Annahme.

Das Layout dreht das um: JEDES Modul hat seine eigene, absolute X-Referenz in mm.
Die Formel bleibt nur noch die Quelle für die MIGRATION (siehe `from_geometry`) —
sie erzeugt exakt die Werte, die vorher gerechnet wurden, damit sich bei der
Umstellung keine einzige Position verschiebt.

Aufbau
──────
    [Home (rechts, X = 0)] … [Rack n] … [Rack 2] [Rack 1] [Drucker]

`home` ist der feste Anker (Endschalter). Module werden nach X sortiert gehalten.

Sperre
──────
Falsche X-Werte fahren den Arm gegen die Mechanik. Das Layout ist deshalb
standardmäßig GESPERRT (`locked`), und bei laufender Farm lässt es sich gar nicht
erst entsperren (das entscheidet der Aufrufer, siehe routers/layout.py).
"""
from __future__ import annotations

from app.services.geometry_check import problem

TYPES = ("printer", "rack", "home")

# Zwei Module dürfen sich nicht dieselbe Stelle teilen — darunter ist es eine
# Verwechslung, kein Aufbau.
MIN_GAP_MM = 20.0


def _num(v, d=0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return float(d)
    return f if f == f else float(d)      # NaN → Default


def _int(v, d=0) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return d


def default_layout() -> dict:
    return {"locked": True, "modules": [], "migrated_from": None}


# ── Migration aus der Formel-Geometrie ───────────────────────────────────────
def from_geometry(geometry: dict, rack_cfg: dict = None, devices: list = None) -> dict:
    """Bestehende Ein-Drucker-Installation → gleichwertiges Layout.

    Die X-Werte kommen aus GENAU der Formel, die bisher gerechnet wurde, inklusive
    `rack_x_trim`. Ergebnis: identische Positionen, nur anders gespeichert. Genau
    das ist die Bedingung dafür, dass ein laufender Aufbau nach dem Update ohne
    Neu-Einmessen weiterläuft.
    """
    g = geometry or {}
    s = g.get("storage") or {}
    cfg = rack_cfg or {}

    racks = max(1, _int(cfg.get("num_racks") or g.get("racks"), 1))
    x_unclamp = _num(s.get("x_unclamp"), 43)
    gap = _num(s.get("rack_x_gap"), 250)
    trims = g.get("rack_x_trim") or {}

    modules = [{"id": "home", "type": "home", "name": "Home", "x_ref": 0.0}]

    for r in range(1, racks + 1):
        x = x_unclamp + (racks - r) * gap + _num(trims.get(str(r)), 0)
        modules.append({
            "id": f"rack-{r}",
            "type": "rack",
            "name": f"Regal {r}",
            "x_ref": round(x, 3),
            "slots": max(1, _int(cfg.get("slots_per_rack") or g.get("storage_slots"), 6)),
            "slot_height_mm": _num(cfg.get("slot_height_mm"), 50),
            # Fach-Abstand und erste Fachhöhe bleiben vorerst global (Geometrie) —
            # je Regal einstellbar zu machen ist ein eigener Schritt.
            "magazine_slot": max(0, _int(cfg.get("magazine_slot") or g.get("magazine_slot"), 0)),
            "printer": "printer-1",           # Standard: alle Regale gehören dem Drucker
            "legacy_rack": r,                 # Verbindung zur bisherigen Fach-Adresse „r-s"
        })

    # Der Drucker sitzt am druckerseitigen Ende: bisher eject.x + (Regale−1)·gap.
    p = (g.get("printer") or {}).get("eject") or {}
    printer_x = _num(p.get("x"), 442) + (racks - 1) * gap
    dev = (devices or [{}])[0] if devices else {}
    modules.append({
        "id": "printer-1",
        "type": "printer",
        "name": dev.get("name") or g.get("printer_name") or "Drucker",
        "x_ref": round(printer_x, 3),
        "device_id": dev.get("id"),
        "model": dev.get("model") or "",
        "enabled": True,
    })
    return {"locked": True, "modules": sort_modules(modules), "migrated_from": "formula"}


# ── Normalisieren / Prüfen ───────────────────────────────────────────────────
def sort_modules(modules: list) -> list:
    """Module nach X sortiert halten — die Schiene ist eindimensional, also ist die
    Reihenfolge kein Freiheitsgrad, sondern folgt aus den Werten."""
    return sorted(modules or [], key=lambda m: _num(m.get("x_ref")))


def clean(layout: dict) -> dict:
    """Layout auf gültige Felder bringen (unbekannte Typen/Felder fliegen raus)."""
    lay = layout if isinstance(layout, dict) else {}
    out = []
    seen = set()
    for raw in lay.get("modules") or []:
        if not isinstance(raw, dict):
            continue
        typ = str(raw.get("type", "")).lower()
        if typ not in TYPES:
            continue
        mid = str(raw.get("id") or "").strip() or f"{typ}-{len(out) + 1}"
        if mid in seen:
            continue
        seen.add(mid)
        mod = {"id": mid, "type": typ,
               "name": str(raw.get("name") or mid)[:60],
               "x_ref": round(_num(raw.get("x_ref")), 3)}
        if typ == "rack":
            mod.update({
                "slots": max(1, min(20, _int(raw.get("slots"), 6))),
                "slot_height_mm": max(1.0, _num(raw.get("slot_height_mm"), 50)),
                "magazine_slot": max(0, min(20, _int(raw.get("magazine_slot"), 0))),
                "printer": str(raw.get("printer") or "") or None,
                "legacy_rack": _int(raw.get("legacy_rack"), 0) or None,
            })
        elif typ == "printer":
            mod.update({
                "device_id": raw.get("device_id"),
                "model": str(raw.get("model") or ""),
                "enabled": bool(raw.get("enabled", True)),
            })
        out.append(mod)
    return {"locked": bool(lay.get("locked", True)),
            "modules": sort_modules(out),
            "migrated_from": lay.get("migrated_from")}


def check(layout: dict, limits: dict = None) -> list:
    """Plausibilität des Layouts → Liste von Problemen (leer = ok).

    Gleiche Idee wie bei der Geometrie-Prüfung: lieber vorher meckern als den Arm
    gegen etwas fahren lassen."""
    lay = clean(layout)
    mods = lay["modules"]
    problems = []

    printers = [m for m in mods if m["type"] == "printer"]
    racks = [m for m in mods if m["type"] == "rack"]
    if not printers:
        problems.append(problem("no_printer", "error", "Kein Drucker im Layout."))
    if not racks:
        problems.append(problem("no_rack", "warning",
                                "Kein Regal im Layout — die Farm hat keinen Ablageplatz."))

    for m in mods:
        x = _num(m.get("x_ref"))
        if x < 0:
            problems.append(problem(
                "x_below_zero", "error",
                "„{0}“ steht bei X {1} mm — unter dem Endschalter (0 mm).",
                [m["name"], f"{x:g}"], module=m["id"]))
        if limits and limits.get("x") and x > limits["x"]:
            problems.append(problem(
                "x_above_limit", "error",
                "„{0}“ steht bei X {1} mm — über der Achsgrenze X {2} mm.",
                [m["name"], f"{x:g}", f"{limits['x']:g}"], module=m["id"]))

    ordered = sort_modules(mods)
    for a, b in zip(ordered, ordered[1:]):
        d = _num(b.get("x_ref")) - _num(a.get("x_ref"))
        if d < MIN_GAP_MM:
            problems.append(problem(
                "too_close", "error" if d <= 0 else "warning",
                "„{0}“ und „{1}“ stehen {2} mm auseinander — unter {3} mm ist das eine "
                "Verwechslung.",
                [a["name"], b["name"], f"{d:g}", f"{MIN_GAP_MM:g}"], module=b["id"]))

    ids = {m["id"] for m in mods}
    for r in racks:
        if r.get("printer") and r["printer"] not in ids:
            problems.append(problem(
                "orphan_rack", "warning",
                "„{0}“ ist einem Drucker zugeordnet, den es nicht (mehr) gibt.",
                [r["name"]], module=r["id"]))

    dev_ids = [p.get("device_id") for p in printers if p.get("device_id") is not None]
    if len(dev_ids) != len(set(dev_ids)):
        problems.append(problem("duplicate_device", "error",
                                "Zwei Drucker-Module zeigen auf dasselbe Gerät."))
    return problems


# ── Abfragen fürs Fahren ─────────────────────────────────────────────────────
def rack_x_map(layout: dict) -> dict:
    """{Regal-Nr (bisherige Zählung): X-Position} — das ist die Brücke zur
    bestehenden Bewegungsrechnung: `slot_position` nimmt diese Werte, statt die
    Formel zu rechnen."""
    out = {}
    for m in clean(layout)["modules"]:
        if m["type"] != "rack":
            continue
        nr = m.get("legacy_rack")
        if nr:
            out[int(nr)] = _num(m.get("x_ref"))
    return out


def printer_x(layout: dict, module_id: str = None) -> float | None:
    """Absolute X eines Drucker-Moduls (ohne Angabe: das erste)."""
    for m in clean(layout)["modules"]:
        if m["type"] == "printer" and (module_id is None or m["id"] == module_id):
            return _num(m.get("x_ref"))
    return None


def printers(layout: dict) -> list:
    return [m for m in clean(layout)["modules"] if m["type"] == "printer"]


def racks_for_printer(layout: dict, printer_id: str) -> list:
    """Regale, die diesem Drucker zugeordnet sind. Ohne Zuordnung gilt: gemeinsamer
    Pool — dann bekommt jeder Drucker alle Regale."""
    mods = [m for m in clean(layout)["modules"] if m["type"] == "rack"]
    assigned = [m for m in mods if m.get("printer") == printer_id]
    return assigned if assigned else [m for m in mods if not m.get("printer")] or mods
