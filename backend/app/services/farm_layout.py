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


# ── Ableitung aus der Drucker-Geometrie ──────────────────────────────────────
def from_geometry(geometry: dict, rack_cfg: dict = None, devices: list = None) -> dict:
    """Layout aus der Drucker-Geometrie ABLEITEN — keine eigene Datenhaltung für X.

    Bis v1.1.7 gab es die X-Positionen zweimal: im Drucker-Tab (Start-X + Versatz
    + Δ je Regal) und noch einmal als eigene X-Referenz je Modul im Farm-Layout.
    Beide wurden getrennt gepflegt und liefen auseinander — der Test-Knopf fuhr
    nach der Formel, die Farm nach dem Layout. Deshalb gibt es nur noch EINE
    Quelle: die Geometrie. Die Modul-X werden hier ausgerechnet, mit genau der
    Funktion, die auch die Bewegung benutzt (`motion.rack_x`).
    """
    from app.services import ottoeject_motion as motion

    g = motion.merge_defaults(geometry or {})
    motion.apply_rack_config(g, rack_cfg or None)
    cfg = rack_cfg or {}
    racks = max(1, _int(g.get("racks"), 1))
    blocks = motion.printer_list(g)
    first = blocks[0]["id"]

    modules = [{"id": "home", "type": "home", "name": "Home", "x_ref": 0.0}]

    for r in range(1, racks + 1):
        rb = motion.rack_block(g, r)
        modules.append({
            "id": f"rack-{r}",
            "type": "rack",
            "name": rb["name"] or f"Regal {r}",
            "x_ref": round(rb["x"], 3),
            "slots": max(1, _int(cfg.get("slots_per_rack") or g.get("storage_slots"), 6)),
            "slot_height_mm": _num(cfg.get("slot_height_mm"), 50),
            "first_z": round(rb["first_z"], 3),
            "slot_gap": round(rb["slot_gap"], 3),
            "magazine_slot": max(0, _int(cfg.get("magazine_slot") or g.get("magazine_slot"), 0)),
            # Zuordnung steht seit v1.1.9 in der Geometrie (Drucker-Tab). Ohne
            # Angabe gehört das Regal dem ersten Drucker.
            "printer": rb["printer"] or first,
            "legacy_rack": r,                 # Verbindung zur bisherigen Fach-Adresse „r-s"
        })

    # Drucker: jeder Block bringt seine absolute X mit (siehe motion.printer_list).
    by_dev = {d.get("id"): d for d in (devices or []) if d.get("id") is not None}
    for i, pb in enumerate(blocks):
        dev = by_dev.get(pb.get("device_id")) or ((devices or [{}])[0] if i == 0 and not pb.get("device_id") else {})
        modules.append({
            "id": pb["id"],
            "type": "printer",
            "name": pb["name"] or dev.get("name") or "Drucker",
            "x_ref": round(_num((pb.get("eject") or {}).get("x"), 442), 3),
            "device_id": pb.get("device_id") if pb.get("device_id") is not None else dev.get("id"),
            "model": pb.get("model") or dev.get("model") or "",
            "enabled": True,
        })
    return {"locked": True, "modules": sort_modules(modules), "migrated_from": "geometry"}


# Felder, die NUR im Layout leben (die Geometrie kennt sie nicht) und deshalb
# über eine Neuableitung hinweg erhalten bleiben müssen. Seit v1.1.9 gehören Name,
# Gerät und die Zuordnung Regal → Drucker der Geometrie (Drucker-Tab) — sie stehen
# hier nur noch dann, wenn die Geometrie nichts dazu sagt.
_KEEP = ("device_id", "enabled")


def sync_from_geometry(stored: dict, geometry: dict, rack_cfg: dict = None,
                       devices: list = None) -> dict:
    """Frisch aus der Geometrie ableiten, die eigenen Angaben des Nutzers behalten.

    Alles, was die Geometrie kennt (X, Namen, Zuordnung, Regal-/Fachzahl), kommt
    von dort — das ist der Sinn der Zusammenlegung. Ein gespeicherter Wert wird nur
    dann noch eingesetzt, wenn die Ableitung an dieser Stelle nichts liefert.
    """
    fresh = from_geometry(geometry, rack_cfg, devices)
    old = {m["id"]: m for m in clean(stored)["modules"]} if stored else {}
    for m in fresh["modules"]:
        prev = old.get(m["id"])
        if not prev:
            continue
        for k in _KEEP:
            if m.get(k) in (None, "") and prev.get(k) not in (None, ""):
                m[k] = prev[k]
    ids = {m["id"] for m in fresh["modules"]}
    for m in fresh["modules"]:
        # Zuordnung auf ein inzwischen gelöschtes Drucker-Modul → zurück auf Standard.
        if m["type"] == "rack" and m.get("printer") not in ids:
            m["printer"] = "printer-1" if "printer-1" in ids else None
    fresh["locked"] = bool((stored or {}).get("locked", True))
    return fresh


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
                # Höhe des ersten Fachs und Fach-Abstand dieses Regals (seit v1.1.9
                # je Regal einstellbar) — nur zur Anzeige, gefahren wird aus der Geometrie.
                "first_z": _num(raw.get("first_z"), 0),
                "slot_gap": _num(raw.get("slot_gap"), 0),
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
