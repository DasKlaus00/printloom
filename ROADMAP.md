# Printloom — Roadmap

**Stand: v1.1.39** (25.10.2026). Die vorige Fassung stand auf v1.1.20; ihre
Phase 1 ist bis auf zwei Messungen erledigt (Tür, Magnet-Greifer, Versionsnummer im
Image, Zugangsdaten im Backup), Teile von Phase 2 ebenso.

Maßstab bleibt: **Was sagt printloom.alexsz.de zu, und hält die Software das?** Eine
Zusage, die die Software nicht einlöst, ist teurer als ein fehlendes Feature.

**Legende**
`⚡` klein, passt in ein Release · `🏗` strukturell, mehrere Releases ·
`🔒` blockiert (braucht eine Messung oder Entscheidung) · `📣` betrifft die Website

---

## Fundament — was steht (v1.1.39)

| Bereich | Stand |
|---|---|
| **Drucker** | EIN Bambu Lab pro Zyklus. Persistente MQTT-Verbindung, FTP-Upload, Modelle X1/X1C/X1E, P1P/P1S, A1/A1 mini, H2D; Drucker-Einstellungen + Kalibrierung aus Printloom |
| **OTTOeject** | Printloom erzeugt den G-code selbst; Achsprüfung vor dem Senden; Sequenz-Editor mit Einzelschritt-Test; Stresstest mit und ohne Drucker; Notaus sperrt jede Bewegung bis zur Freigabe |
| **Greifer** | Standard (seitlich klemmend) und Magnet-Greifer (seit v1.1.21, eigene Wege, Abkühlen als Sequenz-Schritt) |
| **Regal** | 1–10 Regale × 1–20 Fächer; alle Fächer = Lager oder oberstes Fach = Magazin |
| **Einrichten** | Setup-Assistent inkl. geführter Erstkalibrierung, jederzeit wieder aufrufbar (System) |
| **Farm** | Dauerbetrieb, höhenbasierte Fachwahl, Fehlerklassen mit eigener Strategie, Bergung nach Druckfehler, Zustand übersteht Neustart, Betriebszeiten, Einstellungen wirken live |
| **Kosten** | Strom (Smart-Plug) + Maschinenstunde + Material aus dem G-code-Header |
| **Oberfläche** | Startseite und Auto-Farm frei konfigurierbar; Hell/Dunkel/System |
| **Online** | Alles Opt-in: Update-Prüfung, Hinweise, Bibliothek. Diagnose-ZIP ohne Geheimnisse und Adressen |
| **Sicherheit** | Keine eigene Anmeldung (Reverse-Proxy davor). Kein CORS, schreibende Anfragen fremder Seiten gesperrt, Backup ohne Zugangsdaten (auf Wunsch verschlüsselt mit) |
| **Auslieferung** | Docker (amd64/arm64), native Windows-App, native Linux. Version im Image, Update aus der Oberfläche über den Docker-Socket, Promote-Workflow Beta → Stabil |
| **Qualität** | 677 Backend-Tests + 53 Frontend-Tests; Tests laufen vor jedem Image-Build und an jedem Pull Request |

---

## Als Nächstes — Farm-Ablauf

1. ⚡ **Fehlerstrategie „zurückstellen"** für `ams_unmatched`: Job ans Ende der
   Warteschlange, Farm läuft mit dem nächsten weiter. Heute nur pausieren,
   überspringen oder stoppen — nachts steht die Farm wegen einer falschen Farbe.
2. ⚡ **Reicht die Spule?** Gramm aus dem Slicer gegen die AMS-Restmenge VOR dem
   Start. Beide Zahlen liegen vor. `remain = -1` heißt unbekannt, nicht leer.
3. ⚡ **Überwachter Ordner (Hotfolder).** Datei landet im Ordner → in der Bibliothek.
   Der kürzeste Weg von OrcaSlicer zu Printloom.
4. 🏗 **Shop-Anbindung** nach `odoo-connector-plan.md` (Odoo zuerst, dann Shopify).

## Offene Messungen

1. 🔒 **Y-Tiefe der Kompakt-Halterung.** `y_engage` erbt den Standardwert; erst nach
   der Messung fällt das `soon`-Flag in `frontend/src/services/hardware.js`.
2. 📣 **Website: „Profile für Creality K1C, Elegoo Centauri Carbon …".** Für diese
   Drucker gibt es Geometrie-Vorlagen, aber keinen Treiber — Printloom steuert nur
   Bambu Lab. Textvorschlag: „Geometrie-Vorlagen für Creality K1C, Elegoo Centauri
   Carbon und weitere: Der Arm weiß, wo er greifen muss. Steuern und überwachen kann
   Printloom derzeit nur Bambu-Lab-Drucker."

## Ein Fremder kommt allein durch

1. ⚡ **Nach dem Einmessen ein echter Probelauf**: ein Wechsel, halbe Geschwindigkeit,
   Bestätigung nach jedem Schritt.
2. ⚡ **Fehlermeldungen mit Handlungsanweisung** — je Fehlerklasse ein Satz „so
   behebst du das".
3. ⚡ **Geometrie-Schreiben zentralisieren.** „Holen → ein Feld ändern →
   zurückschreiben" steht in Setup, Drucker-Tab und Erstkalibrierung; `putGeometry`
   ersetzt die ganze Datei. Ein Helfer, bevor eine Stelle sie leerschreibt.

## Mehr als ein Drucker, mehr als eine Marke

Größtes offenes Versprechen und größter Umbau — mit eigenem Design-Schritt davor.

1. 🏗 **Zyklus je Drucker.** `_farm` ist ein globaler Zustand mit EINEM Job.
2. 🏗 **Zweite Druckermarke** über Klipper/Moonraker — damit würden K1C und Centauri
   Carbon echte Ziele. Druckertreiber-Schnittstelle hinter `printer_models`.
3. ⚡ **Sequenz und Live-Status je Drucker**, „nimm den ersten Drucker"-Stellen umstellen.

## Material, Auswertung, Werkstatt

- ⚡ Verbrauch je Farbe und Marke; Spulen ohne RFID pflegen; AMS-Vorschau mit Ampel.
- ⚡ CSV-Export von Historie und Kosten; Kosten je Job im Backend statt nur im Browser.
- ⚡ Erfolgsquote je Drucker / Material / Fach; Durchsatz-Report.
- ⚡ Benachrichtigungen je Ereignis wählbar; Zeitraffer aus den Kamera-Schnappschüssen.
- ⚡ Webhooks, Home Assistant / MQTT.

---

## Laufend — beim Anfassen mitnehmen

- **52 stille `except Exception: pass`** loggen und neue per Test verbieten.
- **Start-Bundle 828 kB**: `changelog.js` (228 kB) und das englische Wörterbuch erst
  bei Bedarf nachladen.
- **Status über den WebSocket** statt 13 einzelner Timer.
- **16 React-Warnungen** (`exhaustive-deps`) beheben.
- **4–5 Playwright-Smoke-Tests** in die CI.
- **Große Dateien teilen**: `autofarm.py` (~4 150 Zeilen), `AutoFarm.jsx`,
  `Drucker.jsx`, `Configuration.jsx` — beim nächsten Feature im Bereich das Passende
  herausziehen, nicht auf einmal.

---

## Regeln, die in jeder Phase gelten

- **Jedes Feature bringt seine Tests mit** — mit der echten Datenform.
- **Keine neuen stillen `except`.** Behandeln oder loggen.
- **Kommentare erklären das WARUM.**
- **Version + zweisprachiger Changelog bei jedem Release.**
- **Eine Quelle je Zahl.** Zwei Speicher für dieselbe Größe laufen auseinander.
- **Die BEWEGUNG bemessen, nicht den Ruhezustand.** *(Lehrgeld v1.1.11)* Die Platte
  fährt ~25 mm höher ins Fach ein und wird abgesenkt — wer Platz plant, rechnet den
  Weg dorthin ein.
- **Unbekannt ist nicht Null.** *(Lehrgeld v1.1.19)* Was fehlt, wird benannt, nicht
  ersetzt.

## Bewusst nicht auf der Roadmap

- **Kein Zwang nach außen.** Jede Verbindung nach draußen bleibt Opt-in mit Hinweis.
  Keine Telemetrie, keine Funktion, die ohne Internet nicht mehr geht.
- **Keine eigene Benutzerverwaltung.** Anmeldung gehört an den Reverse-Proxy (z. B.
  authentik); Printloom sorgt dafür, dass man nicht an ihm vorbeikommt.
- **Keine Gimmicks.** Nur Funktionen, die einen Handgriff sparen oder einen Fehler
  verhindern.
- **Kein Auto-Anwenden heruntergeladener Inhalte.** Sequenzen und Profile bewegen
  Hardware: erst Vorschau, dann bewusste Übernahme.

---

Was fertig ist, wandert nicht in eine Erledigt-Liste, sondern in die Fundament-Tabelle
oben — so bleibt dieses Dokument kurz und beschreibt immer den nächsten Schritt.
