import os
import json
import asyncio
import logging
import httpx
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services import storage
from app.db.database import SessionLocal
from app.models.models import Device, PrinterType, SystemConfig
from app.services import bambu_manager
from app import paths

router = APIRouter(tags=["System"])
logger = logging.getLogger(__name__)

WATCHTOWER_URL   = os.getenv("WATCHTOWER_URL", "http://watchtower:8080")
WATCHTOWER_TOKEN = os.getenv("WATCHTOWER_TOKEN", "printloom-update-token")
GITHUB_TOKEN     = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO      = os.getenv("GITHUB_REPO", "DasKlaus00/printloom")
IMAGE_BASE       = os.getenv("PRINTLOOM_IMAGE", "ghcr.io/dasklaus00/printloom")
CONTAINER_NAME   = os.getenv("PRINTLOOM_CONTAINER", "printloom-app")

def _db_dir() -> Path:
    paths.DB_DIR.mkdir(parents=True, exist_ok=True)
    return paths.DB_DIR


def _notif_file() -> Path:
    return _db_dir() / "notifications.json"


def _read_notif() -> dict:
    return storage.read_json(str(_notif_file()),
                             {"telegram_bot_token": "", "telegram_chat_id": "", "enabled": False})


def _write_notif(cfg: dict) -> None:
    storage.write_json(str(_notif_file()), cfg)


async def _send_telegram(token: str, chat_id: str, text: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            )
        return r.status_code == 200
    except Exception:
        return False


# ─── Helpers ────────────────────────────────────────────────────────────────

def _get_current_version() -> str:
    for path in [paths.version_file(), Path(os.path.dirname(__file__)) / "../../../version.txt"]:
        try:
            with open(path) as f:
                return f.read().strip()
        except Exception:
            pass
    return "unknown"


def _ver_tuple(v: str) -> tuple:
    return tuple(int(x) for x in v.lstrip("v").split("."))


def _is_newer(a: str, b: str) -> bool:
    try:
        return _ver_tuple(a) > _ver_tuple(b)
    except Exception:
        return False


def _same_release_line(candidate: str, current: str) -> bool:
    """Only compare versions within the same major line. After the rebrand the
    running version is 0.x; legacy 4.x tags must NOT be offered as 'updates'
    (0.4.3 < 4.3.5 would otherwise always look outdated)."""
    try:
        if current in ("", "unknown"):
            return True
        return _ver_tuple(candidate)[0] == _ver_tuple(current)[0]
    except Exception:
        return False


# ─── Version endpoints ───────────────────────────────────────────────────────

async def _ghcr_digest(tag: str) -> Optional[str]:
    """Manifest digest of ghcr.io/<repo>:<tag>. Works anonymously for public repos
    (ghcr hands out a pull token even without credentials)."""
    owner, _, repo = GITHUB_REPO.partition("/")
    if not owner or not repo:
        return None
    path = f"{owner.lower()}/{repo.lower()}"
    accept = ", ".join([
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ])
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            tr = await client.get(
                f"https://ghcr.io/token?scope=repository:{path}:pull&service=ghcr.io")
            token = tr.json().get("token") if tr.status_code == 200 else None
            headers = {"Accept": accept}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            man_url = f"https://ghcr.io/v2/{path}/manifests/{tag}"
            r = await client.head(man_url, headers=headers)
            if r.status_code != 200:
                r = await client.get(man_url, headers=headers)
            if r.status_code == 200:
                return r.headers.get("Docker-Content-Digest")
    except Exception:
        pass
    return None


def _running_beta_digest() -> Optional[str]:
    try:
        from app.services import updater
        return updater.running_repo_digest(CONTAINER_NAME, IMAGE_BASE)
    except Exception:
        return None


async def _check_beta(current: str) -> dict:
    """Beta channel: compare the running image digest with the remote :beta digest."""
    result = {
        "current": current, "channel": "beta", "latest": None,
        "update_available": False, "token_configured": bool(GITHUB_TOKEN), "error": None,
    }
    remote = await _ghcr_digest("beta")
    if not remote:
        result["error"] = "Beta-Image nicht abrufbar (ghcr nicht erreichbar oder Package privat?)"
        return result
    result["latest"] = remote[:19]
    local = _running_beta_digest()
    if local:
        result["update_available"] = (local != remote)
        result["installed_digest"] = local[:19]
    else:
        # No local digest (no socket / not started from the registry) → offer update.
        result["update_available"] = True
        result["note"] = "Installierter Beta-Stand unbekannt — Update zieht den neuesten Beta-Build."
    return result


@router.get("/running-version")
async def running_version():
    """Die Version des laufenden Containers — billig, ohne Netzwerk-Calls.
    Das Frontend pollt das und lädt die Seite neu, sobald es vom geladenen
    Bundle abweicht (greift nach In-App- UND nach manuellem CLI-Update)."""
    return {"version": _get_current_version()}


def _docker_available() -> bool:
    try:
        from app.services import updater
        return updater.docker_available()
    except Exception:
        return False


async def _check_native_linux(current: str, channel: str) -> dict:
    """Nativer Linux-Betrieb (systemd, ohne Docker): die neueste Version des
    gewählten Kanals steht als version.txt im jeweiligen Branch — direkt lesen.
    Update selbst läuft über scripts/update-native.sh (git pull + dist-Asset)."""
    branch = "beta" if (channel or "").lower() == "beta" else "main"
    result = {
        "current": current, "channel": channel, "latest": None,
        "update_available": False, "runtime": "native-linux",
        "token_configured": bool(GITHUB_TOKEN), "error": None,
    }
    url = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{branch}/backend/version.txt"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
        if r.status_code == 200:
            latest = r.text.strip()
            result["latest"] = latest
            result["update_available"] = _is_newer(latest, current)
        else:
            result["error"] = f"GitHub raw HTTP {r.status_code}"
    except Exception as e:
        result["error"] = f"GitHub nicht erreichbar: {str(e)[:120]}"
    return result


@router.get("/version")
async def get_version(channel: str = "latest"):
    """Update check for the selected channel: stable (git tags) or beta (:beta image).

    Native Desktop-App: prüft GitHub-Releases auf einen Installer statt Docker/ghcr."""
    current = _get_current_version()
    if paths.RUNTIME == "native":
        from app.services import native_update
        result = await native_update.check(current, channel or "latest")
        result["docker_available"] = False
        result["runtime"] = "native"
        return result
    if paths.RUNTIME == "native-linux":
        result = await _check_native_linux(current, channel or "latest")
        result["docker_available"] = False
        return result
    if (channel or "").lower() == "beta":
        result = await _check_beta(current)
    else:
        result = await _check_stable(current)
    # Whether one-click update is even possible (Docker socket mounted).
    result["docker_available"] = _docker_available()
    result["runtime"] = paths.RUNTIME
    return result


async def _check_stable(current: str) -> dict:
    """Compare the installed version against the newest vX.Y.Z git tag (public repo
    → no token needed; a token is used when present for private repos / rate limit)."""
    import re
    result = {
        "current": current,
        "channel": "latest",
        "latest": None,
        "update_available": False,
        "token_configured": bool(GITHUB_TOKEN),
        "error": None,
    }
    owner, _, repo = GITHUB_REPO.partition("/")
    if not owner or not repo:
        result["error"] = "GITHUB_REPO nicht gesetzt"
        return result

    url = f"https://api.github.com/repos/{owner}/{repo}/tags"
    base_headers = {"Accept": "application/vnd.github.v3+json"}

    async def _fetch(with_token: bool):
        headers = dict(base_headers)
        if with_token and GITHUB_TOKEN:
            headers["Authorization"] = f"token {GITHUB_TOKEN}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            return await client.get(url, headers=headers, params={"per_page": 100})

    try:
        r = await _fetch(with_token=True)
        # A stale/invalid token makes even a PUBLIC repo return 401/403. Retry
        # unauthenticated — that succeeds for public repos regardless of the token.
        if r.status_code in (401, 403) and GITHUB_TOKEN:
            r = await _fetch(with_token=False)
        if r.status_code != 200:
            # Surface the real reason instead of a silent "keine Tags".
            detail = ""
            try:
                detail = (r.json().get("message") or "")[:120]
            except Exception:
                pass
            if r.status_code in (401, 403):
                result["error"] = (
                    f"GitHub lehnt ab (HTTP {r.status_code}: {detail or 'kein Zugriff'}). "
                    "Repo privat → Token mit 'repo'-Scope in .env setzen, ODER Repo auf "
                    "öffentlich stellen (dann ist kein Token nötig)."
                )
            elif r.status_code == 404:
                result["error"] = (
                    f"Repo '{owner}/{repo}' nicht gefunden/zugänglich (HTTP 404). "
                    "Falls privat: Token mit 'repo'-Scope setzen."
                )
            else:
                result["error"] = f"GitHub HTTP {r.status_code}: {detail}"
            return result

        latest = None
        for t in r.json():
            tag = (t.get("name") or "")
            if re.match(r"^v?\d+\.\d+\.\d+$", tag):
                ver = tag.lstrip("v")
                if not _same_release_line(ver, current):
                    continue  # ignore legacy pre-rebrand release line
                if latest is None or _is_newer(ver, latest):
                    latest = ver
        if latest:
            result["latest"] = latest
            result["update_available"] = _is_newer(latest, current)
        else:
            result["error"] = "Keine passenden Versions-Tags im Repo gefunden"
    except Exception as e:
        result["error"] = f"GitHub nicht erreichbar: {str(e)[:120]}"
    return result


class UpdateIn(BaseModel):
    channel: Optional[str] = None
    download_url: Optional[str] = None
    asset_name: Optional[str] = None


@router.post("/update")
async def trigger_update(body: UpdateIn = UpdateIn()):
    """Update to / switch onto the chosen channel.

    Native Desktop-App: lädt das Installer-Asset des passenden GitHub-Release und
    startet es (der Installer schließt die App und ersetzt die Dateien)."""
    if paths.RUNTIME == "native-linux":
        raise HTTPException(
            501,
            "Native Installation ohne Docker — Update per SSH ausführen: "
            "bash ~/printloom/scripts/update-native.sh")
    if paths.RUNTIME == "native":
        from app.services import native_update
        url = body.download_url
        asset = body.asset_name
        if not url:
            info = await native_update.check(_get_current_version(), (body.channel or "latest"))
            if info.get("error"):
                raise HTTPException(502, info["error"])
            if not info.get("update_available"):
                return {"success": False, "reason": "up_to_date", "current": info.get("current")}
            url, asset = info.get("download_url"), info.get("asset_name")
            if not url:
                raise HTTPException(502, "Kein Installer-Asset im Release gefunden")
        try:
            res = await asyncio.to_thread(native_update.download_and_launch, url, asset)
        except Exception as e:
            raise HTTPException(502, f"Installer-Download/Start fehlgeschlagen: {e}")
        return {"success": True, "method": "native", **res}
    return await _trigger_update_docker(body)


async def _trigger_update_docker(body: "UpdateIn"):
    """Docker/Watchtower-Update (unverändert) — nur im Container-Betrieb.

    Preferred path uses the Docker socket: it pulls ghcr.io/.../printloom:<tag> and
    recreates the app container — this handles BOTH 'update within channel' and
    'switch channel' in one click. Falls back to Watchtower (which can only update
    the container's CURRENT tag) when no Docker socket is mounted."""
    channel = (body.channel or "latest").lower()
    tag = "beta" if channel == "beta" else "latest"
    target_image = f"{IMAGE_BASE}:{tag}"

    # Preferred: Docker-socket recreate (update + channel switch).
    try:
        from app.services import updater
        if updater.docker_available():
            # Pull FIRST, in this container, so a failure (private package, wrong
            # tag, no network) returns a real error now instead of a detached
            # helper dying silently → "Update läuft ewig, passiert nichts".
            ok, detail = updater.pull_image(target_image)
            if not ok:
                raise HTTPException(502, detail)
            updater.spawn_helper(target_image, CONTAINER_NAME)
            return {"success": True, "method": "docker", "switching": True, "image": target_image}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Docker-Socket-Update nicht möglich, versuche Watchtower: {e}")

    # Fallback: Watchtower — only updates the container's CURRENT channel/tag.
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{WATCHTOWER_URL}/v1/update",
                headers={"Authorization": f"Bearer {WATCHTOWER_TOKEN}"},
            )
        if r.status_code != 200:
            raise HTTPException(502, f"Watchtower: {r.text}")
        return {"success": True, "method": "watchtower"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            502,
            "Kein Docker-Socket gemountet und Watchtower nicht erreichbar — "
            f"Kanalwechsel/Update nicht möglich: {e}")


# ─── Kamera (global an/aus — Energiesparmodus für schwache Geräte) ──────────

class CameraSettingsIn(BaseModel):
    disabled: Optional[bool] = None


@router.get("/camera")
async def get_camera_settings():
    """Globale Kamera-Einstellung: disabled=True → kein ffmpeg (Stream + Snapshots aus)."""
    from app.services import appsettings
    return appsettings.read_camera()


@router.post("/camera")
async def save_camera_settings(body: CameraSettingsIn):
    from app.services import appsettings
    cfg = appsettings.write_camera({"disabled": body.disabled} if body.disabled is not None else {})
    if cfg.get("disabled"):
        # Laufende Kamera-Hubs SOFORT beenden (beide Backends) — der Nutzer schaltet
        # gerade wegen der CPU-Last ab, nicht erst beim nächsten Leerlauf.
        try:
            from app.services import camera
            camera.stop_all()
        except Exception:
            pass
    return {"success": True, **cfg}


# ─── Notification endpoints ──────────────────────────────────────────────────

class NotifConfigIn(BaseModel):
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    enabled: Optional[bool] = None


class NotifyIn(BaseModel):
    message: str


@router.get("/notifications")
async def get_notifications():
    cfg = _read_notif()
    token = cfg.get("telegram_bot_token", "")
    return {
        "telegram_bot_token": (token[:8] + "…" if len(token) > 8 else token),
        "telegram_chat_id": cfg.get("telegram_chat_id", ""),
        "enabled": cfg.get("enabled", False),
        "has_token": bool(token),
    }


@router.post("/notifications")
async def save_notifications(data: NotifConfigIn):
    cfg = _read_notif()
    if data.telegram_bot_token is not None and "…" not in data.telegram_bot_token:
        cfg["telegram_bot_token"] = data.telegram_bot_token
    if data.telegram_chat_id is not None:
        cfg["telegram_chat_id"] = data.telegram_chat_id
    if data.enabled is not None:
        cfg["enabled"] = data.enabled
    _write_notif(cfg)
    return {"success": True}


@router.post("/notify/test")
async def test_notification():
    cfg = _read_notif()
    token = cfg.get("telegram_bot_token", "")
    chat  = cfg.get("telegram_chat_id", "")
    if not token or not chat:
        raise HTTPException(400, "Bot Token und Chat ID müssen konfiguriert sein")
    ok = await _send_telegram(token, chat, "🤖 *Printloom Test* — Benachrichtigungen funktionieren!")
    if not ok:
        raise HTTPException(502, "Telegram-Nachricht fehlgeschlagen — Token oder Chat ID prüfen")
    return {"success": True}


@router.post("/notify")
async def send_notification(data: NotifyIn):
    cfg = _read_notif()
    if not cfg.get("enabled") or not cfg.get("telegram_bot_token") or not cfg.get("telegram_chat_id"):
        return {"success": False, "reason": "disabled"}
    ok = await _send_telegram(cfg["telegram_bot_token"], cfg["telegram_chat_id"], data.message)
    return {"success": ok}


# ─── Backup endpoints ────────────────────────────────────────────────────────
# A backup is the user's *complete* configuration so a fresh install can be fully
# restored: devices (incl. credentials), per-device settings (camera/HA token),
# calibration, sequences, farm settings, rack layout + slots, racks, schedules,
# custom filaments, notifications and installed language packs. Because it contains
# secrets (printer access code, HA/Telegram token), the UI warns it's sensitive.

BACKUP_SCHEMA = "printloom-backup/2"

# (path, backup-key) for the flat JSON config files in the db dir.
def _backup_files() -> list:
    from app.routers import calibration, autofarm, rack_manager, filaments, control
    db_dir = _db_dir()
    return [
        (calibration.CONFIG_PATH,    "calibration"),
        (autofarm.SEQ_PATH,          "sequences"),
        (autofarm.SETTINGS_PATH,     "settings"),
        (rack_manager.SLOTS_PATH,    "rack_slots"),
        (rack_manager.RACKS_PATH,    "racks"),
        (filaments.CUSTOM_PATH,      "filaments"),
        # OTTOeject-Geometrie (Drucker-Tab: X-Positionen je Regal/Drucker,
        # G-code-Overrides, Geschwindigkeiten je Op) — war bisher NICHT im Backup.
        (control.GEOMETRY_PATH,      "geometry"),
        # Lokale Profil-Bibliothek (Setup-/Geometrie-Profile).
        (str(db_dir / "profiles.json"),        "profiles"),
        # Globaler Kamera-Aus-Schalter (Energiesparmodus).
        (str(db_dir / "camera_settings.json"), "camera_settings"),
        (str(db_dir / "schedules.json"), "schedules"),
        (_langpacks_file(),          "langpacks"),
        (_dashboard_file(),          "dashboard_layout"),
    ]


def _safe_load_json(path: str):
    return storage.read_json(path, None)


def _safe_write_json(path: str, data):
    try:
        storage.write_json(path, data)
    except Exception as e:
        raise HTTPException(500, f"Schreiben fehlgeschlagen: {e}")


def _export_devices(db) -> tuple:
    """All devices (with credentials) + their settings, keyed by device NAME so
    a restore survives the device IDs changing on a fresh database."""
    devices, settings = [], {}
    for d in db.query(Device).all():
        devices.append({
            "name":          d.name,
            "device_type":   d.device_type.value if d.device_type else None,
            "ip_address":    d.ip_address,
            "port":          d.port,
            "serial_number": d.serial_number,
            "access_code":   d.access_code,
            "mqtt_port":     d.mqtt_port,
            "use_tls":       d.use_tls,
            "is_active":     d.is_active,
        })
        row = db.query(SystemConfig).filter(
            SystemConfig.key == f"device_settings_{d.id}").first()
        if row and row.value:
            try:
                settings[d.name] = json.loads(row.value)
            except Exception:
                pass
    return devices, settings


@router.get("/backup")
async def export_backup():
    """Vollständiges Konfigurations-Backup als JSON (enthält Zugangsdaten)."""
    try:
        db = SessionLocal()
        try:
            devices, device_settings = _export_devices(db)
        finally:
            db.close()

        out = {
            "schema":          BACKUP_SCHEMA,
            "current_version": _get_current_version(),
            "exported_at":     datetime.now().isoformat(),
            "devices":         devices,
            "device_settings": device_settings,
            "notifications":   _read_notif(),
        }
        for path, key in _backup_files():
            data = _safe_load_json(path)
            if data is not None:
                out[key] = data
        return out
    except Exception as e:
        logger.exception("Backup-Export fehlgeschlagen")
        raise HTTPException(500, f"Backup-Export fehlgeschlagen: {e}")


def _restore_devices(db, devices: list, settings: dict) -> int:
    """Upsert devices by name, then write each device's settings under its (new) id."""
    from app.models.models import PrinterType
    n = 0
    name_to_id = {}
    for d in devices or []:
        name = (d.get("name") or "").strip()
        if not name:
            continue
        try:
            dtype = PrinterType(d.get("device_type")) if d.get("device_type") else None
        except Exception:
            dtype = None
        row = db.query(Device).filter(Device.name == name).first()
        if not row:
            row = Device(name=name)
            db.add(row)
        row.device_type   = dtype
        row.ip_address     = d.get("ip_address")
        row.port           = d.get("port")
        row.serial_number  = d.get("serial_number")
        row.access_code    = d.get("access_code")
        row.mqtt_port      = d.get("mqtt_port", 8883)
        row.use_tls        = d.get("use_tls", True)
        row.is_active      = d.get("is_active", True)
        db.flush()  # assign id
        name_to_id[name] = row.id
        n += 1
    db.commit()

    for name, s in (settings or {}).items():
        did = name_to_id.get(name)
        if not did or not isinstance(s, dict):
            continue
        key = f"device_settings_{did}"
        cfg = db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if not cfg:
            cfg = SystemConfig(key=key, value=json.dumps(s))
            db.add(cfg)
        else:
            cfg.value = json.dumps(s)
    db.commit()
    return n


@router.post("/backup/restore")
async def import_backup(backup: dict):
    """Stellt die komplette Konfiguration aus einem Backup wieder her."""
    if not isinstance(backup, dict):
        raise HTTPException(400, "Ungültiges Backup")
    restored = []

    # Devices + per-device settings (the actual config the user cares about).
    if backup.get("devices"):
        db = SessionLocal()
        try:
            count = _restore_devices(db, backup.get("devices"),
                                     backup.get("device_settings") or {})
            restored.append(f"devices ({count})")
        finally:
            db.close()

    # Notifications (merge non-empty, keep existing token if backup omits it).
    if "notifications" in backup and isinstance(backup["notifications"], dict):
        cfg = _read_notif()
        n = backup["notifications"]
        if n.get("telegram_chat_id"):
            cfg["telegram_chat_id"] = n["telegram_chat_id"]
        if n.get("telegram_bot_token"):
            cfg["telegram_bot_token"] = n["telegram_bot_token"]
        if "enabled" in n:
            cfg["enabled"] = n["enabled"]
        _write_notif(cfg)
        restored.append("notifications")

    # Flat config files — restore each present, non-empty section verbatim.
    for path, key in _backup_files():
        if key in backup and backup[key] not in (None, {}, []):
            _safe_write_json(path, backup[key])
            restored.append(key)

    return {"success": True, "restored": restored}


# ─── Multi-target health (printer · klipper) ─────────────────────────────────

async def _health_printer() -> dict:
    """Best-effort: is a Bambu printer reachable via MQTT? Short timeout, never raises."""
    db = SessionLocal()
    try:
        device = db.query(Device).filter(Device.device_type == PrinterType.BAMBU_LAB).first()
        if not device:
            return {"status": "unconfigured", "detail": "Kein Drucker konfiguriert"}
        name = device.name
        try:
            loop = asyncio.get_event_loop()
            # Persistente Verbindung (bambu_manager) — kein eigener Connect/Disconnect pro Health-Poll.
            connected = await loop.run_in_executor(
                bambu_manager.executor, lambda: bambu_manager.ensure(device, wait_timeout=3.0))
            if connected:
                return {"status": "online", "detail": name}
            return {"status": "offline", "detail": "Keine MQTT-Verbindung"}
        except Exception:
            return {"status": "offline", "detail": "Verbindungsfehler"}
    finally:
        db.close()


async def _health_klipper() -> dict:
    """Best-effort: Moonraker /printer/info reachable + state ready?"""
    db = SessionLocal()
    try:
        k = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
        if not k:
            return {"status": "unconfigured", "detail": "Kein Klipper konfiguriert"}
        url = f"http://{k.ip_address}:{k.port}/printer/info"
    finally:
        db.close()
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(url)
        if r.status_code == 200:
            state = r.json().get("result", {}).get("state", "")
            if state == "ready":
                return {"status": "online", "detail": "ready"}
            return {"status": "stale", "detail": state or "nicht bereit"}
        return {"status": "offline", "detail": f"HTTP {r.status_code}"}
    except Exception:
        return {"status": "offline", "detail": "Nicht erreichbar"}


@router.get("/health/targets")
async def health_targets():
    """Aggregated health of printer and klipper (best-effort, parallel)."""
    printer, klipper = await asyncio.gather(_health_printer(), _health_klipper())
    return {"printer": printer, "klipper": klipper}


# ─── Language packs (downloadable from the marketplace catalog) ──────────────
# Stored as db/langpacks.json: { "<code>": {"name": str, "translations": {...}} }
# Built-in de/en live in the frontend; installed packs are merged on top there.

def _langpacks_file() -> str:
    return str(_db_dir() / "langpacks.json")


def _read_langpacks() -> dict:
    data = storage.read_json(_langpacks_file(), {})
    return data if isinstance(data, dict) else {}


class LangPackIn(BaseModel):
    code: str
    name: Optional[str] = None
    translations: Optional[dict] = None   # key-based dict for t()
    strings: Optional[dict] = None        # flat German→target dict for tr()


@router.get("/lang/installed")
async def lang_installed():
    """Installed language packs, ready for the frontend to merge into i18n."""
    return _read_langpacks()


@router.post("/lang/import")
async def lang_import(body: LangPackIn):
    """Install a pack directly from an uploaded definition (offline / file import)."""
    code = (body.code or "").strip().lower()
    has_strings = isinstance(body.strings, dict) and body.strings
    has_translations = isinstance(body.translations, dict) and body.translations
    if not code or (not has_strings and not has_translations):
        raise HTTPException(400, "code und strings oder translations erforderlich")
    packs = _read_langpacks()
    entry: dict = {"name": body.name or code.upper()}
    if has_translations:
        entry["translations"] = body.translations
    if has_strings:
        entry["strings"] = body.strings
    packs[code] = entry
    storage.write_json(_langpacks_file(), packs)
    return {"success": True, "code": code, "installed": list(packs.keys())}


@router.delete("/lang/{code}")
async def lang_delete(code: str):
    packs = _read_langpacks()
    packs.pop(code.strip().lower(), None)
    storage.write_json(_langpacks_file(), packs)
    return {"success": True, "installed": list(packs.keys())}


# ─── Auto-Farm dashboard layout (frei konfigurierbar, global) ────────────────
# Stored as db/dashboard_layout.json: { "layout": [ {i,x,y,w,h,...} ], "hidden": [ids] }.
# Global (gilt für alle Geräte) und Teil des Backups. Position + Größe stecken im
# react-grid-layout-Array, "hidden" merkt sich ausgeblendete Panels.

def _dashboard_file() -> str:
    return str(_db_dir() / "dashboard_layout.json")


@router.get("/dashboard-layout")
async def get_dashboard_layout():
    """Gespeichertes Auto-Farm-Dashboard-Layout (leeres Objekt = Standard verwenden)."""
    data = storage.read_json(_dashboard_file(), {})
    return data if isinstance(data, dict) else {}


@router.put("/dashboard-layout")
async def save_dashboard_layout(body: dict):
    """Layout (Positionen/Größen) + ausgeblendete Panels speichern."""
    if not isinstance(body, dict):
        raise HTTPException(400, "Ungültiges Layout")
    payload = {
        "layout": body.get("layout") or [],
        "hidden": body.get("hidden") or [],
        "grid_v": body.get("grid_v") or 1,   # Raster-Version (für Migration des feineren Grids)
    }
    storage.write_json(_dashboard_file(), payload)
    return {"success": True}


@router.delete("/dashboard-layout")
async def reset_dashboard_layout():
    """Layout auf Standard zurücksetzen (Datei leeren)."""
    storage.write_json(_dashboard_file(), {})
    return {"success": True}
