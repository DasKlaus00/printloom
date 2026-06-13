"""Printer profiles
=================
Bundle the current macro calibration, step sequences, rack layout and farm
settings into one shareable JSON object (``om4d-profile/1``) and apply such a
bundle back.

Safety: importing a profile NEVER executes G-code. It only writes the same JSON
config files the app already uses (via the atomic ``storage`` module), after
validation:
  * macro_config  — only numeric *values* of *already-known* fields are updated;
                    the local macro names / structure are preserved (no
                    injection of arbitrary internal macro names).
  * sequences     — step ``type`` is restricted to a known whitelist; values are
                    kept as plain strings and only run when the user explicitly
                    starts the farm (and can review them beforehand).
  * rack_config   — numeric layout fields only, clamped to safe ranges.
  * settings      — validated via the existing farm SettingsPayload.
"""
from typing import Optional

from app.services import storage
from app.routers import calibration, autofarm, rack_manager

SCHEMA = "om4d-profile/1"

# Rack layout = configuration, NOT runtime slot occupancy.
_RACK_CONFIG_KEYS = ["num_racks", "slots_per_rack", "slot_height_mm",
                     "stack_rack", "stack_slot", "max_plates", "height_margin_pct"]

# Sequence step types the executor understands (see sequenceData.js / loop).
_ALLOWED_STEP_TYPES = {"macro", "delay", "send_file", "wait_print", "klipper_gcode"}
_STEP_FIELDS = ("id", "type", "label", "value", "seconds", "parallel", "optional")


# ── Read current state ──────────────────────────────────────────────────────

def _current_macro_config() -> dict:
    return calibration._load()


def _current_sequences() -> dict:
    data = storage.read_json(autofarm.SEQ_PATH, {}) or {}
    return {"seq_new": data.get("seq_new", []), "seq_next": data.get("seq_next", [])}


def _current_settings() -> dict:
    return storage.read_json(autofarm.SETTINGS_PATH, autofarm._DEFAULT_SETTINGS) or {}


def _current_rack_config() -> dict:
    data = rack_manager._load()
    return {k: data.get(k) for k in _RACK_CONFIG_KEYS if k in data}


def build_profile(name: str, printer_model: str, description: str,
                  components: Optional[list]) -> dict:
    """Snapshot the current configuration into a shareable profile bundle."""
    return {
        "schema":        SCHEMA,
        "name":          name,
        "printer_model": printer_model,
        "description":   description,
        "components":    components or [],
        "macro_config":  _current_macro_config(),
        "sequences":     _current_sequences(),
        "rack_config":   _current_rack_config(),
        "settings":      _current_settings(),
    }


# ── Apply (import) ──────────────────────────────────────────────────────────

def _apply_macro_config(incoming) -> bool:
    """Update only numeric values of already-known fields. Returns True if applied."""
    if not isinstance(incoming, dict):
        return False
    current = calibration._load()
    changed = False
    for key, cfg in incoming.items():
        if key not in current or not isinstance(cfg, dict):
            continue
        in_fields = cfg.get("fields", {})
        if not isinstance(in_fields, dict):
            continue
        for fname, fdata in in_fields.items():
            if fname in current[key].get("fields", {}):
                try:
                    current[key]["fields"][fname]["value"] = float(fdata["value"])
                    changed = True
                except (KeyError, TypeError, ValueError):
                    pass
    if changed:
        calibration._save(current)
    return changed


def _sanitize_step(step) -> Optional[dict]:
    if not isinstance(step, dict):
        return None
    t = step.get("type", "")
    if t not in _ALLOWED_STEP_TYPES:
        return None
    out = {k: step.get(k) for k in _STEP_FIELDS if k in step}
    out["type"] = t
    if "value" in out and out["value"] is not None:
        out["value"] = str(out["value"])
    return out


def _apply_sequences(incoming) -> bool:
    if not isinstance(incoming, dict):
        return False
    seq_new = [san for s in (incoming.get("seq_new") or []) if (san := _sanitize_step(s))]
    seq_next = [san for s in (incoming.get("seq_next") or []) if (san := _sanitize_step(s))]
    if not seq_new and not seq_next:
        return False
    data = {"seq_new": seq_new, "seq_next": seq_next,
            "schema_version": autofarm.SEQ_SCHEMA_VERSION}
    storage.write_json(autofarm.SEQ_PATH, data)
    return True


def _apply_settings(incoming) -> bool:
    if not isinstance(incoming, dict):
        return False
    try:
        validated = autofarm.SettingsPayload(**{
            k: v for k, v in incoming.items()
            if k in autofarm.SettingsPayload.model_fields
        }).model_dump()
    except Exception:
        return False
    storage.write_json(autofarm.SETTINGS_PATH, validated)
    return True


def _apply_rack_config(incoming) -> bool:
    if not isinstance(incoming, dict):
        return False
    data = rack_manager._load()
    clamp = {
        "num_racks":         lambda v: max(1, min(10, int(v))),
        "slots_per_rack":    lambda v: max(1, min(20, int(v))),
        "slot_height_mm":    lambda v: float(v),
        "stack_rack":        lambda v: max(1, int(v)),
        "stack_slot":        lambda v: max(1, int(v)),
        "max_plates":        lambda v: max(1, int(v)),
        "height_margin_pct": lambda v: max(0.0, min(100.0, float(v))),
    }
    changed = False
    for key, fn in clamp.items():
        if key in incoming and incoming[key] is not None:
            try:
                data[key] = fn(incoming[key])
                changed = True
            except (TypeError, ValueError):
                pass
    if not changed:
        return False
    # Rebuild slot keys to match the (possibly changed) layout, preserving existing.
    nr  = int(data.get("num_racks", rack_manager.DEFAULT_NUM_RACKS))
    spr = int(data.get("slots_per_rack", rack_manager.DEFAULT_SLOTS_PER_RACK))
    existing = data.get("slots", {})
    data["slots"] = {
        f"{r}-{s}": existing.get(f"{r}-{s}", rack_manager._default_slot())
        for r in range(1, nr + 1) for s in range(1, spr + 1)
    }
    rack_manager._save(data)
    return True


def apply_profile(profile: dict) -> dict:
    """Validate + apply a profile bundle. Returns which sections were applied."""
    applied = {
        "macro_config": _apply_macro_config(profile.get("macro_config")),
        "sequences":    _apply_sequences(profile.get("sequences")),
        "rack_config":  _apply_rack_config(profile.get("rack_config")),
        "settings":     _apply_settings(profile.get("settings")),
    }
    return applied


# ── Local profile library (db/profiles.json) ────────────────────────────────

def _lib_path() -> str:
    # Reuse the same db-dir resolution as appsettings to stay consistent.
    from app.services.appsettings import _db_dir
    return str(_db_dir() / "profiles.json")


def list_local() -> list:
    return storage.read_json(_lib_path(), []) or []


def save_local(profile: dict) -> list:
    lib = list_local()
    name = profile.get("name", "Unbenannt")
    # replace by name if it already exists
    lib = [p for p in lib if p.get("name") != name]
    lib.append(profile)
    storage.write_json(_lib_path(), lib)
    return lib


def delete_local(name: str) -> list:
    lib = [p for p in list_local() if p.get("name") != name]
    storage.write_json(_lib_path(), lib)
    return lib
