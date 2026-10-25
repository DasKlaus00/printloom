from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import UploadedFile
from app.schemas.schemas import FileUploadResponse, FileListResponse, FileMetaUpdate
from app.services import print_file
from app.services.print_file import parse_header as _parse_header
from typing import Optional
from pathlib import Path
import base64
import io
import json
import os
import re
import threading
import uuid
import xml.etree.ElementTree as ET
import zipfile
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# Die Datei-Bibliothek feuert beim Öffnen PRO Zeile mehrere Analysen los (Thumbnail,
# quick-meta, Crash-Check). Ein Crash-Check liest den KOMPLETTEN G-code einer Platte —
# bei einer 40-MB-.3mf sind das Millionen Zeilen reine Python-Arbeit. Laufen davon
# mehrere gleichzeitig, streiten sie um den GIL und hungern den Event-Loop aus: dann
# beantwortet der Server auch /api/health und die JS-Chunks nicht mehr rechtzeitig —
# die Seite „lädt nicht". Zwei gleichzeitig halten die Bibliothek flott, ohne den
# Rest der App lahmzulegen; der Rest wartet kurz und trifft danach meist den Cache.
_HEAVY_SCAN = threading.BoundedSemaphore(2)

# Create uploads directory if it doesn't exist (zentral über app.paths aufgelöst)
from app.paths import UPLOADS_DIR as UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".3mf", ".stl", ".gcode"}

_UPLOAD_CHUNK = 1024 * 1024      # 1 MB


def _save_upload(src, dest: Path) -> int:
    """Hochgeladenen Strom stückweise nach `dest` schreiben und die Größe liefern.
    Läuft im Threadpool (siehe upload_file) — hier darf blockiert werden."""
    total = 0
    src.seek(0)
    with open(dest, "wb") as out:
        while True:
            chunk = src.read(_UPLOAD_CHUNK)
            if not chunk:
                break
            out.write(chunk)
            total += len(chunk)
    return total


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

        # In Stücken auf die Platte — und zwar im Threadpool. Vorher wurde die GANZE
        # Datei in den RAM gelesen und dann synchron geschrieben: eine 40-MB-.3mf
        # blockierte damit den Event-Loop für die Dauer des Schreibens (die ganze App
        # stand still) und belegte den Speicher doppelt.
        size = await run_in_threadpool(_save_upload, file.file, file_path)

        # Store in database
        db_file = UploadedFile(
            filename=unique_filename,
            original_filename=file.filename,
            file_type=file_ext,
            file_path=str(file_path),
            file_size=size,
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
def get_file_ams_info(file_id: int, db: Session = Depends(get_db)):
    """Analyse AMS-Mapping, Filamenttypen und -farben aus der Datei.
    Synchron (def) → Threadpool: liest das ZIP-Archiv, gehört nicht in den Event-Loop."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type not in ('.3mf', '.gcode'):
        return {"filament_count": 0, "filaments": [], "ams_mapping": [], "ams_mapping_str": ""}

    try:
        types, colors = print_file.read_filament_info(file.file_path, file.file_type)
        ams_mapping = (print_file.ams_mapping_from_3mf(file.file_path) if file.file_type == '.3mf'
                       else print_file.ams_mapping_from_gcode(file.file_path))

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


_THUMB_CACHE: dict = {}          # file_id → (sig, png_bytes)
_THUMB_CACHE_MAX = 200           # ~200 × wenige KB — vernachlässigbar


@router.get("/{file_id}/thumbnail")
def get_thumbnail(file_id: int, db: Session = Depends(get_db)):
    """Schnell das Vorschaubild aus einer .3mf Datei extrahieren.

    Bewusst SYNCHRON (def) → FastAPI führt es im Threadpool aus. Als `async def`
    lief das Öffnen des ZIP-Archivs direkt im Event-Loop, und die Bibliothek
    schickt beim Öffnen ein Thumbnail-Request PRO Datei."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type != '.3mf':
        raise HTTPException(status_code=400, detail="Nur .3mf Dateien haben Thumbnails")
    if not os.path.exists(file.file_path):
        raise HTTPException(status_code=404, detail="Datei nicht auf Disk")
    # Das Bild ändert sich für eine hochgeladene Datei nie (Dateiname = UUID), die
    # Signatur (Pfad/Größe/mtime) fängt einen Austausch trotzdem ab.
    try:
        sig = _qmeta_sig(file.file_path)
        cached = _THUMB_CACHE.get(file_id)
        if cached and cached[0] == sig:
            return _png(cached[1])
    except OSError:
        sig = None
    try:
        with zipfile.ZipFile(file.file_path, 'r') as zf:
            names = zf.namelist()
            plates = print_file.plate_gcodes(names)
            plate_num = print_file.plate_number(plates[0]) if plates else 1
            thumb_path = print_file.thumbnail_name(names, plate_num)
            if not thumb_path:
                raise HTTPException(status_code=404, detail="Kein Thumbnail in dieser .3mf Datei")
            png_bytes = zf.read(thumb_path)
        if sig:
            if len(_THUMB_CACHE) >= _THUMB_CACHE_MAX:
                _THUMB_CACHE.clear()       # simpel und ausreichend: nie unbegrenzt wachsen
            _THUMB_CACHE[file_id] = (sig, png_bytes)
        return _png(png_bytes)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Thumbnail-Extraktion fehlgeschlagen: {e}")


def _png(data: bytes) -> Response:
    """Vorschaubild mit Browser-Cache ausliefern. Ohne den Header holte der Browser
    bei JEDEM Öffnen der Bibliothek alle Bilder neu — jedes Mal ein ZIP-Zugriff."""
    return Response(content=data, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=86400"})


# P5: geparste quick-meta cachen — Datei-Header werden sonst bei jedem Aufruf neu
# gelesen (zip öffnen / 64 KB lesen). Schlüssel = file_id, Signatur = (Pfad, Größe,
# mtime) → ändert sich die Datei, wird automatisch neu geparst.
_QMETA_CACHE: dict = {}
_QMETA_EMPTY = {"estimated_time": None, "time_seconds": None, "filament_g": None,
                "filament_m": None, "max_z_mm": None, "layer_count": None,
                "plate_times": {}, "plate_count": 0}


def _qmeta_sig(path: str):
    st = os.stat(path)
    return (path, st.st_size, int(st.st_mtime))


@router.get("/{file_id}/quick-meta")
def get_quick_meta(file_id: int, db: Session = Depends(get_db)):
    """Druckzeit und Filamentverbrauch schnell aus Datei-Header lesen.
    Synchron (def) → Threadpool: öffnet das ZIP-Archiv."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type not in ('.3mf', '.gcode'):
        return _QMETA_EMPTY
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
                plate_times = print_file.plate_predictions(zf)
                plate_count = len(print_file.plate_gcodes(zf.namelist()))
        raw = print_file.read_header(file.file_path, file.file_type)
        if raw is None:
            return _QMETA_EMPTY
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
        return _QMETA_EMPTY


_PLATES_META_CACHE: dict = {}   # file_id → (sig, result)


@router.get("/{file_id}/plates-meta")
def get_plates_meta(file_id: int, db: Session = Depends(get_db)):
    """Metadaten JE PLATTE einer Multi-Plate-.3mf: Zeit, Höhe, Filament, Schichten.
    Synchron (def) → Threadpool: liest je Platte einen Header aus dem ZIP-Archiv.

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
            predictions = print_file.plate_predictions(zf)
            plate_names = print_file.plate_names(zf)
            for gname in print_file.plate_gcodes(names):
                num = print_file.plate_number(gname)
                entry = {"plate": num, "name": plate_names.get(str(num)),
                         "time_seconds": None, "estimated_time": None,
                         "max_z_mm": None, "filament_g": None, "layer_count": None}
                try:
                    with zf.open(gname) as gf:
                        parsed = _parse_header(gf.read(print_file.HEADER_BYTES).decode('utf-8', errors='ignore'))
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


# ── Crash-Check: OTTOeject-Kollisionszone ────────────────────────────────────
# Beim Auswerfen/Einlagern fährt der OTTOeject-Arm seitlich am Bett vorbei. Ragt ein
# hohes Objekt in die seitlichen Randstreifen (links 0–X_MARGIN, rechts X_MAX−X_MARGIN),
# kollidiert der Arm. Wir scannen den G-code der Platte: sobald OBERHALB von Z_LIMIT
# ein X-Wert in die Randzone fällt (auch reine Verfahrwege!), gilt der Druck als riskant.
CRASH_Z_LIMIT   = 30.0     # mm — ab hier ist die Randzone kritisch
CRASH_X_MARGIN  = 10.0     # mm — Streifen links/rechts, in dem der Arm fährt
CRASH_X_MAX     = 256.0    # mm — Bettbreite X (X1C); per Query überschreibbar

_CRASH_CACHE: dict = {}    # (file_id, plate, x_max) → (sig, result)
_CRASH_CACHE_LOCK = threading.Lock()


def _crash_cache_file() -> Path:
    from app.paths import DB_DIR
    return DB_DIR / "crash_cache.json"


def _crash_key_str(key) -> str:
    return "|".join("" if k is None else str(k) for k in key)


def _load_crash_cache() -> None:
    """Gespeicherte Crash-Ergebnisse übernehmen. Ohne das scannte Printloom nach
    JEDEM Neustart (auch nach jedem Update) beim ersten Öffnen der Bibliothek wieder
    jede Datei komplett durch — genau die Last, die die App ausbremst. Die Signatur
    (Pfad/Größe/mtime) bleibt maßgeblich: passt sie nicht, wird neu gescannt."""
    try:
        from app.services import storage
        raw = storage.read_json(str(_crash_cache_file()), {})
        if not isinstance(raw, dict):
            return
    except Exception:
        return
    for k, entry in raw.items():
        try:
            fid, plate, x_max = k.split("|")
            key = (int(fid), int(plate) if plate else None, float(x_max))
            sig = tuple(entry["sig"])
            if not os.path.exists(sig[0]):
                continue                      # Datei gelöscht → Eintrag verfällt
            _CRASH_CACHE[key] = ((sig[0], int(sig[1]), int(sig[2])), entry["result"])
        except Exception:
            continue


def _save_crash_cache() -> None:
    try:
        from app.services import storage
        data = {_crash_key_str(k): {"sig": list(v[0]), "result": v[1]}
                for k, v in list(_CRASH_CACHE.items())}
        storage.write_json(str(_crash_cache_file()), data)
    except Exception as e:
        logger.debug(f"crash cache not persisted: {e}")


_load_crash_cache()

_NUM = r'[-+]?\d*\.?\d+'
_RE_Z = re.compile(r'[Zz](' + _NUM + r')')
_RE_X = re.compile(r'[Xx](' + _NUM + r')')
_RE_MOVE = re.compile(r'^G[0-3]\b')


def _scan_gcode_for_crash(line_iter, x_max: float,
                          x_margin: float = CRASH_X_MARGIN,
                          z_limit: float = CRASH_Z_LIMIT) -> dict:
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


def _scan_file_for_crash(path: str, file_type: str, plate, x_max: float) -> Optional[dict]:
    """Den eigentlichen G-code-Scan ausführen (ohne Cache/DB). None = nichts zu prüfen."""
    if file_type != '.3mf':
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            return _scan_gcode_for_crash(f, x_max)
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
                r = _scan_gcode_for_crash(
                    io.TextIOWrapper(gf, encoding='utf-8', errors='ignore'), x_max)
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


@router.get("/{file_id}/crash-check")
def crash_check(file_id: int, plate: int = None, x_max: float = CRASH_X_MAX,
                db: Session = Depends(get_db)):
    """Prüft, ob der Druck den OTTOeject-Arm rammt: Objekt höher als 30 mm UND ragt
    links/rechts in den 10-mm-Randstreifen (auch Verfahrwege). Ergebnis wird gecacht.
    Bewusst SYNCHRON (def): der volle G-code-Scan blockiert sonst den Event-Loop —
    so führt FastAPI ihn im Threadpool aus."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type not in ('.3mf', '.gcode') or not os.path.exists(file.file_path):
        return {"crash_risk": False, "max_z_mm": None}
    path, file_type = file.file_path, file.file_type
    cache_key = (file_id, plate, x_max)
    try:
        sig = _qmeta_sig(path)
        cached = _CRASH_CACHE.get(cache_key)
        if cached and cached[0] == sig:
            return cached[1]
    except OSError:
        sig = None
    try:
        # Höchstens _HEAVY_SCAN Scans gleichzeitig — sonst hungern N parallele
        # Bibliothekszeilen den Event-Loop aus (siehe Kommentar bei _HEAVY_SCAN).
        with _HEAVY_SCAN:
            # Nach dem Warten nochmal in den Cache schauen: sehr wahrscheinlich hat ihn
            # inzwischen ein anderer Request für dieselbe Datei gefüllt.
            cached = _CRASH_CACHE.get(cache_key) if sig else None
            if cached and cached[0] == sig:
                return cached[1]
            result = _scan_file_for_crash(path, file_type, plate, x_max)
        if result is None:
            return {"crash_risk": False, "max_z_mm": None}
    except Exception as e:
        logger.warning(f"crash-check failed for {file_id}: {e}")
        return {"crash_risk": False, "max_z_mm": None, "error": str(e)}
    result["z_limit_mm"] = CRASH_Z_LIMIT
    result["x_margin_mm"] = CRASH_X_MARGIN
    result["x_max_mm"] = x_max
    if sig:
        with _CRASH_CACHE_LOCK:
            _CRASH_CACHE[cache_key] = (sig, result)
            _save_crash_cache()
    return result


@router.get("/{file_id}/deep-analyze")
def deep_analyze_file(file_id: int, db: Session = Depends(get_db)):
    """Vollständige Analyse einer .3mf / .gcode Datei — alle Slicer-Metadaten.
    Synchron (def) → Threadpool, und wie der Crash-Check durch _HEAVY_SCAN begrenzt:
    die Analyse liest die Datei komplett."""
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
        with _HEAVY_SCAN:
            if file.file_type == '.3mf':
                result.update(_analyze_3mf(file.file_path))
            else:
                result.update(_analyze_gcode_file(file.file_path))
    except Exception as e:
        logger.warning(f"deep-analyze failed for {file_id}: {e}")
        result["error"] = str(e)

    return result


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

        gcode_path = print_file.first_gcode(names)
        plate_num = print_file.plate_number(gcode_path) or 1

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

        # Thumbnail PNG for active plate
        thumb_b64 = ""
        thumb_path = print_file.thumbnail_name(names, plate_num)
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
        "slice_info":      "",
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
    except OSError:
        pass  # schon weg
    
    # Delete from database
    db.delete(file)
    db.commit()
    
    return {"message": "File deleted successfully"}
