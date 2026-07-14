from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import UploadedFile
from app.schemas.schemas import FileUploadResponse, FileListResponse, FileMetaUpdate
from typing import Optional
from pathlib import Path
import base64
import io
import json
import os
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# Create uploads directory if it doesn't exist (zentral über app.paths aufgelöst)
from app.paths import UPLOADS_DIR as UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".3mf", ".stl", ".gcode"}

@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(file: UploadFile = File(...), folder_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Upload a 3D file (.3mf, .stl, .gcode). Optionally into a folder."""

    # Check file extension
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )
    
    try:
        # Generate unique filename
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        file_path = UPLOAD_DIR / unique_filename
        
        # Save file
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)
        
        # Store in database
        db_file = UploadedFile(
            filename=unique_filename,
            original_filename=file.filename,
            file_type=file_ext,
            file_path=str(file_path),
            file_size=len(contents),
            folder_id=folder_id,
        )
        db.add(db_file)
        db.commit()
        db.refresh(db_file)
        
        return db_file
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")


DEMO_FILENAME = "Printloom Demo Part.gcode.3mf"


def _build_demo_3mf() -> bytes:
    """Minimal, aber gültige .3mf-Demo: ein kleiner Druck (PLA blau, ~25 min, 20 mm),
    den die Datei-Analyse korrekt liest (Zeit/Höhe/Filament/Platte). Reines Anschauen
    ohne echten Druck — zum Ausprobieren von Bibliothek/Queue/Vorschau."""
    gcode = (
        "; Printloom Demo Part\n"
        "; filament_type = PLA\n"
        "; filament_colour = #1565C0\n"
        "; layer_height = 0.2\n"
        "; total layer number: 100\n"
        "; max_z_height: 20.00\n"
        "; model printing time: 0h 25m 00s; total estimated time: 0h 27m 00s\n"
        "; filament used [g] = 12.30\n"
        "M104 S210\nM140 S60\nG28\nG90\nG1 Z0.2 F600\n"
        "G1 X10 Y10 F3000\nG1 X90 Y10 E2 F1200\nG1 X90 Y90 E4\nG1 X10 Y90 E6\nG1 X10 Y10 E8\n"
        "G1 Z20 F600\nM104 S0\nM140 S0\nM84\n"
    )
    slice_info = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n'
        '  <plate>\n    <metadata key="index" value="1"/>\n'
        '    <filament id="1" type="PLA" color="#1565C0" used_m="4.12" used_g="12.30"/>\n'
        '  </plate>\n</config>\n'
    )
    project_settings = json.dumps({"filament_type": ["PLA"], "filament_colour": ["#1565C0"]})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Metadata/plate_1.gcode", gcode)
        z.writestr("Metadata/slice_info.config", slice_info)
        z.writestr("Metadata/project_settings.config", project_settings)
    return buf.getvalue()


@router.post("/demo")
async def create_demo_file(db: Session = Depends(get_db)):
    """2.6 — Beispiel-Teil in die Bibliothek laden (idempotent: wird nur einmal angelegt)."""
    existing = db.query(UploadedFile).filter(UploadedFile.original_filename == DEMO_FILENAME).first()
    if existing:
        return {"success": True, "created": False, "file_id": existing.id}
    data = _build_demo_3mf()
    unique_filename = f"{uuid.uuid4()}.3mf"
    file_path = UPLOAD_DIR / unique_filename
    with open(file_path, "wb") as f:
        f.write(data)
    db_file = UploadedFile(
        filename=unique_filename, original_filename=DEMO_FILENAME,
        file_type=".3mf", file_path=str(file_path), file_size=len(data),
        folder_id=None, material="PLA", color="#1565C0",
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    return {"success": True, "created": True, "file_id": db_file.id}


@router.get("/", response_model=FileListResponse)
async def list_files(skip: int = 0, limit: int = 100,
                     folder_id: Optional[int] = None, root: bool = False,
                     search: Optional[str] = None,
                     db: Session = Depends(get_db)):
    """List uploaded files.

    - default (no params): ALL files (keeps existing callers like AutoFarm working).
    - `search`: global match over name / part number / tags (ignores folder scope).
    - `folder_id`: only files in that folder.
    - `root=true`: only files at the root (folder_id IS NULL).
    """
    q = db.query(UploadedFile)
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(
            (UploadedFile.original_filename.ilike(like)) |
            (UploadedFile.part_number.ilike(like)) |
            (UploadedFile.tags.ilike(like)) |
            (UploadedFile.material.ilike(like))
        )
    elif folder_id is not None:
        q = q.filter(UploadedFile.folder_id == folder_id)
    elif root:
        q = q.filter(UploadedFile.folder_id.is_(None))

    total = q.count()
    files = q.order_by(UploadedFile.uploaded_at.desc()).offset(skip).limit(limit).all()
    return FileListResponse(files=files, total=total)


@router.patch("/{file_id}", response_model=FileUploadResponse)
async def update_file_meta(file_id: int, body: FileMetaUpdate, db: Session = Depends(get_db)):
    """Update a file's part metadata and/or move it to another folder."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    data = body.model_dump(exclude_unset=True)
    for field in ("folder_id", "part_number", "tags", "material", "color", "original_filename"):
        if field in data:
            val = data[field]
            if isinstance(val, str):
                val = val.strip() or None
            setattr(file, field, val)
    db.commit()
    db.refresh(file)
    return file

@router.get("/{file_id}", response_model=FileUploadResponse)
async def get_file(file_id: int, db: Session = Depends(get_db)):
    """Get file details"""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return file

@router.get("/{file_id}/ams-info")
async def get_file_ams_info(file_id: int, db: Session = Depends(get_db)):
    """Analyse AMS-Mapping, Filamenttypen und -farben aus der Datei."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type not in ('.3mf', '.gcode'):
        return {"filament_count": 0, "filaments": [], "ams_mapping": [], "ams_mapping_str": ""}

    try:
        from app.routers.printer import _read_filament_info, _extract_ams_mapping

        types, colors = _read_filament_info(file.file_path, file.file_type)

        if file.file_type == '.3mf':
            ams_mapping = _extract_ams_mapping(file.file_path)
        else:
            from app.routers.printer import _read_ams_mapping_from_gcode_header
            ams_mapping = _read_ams_mapping_from_gcode_header(file.file_path)

        # Pad mapping to match filament count
        n = len(types)
        while len(ams_mapping) < n:
            ams_mapping.append(ams_mapping[-1] if ams_mapping else 0)
        ams_mapping = ams_mapping[:n]

        filaments = [
            {
                "index":    i,
                "type":     types[i],
                "color":    colors[i],
                "ams_slot": ams_mapping[i],
                "ams_label": f"A{ams_mapping[i] + 1}",
            }
            for i in range(n)
        ]

        all_same = len(set(ams_mapping)) <= 1 and n > 1
        return {
            "filament_count":  n,
            "filaments":       filaments,
            "ams_mapping":     ams_mapping,
            "ams_mapping_str": ",".join(str(x) for x in ams_mapping),
            "warning":         "Alle Filamente zeigen auf denselben Slot — evtl. in Bambu Studio neu slicen" if all_same else None,
        }
    except Exception as e:
        logger.warning(f"ams-info analysis failed for file {file_id}: {e}")
        return {"filament_count": 0, "filaments": [], "ams_mapping": [], "ams_mapping_str": "", "error": str(e)}


@router.get("/{file_id}/thumbnail")
async def get_thumbnail(file_id: int, db: Session = Depends(get_db)):
    """Schnell das Vorschaubild aus einer .3mf Datei extrahieren."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type != '.3mf':
        raise HTTPException(status_code=400, detail="Nur .3mf Dateien haben Thumbnails")
    if not os.path.exists(file.file_path):
        raise HTTPException(status_code=404, detail="Datei nicht auf Disk")
    try:
        with zipfile.ZipFile(file.file_path, 'r') as zf:
            names = zf.namelist()
            plate_gcodes = sorted(
                [n for n in names if re.match(r'Metadata/plate_\d+\.gcode$', n, re.IGNORECASE)],
                key=lambda n: int(re.search(r'plate_(\d+)', n).group(1))
            )
            plate_num = 1
            if plate_gcodes:
                m = re.search(r'plate_(\d+)', plate_gcodes[0])
                if m: plate_num = int(m.group(1))
            candidates = [
                f"Metadata/plate_{plate_num}.png",
                f"Metadata/plate_{plate_num}_mini.png",
                "Metadata/thumbnail.png",
                "Metadata/thumbnail_mini.png",
            ]
            thumb_path = next(
                (n for c in candidates for n in names if n.lower() == c.lower()), None
            )
            if not thumb_path:
                thumb_path = next(
                    (n for n in names if n.lower().startswith('metadata/') and n.lower().endswith('.png')), None
                )
            if not thumb_path:
                raise HTTPException(status_code=404, detail="Kein Thumbnail in dieser .3mf Datei")
            png_bytes = zf.read(thumb_path)
        return StreamingResponse(io.BytesIO(png_bytes), media_type="image/png")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Thumbnail-Extraktion fehlgeschlagen: {e}")


# P5: geparste quick-meta cachen — Datei-Header werden sonst bei jedem Aufruf neu
# gelesen (zip öffnen / 64 KB lesen). Schlüssel = file_id, Signatur = (Pfad, Größe,
# mtime) → ändert sich die Datei, wird automatisch neu geparst.
_QMETA_CACHE: dict = {}


def _qmeta_sig(path: str):
    st = os.stat(path)
    return (path, st.st_size, int(st.st_mtime))


def _plate_names(zf) -> dict:
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
            pid = pname = None
            for m in pl.findall('metadata'):
                if m.get('key') == 'plater_id':
                    pid = m.get('value')
                elif m.get('key') == 'plater_name':
                    pname = m.get('value')
            if pid is not None and pname:
                out[str(pid).strip()] = pname.strip()
        return out
    except Exception:
        return {}


def _plate_predictions(zf) -> dict:
    """{Platten-Nr (str): Sekunden} aus slice_info.config (<metadata key="prediction">).
    Multi-Plate-Dateien haben PRO Platte eine eigene Slicer-Zeit — der Header der
    ersten Platte gilt sonst fälschlich für alle Jobs (Planer/ETA)."""
    try:
        name = next((n for n in zf.namelist() if n.lower().endswith('slice_info.config')), None)
        if not name:
            return {}
        import xml.etree.ElementTree as ET
        root = ET.fromstring(zf.read(name).decode('utf-8', errors='ignore'))
        out = {}
        for pl in root.iter('plate'):
            idx = pred = None
            for m in pl.findall('metadata'):
                if m.get('key') == 'index':
                    idx = m.get('value')
                elif m.get('key') == 'prediction':
                    pred = m.get('value')
            try:
                if idx is not None and pred is not None and int(float(pred)) > 0:
                    out[str(int(idx))] = int(float(pred))
            except (TypeError, ValueError):
                pass
        return out
    except Exception:
        return {}


@router.get("/{file_id}/quick-meta")
async def get_quick_meta(file_id: int, db: Session = Depends(get_db)):
    """Druckzeit und Filamentverbrauch schnell aus Datei-Header lesen."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type not in ('.3mf', '.gcode'):
        return {"estimated_time": None, "filament_g": None, "filament_m": None, "max_z_mm": None}
    if not os.path.exists(file.file_path):
        raise HTTPException(status_code=404, detail="Datei nicht auf Disk")
    try:
        sig = _qmeta_sig(file.file_path)
        cached = _QMETA_CACHE.get(file_id)
        if cached and cached[0] == sig:
            return cached[1]
    except OSError:
        sig = None
    try:
        plate_times = {}
        plate_count = 0
        if file.file_type == '.3mf':
            with zipfile.ZipFile(file.file_path, 'r') as zf:
                names = zf.namelist()
                plate_times = _plate_predictions(zf)
                plate_gcodes = sorted(
                    [n for n in names if re.match(r'Metadata/plate_\d+\.gcode$', n, re.IGNORECASE)],
                    key=lambda n: int(re.search(r'plate_(\d+)', n).group(1))
                )
                plate_count = len(plate_gcodes)
                gcode_path = plate_gcodes[0] if plate_gcodes else next(
                    (n for n in names if n.lower().endswith('.gcode')), None
                )
                if not gcode_path:
                    return {"estimated_time": None, "filament_g": None, "filament_m": None, "max_z_mm": None}
                with zf.open(gcode_path) as gf:
                    raw = gf.read(65536).decode('utf-8', errors='ignore')
        else:
            with open(file.file_path, 'r', encoding='utf-8', errors='ignore') as f:
                raw = f.read(65536)
        parsed = _parse_header(raw)
        result = {
            "estimated_time": parsed.get("estimated_time"),
            "time_seconds":   parsed.get("time_seconds"),
            "filament_g":     parsed.get("total_filament_g"),
            "filament_m":     parsed.get("total_filament_m"),
            "max_z_mm":       parsed.get("max_z_mm"),
            "layer_count":    parsed.get("layer_count"),
            # Multi-Plate: Slicer-Zeit je Platte ({"1": sec, …}) — der Planer/die ETA
            # rechnen sonst für JEDE Platte mit der Zeit der ersten.
            "plate_times":    plate_times,
            # Anzahl Platten (Badge „enthält N Platten" im Datei-Browser).
            "plate_count":    plate_count,
        }
        if sig:
            _QMETA_CACHE[file_id] = (sig, result)
        return result
    except Exception as e:
        logger.warning(f"quick-meta failed for {file_id}: {e}")
        return {"estimated_time": None, "time_seconds": None, "filament_g": None, "filament_m": None, "max_z_mm": None}


_PLATES_META_CACHE: dict = {}   # file_id → (sig, result)


@router.get("/{file_id}/plates-meta")
async def get_plates_meta(file_id: int, db: Session = Depends(get_db)):
    """Metadaten JE PLATTE einer Multi-Plate-.3mf: Zeit, Höhe, Filament, Schichten.

    Liest pro Platte den plate_N.gcode-Header (64 KB) — Höhe/Zeit sind damit
    plattengenau statt (wie früher) die Werte der ersten Platte für alle.
    slice_info-Zeiten (prediction) dienen als Fallback."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type != '.3mf' or not os.path.exists(file.file_path):
        return {"plates": []}
    try:
        sig = _qmeta_sig(file.file_path)
        cached = _PLATES_META_CACHE.get(file_id)
        if cached and cached[0] == sig:
            return cached[1]
    except OSError:
        sig = None
    plates = []
    try:
        with zipfile.ZipFile(file.file_path, 'r') as zf:
            names = zf.namelist()
            predictions = _plate_predictions(zf)
            plate_names = _plate_names(zf)
            plate_gcodes = sorted(
                [n for n in names if re.match(r'Metadata/plate_\d+\.gcode$', n, re.IGNORECASE)],
                key=lambda n: int(re.search(r'plate_(\d+)', n).group(1))
            )
            for gname in plate_gcodes:
                num = int(re.search(r'plate_(\d+)', gname).group(1))
                entry = {"plate": num, "name": plate_names.get(str(num)),
                         "time_seconds": None, "estimated_time": None,
                         "max_z_mm": None, "filament_g": None, "layer_count": None}
                try:
                    with zf.open(gname) as gf:
                        parsed = _parse_header(gf.read(65536).decode('utf-8', errors='ignore'))
                    entry.update({
                        "time_seconds":   parsed.get("time_seconds"),
                        "estimated_time": parsed.get("estimated_time"),
                        "max_z_mm":       parsed.get("max_z_mm"),
                        "filament_g":     parsed.get("total_filament_g"),
                        "layer_count":    parsed.get("layer_count"),
                    })
                except Exception:
                    pass
                # Fallback-Zeit aus slice_info (prediction), falls der Header keine hat.
                if not entry["time_seconds"] and predictions.get(str(num)):
                    entry["time_seconds"] = predictions[str(num)]
                plates.append(entry)
    except Exception as e:
        logger.warning(f"plates-meta failed for {file_id}: {e}")
        return {"plates": []}
    result = {"plates": plates}
    if sig:
        _PLATES_META_CACHE[file_id] = (sig, result)
    return result


@router.get("/{file_id}/deep-analyze")
async def deep_analyze_file(file_id: int, db: Session = Depends(get_db)):
    """Vollständige Analyse einer .3mf / .gcode Datei — alle Slicer-Metadaten."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type not in ('.3mf', '.gcode'):
        raise HTTPException(status_code=400, detail="Nur .3mf und .gcode werden analysiert")
    if not os.path.exists(file.file_path):
        raise HTTPException(status_code=404, detail="Datei nicht auf Disk")

    result = {
        "file_id":   file_id,
        "file_name": file.original_filename,
        "file_type": file.file_type,
        "file_size_kb": round(file.file_size / 1024, 1),
    }

    try:
        if file.file_type == '.3mf':
            result.update(_analyze_3mf(file.file_path))
        else:
            result.update(_analyze_gcode_file(file.file_path))
    except Exception as e:
        logger.warning(f"deep-analyze failed for {file_id}: {e}")
        result["error"] = str(e)

    return result


def _time_to_seconds(s):
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


def _parse_header(header: str) -> dict:
    """Parse Bambu/PrusaSlicer gcode header comments into structured data."""

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
    # Bambu uses "total layer number: N"; PrusaSlicer uses "total_layer_num = N"
    layer_count  = _val(r';\s*(?:total_layer_num|total layer number)\s*[=:]\s*(\d+)', cast=int)
    # Bambu uses "max_z_height: X" with colon; PrusaSlicer uses "max_layer_z = X"
    max_z        = _val(r';\s*(?:max_layer_z|max_z_height)\s*[=:]\s*([\d.]+)',        cast=float)
    nozzle_d     = _val(r';\s*nozzle_diameter\s*[=:]\s*([\d.]+)',           cast=float)

    fil_types    = _list(r';\s*filament_type\s*=\s*(.+)')
    fil_colors   = _list(r';\s*filament_colour\s*=\s*(.+)')
    nozzle_temps = _list(r';\s*nozzle_temperature\s*=\s*(.+)', cast=lambda x: int(x) if x.isdigit() else 0)
    bed_temps    = _list(r';\s*bed_temperature\s*=\s*(.+)',    cast=lambda x: int(x) if x.isdigit() else 0)

    # Per-filament used weight (semicolon-separated, e.g. "1.23;4.56")
    fil_used     = _list(r';\s*(?:filament_used|filament_weight)\s*=\s*(.+)')

    # Total consumption — Bambu/OrcaSlicer: "; filament used [m] = 6.54" / "; filament used [g] = 19.82"
    # Fallback: semicolon-separated multi-color: sum up
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

    # Slicer-embedded warnings
    bed_too_high = _val(r';\s*bed_temperature_too_high_than_filament\s*=\s*(\d+)', cast=int)
    nozzle_too_low = _val(r';\s*nozzle_temperature_too_low_than_filament\s*=\s*(\d+)', cast=int)
    nozzle_too_high = _val(r';\s*nozzle_temperature_too_high_than_filament\s*=\s*(\d+)', cast=int)
    close_fan_1st = _val(r';\s*close_fan_the_first_x_layers\s*=\s*(\d+)', cast=int)

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
        "time_seconds":       _time_to_seconds(time_raw),
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


def _parse_project_settings(zf: zipfile.ZipFile, names: list) -> dict:
    """Parse Metadata/project_settings.config (JSON) — all configured AMS slots."""
    ps_path = next((n for n in names if n.lower().endswith('project_settings.config')), None)
    if not ps_path:
        return {}
    try:
        with zf.open(ps_path) as f:
            settings = json.load(f)
        fil_types    = settings.get('filament_type', [])
        fil_colors   = settings.get('filament_colour', [])
        fil_profiles = settings.get('filament_settings_id', [])
        nozzle_temps = settings.get('nozzle_temperature', [])
        bed_temps    = settings.get('bed_temperature', [])
        n = max(len(fil_types), len(fil_colors), 1)
        slots = []
        for i in range(n):
            nt_raw = str(nozzle_temps[i]) if i < len(nozzle_temps) else ''
            bt_raw = str(bed_temps[i])    if i < len(bed_temps)    else ''
            slots.append({
                "slot_index":  i,
                "slot_label":  f"A{i+1}",
                "type":        fil_types[i]    if i < len(fil_types)    else "",
                "color":       fil_colors[i]   if i < len(fil_colors)   else "",
                "profile":     fil_profiles[i] if i < len(fil_profiles) else "",
                "nozzle_temp": int(nt_raw) if nt_raw.isdigit() else 0,
                "bed_temp":    int(bt_raw) if bt_raw.isdigit() else 0,
                "used":        False,
                "used_g":      0.0,
                "used_m":      0.0,
            })
        printer_arr = settings.get('printer_model', [])
        bed_arr     = settings.get('curr_bed_type', [])
        return {
            "ams_slots":     slots,
            "printer_model": printer_arr[0] if printer_arr else "",
            "curr_bed_type": bed_arr[0]     if bed_arr     else "",
        }
    except Exception:
        return {}


def _parse_slice_info(zf: zipfile.ZipFile, names: list) -> dict:
    """Parse Metadata/slice_info.config (XML) — actually used filaments + slicer warnings."""
    si_path = next((n for n in names if n.lower().endswith('slice_info.config')), None)
    if not si_path:
        return {"used_filaments": [], "slice_warnings": []}
    try:
        with zf.open(si_path) as f:
            root = ET.parse(f).getroot()
        used = []
        for fil in root.iter("filament"):
            a = fil.attrib
            try:
                used.append({
                    "id":     int(a.get("id", 0)),
                    "type":   a.get("type", ""),
                    "color":  a.get("color", ""),
                    "used_g": round(float(a.get("used_g", 0) or 0), 2),
                    "used_m": round(float(a.get("used_m", 0) or 0), 3),
                })
            except (ValueError, TypeError):
                pass
        slice_warnings = []
        for w in root.iter("warning"):
            msg = w.attrib.get("msg") or w.attrib.get("message") or ""
            lvl = w.attrib.get("level", "")
            if msg:
                slice_warnings.append({"msg": msg, "level": lvl})
        return {"used_filaments": used, "slice_warnings": slice_warnings}
    except Exception:
        return {"used_filaments": [], "slice_warnings": []}


def _analyze_3mf(file_path: str) -> dict:
    with zipfile.ZipFile(file_path, 'r') as zf:
        names = zf.namelist()
        zip_files = sorted(names)

        # Detect correct plate — sort by plate number, take lowest
        import re as _re
        plate_gcodes = sorted(
            [n for n in names if _re.match(r'Metadata/plate_\d+\.gcode$', n, _re.IGNORECASE)],
            key=lambda n: int(_re.search(r'plate_(\d+)', n).group(1))
        )
        gcode_path = plate_gcodes[0] if plate_gcodes else next(
            (n for n in names if n.lower().endswith('.gcode')), None
        )
        plate_num = int(_re.search(r'plate_(\d+)', gcode_path).group(1)) if gcode_path and _re.search(r'plate_(\d+)', gcode_path or '') else 1

        raw_header = ""
        parsed = {}
        if gcode_path:
            with zf.open(gcode_path) as gf:
                raw_bytes = gf.read(131072)
            raw_text = raw_bytes.decode('utf-8', errors='ignore')
            header_lines = []
            for line in raw_text.splitlines():
                stripped = line.strip()
                if stripped.startswith(';') or stripped == '':
                    header_lines.append(stripped)
                elif header_lines:
                    break
            raw_header = '\n'.join(header_lines[:120])
            parsed = _parse_header(raw_text)

        # Warn if not plate 1 — this causes print failures
        if plate_num > 1:
            parsed.setdefault('warnings', [])
            parsed['warnings'].insert(0,
                f"Objekt auf Platte {plate_num} gesliced (Datei: {gcode_path}) — "
                f"beim Drucken wird plate_{plate_num}.gcode verwendet. "
                f"In Orca/Bambu Studio auf Platte 1 verschieben um Fehler zu vermeiden."
            )

        # project_settings.config — all configured AMS slots
        ps_data = _parse_project_settings(zf, names)
        ams_slots = ps_data.get("ams_slots", [])

        # slice_info.config — actually used filaments + slicer warnings
        si_data = _parse_slice_info(zf, names)
        used_filaments = si_data.get("used_filaments", [])

        # Cross-reference: mark which slots are actually used
        # slice_info uses 1-based IDs; ams_slots is 0-based
        used_ids = {f["id"] for f in used_filaments}
        for slot in ams_slots:
            if (slot["slot_index"] + 1) in used_ids:
                slot["used"] = True
                uf = next(f for f in used_filaments if f["id"] == slot["slot_index"] + 1)
                slot["used_g"] = uf["used_g"]
                slot["used_m"] = uf["used_m"]

        # Add slice warnings to parsed warnings
        for sw in si_data.get("slice_warnings", []):
            parsed.setdefault('warnings', []).append(sw["msg"])

        slice_info_raw = ""

        # Thumbnail PNG for active plate
        thumb_b64 = ""
        thumb_candidates = [
            f"Metadata/plate_{plate_num}.png",
            f"Metadata/plate_{plate_num}_mini.png",
            "Metadata/thumbnail.png",
            "Metadata/thumbnail_mini.png",
        ]
        thumb_path = next(
            (n for c in thumb_candidates for n in names if n.lower() == c.lower()),
            None
        )
        if not thumb_path:
            thumb_path = next(
                (n for n in names if n.lower().startswith('metadata/') and n.lower().endswith('.png')),
                None
            )
        if thumb_path:
            try:
                raw_png = zf.read(thumb_path)
                thumb_b64 = "data:image/png;base64," + base64.b64encode(raw_png).decode('ascii')
            except Exception:
                pass

    return {
        **parsed,
        "ams_slots":       ams_slots,
        "used_filaments":  used_filaments,
        "printer_model_ps": ps_data.get("printer_model", ""),
        "curr_bed_type":   ps_data.get("curr_bed_type", ""),
        "zip_files":       zip_files,
        "raw_header":      raw_header,
        "slice_info":      slice_info_raw[:4000] if slice_info_raw else "",
        "has_gcode":       gcode_path is not None,
        "plate_num":       plate_num,
        "plate_gcode":     gcode_path,
        "thumbnail":       thumb_b64,
        "source":          "3mf_gcode_header",
    }


def _analyze_gcode_file(file_path: str) -> dict:
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        raw_text = f.read(131072)
    header_lines = []
    for line in raw_text.splitlines():
        stripped = line.strip()
        if stripped.startswith(';') or stripped == '':
            header_lines.append(stripped)
        elif header_lines:
            break
    raw_header = '\n'.join(header_lines[:120])
    parsed = _parse_header(raw_text)
    return {
        **parsed,
        "zip_files":  [],
        "raw_header": raw_header,
        "slice_info": "",
        "has_gcode":  True,
        "source":     "gcode_header",
    }


@router.delete("/{file_id}")
async def delete_file(file_id: int, db: Session = Depends(get_db)):
    """Delete an uploaded file"""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Delete file from disk
    try:
        Path(file.file_path).unlink()
    except Exception as e:
        pass  # File might already be deleted
    
    # Delete from database
    db.delete(file)
    db.commit()
    
    return {"message": "File deleted successfully"}

@router.get("/search/{filename}")
async def search_files(filename: str, db: Session = Depends(get_db)):
    """Search files by name"""
    files = db.query(UploadedFile).filter(
        UploadedFile.original_filename.ilike(f"%{filename}%")
    ).all()
    return FileListResponse(
        files=files,
        total=len(files)
    )
