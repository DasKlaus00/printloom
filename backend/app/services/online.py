"""Online-Dienste: OPT-IN-Verbindungen zu Servern außerhalb des eigenen Netzwerks.

GRUNDREGEL (vom Nutzer festgelegt): Printloom verbindet sich NIE ungefragt nach
außen. Jede Funktion hier ist standardmäßig AUS und braucht zusätzlich eine
einmalige, ausdrückliche Bestätigung (`consented`). Ohne beides passiert kein
einziger externer Request — die App bleibt voll funktionsfähig.

Abgedeckte Funktionen (je einzeln schaltbar):
  update_check  Update-Prüfung im Internet (GitHub/ghcr) — war früher ungefragt an
  notices       Bekannte Probleme & Hinweise zur laufenden Version
  library       Sprachpakete + Sequenz-/Profil-Bibliothek

Sicherheit/Datenschutz:
  • Nur LESENDE GET-Abfragen. Es werden keine Drucker-, Datei- oder Zugangsdaten
    gesendet — die Abfragen enthalten nur Pfad + Versionsnummer.
  • Der Abruf läuft über das BACKEND (nicht den Browser): same-origin für die UI,
    ein etwaiges Token bliebe serverseitig.
  • Alles wird lokal gecacht (db/online_cache.json). Kein Netz → letzter Stand,
    keine Fehlerwand.
  • Inhalte werden gegen ein Schema geprüft und NIE automatisch angewendet:
    Sequenzen/Profile bewegen Hardware, deshalb immer erst Vorschau, dann
    bewusstes Übernehmen durch den Nutzer.
"""
import time
import logging
from typing import Optional, Tuple

import httpx

from app.services import storage
from app.paths import DB_DIR

logger = logging.getLogger(__name__)

DEFAULT_SERVER = "https://printloom.alexsz.de"

# Alle Schalter standardmäßig AUS. `consented` = der Warnhinweis wurde bestätigt.
ONLINE_DEFAULTS = {
    "consented":    False,
    "update_check": False,
    "notices":      False,
    "library":      False,
    "server_url":   DEFAULT_SERVER,
}

FEATURES = ("update_check", "notices", "library")

_CACHE_TTL = 6 * 3600.0     # 6 h — Hinweise/Kataloge ändern sich selten
_TIMEOUT = 8.0
_MAX_BYTES = 2_000_000      # Schutz gegen absurd große Antworten


def _db_dir():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    return DB_DIR


def _settings_file() -> str:
    return str(_db_dir() / "online_settings.json")


def _cache_file() -> str:
    return str(_db_dir() / "online_cache.json")


# ── Einstellungen ────────────────────────────────────────────────────────────
def read_settings() -> dict:
    cfg = dict(ONLINE_DEFAULTS)
    stored = storage.read_json(_settings_file(), {}) or {}
    if isinstance(stored, dict):
        for k in ONLINE_DEFAULTS:
            if k in stored:
                cfg[k] = stored[k]
    for k in ("consented", *FEATURES):
        cfg[k] = bool(cfg.get(k))
    cfg["server_url"] = (str(cfg.get("server_url") or DEFAULT_SERVER)).strip().rstrip("/")
    return cfg


def write_settings(patch: dict) -> dict:
    """Einstellungen ändern. Wird die Zustimmung zurückgezogen (`consented`=False),
    gehen ALLE Funktionen mit aus — sonst bliebe ein Schalter aktiv, obwohl der
    Nutzer die Verbindung abgelehnt hat."""
    cfg = read_settings()
    if isinstance(patch, dict):
        for k in ("consented", *FEATURES):
            if k in patch:
                cfg[k] = bool(patch[k])
        if patch.get("server_url"):
            cfg["server_url"] = str(patch["server_url"]).strip().rstrip("/")
    if not cfg["consented"]:
        for k in FEATURES:
            cfg[k] = False
    storage.write_json(_settings_file(), cfg)
    return cfg


def enabled(feature: str) -> bool:
    """True nur wenn zugestimmt UND die Funktion eingeschaltet ist."""
    cfg = read_settings()
    return bool(cfg.get("consented")) and bool(cfg.get(feature))


def any_enabled() -> bool:
    cfg = read_settings()
    return bool(cfg.get("consented")) and any(cfg.get(f) for f in FEATURES)


# ── Cache ────────────────────────────────────────────────────────────────────
def _read_cache() -> dict:
    c = storage.read_json(_cache_file(), {}) or {}
    return c if isinstance(c, dict) else {}


def cached(key: str) -> Tuple[Optional[dict], Optional[float]]:
    """(data, fetched_at) aus dem Cache — auch wenn abgelaufen (Offline-Fallback)."""
    entry = _read_cache().get(key)
    if isinstance(entry, dict) and "data" in entry:
        return entry.get("data"), entry.get("fetched_at")
    return None, None


def _store_cache(key: str, data) -> float:
    cache = _read_cache()
    ts = time.time()
    cache[key] = {"data": data, "fetched_at": ts}
    storage.write_json(_cache_file(), cache)
    return ts


def clear_cache() -> None:
    storage.write_json(_cache_file(), {})


# ── Abruf ────────────────────────────────────────────────────────────────────
async def fetch(path: str, feature: str, *, force: bool = False,
                params: dict = None) -> dict:
    """Eine JSON-Ressource holen. Ergebnis:
        {ok, data, fetched_at, from_cache, disabled, error}

    Ist die Funktion nicht freigeschaltet, wird NICHTS abgerufen (disabled=True) —
    dann kommt höchstens ein alter Cache-Stand zurück. Netz-/Serverfehler sind nie
    fatal: es gibt den letzten Cache-Stand plus `error` zur Anzeige.
    """
    key = path.strip("/")
    data, ts = cached(key)
    if not enabled(feature):
        return {"ok": data is not None, "data": data, "fetched_at": ts,
                "from_cache": True, "disabled": True, "error": None}

    fresh = ts is not None and (time.time() - ts) < _CACHE_TTL
    if fresh and not force:
        return {"ok": True, "data": data, "fetched_at": ts,
                "from_cache": True, "disabled": False, "error": None}

    cfg = read_settings()
    url = f"{cfg['server_url']}/{key}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            r = await client.get(url, params=params or None,
                                 headers={"Accept": "application/json"})
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}")
        if len(r.content) > _MAX_BYTES:
            raise RuntimeError("Antwort zu groß")
        payload = r.json()
    except Exception as e:
        logger.info(f"Online-Abruf {url} fehlgeschlagen: {e}")
        return {"ok": data is not None, "data": data, "fetched_at": ts,
                "from_cache": True, "disabled": False, "error": str(e)}

    new_ts = _store_cache(key, payload)
    return {"ok": True, "data": payload, "fetched_at": new_ts,
            "from_cache": False, "disabled": False, "error": None}


# ── Schema-Prüfung ───────────────────────────────────────────────────────────
# Bewusst streng und klein: nur was die UI wirklich braucht wird durchgelassen,
# alles andere fällt weg. So kann eine kaputte/fremde Datei nichts anrichten.

_SEVERITIES = ("info", "warning", "critical")


def _s(v, limit: int) -> str:
    return str(v)[:limit] if v is not None else ""


def clean_notices(payload, current_version: str = "") -> list:
    """Hinweise/bekannte Probleme normalisieren:
    [{id, severity, title, text, versions[], url}] — unbrauchbare Einträge fliegen raus.
    `versions` leer = gilt für alle Versionen."""
    items = payload.get("notices") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return []
    out = []
    for raw in items[:100]:
        if not isinstance(raw, dict):
            continue
        title = _s(raw.get("title"), 200).strip()
        if not title:
            continue
        sev = str(raw.get("severity", "info")).lower()
        versions = raw.get("versions")
        versions = [_s(v, 20) for v in versions][:50] if isinstance(versions, list) else []
        url = _s(raw.get("url"), 500).strip()
        if url and not url.startswith(("http://", "https://")):
            url = ""
        out.append({
            "id":       _s(raw.get("id"), 80) or title[:80],
            "severity": sev if sev in _SEVERITIES else "info",
            "title":    title,
            "text":     _s(raw.get("text"), 2000).strip(),
            "versions": versions,
            "url":      url,
        })
    if current_version:
        out = [n for n in out if not n["versions"] or current_version in n["versions"]]
    return out


_LIB_KINDS = ("language", "profile", "sequence")


def clean_library(payload) -> list:
    """Bibliotheks-Index normalisieren:
    [{id, kind, name, description, author, version, path}]"""
    items = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return []
    out = []
    for raw in items[:500]:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("kind", "")).lower()
        item_id = _s(raw.get("id"), 120).strip()
        name = _s(raw.get("name"), 200).strip()
        path = _s(raw.get("path"), 300).strip().lstrip("/")
        if kind not in _LIB_KINDS or not item_id or not name or not path:
            continue
        # Pfad-Traversal / absolute URLs im Index unterbinden.
        if ".." in path or "://" in path:
            continue
        out.append({
            "id": item_id, "kind": kind, "name": name,
            "description": _s(raw.get("description"), 1000).strip(),
            "author": _s(raw.get("author"), 120).strip(),
            "version": _s(raw.get("version"), 40).strip(),
            "path": path,
        })
    return out


def clean_library_item(kind: str, payload) -> dict:
    """Inhalt eines Bibliotheks-Eintrags prüfen. Wirft ValueError, wenn er nicht
    zur Art passt — der Aufrufer zeigt das als Fehler, statt Müll zu übernehmen."""
    if not isinstance(payload, dict):
        raise ValueError("Inhalt ist kein JSON-Objekt")

    if kind == "language":
        code = _s(payload.get("code"), 10).strip()
        strings = payload.get("strings")
        translations = payload.get("translations")
        has_s = isinstance(strings, dict) and strings
        has_t = isinstance(translations, dict) and translations
        if not code or not (has_s or has_t):
            raise ValueError("Sprachpaket braucht code und strings/translations")
        return {"code": code, "name": _s(payload.get("name"), 80) or code,
                "strings": strings if has_s else None,
                "translations": translations if has_t else None}

    if kind == "profile":
        # Profile werden vom bestehenden /profiles/import geprüft — hier nur
        # Grobstruktur, damit offensichtlicher Müll früh auffällt.
        if not any(k in payload for k in ("geometry", "rack_config", "name", "printer")):
            raise ValueError("Profil enthält keine bekannten Felder")
        return payload

    if kind == "sequence":
        steps = payload.get("steps")
        if not isinstance(steps, list) or not steps:
            raise ValueError("Sequenz braucht eine nicht-leere steps-Liste")
        if not all(isinstance(s, dict) and s.get("type") for s in steps):
            raise ValueError("Jeder Sequenz-Schritt braucht ein type-Feld")
        return {"name": _s(payload.get("name"), 120) or "Importierte Sequenz",
                "description": _s(payload.get("description"), 500),
                "steps": steps}

    raise ValueError(f"Unbekannte Art: {kind!r}")
