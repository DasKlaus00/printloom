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
import hashlib
import json
import os
import re

SECRET_KEY_HINTS = ("access_code", "password", "passwd", "token", "secret",
                    "api_key", "apikey", "auth", "credential", "private_key")

# scheme://benutzer:passwort@host — nur MIT Passwort-Teil, ein reiner Benutzername
# (rtsp://admin@…) verrät nichts.
_URL_WITH_PASSWORD = re.compile(r"^[a-z][a-z0-9+.-]*://[^/@\s]*:[^/@\s]*@", re.IGNORECASE)

# scrypt-Kosten: 16 MiB Speicher, auf einem Pi Zero 2 W unter einer Sekunde.
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}


class WrongPassword(ValueError):
    pass


def is_secret_key(key) -> bool:
    k = str(key).lower()
    return any(h in k for h in SECRET_KEY_HINTS)


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
    key = _key(password, base64.b64decode(blob["salt"]),
               int(blob["n"]), int(blob["r"]), int(blob["p"]))
    try:
        return json.loads(Fernet(key).decrypt(blob["data"].encode("ascii")))
    except InvalidToken:
        raise WrongPassword("Backup-Passwort falsch")
