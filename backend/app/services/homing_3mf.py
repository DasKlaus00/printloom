"""Minimale druckbare .3mf um beliebigen G-code (Homing-Datei des Druckers).

Seit v1.1.79 eigenes Modul (vorher in routers/autofarm.py, wortgleich). Bambu
druckt nur .3mf; die Farm schickt damit „G28 + Bett auf Z200" als Druckauftrag.
"""
import io
import zipfile

_HOMING_GCODE = """; Printloom Homing Sequence
G28 ; Home all axes
G1 Z200 F3000 ; Move bed to loading position (fast — same feed as the cycle's Z200 move)
M400 ; Wait for moves to complete
"""
_HOMING_CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="gcode" ContentType="text/x.gcode"/><Default Extension="config" ContentType="text/xml"/></Types>'
_HOMING_RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
_HOMING_MODEL = '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Printloom</metadata><resources/><build/></model>'
_HOMING_SETTINGS = '<?xml version="1.0" encoding="utf-8"?><config><plate><metadata key="plater_id" value="1"/><metadata key="gcode_file" value="Metadata/plate_1.gcode"/><metadata key="thumbnail_file" value=""/></plate></config>'
_HOMING_SLICE = '<?xml version="1.0" encoding="utf-8"?><config><header><value key="gcode_version" val="1.0.0.0"/><value key="source_file" val="printloom_homing.3mf"/><value key="nozzle_diameter" val="0.4"/></header><plates><plate><metadata key="index" val="1"/><metadata key="skipped" val="0"/><metadata key="gcode_file" val="Metadata/plate_1.gcode"/></plate></plates><filaments/></config>'

def build_3mf(gcode: str) -> bytes:
    """Wrap arbitrary G-code into a minimal printable .3mf (single plate)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml",          _HOMING_CONTENT_TYPES)
        zf.writestr("_rels/.rels",                  _HOMING_RELS)
        zf.writestr("3D/3dmodel.model",             _HOMING_MODEL)
        zf.writestr("Metadata/plate_1.gcode",       gcode)
        zf.writestr("Metadata/model_settings.config", _HOMING_SETTINGS)
        zf.writestr("Metadata/slice_info.config",   _HOMING_SLICE)
    return buf.getvalue()

def build_homing_3mf() -> bytes:
    return build_3mf(_HOMING_GCODE)


def homing_gcode_klipper() -> str:
    """Dieselbe Homing-Fahrt für Drucker mit Klipper/Moonraker (Snapmaker U1, seit
    v1.1.87): Sie bekommen den G-code direkt, nicht als Druckauftrag. G90 vorweg, weil
    ein Druckende oder Makro Klipper relativ zurücklassen kann — dann führe „Z200"
    200 mm weiter statt AUF 200. Z-Ziel und Vorschub bleiben in _HOMING_GCODE (eine
    Quelle für beide Drucker)."""
    return "G90\n" + _HOMING_GCODE
