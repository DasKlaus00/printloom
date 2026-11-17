import os
import re
import sys
import json
import asyncio
import logging
import time
import httpx
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional

from app.services import storage
from app.db.database import SessionLocal
from app.models.models import Device, PrinterType, SystemConfig
from app.services import bambu_manager, credentials, device_settings
from app import paths

router = APIRouter(tags=["System"])
logger = logging.getLogger(__name__)

GITHUB_TOKEN    = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO      = os.getenv("GITHUB_REPO", "DasKlaus00/printloom")
IMAGE_BASE       = os.getenv("PRINTLOOM_IMAGE", "ghcr.io/dasklaus00/printloom")
CONTAINER_NAME   = os.getenv("PRINTLOOM_CONTAINER", "printloom-app")

def _db_dir() -> Path:
    paths.DB_DIR.mkdir(parents=True, exist_ok=True)
    return paths.DB_DIR


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

VERSION_LABEL = "org.opencontainers.image.version"
_MANIFEST_ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])


async def _ghcr_image(tag: str) -> Optional[dict]:
    """{"digest", "version"} von ghcr.io/<repo>:<tag>; None, wenn nicht abrufbar.
    Geht ohne Anmeldung (ghcr gibt für öffentliche Pakete auch so ein Pull-Token).

    Die Version steht als OCI-Label im Image (seit v1.1.39, gesetzt in
    docker-publish.yml). Vorher zeigte der Beta-Kanal nur einen Digest
    („sha256:3f9a…") — daran sieht niemand, ob sich ein Update lohnt. Ältere
    Images haben kein Label: dann ist version None."""
    owner, _, repo = GITHUB_REPO.partition("/")
    if not owner or not repo:
        return None
    path = f"{owner.lower()}/{repo.lower()}"
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            tr = await client.get(
                f"https://ghcr.io/token?scope=repository:{path}:pull&service=ghcr.io")
            token = tr.json().get("token") if tr.status_code == 200 else None
            headers = {"Accept": _MANIFEST_ACCEPT}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            r = await client.get(f"https://ghcr.io/v2/{path}/manifests/{tag}", headers=headers)
            if r.status_code != 200:
                return None
            info = {"digest": r.headers.get("Docker-Content-Digest"), "version": None}
            try:
                info["version"] = await _image_version(client, path, headers, r.json())
            except Exception as e:
                logger.info(f"Versions-Label von :{tag} nicht lesbar: {e}")
            return info
    except Exception as e:
        logger.info(f"ghcr nicht erreichbar ({tag}): {e}")
        return None


async def _image_version(client, path: str, headers: dict, manifest: dict) -> Optional[str]:
    """Versions-Label aus der Image-Konfiguration. Ein Multi-Arch-Index verweist auf
    ein Manifest je Plattform (plus Attestierungen mit Plattform „unknown"); das
    Label ist in allen gleich, also reicht das erste echte."""
    if "manifests" in manifest:
        real = [m for m in manifest["manifests"]
                if (m.get("platform") or {}).get("architecture") not in (None, "unknown")]
        if not real:
            return None
        r = await client.get(f"https://ghcr.io/v2/{path}/manifests/{real[0]['digest']}",
                             headers=headers)
        r.raise_for_status()
        manifest = r.json()
    cfg = (manifest.get("config") or {}).get("digest")
    if not cfg:
        return None
    r = await client.get(f"https://ghcr.io/v2/{path}/blobs/{cfg}", headers=headers)
    r.raise_for_status()
    labels = (r.json().get("config") or {}).get("Labels") or {}
    version = (labels.get(VERSION_LABEL) or "").lstrip("v")
    # metadata-action setzte hier früher den Branch-Namen („beta") ein.
    return version if re.fullmatch(r"\d+\.\d+\.\d+", version) else None


async def _branch_version(branch: str) -> Optional[str]:
    """version.txt im Branch — ist sie neuer als das Image, läuft der Build noch."""
    url = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{branch}/backend/version.txt"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
        if r.status_code == 200:
            return r.text.strip()
    except Exception as e:
        logger.info(f"version.txt in {branch} nicht lesbar: {e}")
    return None


def _running_beta_digest() -> Optional[str]:
    try:
        from app.services import updater
        return updater.running_repo_digest(CONTAINER_NAME, IMAGE_BASE)
    except Exception:
        return None


async def _check_beta(current: str) -> dict:
    """Beta-Kanal: Digest des laufenden Images gegen den von :beta. Der Digest
    entscheidet (ein Neubau derselben Version ist auch ein Update), angezeigt wird
    die Version aus dem Image-Label."""
    result = {
        "current": current, "channel": "beta", "latest": None, "latest_version": None,
        "update_available": False, "token_configured": bool(GITHUB_TOKEN), "error": None,
    }
    remote, branch = await asyncio.gather(_ghcr_image("beta"), _branch_version("beta"))
    if not remote or not remote.get("digest"):
        result["error"] = "Beta-Image nicht abrufbar (ghcr nicht erreichbar oder Package privat?)"
        return result
    result["latest_version"] = remote["version"]
    result["latest"] = remote["version"] or remote["digest"][:19]
    local = _running_beta_digest()
    if local:
        result["update_available"] = (local != remote["digest"])
        result["installed_digest"] = local[:19]
    elif remote["version"]:
        result["update_available"] = _is_newer(remote["version"], current)
    else:
        # Weder lokaler Digest (kein Socket) noch Version im Image → anbieten.
        result["update_available"] = True
        result["note"] = "Installierter Beta-Stand unbekannt — Update zieht den neuesten Beta-Build."
    result["building"] = _building(branch, remote["version"])
    return result


def _building(branch_version: Optional[str], image_version: Optional[str]) -> Optional[str]:
    """Version, die gerade gebaut wird — oder None. Nur mit Label vergleichbar."""
    if branch_version and image_version and _is_newer(branch_version, image_version):
        return branch_version
    return None


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
    latest = await _branch_version(branch)
    if latest:
        result["latest"] = latest
        result["update_available"] = _is_newer(latest, current)
    else:
        result["error"] = "GitHub nicht erreichbar"
    return result


def _remember_channel(channel) -> None:
    from app.services import appsettings
    try:
        appsettings.write_update_channel((channel or "latest").lower())
    except OSError as e:
        logger.warning(f"Update-Kanal nicht gespeichert: {e}")


def _running_channel() -> str:
    """Kanal der laufenden Installation: Docker → Tag des laufenden Images (beta oder
    latest), sonst der beim letzten Update gespeicherte."""
    from app.services import appsettings
    if paths.RUNTIME not in ("native", "native-linux") and _docker_available():
        from app.services import updater
        image = updater.current_image(CONTAINER_NAME) or ""
        if ":" in image.rsplit("/", 1)[-1]:
            return "beta" if image.rsplit(":", 1)[-1] == "beta" else "latest"
    return appsettings.read_update_channel()


def _version_tuple(v) -> Optional[tuple]:
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split("."))
    except (TypeError, ValueError):
        return None


@router.get("/version")
async def get_version(channel: Optional[str] = None):
    """Update check for the selected channel: stable (git tags) or beta (:beta image).

    Native Desktop-App: prüft GitHub-Releases auf einen Installer statt Docker/ghcr.

    WICHTIG (Opt-in): Die Prüfung geht ins Internet (GitHub/ghcr). Ist die
    „Update-Prüfung im Internet" nicht freigeschaltet, wird KEIN externer Request
    gemacht — es kommt nur die installierte Version zurück. Die einmalige Prüfung
    auf Knopfdruck ist POST /version/check: Bis v1.1.41 ging das per GET mit
    force=1, und jede fremde Seite konnte mit einem <img> eine Anfrage ins Internet
    auslösen, obwohl der Nutzer sie abgeschaltet hatte."""
    return await _version_info(channel or _running_channel(), force=False)


@router.post("/version/check")
async def check_version_now(channel: Optional[str] = None):
    """Einmalige Update-Prüfung auf ausdrücklichen Knopfdruck (die UI fragt vorher),
    auch wenn die automatische Prüfung aus ist. POST, damit der Wächter in main.py
    fremde Seiten aussperrt."""
    return await _version_info(channel or _running_channel(), force=True)


# Ergebnis der Prüfung im Internet für ein paar Minuten merken. Ohne das fragte bei
# eingeschalteter Update-Prüfung JEDER GET GitHub/ghcr, ggf. mit GITHUB_TOKEN; eine
# fremde Seite konnte so per <img> das Rate-Limit leeren. Der POST /version/check
# (Knopf in der Oberfläche) fragt immer frisch.
_VERSION_CACHE: dict = {}
_VERSION_CACHE_S = 300.0


UPDATE_FAILED_AFTER_S = 600     # so lange darf der Wechsel dauern, dann gilt er als gescheitert
UPDATE_MARKER_MAX_S = 24 * 3600  # danach wird ein Marker vergessen (nicht ewig „fehlgeschlagen")


def _update_marker_path() -> str:
    return str(_db_dir() / "update_pending.json")


def _write_update_marker(data: dict) -> None:
    try:
        storage.write_json(_update_marker_path(), data)
    except OSError as e:
        logger.warning(f"Update-Marker nicht geschrieben: {e}")


def _clear_update_marker() -> None:
    try:
        os.remove(_update_marker_path())
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.warning(f"Update-Marker nicht gelöscht: {e}")


def update_result(current: str) -> Optional[dict]:
    """Was wurde aus dem letzten Update? None = keins offen. „ok" (Version gewechselt,
    Marker weg), „pending" (läuft noch), „failed" (nach 10 min dieselbe Version)."""
    try:
        m = storage.read_json(_update_marker_path(), None)
    except (OSError, ValueError):
        m = None
    if not isinstance(m, dict):
        return None
    if str(m.get("from_version")) != str(current):
        _clear_update_marker()
        return {"state": "ok", "from": m.get("from_version"), "to": current}
    age = time.time() - float(m.get("at") or 0)
    if age > UPDATE_MARKER_MAX_S:
        _clear_update_marker()
        return None
    state = "failed" if age > UPDATE_FAILED_AFTER_S else "pending"
    return {"state": state, "from": m.get("from_version"), "target_image": m.get("target_image")}


async def _version_info(channel: str, force: bool) -> dict:
    info = await _version_info_inner(channel, force)
    return {**info, "update_result": update_result(info.get("current")),
            "running_channel": _running_channel()}


async def _version_info_inner(channel: str, force: bool) -> dict:
    current = _get_current_version()
    from app.services import online
    if not online.enabled("update_check") and not force:
        return {
            "current": current, "channel": channel or "latest", "latest": None,
            "update_available": False, "checked": False, "online_disabled": True,
            "docker_available": _docker_available(), "runtime": paths.RUNTIME,
            "error": None,
        }
    key = (paths.RUNTIME, (channel or "latest").lower(), current)
    hit = _VERSION_CACHE.get(key)
    if not force and hit and time.monotonic() - hit[0] < _VERSION_CACHE_S:
        return dict(hit[1])
    result = await _version_check(current, channel)
    if not result.get("error"):
        _VERSION_CACHE[key] = (time.monotonic(), dict(result))
    return result


async def _version_check(current: str, channel: str) -> dict:
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
            # Ein Update zieht :latest, nicht den Tag. Ist das Image noch älter als
            # der Tag (Build läuft), gäbe es nach dem Klick nichts Neues.
            image = await _ghcr_image("latest")
            result["building"] = _building(latest, image and image["version"])
            if result["building"]:
                result["update_available"] = _is_newer(image["version"], current)
        else:
            result["error"] = "Keine passenden Versions-Tags im Repo gefunden"
    except Exception as e:
        result["error"] = f"GitHub nicht erreichbar: {str(e)[:120]}"
    return result


class UpdateIn(BaseModel):
    # Nur der Kanal. Bis v1.1.41 nahm der Endpunkt auch download_url/asset_name an
    # und startete, was dort stand — eine fremde Seite (DNS-Rebinding) konnte so
    # jede .exe auf dem Windows-PC ausführen lassen. Woher der Installer kommt,
    # entscheidet jetzt allein native_update.check(). Pydantic ignoriert die alten
    # Felder, ältere Oberflächen brechen also nicht.
    channel: Optional[str] = None
    # Auf einen anderen Kanal mit älterer (oder unbekannter) Version nur, wenn der
    # Nutzer das Zurückstufen ausdrücklich bestätigt hat.
    confirm_downgrade: bool = False


async def _assert_no_silent_downgrade(body: "UpdateIn", info: Optional[dict] = None) -> None:
    """Erst kurz vor dem eigentlichen Update (nach den anderen Prüfungen): Die Abfrage
    der Zielversion geht ins Internet, das tut das Update ohnehin."""
    target = (body.channel or _running_channel()).lower()
    if target == _running_channel() or body.confirm_downgrade:
        return
    current = _get_current_version()
    if info is None:
        info = await _version_check(current, target)
    tv = info.get("latest_version") or info.get("latest")
    cur_t, tv_t = _version_tuple(current), _version_tuple(tv)
    if tv_t is None or cur_t is None or tv_t < cur_t:
        raise HTTPException(409, {"error": "ZURUECKSTUFEN", "from": current, "to": tv,
                                  "channel": target,
                                  "message": f"Wechsel auf „{target}“ stuft zurück "
                                             f"(v{current} → v{tv or '?'}) — bitte bestätigen"})


@router.post("/update")
async def trigger_update(body: UpdateIn = UpdateIn()):
    """Update to / switch onto the chosen channel.

    Native Desktop-App: lädt das Installer-Asset des passenden GitHub-Release und
    startet es (der Installer schließt die App und ersetzt die Dateien)."""
    # Bleibt nach Erfolg gesetzt: Die App startet ohnehin gleich neu.
    with _Wartung("Update läuft", keep_on_success=True):
        return await _trigger_update(body)


async def _trigger_update(body: "UpdateIn"):
    if paths.RUNTIME == "native-linux":
        raise HTTPException(
            501,
            "Native Installation ohne Docker — Update per SSH ausführen: "
            "bash ~/printloom/scripts/update-native.sh")
    if paths.RUNTIME == "native":
        from app.services import native_update
        info = await native_update.check(_get_current_version(), (body.channel or _running_channel()))
        if info.get("error"):
            raise HTTPException(502, info["error"])
        if not info.get("update_available"):
            from app.routers import autofarm
            autofarm.clear_maintenance()     # nichts zu tun: keine Wartung
            return {"success": False, "reason": "up_to_date", "current": info.get("current")}
        url, asset = info.get("download_url"), info.get("asset_name")
        if not url:
            raise HTTPException(502, "Kein Installer-Asset im Release gefunden")
        await _assert_no_silent_downgrade(body, info)
        try:
            res = await asyncio.to_thread(native_update.download_and_launch, url, asset)
        except ValueError as e:
            # Adresse oder Dateiname passen nicht zum eigenen Release: nichts geladen.
            raise HTTPException(400, f"Installer abgelehnt: {e}")
        except Exception as e:
            raise HTTPException(502, f"Installer-Download/Start fehlgeschlagen: {e}")
        _remember_channel(body.channel)
        from app.routers import autofarm
        autofarm.clear_maintenance()
        return {"success": True, "method": "native", **res}
    return await _trigger_update_docker(body)


NO_DOCKER_SOCKET = ("Kein Docker-Socket gemountet — Update aus der Oberfläche nicht "
                    "möglich. Auf dem Server: docker compose pull && docker compose up -d")


async def _trigger_update_docker(body: "UpdateIn"):
    """Update/Kanalwechsel im Container-Betrieb über den Docker-Socket: neues Image
    ziehen, dann baut ein Helfer-Container die App mit gleicher Konfiguration neu auf.

    Bis v1.1.38 gab es ohne Socket einen Rückfall auf Watchtower. Den richtet seit
    dem Wechsel auf das Socket-Update niemand mehr ein; er brauchte aber einen
    eigenen Token mit öffentlich bekanntem Standardwert und konnte keinen
    Kanalwechsel. Ohne Socket bleibt der Weg über die Kommandozeile."""
    channel = (body.channel or "latest").lower()
    tag = "beta" if channel == "beta" else "latest"
    target_image = f"{IMAGE_BASE}:{tag}"

    from app.services import updater
    if not updater.docker_available():
        raise HTTPException(501, NO_DOCKER_SOCKET)
    await _assert_no_silent_downgrade(body)
    # Erst HIER ziehen: ein Fehler (privates Package, falscher Tag, kein Netz) kommt
    # so als echte Meldung zurück, statt dass ein abgekoppelter Helfer still stirbt
    # („Update läuft ewig, passiert nichts").
    ok, detail = await asyncio.to_thread(updater.pull_image, target_image)
    if not ok:
        raise HTTPException(502, detail)
    # Merken, was gerade passieren soll: Nach dem Neustart sagt GET /version, ob die
    # Version wirklich gewechselt hat (bis v1.1.60 hieß es immer „Fertig").
    _write_update_marker({"from_version": _get_current_version(), "target_image": target_image,
                          "channel": channel, "at": time.time()})
    try:
        updater.spawn_helper(target_image, CONTAINER_NAME)
    except Exception as e:
        _clear_update_marker()
        logger.exception("Update-Helfer nicht gestartet")
        raise HTTPException(502, f"Update-Helfer nicht gestartet: {e}")
    _remember_channel(channel)
    return {"success": True, "method": "docker", "switching": True, "image": target_image}


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


# ─── Backup endpoints ────────────────────────────────────────────────────────
# Ein Backup ist die KOMPLETTE Konfiguration, damit eine Neuinstallation vollständig
# wiederhergestellt werden kann: Geräte (mit Zugangsdaten), Einstellungen je Gerät
# (Kamera/HA-Token/Steckdose), Sequenzen, Farm-Einstellungen, Regal + Fächer,
# Geometrie, Projekte, AMS-Zuordnungen je Datei, Filamente, Profile, Sprachpakete,
# Dashboard-Anordnung.
#
# Zugangsdaten (Access-Code, HA-Token, Steckdosen-Passwort, URLs mit Passwort) stehen
# seit v1.1.39 NUR auf ausdrücklichen Wunsch drin — dann im Abschnitt "secrets",
# auf Wunsch mit Passwort verschlüsselt. Bis dahin lagen sie in jedem Backup im
# Klartext, auch in dem, das man vor einem Update „nur zur Sicherheit" zieht.
# Ohne Zugangsdaten eingespielt, bleiben die vorhandenen erhalten.
#
# Bis v1.1.34 fehlten Projekte, die manuellen AMS-Zuordnungen je Datei und das
# Drucker-Modell der Geräte — Arbeit des Nutzers, die nach einer Wiederherstellung
# weg war. Ältere Backups mit "calibration", "racks", "schedules" oder
# "notifications" lassen sich weiter einspielen; diese Teile gibt es nicht mehr.

BACKUP_SCHEMA = "printloom-backup/3"

# (path, backup-key) for the flat JSON config files in the db dir.
def _backup_files() -> list:
    from app.routers import autofarm, filaments, control, project
    from app.services import ams_match, farm_settings, rack_store
    db_dir = _db_dir()
    return [
        (autofarm.SEQ_PATH,          "sequences"),
        (farm_settings.PATH,         "settings"),
        (rack_store.SLOTS_PATH,      "rack_slots"),
        (filaments.CUSTOM_PATH,      "filaments"),
        (project.PROJECT_PATH,       "projects"),
        (ams_match.FILE_AMSMAP_PATH, "file_ams_map"),
        # OTTOeject-Geometrie (Drucker-Tab: X-Positionen je Regal/Drucker,
        # G-code-Overrides, Geschwindigkeiten je Op) — war bisher NICHT im Backup.
        (control.GEOMETRY_PATH,      "geometry"),
        # Lokale Profil-Bibliothek (Setup-/Geometrie-Profile).
        (str(db_dir / "profiles.json"),        "profiles"),
        # Globaler Kamera-Aus-Schalter (Energiesparmodus).
        (str(db_dir / "camera_settings.json"), "camera_settings"),
        (_langpacks_file(),          "langpacks"),
        (_dashboard_file("farm"),    "dashboard_layout"),
        (_dashboard_file("home"),    "dashboard_layout_home"),
    ]


# ─── Datenspeicher: kaputte Dateien melden und bewusst zurücksetzen ──────────
# Seit v1.1.48 ersetzt Printloom eine unlesbare Datei nicht mehr still durch die
# Vorgabe (storage.read_json_checked). Hier sieht man, welche es betrifft, und setzt
# sie auf ausdrücklichen Wunsch zurück; die kaputte Fassung bleibt als Kopie liegen.

def _data_files() -> list:
    """(Pfad, Schlüssel) — dieselbe Liste wie das Backup, dazu die Warteschlange."""
    from app.routers import autofarm
    return _backup_files() + [(autofarm.QUEUE_PATH, "queue")]


# Erwarteter Typ je Datei (None = jedes JSON) und die Vorgabe beim Zurücksetzen.
# Nur Dateien mit Vorgabe lassen sich zurücksetzen; der Rest wird nur gemeldet.
def _data_file_rules() -> dict:
    from app.routers import autofarm
    from app.services import farm_settings, rack_store
    return {
        "rack_slots": (dict, rack_store.default_data),
        "settings":   (dict, lambda: dict(farm_settings.DEFAULTS)),
        "sequences":  (dict, lambda: {"schema_version": autofarm.SEQ_SCHEMA_VERSION,
                                      "seq_new": [], "seq_next": []}),
        "geometry":   (dict, lambda: {}),
        "queue":      (dict, lambda: {"jobs": []}),
        "filaments":  (list, lambda: []),
    }


def _file_state(path: str, key: str) -> dict:
    import glob
    expect = (_data_file_rules().get(key) or (None, None))[0]
    broken, reason = False, None
    if os.path.exists(path):
        try:
            storage.read_json_checked(path, None, expect=expect)
        except storage.BrokenFile as e:
            broken, reason = True, e.reason
    backups = sorted(glob.glob(glob.escape(path) + ".broken-*"))
    return {"key": key, "file": os.path.basename(path), "broken": broken, "reason": reason,
            "backup": os.path.basename(backups[-1]) if backups else None,
            "resettable": key in _data_file_rules()}


@router.get("/data-files")
async def data_files():
    files = [_file_state(p, k) for p, k in _data_files()]
    return {"files": files, "broken": sum(1 for f in files if f["broken"])}


@router.post("/data-files/{key}/reset")
async def reset_data_file(key: str):
    """Eine UNLESBARE Datei sichern (…broken-<Zeit>) und durch die Vorgabe ersetzen.
    Nur bei Stillstand, und nur, wenn sie wirklich kaputt ist: Eine lesbare Datei
    setzt dieser Weg nie zurück (sonst wäre er ein Knopf zum Löschen)."""
    from app.routers import autofarm
    if autofarm._farm.get("running") or autofarm._stress.get("running"):
        raise HTTPException(409, "Auto Farm oder Stresstest läuft — erst stoppen")
    path = next((p for p, k in _data_files() if k == key), None)
    rules = _data_file_rules().get(key)
    if not path or not rules:
        raise HTTPException(404, "Für diese Datei gibt es kein Zurücksetzen")
    if not _file_state(path, key)["broken"]:
        raise HTTPException(400, "Die Datei ist lesbar — kein Zurücksetzen nötig")
    backup = storage.backup_broken(path)
    storage.write_json(path, rules[1]())
    logger.warning(f"Datendatei {key} zurückgesetzt, Kopie: {backup}")
    if key == "queue":
        autofarm.reload_queue()      # die Farm hält die Liste im Speicher
    return {"success": True, "backup": os.path.basename(backup)}


# ─── Diagnose-Paket (Support) ────────────────────────────────────────────────
# Anders als das Backup enthält das Diagnose-Paket ABSICHTLICH KEINE Zugangsdaten:
# es ist zum Verschicken gedacht. Alles, was nach Geheimnis aussieht, wird anhand des
# SCHLÜSSELNAMENS rekursiv ersetzt (nicht anhand einer Whitelist von Dateien) — so
# rutscht auch bei künftig neuen Feldern kein Token mit raus. Was als Geheimnis gilt,
# entscheidet `credentials` — dieselbe Regel wie beim Backup.
_REDACTED = "***entfernt***"

# Adressen: Das NETZ bleibt erkennbar (192.168.1.x oder Docker-Netz 172.17.0.x — genau
# das braucht man bei „Drucker nicht erreichbar"), das einzelne Gerät nicht. Rechnernamen
# in URLs (oft mit Personen- oder Ortsnamen) und Zugangsdaten darin fallen ganz weg.
# Bis v1.1.34 standen die Adressen vollständig im Paket.
_IPV4 = re.compile(r"\b((?:\d{1,3}\.){3})\d{1,3}\b")
_URL_HOST = re.compile(r"\b([a-z][a-z0-9+.-]*://)(?:[^@/\s]*@)?([^/\s:]+)", re.IGNORECASE)


def _mask_hosts(text: str) -> str:
    """Letzte Stelle von IP-Adressen und Rechnernamen in URLs unkenntlich machen."""
    def host(m):
        h = m.group(2)
        return m.group(1) + (h if _IPV4.fullmatch(h) else "<host>")
    return _IPV4.sub(r"\1x", _URL_HOST.sub(host, text))


def _redact(value, _depth: int = 0):
    """Rekursiv Geheimnisse ersetzen und Adressen unkenntlich machen. Werte bleiben
    strukturell erhalten (damit man sieht, DASS etwas konfiguriert ist), nur der
    Inhalt verschwindet."""
    if _depth > 30:
        return value
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if credentials.is_secret_key(k):
                out[k] = _REDACTED if v not in (None, "", [], {}) else v
            else:
                out[k] = _redact(v, _depth + 1)
        return out
    if isinstance(value, list):
        return [_redact(v, _depth + 1) for v in value]
    if isinstance(value, str):
        return _mask_hosts(value)
    return value


def _diag_devices() -> tuple:
    """(devices, per_device_settings, error) — Geräteliste OHNE Zugangsdaten und
    Adressen, die Einstellungen je Gerät redigiert. Eigene Session, damit die
    ZIP-Erzeugung keine offene DB-Verbindung hält."""
    db = SessionLocal()
    try:
        devices = [{
            "id": d.id, "name": d.name,
            "device_type": getattr(d.device_type, "value", str(d.device_type)),
            "model": d.model, "ip_address": _mask_hosts(d.ip_address or ""),
            "port": d.port, "mqtt_port": d.mqtt_port,
            "use_tls": d.use_tls, "is_active": d.is_active,
            # Nur ob etwas gesetzt ist — nie der Wert selbst.
            "has_access_code": bool(d.access_code), "has_serial": bool(d.serial_number),
        } for d in db.query(Device).all()]
        per_dev = {}
        for r in db.query(SystemConfig).filter(
                SystemConfig.key.like(f"{device_settings.KEY_PREFIX}%")).all():
            try:
                per_dev[r.key] = _redact(json.loads(r.value))
            except Exception:
                per_dev[r.key] = _REDACTED
        return devices, per_dev, None
    except Exception as e:
        return [], {}, str(e)
    finally:
        db.close()


@router.get("/diagnostics")
async def download_diagnostics():
    """Diagnose-Paket als ZIP zum Herunterladen und Verschicken (Support).

    Enthält Konfiguration (Geometrie, Regal, Sequenzen, Farm-Einstellungen),
    Versions-/Laufzeit-Infos und die Geräteliste OHNE Zugangsdaten.
    Ausdrücklich NICHT enthalten: Access-Codes, Tokens, Passwörter, Druckdateien."""
    import io
    import zipfile
    from datetime import datetime as _dt

    included, skipped = [], []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path, key in _backup_files():
            data = storage.read_json(path, None)
            if data is None:
                skipped.append(key)
                continue
            z.writestr(f"config/{key}.json", json.dumps(_redact(data), indent=2, ensure_ascii=False))
            included.append(key)

        # Geräte + pro-Gerät-Einstellungen, beides ohne Zugangsdaten.
        devices, per_dev, dev_err = _diag_devices()
        if dev_err:
            skipped.append(f"devices ({dev_err})")
        else:
            z.writestr("devices.json", json.dumps(devices, indent=2, ensure_ascii=False))
            included.append("devices (ohne Zugangsdaten)")
            if per_dev:
                z.writestr("device_settings.json", json.dumps(per_dev, indent=2, ensure_ascii=False))
                included.append("device_settings (Tokens entfernt)")

        # Farm-Log (letzte Zeilen) — hilft bei Ablauf-Fehlern am meisten.
        try:
            from app.routers import autofarm
            log = (autofarm._farm.get("log") or [])[-500:]
            if log:
                z.writestr("farm_log.txt", "\n".join(_mask_hosts(str(entry)) for entry in log))
                included.append("farm_log (letzte 500 Zeilen)")
        except Exception:
            pass

        from app.services import online as _online
        env = {
            "version": _get_current_version(),
            "runtime": paths.RUNTIME,
            "docker_available": _docker_available(),
            "platform": sys.platform,
            "python": sys.version.split()[0],
            "created_at": _dt.now().isoformat(timespec="seconds"),
            # Zeigt, WELCHE Online-Funktionen an sind (für „warum kommen keine Hinweise?").
            "online_settings": _online.read_settings(),
        }
        z.writestr("environment.json", json.dumps(env, indent=2, ensure_ascii=False))
        z.writestr("README.txt",
                   "Printloom Diagnose-Paket\n"
                   "========================\n\n"
                   f"Erstellt: {env['created_at']}\nVersion: {env['version']}\n"
                   f"Laufzeit: {env['runtime']}\n\n"
                   "Enthalten:\n  - " + "\n  - ".join(included) + "\n\n"
                   "NICHT enthalten (absichtlich): Access-Codes, Tokens, Passwörter,\n"
                   "IP-Adressen und Rechnernamen, Druckdateien, Kamerabilder.\n\n"
                   "Dieses Paket wird NICHT automatisch verschickt — du entscheidest,\n"
                   "wem du es gibst.\n")

    buf.seek(0)
    stamp = _dt.now().strftime("%Y%m%d_%H%M%S")
    return Response(
        content=buf.getvalue(), media_type="application/zip",
        headers={"Content-Disposition":
                 f'attachment; filename="printloom_diagnose_{stamp}.zip"'})


def _safe_write_json(path: str, data):
    try:
        storage.write_json(path, data)
    except Exception as e:
        raise HTTPException(500, f"Schreiben fehlgeschlagen: {e}")


def _export_devices(db) -> tuple:
    """(Geräte, Einstellungen je Gerät, Zugangsdaten) — alles über den NAMEN
    zugeordnet, auf einer frischen Datenbank haben die Geräte andere IDs.

    Die Zugangsdaten kommen getrennt zurück; ob sie ins Backup gehen, entscheidet
    der Aufrufer."""
    devices, settings = [], {}
    secrets = {"devices": {}, "device_settings": {}}
    for d in db.query(Device).all():
        devices.append({
            # Die alte ID: Beim Einspielen auf einer frischen Datenbank zeigt die
            # Geometrie (printers[].device_id) sonst auf fremde oder keine Geräte.
            "id":            d.id,
            "name":          d.name,
            "device_type":   d.device_type.value if d.device_type else None,
            "model":         d.model,
            "ip_address":    d.ip_address,
            "port":          d.port,
            "serial_number": d.serial_number,
            "mqtt_port":     d.mqtt_port,
            "use_tls":       d.use_tls,
        })
        if d.access_code:
            secrets["devices"][d.name] = {"access_code": d.access_code}
        public, secret = credentials.split(device_settings.get(db, d.id))
        if public:
            settings[d.name] = public
        if secret:
            secrets["device_settings"][d.name] = secret
    return devices, settings, secrets


class BackupExportIn(BaseModel):
    include_secrets: bool = False
    password: Optional[str] = None


def _build_backup(include_secrets: bool, password: Optional[str]) -> dict:
    if include_secrets and password is not None and len(password) < 8:
        raise HTTPException(400, "Backup-Passwort zu kurz (mindestens 8 Zeichen)")
    db = SessionLocal()
    try:
        devices, settings, secrets = _export_devices(db)
    finally:
        db.close()

    out = {
        "schema":          BACKUP_SCHEMA,
        "current_version": _get_current_version(),
        "exported_at":     datetime.now().isoformat(),
        "devices":         devices,
        "device_settings": settings,
    }
    if include_secrets:
        out["secrets"] = (credentials.encrypt(secrets, password) if password
                          else {"encrypted": False, **secrets})
    for path, key in _backup_files():
        data = storage.read_json(path, None)
        if data is not None:
            out[key] = data
    return out


@router.get("/backup")
async def export_backup():
    """Konfigurations-Backup als JSON — OHNE Zugangsdaten."""
    try:
        return _build_backup(False, None)
    except Exception as e:
        logger.exception("Backup-Export fehlgeschlagen")
        raise HTTPException(500, f"Backup-Export fehlgeschlagen: {e}")


@router.post("/backup")
async def export_backup_with_options(body: BackupExportIn):
    """Backup auf ausdrücklichen Wunsch MIT Zugangsdaten, mit Passwort verschlüsselt.
    POST, damit das Passwort nicht in der Adresse (und damit in Proxy-Logs) steht."""
    try:
        return await asyncio.to_thread(_build_backup, body.include_secrets, body.password or None)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Backup-Export fehlgeschlagen")
        raise HTTPException(500, f"Backup-Export fehlgeschlagen: {e}")


def _merge_secrets(backup: dict, password: Optional[str]) -> tuple:
    """Geräte und Einstellungen aus dem Backup, Zugangsdaten wieder eingesetzt.
    Liefert (devices, device_settings, Zustand der Zugangsdaten)."""
    devices = [dict(d) for d in (backup.get("devices") or []) if isinstance(d, dict)]
    settings = {k: dict(v) for k, v in (backup.get("device_settings") or {}).items()
                if isinstance(v, dict)}
    blob = backup.get("secrets")
    if not isinstance(blob, dict):
        # Backups bis v1.1.38 tragen die Zugangsdaten direkt in devices/device_settings.
        legacy = (any(d.get("access_code") for d in devices)
                  or any(credentials.split(s)[1] for s in settings.values()))
        return devices, settings, ("restored" if legacy else "none")
    if blob.get("encrypted"):
        if not password:
            return devices, settings, "skipped"
        try:
            blob = credentials.decrypt(blob, password)
        except credentials.WrongPassword:
            raise HTTPException(400, "BACKUP_PASSWORT_FALSCH")
        except ValueError as e:
            raise HTTPException(400, f"Backup-Zugangsdaten unlesbar: {e}")
    for d in devices:
        d.update((blob.get("devices") or {}).get(d.get("name"), {}))
    for name, secret in (blob.get("device_settings") or {}).items():
        settings.setdefault(name, {}).update(secret)
    return devices, settings, "restored"


def _remap_geometry(geometry: dict, devices: list, name_to_id: dict) -> tuple:
    """printers[].device_id der eingespielten Geometrie auf die NEUEN Geräte-IDs
    umschreiben: über die alte ID aus dem Backup, sonst über den Namen des Blocks.
    → (Geometrie, Namen der Blöcke ohne Zuordnung)."""
    old_to_name = {d.get("id"): d.get("name") for d in devices or [] if d.get("id") is not None}
    g = dict(geometry)
    unmapped = []
    printers = []
    for blk in g.get("printers") or []:
        if not isinstance(blk, dict):
            printers.append(blk)
            continue
        blk = dict(blk)
        name = old_to_name.get(blk.get("device_id")) or blk.get("name")
        new_id = name_to_id.get(name)
        if blk.get("device_id") is not None or name:
            if new_id is None:
                unmapped.append(blk.get("name") or str(blk.get("device_id")))
            blk["device_id"] = new_id
        printers.append(blk)
    if "printers" in g:
        g["printers"] = printers
    return g, unmapped


def _restore_devices(db, devices: list, settings: dict, name_to_id_out: dict = None,
                     dropped_out: dict = None) -> int:
    """Geräte über den Namen anlegen/aktualisieren, dann ihre Einstellungen unter der
    (evtl. neuen) ID ablegen. Zugangsdaten, die das Backup nicht mitbringt, bleiben
    wie sie sind — ein Backup ohne Zugangsdaten darf keine löschen."""
    from app.services import printer_models
    from app.routers import control
    # Ein laufender Notaus bleibt stehen. Bis v1.1.42 gab das Einspielen alle Geräte
    # frei, ohne Klipper-Neustart und ohne Rückfrage: Der Arm war danach „frei",
    # obwohl niemand „Betrieb fortsetzen" gedrückt hatte.
    gesperrt = control.notaus_aktiv(db)
    n = 0
    name_to_id = {}
    for d in devices or []:
        name = (d.get("name") or "").strip()
        if not name:
            continue
        try:
            dtype = PrinterType(d.get("device_type")) if d.get("device_type") else None
        except ValueError:
            dtype = None
        row = db.query(Device).filter(Device.name == name).first()
        if not row:
            row = Device(id=device_settings.next_device_id(db), name=name)
            # Neue Geräte übernehmen den Zustand der Anlage: frei, außer ein Notaus
            # steht an. Ein Backup aus einem Notaus-Zustand (ältere Backups enthalten
            # `is_active`) sperrt so keine frische Anlage.
            row.is_active = not gesperrt
            db.add(row)
        row.device_type    = dtype
        row.model          = printer_models.normalize(d.get("model")) or             printer_models.from_serial(d.get("serial_number")) or None
        if d.get("access_code"):
            row.access_code = d["access_code"]
        elif row.id is not None and credentials.dropped_on_change(
                {"access_code": row.access_code, "ip_address": row.ip_address},
                {"ip_address": d.get("ip_address")}, set()):
            row.access_code = None
            if dropped_out is not None:
                dropped_out.setdefault(name, []).append("access_code")
        row.ip_address     = d.get("ip_address")
        row.port           = d.get("port")
        row.serial_number  = d.get("serial_number")
        row.mqtt_port      = d.get("mqtt_port", 8883)
        row.use_tls        = d.get("use_tls", True)
        # Vorhandene Geräte behalten ihr is_active (das Backup entscheidet das nie).
        db.flush()  # assign id
        name_to_id[name] = row.id
        n += 1
    db.commit()

    for name, s in (settings or {}).items():
        did = name_to_id.get(name)
        if did and isinstance(s, dict):
            old = device_settings.get(db, did)
            _, kept = credentials.split(old)
            new = {**kept, **s}
            for secret in credentials.dropped_on_change(old, new, set(s)):
                new.pop(secret, None)
                if dropped_out is not None:
                    dropped_out.setdefault(name, []).append(secret)
            device_settings.put(db, did, new)
    if name_to_id_out is not None:
        name_to_id_out.update(name_to_id)
    return n


class _Wartung:
    """Während Update bzw. Einspielen: Start, Stresstest und Handfahrten sperren.
    Bis v1.1.64 lag zwischen der Stillstand-Prüfung und dem eigentlichen Schreiben
    bzw. Neustart ein langes await (Image ziehen, Installer laden, Entschlüsseln) —
    in dem Fenster ließ sich die Farm starten."""

    def __init__(self, what: str, keep_on_success: bool = False):
        self.what, self.keep = what, keep_on_success

    def __enter__(self):
        from app.routers import autofarm
        _assert_standstill()
        autofarm.set_maintenance(self.what)
        return self

    def __exit__(self, exc_type, exc, tb):
        from app.routers import autofarm
        if exc_type is not None or not self.keep:
            autofarm.clear_maintenance()
        return False


def _assert_standstill() -> None:
    """Einspielen und Update nur, wenn sich nichts bewegt — auch nicht pausiert (dort
    kann der Arm noch im Bauraum stehen). Bis v1.1.60 ging beides mitten im Lauf:
    Die Farm fuhr danach mit halb ersetzten Sequenzen oder wurde vom Update abgewürgt."""
    from app.routers import autofarm
    owner = autofarm.motion_owner(include_paused=True)
    if owner:
        raise HTTPException(409, owner)


def _int_like(v) -> bool:
    if v is None:
        return True
    try:
        int(str(v).strip())
        return True
    except ValueError:
        return False


def _prepare_section(key: str, value):
    """Einen Backup-Abschnitt prüfen und in die Form bringen, die geschrieben wird.
    → (Inhalt, Hinweis). Schreibt NICHTS: Erst wenn alle Abschnitte taugen, wird
    geschrieben (bis v1.1.60 landete jeder Abschnitt wörtlich in seiner Datei — eine
    Liste statt eines Regals machte die Datei kaputt, und die Farm stand)."""
    from app.services import geometry_check, geometry_store, ottoeject_motion, sequence_steps
    rules = _data_file_rules()
    expect = rules.get(key, (None,))[0]
    if expect is not None and not isinstance(value, expect):
        raise HTTPException(400, f"Backup-Abschnitt „{key}“ hat die falsche Form "
                                 f"(erwartet {expect.__name__})")
    if expect is None and not isinstance(value, (dict, list)):
        raise HTTPException(400, f"Backup-Abschnitt „{key}“ hat die falsche Form")
    if key == "sequences":
        for name in ("seq_new", "seq_next"):
            if not isinstance(value.get(name, []), list):
                raise HTTPException(400, f"Backup-Abschnitt „sequences.{name}“ ist keine Liste")
        # Schema-Nummer aus dem Backup, NICHT neu stempeln (#98): Ein altes Backup zeigt
        # der Editor dann als „ältere Version — prüfen und übernehmen", und der Start
        # verweigert es bis dahin.
        out, dropped = {"schema_version": value.get("schema_version")}, 0
        for name in ("seq_new", "seq_next"):
            steps = [sequence_steps.sanitize_step(s) for s in value.get(name) or []]
            dropped += sum(1 for s in steps if s is None)
            out[name] = [s for s in steps if s is not None]
        return out, (f"{dropped} unbekannte Schritt(e) nicht übernommen" if dropped else None)
    if key == "geometry":
        merged = ottoeject_motion.merge_defaults(value)
        bad = geometry_store.invalid_positions(merged)
        if bad:
            raise HTTPException(400, "Backup-Geometrie: Positionsfelder ohne Zahl: " + ", ".join(bad[:8]))
        errs = geometry_check.check_geometry(merged).get("errors") or []
        return value, (f"Geometrie: {len(errs)} Fehler laut Prüfung — im Drucker-Tab ansehen"
                       if errs else None)
    if key == "rack_slots":
        _dry_run_rack(value)
    return value, None


def _dry_run_rack(value: dict) -> None:
    """Regal-Einstellungen aus dem Backup auf einer KOPIE anwenden, bevor irgendetwas
    geschrieben wird: Würde ein belegtes Fach wegfallen, kommt die 409 jetzt, und
    nicht erst, nachdem Geräte und Sequenzen schon ersetzt sind (bis v1.1.64)."""
    import copy
    from app.services import profiles, rack_store
    current = copy.deepcopy(rack_store.load()) if rack_store.exists() else rack_store.default_data()
    body = {k: value[k] for k in profiles._RACK_CONFIG_KEYS if value.get(k) is not None}
    try:
        rack_store.apply_config(current, body)
    except rack_store.RackShrinkConflict as e:
        raise HTTPException(409, f"Regal nicht übernehmbar: {e}")
    except (TypeError, ValueError) as e:
        raise HTTPException(400, f"Backup-Regal ungültig: {e}")


def _restore_rack_config(value: dict):
    """Vom Regal nur die Einstellungen (Fächer, Höhen, Magazin-Soll). Belegung und
    Magazin-Bestand bleiben, wie sie sind: Bis v1.1.60 ersetzte ein Backup die echte
    Belegung, und die Farm legte eine Platte auf ein belegtes Fach."""
    from app.services import profiles, rack_store
    neu = not rack_store.exists()
    rack_store.ensure_file()
    res = profiles._apply_rack_config(value)
    if isinstance(res, str):
        raise HTTPException(409, f"Regal nicht übernommen: {res}")
    return ("Regal neu angelegt: alle Fächer frei, Magazin-Bestand 0 — bitte prüfen"
            if neu else None)


@router.post("/backup/restore")
async def import_backup(body: dict):
    """Stellt die komplette Konfiguration aus einem Backup wieder her.

    Body: das Backup selbst, oder {"backup": …, "password": …} für eines mit
    verschlüsselten Zugangsdaten. Fehlt das Passwort, wird alles außer den
    Zugangsdaten eingespielt (secrets = "skipped")."""
    if not isinstance(body, dict):
        raise HTTPException(400, "Ungültiges Backup")
    with _Wartung("Backup wird eingespielt"):
        return await _import_backup(body)


async def _import_backup(body: dict):
    password = None
    backup = body
    if isinstance(body.get("backup"), dict) and "schema" not in body:
        backup, password = body["backup"], body.get("password")
    schema = backup.get("schema")
    # Ohne „schema" nur das Altformat (hat immer „exported_at"); alles andere ist kein
    # Printloom-Backup. Bis v1.1.60 nahm der Endpunkt jedes JSON-Objekt an.
    if (schema is None and not backup.get("exported_at")) or \
            (schema is not None and not str(schema).startswith("printloom-backup/")):
        raise HTTPException(400, "KEIN_PRINTLOOM_BACKUP")

    # Zuerst entschlüsseln: ein falsches Passwort soll NICHTS halb einspielen. Im
    # Thread: scrypt braucht Rechenzeit und hielte sonst alle Anfragen an.
    devices, settings, secrets_state = await asyncio.to_thread(_merge_secrets, backup, password)
    for d in devices or []:
        if not isinstance(d, dict) or not all(_int_like(d.get(k)) for k in ("port", "mqtt_port")):
            raise HTTPException(400, f"Backup-Gerät „{(d or {}).get('name', '?')}“: Port ist keine Zahl")
    # Alle Abschnitte prüfen, BEVOR etwas geschrieben wird.
    prepared, notes = {}, []
    for path, key in _backup_files():
        if key in backup and backup[key] not in (None, {}, []):
            data, note = _prepare_section(key, backup[key])
            prepared[key] = (path, data)
            if note:
                notes.append(note)
    restored = []
    unmapped = []
    dropped: dict = {}

    if devices:
        db = SessionLocal()
        try:
            name_to_id: dict = {}
            count = _restore_devices(db, devices, settings, name_to_id, dropped)
            restored.append(f"devices ({count})")
            # Geometrie an die (evtl. neuen) Geräte-IDs anpassen, bevor sie geschrieben
            # wird. Bis v1.1.50 zeigten Drucker-Blöcke nach dem Einspielen auf einer
            # frischen Datenbank auf falsche Geräte (oder auf keins).
            if "geometry" in prepared:
                for d in db.query(Device).all():
                    name_to_id.setdefault(d.name, d.id)
                gpath, gdata = prepared["geometry"]
                gdata, unmapped = _remap_geometry(gdata, devices, name_to_id)
                prepared["geometry"] = (gpath, gdata)
        finally:
            db.close()

    for key, (path, data) in prepared.items():
        if key == "rack_slots":
            note = _restore_rack_config(data)
            if note:
                notes.append(note)
        else:
            _safe_write_json(path, data)
        restored.append(key)

    return {"success": True, "restored": restored, "secrets": secrets_state,
            "unmapped_printers": unmapped, "notes": notes, "secrets_dropped": dropped}


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
            loop = asyncio.get_running_loop()
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


# ─── Dashboard-Layouts (frei konfigurierbar, global) ─────────────────────────
# Zwei getrennte Ansichten, jede in ihrer eigenen Datei:
#   view=farm (Standard) → db/dashboard_layout.json       Auto-Farm-Dashboard
#   view=home            → db/dashboard_layout_home.json  Startseite
# Getrennt, weil die Ansichten verschiedene Panels haben — ein gemeinsames Layout
# würde jede Seite mit den Positionen der anderen überschreiben.
#
# Inhalt: { "layout": [ {i,x,y,w,h,…} ], "layouts": {bp: [...]}, "hidden": [ids] }.
# "layout" ist das feste Raster der Farm-Ansicht, "layouts" die Fassungen JE
# Bildschirmbreite der Startseite. Global (gilt für alle Geräte), Teil des Backups.

_DASHBOARD_VIEWS = {
    "farm": "dashboard_layout.json",
    "home": "dashboard_layout_home.json",
}


def _dashboard_file(view: str = "farm") -> str:
    name = _DASHBOARD_VIEWS.get(str(view or "farm").strip().lower())
    if not name:
        raise HTTPException(400, "Unbekannte Dashboard-Ansicht")
    return str(_db_dir() / name)


@router.get("/dashboard-layout")
async def get_dashboard_layout(view: str = "farm"):
    """Gespeichertes Dashboard-Layout (leeres Objekt = Standard verwenden)."""
    data = storage.read_json(_dashboard_file(view), {})
    return data if isinstance(data, dict) else {}


def _layout_items(items) -> list:
    """Layout-Einträge: nur dicts mit Text-„i" und Zahlen für x/y/w/h."""
    if not isinstance(items, list):
        return []
    out = []
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("i"), str):
            continue
        if all(isinstance(it.get(k), (int, float)) and not isinstance(it.get(k), bool)
               for k in ("x", "y", "w", "h")):
            out.append({k: it[k] for k in ("i", "x", "y", "w", "h") if k in it})
    return out


@router.put("/dashboard-layout")
async def save_dashboard_layout(body: dict, view: str = "farm"):
    """Layout (Positionen/Größen) + ausgeblendete Panels speichern."""
    if not isinstance(body, dict):
        raise HTTPException(400, "Ungültiges Layout")
    # Nur verwertbare Formen speichern; Ungültiges fällt still weg. Bis v1.1.66 landete
    # jeder Inhalt in der Datei, und ein kaputter Eintrag (Zahl als Text, ein String
    # statt einer Liste) brachte beim nächsten Laden das Raster durcheinander.
    grid_v = body.get("grid_v")
    payload = {
        "layout": _layout_items(body.get("layout")),
        # Fassungen je Bildschirmbreite (Startseite) — nur ein dict von Listen.
        "layouts": {k: _layout_items(v) for k, v in body.get("layouts").items() if isinstance(k, str)}
                   if isinstance(body.get("layouts"), dict) else {},
        "hidden": [h for h in body.get("hidden") if isinstance(h, str)]
                  if isinstance(body.get("hidden"), list) else [],
        # Raster-Version (für die Migration des feineren Rasters)
        "grid_v": grid_v if isinstance(grid_v, int) and not isinstance(grid_v, bool) and grid_v > 0 else 1,
    }
    storage.write_json(_dashboard_file(view), payload)
    return {"success": True}
