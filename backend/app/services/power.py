"""Smart-Plug-Adapter (Roadmap 3.1/3.2) — rein lokal, kein Cloud-Zwang.

Liest die Momentanleistung (W) und den kumulierten Energiezähler (kWh) einer
Steckdose und schaltet sie. Drei Backends, ein einheitliches Interface:

  • Home Assistant  — nutzt die bereits konfigurierten ha_url/ha_token (Kamera);
                      plug_switch_entity (switch.*) + plug_power_entity (sensor, W)
                      + plug_energy_entity (sensor, kWh).
  • Tasmota         — http://<ip>, Status-/Power-Kommandos (optional user/password).
  • Shelly (Gen2)   — http://<ip>, Switch.GetStatus / Switch.Set (Kanal 0).

Alle Zugangsdaten kommen aus den Geräte-Einstellungen (SystemConfig/DB), nie aus
einer Datei. Bei Fehlern werden None-Werte gemeldet — die Farm läuft normal weiter.
"""
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 6.0


def plug_configured(s: dict) -> bool:
    t = (s.get("plug_type") or "none").lower()
    if t == "ha":
        return bool((s.get("ha_url") or "").strip() and (s.get("ha_token") or "").strip()
                    and (s.get("plug_switch_entity") or "").strip())
    if t in ("tasmota", "shelly"):
        return bool((s.get("plug_url") or "").strip())
    return False


def _f(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ── Home Assistant ───────────────────────────────────────────────────────────
async def _ha_state(client, url, token, entity):
    r = await client.get(f"{url}/api/states/{entity}",
                         headers={"Authorization": f"Bearer {token}"})
    r.raise_for_status()
    return r.json()


async def _read_ha(s: dict) -> dict:
    url   = (s.get("ha_url") or "").rstrip("/")
    token = s.get("ha_token") or ""
    out = {"watts": None, "energy_kwh": None, "on": None}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        sw = (s.get("plug_switch_entity") or "").strip()
        if sw:
            try:
                st = await _ha_state(client, url, token, sw)
                out["on"] = str(st.get("state", "")).lower() in ("on", "true", "1")
            except Exception:
                pass
        pe = (s.get("plug_power_entity") or "").strip()
        if pe:
            try:
                out["watts"] = _f((await _ha_state(client, url, token, pe)).get("state"))
            except Exception:
                pass
        ee = (s.get("plug_energy_entity") or "").strip()
        if ee:
            try:
                out["energy_kwh"] = _f((await _ha_state(client, url, token, ee)).get("state"))
            except Exception:
                pass
    return out


async def _switch_ha(s: dict, on: bool) -> bool:
    url   = (s.get("ha_url") or "").rstrip("/")
    token = s.get("ha_token") or ""
    entity = (s.get("plug_switch_entity") or "").strip()
    if not (url and token and entity):
        return False
    domain = entity.split(".")[0] or "switch"
    service = f"turn_{'on' if on else 'off'}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(f"{url}/api/services/{domain}/{service}",
                              headers={"Authorization": f"Bearer {token}"},
                              json={"entity_id": entity})
        r.raise_for_status()
    return True


# ── Tasmota ──────────────────────────────────────────────────────────────────
async def _tasmota_cmd(s: dict, client, cmnd: str):
    url = (s.get("plug_url") or "").rstrip("/")
    params = {"cmnd": cmnd}
    user, pw = "admin", (s.get("plug_password") or "")
    if pw:
        params.update({"user": user, "password": pw})
    r = await client.get(f"{url}/cm", params=params)
    r.raise_for_status()
    return r.json()


async def _read_tasmota(s: dict) -> dict:
    out = {"watts": None, "energy_kwh": None, "on": None}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            sns = await _tasmota_cmd(s, client, "Status 10")
            energy = (sns.get("StatusSNS") or {}).get("ENERGY") or {}
            out["watts"]      = _f(energy.get("Power"))
            out["energy_kwh"] = _f(energy.get("Total"))   # Tasmota Total = kWh
        except Exception:
            pass
        try:
            sts = await _tasmota_cmd(s, client, "Power")
            out["on"] = str(sts.get("POWER", "")).upper() == "ON"
        except Exception:
            pass
    return out


async def _switch_tasmota(s: dict, on: bool) -> bool:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        await _tasmota_cmd(s, client, f"Power {'ON' if on else 'OFF'}")
    return True


# ── Shelly (Gen2 RPC) ────────────────────────────────────────────────────────
async def _read_shelly(s: dict) -> dict:
    url = (s.get("plug_url") or "").rstrip("/")
    out = {"watts": None, "energy_kwh": None, "on": None}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            r = await client.get(f"{url}/rpc/Switch.GetStatus", params={"id": 0})
            r.raise_for_status()
            d = r.json()
            out["watts"] = _f(d.get("apower"))
            wh = _f((d.get("aenergy") or {}).get("total"))   # Shelly aenergy.total = Wh
            out["energy_kwh"] = round(wh / 1000.0, 4) if wh is not None else None
            out["on"] = bool(d.get("output"))
        except Exception:
            pass
    return out


async def _switch_shelly(s: dict, on: bool) -> bool:
    url = (s.get("plug_url") or "").rstrip("/")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(f"{url}/rpc/Switch.Set",
                             params={"id": 0, "on": "true" if on else "false"})
        r.raise_for_status()
    return True


# ── Public API ───────────────────────────────────────────────────────────────
async def read_power(s: dict) -> dict:
    """{'watts': float|None, 'energy_kwh': float|None, 'on': bool|None}."""
    t = (s.get("plug_type") or "none").lower()
    try:
        if t == "ha":      return await _read_ha(s)
        if t == "tasmota": return await _read_tasmota(s)
        if t == "shelly":  return await _read_shelly(s)
    except Exception as e:
        logger.warning(f"read_power ({t}) failed: {e}")
    return {"watts": None, "energy_kwh": None, "on": None}


async def set_plug(s: dict, on: bool) -> bool:
    """Schaltet die Steckdose; True bei Erfolg."""
    t = (s.get("plug_type") or "none").lower()
    try:
        if t == "ha":      return await _switch_ha(s, on)
        if t == "tasmota": return await _switch_tasmota(s, on)
        if t == "shelly":  return await _switch_shelly(s, on)
    except Exception as e:
        logger.warning(f"set_plug ({t}, on={on}) failed: {e}")
    return False
