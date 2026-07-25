"""Drucker-Modelle: EINE Liste, die sagt, was ein Modell kann.

Vorher wurde das Modell nirgends gespeichert — die Kamera musste raten (TCP-Probe
auf Port 322, sonst Seriennummer-Präfix), und die UI hatte eigene Listen. Jetzt
steht am Gerät ein `model` (siehe Device.model), und alles Modell-Abhängige kommt
aus dieser Datei:

  camera        Kamera-Protokoll: "rtsp" (X1-Serie, Port 322) | "bambu" (P1/A1,
                Port 6000) | None = unbekannt → weiter proben wie bisher
  enclosed      geschlossenes Gehäuse (Tür-Operationen sinnvoll)
  ams           AMS möglich (Farb-/Material-Abgleich)
  calibration   Kalibrierung per MQTT anstoßbar (Bett/Vibration/Motorgeräusch)

`serial_prefixes` und `dev_models` dienen NUR der Vorbelegung (Netzwerk-Suche /
Altbestand): sie sind gut belegt, aber nicht garantiert. Die Kamera-Entscheidung
hängt am Modell, das der Nutzer bestätigt hat — und wo kein Modell gesetzt ist,
bleibt die bisherige Port-Probe die Wahrheit. Ein falsch geratenes Präfix kann
also nichts kaputt machen.
"""
from __future__ import annotations

RTSP = "rtsp"
BAMBU = "bambu"

MODELS = [
    {"id": "x1c", "label": "Bambu Lab X1 Carbon", "series": "x1", "camera": RTSP,
     "enclosed": True, "ams": True, "calibration": True,
     "serial_prefixes": ("00M",), "dev_models": ("BL-P001",),
     "aliases": ("x1 carbon", "x1carbon", "x1-carbon", "x1c", "carbon")},
    {"id": "x1", "label": "Bambu Lab X1", "series": "x1", "camera": RTSP,
     "enclosed": True, "ams": True, "calibration": True,
     "serial_prefixes": ("00W",), "dev_models": ("BL-P002",),
     "aliases": ("x1",)},
    {"id": "x1e", "label": "Bambu Lab X1E", "series": "x1", "camera": RTSP,
     "enclosed": True, "ams": True, "calibration": True,
     "serial_prefixes": ("03W",), "dev_models": (),
     "aliases": ("x1e", "x1 e")},
    {"id": "p1s", "label": "Bambu Lab P1S", "series": "p1", "camera": BAMBU,
     "enclosed": True, "ams": True, "calibration": False,
     "serial_prefixes": ("01S",), "dev_models": ("C12",),
     "aliases": ("p1s",)},
    {"id": "p1p", "label": "Bambu Lab P1P", "series": "p1", "camera": BAMBU,
     "enclosed": False, "ams": True, "calibration": False,
     "serial_prefixes": ("01P",), "dev_models": ("C11",),
     "aliases": ("p1p",)},
    {"id": "a1", "label": "Bambu Lab A1", "series": "a1", "camera": BAMBU,
     "enclosed": False, "ams": True, "calibration": False,
     "serial_prefixes": ("039",), "dev_models": ("N2S",),
     "aliases": ("a1",)},
    {"id": "a1mini", "label": "Bambu Lab A1 mini", "series": "a1", "camera": BAMBU,
     "enclosed": False, "ams": True, "calibration": False,
     "serial_prefixes": ("030",), "dev_models": ("N1",),
     "aliases": ("a1 mini", "a1mini", "a1-mini")},
    # Neuere/unbekannte Modelle: Kamera bleibt „unbekannt" → Port-Probe entscheidet.
    # Lieber ehrlich offen als ein falsch geratenes Protokoll fest eintragen.
    {"id": "h2d", "label": "Bambu Lab H2D", "series": "h2", "camera": None,
     "enclosed": True, "ams": True, "calibration": False,
     "serial_prefixes": (), "dev_models": (),
     "aliases": ("h2d",)},
    {"id": "other", "label": "Anderer / unbekannter Drucker", "series": None, "camera": None,
     "enclosed": True, "ams": True, "calibration": False,
     "serial_prefixes": (), "dev_models": (), "aliases": ()},
]

_BY_ID = {m["id"]: m for m in MODELS}


def by_id(model_id) -> dict | None:
    if not model_id:
        return None
    return _BY_ID.get(str(model_id).strip().lower())


def normalize(raw) -> str:
    """Beliebige Modell-Angabe → unsere ID ("" wenn nicht erkennbar).

    Akzeptiert unsere eigene ID, den Bambu-Modellcode aus der Netzwerk-Suche
    (DevModel, z. B. „C12") und Klartext („Bambu Lab P1S", „3DPrinter-X1-Carbon").
    """
    if not raw:
        return ""
    txt = str(raw).strip().lower()
    if not txt:
        return ""
    if txt in _BY_ID:
        return txt
    for m in MODELS:                      # Modellcode exakt (C11, BL-P001, …)
        if any(txt == d.lower() for d in m["dev_models"]):
            return m["id"]
    # Klartext: längste Alias-Treffer zuerst, sonst würde „a1 mini" als „a1" und
    # „x1 carbon" als „x1" durchgehen.
    hits = [(a, m["id"]) for m in MODELS for a in m["aliases"] if a in txt]
    if hits:
        hits.sort(key=lambda h: len(h[0]), reverse=True)
        return hits[0][1]
    return ""


def from_serial(serial) -> str:
    """Modell aus dem Seriennummer-Präfix erraten ("" wenn unbekannt)."""
    s = (str(serial or "")).strip().upper()
    if not s:
        return ""
    for m in MODELS:
        if any(s.startswith(p) for p in m["serial_prefixes"]):
            return m["id"]
    return ""


def camera_backend(model_id) -> str:
    """Kamera-Protokoll des Modells ("" = unbekannt, dann proben)."""
    m = by_id(model_id)
    return (m or {}).get("camera") or ""


def capability(model_id, name: str, default=None):
    """Eine Eigenschaft des Modells lesen (enclosed/ams/calibration)."""
    m = by_id(model_id)
    return default if m is None else m.get(name, default)


def public_list() -> list:
    """Für die UI: nur Anzeige-relevante Felder, in fester Reihenfolge."""
    return [{"id": m["id"], "label": m["label"], "series": m["series"],
             "camera": m["camera"], "enclosed": m["enclosed"],
             "ams": m["ams"], "calibration": m["calibration"]}
            for m in MODELS]
