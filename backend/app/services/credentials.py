"""Zugangsdaten erkennen, abtrennen und für das Backup verschlüsseln.

Eine Quelle dafür, was als Geheimnis gilt — Backup und Diagnose-Paket fragen beide
hier nach. Erkannt wird am SCHLÜSSELNAMEN (nicht an einer Liste bekannter Felder),
damit auch künftige Felder wie `xyz_token` nicht durchrutschen; dazu URLs mit
`benutzer:passwort@` darin (Kamera-Stream, Steckdose).

Bis v1.1.38 stand jedes Geheimnis im Klartext im Backup, auch wenn der Nutzer nur
seine Regal-Einstellungen sichern wollte.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import os
import re

SECRET_KEY_HINTS = ("access_code", "password", "passwd", "token", "secret",
                    "api_key", "apikey", "auth", "credential", "private_key")

# scheme://benutzer:passwort@host — nur MIT Passwort-Teil, ein reiner Benutzername
# (rtsp://admin@…) verrät nichts.
_URL_WITH_PASSWORD = re.compile(r"^[a-z][a-z0-9+.-]*://[^/@\s]*:[^/@\s]*@", re.IGNORECASE)

# scrypt-Kosten: 16 MiB Speicher, auf einem Pi Zero 2 W unter einer Sekunde.
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}


# Welches Geheimnis zu welcher Adresse gehört (eine Quelle für Backup und Einspielen).
# Bringt ein Backup das Geheimnis NICHT mit, ändert aber die Adresse, wird das
# vorhandene verworfen: Sonst schickte Printloom den Access-Code bzw. Token nach dem
# Einspielen eines präparierten Backups an einen fremden Rechner (bis v1.1.61).
SECRET_BINDINGS = {
    "access_code":   ("ip_address",),
    "ha_token":      ("ha_url",),
    "plug_password": ("plug_url", "plug_type"),
    "plug_token":    ("plug_url", "plug_type"),
}

# Höchstens diese scrypt-Kosten nimmt das Einspielen an: Ein Backup mit n = 2**20
# hielte den Rechner minutenlang fest (und mit p > 1 noch länger).
_SCRYPT_MAX_N = 2 ** 15


class WrongPassword(ValueError):
    pass


def dropped_on_change(old: dict, new: dict, brought) -> list:
    """Geheimnisse aus `old`, die wegfallen: nicht in `brought` (vom Backup
    mitgebracht), aber ein gebundenes Feld hat in `new` einen anderen Wert."""
    out = []
    for secret, fields in SECRET_BINDINGS.items():
        if secret in brought or not (old or {}).get(secret):
            continue
        if any((new or {}).get(f) != (old or {}).get(f) for f in fields):
            out.append(secret)
    return out


def is_secret_key(key) -> bool:
    k = str(key).lower()
    return any(h in k for h in SECRET_KEY_HINTS)


# Für scrub(): dieselben Muster, aber IRGENDWO im Text statt nur am Anfang.
_URL_CRED_ANYWHERE = re.compile(r"\b([a-z][a-z0-9+.-]*://)[^/@\s'\"]*:[^/@\s'\"]*@", re.IGNORECASE)
_PARAM = re.compile(r"(^|[?&;\s,(])([A-Za-z0-9_.-]+)=([^&\s'\",)]*)")
_BEARER = re.compile(r"(\bBearer\s+)[A-Za-z0-9._~+/=-]+", re.IGNORECASE)

# Adressen: Das NETZ bleibt erkennbar (192.168.1.x oder Docker-Netz 172.17.0.x — genau
# das braucht man bei „Drucker nicht erreichbar"), das einzelne Gerät nicht. Rechnernamen
# in URLs (oft mit Personen- oder Ortsnamen) und Zugangsdaten darin fallen ganz weg.
# Bis v1.1.34 standen die Adressen vollständig im Diagnose-Paket; bis v1.1.89 stand die
# Regel in routers/system.py.
_IPV4 = re.compile(r"\b((?:\d{1,3}\.){3})\d{1,3}\b")
_URL_HOST = re.compile(r"\b([a-z][a-z0-9+.-]*://)(?:[^@/\s]*@)?([^/\s:]+)", re.IGNORECASE)


def mask_hosts(text) -> str:
    """Letzte Stelle von IP-Adressen und Rechnernamen in URLs unkenntlich machen."""
    def host(m):
        h = m.group(2)
        return m.group(1) + (h if _IPV4.fullmatch(h) else "<host>")
    return _IPV4.sub(r"\1x", _URL_HOST.sub(host, str(text)))


def scrub(text) -> str:
    """Geheimnisse aus einem Fehler- oder Logtext entfernen (seit v1.1.73).

    `scheme://benutzer:passwort@` wird `scheme://***@`, der Wert eines geheimen
    Parameters (`password=…`, `token=…`, siehe is_secret_key) wird `***`, ein
    `Bearer …` ebenso. Bis v1.1.72 standen so Tasmota-Passwort (httpx nennt in
    raise_for_status die volle URL) und Drucker-Access-Code (ffmpeg nennt die
    RTSPS-URL) in Log und Fehlermeldung."""
    if text is None:
        return ""
    s = str(text)
    s = _URL_CRED_ANYWHERE.sub(r"\1***@", s)
    s = _PARAM.sub(lambda m: f"{m.group(1)}{m.group(2)}=***" if is_secret_key(m.group(2)) else m.group(0), s)
    return _BEARER.sub(r"\1***", s)


class ScrubFilter(logging.Filter):
    """Bereinigt jede Logzeile (samt Traceback) mit scrub() — die letzte Sicherung
    für Meldungen aus Bibliotheken, die URLs mit Zugangsdaten nennen. Die eigenen
    Meldungen bereinigen ihre Fehlertexte zusätzlich selbst."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        clean = scrub(msg)
        if clean != msg:
            record.msg, record.args = clean, None
        if record.exc_info and not record.exc_text:
            # Der Formatter nimmt exc_text, wenn es gesetzt ist — so wird auch der
            # Traceback (mit der Fehlermeldung darin) bereinigt.
            record.exc_text = scrub(logging.Formatter().formatException(record.exc_info))
        return True


def install_log_scrub(logger: logging.Logger | None = None) -> None:
    """ScrubFilter an alle Handler des (Root-)Loggers hängen; mehrfach aufrufbar.
    An den Handlern, nicht am Logger: Ein Logger-Filter gilt nur für Meldungen, die
    direkt an diesen Logger gehen, nicht für weitergereichte aus Unter-Loggern."""
    for handler in (logger or logging.getLogger()).handlers:
        if not any(isinstance(f, ScrubFilter) for f in handler.filters):
            handler.addFilter(ScrubFilter())


def is_secret(key, value) -> bool:
    if is_secret_key(key):
        return True
    return isinstance(value, str) and bool(_URL_WITH_PASSWORD.match(value.strip()))


def split(settings: dict) -> tuple[dict, dict]:
    """(öffentlich, geheim) — ein flaches Einstellungs-Dict in zwei Teile."""
    public, secret = {}, {}
    for k, v in (settings or {}).items():
        if is_secret(k, v) and v not in (None, ""):
            secret[k] = v
        else:
            public[k] = v
    return public, secret


def _key(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    raw = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p,
                         dklen=32, maxmem=64 * 1024 * 1024)
    return base64.urlsafe_b64encode(raw)


def encrypt(data: dict, password: str) -> dict:
    from cryptography.fernet import Fernet
    salt = os.urandom(16)
    token = Fernet(_key(password, salt, **_SCRYPT)).encrypt(json.dumps(data).encode("utf-8"))
    # Die Kosten stehen mit im Backup: so lassen sie sich später erhöhen, ohne
    # alte Backups unlesbar zu machen.
    return {"encrypted": True, "kdf": "scrypt", **_SCRYPT,
            "salt": base64.b64encode(salt).decode("ascii"),
            "data": token.decode("ascii")}


def decrypt(blob: dict, password: str) -> dict:
    from cryptography.fernet import Fernet, InvalidToken
    if blob.get("kdf") != "scrypt":
        raise ValueError(f"Unbekanntes Verfahren: {blob.get('kdf')}")
    try:
        n, r, p = int(blob["n"]), int(blob["r"]), int(blob["p"])
        salt = base64.b64decode(blob["salt"], validate=True)
        data = blob["data"].encode("ascii")
    except (KeyError, TypeError, ValueError, AttributeError, binascii.Error) as e:
        raise ValueError(f"Backup-Zugangsdaten unvollständig ({e})") from None
    if not (2 <= n <= _SCRYPT_MAX_N and n & (n - 1) == 0) or r != 8 or p != 1 or not salt:
        raise ValueError("Unbekannte Backup-Parameter")
    key = _key(password, salt, n, r, p)
    try:
        return json.loads(Fernet(key).decrypt(data))
    except InvalidToken:
        raise WrongPassword("Backup-Passwort falsch")
