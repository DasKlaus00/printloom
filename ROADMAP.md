# Printloom — Roadmap

> **Leitprinzipien:** Alles läuft lokal & offline-fähig — keine Cloud-Pflicht, keine
> externe KI-Abhängigkeit. Diese Roadmap enthält **ausschließlich funktionale Features**
> für den **sicheren, unbeaufsichtigten Dauerbetrieb** und die Wirtschaftlichkeit einer
> Druckfarm. Keine Spielereien, kein Deko-Kram — jeder Punkt löst ein konkretes Problem.

Legende: **Wert** ★ (1–3, Nutzen im Farm-Betrieb) · **Aufwand** S/M/L · ✅ = umgesetzt

---

## Säule 1 — Sicherheit & Ausfallschutz  *(höchste Priorität)*

Ohne diese Punkte ist „unbeaufsichtigt" nicht verantwortbar. Ein abgerissener Druck,
der stundenlang weiterläuft, kostet Material, Zeit und im schlimmsten Fall die Düse.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 1.1 | **Watchdog & Auto-Reconnect** ✅ | ★★★ | M | Reconnect je Poll; bei wiederholtem Verbindungsverlust Push-Alarm, der Druck läuft am Gerät weiter. *(v1.0.30)* |
| 1.2 | **Filament-Runout-Erkennung** | ★★★ | M | Leerstand/Runout aus MQTT/AMS auswerten → pausieren statt in der Luft weiterdrucken. |
| 1.3 | **Konfigurierbare Fehlerstrategie** | ★★★ | M | Pro Fehlerfall festlegen: X× Retry / Job überspringen / Farm pausieren / Drucker parken. |
| 1.4 | **Erste-Schicht-Kamera-Check** | ★★ | M | Snapshot nach Layer 1 → bei erkanntem Fehlstart (keine Haftung/Spaghetti) pausieren + Push mit Bild. |
| 1.5 | **Fehldruck-Erkennung im Lauf** | ★★ | L | Periodische Snapshot-Prüfung auf Spaghetti/Ablösung. Erst regelbasiert, optional lokales Modell — rein lokal. |
| 1.6 | **Temperatur-Überwachung & Alarm** | ★★ | S | Hotend/Bett/Kammer gegen Grenzwerte prüfen → Übertemperatur sofort pausieren + alarmieren. |
| 1.7 | **Extrusions-/Verstopfungs-Erkennung** ✅ | ★★ | M | Fortschritts-Watchdog: kein mc_percent-Fortschritt während RUNNING (konfigurierbares Zeitfenster) → Pause + Push-Alarm. *(v1.0.30)* |
| 1.8 | **Stromausfall-Wiederaufnahme** | ★ | M | Power-Loss-Recovery-Status sichtbar machen und kontrolliert fortsetzen statt blind neu zu starten. |

## Säule 2 — Intelligente Planung

Aus „Liste abarbeiten" wird „effizient planen" — regelbasiert, aus eigener Historie,
ohne Cloud.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 2.1 | **Smart-Sortierung** ✅ | ★★★ | M | Wartende Jobs nach Filament gruppieren → weniger AMS-/Spulenwechsel. *(v1.0.27)* |
| 2.2 | **Echte Restzeit-Prognose** ✅ | ★★★ | M | ETA aus tatsächlicher Lauf-Historie statt Slicer-Schätzung (Live > Historie > Slicer). *(v1.0.27)* |
| 2.3 | **Warteschlangen-Planer** ✅ | ★★ | M | Zeitleiste der Queue mit Fertig-Uhrzeiten; reagiert sofort auf Umsortieren. *(v1.0.27)* |
| 2.4 | **Auto-Nesting auf Platte** | ★★ | L | Mehrere kleine Teile automatisch zu einer Platte bündeln → eine Druck-/Auswurf-Runde statt vieler. |
| 2.5 | **Zeitfenster / Betriebszeiten** | ★★ | S | Nur in definierten Fenstern drucken (Ruhezeiten, Stromtarif); Farm startet bei Jobs selbst. |
| 2.6 | **Job-Prioritäten & Liefertermine** | ★★ | M | Hoch/Normal/Niedrig + Fälligkeitsdatum → automatische Reihenfolge nach Deadline. |
| 2.7 | **Job-Abhängigkeiten** | ★ | M | „Erst nach Job X" erzwingen (z. B. Baugruppen-Teile in fester Reihenfolge). |
| 2.8 | **Wiederkehrende Jobs** | ★ | S | Feste Queues per Zeitplan automatisch einreihen (täglich/wöchentlich). |

## Säule 3 — Energie & Betriebskosten

Dauerbetrieb kostet Strom. Sichtbar machen, automatisch abschalten, planbar machen.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 3.1 | **Smart-Plug-Verbrauch** ✅ | ★★★ | M | Tasmota/Shelly/HA-Steckdose auslesen → echter Stromverbrauch je Job statt Schätzung. *(v1.0.29)* |
| 3.2 | **Auto-Abschaltung im Leerlauf** ✅ | ★★★ | M | Drucker/Kammerlicht/Lüftung nach X Minuten ohne Job stromlos schalten (über 3.1). *(v1.0.29)* |
| 3.3 | **Off-Peak-Planung** | ★★ | S | Druckstart an günstige Stromtarif-Fenster koppeln. |
| 3.4 | **Kosten-Tracking & Kalkulation** ✅ | ★★ | S | Filament + Strom + Maschinenzeit → Kosten je Druck/Auftrag, exportierbar. *(v1.0.29)* |
| 3.5 | **Intelligenter Vorlauf** | ★ | S | Bett/Düse erst rechtzeitig vor Job-Start vorheizen statt dauerhaft warm halten. |
| 3.6 | **Trockner-Steckdosen-Steuerung** | ★ | S | Filament-Trockner über denselben Plug-Adapter zeit-/feuchtigkeitsgesteuert schalten. |
| 3.7 | **Lastspitzen-Vermeidung** | ★ | M | Mehrere Aufheizvorgänge zeitlich versetzen, um die Anschlussleistung nicht zu überlasten. |

## Säule 4 — Material & Kalibrierung

Weniger Fehldrucke durch gepflegtes Material-Know-how und Bestandsführung.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 4.1 | **Filamentverbrauch-Tracking** | ★★★ | M | Gramm/Länge je Job aus Druckerdaten, summiert pro Filament/Auftrag. |
| 4.2 | **Materialbestand & Nachbestell-Warnung** | ★★★ | M | Spulen-Inventar mit Restmenge; Warnung unter Schwelle (optional Spoolman-Anbindung). |
| 4.3 | **Geführter Kalibrier-Assistent** | ★★ | L | Flow, Pressure Advance, Temp-Tower Schritt für Schritt; Ergebnisse speichern. |
| 4.4 | **Kalibrierwerte je Spule/Marke** | ★★ | M | Werte pro Filament hinterlegen und beim Druck automatisch anwenden. |
| 4.5 | **Trocknungs-Tracking** | ★ | S | Pro Spule „zuletzt getrocknet"-Datum + Warnung bei feuchtem Material. |
| 4.6 | **Spulen-Restgewicht-Kalibrierung** | ★★ | S | Leergewicht je Spulentyp hinterlegen → echtes Restgewicht statt nur Prozent. |
| 4.7 | **Filament-Lagerzeit-Warnung** | ★ | S | Anbruch-/Ablaufdatum je Spule; Warnung bei zu langer Lagerung. |

## Säule 5 — Steuerung & Hardware

Die Farm werkstatttauglich bedienen — aus der Ferne und mit echter Hardware.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 5.1 | **Kiosk-/Wand-Display** | ★★★ | S | Vollbild-Statusansicht (Queue + Regal + Kamera) für einen Werkstatt-Monitor. |
| 5.2 | **Physischer NOT-AUS** | ★★★ | M | GPIO-/USB-Taster, der die Farm hart pausiert und alle Geräte deaktiviert. |
| 5.3 | **NFC/RFID-Spulen-Tags** | ★★ | M | Spule antippen → Filament sofort einem AMS-Fach zuordnen. |
| 5.4 | **Makro-Pad / Hardware-Buttons** | ★ | M | Physische Tasten (GPIO/Stream-Deck) für Start/Pause/NOT-AUS/Snapshot. |

## Säule 6 — Integration & Auswertung

Daten rein und raus — Anbindung an Werkzeuge, die schon im Einsatz sind.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 6.1 | **Offene REST-/Webhook-API** | ★★★ | M | Farm steuern & Status abrufen von außen; Events als Webhook (z. B. an ERP/Lager). |
| 6.2 | **Home Assistant / MQTT-Bridge** | ★★ | M | Farm-Status publizieren, in bestehende Dashboards/Automationen einbinden. |
| 6.3 | **Report-Export (CSV/PDF)** | ★★ | S | Job-Historie, Verbrauch, Kosten, Auslastung exportieren. |
| 6.4 | **Status-Report (Push/E-Mail)** | ★★ | S | Periodische Zusammenfassung: Jobs, Erfolgsrate, Verbrauch, Kosten, anstehende Wartung. |
| 6.5 | **Sequenz-/Profil-Sharing-Pakete** | ★ | S | Sequenzen, Filament-Presets & Regal-Layouts als importierbare Datei exportieren (wie die Sprachpakete). |
| 6.6 | **Wartungsintervall-Tracking** | ★ | S | Erinnerung nach X Druckstunden/Jobs (Düse, Riemen, Reinigung). |
| 6.7 | **Prometheus-/Metriken-Endpoint** | ★ | S | Farm-Kennzahlen als Prometheus-Format → Grafana-Dashboards ohne Cloud. |
| 6.8 | **Automatische Backups** | ★★ | S | Zeitgesteuertes Backup der kompletten Konfiguration (lokal), mit Aufbewahrung der letzten N. |

## Säule 7 — Bedienung & Auswertung

Qualitätsmerkmale, die den Alltag spürbar erleichtern.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 7.1 | **3MF-Thumbnails in Queue & Job** | ★★ | M | Eingebettetes Vorschaubild in Warteschlange, Planer und Fach-Belegung. |
| 7.2 | **Ausschuss-Quote pro Datei** | ★★ | S | Welche Dateien scheitern überdurchschnittlich oft → gezielt nachbessern. |
| 7.3 | **Auslastungs-Heatmap** | ★ | S | Drucklast nach Wochentag/Stunde → Planung von Wartung & Betrieb. |
| 7.4 | **Job-Notizen & Kommentare** | ★ | S | Freitext je Job/Auftrag (Kundenhinweis, Sonderbehandlung). |

---

## Technisches Fundament

- **WebSocket-Live-Kanal** statt 5-s-Polling — geringere Latenz, weniger Last, Grundlage
  für Watchdog (1.1) und Kiosk-Display (5.1).
- **Snapshot-Pipeline** sauber kapseln (einmal greifen, mehrfach nutzen: 1.4, 1.5, 6.4).
- **Geräte-Adapter-Schicht** für Steckdosen/Sensoren/Tags (3.1, 5.3) — ein Interface,
  mehrere Backends (HA, Tasmota, Shelly, GPIO).
- **Verbrauchs-/Historien-Datenmodell** vereinheitlichen (speist 2.2, 3.4, 4.1, 6.3).

---

*Priorisierungs-Empfehlung:* **Säule 1 zuerst** — ohne Ausfallschutz ist der unbeaufsichtigte
Betrieb das größte Risiko. Danach **Säule 3 (Energie)**, sobald die Steckdosen-Adapterschicht
steht — sie zahlt sich im Dauerbetrieb direkt aus. Säule 2 ist bereits zu großen Teilen live.
