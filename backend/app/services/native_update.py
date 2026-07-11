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
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

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
        elif result["update_available"]:
            result["error"] = f"Release {ver} hat kein {_asset_suffix()}-Installer-Asset"
    except Exception as e:
        result["error"] = f"GitHub nicht erreichbar: {str(e)[:120]}"
    return result


def download_and_launch(download_url: str, asset_name: Optional[str] = None) -> dict:
    """Installer herunterladen und starten. Der Installer schließt die laufende
    App selbst (Inno „CloseApplications") und ersetzt die Dateien."""
    if not download_url:
        raise ValueError("download_url fehlt")
    name = asset_name or download_url.rsplit("/", 1)[-1] or ("Printloom-Setup" + _asset_suffix())
    target = Path(tempfile.gettempdir()) / name
    headers = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    with httpx.stream("GET", download_url, headers=headers, follow_redirects=True, timeout=None) as r:
        r.raise_for_status()
        with open(target, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=1 << 16):
                f.write(chunk)
    logger.info("Installer geladen: %s", target)
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
