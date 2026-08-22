# Printloom — Roadmap

**Stand: v1.1.20** · Neu aufgesetzt. Die vorige Fassung (Stand v1.0.163) war nach
Abhängigkeit sortiert und ist bis Phase 4 abgearbeitet; ihre Reihenfolge passt nicht
mehr, und sie stand im Arbeitsbaum gelöscht da.

Diese Fassung ist **nach Versprechen sortiert**. Maßstab ist nicht mehr „was baut auf
was auf", sondern:

> **Was sagt printloom.alexsz.de zu, und hält die Software das?**

Denn dort steht seit Kurzem, was Printloom kann — und eine Zusage, die die Software
nicht einlöst, ist teurer als ein fehlendes Feature. Wer wegen der Website kommt und
scheitert, kommt nicht wieder.

**Legende**
`⚡` klein, passt in ein Release · `🏗` strukturell, mehrere Releases ·
`🔒` blockiert (braucht eine Messung oder Entscheidung) · `📣` betrifft die Website

---

## Fundament — was wirklich steht (v1.1.20)

| Bereich | Stand |
|---|---|
| **Drucker** | EIN Bambu Lab pro Zyklus. Persistente MQTT-Verbindung, FTP-Upload, Modelle X1/X1C/X1E, P1P/P1S, A1/A1 mini, H2D; Drucker-Einstellungen + Kalibrierung aus Printloom |
| **OTTOeject** | Printloom kennt alle Koordinaten und erzeugt den G-code selbst; Achsprüfung vor dem Senden; Sequenz-Editor mit Einzelschritt-Test; Stresstest (Magazine leerräumen) |
| **Greifer** | Standard (seitlich klemmend). Magnet-Greifer gebaut, aber gesperrt — Bewegung nur in Z, Maße ungemessen |
| **Regal** | 1–10 Regale × 1–20 Fächer, X/Y/Z je Regal; zwei Bauarten (alle Fächer = Lager, oder oberstes Fach = Magazin) |
| **Einrichten** | Setup-Assistent in 7 Schritten inkl. **geführter Erstkalibrierung** (Anker → Magazin → äußerstes Regal → Drucker), Trockenlauf, Achsgrenzen vom Gerät |
| **Farm** | Dauerbetrieb, höhenbasierte Fachwahl, 7 Fehlerklassen mit eigener Strategie, Bergung nach Druckfehler, Zustand übersteht Neustart, Betriebszeiten, Einstellungen wirken live |
| **Kosten** | Strom (Smart-Plug) + Maschinenstunde + Material aus dem G-code-Header |
| **Oberfläche** | Startseite und Auto-Farm als frei konfigurierbare Raster; Startseite mit eigener Anordnung je Bildschirmbreite |
| **Online** | Alles Opt-in mit Zustimmung: Update-Prüfung, Hinweise, Bibliothek. Diagnose-ZIP mit Redaction |
| **Betrieb** | Docker (x86/ARM), native Windows-App, native Linux; Backup/Restore, Web-Push + Telegram, PWA |
| **Qualität** | 456 Backend-Tests + 45 Frontend-Tests, CI bei jedem Push |

---

## Phase 1 — Die Website einlösen *(nächstes Release)*

**Ziel:** Alles, was draußen steht, stimmt. Keine Zusage ohne Deckung.

**Fertig, wenn:** jemand die Website liest, Printloom installiert und nichts vorfindet,
was anders ist als beschrieben.

1. 📣🔒 **„Profile für Creality K1C, Elegoo Centauri Carbon und weitere" klarstellen.**
   Das ist der wichtigste Punkt der ganzen Roadmap. Für diese Drucker gibt es
   **Geometrie-Vorlagen** — der Arm weiß, wo er hingreifen muss. Es gibt **keinen
   Treiber**: `printer_models.py` kennt ausschließlich Bambu Lab, und die Farm prüft
   `device_type == BAMBU_LAB`. Printloom kann bei einem K1C also weder eine Datei
   senden noch den Fortschritt lesen noch „fertig/fehlgeschlagen" erkennen. Ein Leser
   versteht „Profile für …" als „wird unterstützt". Zwei Wege, und du musst wählen:
   auf der Website als *mechanische* Vorlage kennzeichnen (billig, ehrlich) — oder
   Punkt 2 der Phase 3 vorziehen.
2. 📣 **Versionsnummer im Docker-Image.** Der Beta-Kanal vergleicht Image-Digests, die
   Oberfläche kann deshalb nur `sha256:4d8cd479…` anzeigen statt „1.1.20 verfügbar".
   Dass Push und verfügbares Update zeitlich auseinanderfallen, ist damit unsichtbar —
   es sieht aus wie ein Fehler. Version als Image-Label mitschreiben und daneben zeigen.
3. ⚡ **Zugangsdaten im Backup.** `_export_devices` schreibt `access_code` im Klartext
   in die Backup-Datei. Das Diagnose-ZIP macht es richtig (Redaction über
   Schlüsselnamen) — das Backup nicht. Entweder beim Export weglassen (mit Hinweis
   „danach neu eintragen") oder mit Passwort verschlüsseln.
4. ⚡🔒 **Tür-Standardwerte reparieren.** Mit den ausgelieferten Werten erzeugt „Tür
   schließen" Y 612 — außerhalb der Achse (407). Bei Neuinstallation ist die Operation
   damit kaputt. Braucht die echten Werte deines X1C: erster Fahrpunkt + Bogenradius.
5. ⚡🔒 **Magnet-Greifer freigeben.** Z-Anfahrhöhe (12 mm) und Hub (25 mm) sind gesetzt,
   aber nicht gemessen; offen ist vor allem das **Ablösen** beim Ablegen. Am realen
   Aufbau prüfen, dann das `soon`-Flag entfernen.
6. ⚡🔒 **Y-Tiefe der Kompakt-Halterung.** `y_engage` erbt den Standardwert. Braucht
   deine Messung, dann fällt auch dort das `soon` weg.

---

## Phase 2 — Ein Fremder kommt allein durch

**Ziel:** Die Einrichtung ist der Punkt, an dem Interessenten abbrechen. Phase 1 der
alten Roadmap hat den Assistenten gebaut; jetzt geht es um die Stellen *danach*.

1. ⚡ **Nach dem Einmessen ein echter Probelauf.** Der Trockenlauf prüft nur Achsen. Ein
   „ein Wechsel, langsam, mit Bestätigung nach jedem Schritt" wäre der Beweis, dass es
   wirklich passt — mit halber Geschwindigkeit und Abbruch bei jedem Schritt.
2. ⚡ **Fehlermeldungen mit Handlungsanweisung.** Heute steht da, was schiefging. Was zu
   tun ist, weiß nur, wer den Code kennt. Je Fehlerklasse ein Satz „so behebst du das".
3. ⚡ **Geometrie-Schreiben zentralisieren.** Das Muster „holen → ein Feld ändern →
   zurückschreiben" liegt jetzt an **vier** Stellen (Setup, Drucker-Tab, neue
   Erstkalibrierung, Achsgrenzen). `putGeometry` ersetzt die ganze Datei — ein Helfer,
   bevor eine dieser Stellen sie leerschreibt.
4. ⚡ **Assistent nachträglich aufrufbar.** Er läuft einmal und ist dann weg. Wer sein
   Regal umbaut, muss die Einzelseiten kennen.
5. ⚡ **Stille Fehler hörbar machen.** **61** Stellen `except Exception: pass`. Ein
   Debug-Schalter, der sie ins Log schreibt statt zu schweigen — spart im Support jedes
   Mal eine Fernsitzung.

---

## Phase 3 — Mehr als ein Drucker, mehr als eine Marke

**Ziel:** Das ist das größte offene Versprechen („mehrere Drucker gleichzeitig — in
Planung") und der größte Umbau. Eigener Design-Schritt davor.

1. 🏗 **Zyklus je Drucker.** `_farm` ist ein globaler Zustand mit EINEM laufenden Job.
   Die Wege für mehrere Drucker sind da (Layout, Job-Verteilung, Arm-Sperre) — aber die
   Schleife kann nur einen. Das ist der Kern und kein Nachmittag.
2. 🏗 **Zweite Druckermarke.** Klipper/Moonraker ist der naheliegende Kandidat: das
   Protokoll steckt schon in Printloom (der OTTOeject läuft darüber). Damit würden K1C
   und Centauri Carbon aus Phase 1.1 echte Ziele statt bloßer Geometrie-Vorlagen. Eine
   Druckertreiber-Schnittstelle hinter `printer_models` wäre der saubere Schnitt.
3. ⚡ **Sequenz je Drucker.** Heute global; mit zwei verschiedenen Modellen (einer mit
   Tür, einer ohne) geht das nicht auf.
4. ⚡ **Status je Drucker im Live-Kanal.** Der WebSocket pusht einen Farm-Zustand.
5. ⚡ **Die „nimm den ersten Drucker"-Stellen** im Backend auf das Modul umstellen.

---

## Phase 4 — Material zu Ende gedacht

**Ziel:** Der Verbrauch wird seit v1.1.19 mitgeschrieben. Jetzt etwas damit tun.

1. ⚡ **„Reicht die Spule für diesen Job?"** Gramm aus dem Slicer gegen die AMS-Restmenge
   VOR dem Start. Beide Zahlen liegen schon vor — nur niemand vergleicht sie.
2. ⚡ **Verbrauch je Farbe und Marke**, nicht nur als Summe. Grundlage für Nachbestellung.
3. ⚡ **Spulen ohne RFID pflegen.** Generic-Spulen melden nichts; manuelle Belegung, die
   der Abgleich respektiert.
4. ⚡ **AMS-Vorschau vor dem Start**: je Slicer-Filament der gewählte Slot mit Ampel.
5. ⚡ **Materialkosten je Job** statt nur in der Summe — sichtbar in der Historie.

---

## Phase 5 — Auswerten & exportieren

**Ziel:** Die Zahlen sind da (Statistik, Zeitleiste, Historie, Kosten, Verbrauch). Sie
sind nur nicht herausholbar.

1. ⚡ **CSV-Export** von Historie und Kosten. Der kleinste Schritt mit dem größten Effekt
   für alle, die abrechnen.
2. ⚡ **Kosten je Job in der Historie** — heute nur als Gesamtsumme auf der Startseite,
   und ausschließlich im Browser gerechnet; das Backend kennt keine Kosten.
3. ⚡ **Erfolgsquote je Drucker / Material / Fach.** Zeigt, ob ein bestimmtes Fach oder
   ein bestimmtes Material auffällig oft scheitert.
4. ⚡ **Durchsatz-Report** (Teile/Tag, Druckstunden, Auslastung) über wählbare Zeiträume.

---

## Phase 6 — Sehen, was passiert

1. ⚡ **Benachrichtigungen je Ereignis wählbar** (Start / Ende / Fehler / Magazin leer).
   Heute alles oder nichts.
2. ⚡ **Zeitraffer je Job** aus den Schnappschüssen des Kamera-Hubs — die Infrastruktur
   läuft, es fehlt das Zusammensetzen.
3. ⚡ **Vorher/Nachher am Fach.** Zu jedem eingelagerten Druck das Bild vom Auswurf.
4. ⚡ **Zweite Kamera** aufs Regal oder den Arm, im Hub mitgeführt.

---

## Phase 7 — In eine Werkstatt einbinden

1. ⚡ **Slicer-Hotfolder.** Ordner überwachen → Datei landet in der Bibliothek. Der
   kürzeste Weg von OrcaSlicer zu Printloom.
2. ⚡ **Webhooks** bei Start/Ende/Fehler.
3. ⚡ **Home Assistant / MQTT**: Status raus, einfache Steuerung rein.
4. ⚡ **Öffentliche REST-API + API-Keys** — mit Zugriffsschutz, nicht offen.
5. ⚡ **Mehrbenutzer & Rollen** plus HTTPS/Reverse-Proxy-Anleitung. Spätestens nötig,
   sobald mehr als eine Person zugreift.

---

## Aufräumen — kein eigener Zeitpunkt, beim Anfassen mitnehmen

- **`autofarm.py` ist auf ~4000 Zeilen gewachsen**, `printer.py` auf ~1600. Nicht auf
  einmal umbauen — beim nächsten Feature im Bereich das Passende herausziehen (wie
  damals `rack_logic.py`, `job_dispatch.py`, `stress_test.py`).
- **Ein Bundle von 778 kB** (260 kB gzip) für die Startseite. Die Seiten sind schon
  aufgeteilt; der gemeinsame Teil ist der dicke.
- **Zwei Raster-Bauarten.** Die Startseite ist responsiv, die Auto-Farm hat ein festes
  24-Spalten-Raster. Bewusst so eingeführt (die Farm ist ein Bedienplatz am Rechner) —
  aber wenn die Auto-Farm je am Tablet gebraucht wird, ist das die Stelle.
- **Toter API-Vorrat.** `resetDashboardLayout` und `getOttoejectVars` stehen in
  `api.js`, werden von keiner Seite benutzt. `printerService.getHistory` liest eine
  Historie, die niemand anzeigt — genau deshalb fiel der Zeitstempel-Fehler dort erst
  bei einer Prüfung auf.
- **Ein dritter Zeitstempel-Stil.** `printer.py:715` schreibt `"%Y-%m-%d %H:%M:%S"`
  ohne Marker. Nach dem Aufräumen in v1.1.19 der letzte Ausreißer.

---

## Regeln, die in jeder Phase gelten

- **Jedes Feature bringt seine Tests mit.** Besonders alles, was Hardware bewegt oder
  eine Zusage einlöst (Opt-in, Redaction). Die Suite steht bei 456 + 45 und soll mit
  jedem Release wachsen, nicht in einem Nachholprojekt.
- **Keine neuen stillen `except`.** Entweder behandeln oder loggen.
- **Kommentare erklären das WARUM.** Die Stärke dieser Codebasis; hat mehrfach Zeit
  gespart.
- **Version + zweisprachiger Changelog bei jedem Release.**
- **Eine Quelle je Zahl.** Zwei Speicher für dieselbe Größe laufen auseinander, und
  niemand sieht, welcher gilt — so war es beim Farm-Layout gegen die Geometrie
  (v1.1.8), beim Schnappschuss der Einstellungen gegen das Nachziehen (v1.1.19) und bei
  der Halterung gegen den Greifer (v1.1.19).
- **Die BEWEGUNG bemessen, nicht den Ruhezustand.** *(Lehrgeld v1.1.11)* Die Platte
  fährt ~25 mm höher ins Fach ein und wird abgesenkt. Während der Fahrt braucht ein
  Objekt also mehr Luft als danach. Beim Füllen von unten nach oben fällt das nicht
  auf, über dem Magazin sofort. **Wer Platz plant, muss den Weg dorthin einrechnen.**
- **Unbekannt ist nicht Null.** *(Lehrgeld v1.1.19)* Eine Datei ohne Filamentangabe als
  0 g zu verbuchen ließe eine unvollständige Kostenrechnung vollständig aussehen. Was
  fehlt, wird benannt, nicht ersetzt.

---

## Bewusst nicht auf der Roadmap

- **Kein Zwang nach außen.** Jede Verbindung zu einem Server außerhalb des Netzwerks
  bleibt Opt-in mit Hinweis davor. Keine Telemetrie, keine Analytik, keine Funktion,
  die ohne Internet nicht mehr geht. Das ist zugleich ein Website-Versprechen („kein
  Konto, keine Cloud").
- **Keine Fernsteuerung der Farm von außen** und keine Cloud-Pflicht.
- **Keine Gimmicks.** Nur Funktionen, die einen Handgriff sparen oder einen Fehler
  verhindern.
- **Kein Auto-Anwenden heruntergeladener Inhalte.** Sequenzen und Profile bewegen
  Hardware: erst Vorschau, dann bewusste Übernahme.

---

## Wie das benutzt wird

**Phase 1 zuerst und vollständig** — sie ist die kürzeste und die einzige, in der jeder
Punkt eine Zusage einlöst statt eine neue zu machen. Vier ihrer sechs Punkte hängen an
einer Messung von dir; die drei anderen sind reine Arbeit.

Danach entscheidet der Nutzen, nicht die Nummer. Phase 3 ist ein eigenes Vorhaben mit
vorgeschaltetem Design-Schritt und sollte nicht nebenbei beginnen.

Was fertig ist, wandert nicht in eine Erledigt-Liste, sondern in die Fundament-Tabelle
oben — so bleibt dieses Dokument kurz und beschreibt immer den nächsten Schritt.
