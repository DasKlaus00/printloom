# Printloom — Roadmap

**Stand: v1.1.81 · 18.11.2026**

## Wo Printloom heute steht

Printloom betreibt eine Druckfarm mit **einem Bambu-Lab-Drucker** und dem **OTTOeject**
unbeaufsichtigt: Warteschlange → drucken → Platte auswerfen → ins Regal → nächste Platte
→ nächster Job. Printloom erzeugt die Armbewegungen selbst. Vor jeder Bewegung prüft es
Drucker, Bett und Greifer. Es kennt zwei Regal-Bauarten: das Original-Regal mit Magazin
und das Kompakt-Regal mit 24 Fächern. Aufträge kommen aus der Datei-Bibliothek, aus
Projekten oder direkt aus OrcaSlicer. Printloom läuft als Docker-Image, als Windows-App
oder nativ unter Linux.

Was der Code heute **nicht** kann:

- **Es läuft immer nur ein Druck.** Ein Layout mit mehreren Druckern, Regale je Drucker
  und eine Verteilung der Warteschlange (`job_dispatch`) gibt es schon. Gefahren wird
  trotzdem immer nur ein Job, weil die Farm nur einen Zustand kennt (`_farm` in
  `autofarm.py`).
- **Nur Bambu-Drucker werden gesteuert.** Für Creality K1C und Elegoo Centauri Carbon gibt
  es Geometrie-Vorlagen, aber keinen Treiber.
- **Bei Fehlern hält die Farm fast immer an.** Fast jede Fehlerklasse steht auf
  „pausieren“. Das ist sicher, aber nachts steht die Farm auch dann still, wenn ein
  anderer Job weiterdrucken könnte.
- **Die Farm schaut nicht nach, sie merkt sich.** Ob Bett und Greifer leer sind, steht in
  ihrer Buchführung oder wird von einem Menschen bestätigt. Kein Sensor und keine Kamera
  prüft es.
- **Kompakt-Regal und Magnet-Greifer sind noch nie an echter Hardware gelaufen.**
- **Der stabile Kanal (`:latest`) steht auf v1.1.41**, 40 Releases hinter Beta.

## Wohin

Das Ziel ist eine Farm, der man über Nacht vertraut. Sie druckt weiter, solange das
sicher ist. Sie hält an, wenn es nicht mehr sicher ist. Am Morgen sagt sie, was passiert
ist und in welchem Fach jedes Teil liegt. Später bedient dieselbe Farm mehrere Drucker
an einem Arm.

`⚡` klein, passt in ein Release · `🏗` Umbau über mehrere Releases, mit eigenem
Design-Schritt · `🔒` braucht Hardware, eine Messung oder eine Entscheidung ·
`🔬` erst erproben

---

## 1 · Auf der echten Farm beweisen (jetzt)

Neue Funktionen sind wenig wert, solange die vorhandenen nicht an der Hardware gelaufen sind.

1. 🔒 **Kompakt-Regal einmessen und fahren.** Hub (5 mm), Absenken (5 mm), Zugabe (8 mm)
   und Einlege-Weg sind nur Startwerte. Ob der Arm zwischen 16-mm-Fächer passt, hat noch
   niemand gemessen. Am Ende stehen gemessene Vorgaben, und das Badge „Neu“ fällt weg.
2. ⚡ **Trockenlauf für das Kompakt-Regal.** Den Stresstest gibt es dort nicht, weil er
   Platten in zufällige Fächer legt. Ersatz nach den echten Regeln: leere Platte holen,
   zum Drucker fahren, zurück in Regal 1 legen. Das läuft Schritt für Schritt mit
   halber Geschwindigkeit.
3. 🔒 **Farm-Test, danach Beta → Stabil.** Ab dann nach jedem Farm-Test befördern,
   statt 40 Releases zu sammeln.
4. 🔒 **OrcaSlicer-Plugin in einem echten Orca testen:** Agent-Modus, Druckdialog,
   Geräte-Tab.
5. 🔒 **Windows-Kamera mit dem neuen ffmpeg** am Drucker prüfen.

## 2 · Weiterdrucken statt anhalten

Eine Nacht soll mit fertigen Teilen enden, nicht mit einer Pause um zwei Uhr.

1. ⚡ **Strategie „zurückstellen“.** Manchmal steckt die Farbe eines Jobs nicht im AMS
   (`ams_unmatched`), oder sein Teil passt nicht mehr ins Regal (`no_slot`). Dann geht
   der Job ans Ende der Warteschlange, und die Farm nimmt den nächsten, der passt. Die
   Warteschlange ist eine einzige Liste im Server, das Umsortieren kostet also wenig.
2. ⚡ **Spule vor dem Start prüfen, über die ganze Warteschlange.** Heute vergleicht nur
   das OrcaSlicer-Plugin die Gramm im Slicer mit dem Rest im AMS (`spool_check`).
   Die Farm soll das vor jedem Job tun und alle wartenden Jobs zusammenzählen, die
   dieselbe Spule brauchen. `remain = -1` heißt „unbekannt“ und nicht „leer“.
3. ⚡ **Bericht am Morgen.** Nach der Nacht kommt eine Push-Nachricht (Web-Push gibt es
   schon): was fertig ist, was fehlgeschlagen ist, was zurückgestellt wurde und in welchem
   Fach jedes Teil liegt. Die Daten dafür stehen schon in der Historie.
4. ⚡ **Warnen, bevor das Regal voll ist**, und nicht erst stehen bleiben. Die Warnung
   sagt auch, wie viele wartende Jobs noch passen.
5. ⚡ **Fehlermeldungen mit Handgriff.** Zu jeder Fehlerklasse gibt es einen Satz „so
   behebst du das“ und gleich den passenden Knopf danach: Greifer leer bestätigen,
   Platte zurücklegen, fortsetzen.

## 3 · Mehrere Drucker an einem Arm 🏗

Das ist der größte Schritt, und die Hardware legt ihn nahe: Ein OTTOeject auf einer
Schiene kann mehrere Drucker bedienen. Während Drucker A druckt, räumt der Arm bei
Drucker B ab.

**Das gibt es schon:** ein Layout mit mehreren Druckern, Regale je Drucker,
`job_dispatch` (welcher Job auf welchen Drucker geht), einen Arm-Status und die Regel
„nur ein Ablauf bewegt den Arm“.

1. 🏗 **Erst das Design:** der Arm als geteilte Ressource. Zu klären sind die
   Reihenfolge der Bewegungen, der Vorrang für fertige Drucke, was bei einem Fehler an
   einem Drucker mit den anderen passiert, und der Notaus für alle.
2. 🏗 **Ein Druckzyklus je Drucker** statt eines globalen `_farm`. Dabei wird
   `autofarm.py` (rund 5 300 Zeilen) an den Grenzen des Zyklus geteilt. Die Teilung ist
   das Mittel, nicht das Ziel.
3. ⚡ **Status, Kamera und Sequenz je Drucker** in Auto-Farm und Dashboard. Die Stellen,
   die heute einfach den ersten Drucker nehmen, werden umgestellt.
4. ⚡ **Jobs automatisch verteilen.** Heute geschieht das nur auf Knopfdruck.

## 4 · Mehr als Bambu Lab 🏗

1. 🏗 **Eine Schnittstelle für Druckertreiber:** verbinden, Status, Datei senden, Druck
   starten und stoppen, Kamera, Zustand des Betts. Bambu (MQTT und FTP) wird der erste
   Treiber dahinter und verhält sich danach genau wie vorher.
2. 🏗 **Klipper/Moonraker als zweiter Treiber.** Einen Moonraker-Client hat Printloom
   schon, für den OTTOeject. Damit kämen Klipper-Drucker in Reichweite, für die es
   Geometrie-Vorlagen gibt.
3. 🔬 **Drucker mit eigenem Protokoll** (etwa Elegoo) erst, wenn jemand mit so einem
   Drucker testen kann.

Teil 4 kommt nach Teil 3. Eine zweite Marke bringt mehr, wenn schon jeder Drucker
seinen eigenen Zyklus hat.

## 5 · Aufträge statt Dateien

Printloom kennt heute Dateien, Projekte mit Stückzahlen und eine Historie. In einer
Werkstatt, die Teile verkauft, rechnet man aber in Aufträgen.

1. ⚡ **Auftrag:** Kunde oder Referenz, Teile, Stückzahlen, Termin. Jeder Job trägt die
   Auftragsnummer. Fertig ist ein Auftrag erst, wenn alle Teile gedruckt **und
   entnommen** sind.
2. ⚡ **„Wo liegt mein Teil?“** Die Suche nach Auftrag oder Teil zeigt Regal und Fach.
   Entnommen wird ein ganzer Auftrag auf einmal, nicht Fach für Fach.
3. ⚡ **Fertigstellung je Auftrag schätzen**, aus der Zeitschätzung, die die
   Warteschlange schon hat.
4. ⚡ **Überwachter Ordner** für Slicer ohne Plugin, zum Beispiel Bambu Studio oder
   PrusaSlicer.
5. ⚡ **CSV-Export** von Historie, Kosten und Aufträgen.
6. 🏗 **Anbindung an Shop oder ERP**, zuerst Odoo, dann Shopify. Das kommt erst, wenn
   Aufträge lokal sauber laufen, und es bleibt Opt-in.

## 6 · Material

1. ⚡ **Einzelne Spulen verwalten,** auch ohne RFID: Restgewicht, Marke, Preis. Die
   Filament-Bibliothek kennt heute nur Sorten.
2. ⚡ **Verbrauch und Kosten je Spule** aus dem G-code-Header. Heute rechnet Printloom
   die Kosten je Job aus Strom, Maschinenstunde und Material.
3. ⚡ **Hinweis zum Nachkaufen,** wenn die Warteschlange mehr Material braucht, als
   vorrätig ist.

## 7 · Nachsehen statt merken 🔬

Diese Punkte würden die teuersten Unfälle verhindern. Sie werden erst erprobt und
kommen nur dazu, wenn sie zuverlässig arbeiten.

1. 🔬 **Kamera prüft „Bett leer?“**, bevor eine Platte eingelegt wird. Das läuft lokal,
   ohne Cloud. Ein Bild darf eine Bewegung nur stoppen. Eine bestehende Prüfung ersetzt
   es nie.
2. 🔬 **Sensor am Greifer:** ein Schalter oder Hall-Sensor am Magnet-Greifer, den
   Klipper ausliest. Er meldet nach jedem Holen und Ablegen, ob eine Platte am Greifer
   hängt.
3. 🔬 **Sensor im Regal:** Er meldet, ob ein Fach belegt ist, und würde damit die
   Buchführung des Kompakt-Regals bestätigen.

## 8 · Fundament: beim Anfassen mitnehmen

- **Status über den WebSocket** (`useFarmStatusStream` gibt es schon) statt der übrigen
  Timer, die regelmäßig abfragen.
- **Playwright-Smoke-Tests in der CI:** Jede Seite lädt, wirft keinen JS-Fehler und läuft
  auf Handybreite nicht über. Heute ist das ein Handgriff vor jedem Release.
- **Die übrigen stillen `except Exception: pass` loggen.** Neue verbietet schon ein Test.
- **Große Seiten teilen** (`Drucker.jsx`, `Configuration.jsx`), immer beim nächsten
  Feature in diesem Bereich.
- **Feste Werte mit WARUM-Kommentar,** zum Beispiel Armmaße und Wege, sobald der Autor
  der Hardware sie bestätigt hat.
- **Das englische Wörterbuch erst bei Bedarf laden.**

---

## Was Printloom bewusst nicht wird

- **Keine Cloud-Pflicht, keine Telemetrie.** Jede Verbindung nach draußen ist Opt-in,
  mit Hinweis.
- **Keine eigene Anmeldung.** Die gehört an den Reverse-Proxy.
- **Kein automatisches Übernehmen** heruntergeladener Sequenzen oder Profile, denn sie
  bewegen Hardware.
- **Keine Spielereien.** Eine Funktion kommt nur dazu, wenn sie einen Handgriff spart
  oder einen Fehler verhindert.

## Reihenfolge und Pflege

Teil 1 kommt vor allem anderen. Die Teile 2 und 5 lassen sich in kleinen Releases
mischen. Teil 3 braucht seinen Design-Schritt und kommt vor Teil 4. Teil 7 wird
nebenher erprobt.

Was fertig ist, fliegt aus dieser Liste. Was Printloom kann, steht im README und im
Changelog. So zeigt die Roadmap immer nur nach vorn.
