"""Drucker mit Moonraker — zuerst der Snapmaker U1.

Was hier steht: verbinden, Zustand lesen, Einstellungen setzen, Druck steuern,
Kamerabild holen. Seit v1.1.87 fährt auch die Farm diese Drucker; sie spricht sie
über services/printer_link.py an (dort: Bambu und Moonraker hinter einer Schnittstelle).

Snapmaker veröffentlicht für den U1 keine eigene API-Beschreibung. Der Drucker
läuft mit Snapmakers Fork von Klipper und Moonraker (GPLv3, auf GitHub), also gilt
die Moonraker-API: Port 7125, im Heimnetz ohne Anmeldung („trusted clients"), mit
eingerichteter Anmeldung über den Kopf `X-Api-Key`. Objektnamen und Befehle der
U1-Eigenheiten stammen wörtlich aus der Home-Assistant-Integration
github.com/kbaker827/ha-snapmaker-u1 (pysnapmaker/client.py, Stand 25.11.2026):
  Licht       Objekt `led cavity_led`, `SET_LED LED=cavity_led RED=… WHITE=…`
  Top-Cover   Objekt `purifier`, `SET_PURIFIER_MODE MODE=0…3`, `SET_PURIFIER FAN=…`
  Filament    Objekt `print_task_config`, Listen je Kopf (0–3)
  Kamera      http://<drucker>/webcam/snapshot.jpg bzw. /webcam/stream.mjpg (nginx, Port 80)

WICHTIG: `PrinterType.KLIPPER` ist in Printloom der OTTOeject-Arm (die Farm nimmt
„das erste Klipper-Gerät" als Arm). Ein Drucker mit Moonraker hat deshalb einen
eigenen Typ, `PrinterType.MOONRAKER` — sonst hielte die Farm ihn für den Arm.
"""
from __future__ import annotations

import ipaddress
import logging
import math
import re
import time
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.services import printer_models

logger = logging.getLogger(__name__)

DEFAULT_PORT = 7125
TIMEOUT_S = 5.0

# Immer abgefragt (wenn vorhanden). Was ein Drucker nicht hat, fehlt in der Antwort
# einfach — deshalb fragt Printloom erst die Objektliste und dann nur Vorhandenes.
BASE_OBJECTS = ("print_stats", "virtual_sdcard", "display_status", "webhooks",
                "idle_timeout", "toolhead", "gcode_move", "fan", "heater_bed")
LIGHT_OBJECT = "led cavity_led"
PURIFIER_OBJECT = "purifier"
FILAMENT_OBJECT = "print_task_config"
_OPTIONAL_RE = re.compile(
    r"^(extruder\d*|filament_(switch|motion)_sensor\s+\S+|temperature_sensor\s+\S+)$")

# Klipper-Druckzustand → Bambu-Schreibweise, die die übrige Oberfläche schon kennt.
# „cancelled" ist kein Fehler: der Nutzer hat abgebrochen, der Drucker ist frei.
STATE_MAP = {"printing": "RUNNING", "paused": "PAUSE", "complete": "FINISH",
             "error": "FAILED", "cancelled": "IDLE", "standby": "IDLE"}
# In diesen Zuständen darf ein neuer Druck starten.
IDLE_STATES = ("standby", "complete", "cancelled", "error")

# Top-Cover-Modi wörtlich wie in pysnapmaker (client.set_top_cover_mode).
TOP_COVER_MODES = {
    0: "SET_PURIFIER_MODE MODE=0",
    1: "SET_PURIFIER_MODE MODE=1 DESIRE_TEMP=42 ALARM_TEMP=48 FAN_SPEED=0.6",
    2: "SET_PURIFIER_MODE MODE=2 FAN_SPEED=0.6",
    3: "SET_PURIFIER_MODE MODE=3 DESIRE_TEMP=45 FAN_SPEED=0.6",
}
# Grenzen der Einstellungen. Was der Drucker selbst nicht kann (Ziel über max_temp
# seiner Heizung), lehnt Klipper ab — die Meldung geht dann an die Oberfläche.
LIMITS = {"speed_factor": (10, 200), "flow_factor": (50, 150), "fan_speed": (0, 100),
          "top_cover_fan": (0, 100), "bed_target": (0, 130)}
NOZZLE_FALLBACK_MAX_C = 300

NOT_IDLE = "Der Drucker druckt gerade (oder pausiert) — erst beenden oder abbrechen."
NOT_READY = "Klipper am Drucker ist nicht bereit ({0}) — am Drucker prüfen."
ONLY_GCODE = ("Der Snapmaker U1 druckt hier nur .gcode — bitte im Slicer als G-code "
              "exportieren (eine Bambu-.3mf passt nicht).")

_objects_cache: dict = {}        # device_id -> (zeit, [objektnamen])
_OBJECTS_TTL_S = 60.0


# ── Adressen ────────────────────────────────────────────────────────────────
def base_url(device) -> str:
    return f"http://{device.ip_address}:{int(device.port or DEFAULT_PORT)}"


def web_url(device) -> str:
    """Weboberfläche des Druckers (nginx, Port 80): dort liegt die Kamera."""
    return f"http://{device.ip_address}"


def headers(device) -> dict:
    key = (device.access_code or "").strip()
    return {"X-Api-Key": key} if key else {}


# ── Reine Auswertung (ohne Netz, testbar) ───────────────────────────────────
def pick_objects(available) -> list:
    """Aus `/printer/objects/list` die Objekte wählen, die Printloom liest."""
    names = [str(n) for n in (available or [])]
    out = [n for n in BASE_OBJECTS if n in names]
    out += [n for n in names if _OPTIONAL_RE.match(n)]
    out += [n for n in (LIGHT_OBJECT, PURIFIER_OBJECT, FILAMENT_OBJECT) if n in names]
    return out


def tool_index(name: str):
    """„extruder" → 0, „extruder2" → 2, sonst None."""
    m = re.fullmatch(r"extruder(\d*)", str(name or ""))
    if not m:
        return None
    return int(m.group(1)) if m.group(1) else 0


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def _pct(v):
    n = _num(v)
    return None if n is None else round(n * 100, 1)


def _filament(ptc: dict, i: int):
    """Filament von Kopf i aus print_task_config (Listen je Kopf). „NONE" oder leer
    heißt unbekannt — dann fehlt das Feld, statt „NONE" anzuzeigen."""
    if not isinstance(ptc, dict) or not ptc:
        return None

    def at(key):
        vals = ptc.get(key)
        if not isinstance(vals, (list, tuple)) or i >= len(vals):
            return None
        v = vals[i]
        if isinstance(v, str) and (not v.strip() or v.strip().upper() == "NONE"):
            return None
        return v

    color = at("filament_color_rgba")
    if isinstance(color, str):
        hx = color.strip().lstrip("#")
        color = f"#{hx[:6].upper()}" if re.fullmatch(r"[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?", hx) else None
    out = {"vendor": at("filament_vendor"), "type": at("filament_type"),
           "sub_type": at("filament_sub_type"), "color": color,
           "loaded": at("filament_exist"), "official": at("filament_official")}
    return out if any(v is not None for v in out.values()) else None


def normalize(st: dict) -> dict:
    """Moonraker-Objekte → Printloom-Status. Gleiche Schlüssel wie bei Bambu
    (status, gcode_state, progress, …), damit vorhandene Anzeigen passen; was der
    Drucker nicht meldet, ist None und nicht 0."""
    st = st if isinstance(st, dict) else {}
    ps = st.get("print_stats") or {}
    wh = st.get("webhooks") or {}
    klippy = str(wh.get("state") or "") or None
    state = str(ps.get("state") or "standby").lower()

    progress = _num((st.get("virtual_sdcard") or {}).get("progress"))
    if progress is None:
        progress = _num((st.get("display_status") or {}).get("progress"))
    duration = _num(ps.get("print_duration"))
    remaining = None
    if state in ("printing", "paused") and progress and progress > 0.01 and duration:
        remaining = max(0, round((duration / progress - duration) / 60))

    ptc = st.get(FILAMENT_OBJECT) or {}
    tools = []
    for name, obj in st.items():
        i = tool_index(name)
        if i is None or not isinstance(obj, dict):
            continue
        tools.append({"index": i, "name": name, "label": f"T{i}",
                      "temp": _num(obj.get("temperature")), "target": _num(obj.get("target")),
                      "power": _num(obj.get("power")), "filament": _filament(ptc, i),
                      "sensor": None})
    tools.sort(key=lambda t: t["index"])
    by_idx = {t["index"]: t for t in tools}
    for name, obj in st.items():
        m = re.fullmatch(r"filament_(?:switch|motion)_sensor\s+\S*?(\d+)", name)
        if m and isinstance(obj, dict) and int(m.group(1)) in by_idx:
            by_idx[int(m.group(1))]["sensor"] = {
                "detected": obj.get("filament_detected"), "enabled": obj.get("enabled")}

    th = st.get("toolhead") or {}
    active = tool_index(th.get("extruder")) if th.get("extruder") else None
    cur = by_idx.get(active) or (tools[0] if tools else {})
    bed = st.get("heater_bed") or {}
    gm = st.get("gcode_move") or {}

    light = None
    if LIGHT_OBJECT in st:
        cd = (st.get(LIGHT_OBJECT) or {}).get("color_data")
        chans = [c for row in (cd or []) if isinstance(row, (list, tuple)) for c in row]
        light = any((_num(c) or 0) > 0 for c in chans) if chans else None

    top = None
    if PURIFIER_OBJECT in st:
        p = st.get(PURIFIER_OBJECT) or {}
        top = {"mode": p.get("mode"), "power_detected": p.get("power_detected"),
               "exhaust_fan": _pct((p.get("exhaust_fan") or {}).get("speed")),
               "inner_fan": _pct((p.get("inner_fan") or {}).get("speed")),
               "inner_fan_rpm": p.get("inner_fan_rpm"),
               "desired_chamber_temp": p.get("desired_chamber_temp")}

    sensors = [{"name": n.split(None, 1)[1], "temp": _num((o or {}).get("temperature"))}
               for n, o in st.items() if n.startswith("temperature_sensor ")]
    info = ps.get("info") or {}
    # „Printing" heißt bei Klipper: es arbeitet gerade G-code ab — auch ohne Druck
    # (G28 vom Display, Endskript, Kopfwechsel). Für die Farm ist der Drucker dann belegt.
    idle_state = (st.get("idle_timeout") or {}).get("state")

    if klippy and klippy != "ready":
        status, gcode_state = klippy, "FAILED"
    else:
        status, gcode_state = state, STATE_MAP.get(state, "IDLE")
    return {
        "online": True,
        "driver": "moonraker",
        "klippy_state": klippy,
        "klippy_message": wh.get("state_message") or "",
        "status": status,
        "print_state": state,
        "gcode_state": gcode_state,
        "is_printing": state == "printing",
        "progress": None if progress is None else round(progress * 100, 1),
        "remaining_min": remaining,
        "subtask_name": ps.get("filename") or "",
        "layer": info.get("current_layer"),
        "total_layers": info.get("total_layer"),
        "nozzle_temp": cur.get("temp"),
        "nozzle_target_temp": cur.get("target"),
        "bed_temp": _num(bed.get("temperature")),
        "bed_target_temp": _num(bed.get("target")),
        "tools": tools,
        "active_tool": active,
        "speed_factor": None if _num(gm.get("speed_factor")) is None else round(gm["speed_factor"] * 100),
        "flow_factor": None if _num(gm.get("extrude_factor")) is None else round(gm["extrude_factor"] * 100),
        "fan_speed": _pct((st.get("fan") or {}).get("speed")),
        "work_light": light,
        "top_cover": top,
        "temperature_sensors": sensors,
        "message": (st.get("display_status") or {}).get("message") or "",
        "executing_gcode": idle_state == "Printing",
        # Bambu-Felder, die es hier nicht gibt — leer statt fehlend, damit die
        # vorhandenen AMS-Anzeigen nicht stolpern.
        "ams_units": [], "ams": {}, "tray_active": 255,
    }


# Zustand, solange Klipper selbst nicht bereit ist (startup, shutdown, error). Für die
# Farm heißt das: unbekannt, nicht frei — printer_guard behandelt ihn wie „belegt".
NOT_READY_STATE = "NOT_READY"


def _int0(v) -> int:
    n = _num(v)
    return int(round(n)) if n is not None else 0


def farm_print_status(s: dict) -> dict:
    """Normalisierter Zustand → das `print`-Telegramm, das der Farm-Zyklus vom Bambu
    kennt (gcode_state, mc_percent, mc_remaining_time, Temperaturen, Schichten).

    Warum so: Der Zyklus wartet, prüft Bedingungen und kühlt anhand genau dieser
    Felder ab. Statt ihn für jeden Drucker neu zu schreiben, sprechen beide Treiber
    dieselbe Sprache. Zahlen, die der Drucker nicht meldet, werden 0, weil der Zyklus
    sie nur vergleicht (`rem > 0`); unbekannte Temperaturen fehlen dagegen ganz — eine
    0 °C würde ein Abkühlen sofort für erledigt halten.

    Arbeitet Klipper G-code ab, ohne dass ein Druck läuft, heißt der Zustand PREPARE
    (belegt): Sonst hielte die Farm einen Drucker für frei, dessen Kopf sich bewegt —
    auch nach Druckende, solange das Endskript noch läuft."""
    s = s if isinstance(s, dict) else {}
    state = s.get("gcode_state") or "IDLE"
    if s.get("klippy_state") and s["klippy_state"] != "ready":
        state = "FAILED"
    elif s.get("print_state") == "cancelled":
        # Am Display abgebrochen: Für die Farm ist der Job gescheitert (wie beim Bambu, der
        # dann FAILED meldet). Als IDLE wartete sie endlos auf ein Druckende — der
        # Fortschritt springt nach dem Abbruch auf 0, „fertig" erkennt sie so nie.
        # Frei für den Arm bleibt der Drucker trotzdem (FAILED ist nicht belegt).
        state = "FAILED"
    elif state in ("IDLE", "FINISH") and s.get("executing_gcode"):
        state = "PREPARE"
    out = {
        "gcode_state": state,
        "mc_percent": _int0(s.get("progress")),
        "mc_remaining_time": _int0(s.get("remaining_min")),
        "layer_num": _int0(s.get("layer")),
        "total_layer_num": _int0(s.get("total_layers")),
        "subtask_name": s.get("subtask_name") or "",
        "hms": [],
        "print_error": 0,
    }
    for key, src in (("nozzle_temper", "nozzle_temp"), ("bed_temper", "bed_temp")):
        if _num(s.get(src)) is not None:
            out[key] = s[src]
    # Bauraum-Fühler: beim U1 heißt er „cavity", bei anderen Klipper-Druckern meist „chamber".
    chamber = next((t.get("temp") for t in s.get("temperature_sensors") or []
                    if any(k in str(t.get("name", "")).lower() for k in ("chamber", "cavity"))
                    and _num(t.get("temp")) is not None), None)
    if chamber is not None:
        out["chamber_temper"] = chamber
    return out


def live_state_of(s: dict):
    """gcode_state für Sicherheitsentscheidungen (printer_guard): Klipper nicht bereit
    → NOT_READY, sonst wie farm_print_status."""
    if not isinstance(s, dict) or s.get("online") is False:
        return None
    if s.get("klippy_state") and s["klippy_state"] != "ready":
        return NOT_READY_STATE
    return farm_print_status(s)["gcode_state"]


def capabilities(objects, model_id=None) -> dict:
    names = set(objects or [])
    tools = sorted(i for i in (tool_index(n) for n in names) if i is not None)
    return {"work_light": LIGHT_OBJECT in names, "top_cover": PURIFIER_OBJECT in names,
            "filament_info": FILAMENT_OBJECT in names, "tools": tools,
            "max_nozzle_c": printer_models.capability(model_id, "max_nozzle_c", NOZZLE_FALLBACK_MAX_C)}


def _number(key, value, lo, hi) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{key}: keine Zahl")
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key}: keine Zahl ({value!r})")
    if not math.isfinite(v) or v < lo or v > hi:
        raise ValueError(f"{key}: {v:g} liegt außerhalb {lo}–{hi}")
    return v


def build_setting(key: str, value, caps: dict) -> list:
    """Eine Einstellung → G-code-Zeilen (eine Zeile je Befehl). ValueError bei
    unbekanntem Schlüssel, falschem Wert oder einer Funktion, die der Drucker nicht hat."""
    caps = caps or {}
    if key in ("speed_factor", "flow_factor"):
        lo, hi = LIMITS[key]
        v = round(_number(key, value, lo, hi))
        return [f"{'M220' if key == 'speed_factor' else 'M221'} S{v}"]
    if key == "fan_speed":
        v = _number(key, value, *LIMITS["fan_speed"])
        return [f"M106 S{int(round(v / 100 * 255))}"]       # Klipper: 0–255
    if key == "work_light":
        if not caps.get("work_light"):
            raise ValueError("Dieser Drucker meldet kein Licht (led cavity_led)")
        if not isinstance(value, bool):
            raise ValueError("work_light: an (true) oder aus (false)")
        lvl = "1" if value else "0"
        return [f"SET_LED LED=cavity_led RED={lvl} GREEN={lvl} BLUE={lvl} WHITE={lvl}"]
    if key == "top_cover_mode":
        if not caps.get("top_cover"):
            raise ValueError("Dieser Drucker meldet keine Top-Cover (purifier)")
        v = _number(key, value, 0, 3)
        if v != int(v):
            raise ValueError("top_cover_mode: 0, 1, 2 oder 3")
        return [TOP_COVER_MODES[int(v)]]
    if key in ("top_cover_exhaust", "top_cover_inner"):
        if not caps.get("top_cover"):
            raise ValueError("Dieser Drucker meldet keine Top-Cover (purifier)")
        fan = "exhaust" if key == "top_cover_exhaust" else "inner"
        v = _number(key, value, *LIMITS["top_cover_fan"])
        if v <= 0:
            return [f"SET_PURIFIER FAN={fan} SPEED=0 DELAY_OFF=0"]
        return [f"SET_PURIFIER FAN={fan} SPEED={v / 100:.2f}"]
    if key == "bed_target":
        v = _number(key, value, *LIMITS["bed_target"])
        return [f"M140 S{v:g}"]
    if key == "nozzle_target":
        if not isinstance(value, dict):
            raise ValueError("nozzle_target: {tool, temp} erwartet")
        tools = caps.get("tools") or []
        try:
            tool = int(value.get("tool"))
        except (TypeError, ValueError):
            raise ValueError("nozzle_target: Kopf fehlt")
        if tool not in tools:
            raise ValueError(f"nozzle_target: Kopf T{tool} gibt es an diesem Drucker nicht")
        t = _number("nozzle_target", value.get("temp"), 0,
                    caps.get("max_nozzle_c") or NOZZLE_FALLBACK_MAX_C)
        # SET_HEATER_TEMPERATURE statt „T1 / M104": T1 wechselt beim U1 den Kopf —
        # eine echte Bewegung, die niemand beim Einstellen einer Temperatur erwartet.
        heater = "extruder" if tool == 0 else f"extruder{tool}"
        return [f"SET_HEATER_TEMPERATURE HEATER={heater} TARGET={t:g}"]
    raise ValueError(f"Unbekannte Einstellung: {key}")


def _safe_url(device, raw: str):
    """Kamera-URL aus der Webcam-Liste: relativ → am Drucker; absolut nur, wenn sie
    auf den Drucker selbst oder localhost zeigt (dann mit der Drucker-Adresse).
    Eine fremde Adresse wird nie abgerufen — sonst könnte der Drucker Printloom
    beliebige Ziele im Netz abfragen lassen."""
    raw = str(raw or "").strip()
    if not raw:
        return None
    if raw.startswith("/"):
        return web_url(device) + raw
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    host = parts.hostname
    try:
        loop = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loop = host == "localhost"
    if loop or host == device.ip_address:
        port = f":{parts.port}" if parts.port else ""
        return urlunsplit((parts.scheme, f"{device.ip_address}{port}", parts.path, parts.query, ""))
    return None


def camera_urls(device, webcams) -> tuple:
    """(snapshot_url, stream_url) aus /server/webcams/list, sonst die Standard-Pfade
    des U1. Einträge für den Fernbildschirm („gui"/„screen") sind keine Kamera."""
    for cam in webcams or []:
        if not isinstance(cam, dict) or cam.get("enabled") is False:
            continue
        label = f"{cam.get('name', '')} {cam.get('location', '')}".lower()
        if "gui" in label or "screen" in label:
            continue
        snap, stream = _safe_url(device, cam.get("snapshot_url")), _safe_url(device, cam.get("stream_url"))
        if snap or stream:
            return snap, stream
    return web_url(device) + "/webcam/snapshot.jpg", web_url(device) + "/webcam/stream.mjpg"


def first_jpeg(data: bytes):
    """Erstes vollständiges JPEG aus einem MJPEG-Strom (None, wenn noch keins da ist)."""
    start = data.find(b"\xff\xd8")
    if start < 0:
        return None
    end = data.find(b"\xff\xd9", start + 2)
    return data[start:end + 2] if end > 0 else None


# ── Netz ────────────────────────────────────────────────────────────────────
def _result(resp: httpx.Response):
    if resp.status_code == 401 or resp.status_code == 403:
        raise PermissionError("Moonraker verlangt eine Anmeldung — API-Schlüssel beim Gerät eintragen")
    resp.raise_for_status()
    body = resp.json()
    return body.get("result") if isinstance(body, dict) else None


async def _get(device, path: str, params=None, timeout: float = TIMEOUT_S):
    async with httpx.AsyncClient(timeout=timeout) as c:
        return _result(await c.get(base_url(device) + path, params=params, headers=headers(device)))


async def _post(device, path: str, json=None, timeout: float = TIMEOUT_S):
    async with httpx.AsyncClient(timeout=timeout) as c:
        return _result(await c.post(base_url(device) + path, json=json, headers=headers(device)))


async def objects(device) -> list:
    hit = _objects_cache.get(device.id)
    if hit and time.monotonic() - hit[0] < _OBJECTS_TTL_S:
        return hit[1]
    res = await _get(device, "/printer/objects/list") or {}
    names = pick_objects(res.get("objects"))
    _objects_cache[device.id] = (time.monotonic(), names)
    return names


async def query(device) -> tuple:
    """→ (Objektnamen, Status-Rohdaten). Abfrage per POST mit JSON-Liste, weil
    Objektnamen Leerzeichen enthalten (`led cavity_led`)."""
    names = await objects(device)
    res = await _post(device, "/printer/objects/query",
                      json={"objects": {n: None for n in names}}) or {}
    return names, (res.get("status") or {})


async def state(device) -> dict:
    """Normalisierter Zustand; bei Fehlern `online: False` mit Grund (nie ein 500)."""
    try:
        names, st = await query(device)
    except PermissionError as e:
        return {"online": False, "driver": "moonraker", "status": "offline", "message": str(e)}
    except (httpx.HTTPError, ValueError) as e:
        logger.info(f"Moonraker {device.name}: nicht erreichbar ({type(e).__name__})")
        return {"online": False, "driver": "moonraker", "status": "offline",
                "message": "Keine Verbindung zum Drucker"}
    out = normalize(st)
    out["capabilities"] = capabilities(names, device.model)
    return out


def _error_text(e: httpx.HTTPStatusError) -> str:
    try:
        msg = ((e.response.json() or {}).get("error") or {}).get("message") or ""
    except ValueError:                 # keine JSON-Antwort: dann ihr Text
        msg = (e.response.text or "").strip()[:200]
    return msg or f"Drucker lehnt ab (HTTP {e.response.status_code})"


async def run_gcode(device, script: str) -> None:
    """G-code ausführen. Klipper meldet einen abgelehnten Befehl als Fehler (400)."""
    try:
        await _post(device, "/printer/gcode/script", json={"script": script}, timeout=15.0)
    except httpx.HTTPStatusError as e:
        raise RuntimeError(_error_text(e))


async def print_action(device, action: str) -> None:
    if action not in ("pause", "resume", "cancel"):
        raise ValueError(f"Unbekannte Aktion: {action}")
    await _post(device, f"/printer/print/{action}", timeout=10.0)


async def list_files(device) -> list:
    res = await _get(device, "/server/files/list", params={"root": "gcodes"}) or []
    files = []
    for f in res if isinstance(res, list) else []:
        path = f.get("path") or f.get("filename")
        if path:
            files.append({"path": path, "modified": f.get("modified"), "size": f.get("size")})
    files.sort(key=lambda f: f.get("modified") or 0, reverse=True)
    return files


async def assert_may_start(device) -> None:
    """Nur ein freier, bereiter Drucker startet einen Druck."""
    names, st = await query(device)
    s = normalize(st)
    if s["klippy_state"] and s["klippy_state"] != "ready":
        raise RuntimeError(NOT_READY.format(s["klippy_state"]))
    if s["print_state"] not in IDLE_STATES:
        raise RuntimeError(NOT_IDLE)


async def start_print(device, filename: str) -> None:
    await assert_may_start(device)
    await _post(device, "/printer/print/start", json={"filename": filename}, timeout=15.0)


async def upload(device, path: str, name: str) -> str:
    """Datei auf den Drucker laden (Standard-Moonraker-Upload) → Pfad dort."""
    if not str(name).lower().endswith(".gcode"):
        raise ValueError(ONLY_GCODE)
    with open(path, "rb") as fh:
        async with httpx.AsyncClient(timeout=None) as c:
            resp = await c.post(base_url(device) + "/server/files/upload",
                                files={"file": (name, fh, "application/octet-stream")},
                                data={"root": "gcodes"}, headers=headers(device))
    item = (_result(resp) or {}).get("item") or {}
    return item.get("path") or name


async def upload_and_print(device, path: str, name: str) -> None:
    """Datei auf den Drucker laden und starten (Standard-Moonraker-Upload)."""
    if not str(name).lower().endswith(".gcode"):
        raise ValueError(ONLY_GCODE)
    await assert_may_start(device)
    remote = await upload(device, path, name)
    await _post(device, "/printer/print/start", json={"filename": remote}, timeout=15.0)


# ── Für die Farm: synchron (läuft im Executor des Farm-Zyklus, wie die Bambu-Seite) ──
def query_sync(device, timeout: float = TIMEOUT_S) -> tuple:
    """→ (Objektnamen, Status-Rohdaten), synchron. Fehler gehen nach oben."""
    with httpx.Client(timeout=timeout) as c:
        hit = _objects_cache.get(device.id)
        if hit and time.monotonic() - hit[0] < _OBJECTS_TTL_S:
            names = hit[1]
        else:
            res = _result(c.get(base_url(device) + "/printer/objects/list", headers=headers(device))) or {}
            names = pick_objects(res.get("objects"))
            _objects_cache[device.id] = (time.monotonic(), names)
        res = _result(c.post(base_url(device) + "/printer/objects/query",
                             json={"objects": {n: None for n in names}}, headers=headers(device))) or {}
    return names, (res.get("status") or {})


def run_gcode_sync(device, script: str, timeout: float = 15.0) -> None:
    """G-code ausführen, synchron. Moonraker antwortet erst, wenn Klipper ihn
    abgearbeitet hat: Die Rückkehr heißt also „Bewegung fertig" (wie beim Arm)."""
    try:
        with httpx.Client(timeout=timeout) as c:
            _result(c.post(base_url(device) + "/printer/gcode/script",
                           json={"script": script}, headers=headers(device)))
    except httpx.HTTPStatusError as e:
        raise RuntimeError(_error_text(e))


def print_action_sync(device, action: str) -> None:
    if action not in ("pause", "resume", "cancel"):
        raise ValueError(f"Unbekannte Aktion: {action}")
    with httpx.Client(timeout=10.0) as c:
        _result(c.post(base_url(device) + f"/printer/print/{action}", headers=headers(device)))


def _camera_targets(c: httpx.Client, device) -> tuple:
    """(snapshot_url, stream_url) des U1 — aus Moonrakers Kameraliste, sonst Standard."""
    try:
        r = c.get(base_url(device) + "/server/webcams/list", headers=headers(device))
        cams = ((r.json() or {}).get("result") or {}).get("webcams") if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError) as e:
        logger.info(f"U1-Kameraliste {device.name}: {type(e).__name__} — nehme die Standard-Pfade")
        cams = None
    return camera_urls(device, cams)


# Live-Bild: so viel Puffer ohne Bildende, dann verwerfen; Standbild-Takt als Ersatz.
STREAM_MAX_BUF = 4_000_000
STILL_INTERVAL_S = 1.0
STILL_MAX_MISSES = 5


def split_jpeg(buf: bytes) -> tuple:
    """(erstes vollständiges JPEG oder None, Rest des Puffers). Ohne Bildanfang bleibt
    nur das letzte Byte — ein 0xFF kann der Anfang des nächsten Markers sein."""
    start = buf.find(b"\xff\xd8")
    if start < 0:
        return None, buf[-1:]
    end = buf.find(b"\xff\xd9", start + 2)
    if end < 0:
        return None, buf[start:]
    return buf[start:end + 2], buf[end + 2:]


def stream_frames(device):
    """Live-Bild des U1 als Folge einzelner JPEGs (synchroner Generator).

    Liest den MJPEG-Strom der Kamera und gibt nur vollständige JPEGs weiter; der
    Aufrufer verpackt sie neu. Der Browser bekommt so nie die Antwort des Druckers
    selbst, nur Bilder (dieselbe Regel wie bei der HA-Kamera seit v1.1.88). Ohne Strom
    oder wenn er abreißt: jede STILL_INTERVAL_S ein Standbild. Bis v1.1.88 lehnte der
    Server den Live-Stream für den U1 ab — die Farm-Kamera blieb schwarz."""
    with httpx.Client(timeout=TIMEOUT_S) as c:
        snap, stream = _camera_targets(c, device)
        if stream:
            try:
                with c.stream("GET", stream) as r:
                    if r.status_code == 200:
                        buf = b""
                        for chunk in r.iter_bytes():
                            buf += chunk
                            while True:
                                img, buf = split_jpeg(buf)
                                if img is None:
                                    break
                                yield img
                            if len(buf) > STREAM_MAX_BUF:
                                logger.info(f"U1-Kamera {device.name}: {len(buf)} Bytes ohne Bildende — verworfen")
                                buf = b""
                    else:
                        logger.info(f"U1-Kamera-Stream {device.name}: HTTP {r.status_code} — weiter mit Standbildern")
            except httpx.HTTPError as e:
                logger.info(f"U1-Kamera-Stream {device.name}: {type(e).__name__} — weiter mit Standbildern")
        if not snap:
            return
        misses = 0
        while misses < STILL_MAX_MISSES:
            try:
                r = c.get(snap)
                img = r.content if r.status_code == 200 and r.content[:2] == b"\xff\xd8" else None
            except httpx.HTTPError as e:
                logger.info(f"U1-Standbild {device.name}: {type(e).__name__}")
                img = None
            if img:
                misses = 0
                yield img
            else:
                misses += 1
            time.sleep(STILL_INTERVAL_S)
        logger.info(f"U1-Kamera {device.name}: {STILL_MAX_MISSES} Standbilder ohne Bild — Stream beendet")


def snapshot(device):
    """Ein Kamerabild (JPEG) oder None. Zuerst ein Bild aus dem Stream: Das weckt
    die U1-Kamera, die sonst einschläft und ein altes Standbild liefert (laut
    Home-Assistant-Integration); danach das Standbild als Ersatz."""
    try:
        with httpx.Client(timeout=TIMEOUT_S) as c:
            snap, stream = _camera_targets(c, device)
            if stream:
                try:
                    buf = b""
                    with c.stream("GET", stream) as r:
                        if r.status_code == 200:
                            for chunk in r.iter_bytes():
                                buf += chunk
                                img = first_jpeg(buf)
                                if img:
                                    return img
                                if len(buf) > 4_000_000:     # kein Bild in 4 MB: aufgeben
                                    break
                except httpx.HTTPError as e:
                    logger.info(f"U1-Kamera-Stream {device.name}: {type(e).__name__}")
            if snap:
                r = c.get(snap)
                if r.status_code == 200 and r.content[:2] == b"\xff\xd8":
                    return r.content
    except httpx.HTTPError as e:
        logger.info(f"U1-Kamera {device.name}: {type(e).__name__}")
    return None


async def test(device) -> dict:
    """Verbindungstest für Konfiguration → Geräte."""
    try:
        info = await _get(device, "/printer/info") or {}
    except PermissionError as e:
        return {"success": False, "message": str(e)}
    except (httpx.HTTPError, ValueError) as e:
        return {"success": False, "message": "Moonraker nicht erreichbar", "error": type(e).__name__}
    klippy = info.get("state") or "?"
    ok = klippy == "ready"
    # Feste Meldungen, Zustand als eigenes Feld: So übersetzt die Oberfläche den Text
    # (bis v1.1.88 stand er auch in Englisch/Sprachpaketen deutsch da).
    return {"success": ok, "klippy_state": klippy, "hostname": info.get("hostname"),
            "message": ("Moonraker erreichbar, Klipper bereit" if ok
                        else "Moonraker erreichbar, Klipper nicht bereit")}
