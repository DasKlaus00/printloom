"""Manuelles Update der nativen Desktop-App (Windows/macOS).

Ersatz für Watchtower/Docker-Socket in der nativen Verpackung: prüft die
GitHub-Releases von ``GITHUB_REPO`` gegen die lokal installierte ``version.txt``
und lädt auf Wunsch das passende Installer-Asset herunter und startet es.

Kanäle:
* ``latest`` – neuestes *nicht*-Prerelease.
* ``beta``   – neuestes Prerelease (bzw. Tag/Release mit „beta").

Asset-Erkennung: Windows → ``*.exe`` (Inno-Setup-Installer), macOS → ``*.dmg``.
Kein Auto-Update: check() liefert nur Infos, download_and_launch() startet den
Installer erst auf ausdrücklichen Nutzer-Klick.
"""
from __future__ import annotations

import logging
import hashlib
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger(__name__)

GITHUB_REPO = os.getenv("GITHUB_REPO", "DasKlaus00/printloom")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")


def _ver_tuple(v: str) -> tuple:
    return tuple(int(x) for x in v.strip().lstrip("v").split(".") if x.isdigit())


def _is_newer(a: str, b: str) -> bool:
    try:
        return _ver_tuple(a) > _ver_tuple(b)
    except Exception:
        return False


def _same_line(candidate: str, current: str) -> bool:
    """Nur innerhalb derselben Major-Linie vergleichen (Legacy 4.x nicht anbieten)."""
    try:
        if current in ("", "unknown"):
            return True
        return _ver_tuple(candidate)[0] == _ver_tuple(current)[0]
    except Exception:
        return False


def _asset_suffix() -> str:
    return ".dmg" if sys.platform == "darwin" else ".exe"


def _pick_asset(assets: list) -> Optional[dict]:
    """Passendes Installer-Asset wählen. Bei mehreren .exe (Installer UND Portable)
    den INSTALLER bevorzugen — der aktualisiert die installierte App in-place."""
    suffix = _asset_suffix()
    cands = [a for a in (assets or []) if (a.get("name") or "").lower().endswith(suffix)]
    if not cands:
        return None
    for a in cands:
        n = (a.get("name") or "").lower()
        if "setup" in n or "install" in n:
            return a
    return cands[0]


async def check(current: str, channel: str = "latest") -> dict:
    """GitHub-Releases prüfen; Info-Dict zurückgeben (kein Download)."""
    result = {
        "current": current, "channel": channel, "latest": None,
        "update_available": False, "download_url": None, "asset_name": None,
        "notes": None, "runtime": "native",
        "token_configured": bool(GITHUB_TOKEN), "error": None,
    }
    owner, _, repo = GITHUB_REPO.partition("/")
    if not owner or not repo:
        result["error"] = "GITHUB_REPO nicht gesetzt"
        return result

    want_pre = (channel or "latest").lower() == "beta"
    url = f"https://api.github.com/repos/{owner}/{repo}/releases"
    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(url, headers=headers, params={"per_page": 30})
            if r.status_code in (401, 403) and GITHUB_TOKEN:
                headers.pop("Authorization", None)
                r = await client.get(url, headers=headers, params={"per_page": 30})
        if r.status_code != 200:
            result["error"] = f"GitHub HTTP {r.status_code}"
            return result

        best = None  # (version, release)
        for rel in r.json():
            if rel.get("draft"):
                continue
            is_pre = bool(rel.get("prerelease")) or "beta" in (rel.get("tag_name") or "").lower()
            if want_pre != is_pre:
                continue
            tag = (rel.get("tag_name") or "").lstrip("v")
            ver = tag.split("-")[0]  # „1.0.142-beta" → „1.0.142"
            if not _ver_tuple(ver) or not _same_line(ver, current):
                continue
            if best is None or _is_newer(ver, best[0]):
                best = (ver, rel)

        if not best:
            result["error"] = "Kein passendes Release gefunden"
            return result

        ver, rel = best
        asset = _pick_asset(rel.get("assets"))
        result["latest"] = ver
        result["update_available"] = _is_newer(ver, current)
        result["notes"] = (rel.get("body") or "")[:2000]
        if asset:
            result["download_url"] = asset.get("browser_download_url")
            result["asset_name"] = asset.get("name")
            result["sha256"] = await _sha256_for(rel.get("assets"), asset)
        elif result["update_available"]:
            result["error"] = f"Release {ver} hat kein {_asset_suffix()}-Installer-Asset"
    except Exception as e:
        result["error"] = f"GitHub nicht erreichbar: {str(e)[:120]}"
    return result


# So heißt der Inno-Installer (desktop/installer.iss, OutputBaseFilename), auf dem
# Mac das Disk-Image. Eine Quelle für beide Prüfungen unten.
_TAG_RE = re.compile(r"v?\d+\.\d+\.\d+(-[\w.]+)?")
_ASSET_RE = {".exe": re.compile(r"Printloom-Setup-\d+\.\d+\.\d+\.exe"),
             ".dmg": re.compile(r"Printloom-\d+\.\d+\.\d+\.dmg")}


_HEX64 = re.compile(r"[0-9a-f]{64}")


async def _sha256_for(assets, asset) -> Optional[str]:
    """Erwartete SHA-256 des Installers (seit v1.1.75), oder None.

    Zuerst das Feld `digest`, das GitHub selbst für jedes Asset berechnet. Fehlt es,
    die Datei `<installer>.sha256` aus demselben Release (build_windows.ps1 schreibt
    sie). Gelesen wird sie nur unter der Adresse des Installers + '.sha256' — also
    aus dem eigenen Release, geprüft wie der Installer selbst."""
    d = str(asset.get("digest") or "").lower()
    if d.startswith("sha256:") and _HEX64.fullmatch(d[7:]):
        return d[7:]
    name, url = asset.get("name") or "", asset.get("browser_download_url") or ""
    side = next((a for a in assets or [] if a.get("name") == f"{name}.sha256"), None)
    if not side or side.get("browser_download_url") != f"{url}.sha256":
        return None
    try:
        _check_download(url, name)   # Adresse des Installers muss stimmen
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            r = await client.get(f"{url}.sha256")
        if r.status_code != 200:
            return None
        first = (r.text[:200].split() or [""])[0].lower()
        return first if _HEX64.fullmatch(first) else None
    except (ValueError, httpx.HTTPError) as e:
        logger.warning("Checksum for %s not readable: %s", name, e)
        return None


def _check_download(download_url: str, asset_name: Optional[str]) -> str:
    """Nur ein Installer aus einem Release des eigenen Repos. Gibt den Dateinamen zurück.

    Bis v1.1.41 lud die App jede URL und startete jede Datei (os.startfile), dazu
    mit dem GITHUB_TOKEN im Kopf an jeden Host, und ein Name wie ../../x.exe
    landete außerhalb des Temp-Ordners."""
    if not download_url:
        raise ValueError("download_url fehlt")
    parts = urlsplit(download_url)
    # Genau /<owner>/<repo>/releases/download/<tag>/<datei>: Ein bloßer Präfix-Vergleich
    # ließe /…/releases/download/../../anderes/repo/… durch.
    segs = parts.path.split("/")
    ok = (parts.scheme == "https" and parts.hostname == "github.com" and parts.port is None
          and not parts.query and not parts.fragment and len(segs) == 7
          and "/".join(segs[1:3]) == GITHUB_REPO and segs[3:5] == ["releases", "download"]
          and _TAG_RE.fullmatch(segs[5]))
    if not ok:
        raise ValueError("nur Installer aus den Releases von " + GITHUB_REPO)
    name = segs[6]
    if asset_name is not None and asset_name != name:
        raise ValueError(f"Dateiname {asset_name!r} passt nicht zur Adresse")
    pattern = _ASSET_RE.get(_asset_suffix())
    if not pattern or not pattern.fullmatch(name):
        raise ValueError(f"unerwarteter Dateiname {name!r}")
    return name


def download_and_launch(download_url: str, asset_name: Optional[str] = None,
                        sha256: Optional[str] = None) -> dict:
    """Installer herunterladen und starten. Der Installer schließt die laufende
    App selbst (Inno „CloseApplications") und ersetzt die Dateien.

    Mit `sha256` (aus check()) startet nur ein Download mit genau dieser Prüfsumme;
    ein abgebrochener oder veränderter Download bleibt liegen statt zu laufen."""
    name = _check_download(download_url, asset_name)
    # Eigener, frisch angelegter Ordner: Eine schon liegende Datei gleichen Namens im
    # gemeinsamen Temp-Ordner kann so nicht untergeschoben werden.
    target = Path(tempfile.mkdtemp(prefix="printloom-update-")) / name
    # Ohne Authorization-Kopf: Die Release-Dateien sind öffentlich, und GitHub leitet
    # auf einen anderen Host weiter. Das Token geht nur an api.github.com (check()).
    digest = hashlib.sha256()
    with httpx.stream("GET", download_url, follow_redirects=True, timeout=None) as r:
        r.raise_for_status()
        with open(target, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=1 << 16):
                digest.update(chunk)
                f.write(chunk)
    got = digest.hexdigest()
    if sha256:
        if got != sha256.lower():
            target.unlink(missing_ok=True)
            raise ValueError(f"Prüfsumme stimmt nicht ({got[:12]}… statt {sha256[:12]}…) — "
                             "Installer nicht gestartet")
    else:
        # Übergang: ältere Releases haben keine Prüfsumme. Starten, aber vermerken.
        logger.warning("Release without checksum — installer %s unverified (sha256 %s)", name, got)
    logger.info("Installer downloaded: %s", target)
    _launch_installer(target)
    return {"success": True, "installer": str(target)}


def _launch_installer(path: Path) -> None:
    if sys.platform == "win32":
        # Silent-freundlich starten; Inno zeigt seinen eigenen Fortschritt.
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        import subprocess
        subprocess.Popen(["open", str(path)])
    else:
        import subprocess
        subprocess.Popen(["xdg-open", str(path)])
