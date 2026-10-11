"""Druckdateien lesen: .3mf (Bambu Studio / OrcaSlicer) und .gcode.

Platten, Kopfdaten des G-codes, Filamente, AMS-Zuordnung, Objekthöhe und das
Umpacken einer einzelnen Platte. Reine Dateiarbeit — kein Netz, keine Datenbank.

Bis v1.1.34 lag das verstreut in drei Routern (Drucker, Bibliothek, Regal), und
die Farm holte es sich von dort. Dieselbe Frage — „welche G-code-Datei gehört zu
Platte N?" — stand dabei sechsmal ausgeschrieben im Code.
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from typing import Optional

logger = logging.getLogger(__name__)

HEADER_BYTES = 65536          # so viel G-code-Kopf reicht für alle Slicer-Angaben
_PLATE_GCODE = re.compile(r'Metadata/plate_(\d+)\.gcode$', re.IGNORECASE)


# ── Platten ──────────────────────────────────────────────────────────────────
def plate_gcodes(names) -> list:
    """`Metadata/plate_N.gcode`-Einträge eines Archivs, nach Plattennummer sortiert."""
    found = [(int(m.group(1)), n) for n in names if (m := _PLATE_GCODE.match(n))]
    return [n for _, n in sorted(found)]


def plate_number(name: str) -> Optional[int]:
    m = re.search(r'plate_(\d+)', name or "")
    return int(m.group(1)) if m else None


def first_gcode(names, plate=None) -> Optional[str]:
    """G-code einer Platte (ohne Angabe: der niedrigsten), sonst irgendein .gcode."""
    plates = plate_gcodes(names)
    if plate is not None:
        want = next((n for n in plates if plate_number(n) == int(plate)), None)
        if want:
            return want
    if plates:
        return plates[0]
    return next((n for n in names if n.lower().endswith('.gcode')), None)


def list_plates(file_path: str) -> list:
    """Plattennummern einer .3mf, z. B. [1, 2, 3]. Leer bei Fehler / ohne Platten."""
    try:
        with zipfile.ZipFile(file_path, 'r') as zf:
            return [plate_number(n) for n in plate_gcodes(zf.namelist())]
    except Exception:
        return []


def plate_gcode_param(file_path: str, plate: int | None = None) -> str:
    """Pfad des Platten-G-codes für den Druckbefehl ('Metadata/plate_2.gcode').
    Gewünschte Platte, falls vorhanden — sonst die niedrigste, sonst plate_1."""
    plates = list_plates(file_path)
    if plate is not None and plate in plates:
        return f"Metadata/plate_{plate}.gcode"
    if plates:
        return f"Metadata/plate_{plates[0]}.gcode"
    return "Metadata/plate_1.gcode"


def thumbnail_name(names, plate_num: int = 1) -> Optional[str]:
    """Vorschaubild einer Platte im Archiv (oder irgendeines aus Metadata/)."""
    candidates = [f"Metadata/plate_{plate_num}.png", f"Metadata/plate_{plate_num}_mini.png",
                  "Metadata/thumbnail.png", "Metadata/thumbnail_mini.png"]
    hit = next((n for c in candidates for n in names if n.lower() == c.lower()), None)
    return hit or next((n for n in names
                        if n.lower().startswith('metadata/') and n.lower().endswith('.png')), None)


def plate_names(zf) -> dict:
    """{Platten-Nr (str): Name} aus model_settings.config (<metadata key="plater_name">).
    OrcaSlicer/Bambu Studio speichern dort den vom Nutzer vergebenen Platten-Namen —
    die UI zeigt den echten Namen statt nur „Platte N"."""
    try:
        name = next((n for n in zf.namelist() if n.lower().endswith('model_settings.config')), None)
        if not name:
            return {}
        root = ET.fromstring(zf.read(name).decode('utf-8', errors='ignore'))
        out = {}
        for pl in root.iter('plate'):
            meta = {m.get('key'): m.get('value') for m in pl.findall('metadata')}
            pid, pname = meta.get('plater_id'), meta.get('plater_name')
            if pid is not None and pname:
                out[str(pid).strip()] = pname.strip()
        return out
    except Exception:
        return {}


def plate_predictions(zf) -> dict:
    """{Platten-Nr (str): Sekunden} aus slice_info.config (<metadata key="prediction">).
    Multi-Plate-Dateien haben PRO Platte eine eigene Slicer-Zeit — der Header der
    ersten Platte gilt sonst fälschlich für alle Jobs (Planer/ETA)."""
    try:
        name = next((n for n in zf.namelist() if n.lower().endswith('slice_info.config')), None)
        if not name:
            return {}
        root = ET.fromstring(zf.read(name).decode('utf-8', errors='ignore'))
        out = {}
        for pl in root.iter('plate'):
            meta = {m.get('key'): m.get('value') for m in pl.findall('metadata')}
            try:
                idx, pred = meta.get('index'), meta.get('prediction')
                if idx is not None and pred is not None and int(float(pred)) > 0:
                    out[str(int(idx))] = int(float(pred))
            except (TypeError, ValueError):
                pass
        return out
    except Exception:
        return {}


def read_header(path: str, file_type: str, plate=None) -> Optional[str]:
    """Die ersten 64 KB des (Platten-)G-codes als Text — None, wenn es keinen gibt."""
    if file_type == '.3mf':
        with zipfile.ZipFile(path, 'r') as zf:
            name = first_gcode(zf.namelist(), plate)
            if not name:
                return None
            with zf.open(name) as gf:
                return gf.read(HEADER_BYTES).decode('utf-8', errors='ignore')
    if file_type == '.gcode':
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read(HEADER_BYTES)
    return None


# ── Umpacken ─────────────────────────────────────────────────────────────────
def repack_single_plate(src_path: str, plate: int) -> str:
    """Aus einer Multi-Plate-.3mf eine Einzel-Platten-.3mf bauen (wie Bambu Studio
    beim Plattendruck): plate_N wird zu plate_1, Metadaten passend umgeschrieben.
    Grund: Der X1C bekommt sonst das KOMPLETTE Projekt (hier z. B. 16 Platten,
    ~38 MB) und hängt beim Auspacken/Parsen in „Vorbereitung 100 %" — Bambu Studio
    schickt deshalb selbst immer nur die gewählte Platte als eigene Datei.
    Rückgabe: Pfad einer Temp-.3mf — der Aufrufer löscht sie nach dem Upload."""
    with zipfile.ZipFile(src_path, 'r') as src:
        names = set(src.namelist())
        if f"Metadata/plate_{plate}.gcode" not in names:
            raise ValueError(f"Platte {plate} hat keinen G-code in der Datei")

        # slice_info.config: nur die gewählte Platte behalten, index → 1
        # (Filament-Infos/AMS-Anzeige am Drucker bleiben damit korrekt).
        slice_info = None
        if "Metadata/slice_info.config" in names:
            try:
                root = ET.fromstring(src.read("Metadata/slice_info.config").decode("utf-8", errors="ignore"))
                keep = None
                for pl in root.iter("plate"):
                    idx = next((m.get("value") for m in pl.findall("metadata") if m.get("key") == "index"), None)
                    if idx is not None and str(idx).strip() == str(plate):
                        keep = pl
                        break
                if keep is not None:
                    for m in keep.findall("metadata"):
                        if m.get("key") == "index":
                            m.set("value", "1")
                    new_root = ET.Element("config")
                    hdr = root.find("header")
                    if hdr is not None:
                        new_root.append(hdr)
                    new_root.append(keep)
                    slice_info = ET.tostring(new_root, encoding="unicode")
            except Exception as e:
                logger.warning(f"repack: slice_info umschreiben fehlgeschlagen: {e}")

        model_settings = (
            '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <plate>\n'
            '    <metadata key="plater_id" value="1"/>\n'
            '    <metadata key="plater_name" value=""/>\n'
            '    <metadata key="locked" value="false"/>\n'
            '    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>\n'
            '    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>\n'
            '    <metadata key="pattern_bbox_file" value="Metadata/plate_1.json"/>\n'
            '  </plate>\n</config>\n'
        )

        fd, out_path = tempfile.mkstemp(suffix=".3mf", prefix="printloom_plate_")
        os.close(fd)
        try:
            with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as dst:
                for name in ("[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model",
                             "Metadata/project_settings.config"):
                    if name in names:
                        dst.writestr(name, src.read(name))
                # Platten-Dateien der gewählten Platte → plate_1-Namen
                for suffix in (".gcode", ".gcode.md5", ".json", ".png", "_small.png"):
                    n = f"Metadata/plate_{plate}{suffix}"
                    if n in names:
                        dst.writestr(f"Metadata/plate_1{suffix}", src.read(n))
                for pat in ("plate_no_light_{n}.png", "top_{n}.png", "pick_{n}.png"):
                    n = "Metadata/" + pat.format(n=plate)
                    if n in names:
                        dst.writestr("Metadata/" + pat.format(n=1), src.read(n))
                if "Metadata/filament_sequence.json" in names:
                    try:
                        seq = json.loads(src.read("Metadata/filament_sequence.json").decode("utf-8", errors="ignore"))
                        if f"plate_{plate}" in seq:
                            dst.writestr("Metadata/filament_sequence.json",
                                         json.dumps({"plate_1": seq[f"plate_{plate}"]}))
                    except Exception:
                        pass
                dst.writestr("Metadata/model_settings.config", model_settings)
                if slice_info:
                    dst.writestr("Metadata/slice_info.config", slice_info)
        except Exception:
            try:
                os.remove(out_path)
            except OSError:
                pass
            raise
    logger.info(f"Multi-Plate repack: Platte {plate} aus {os.path.basename(src_path)} "
                f"→ {os.path.getsize(out_path) / 1e6:.1f} MB Einzel-Platten-.3mf")
    return out_path


def upload_plan(file_path: str, file_type: str, plate=None) -> tuple:
    """Was geht an den Drucker? → (upload_path, temp_or_None, plate_param, note).

    Multi-Plate-.3mf: die gewählte Platte (sonst die erste) als eigene Datei —
    der X1C parst sonst das GESAMTE Projekt und hängt minutenlang in „Vorbereitung".
    Scheitert das Umpacken, geht die Originaldatei mit dem Platten-Pfad raus.
    `note` beschreibt, was passiert ist (für Log/Diagnose), sonst ""."""
    if file_type != '.3mf':
        return file_path, None, "", ""
    plates = list_plates(file_path)
    if len(plates) <= 1:
        return file_path, None, plate_gcode_param(file_path, plate), ""
    target = int(plate) if (plate is not None and int(plate) in plates) else plates[0]
    try:
        tmp = repack_single_plate(file_path, target)
    except Exception as e:
        return (file_path, None, plate_gcode_param(file_path, target),
                f"Umpacken fehlgeschlagen ({e}) — sende Originaldatei")
    return (tmp, tmp, "Metadata/plate_1.gcode",
            f"{len(plates)} Platten in der Datei → Platte {target} einzeln umgepackt "
            f"({os.path.getsize(tmp) / 1e6:.1f} statt {os.path.getsize(file_path) / 1e6:.1f} MB)")


def make_print_name(original: str) -> str:
    """Dateiname für die SD-Karte des Druckers (nur sichere Zeichen, max. 60)."""
    base, _, ext = original.rpartition('.')
    safe_base = re.sub(r'[^a-zA-Z0-9_-]', '_', base)[:60]
    return f"{safe_base}.{ext}" if ext else safe_base


# ── G-code-Kopf ──────────────────────────────────────────────────────────────
def time_to_seconds(s):
    """'9m 44s' / '1h 2m 3s' / '2d 3h' / '1:23:45' → Sekunden (int) oder None."""
    if not s:
        return None
    s = s.strip()
    m = re.fullmatch(r'(\d+):(\d{1,2}):(\d{1,2})', s)
    if m:
        h, mi, se = map(int, m.groups())
        return h * 3600 + mi * 60 + se
    units = {'d': 86400, 'h': 3600, 'm': 60, 's': 1}
    total, found = 0.0, False
    for val, unit in re.findall(r'(\d+(?:\.\d+)?)\s*([dhms])', s, re.IGNORECASE):
        found = True
        total += float(val) * units[unit.lower()]
    return int(total) if found else None


def parse_header(header: str) -> dict:
    """Bambu/Orca/PrusaSlicer-Kopfkommentare eines G-codes in Felder zerlegen."""

    def _val(pattern, default=None, cast=str):
        m = re.search(pattern, header, re.IGNORECASE)
        if not m:
            return default
        try:
            return cast(m.group(1).strip())
        except Exception:
            return default

    def _list(pattern, cast=str):
        m = re.search(pattern, header, re.IGNORECASE)
        if not m:
            return []
        return [cast(x.strip()) for x in m.group(1).split(';') if x.strip()]

    slicer_raw   = _val(r';\s*generated by\s+(.+)')
    machine_raw  = _val(r';\s*target_machine\s*=\s*(.+)')
    # Zeit: Bambu/Orca "; total estimated time: 9m 44s" (Doppelpunkt), PrusaSlicer
    # "; estimated printing time (normal mode) = 1h 5m 23s" (=). Reihenfolge = Priorität.
    time_raw     = (
        _val(r';?\s*total estimated time\s*:\s*([^\n;]+)')
        or _val(r';\s*estimated printing time[^=:\n]*[=:]\s*([^\n;]+)')
        or _val(r';\s*model printing time\s*:\s*([^\n;]+)')
        or _val(r';\s*(?:estimated_print_time|print_time)\s*=\s*([^\n;]+)')
    )

    layer_h      = _val(r';\s*layer_height\s*[=:]\s*([\d.]+)',              cast=float)
    first_layer  = _val(r';\s*(?:initial_layer_height|first_layer_height)\s*[=:]\s*([\d.]+)', cast=float)
    # Bambu: "total layer number: N"; PrusaSlicer: "total_layer_num = N"
    layer_count  = _val(r';\s*(?:total_layer_num|total layer number)\s*[=:]\s*(\d+)', cast=int)
    # Bambu: "max_z_height: X"; PrusaSlicer: "max_layer_z = X"
    max_z        = _val(r';\s*(?:max_layer_z|max_z_height)\s*[=:]\s*([\d.]+)',        cast=float)
    nozzle_d     = _val(r';\s*nozzle_diameter\s*[=:]\s*([\d.]+)',           cast=float)

    fil_types    = _list(r';\s*filament_type\s*=\s*(.+)')
    fil_colors   = _list(r';\s*filament_colour\s*=\s*(.+)')
    nozzle_temps = _list(r';\s*nozzle_temperature\s*=\s*(.+)', cast=lambda x: int(x) if x.isdigit() else 0)
    bed_temps    = _list(r';\s*bed_temperature\s*=\s*(.+)',    cast=lambda x: int(x) if x.isdigit() else 0)

    # Verbrauch je Filament (durch ; getrennt, z. B. "1.23;4.56")
    fil_used     = _list(r';\s*(?:filament_used|filament_weight)\s*=\s*(.+)')

    def _sum_semicolon(raw: str) -> float:
        if not raw:
            return 0.0
        try:
            return round(sum(float(x.strip()) for x in raw.split(';') if x.strip()), 3)
        except Exception:
            return 0.0

    # Gramm: Orca/Prusa "; filament used [g] = .." (=)  ODER  Bambu "; total filament weight [g] : .." (:)
    total_fil_g_raw = (_val(r';\s*filament\s+used\s*\[g\]\s*=\s*([0-9.;]+)')
                       or _val(r';\s*total filament weight\s*\[g\]\s*:\s*([0-9.;]+)'))
    # Länge: Orca "[m] =" ODER Bambu "total filament length [mm] :" (→ in Meter)
    total_fil_m_raw  = _val(r';\s*filament\s+used\s*\[m\]\s*=\s*([0-9.;]+)')
    total_fil_mm_raw = _val(r';\s*total filament length\s*\[mm\]\s*:\s*([0-9.;]+)')
    total_fil_g = _sum_semicolon(total_fil_g_raw) if total_fil_g_raw else None
    total_fil_m = (_sum_semicolon(total_fil_m_raw) if total_fil_m_raw
                   else round(_sum_semicolon(total_fil_mm_raw) / 1000.0, 3) if total_fil_mm_raw else None)

    # AMS mapping — "0 1 2" or "0, 1, 2"
    ams_raw      = _val(r';\s*ams_mapping\s*=\s*(.+)')
    ams_mapping  = []
    if ams_raw:
        try:
            ams_mapping = [int(x) for x in re.split(r'[\s,]+', ams_raw.strip()) if x.strip().lstrip('-').isdigit()]
        except Exception:
            pass

    support      = _val(r';\s*support_material\s*=\s*(\d+)', cast=int)
    brim         = _val(r';\s*brim_width\s*=\s*([\d.]+)',    cast=float)
    ironing      = _val(r';\s*ironing\s*=\s*(\d+)',           cast=int)
    speed        = _val(r';\s*(?:print_speed|outer_wall_speed)\s*=\s*([\d.]+)', cast=float)
    infill       = _val(r';\s*sparse_infill_density\s*=\s*([\d.]+)', cast=float)

    # Warnungen, die der Slicer selbst in den Kopf schreibt
    bed_too_high = _val(r';\s*bed_temperature_too_high_than_filament\s*=\s*(\d+)', cast=int)
    nozzle_too_low = _val(r';\s*nozzle_temperature_too_low_than_filament\s*=\s*(\d+)', cast=int)
    nozzle_too_high = _val(r';\s*nozzle_temperature_too_high_than_filament\s*=\s*(\d+)', cast=int)

    n = max(len(fil_types), len(fil_colors), 1)
    filaments = []
    for i in range(n):
        slot = ams_mapping[i] if i < len(ams_mapping) else i
        filaments.append({
            "index":      i,
            "type":       fil_types[i]    if i < len(fil_types)    else "",
            "color":      fil_colors[i]   if i < len(fil_colors)   else "",
            "nozzle_temp": nozzle_temps[i] if i < len(nozzle_temps) else 0,
            "bed_temp":   bed_temps[i]    if i < len(bed_temps)    else 0,
            "used":       fil_used[i]     if i < len(fil_used)     else "",
            "ams_slot":   slot,
            "ams_label":  f"A{slot + 1}",
        })

    warnings = []
    if bed_too_high:
        warnings.append("Betttemperatur höher als für das Filament empfohlen — Haftungsproblem möglich")
    if nozzle_too_low:
        warnings.append("Düsentemperatur zu niedrig für das Filament — Verstopfungsgefahr")
    if nozzle_too_high:
        warnings.append("Düsentemperatur zu hoch für das Filament")
    if ams_mapping and len(set(ams_mapping)) == 1 and len(ams_mapping) > 1:
        warnings.append(f"Alle {len(ams_mapping)} Filamente auf Slot {ams_mapping[0]+1} — AMS-Mapping prüfen")
    if any(f["type"] == "PETG" and f["bed_temp"] < 70 for f in filaments):
        warnings.append("PETG mit Betttemperatur < 70 °C — evtl. Haftungsproblem")
    if nozzle_d and nozzle_d < 0.3:
        warnings.append(f"Kleine Düse ({nozzle_d} mm) — Druckzeit erhöht sich")

    return {
        "slicer":             slicer_raw,
        "machine":            machine_raw,
        "estimated_time":     time_raw,
        "time_seconds":       time_to_seconds(time_raw),
        "nozzle_diameter":    nozzle_d,
        "layer_height":       layer_h,
        "initial_layer_height": first_layer,
        "layer_count":        layer_count,
        "max_z_mm":           max_z,
        "total_filament_m":   total_fil_m,
        "total_filament_g":   total_fil_g,
        "ams_mapping":        ams_mapping,
        "filaments":          filaments,
        "support":            bool(support),
        "brim_width":         brim,
        "ironing":            bool(ironing),
        "print_speed":        speed,
        "infill_percent":     infill,
        "warnings":           warnings,
    }


def filament_grams(path: str, file_type: str, plate=None) -> Optional[float]:
    """Filamentverbrauch (g) einer Datei — plattengenau, nur aus dem G-code-KOPF.

    Für die Materialkosten je Job (Auto-Farm). Bewusst der Kopf und nicht die
    Tiefenanalyse: der Slicer schreibt die Summe dort hinein, mehr als 64 KB muss
    dafür niemand lesen. Bei Multi-Plate zählt der Kopf DER GEDRUCKTEN Platte —
    sonst bekäme jede Platte den Verbrauch der ersten zugerechnet.

    None = nicht ermittelbar (Fremdformat, kaputte Datei, alter Slicer). Das ist
    ausdrücklich nicht 0: „unbekannt" darf sich nicht wie „kostet nichts" rechnen.
    """
    try:
        raw = read_header(path, file_type, plate)
        if raw is None:
            return None
        g = parse_header(raw).get("total_filament_g")
        return round(float(g), 2) if g else None
    except Exception as e:
        logger.warning(f"filament grams failed for {path}: {e}")
        return None


# ── Filamente & AMS-Zuordnung aus der Datei ──────────────────────────────────
def _slice_info_plate(z, plate):
    """<plate>-Knoten der gewählten Platte aus slice_info.config (sonst die erste)."""
    name = next((n for n in z.namelist() if n.lower().endswith('slice_info.config')), None)
    if not name:
        return None
    root = ET.fromstring(z.read(name).decode('utf-8', errors='ignore'))
    plates = list(root.iter('plate'))
    if not plates:
        return None
    if plate is not None:
        for pl in plates:
            idx = next((m.get('value') for m in pl.findall('metadata') if m.get('key') == 'index'), None)
            if idx and str(idx).strip() == str(plate).strip():
                return pl
    return plates[0]


def read_filament_info(filepath: str, file_type: str, plate: int | None = None) -> tuple:
    """Filament-Typen und -Farben, die ein Druck WIRKLICH benutzt → (types, colors).

    Wichtig bei Multi-Material-Projekten: der G-Code-Kopf listet ALLE im Projekt
    angelegten Filamente (z. B. PLA;PETG;PLA;PLA), auch wenn eine Platte nur eines
    davon druckt. Würden wir alle erzwingen, verlangt das AMS-Matching Filamente,
    die gar nicht gebraucht werden → falsches „Manuelle AMS-Zuordnung".
    Deshalb zuerst slice_info.config lesen: dort stehen PRO PLATTE nur die wirklich
    benutzten Filamente. Erst als Rückfall der G-Code-Kopf. Beide Listen gleich lang.
    """
    types, colors = [], []

    def _scan(lines):
        nonlocal types, colors
        for line in lines:
            line = line.strip() if isinstance(line, str) else line.decode('utf-8', errors='ignore').strip()
            if not line.startswith(';'):
                continue
            m = re.match(r';\s*filament_type\s*=\s*(.+)', line, re.IGNORECASE)
            if m:
                types = [t.strip() for t in m.group(1).split(';') if t.strip()]
            m = re.match(r';\s*filament_colour\s*=\s*(.+)', line, re.IGNORECASE)
            if m:
                colors = [c.strip() for c in m.group(1).split(';') if c.strip()]

    def _from_slice_info(z):
        try:
            chosen = _slice_info_plate(z, plate)
            if chosen is None:
                return None
            ts, cs = [], []
            for fil in chosen.findall('filament'):
                t = (fil.get('type') or '').strip()
                c = (fil.get('color') or '').strip()
                if t or c:
                    ts.append(t)
                    cs.append(c)
            return (ts, cs) if (ts or cs) else None
        except Exception as e:
            logger.warning(f"slice_info filament parse failed: {e}")
            return None

    try:
        if file_type == '.3mf':
            with zipfile.ZipFile(filepath, 'r') as z:
                si = _from_slice_info(z)
                if si:
                    types, colors = si
                else:
                    gp = next((n for n in z.namelist() if n.endswith('.gcode')), None)
                    if gp:
                        with z.open(gp) as f:
                            _scan(f.readlines()[:400])
        else:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                _scan(f.readlines()[:400])
    except Exception as e:
        logger.warning(f"filament info read failed: {e}")

    n = max(len(types), len(colors), 1)
    types += [''] * (n - len(types))
    colors += [''] * (n - len(colors))
    logger.info(f"Filament info (plate={plate}): types={types} colors={colors}")
    return types, colors


def used_filament_slot_ids(filepath: str, file_type: str, plate: int | None = None) -> list:
    """1-basierte Slicer-Slot-Nummern (`<filament id="…">`) der pro Platte WIRKLICH
    benutzten Filamente aus slice_info.config — selbe Reihenfolge wie
    read_filament_info. Leer, wenn nicht lesbar (.gcode / kein slice_info)."""
    if file_type != '.3mf':
        return []
    try:
        with zipfile.ZipFile(filepath, 'r') as z:
            chosen = _slice_info_plate(z, plate)
            if chosen is None:
                return []
            ids = []
            for fil in chosen.findall('filament'):
                try:
                    ids.append(int(fil.get('id')))
                except (TypeError, ValueError):
                    return []   # eine unlesbare id → Zuordnung nicht mehr sicher
            return ids
    except Exception as e:
        logger.warning(f"slice_info filament ids read failed: {e}")
        return []


def ams_mapping_from_gcode(filepath: str) -> list:
    """ams_mapping-Kommentar, den Bambu Studio in den Kopf einer .gcode schreibt."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for i, line in enumerate(f):
                if i > 300:
                    break
                m = re.match(r';\s*ams_mapping\s*=\s*(.+)', line.strip(), re.IGNORECASE)
                if m:
                    vals = [int(x.strip()) for x in re.split(r'[\s;,]+', m.group(1).strip())
                            if x.strip().lstrip('-').isdigit()]
                    real = [v for v in vals if 0 <= v < 200]
                    if real:
                        logger.info(f"ams_mapping from gcode header: {real}")
                        return real
    except Exception as e:
        logger.warning(f"gcode header ams_mapping read failed: {e}")
    return [0]


def ams_mapping_from_3mf(filepath: str, diag: list = None) -> list:
    """AMS-Zuordnung, mit der die .3mf geslict wurde (0 = A1 … 3 = A4).
    Mehrere Quellen in der Reihenfolge ihrer Verlässlichkeit; `diag` sammelt, welche
    gegriffen hat (Sende-Diagnose)."""
    def _clean(vals):
        return [int(v) for v in vals if 0 <= int(v) < 200]

    def _d(msg):
        if diag is not None:
            diag.append(msg)

    try:
        with zipfile.ZipFile(filepath, 'r') as z:
            names = z.namelist()

            # 1. filament_sequence.json
            seq_path = next((n for n in names if n.endswith('filament_sequence.json')), None)
            if seq_path:
                data = json.loads(z.read(seq_path).decode('utf-8', errors='ignore'))
                found = False
                for pl in data.values():
                    for key in ('optimal_assignment', 'mapping', 'filament_maps'):
                        val = pl.get(key)
                        if val and isinstance(val, list):
                            clean = _clean(val)
                            if clean:
                                _d(f"Quelle 1 — filament_sequence.json [{key}]: {clean}  ✓ verwendet")
                                logger.info(f"AMS mapping from filament_sequence.json[{key}]: {clean}")
                                return clean
                            found = True
                if not found:
                    _d("Quelle 1 — filament_sequence.json: kein Mapping-Key gefunden")
            else:
                _d("Quelle 1 — filament_sequence.json: NICHT im ZIP")

            # 2. slice_info.config
            info_path = next((n for n in names if n.endswith('slice_info.config')), None)
            if info_path:
                text = z.read(info_path).decode('utf-8', errors='ignore')
                m = re.search(r'key="filament_maps"\s+value="([^"]+)"', text)
                if m:
                    clean = _clean([max(0, int(x) - 1) for x in m.group(1).split()])
                    if clean:
                        _d(f"Quelle 2 — slice_info.config [filament_maps]: roh \"{m.group(1)}\" → {clean}  ✓ verwendet")
                        logger.info(f"AMS mapping from slice_info.config: {clean}")
                        return clean
                    _d(f"Quelle 2 — slice_info.config [filament_maps]: roh \"{m.group(1)}\" → leer nach Filterung")
                else:
                    _d("Quelle 2 — slice_info.config: kein filament_maps Key")
            else:
                _d("Quelle 2 — slice_info.config: NICHT im ZIP")

            # 3. G-code-Kopf
            gcode_path = next((n for n in names if n.endswith('.gcode')), None)
            if gcode_path:
                ams_found = False
                with z.open(gcode_path) as gf:
                    for i, raw_line in enumerate(gf):
                        if i > 400:
                            break
                        line = raw_line.decode('utf-8', errors='ignore').strip()
                        if not line.startswith(';'):
                            continue
                        m2 = re.match(r';\s*ams_mapping\s*=\s*(.+)', line, re.IGNORECASE)
                        if m2:
                            parts = re.split(r'[\s;,]+', m2.group(1).strip())
                            clean = _clean([int(p) for p in parts if p.lstrip('-').isdigit()])
                            if clean:
                                _d(f"Quelle 3 — G-Code-Header [ams_mapping]: \"{m2.group(1).strip()}\" → {clean}  ✓ verwendet")
                                logger.info(f"AMS mapping from embedded gcode header: {clean}")
                                return clean
                            ams_found = True
                        m3 = re.match(r';\s*filament_colour\s*=\s*(.+)', line, re.IGNORECASE)
                        if m3:
                            count = len(m3.group(1).strip().split(';'))
                            if count > 1:
                                sequential = list(range(count))
                                _d(f"Quelle 3 — G-Code-Header [filament_colour]: {count} Filamente → sequenziell {sequential}  ✓ verwendet")
                                logger.info(f"AMS mapping: {count} filaments detected → sequential {sequential}")
                                return sequential
                if not ams_found:
                    _d("Quelle 3 — G-Code-Header: kein ams_mapping gefunden")
            else:
                _d("Quelle 3 — G-Code-Header: NICHT im ZIP")

    except Exception as e:
        _d(f"FEHLER beim Lesen der Mapping-Quellen: {e}")
        logger.warning(f"AMS mapping extraction failed: {e}")

    _d("Alle Quellen erschöpft → Fallback [0] (A1)")
    logger.info("AMS mapping not found — defaulting to [0]")
    return [0]


def file_ams_mapping(filepath: str, file_type: str, ams_slot_override: int = None,
                     diag: list = None) -> list:
    """AMS-Zuordnung für den Druckbefehl aus der Datei selbst (nie leer, min. [0]).
    Mit `ams_slot_override` zeigen alle Filamente auf dieses eine Fach."""
    def _d(msg):
        if diag is not None:
            diag.append(msg)

    if file_type == '.3mf':
        mapping = ams_mapping_from_3mf(filepath, diag=diag)
    else:
        mapping = ams_mapping_from_gcode(filepath)
        _d(f"G-Code-Datei → ams_mapping aus Header: {mapping}")

    if not mapping:
        mapping = [0]
        _d("Mapping leer nach Extraktion → Fallback [0]")

    if ams_slot_override is not None:
        mapping = [ams_slot_override] * len(mapping)
        _d(f"⚙ Slot-Override gesetzt: alle Filamente → Slot {ams_slot_override} → Mapping {mapping}")
        logger.info(f"AMS slot override {ams_slot_override} → ams_mapping={mapping}")
    else:
        _d("Kein Slot-Override — Mapping direkt aus Datei")

    labels = ',  '.join(f"Filament {i} → A{m+1}" for i, m in enumerate(mapping))
    _d(f"► Finales Mapping: {mapping}   ({labels})")
    logger.info(f"Final ams_mapping: {mapping} (filaments: {len(mapping)})")
    return mapping


# ── Objekthöhe ───────────────────────────────────────────────────────────────
def _height_from_header(header: str) -> dict:
    """Höhe aus dem G-code-Kopf: max_layer_z bzw. Schichtzahl × Schichthöhe."""
    mz = re.search(r';\s*(?:max_layer_z|max_z_height)\s*[=:]\s*([\d.]+)', header, re.IGNORECASE)
    lh = re.search(r';\s*layer_height\s*[=:]\s*([\d.]+)', header, re.IGNORECASE)
    flh = re.search(r';\s*(?:initial_layer_height|first_layer_height)\s*[=:]\s*([\d.]+)', header, re.IGNORECASE)
    lc = re.search(r';\s*(?:total_layer_num|total layer number)\s*[=:]\s*(\d+)', header, re.IGNORECASE)

    layer_height = float(lh.group(1)) if lh else 0.0
    first_layer = float(flh.group(1)) if flh else layer_height
    layer_count = int(lc.group(1)) if lc else 0

    if mz:
        return {"max_z_mm": round(float(mz.group(1)), 2), "layer_count": layer_count,
                "layer_height_mm": layer_height, "source": "gcode_max_layer_z"}
    if layer_height > 0 and layer_count > 0:
        return {"max_z_mm": round(first_layer + (layer_count - 1) * layer_height, 2),
                "layer_count": layer_count, "layer_height_mm": layer_height,
                "source": "gcode_layer_calc"}
    return {}


def height_3mf(file_path: str, plate: int | None = None) -> dict:
    """Druckhöhe einer (geslicten) .3mf.

    Reihenfolge: 1. Platten-G-code-Kopf (wenn `plate` angegeben), 2. slice_info.config,
    3. Kopf des ersten G-codes, 4. höchster Z-Wert im Netz (ungeslicte Datei).
    `plate`: bei Multi-Plate die Höhe GENAU DIESER Platte — sonst bekäme jede
    Platte die Höhe von Platte 1.
    """
    try:
        with zipfile.ZipFile(file_path, 'r') as zf:
            names = zf.namelist()

            # Gewählte Platte: direkt deren Kopf lesen (der globale slice_info-Wert
            # kennt nur EINE Höhe fürs ganze Projekt).
            if plate is not None:
                target = next((n for n in plate_gcodes(names) if plate_number(n) == int(plate)), None)
                if target:
                    try:
                        with zf.open(target) as gf:
                            result = _height_from_header(gf.read(HEADER_BYTES).decode('utf-8', errors='ignore'))
                        if result:
                            return result
                    except Exception as e:
                        logger.debug(f"plate {plate} gcode header parse failed: {e}")

            si_path = next((n for n in names if n.lower().endswith('slice_info.config')), None)
            if si_path:
                try:
                    content = zf.read(si_path).decode('utf-8', errors='ignore')
                    h_m = re.search(r'key="height"\s+value="([\d.]+)"', content)
                    lh_m = re.search(r'key="layer_height"\s+value="([\d.]+)"', content)
                    lc_m = re.search(r'key="top_layer"\s+value="(\d+)"', content)
                    if h_m:
                        return {"max_z_mm": round(float(h_m.group(1)), 2),
                                "layer_count": int(lc_m.group(1)) if lc_m else 0,
                                "layer_height_mm": float(lh_m.group(1)) if lh_m else 0.0,
                                "source": "slice_info_height"}
                    if lh_m and lc_m:
                        lh, lc = float(lh_m.group(1)), int(lc_m.group(1))
                        return {"max_z_mm": round(lh * lc, 2), "layer_count": lc,
                                "layer_height_mm": lh, "source": "slice_info_calc"}
                except Exception as e:
                    logger.debug(f"slice_info.config parse failed: {e}")

            gcode_path = first_gcode(names)
            if gcode_path:
                try:
                    with zf.open(gcode_path) as gf:
                        result = _height_from_header(gf.read(HEADER_BYTES).decode('utf-8', errors='ignore'))
                    if result:
                        return result
                except Exception as e:
                    logger.debug(f"embedded gcode header parse failed: {e}")

            model_path = next((n for n in names if n.lower().endswith('.model')), None)
            if model_path:
                max_z = 0.0
                with zf.open(model_path) as f:
                    for _, elem in ET.iterparse(f, events=('start',)):
                        local = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                        if local == 'vertex':
                            try:
                                max_z = max(max_z, float(elem.get('z') or 0))
                            except ValueError:
                                pass
                            elem.clear()
                return {"max_z_mm": round(max_z, 2), "layer_count": 0,
                        "layer_height_mm": 0.0, "source": "vertex_scan"}
    except Exception as e:
        logger.error(f"height_3mf failed: {e}")

    return {"max_z_mm": 0.0, "layer_count": 0, "layer_height_mm": 0.0, "source": "failed"}


def height_gcode(file_path: str) -> dict:
    """Druckhöhe einer .gcode: 1. Höhen-Kommentar, 2. Schichtzahl × Schichthöhe,
    3. höchste Z-Fahrt (vor dem End-G-code)."""
    comment_z = move_z = layer_height = first_layer = 0.0
    layer_count = 0
    in_end_gcode = False

    move_re = re.compile(r'^G[01]\s[^\n]*\bZ([\d.]+)', re.IGNORECASE)
    comment_patterns = [
        re.compile(r';\s*max_layer_z\s*[=:]\s*([\d.]+)',     re.IGNORECASE),
        re.compile(r';\s*maxz\s*[=:]\s*([\d.]+)',            re.IGNORECASE),
        re.compile(r';\s*object\s*height\s*[=:]\s*([\d.]+)', re.IGNORECASE),
        re.compile(r';\s*total\s*height\s*[=:]\s*([\d.]+)',  re.IGNORECASE),
        re.compile(r';\s*HEIGHT\s*[=:]\s*([\d.]+)',           re.IGNORECASE),
        re.compile(r';\s*print\s*height\s*[=:]\s*([\d.]+)',  re.IGNORECASE),
    ]
    layer_re = re.compile(r';\s*(?:LAYER_COUNT|total_layer_num)\s*[=:]\s*(\d+)', re.IGNORECASE)
    lh_re = re.compile(r';\s*layer_height\s*[=:]\s*([\d.]+)', re.IGNORECASE)
    flh_re = re.compile(r';\s*(?:initial_layer_height|first_layer_height)\s*[=:]\s*([\d.]+)', re.IGNORECASE)
    end_gcode_re = re.compile(r';\s*(end[_\s]?(gcode|print|code)|custom\s+end\s+gcode|endgcode)',
                              re.IGNORECASE)

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                if end_gcode_re.search(line):
                    in_end_gcode = True
                mc = next((m for m in (p.search(line) for p in comment_patterns) if m), None)
                if mc:
                    comment_z = max(comment_z, float(mc.group(1)))
                    continue
                lm = layer_re.search(line)
                if lm:
                    layer_count = int(lm.group(1))
                    continue
                lhm = lh_re.search(line)
                if lhm and layer_height == 0.0:
                    layer_height = float(lhm.group(1))
                    continue
                flhm = flh_re.search(line)
                if flhm and first_layer == 0.0:
                    first_layer = float(flhm.group(1))
                    continue
                if not in_end_gcode:
                    m = move_re.match(line)
                    if m:
                        move_z = max(move_z, float(m.group(1)))
    except Exception as e:
        logger.error(f"height_gcode failed: {e}")

    if comment_z > 0:
        return {"max_z_mm": round(comment_z, 2), "layer_count": layer_count,
                "layer_height_mm": layer_height, "source": "gcode_comment"}
    if layer_height > 0 and layer_count > 0:
        fl = first_layer if first_layer > 0 else layer_height
        return {"max_z_mm": round(fl + (layer_count - 1) * layer_height, 2),
                "layer_count": layer_count, "layer_height_mm": layer_height,
                "source": "gcode_layer_calc"}
    return {"max_z_mm": round(move_z, 2), "layer_count": layer_count,
            "layer_height_mm": layer_height, "source": "gcode_move_scan"}


def object_height(file_path: str, file_type: str, plate=None, margin_pct: float = 15.0) -> dict:
    """Höhe eines Drucks für die Fachwahl, mit Sicherheitszuschlag.

    → {max_z_mm, layer_count, layer_height_mm, source, computed_height_mm}.
    `computed_height_mm` = Schichtzahl × Schichthöhe (sonst max. Z) × (1 + Zuschlag);
    0, wenn nichts ermittelbar ist. Stand bis v1.1.34 zweimal ausgeschrieben im
    Code — in der Regalverwaltung und beim Einreihen in die Farm."""
    result = height_3mf(file_path, plate) if file_type == ".3mf" else height_gcode(file_path)
    margin = 1.0 + float(margin_pct) / 100.0
    lc, lh, mz = result.get("layer_count", 0), result.get("layer_height_mm", 0.0), result.get("max_z_mm", 0.0)
    if lc > 0 and lh > 0:
        computed = round(lc * lh * margin, 1)
    elif mz > 0:
        computed = round(mz * margin, 1)
    else:
        computed = 0.0
    return {**result, "computed_height_mm": computed}
