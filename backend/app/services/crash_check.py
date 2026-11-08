"""Crash-Check: OTTOeject-Kollisionszone.

Beim Auswerfen/Einlagern fährt der OTTOeject-Arm seitlich am Bett vorbei. Ragt ein
hohes Objekt in die seitlichen Randstreifen (links 0–X_MARGIN, rechts X_MAX−X_MARGIN),
kollidiert der Arm. Wir scannen den G-code der Platte: sobald OBERHALB von Z_LIMIT
ein X-Wert in die Randzone fällt (auch reine Verfahrwege!), gilt der Druck als riskant.

Bis v1.1.39 stand das im Datei-Router. Seitdem prüft auch das OrcaSlicer-Plugin
direkt nach dem Slicen — mit derselben Funktion, damit Bibliothek und Slicer nie
unterschiedlich urteilen.
"""
from __future__ import annotations

import io
import re
import zipfile
from typing import Optional

from app.services import print_file

Z_LIMIT  = 30.0     # mm — ab hier ist die Randzone kritisch
X_MARGIN = 10.0     # mm — Streifen links/rechts, in dem der Arm fährt
X_MAX    = 256.0    # mm — Bettbreite X (X1C); per Query überschreibbar

_NUM = r'[-+]?\d*\.?\d+'
_RE_Z = re.compile(r'[Zz](' + _NUM + r')')
_RE_X = re.compile(r'[Xx](' + _NUM + r')')
_RE_MOVE = re.compile(r'^G[0-3]\b')


def scan_lines(line_iter, x_max: float = X_MAX, x_margin: float = X_MARGIN,
               z_limit: float = Z_LIMIT) -> dict:
    """G-code zeilenweise durchgehen, aktuelle Z-Höhe mitführen und melden, sobald
    oberhalb `z_limit` ein X-Wert in die Randzone (< x_margin oder > x_max − x_margin)
    fällt. Bricht beim ersten Treffer ab. Nur absolute Positionierung (G90) wird geprüft."""
    z = 0.0
    absolute = True
    max_z = 0.0
    lo, hi = x_margin, x_max - x_margin
    for raw in line_iter:
        line = raw.split(';', 1)[0].strip()
        if not line:
            continue
        u = line.upper()
        if u.startswith('G90'):
            absolute = True
            continue
        if u.startswith('G91'):
            absolute = False
            continue
        if not _RE_MOVE.match(u):
            continue
        mz = _RE_Z.search(line)
        if mz and absolute:
            try:
                z = float(mz.group(1))
                if z > max_z:
                    max_z = z
            except ValueError:
                pass
        if not absolute or z <= z_limit:
            continue
        mx = _RE_X.search(line)
        if mx:
            try:
                x = float(mx.group(1))
            except ValueError:
                continue
            if x < lo or x > hi:
                return {"crash_risk": True, "max_z_mm": round(max_z, 1),
                        "hit_z_mm": round(z, 1), "hit_x_mm": round(x, 1)}
    return {"crash_risk": False, "max_z_mm": round(max_z, 1)}


def scan_file(path: str, file_type: str, plate, x_max: float = X_MAX) -> Optional[dict]:
    """Den eigentlichen G-code-Scan ausführen (ohne Cache/DB). None = nichts zu prüfen."""
    if file_type != '.3mf':
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            return scan_lines(f, x_max)
    with zipfile.ZipFile(path, 'r') as zf:
        names = zf.namelist()
        if plate:
            targets = [n for n in names
                       if re.match(rf'Metadata/plate_{plate}\.gcode$', n, re.IGNORECASE)]
        else:
            # Ohne Plattenangabe ALLE Platten prüfen (bei Multi-Plate reicht eine
            # gefährliche Platte, damit die Datei als riskant gilt).
            targets = print_file.plate_gcodes(names)
            if not targets:
                single = next((n for n in names if n.lower().endswith('.gcode')), None)
                targets = [single] if single else []
        if not targets:
            return None
        result = {"crash_risk": False, "max_z_mm": 0.0}
        for gname in targets:
            with zf.open(gname) as gf:
                r = scan_lines(io.TextIOWrapper(gf, encoding='utf-8', errors='ignore'), x_max)
            max_z = max(result.get("max_z_mm") or 0.0, r.get("max_z_mm") or 0.0)
            if r.get("crash_risk"):
                m = re.search(r'plate_(\d+)', gname)
                r["plate"] = int(m.group(1)) if m else None
                # Höchste Z-Höhe über ALLE bisher geprüften Platten behalten — die
                # Fundplatte allein wäre die falsche Zahl in der Warnung.
                r["max_z_mm"] = max_z
                return r
            result["max_z_mm"] = max_z
        return result


def limits(x_max: float = X_MAX) -> dict:
    """Die Grenzwerte so, wie sie in jedes Ergebnis geschrieben werden."""
    return {"z_limit_mm": Z_LIMIT, "x_margin_mm": X_MARGIN, "x_max_mm": x_max}
