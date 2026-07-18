"""Netzwerk-Discovery für Drucker: Bambu (SSDP) + Klipper/Moonraker (Port-Scan).

Zwei Wege, weil zwei sehr unterschiedliche Geräte:

- BAMBU X1C: sendet periodisch SSDP-Broadcasts (wie sie OrcaSlicer/Bambu Studio
  auswerten) ins LAN — darin stehen IP, Gerätename, Modell UND die Seriennummer.
  Wir lauschen ein paar Sekunden auf UDP 2021/1990 (Multicast + Broadcast) und
  senden ein M-SEARCH, um sofortige Antworten zu provozieren. Der Access-Code wird
  NIE mitgesendet (Sicherheit) — den muss der Nutzer weiter selbst eintragen.

- KLIPPER/OTTOeject: Moonraker lauscht auf TCP 7125 und beantwortet /printer/info
  ohne Anmeldung. Wir klopfen das lokale /24-Subnetz asynchron ab und verifizieren
  jeden Treffer per HTTP (liefert auch den Hostnamen, z. B. „ottomk").

WICHTIG (Docker-Bridge): UDP-Broadcasts erreichen einen Container im normalen
Bridge-Netz NICHT → SSDP findet dort keinen Bambu. Als Fallback klopft der
Subnetz-Scan zusätzlich die Bambu-Ports (8883 MQTTS + 990 FTPS) ab und meldet den
Drucker wenigstens mit IP (ohne Seriennummer). Nativ / `network_mode: host` geht alles.
"""
from __future__ import annotations
import asyncio
import logging
import os
import re
import socket
import struct

logger = logging.getLogger(__name__)

_MCAST_GRP = "239.255.255.250"
_SSDP_PORTS = (2021, 1990)
_MSEARCH = (
    "M-SEARCH * HTTP/1.1\r\n"
    f"HOST: {_MCAST_GRP}:1990\r\n"
    'MAN: "ssdp:discover"\r\n'
    "MX: 2\r\n"
    "ST: urn:bambulab-com:device:3dprinter:1\r\n"
    "\r\n"
).encode()


def _header(text: str, key: str) -> str | None:
    m = re.search(rf"^{re.escape(key)}\s*:\s*(.+)$", text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else None


def discover_bambu(timeout: float = 4.0) -> list[dict]:
    """Blockierend (in Executor aufrufen): lauscht auf SSDP und gibt gefundene
    Bambu-Drucker als [{ip, serial, name, model}] zurück."""
    found: dict[str, dict] = {}
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except (AttributeError, OSError):
            pass
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.bind(("", 2021))
        # Multicast-Gruppe auf allen Interfaces beitreten.
        try:
            mreq = struct.pack("=4sl", socket.inet_aton(_MCAST_GRP), socket.INADDR_ANY)
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        except OSError as e:
            logger.debug(f"SSDP multicast join failed (weiter mit Broadcast): {e}")
        # M-SEARCH senden, um sofortige Antworten zu provozieren (Drucker broadcasten
        # zwar von selbst alle paar Sekunden, aber so geht es schneller).
        for port in _SSDP_PORTS:
            try:
                sock.sendto(_MSEARCH, (_MCAST_GRP, port))
            except OSError:
                pass

        sock.settimeout(0.5)
        import time as _t
        end = _t.monotonic() + timeout
        while _t.monotonic() < end:
            try:
                data, addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                break
            text = data.decode("utf-8", errors="ignore")
            if "bambu" not in text.lower() and "USN" not in text:
                continue
            ip = _header(text, "Location") or addr[0]
            serial = _header(text, "USN")
            name = _header(text, "DevName.bambu.com") or _header(text, "DevName")
            model = _header(text, "DevModel.bambu.com") or _header(text, "DevModel")
            if not ip:
                continue
            found[ip] = {
                "ip": ip,
                "serial": serial,
                "name": name or "Bambu Lab",
                "model": model,
                "source": "ssdp",
            }
    except Exception as e:
        logger.debug(f"discover_bambu error: {e}")
    finally:
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass
    return list(found.values())


def _own_ip() -> str | None:
    """Eigene IP über die Standard-Route (im Docker-Bridge-Netz die Container-IP)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def _local_subnet() -> str | None:
    """Lokales /24 (z. B. „192.168.1") aus der eigenen IP."""
    ip = _own_ip()
    return ip.rsplit(".", 1)[0] if ip else None


def _is_containerized() -> bool:
    """Läuft der Prozess in einem Container (Docker/containerd)?"""
    try:
        if os.path.exists("/.dockerenv"):
            return True
        with open("/proc/1/cgroup", "r", encoding="utf-8", errors="ignore") as f:
            txt = f.read()
        return "docker" in txt or "containerd" in txt or "kubepods" in txt
    except Exception:
        return False


def _looks_like_docker_subnet(ip: str | None) -> bool:
    """Docker-Adresspool (172.17.–172.31.x). 172.16.x bleibt außen vor (oft echtes LAN)."""
    try:
        a, b = ip.split(".")[:2]
        return a == "172" and 17 <= int(b) <= 31
    except Exception:
        return False


async def _port_open(ip: str, port: int, timeout: float = 0.4) -> bool:
    try:
        fut = asyncio.open_connection(ip, port)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except (asyncio.TimeoutError, OSError):
        return False


async def _probe_host(ip: str, sem: asyncio.Semaphore, klipper: list, bambu: list):
    async with sem:
        # Moonraker (7125)?
        if await _port_open(ip, 7125):
            hostname = None
            try:
                import httpx
                async with httpx.AsyncClient(timeout=2.0) as c:
                    r = await c.get(f"http://{ip}:7125/printer/info")
                if r.status_code == 200:
                    hostname = (r.json().get("result") or {}).get("hostname")
            except Exception:
                pass
            klipper.append({"ip": ip, "port": 7125, "hostname": hostname, "source": "scan"})
            return
        # Bambu-Fallback für Docker-Bridge (kein SSDP): 8883 MQTTS + 990 FTPS offen.
        if await _port_open(ip, 8883):
            if await _port_open(ip, 990):
                bambu.append({"ip": ip, "serial": None, "name": "Bambu Lab",
                              "model": None, "source": "scan"})


async def scan_subnet(subnet: str, own_ip: str | None = None) -> dict:
    """Async /24-Scan des angegebenen Subnetzes (z. B. „192.168.1"): findet Moonraker
    (verifiziert) und Bambu (Port-Fallback). Die eigene IP wird nie zurückgegeben."""
    if not subnet:
        return {"klipper": [], "bambu": []}
    subnet = subnet.strip().rstrip(".")
    sem = asyncio.Semaphore(64)
    klipper: list = []
    bambu: list = []
    hosts = [f"{subnet}.{i}" for i in range(1, 255) if f"{subnet}.{i}" != own_ip]
    tasks = [_probe_host(ip, sem, klipper, bambu) for ip in hosts]
    await asyncio.gather(*tasks, return_exceptions=True)
    return {"klipper": klipper, "bambu": bambu}


async def discover(timeout: float = 4.0, subnet: str | None = None) -> dict:
    """SSDP-Bambu (mit Seriennummer) + Subnetz-Scan (Moonraker verifiziert, Bambu-
    Port-Fallback), gemergt nach IP (SSDP hat Vorrang).

    `subnet`: explizites /24 (z. B. „192.168.1") — nötig in Docker-Bridge, weil dort
    die automatisch erkannte IP die Container-IP (172.x) ist und ein Scan des
    Docker-Netzes nur andere Container fände. Ohne Angabe wird das eigene /24
    genommen; erkennt Printloom aber ein Docker-Bridge-Netz, wird NICHT gescannt
    (sonst falsche Treffer wie 172.18.0.2) und `docker_bridge=True` gemeldet."""
    own_ip = _own_ip()
    docker_bridge = False
    scan_target = None
    if subnet and subnet.strip():
        scan_target = subnet.strip().rstrip(".")
    elif own_ip:
        if _is_containerized() and _looks_like_docker_subnet(own_ip):
            docker_bridge = True   # Docker-Netz scannen wäre sinnlos → überspringen
        else:
            scan_target = own_ip.rsplit(".", 1)[0]

    loop = asyncio.get_event_loop()
    ssdp_task = loop.run_in_executor(None, discover_bambu, timeout)
    scan_task = asyncio.ensure_future(
        scan_subnet(scan_target, own_ip) if scan_target else _empty_scan())
    ssdp_bambu, scan = await asyncio.gather(ssdp_task, scan_task)

    # Eigene IP + offensichtliche Docker-Adressen nie als Fund melden.
    def _keep(ip: str | None) -> bool:
        if not ip or ip == own_ip:
            return False
        if docker_bridge and _looks_like_docker_subnet(ip):
            return False
        return True

    bambu_by_ip: dict[str, dict] = {}
    for b in ssdp_bambu:
        if _keep(b.get("ip")):
            bambu_by_ip[b["ip"]] = b
    for b in scan.get("bambu", []):
        if _keep(b.get("ip")):
            bambu_by_ip.setdefault(b["ip"], b)   # nur ergänzen, SSDP nicht überschreiben

    klipper = [k for k in scan.get("klipper", []) if _keep(k.get("ip"))]

    return {
        "bambu": list(bambu_by_ip.values()),
        "klipper": klipper,
        "docker_bridge": docker_bridge,
        "scanned_subnet": scan_target,
    }


async def _empty_scan() -> dict:
    return {"klipper": [], "bambu": []}
