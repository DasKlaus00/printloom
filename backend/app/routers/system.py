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

from app.services import storage, appsettings
from app.db.database import SessionLocal
from app.models.models import Device, PrinterType
from app.services.bambu_mqtt import BambuLabMQTT

router = APIRouter(tags=["System"])
logger = logging.getLogger(__name__)

WATCHTOWER_URL   = os.getenv("WATCHTOWER_URL", "http://watchtower:8080")
WATCHTOWER_TOKEN = os.getenv("WATCHTOWER_TOKEN", "printloom-update-token")
GITHUB_TOKEN     = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO      = os.getenv("GITHUB_REPO", "DasKlaus00/printloom")
IMAGE_BASE       = os.getenv("PRINTLOOM_IMAGE", "ghcr.io/dasklaus00/printloom")
CONTAINER_NAME   = os.getenv("PRINTLOOM_CONTAINER", "printloom-app")

_DB_CANDIDATES = [
    Path("/app/db"),
    Path(os.path.join(os.path.dirname(__file__), "../../../db")),
]


def _db_dir() -> Path:
    for p in _DB_CANDIDATES:
        if p.exists():
            return p
    _DB_CANDIDATES[-1].mkdir(parents=True, exist_ok=True)
    return _DB_CANDIDATES[-1]


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
    for path in ["/app/version.txt", os.path.join(os.path.dirname(__file__), "../../../version.txt")]:
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


@router.get("/version")
async def get_version(channel: str = "latest"):
    """Update check for the selected channel: stable (git tags) or beta (:beta image)."""
    current = _get_current_version()
    if (channel or "").lower() == "beta":
        return await _check_beta(current)
    return await _check_stable(current)


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


@router.post("/update")
async def trigger_update(body: UpdateIn = UpdateIn()):
    """Update to / switch onto the chosen channel.

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
            updater.spawn_helper(target_image, CONTAINER_NAME)
            return {"success": True, "method": "docker", "switching": True, "image": target_image}
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

def _safe_load_json(path: str) -> dict:
    return storage.read_json(path, {}) or {}


def _safe_write_json(path: str, data):
    try:
        storage.write_json(path, data)
    except Exception as e:
        raise HTTPException(500, f"Schreiben fehlgeschlagen: {e}")


@router.get("/backup")
async def export_backup():
    """Exportiert alle Einstellungen als JSON."""
    notifications = _read_notif()
    # Verstecke den Token im Export (wird maskiert zurückgegeben)
    notifications_export = {k: v for k, v in notifications.items() if k != "telegram_bot_token"}
    notifications_export["telegram_bot_token"] = ""  # Sicherheit: Token nicht exportieren

    rack_slots = _safe_load_json("/app/db/rack_slots.json")
    schedules  = _safe_load_json("/app/db/schedules.json") or []
    racks      = _safe_load_json("/app/db/racks.json") or []

    return {
        "current_version": _get_current_version(),
        "exported_at":     datetime.now().isoformat(),
        "notifications":   notifications_export,
        "rack_slots":      rack_slots,
        "racks":           racks,
        "schedules":       schedules,
    }


@router.post("/backup/restore")
async def import_backup(backup: dict):
    """Stellt Einstellungen aus einem Backup wieder her."""
    restored = []

    if "notifications" in backup:
        cfg = _read_notif()
        n = backup["notifications"]
        # Überschreibe nur nicht-leere Felder
        if n.get("telegram_chat_id"):
            cfg["telegram_chat_id"] = n["telegram_chat_id"]
        if n.get("telegram_bot_token"):
            cfg["telegram_bot_token"] = n["telegram_bot_token"]
        if "enabled" in n:
            cfg["enabled"] = n["enabled"]
        _write_notif(cfg)
        restored.append("notifications")

    if "rack_slots" in backup and backup["rack_slots"]:
        _safe_write_json("/app/db/rack_slots.json", backup["rack_slots"])
        restored.append("rack_slots")

    if "racks" in backup and backup["racks"]:
        _safe_write_json("/app/db/racks.json", backup["racks"])
        restored.append("racks")

    if "schedules" in backup and backup["schedules"]:
        _safe_write_json("/app/db/schedules.json", backup["schedules"])
        restored.append("schedules")

    return {"success": True, "restored": restored}


# ─── Marketplace settings (server URL + om4d_ token) ─────────────────────────

class MarketplaceIn(BaseModel):
    server_url: Optional[str] = None
    token: Optional[str] = None


@router.get("/marketplace")
async def get_marketplace():
    """Return marketplace config. The token is never sent back, only whether one is set."""
    mp = appsettings.read_marketplace()
    return {"server_url": mp["server_url"], "token_set": bool(mp["token"])}


@router.put("/marketplace")
async def save_marketplace(data: MarketplaceIn):
    payload = {}
    if data.server_url is not None:
        payload["server_url"] = data.server_url
    if data.token is not None:
        payload["token"] = data.token
    mp = appsettings.write_marketplace(payload)
    return {"server_url": mp["server_url"], "token_set": bool(mp["token"])}


# ─── Multi-target health (printer · klipper · server) ────────────────────────

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
            client = BambuLabMQTT(device)
            connected = await loop.run_in_executor(None, lambda: client.connect(wait_timeout=3.0))
            if connected:
                await loop.run_in_executor(None, client.disconnect)
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


async def _health_server() -> dict:
    """Best-effort: marketplace server reachable / token valid?"""
    mp = appsettings.read_marketplace()
    base, token = mp["server_url"], mp["token"]
    if not base:
        return {"status": "unconfigured", "detail": "Keine Server-URL"}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            if token:
                r = await client.get(f"{base}/api/me", headers={"Authorization": f"Bearer {token}"})
                if r.status_code == 200:
                    return {"status": "online", "detail": "verbunden"}
                if r.status_code in (401, 403):
                    return {"status": "unauth", "detail": "Token ungültig"}
                return {"status": "offline", "detail": f"HTTP {r.status_code}"}
            r = await client.get(f"{base}/healthz")
            if r.status_code == 200:
                return {"status": "unauth", "detail": "Kein Token gesetzt"}
            return {"status": "offline", "detail": f"HTTP {r.status_code}"}
    except Exception:
        return {"status": "offline", "detail": "Nicht erreichbar"}


@router.get("/health/targets")
async def health_targets():
    """Aggregated health of printer, klipper and marketplace server (best-effort, parallel)."""
    printer, klipper, server = await asyncio.gather(
        _health_printer(), _health_klipper(), _health_server()
    )
    return {"printer": printer, "klipper": klipper, "server": server}


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
    translations: Optional[dict] = None


@router.get("/lang/installed")
async def lang_installed():
    """Installed language packs, ready for the frontend to merge into i18n."""
    return _read_langpacks()


@router.get("/lang/catalog")
async def lang_catalog():
    """List language packs available on the configured marketplace server."""
    mp = appsettings.read_marketplace()
    base = mp["server_url"]
    if not base:
        raise HTTPException(400, "Kein Marktplatz-Server konfiguriert")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{base}/api/langpacks")
        if r.status_code != 200:
            raise HTTPException(502, f"Katalog nicht verfügbar (HTTP {r.status_code})")
        return r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Katalog nicht erreichbar: {e}")


@router.post("/lang/install")
async def lang_install(body: LangPackIn):
    """Install a pack: download {server}/api/langpacks/{code} and store it locally."""
    code = (body.code or "").strip().lower()
    if not code:
        raise HTTPException(400, "Kein Sprachcode angegeben")
    mp = appsettings.read_marketplace()
    base = mp["server_url"]
    if not base:
        raise HTTPException(400, "Kein Marktplatz-Server konfiguriert")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{base}/api/langpacks/{code}")
        if r.status_code != 200:
            raise HTTPException(502, f"Pack nicht gefunden (HTTP {r.status_code})")
        pack = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Pack nicht erreichbar: {e}")
    translations = pack.get("translations") or pack.get("data") or {}
    if not isinstance(translations, dict) or not translations:
        raise HTTPException(400, "Pack enthält keine Übersetzungen")
    packs = _read_langpacks()
    packs[code] = {"name": pack.get("name", code.upper()), "translations": translations}
    storage.write_json(_langpacks_file(), packs)
    return {"success": True, "code": code, "installed": list(packs.keys())}


@router.post("/lang/import")
async def lang_import(body: LangPackIn):
    """Install a pack directly from an uploaded definition (offline / file import)."""
    code = (body.code or "").strip().lower()
    if not code or not isinstance(body.translations, dict) or not body.translations:
        raise HTTPException(400, "code und translations erforderlich")
    packs = _read_langpacks()
    packs[code] = {"name": body.name or code.upper(), "translations": body.translations}
    storage.write_json(_langpacks_file(), packs)
    return {"success": True, "code": code, "installed": list(packs.keys())}


@router.delete("/lang/{code}")
async def lang_delete(code: str):
    packs = _read_langpacks()
    packs.pop(code.strip().lower(), None)
    storage.write_json(_langpacks_file(), packs)
    return {"success": True, "installed": list(packs.keys())}
