# Printloom — Roadmap

**Stand: v1.0.163** · Neu aufgesetzt, weil die alte Roadmap (10 Phasen × 10 Features,
Stand v1.0.98) zu großen Teilen abgearbeitet ist und die Reihenfolge nicht mehr passt.

Diese Version ist **nach Abhängigkeit sortiert, nicht nach Themengebiet**: jede Phase
baut auf der vorherigen auf, und jede ist für sich ausrollbar. Das Leitziel bleibt das,
was du vorgegeben hast:

> Die Software soll auf möglichst viele zugeschnitten sein, einfach zu konfigurieren und
> zu benutzen — **nichts vermischt, ohne viele Fehler**.

**Legende**
`⚡` klein, passt in ein Release · `🏗` strukturell, mehrere Releases ·
`🔒` blockiert (braucht eine Info oder Messung von dir) · `↩` bewusst verschoben

---

## Fundament — was steht (v1.0.163)

Damit die Phasen nicht ins Blaue planen, hier der reale Unterbau:

| Bereich | Stand |
|---|---|
| **Drucker** | EIN Bambu Lab pro Installation. Persistente MQTT-Verbindung, FTP-Upload, Modell am Gerät (X1/X1C/X1E, P1P/P1S, A1/A1 mini, H2D), Drucker-Einstellungen + Kalibrierung aus Printloom |
| **OTTOeject** | Printloom kennt ALLE Koordinaten und erzeugt den G-code selbst; Achsprüfung vor dem Senden; Sequenz-Editor mit Einzelschritt-Test; Geräte-Macros optional |
| **Regal** | 1–10 Racks × 1–20 Fächer, Rack-X per Formel + Δ je Regal; zwei Bauarten (Magazin oder alle Fächer = Lager, dort Leerplatten je Fach markiert) |
| **Farm** | Dauerbetrieb, Höhen-basierte Fachwahl, Fehlerstrategien, First Start, Betriebszeiten, Magazin-Gate, Crash-Check im G-code |
| **Kamera** | X1 per RTSPS, P1/A1 per Port-6000-Protokoll, EIN geteilter Hub je Drucker; externe + Home-Assistant-Kamera |
| **Online** | Alles Opt-in mit Zustimmungsdialog: Update-Prüfung, Hinweise, Bibliothek (eigener Tab). Diagnose-ZIP mit Redaction |
| **Betrieb** | Docker + native Windows-App (Tray/Installer), Backup/Restore, Web-Push + Telegram, Smart-Plug, PWA |
| **Qualität** | 203 Backend-Tests + 28 Frontend-Tests, laufen in CI bei jedem Push |

**Die drei größten Lücken daraus:** (1) nur ein Drucker, (2) ein Neustart mitten im
Zyklus verliert den Farm-Zustand, (3) das Einmessen der Positionen ist noch Handarbeit
mit Zahleneingabe.

---

## Phase 1 — Offene Enden schließen *(nächstes Release)*

**Ziel:** Nichts halb Fertiges mehr im Baum. Alles hier ist klein, bekannt und wurde
unterwegs bewusst geparkt.

**Fertig, wenn:** kein bekannter Defekt und keine „das mache ich später"-Stelle mehr
offen ist, die einen Nutzer treffen kann.

1. ⚡ **Tür-Standardwerte reparieren.** Mit den ausgelieferten Werten erzeugt „Tür
   schließen" X −176 / Y 612 — außerhalb jeder Achse (gefunden von der neuen Prüfung in
   v1.0.162). Bei Neuinstallation ist die Operation damit kaputt. 🔒 Braucht die echten
   Werte deines X1C (erster Fahrpunkt + Bogenradius).
2. ⚡ **Y-Tiefe der Kompakt-Halterung.** `y_engage` erbt aktuell den Standardwert.
   🔒 Braucht deine Messung.
3. ⚡ **Geometrie-Schreiben zentralisieren.** Das Muster „Geometrie holen → ein Feld
   ändern → zurückschreiben" liegt an drei Stellen. Ein Helfer, sonst überschreibt
   irgendwann einer die ganze Datei.
4. ⚡ **Übersetzungs-Lücken sichtbar machen.** Die deutschen Sätze SIND die Schlüssel —
   ein geändertes Komma lässt die englische Übersetzung still ausfallen. Skript, das
   alle `tr()`-Aufrufe einsammelt und Fehlende auflistet, als CI-Schritt.
5. ⚡ **Diagnose-Paket verschicken.** Der Server-Endpoint existiert schon, Printloom
   lädt bisher nur lokal herunter. Mit eigenem Schalter, eigenem Hinweis („dies
   **sendet** eine Datei"), Inhaltsvorschau und Anzeige des Support-Codes.
6. ⚡ **Zugangsdaten im Backup.** Liegen im Klartext in der Backup-Datei. Entweder beim
   Export weglassen (mit Hinweis „danach neu eintragen") oder mit Passwort verschlüsseln.
7. ⚡ **Stille Fehler hörbar machen.** Sehr viele `except Exception: pass`. Ein
   Debug-Schalter, der diese Stellen ins Log schreibt statt zu schweigen — spart im
   Support jedes Mal eine Fernsitzung.
8. ⚡ **Website nachziehen.** Bibliotheks-Einträge wieder einstellen und `index.json`
   prüfen; beim Beispiel-Hinweis `1.0.163` in `versions` ergänzen (oder leeren), sonst
   ist er unsichtbar.

---

## ~~Phase 2 — Einrichten ohne Rätselraten~~ ✅ *(v1.1.1)*

**Ziel:** Ein Fremder baut die Mechanik nach und kommt ohne Rückfragen zum ersten
erfolgreichen Wechsel. Das ist die Phase, die „auf möglichst viele zugeschnitten"
wirklich einlöst.

1. ~~**Einmess-Assistent statt Zahlenfelder.**~~ 📐 an jeder Positions-Karte:
   anfahren → mit Pfeilen (0,1–10 mm) justieren → „Hierher übernehmen". Jeder Jog
   läuft über `/control/ottoeject/jog` und wird vorher gegen die Achsgrenzen gerechnet.
2. ~~**Achsgrenzen automatisch anbieten.**~~ „⤓ Grenzen vom Gerät holen" jetzt auch im
   Setup-Assistenten.
3. ~~**Modell-Wissen wirklich nutzen.**~~ Vorlagen-Abgleich mit Warnung + Ein-Klick-
   Korrektur, Kalibrierung nur bei Modellen, die sie annehmen, `bed_mm`/`preset` in der
   Modell-Registry.
4. ~~**Bauart-Pakete.**~~ Modellwahl im Setup schreibt die passende Geometrie-Vorlage
   und nimmt bei offenen Druckern die Tür-Schritte aus der Sequenz.
5. ~~**Health-Check erweitern.**~~ +4 Punkte: Geometrie plausibel, Achsgrenzen bekannt,
   Sequenz vorhanden, leere Platten bereit.
6. ~~**Sprachwahl als erster Schritt** und **„Was ist neu"**~~ nach einem Update (bei
   Neuinstallation bewusst nicht).
7. ~~**Trockenlauf.**~~ `/autofarm/dry-run` spielt die Sequenz durch, ohne etwas zu
   senden — mit Ziel-Fach, Plattenquelle und Achsprüfung je Schritt.

**Nebenbei behoben:** der letzte Schritt des Setup-Assistenten war leer (Homing/Status
hingen seit v1.0.158 am Regal-Schritt).

---

## ~~Phase 3 — Dauerbetrieb, dem man wegläuft~~ ✅ *(v1.1.2)*

**Ziel:** Die Farm übersteht das, was in echt passiert: Neustart, Update, Stromausfall,
hängende Bewegung, Nutzer greift dazwischen.

1. ~~**Farm-Zustand überlebt den Neustart.**~~ `farm_state.json` wird bei jedem Schritt
   mitgeschrieben; beim Start meldet `/autofarm/recovery`, welcher Job bei welchem
   Schritt unterbrochen wurde. Fortgesetzt wird bewusst NICHTS von allein.
2. ~~**Arm-Zustand kennen.**~~ leer / Leerplatte / fertiger Druck inkl. Herkunftsfach,
   mitgesichert und in der Meldung sichtbar.
3. ~~**Hängende Bewegung erkennen.**~~ Eigener Fehlertyp `_MoveTimeout` mit
   einstellbarem Zeitlimit (Standard 180 s) statt nacktem httpx-Timeout.
4. ~~**HMS-Historie.**~~ `farm_hms.json` + Anzeige im Historie-Tab, inkl. der
   ignorierten Codes.
5. ~~**Ereignis-Zeitleiste je Job.**~~ Bestand bereits (`farm_timeline.json`), jetzt um
   die Fehler-Ereignisse aus 3.3/3.4 ergänzt.
6. ~~**Fehlerstrategie pro Fehlerklasse.**~~ Bestand bereits (6 Klassen), ergänzt um
   „Bewegung hängt".
7. ~~**Notaus-Zustand.**~~ Notaus / Force-Reset / Timeout setzen `needs_home` — die
   nächste Bewegung referenziert automatisch zuerst.

---

## ~~Phase 4 — Mehrere Drucker & unterschiedliche Regale~~ ✅ *(v1.1.3)*

**Ziel:** Die strukturelle Erweiterung. Mehrere Drucker und Regale in einer Linie, ein
OTTOeject bedient alles.

1. ~~**Layout-Modell.**~~ Module (Drucker / Regal / Home) auf einer X-Schiene.
   *Korrigiert in v1.1.8:* Die Module halten **keine eigenen X-Werte** mehr, sondern
   werden aus der Drucker-Geometrie abgeleitet (siehe Lehrgeld unten).
2. ~~**Positionen ändern sich nicht.**~~ Durch einen Test abgesichert, der G-code und
   Fach-Positionen vorher/nachher vergleicht.
3. ~~**Lock-Schalter.**~~ Bei laufender Farm blockiert (auch serverseitig).
4. ~~**Geometrie je Drucker.**~~ Drucker-X im Drucker-Tab, die eingemessenen Feinwerte
   bleiben erhalten. *(Sequenz je Drucker: siehe unten)*
5. ~~**Job-Verteilung.**~~ `job_dispatch.py` (rein, testbar): frei vor beschäftigt, dann
   kürzeste Warteschlange; feste Zuweisungen werden nie umgangen.
6. ~~**Der Arm als geteilte Ressource.**~~ `arm_access`-Sperre um jede Bewegung, mit
   Warteschlange und Anzeige, wer den Arm gerade hat.
7. ~~**Übersicht.**~~ Drucker nebeneinander in der Farm-Ansicht, inkl. Arm-Status.

**Lehrgeld (v1.1.8).** Das Layout bekam eine EIGENE X-Referenz je Modul, obwohl die
Δ-Korrektur je Regal im Drucker-Tab dasselbe schon konnte. Damit stand jede Position
zweimal in der App, gepflegt an zwei Stellen — und weil nur einer der beiden
Code-Pfade das Layout überlagerte, fuhr der Test-Knopf anders als die Farm. Seit
v1.1.8 gibt es eine Quelle (Geometrie), das Layout wird abgeleitet. Regel für alles
Weitere: **eine Zahl, ein Speicherort.**

8. ~~**Konfiguration je Modul.**~~ *(v1.1.9)* Die Geometrie hält jetzt einen Block
   **je Drucker** (`printers[]`) und **je Regal** (`rack_geo{}`) mit ABSOLUTEN
   Koordinaten. Damit gibt es einen zweiten Drucker mit eigenen Positionen, eigenem
   G-code je Operation und eigener Farm-Freigabe; Regale haben eigene X/Y/Fachhöhe/
   Fach-Abstand und eine Zuordnung zu einem Drucker. Der Drucker-Tab ist einspaltig
   mit der Schiene oben und einem ausklappbaren Abschnitt je Modul. *Vorher* war die
   Drucker-X eine Basis, die beim Fahren um `(Regale−1)·rack_x_gap` verschoben wurde:
   ein zusätzliches Regal verschob still den Drucker, und zwei Drucker gab es nicht.
   Ein Test hält fest, dass eine Bestandsanlage sich durch die Umstellung um keinen
   Millimeter verschiebt (`test_multi_printer.py`).

**Offen aus dieser Phase** (bewusst als eigener Schritt, weil es tief in den
Farm-Zyklus greift): **eine eigene Sequenz je Drucker** und **echte Parallelität**
(heute ein Zyklus zur Zeit — die Verteilung und die Arm-Sperre sind die
Voraussetzung dafür und stehen jetzt). Der Zyklus fährt seit v1.1.9 die Positionen
**des Druckers, mit dem er gestartet wurde** (`_farm_printer`) — die Konfiguration
für mehrere Drucker steht damit, es läuft nur noch einer zur Zeit.

---

## Phase 4b — Echte Parallelität *(nächster Schritt)*

**Ziel:** Zwei Drucker laufen wirklich gleichzeitig. Das Layout, die Job-Verteilung
und die Arm-Sperre aus Phase 4 sind die Voraussetzung — was fehlt, ist der Farm-Zyklus
selbst.

1. 🏗 **Zyklus je Drucker.** `_farm` ist ein globaler Zustand mit EINEM laufenden Job.
   Für echte Parallelität braucht es einen Lauf pro Drucker (`_farms[device_id]`), die
   sich über die vorhandene Arm-Sperre abwechseln.
2. 🏗 **Sequenz je Drucker.** Heute eine globale Sequenz; mit unterschiedlichen Modellen
   (Tür / keine Tür) gehört sie ans Drucker-Modul.
3. ⚡ **Status je Drucker im Live-Kanal.** Der WebSocket pusht heute einen Farm-Zustand;
   mit mehreren Läufen muss er sie einzeln ausweisen.
4. ⚡ **Die 14 „nimm den ersten Drucker"-Stellen** im Backend auf das Modul umstellen.

## Phase 5 — Material & AMS zu Ende gedacht

**Ziel:** Kein Druck startet mit dem falschen oder zu wenig Filament. Der Abgleich
(Material + Farbe) funktioniert, die Buchhaltung fehlt noch.

1. ⚡ **Restmengen-Abgleich.** „Reicht die Spule für diesen Job?" (Gramm aus dem Slicer
   gegen AMS-Restmenge) — mit Warnung statt Abbruch mitten im Druck.
2. ⚡ **Slots ohne RFID pflegen.** Generic-Spulen melden nichts; manuelle Belegung, die
   der Abgleich mitbenutzt.
3. ⚡ **AMS-Vorschau vor dem Start.** Je Slicer-Filament der gewählte Slot mit Ampel
   (exakt / ähnlich / fehlt), bestätigbar.
4. ⚡ **Material-Profile.** Marke/Typ/Temperaturen/Trockenstatus zentral, an Dateien
   hängbar.
5. ⚡ **Verbrauch mitschreiben** je Farbe/Marke — Grundlage für Phase 7 und für
   Nachbestell-Hinweise.

---

## Phase 6 — Sehen, was passiert

**Ziel:** Aus der Ferne verstehen, was die Farm tut, ohne im Log zu suchen.
Web-Push und Telegram gibt es; es fehlt die Tiefe.

1. ⚡ **Benachrichtigungen je Ereignis wählbar** (Start / Ende / Fehler / Filament /
   Magazin leer) statt alles oder nichts — pro Kanal.
2. ⚡ **Zeitraffer je Job** aus den Schnappschüssen des Kamera-Hubs (die Infrastruktur
   liegt schon da).
3. ⚡ **Live-Overlay im Bild**: Schicht, Prozent, Restzeit, Temperaturen.
4. ⚡ **Vorher/Nachher am Fach.** Zu jedem eingelagerten Druck das Bild, das beim
   Auswerfen entstand — Fehldrucke findet man dann ohne Suchen.
5. ⚡ **Zweite Kamera** aufs Regal/den Arm, im Hub mitgeführt.

---

## Phase 7 — Auswerten & Kosten

**Ziel:** Die Zahlen, die man für „lohnt sich das?" braucht. Echte Druckzeiten und
Energie werden schon gesammelt.

1. ⚡ **Kosten je Job/Teil** (Material + Strom + Maschinenstunde) mit hinterlegten Preisen.
2. ⚡ **Erfolgsquote & Fehlerstatistik** je Drucker/Material/Fach.
3. ⚡ **Durchsatz-Report** (Teile/Tag, Druckstunden, Auslastung).
4. ⚡ **Export als CSV.**
5. ⚡ **Verbrauchsprognose** → Nachbestell-Hinweis (nutzt Phase 5.5).

---

## Phase 8 — Von der Datei zum Auftrag

**Ziel:** Serienfertigung ohne Zettel. Projekte/Chargen und die Bibliothek gibt es;
was fehlt, ist der Weg von „Bestellung" zu „liegt fertig im Regal".

1. ⚡ **Stücklisten (SKU aus mehreren Teilen)** → ein Klick reiht alles ein.
2. ⚡ **Mehrere Plates/Varianten je Teil** (unterschiedliche Materialien/Anordnungen).
3. ⚡ **Lagerbestand fertiger Teile** — was liegt im Regal, was ist raus.
4. ⚡ **Aufträge** mit Positionen und Status (offen / druckt / fertig).
5. ⚡ **Duplikate-Erkennung beim Upload** (Hash) und **Datei-Versionierung** mit Rückrollen.
6. ↩ **Shop-Anbindung** (Etsy/Shopify) — erst wenn Aufträge stehen, und nur als Opt-in
   nach den Regeln der Online-Dienste.

---

## Phase 9 — Andocken lassen

**Ziel:** Printloom in eine bestehende Werkstatt einbinden — ohne Zwang, ohne Cloud.

1. ⚡ **Slicer-Hotfolder.** Ordner überwachen → Datei landet in der Bibliothek. Der
   kürzeste Weg von OrcaSlicer zu Printloom.
2. ⚡ **Webhooks** bei Start/Ende/Fehler für eigene Automatisierungen.
3. ⚡ **Home Assistant / MQTT**: Status raus, einfache Steuerung rein (Kamera-Proxy gibt
   es schon).
4. ⚡ **Öffentliche REST-API + API-Keys** — mit Zugriffsschutz, nicht offen.
5. ⚡ **Mehrbenutzer & Rollen** und eine **HTTPS/Reverse-Proxy-Anleitung** (spätestens
   nötig, sobald mehr als eine Person zugreift).
6. ⚡ **Weitere Sprachen** über die Bibliothek (Sprachpakete laufen schon darüber).

---

## Dauerlauf — läuft in jeder Phase mit

Kein eigener Zeitpunkt, sondern Regeln. Am Ende wird sowas nie gemacht.

- **Jedes Feature bringt seine Tests mit.** Besonders alles, was Hardware bewegt oder
  eine Zusage einlöst (Opt-in, Redaction). Die Suite ist bei 203 + 28 — das soll mit
  jedem Release wachsen, nicht in einem Nachholprojekt.
- **Große Dateien beim Anfassen teilen.** `autofarm.py` (~3000 Zeilen) und `printer.py`
  (~1600) funktionieren, machen aber jede Änderung riskanter. Nicht auf einmal umbauen —
  beim nächsten Feature im Bereich das Passende herausziehen (wie bei `rack_logic.py`).
- **Keine neuen stillen `except`.** Entweder behandeln oder loggen.
- **Kommentare erklären das WARUM.** Das ist die Stärke dieser Codebasis und hat mehrfach
  Zeit gespart — beibehalten.
- **Version + zweisprachiger Changelog bei jedem Release.**

---

## Bewusst nicht auf der Roadmap

- **Kein Zwang nach außen.** Jede Verbindung zu einem Server außerhalb des Netzwerks
  bleibt Opt-in mit Hinweis vor der Aktivierung. Keine Telemetrie, keine Analytik, keine
  Funktion, die ohne Internet nicht mehr geht.
- **Keine Fernsteuerung der Farm von außen** und keine Cloud-Pflicht.
- **Keine Gimmicks.** Nur Funktionen, die einen Handgriff sparen oder einen Fehler
  verhindern. Meilensteine/Spielereien wurden schon einmal bewusst wieder entfernt.
- **Kein Auto-Anwenden heruntergeladener Inhalte.** Sequenzen und Profile bewegen
  Hardware: erst Vorschau, dann bewusste Übernahme.

---

## Wie das benutzt wird

Eine Phase zur Zeit, in Reihenfolge. Innerhalb einer Phase entscheidet der Nutzen, nicht
die Nummer. Phase 1 und 2 sind zusammen ein realistisches Ziel für die nächsten Releases,
Phase 4 ist ein eigenes Vorhaben mit vorgeschaltetem Design-Schritt.

Was fertig ist, wandert nicht in eine Erledigt-Liste, sondern in die Fundament-Tabelle
oben — so bleibt dieses Dokument kurz und beschreibt immer den nächsten Schritt.
