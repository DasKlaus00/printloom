"""Wer darf Printloom ansprechen? Adress- und Herkunftsprüfung für den Wächter in main.py.

Zwei Angriffe aus dem Browser, für die der Angreifer nicht im Heimnetz sein muss:

1. DNS-Rebinding: Eine fremde Seite (http://angreifer.example:8000) lässt ihren Namen
   nach dem Laden auf die IP der Farm zeigen. Für den Browser bleibt das dieselbe
   Herkunft: Er schickt Anfragen hin UND gibt die Antworten an die Seite weiter. Die
   Farm erkennt das nur am Host-Kopf (angreifer.example:8000). Deshalb nimmt Printloom
   nur Adressen an, die im Heimnetz üblich sind (IP, Name ohne Punkt, .local, .lan, …),
   und Namen aus PRINTLOOM_ALLOWED_HOSTS.

2. Schreiben von einer fremden Seite (CSRF): ein Formular, das sich selbst abschickt.
   Über https meldet der Browser die Herkunft in `Sec-Fetch-Site`. Über http://<IP>
   schickt er diesen Kopf NICHT (nur an „vertrauenswürdige" Adressen: https und
   localhost). Dann muss der `Origin`-Kopf zur aufgerufenen Adresse passen.

Hinter einem Proxy mit https (authentik) kommt jede Browser-Anfrage mit `Sec-Fetch-Site`
an. Ein Rebinding über https geht nicht (der Angreifer hätte kein Zertifikat für die
Farm-Adresse), darum gilt eine solche Anfrage auch mit unbekanntem Namen nicht als
Rebinding. So sperrt die Prüfung niemanden aus, der Printloom über seine Domain öffnet.

Reine Funktionen ohne FastAPI, damit sie sich einzeln testen lassen.
"""
from __future__ import annotations

import ipaddress
import os
from typing import Mapping, Optional
from urllib.parse import urlsplit

UNKNOWN_HOST = "UNBEKANNTE_ADRESSE"
# Programme ohne Browser (OrcaSlicer-Plugin, eigene Skripte) können sich mit diesem
# Kopf ausweisen. Köpfe mit „Sec-" darf keine Webseite setzen (Fetch-Standard,
# verbotene Kopfnamen), also kommt er nie aus einem Browser, auch nicht beim Rebinding.
# Ein Programm ohne Browser ist kein Angriffsweg dieser Prüfung: Es könnte den
# Host-Kopf ohnehin frei wählen.
CLIENT_HEADER = "sec-printloom-client"
FOREIGN_ORIGIN = "FREMDE_HERKUNFT"
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Namensendungen, die nur im eigenen Netz aufgelöst werden. Keine davon kann man
# öffentlich registrieren: .home/.corp hat die ICANN dauerhaft gesperrt, .internal und
# .home.arpa sind dafür reserviert, fritz.box gehört AVM (Standard-Domain der FRITZ!Box).
LOCAL_SUFFIXES = (".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain",
                  ".localhost", ".corp", ".fritz.box")

# Browser-Werte von Sec-Fetch-Site, bei denen der Browser selbst bestätigt, dass die
# Anfrage von der eigenen Oberfläche (oder einer getippten Adresse) kommt.
_OWN_SITES = frozenset({"same-origin", "none"})
_DEFAULT_PORTS = {"http": 80, "https": 443, "ws": 80, "wss": 443}


def split_host(value: Optional[str]) -> tuple[str, Optional[int]]:
    """'Farm.Lan:8000' → ('farm.lan', 8000), '[::1]:80' → ('::1', 80), 'a' → ('a', None)."""
    v = (value or "").strip().lower()
    if not v:
        return "", None
    if v.startswith("["):
        name, _, rest = v[1:].partition("]")
        port = rest[1:] if rest.startswith(":") else ""
    elif v.count(":") == 1:
        name, _, port = v.partition(":")
    else:
        # Kein Port oder eine IPv6-Adresse ohne Klammern.
        name, port = v, ""
    name = name.rstrip(".")  # „farm.lan." ist derselbe Name wie „farm.lan"
    return name, int(port) if port.isdigit() else None


def _is_ip(name: str) -> bool:
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        return False


def _is_loopback(name: str) -> bool:
    if name == "localhost" or name.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def allowed_hosts() -> list[str]:
    """Namen aus PRINTLOOM_ALLOWED_HOSTS (Komma-Liste, `*.domain.de` erlaubt).

    Bei jedem Aufruf neu gelesen: Ein Test oder der Nutzer kann die Variable ändern,
    ohne dass ein zwischengespeicherter Wert übrig bleibt. Ports werden ignoriert."""
    raw = os.environ.get("PRINTLOOM_ALLOWED_HOSTS", "")
    out = []
    for part in raw.split(","):
        part = part.strip().lower()
        if not part:
            continue
        if part.startswith("*."):
            out.append("*." + split_host(part[2:])[0])
        else:
            out.append(split_host(part)[0])
    return [p for p in out if p and p != "*."]


def _listed(name: str, wildcards: bool = True) -> bool:
    for entry in allowed_hosts():
        if entry.startswith("*."):
            if wildcards and name.endswith(entry[1:]):
                return True
        elif name == entry:
            return True
    return False


def host_ok(host_header: Optional[str]) -> bool:
    """Ist das eine Adresse, unter der Printloom im Heimnetz erreichbar ist?

    Ohne Host-Kopf (HTTP/1.0, Skripte) gibt es nichts zu prüfen: Browser schicken
    ihn immer, und nur Browser lassen sich per Rebinding missbrauchen."""
    name, _ = split_host(host_header)
    if not name:
        return True
    if _is_ip(name) or "." not in name or name.endswith(LOCAL_SUFFIXES):
        return True
    return _listed(name)


def _same_address(o_name: str, o_port: int, o_scheme: str, candidate: Optional[str]) -> bool:
    name, port = split_host(candidate)
    if not name or name != o_name:
        return False
    # Ein Host-Kopf ohne Port meint den Standardport. Keine Nachsicht für andere
    # Ports: Sonst zählte jeder andere Dienst auf derselben Adresse (Portainer, Home
    # Assistant, …) als eigene Oberfläche. Ein Proxy auf einem anderen Port muss den
    # Port mitschicken (nginx: Host $http_host statt $host).
    return port == o_port or (port is None and o_port == _DEFAULT_PORTS[o_scheme])


def origin_ok(origin: Optional[str], host_header: Optional[str],
              forwarded_host: Optional[str] = None) -> bool:
    """Passt die Herkunft (Origin) zur aufgerufenen Adresse?

    - kein Origin: kein Browser, oder eine Anfrage, bei der er nie fehlt (POST von
      fremder Seite trägt ihn immer) → erlaubt
    - "null" (Sandbox-iframe, file://, Weiterleitung) → nie erlaubt
    - sonst: gleicher Name und Port wie Host oder X-Forwarded-Host, ein Name aus
      PRINTLOOM_ALLOWED_HOSTS (nur ausgeschriebene, keine *.-Einträge: sonst dürfte
      jede Seite unter der Domain schreiben, auch ein fremder Blog), oder beide Seiten
      lokal (Vite-Dev auf :3000 → :8000).

    X-Forwarded-Host zählt nur, wenn er selbst eine erlaubte Adresse ist; das prüft
    decide() vorher. Beim Rebinding ist die fremde Seite „gleiche Herkunft" und könnte
    den Kopf selbst setzen, und ein Proxy ohne ProxyPreserveHost (Apache) trägt dort
    den fremden Namen ein."""
    if origin is None:
        return True
    o = origin.strip()
    if not o or o.lower() == "null":
        return False
    try:
        parts = urlsplit(o)
        o_name = (parts.hostname or "").rstrip(".")
        o_port = parts.port or _DEFAULT_PORTS.get(parts.scheme)
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not o_name or o_port is None:
        return False
    if (_same_address(o_name, o_port, parts.scheme, host_header)
            or _same_address(o_name, o_port, parts.scheme, forwarded_host)):
        return True
    if _listed(o_name, wildcards=False):
        return True
    return _is_loopback(o_name) and _is_loopback(split_host(host_header)[0])


def _secure_browser(kind: str, site: Optional[str], origin: Optional[str],
                    host_header: Optional[str]) -> bool:
    """Kam die Anfrage von einem Browser über https (oder localhost)?

    Sec-Fetch-* schicken Browser nur an https- und localhost-Adressen, und eine Seite
    kann sie nicht fälschen (Präfix „Sec-"). Bei WebSockets schicken nicht alle Browser
    den Kopf, dafür immer Origin. Dort gilt: Eine https-Seite darf kein ws:// öffnen
    (gemischter Inhalt), und wss:// zur Farm scheitert für einen fremden Namen am
    Zertifikat. NUR für WebSockets: Ein Formular von https://angreifer.example an
    http://angreifer.example (umgeleitet auf die Farm) trägt ebenfalls eine https-
    Herkunft mit diesem Namen."""
    if site is not None:
        return True
    if kind == "websocket" and origin and origin.strip().lower().startswith("https://"):
        try:
            o_name = (urlsplit(origin.strip()).hostname or "").rstrip(".")
        except ValueError:
            return False
        return bool(o_name) and o_name == split_host(host_header)[0]
    return False


def decide(kind: str, method: Optional[str], headers: Mapping[str, str]) -> Optional[str]:
    """None = durchlassen, sonst der Grund (UNKNOWN_HOST oder FOREIGN_ORIGIN).

    `headers` mit kleingeschriebenen Namen. `kind` ist der ASGI-Typ (http/websocket)."""
    if headers.get(CLIENT_HEADER):
        return None
    host = headers.get("host")
    site = headers.get("sec-fetch-site")
    origin = headers.get("origin")
    site_v = site.strip().lower() if site is not None else None
    # Nur der erste Eintrag: den setzt der Proxy, der dem Browser am nächsten ist.
    fwd = (headers.get("x-forwarded-host") or "").split(",")[0].strip() or None

    secure = _secure_browser(kind, site_v, origin, host)
    if not secure and not (host_ok(host) and (fwd is None or host_ok(fwd))):
        # Auch X-Forwarded-Host prüfen: Ein http-Proxy, der den Host auf den
        # Container umschreibt (printloom:8000), trägt den Namen des Browsers dort ein.
        return UNKNOWN_HOST

    if kind == "websocket" or (method or "").upper() in WRITE_METHODS:
        if site_v is not None:
            # Der Browser bestätigt die Herkunft selbst; cross-site und same-site
            # (ein anderer Dienst unter derselben Domain) sind beide fremd.
            return None if site_v in _OWN_SITES else FOREIGN_ORIGIN
        if not origin_ok(origin, host, fwd):
            return FOREIGN_ORIGIN
    return None


def frame_headers() -> list[tuple[bytes, bytes]]:
    """Köpfe gegen das Einbetten in fremde Seiten (Clickjacking: unsichtbares iframe,
    der Nutzer klickt „Notaus" und trifft „Update").

    PRINTLOOM_FRAME_ANCESTORS (Leerzeichen- oder Komma-Liste, z. B. die Adresse von
    Home Assistant) erlaubt weitere Seiten. X-Frame-Options kennt keine Liste, darum
    steht es nur ohne Freigaben da; ältere Browser ohne CSP-Unterstützung sind dann
    trotzdem geschützt."""
    raw = os.environ.get("PRINTLOOM_FRAME_ANCESTORS", "")
    extra = [s for s in raw.replace(",", " ").split()
             if not any(c in s for c in ";'\"\r\n")]
    csp = " ".join(["frame-ancestors", "'self'", *extra])
    out = [(b"content-security-policy", csp.encode("latin-1", "ignore"))]
    if not extra:
        out.append((b"x-frame-options", b"SAMEORIGIN"))
    return out
