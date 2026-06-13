# Printloom — Roadmap

> **Leitprinzipien:** Alles läuft lokal & offline-fähig — keine Cloud-Pflicht, keine
> externe KI-Abhängigkeit. Priorität hat **unbeaufsichtigter, sicherer Dauerbetrieb**
> und ein Werkzeug, das vom Einzel-Maker bis zur kleinen Druckerei mitwächst.

Legende: **Wert** ★ (1–3, Nutzen im Farm-Betrieb) · **Aufwand** S/M/L

---

## ✅ Bereits umgesetzt (Stand v0.9.4)

**Neu in v0.9.x:**
- **Themes** — umschaltbares Farbschema (Dunkel · Slate · Mitternacht · Hell) über die
  gesamte Oberfläche, pro Gerät gespeichert
- **Kamera-Fenster in AutoFarm** — Live-Bild (eingebaute X1C-Kamera oder MJPEG-Webcam)
  direkt neben dem Ablauf
- **X1C-Kamera robust** — echtes Bild statt Schwarz: erstes Frame vor Stream-Start,
  klare Fehlerursache im UI, Kammerlicht-Steuerung
- **Korrekte Fach-Anzeige** — kein falsches „Regal voll" mehr bei laufender Farm
  (dynamische Fachzuweisung zur Laufzeit, Pause nur bei echtem Platzmangel)

**Fundament:**
- Auto-Farm-Dauerbetrieb: persistente Queue, Pause/Resume, Live-Status, Sequenz-Engine
  (First Start + frei editierbarer Zyklus), Vorpositionierung ~1 Min vor Druckende
- **Dynamische Fachzuweisung** inkl. Höhen-Clearance, „Regal voll"-Pause, Magazin-System
- Höhenanalyse aus .3mf/.gcode mit Sicherheitsmarge; **AMS-Auto-Match** (Material zählt,
  Farbe blockiert nicht); **HMS-Soft-Liste** (unkritische Meldungen stoppen nicht)
- Multi-Plate-Auswahl, Queue-Templates, Filament-Presets + Bambu-Katalog (80+)
- Druckstatistiken, Auslastungs-Timeline, persistentes Log, Telegram + Web-Push (PWA)
- Profile (Export/Import), Setup-Assistent, i18n (DE/EN), Simulator, Backup/Restore
- Privacy-Härtung, robuste Versionsanzeige + Watchtower-Auto-Update

---

## 🧭 Weiterer Plan — 6 Phasen

### Phase 1 — Teile-Management & Organisation  *(höchste Priorität)*

Aktuell ist die Datei-Bibliothek eine flache Liste. Für ernsthafte Nutzung braucht es
Struktur — wie bei Printago & Co.: Ordner, Teilenummern, Suche.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 1.1 | **Ordnerstruktur** | ★★★ | M | Verschachtelte Ordner mit Breadcrumb-Navigation, Verschieben per Drag & Drop, „Neuer Ordner". |
| 1.2 | **Teilenummern / SKU** | ★★★ | M | Pro Teil eine eindeutige Nummer + Beschreibung/Notiz; durchsuchbar, im Auftrag referenzierbar. |
| 1.3 | **Volltext-Suche & Filter** | ★★★ | S | Suche über Name, Teilenummer, Tag, Material; Filter nach Typ/Datum/Ordner. |
| 1.4 | **Tags & Sammlungen** | ★★ | S | Frei vergebbare Schlagwörter („Kunde X", „Prototyp", „Serie") quer über Ordner. |
| 1.5 | **3MF-Thumbnails** | ★★ | M | Eingebettetes Vorschaubild in Liste, Queue, Fach-Belegung und Auftrag. |
| 1.6 | **Bulk-Aktionen** | ★★ | S | Mehrfachauswahl: verschieben, taggen, löschen, in Queue legen. |
| 1.7 | **Versionierung von Teilen** | ★ | M | Mehrere Datei-Revisionen pro Teil mit Verlauf (v1, v2 …) + „aktuell"-Markierung. |

### Phase 2 — Sicherheit & Ausfallschutz

Ohne diese Punkte ist „unbeaufsichtigt" riskant.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 2.1 | **Watchdog & Auto-Recovery** | ★★★ | M | Erkennt MQTT-Abriss / Klipper-Disconnect / hängende Drucke → reconnect, pausieren, alarmieren. |
| 2.2 | **Kamerabasierte Fehlbild-Erkennung** | ★★★ | L | Snapshots auf Spaghetti/Ablösung prüfen → pausieren + Push mit Bild. Erst regelbasiert, optional lokales Modell. |
| 2.3 | **Aktive Filament-Runout-Erkennung** | ★★ | M | Leerstand/Runout aus MQTT/AMS → pausieren statt Fehldruck. |
| 2.4 | **Konfigurierbare Fehlerstrategie** | ★★ | M | Pro Fehlerfall: Retry × / Job überspringen / Farm pausieren / Drucker parken. |
| 2.5 | **Snapshot pro Job-Phase** | ★★ | S | Auto-Snapshot bei Start/Ende/Fehler, im Job- & Log-View + an Push/Telegram. |

### Phase 3 — Aufträge & Geschäftsbetrieb

Damit wird aus dem Farm-Controller ein Auftrags-Werkzeug — relevant für Druckereien.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 3.1 | **Auftrags-Management** | ★★★ | L | Aufträge mit Kunde, Teilen (SKU + Menge), Status (offen→Druck→fertig→versandt), Fälligkeit. |
| 3.2 | **Kundenverwaltung** | ★★ | M | Kunden-Stammdaten, Auftragshistorie, Kontakt. |
| 3.3 | **Queue-Prioritäten & Termine** | ★★ | S | Hoch/Normal/Niedrig + Liefertermin → automatische Reihenfolge. |
| 3.4 | **Barcode / QR pro Teil & Auftrag** | ★★ | M | Etikett drucken/scannen → Teil oder Auftrag sofort öffnen / als entnommen buchen. |
| 3.5 | **Liefer-/Rechnungsbeleg (PDF)** | ★ | M | Aus Auftrag einen Lieferschein/Beleg erzeugen (lokal, ohne Cloud). |
| 3.6 | **Self-Service-Upload-Portal** | ★ | L | Optionaler lokaler Link, über den Kollegen/Kunden Dateien einreichen (mit Freigabe). |

### Phase 4 — Auswertung, Kosten & Material

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 4.1 | **Filamentverbrauch-Tracking** | ★★ | M | Gramm/Länge je Job aus Druckerdaten, summiert pro Filament/Projekt/Auftrag. |
| 4.2 | **Materialbestand & Nachbestell-Warnung** | ★★ | M | Spulen-Inventar mit Restmenge; Warnung unter Schwelle (optional Spoolman-Anbindung). |
| 4.3 | **Kostenschätzung & Kalkulation** | ★★ | S | Filament + Strom + Maschinenzeit → Kosten/Preis pro Druck und Auftrag. |
| 4.4 | **Erfolgsraten-Trend & Fehlerursachen** | ★ | S | Verlauf der Erfolgsquote, häufigste HMS-/Fehlercodes. |
| 4.5 | **Report-Export (CSV/PDF)** | ★ | S | Job-Historie, Verbrauch, Kosten, Auslastung exportieren. |

### Phase 5 — Skalierung & Flotte

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 5.1 | **Mehrere Drucker** | ★★★ | L | Mehrere X1C konfigurieren (Datenmodell trägt es bereits). |
| 5.2 | **Job-Verteilung / Load-Balancing** | ★★★ | L | Jobs automatisch auf freie/passende Drucker (Filament, Auslastung). |
| 5.3 | **Mehrere OTTOeject-Einheiten** | ★★ | L | Pro Drucker/Zelle ein Auswurfsystem + eigenes Regal. |
| 5.4 | **Flotten-Dashboard** | ★★ | M | Alle Drucker/Regale/Queues/Kameras auf einen Blick. |
| 5.5 | **Benutzer & Rollen (RBAC)** | ★★ | M | Mehrere Konten (Admin/Operator/Betrachter), Login, Berechtigungen. |
| 5.6 | **Audit-Log** | ★ | S | Wer hat was wann gestartet/gestoppt/geändert. |

### Phase 6 — Integration & Enterprise

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| 6.1 | **Offene REST-/Webhook-API** | ★★ | M | Farm steuern & Status abrufen von außen; Events als Webhook. |
| 6.2 | **Home Assistant / MQTT-Bridge** | ★★ | M | Farm-Status publizieren, in Smart-Home/Dashboards einbinden. |
| 6.3 | **Benachrichtigungs-Hub** | ★★ | S | Neben Telegram/Push auch Slack, MS Teams, E-Mail, Discord. |
| 6.4 | **Betriebszeit-Fenster & Auto-Start** | ★★ | S | Nur in bestimmten Zeiten drucken (Stromtarif/Ruhezeiten); Farm startet selbst bei Jobs. |
| 6.5 | **Wartungsintervall-Tracking** | ★ | S | Erinnerung nach X Druckstunden/Jobs (Düse, Riemen, Reinigung). |
| 6.6 | **Kamera-Timelapse** | ★ | M | Aus Job-Snapshots optional ein Zeitraffer-Video je Druck. |
| 6.7 | **Mandantenfähigkeit / SSO** | ★ | L | Mehrere getrennte Workspaces, Single-Sign-On (Enterprise). |

---

## Technische Schulden / interne Verbesserungen

- **WebSocket statt Polling** für Live-Status (geringere Latenz, weniger Last)
- **Backend-Persistenz vereinheitlichen** (Mix aus SQLite + vielen JSON-Dateien in `backend/db/`)
- **DB-Migrations-Mechanismus** (saubere Schema-Änderungen statt manueller ALTER-Logik) — wird mit Phase 1 nötig
- **i18n vervollständigen** (viele Strings noch hartkodiert deutsch); helle Themes feinschleifen
- **Automatisierte Tests** für Slot-/Höhenlogik, Sequenz-Engine, Teile-/Auftragsmodell

---

*Priorisierungs-Empfehlung:* **Phase 1 zuerst** — Ordner & Teilenummern bringen sofort
Ordnung in wachsende Bibliotheken und sind die Grundlage für Aufträge (Phase 3). Direkt
danach Phase 2 (Sicherheit) für echten unbeaufsichtigten Dauerbetrieb.
