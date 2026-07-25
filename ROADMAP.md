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

## Phase 3 — Dauerbetrieb, dem man wegläuft

**Ziel:** Die Farm übersteht das, was in echt passiert: Neustart, Update, Stromausfall,
hängende Bewegung, Nutzer greift dazwischen.

**Fertig, wenn:** ein Neustart mitten im Zyklus die Farm nicht in einen unklaren Zustand
bringt.

1. 🏗 **Farm-Zustand überlebt den Neustart.** `_farm` liegt nur im Speicher; die
   Warteschlange wird gesichert, der laufende Zyklus nicht. Nach einem Container-Neustart
   (auch durch das **eigene In-App-Update**!) druckt der Drucker weiter, die Farm ist
   gestoppt. Zustand persistieren + beim Start erkennen: „Job X war in Schritt Y —
   fortsetzen / abbrechen / Platte bergen?"
2. 🏗 **Arm-Zustand kennen.** Nach einem Abbruch weiß Printloom nicht, ob eine Platte im
   Greifer liegt. Zustand mitschreiben (leer / Leerplatte / fertiger Druck) und beim
   Fortsetzen berücksichtigen — das ist die Ursache für die meisten Bergungs-Handgriffe.
3. ⚡ **Hängende Bewegung erkennen.** Moonraker-Aufruf ohne Fortschritt → Zeitlimit,
   Parken, klare Meldung statt endlosem Warten.
4. ⚡ **HMS-Historie.** Fehler werden live erkannt und gemeldet, aber nicht durchsuchbar
   gesammelt. Liste mit Zeit, Code, Klartext und was geholfen hat.
5. ⚡ **Ereignis-Zeitleiste je Job.** Was passierte wann (Start, Griff, Auswurf,
   Einlagern, Fehler) — mit Bezug zu den Schnappschüssen.
6. ⚡ **Fehlerstrategie pro Fehlerklasse.** Heute global; sinnvoll unterschiedlich für
   „Druck fehlgeschlagen", „kein Fach frei", „Klipper weg", „HMS kritisch".
7. ⚡ **Notaus-Zustand.** Nach Notaus sauber wieder anlaufen (Referenzfahrt erzwingen,
   Fach-Buchhaltung prüfen), statt dass der Nutzer raten muss.

---

## Phase 4 — Mehrere Drucker & unterschiedliche Regale 🏗

**Ziel:** Die strukturelle Erweiterung. Mehrere Drucker und Regale in einer Linie, ein
OTTOeject bedient alles. Das ist die Phase, für die du den Design-Entwurf wolltest.

**Fertig, wenn:** zwei Drucker gleichzeitig laufen, die Warteschlange sich selbst
verteilt und der Arm die Stationen konfliktfrei abarbeitet.

**Voraussetzung:** Phase 3 (ohne verlässlichen Zustand skaliert nichts).

1. 🏗 **Layout-Modell.** Module (Drucker / Regal / Home-Anker) auf einer X-Schiene, jedes
   mit eigener X-Referenz — statt der heutigen Abstands-Formel. Racks dürfen
   unterschiedlich sein (eigene Fachzahl/-höhe je Regal).
2. 🏗 **Migration ohne Positionsänderung.** Bestehende Installation (Formel-Geometrie,
   gleiche Racks) muss automatisch in ein äquivalentes Layout überführt werden.
3. ⚡ **Lock-Schalter.** Layout standardmäßig gesperrt, Entsperren mit Bestätigung, bei
   laufender Farm zwangsgesperrt — falsche X-Werte sind Crash-Gefahr.
4. 🏗 **Geometrie und Sequenz je Drucker.** Heute global. Braucht auch die 14 Stellen im
   Backend, die den Drucker per „nimm den ersten" holen.
5. 🏗 **Job-Verteilung.** Freier Drucker mit passendem Material/Höhe bekommt den nächsten
   Job; Fächer im zugehörigen Regal.
6. 🏗 **Der Arm als geteilte Ressource.** Werden zwei Drucker gleichzeitig fertig, muss
   jemand entscheiden, wer zuerst bedient wird — eine Warteschlange für Arm-Aufträge.
7. ⚡ **Übersicht.** Status je Drucker nebeneinander, dazu wer als nächstes bedient wird.

---

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
