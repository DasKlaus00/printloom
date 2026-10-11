"""Profile — Sequenzen, Regal-Aufbau und Farm-Einstellungen als ein teilbares
JSON-Objekt (``om4d-profile/1``), und so ein Objekt wieder einspielen.

Sicherheit: Ein Import führt NIE G-code aus. Er schreibt nur dieselben
Konfig-Dateien, die die App ohnehin benutzt — nach Prüfung:
  * sequences   — nur Schritt-Arten, die der Ablauf kennt (sequence_steps), nur
                  bekannte Felder; ausgeführt wird erst, wenn der Nutzer die Farm
                  startet (und sich die Schritte vorher ansehen kann).
  * rack_config — nur Aufbau-Werte, geklemmt (dieselbe Funktion wie die
                  Regalverwaltung), nie die Belegung der Fächer.
  * settings    — über das Farm-Schema geprüft und mit den vorhandenen
                  Einstellungen ZUSAMMENGEFÜHRT.

Bewusst NICHT im Profil: die Positionen aus dem Drucker-Tab. Sie hängen davon ab,
wo Schiene, Regale und Drucker genau stehen — fremde Werte würden den Arm an die
falsche Stelle fahren. Die stehen im Backup. Ältere Profile enthalten noch eine
„Kalibrierung" (`macro_config`, Werte alter Geräte-Makros); seit dem Drucker-Tab
bewirkte sie nichts mehr und wird beim Import übergangen.
"""
from typing import Optional

from app.services import farm_settings, rack_store, storage
from app.services.sequence_steps import STEP_FIELDS, STEP_TYPES

SCHEMA = "om4d-profile/1"

# Regal-AUFBAU (nicht die Belegung). magazine_slot sagt, ob es überhaupt ein Magazin
# gibt — fehlte bis v1.1.34, ein Profil ließ also offen, wie gegriffen wird.
_RACK_CONFIG_KEYS = ("num_racks", "slots_per_rack", "slot_height_mm", "slot_tolerance_mm",
                     "slot_stacked_pct", "stack_rack", "stack_slot", "magazine_slot",
                     "magazine_defaults", "max_plates", "height_margin_pct")


def _seq_path() -> str:
    from app.routers import autofarm
    return autofarm.SEQ_PATH


def _schema_version() -> str:
    from app.routers import autofarm
    return autofarm.SEQ_SCHEMA_VERSION


# ── Aktuellen Stand lesen ───────────────────────────────────────────────────

def _current_sequences() -> dict:
    data = storage.read_json(_seq_path(), {}) or {}
    return {"seq_new": data.get("seq_new", []), "seq_next": data.get("seq_next", [])}


def _current_rack_config() -> dict:
    data = rack_store.load()
    return {k: data[k] for k in _RACK_CONFIG_KEYS if k in data}


def build_profile(name: str, printer_model: str, description: str,
                  components: Optional[list]) -> dict:
    """Den aktuellen Stand als teilbares Profil."""
    return {
        "schema":        SCHEMA,
        "name":          name,
        "printer_model": printer_model,
        "description":   description,
        "components":    components or [],
        "sequences":     _current_sequences(),
        "rack_config":   _current_rack_config(),
        "settings":      farm_settings.read(),
    }


# ── Einspielen ──────────────────────────────────────────────────────────────

def _sanitize_step(step) -> Optional[dict]:
    if not isinstance(step, dict):
        return None
    t = step.get("type", "")
    if t not in STEP_TYPES:
        return None
    out = {k: step.get(k) for k in STEP_FIELDS if k in step}
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
    storage.write_json(_seq_path(), {"seq_new": seq_new, "seq_next": seq_next,
                                     "schema_version": _schema_version()})
    return True


def _apply_settings(incoming) -> bool:
    if not isinstance(incoming, dict):
        return False
    from app.routers.autofarm import SettingsPayload
    try:
        validated = SettingsPayload(**{
            k: v for k, v in incoming.items() if k in SettingsPayload.model_fields
        }).model_dump(exclude_unset=True)
    except Exception:
        return False
    if not validated:
        return False
    # Zusammenführen: Was das Profil nicht nennt (z. B. weil es aus einer älteren
    # Version stammt), bleibt, wie es ist — statt auf die Vorgabe zurückzufallen.
    current = dict(farm_settings.read())
    current.update(validated)
    storage.write_json(farm_settings.PATH, current)
    return True


def _apply_rack_config(incoming) -> bool:
    if not isinstance(incoming, dict):
        return False
    body = {k: incoming[k] for k in _RACK_CONFIG_KEYS if incoming.get(k) is not None}
    if not body:
        return False
    try:
        with rack_store.edit() as data:
            rack_store.apply_config(data, body)
    except (TypeError, ValueError):
        return False
    return True


def apply_profile(profile: dict) -> dict:
    """Profil prüfen und einspielen. → welche Abschnitte übernommen wurden."""
    return {
        "sequences":   _apply_sequences(profile.get("sequences")),
        "rack_config": _apply_rack_config(profile.get("rack_config")),
        "settings":    _apply_settings(profile.get("settings")),
    }


# ── Lokale Profil-Bibliothek (db/profiles.json) ─────────────────────────────

def _lib_path() -> str:
    from app.paths import DB_DIR
    DB_DIR.mkdir(parents=True, exist_ok=True)
    return str(DB_DIR / "profiles.json")


def list_local() -> list:
    return storage.read_json(_lib_path(), []) or []


def save_local(profile: dict) -> list:
    name = profile.get("name", "Unbenannt")
    lib = [p for p in list_local() if p.get("name") != name] + [profile]
    storage.write_json(_lib_path(), lib)
    return lib


def delete_local(name: str) -> list:
    lib = [p for p in list_local() if p.get("name") != name]
    storage.write_json(_lib_path(), lib)
    return lib
