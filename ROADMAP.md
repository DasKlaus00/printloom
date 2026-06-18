# Printloom — Roadmap (Neuausrichtung)

> **Leitprinzipien:** Alles läuft lokal & offline-fähig — keine Cloud-Pflicht, keine
> externe KI-Abhängigkeit. Diese Roadmap setzt **nach** dem soliden Fundament an
> (Auto-Farm-Dauerbetrieb, dynamische Fachzuweisung, Teile-Bibliothek, AMS-Match,
> i18n, importierbare Sprachpakete) und öffnet **komplett neue Richtungen**:
> sehen statt raten, planen statt abarbeiten, und die Farm zum Greifen nah machen.

Legende: **Wert** ★ (1–3, Nutzen im Farm-Betrieb) · **Aufwand** S/M/L

---

## 🧭 Sechs neue Säulen

### Säule A — Digital Twin & 3D-Visualisierung

Heute ist das Regal eine Kachel-Liste. Eine räumliche Echtzeit-Ansicht macht den
Farm-Status auf einen Blick begreifbar — und sieht auf einem Werkstatt-Display gut aus.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| A.1 | **3D-Echtzeit-Szene** | ★★★ | L | Drucker + OTTOeject + Regal als interaktives 3D-Modell (Three.js, rein clientseitig), Fachbelegung live eingefärbt. |
| A.2 | **Animierter Auswurf-Zyklus** | ★★ | M | Den laufenden Eject-/Einlagerungs-Schritt im 3D-Modell mitlaufen lassen — sofort sichtbar, was die Sequenz gerade tut. |
| A.3 | **Regal-Heatmap** | ★★ | S | Visualisiert, welche Fächer wie oft/lange belegt waren → Engpässe und tote Ecken erkennen. |
| A.4 | **„Teil finden"-Modus** | ★ | M | Fertiges Teil suchen → das zugehörige Fach blinkt in der 3D-Szene und (optional) per Handy-Kamera-Overlay. |

### Säule B — Intelligente Queue & Planung *(lokal, regelbasiert)*

Aus „Liste abarbeiten" wird „klug planen" — ganz ohne Cloud-KI, nur aus eigener Historie
und einfachen Heuristiken.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| B.1 | **Smart-Sortierung** | ★★★ | M | Jobs nach Material/Farbe gruppieren → minimiert AMS-Wechsel und Filament-Verschwendung. |
| B.2 | **Echte Restzeit-Prognose** | ★★★ | M | Verbleibende Druckzeit aus tatsächlicher Historie statt Slicer-Schätzung (lernt pro Datei/Drucker). |
| B.3 | **Was-wäre-wenn-Planer** | ★★ | M | Queue-Reihenfolge simulieren und voraussichtliche Endzeit/Regalauslastung sehen, bevor man startet. |
| B.4 | **Auto-Nesting auf Platte** | ★★ | L | Mehrere kleine Teile automatisch zu einer Platte bündeln (eine Druck-/Auswurf-Runde statt vieler). |
| B.5 | **Tag/Nacht-Profile** | ★ | S | Leise/langsame Jobs nachts, laute tagsüber — Zeitfenster pro Job-Eigenschaft. |

### Säule C — Energie & Nachhaltigkeit

Dauerbetrieb kostet Strom. Sichtbar machen, optimieren, automatisch abschalten.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| C.1 | **Smart-Plug-Integration** | ★★★ | M | Tasmota/Shelly/HA-Steckdose auslesen → echter Stromverbrauch je Job statt Schätzung. |
| C.2 | **Auto-Abschaltung im Leerlauf** | ★★★ | M | Drucker/Kammerlicht/Lüftung nach X Minuten ohne Job stromlos schalten (über C.1). |
| C.3 | **Off-Peak-Planung** | ★★ | S | Druckstart an Stromtarif-Fenster koppeln (günstige Zeiten zuerst). |
| C.4 | **Kosten- & CO₂-Dashboard** | ★★ | S | Strom + Filament → Kosten/CO₂ pro Druck, Tag, Woche; lokal berechnet. |
| C.5 | **Intelligenter Vorlauf** | ★ | S | Bett/Düse erst rechtzeitig vor Job-Start vorheizen statt dauerhaft warm halten. |

### Säule D — Kalibrierung & Materialwissen

Bessere Drucke + weniger Fehlschläge durch gepflegtes Material-Know-how — pro Spule.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| D.1 | **Geführter Kalibrier-Assistent** | ★★★ | L | Flow, Pressure Advance, Temp-Tower Schritt für Schritt; Ergebnisse direkt speichern. |
| D.2 | **Kalibrierwerte je Spule/Marke** | ★★ | M | Werte pro Filament hinterlegen und beim Druck automatisch anwenden. |
| D.3 | **Erste-Schicht-Ampel** | ★★ | M | Kamera-Snapshot nach Layer 1 → grün/gelb/rot; bei rot optional pausieren + Push. |
| D.4 | **Trocknungs-Tracking** | ★ | S | Pro Spule Trockner-Timer & „zuletzt getrocknet"-Datum, Warnung bei feuchtem Material. |

### Säule E — Steuerung & physische Eingabe

Die Farm aus der Ferne und mit echter Hardware bedienen — werkstatttauglich.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| E.1 | **Wand-Display / Kiosk-Modus** | ★★★ | S | Vollbild-Statusansicht (3D-Szene aus A.1 + Queue + Kamera) für einen Werkstatt-Monitor. |
| E.2 | **NFC/RFID-Spulen-Tags** | ★★ | M | Spule antippen → Filament sofort einem AMS-Fach zuordnen (günstige NFC-Tags). |
| E.3 | **Makro-Pad / Hardware-Buttons** | ★★ | M | Stream-Deck-/GPIO-Tasten für Start/Pause/NOT-AUS/Snapshot. |
| E.4 | **Physischer NOT-AUS** | ★★ | M | GPIO-/USB-Taster, der die Farm hart pausiert und alle Geräte deaktiviert. |
| E.5 | **Offline-Sprachsteuerung** | ★ | L | Lokales Wake-Word + Kommandos („Pause Farm", „Status") ohne Cloud. |

### Säule F — Erlebnis, Feedback & Teilen *(lokal)*

Die Farm soll sich gut anfühlen — und Wissen lässt sich teilen wie die Sprachpakete.

| Nr. | Feature | ★ | Aufwand | Beschreibung |
|-----|---------|---|---------|--------------|
| F.1 | **Timelapse je Druck** | ★★ | M | Aus Kamera-Snapshots ein Zeitraffer mit Overlay (Job, Layer, Zeit), lokal gerendert. |
| F.2 | **Sequenz-/Profil-Sharing-Pakete** | ★★ | S | Sequenzen, Filament-Presets & Regal-Layouts als importierbare Datei exportieren — analog zu den Sprachpaketen. |
| F.3 | **Wöchentlicher Digest** | ★★ | S | Zusammenfassung (Jobs, Erfolgsrate, Verbrauch, Kosten) per Push/Telegram/E-Mail. |
| F.4 | **Sound-Pakete & Ansagen** | ★ | S | Akustisches Feedback bei Start/Ende/Fehler; austauschbare Sound-Sets. |
| F.5 | **Meilenstein-System** | ★ | S | Achievements (1000 h gedruckt, 500 Jobs, längste Fehlerfrei-Serie) als nette Motivation. |

---

## Technisches Fundament für diese Roadmap

- **WebSocket-Live-Kanal** statt 5-s-Polling — Grundlage für die flüssige 3D-Szene (A) und
  Echtzeit-Events (E.1, E.3).
- **Snapshot-/Frame-Pipeline** sauber kapseln (einmal greifen, mehrfach nutzen: D.3, F.1).
- **Geräte-Adapter-Schicht** für Steckdosen/Sensoren/Tags (C.1, E.2) — ein Interface,
  mehrere Backends (HA, Tasmota, Shelly, GPIO).
- **Verbrauchs-/Historien-Datenmodell** vereinheitlichen (speist B.2, C.4, F.3).
- **Export-/Import-Framework verallgemeinern** — der Sprachpaket-Mechanismus wird zur
  generischen Paket-Schicht (F.2).

---

*Priorisierungs-Empfehlung:* **Säule B (Intelligente Planung) zuerst** — bringt sofort
spürbaren Nutzen ohne neue Hardware und nutzt vorhandene Daten. Parallel **A.1 + E.1**
(3D-Szene im Kiosk-Modus) als sichtbares Aushängeschild. **Säule C (Energie)** direkt
danach, sobald die Steckdosen-Adapterschicht steht — sie zahlt sich im Dauerbetrieb
schnell aus.
