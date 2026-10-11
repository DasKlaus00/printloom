"""Farm-Einstellungen (`farm_settings.json`) — Vorgaben und Lesen.

Eigenes Modul, weil nicht nur die Farm sie braucht: der Direktdruck liest
„nur exakte Farbe", Profile und Backup schreiben sie. Bis v1.1.34 holten sich
diese Stellen Pfad und Vorgaben aus dem Farm-Router.
"""
from app.paths import db_path
from app.services import storage

PATH = db_path("farm_settings.json")

DEFAULTS = {"poll_interval": 20, "min_print_minutes": 0, "use_ams": True,
            "hms_ignore": ["0C00-0100-0001-0004"],
            # Energie & Kosten (Roadmap 3.1/3.2/3.4) — reine Zahlen, keine Geheimnisse
            "power_price_eur_kwh":   0.30,
            "machine_rate_eur_h":    0.0,
            "filament_price_eur_kg": 20.0,
            "idle_off_min":          0,    # 0 = Auto-Abschaltung aus
            # Zeitlimit EINER OTTOeject-Bewegung (s) — danach gilt sie als
            # hängend (Phase 3.3). Ein Griff über mehrere Regale darf dauern.
            "move_timeout_s":        180,
            # Watchdog (Roadmap 1.1/1.7)
            "conn_alarm":            True,  # Push bei wiederholtem Verbindungsverlust (1.1)
            "progress_stall_min":    0,     # 0 = aus; sonst Pause bei N min ohne Fortschritt (1.7)
            # Fehlerstrategie (Roadmap 1.3) — {error_key: action}; leer = Defaults
            "error_strategy":        {},
            "failed_retries":        1,     # Wiederholungen bei FAILED vor der gewählten Aktion
            # Zeitzone des Nutzers (IANA, z. B. "Europe/Berlin") — der Container
            # läuft i. d. R. in UTC; die Betriebszeiten müssen aber in der lokalen
            # Zeit des Nutzers ausgewertet werden. Frontend liefert sie automatisch.
            "timezone": "",
            # Betriebszeiten (Roadmap 2.5) — neue Jobs nur im Zeitfenster starten
            "operating_hours_enabled": False,
            # Pro Wochentag (Index 0=Mo … 6=So) ein eigenes Fenster.
            "operating_schedule": [
                {"enabled": True, "start": "22:00", "end": "06:00"} for _ in range(7)
            ],
            # Legacy-Felder (vor v1.0.59) — nur noch für Migration alter Configs:
            "operating_start":         "22:00",
            "operating_end":           "06:00",
            "operating_days":          [0, 1, 2, 3, 4, 5, 6],  # 0=Mo … 6=So
            # „Nur exakte Farbe" (1.4): True → es wird NICHT auf eine nur
            # ähnliche Ersatzfarbe ausgewichen. Ohne exakten Treffer pausiert
            # die Farm (manuelle AMS-Zuordnung), statt falsch zu drucken.
            "exact_color_only":        False}


def read() -> dict:
    data = storage.read_json(PATH, None)
    return data if isinstance(data, dict) else dict(DEFAULTS)
