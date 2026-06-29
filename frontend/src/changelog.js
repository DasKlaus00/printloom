/* Patchnotes der letzten Updates — zweisprachig (de/en), neueste zuerst.
   Wird auf der System-Seite unter „Version" angezeigt. Bei jedem Release oben
   einen Eintrag ergänzen (die Anzeige zeigt die neuesten fünf). */

export const CHANGELOG = [
  {
    version: '1.0.79',
    de: [
      'WICHTIGER Sicherheits-Fix: Es wird NIE mehr materialübergreifend zugeordnet. Bisher konnte die Farm ohne passendes Material auf ein falsches ausweichen (z. B. PETG-Druck mit PLA). Jetzt nur exakt gleiches Material — fehlt es, pausiert die Farm zur manuellen Zuordnung, statt falsch zu drucken.',
      '„Pin filament" entfernt: Dateien werden nicht mehr auf ein Material/Farbe festgenagelt (das war die Ursache für den falschen Druck). Der Datei-Browser zeigt stattdessen die echten Filamente aus dem Druck (Material + Farbe); die AMS-Zuordnung erfolgt material- UND farbgenau automatisch oder manuell in der Queue.',
    ],
    en: [
      'IMPORTANT safety fix: never map across materials anymore. Before, with no matching material the farm could fall back to a wrong one (e.g. printing PETG with PLA). Now only the exact same material — if missing, the farm pauses for manual assignment instead of printing wrong.',
      'Removed “Pin filament”: files are no longer pinned to a material/color (that caused the wrong print). The file browser now shows the real filaments from the print (material + color); AMS mapping happens by exact material AND color, automatically or manually in the queue.',
    ],
  },
  {
    version: '1.0.78',
    de: [
      'Geräte bearbeiten: in Configuration → Geräte gibt es jetzt einen Stift-Knopf je Gerät — Name, IP, Port, Seriennummer & Access-Code ändern, ohne löschen & neu anlegen. Access-Code leer lassen = bleibt unverändert; der Gerätetyp bleibt fest.',
    ],
    en: [
      'Edit devices: Configuration → Devices now has a pencil button per device — change name, IP, port, serial & access code without deleting and re-adding. Leave the access code empty to keep it; the device type stays fixed.',
    ],
  },
  {
    version: '1.0.77',
    de: [
      'Einrichtungs-Status (Health-Check): Checkliste in System und am Ende des Setup-Wizards — Zeitzone, Drucker, OTTOeject, Regal, Homing-Datei: was bereit ist (✓), was offline ist (!) und was fehlt (✗).',
      'Regal-Live-Vorschau: im Setup-Wizard und im Rack Manager wird das Regal als Raster gezeigt und aktualisiert sich sofort beim Ändern von Regalen/Fächern/Fachhöhe.',
      '„+ Beispiel-Teil laden" in der Datei-Bibliothek: legt einen Demo-Druck an, um Bibliothek/Queue/Vorschau ohne echten Druck auszuprobieren.',
    ],
    en: [
      'Setup status (health check): a checklist in System and at the end of the setup wizard — time zone, printer, OTTOeject, rack, homing file: what is ready (✓), offline (!) or missing (✗).',
      'Live rack preview: the setup wizard and Rack Manager show the rack as a grid that updates instantly as you change racks/slots/slot height.',
      '“+ Load demo part” in the File Library: creates a demo print to try out library/queue/preview without a real print.',
    ],
  },
  {
    version: '1.0.76',
    de: [
      'Setup-Wizard: Zeitzone gleich im ersten Schritt (Willkommen) einstellbar — vorbelegt aus dem Browser, sofort gespeichert. Basis für Betriebszeiten & Uhrzeiten, damit die Farm nicht in UTC zur falschen Zeit startet.',
    ],
    en: [
      'Setup wizard: time zone right in the first step (Welcome) — prefilled from the browser, saved immediately. Basis for operating hours & times so the farm doesn’t start at the wrong time in UTC.',
    ],
  },
  {
    version: '1.0.75',
    de: [
      'Filament pro Datei fixieren (Datei-Bibliothek → „Filament fixieren"): das festgelegte Material/Farbe wird beim Drucken IMMER verwendet — kein Auto-Raten aus den Slicer-Metadaten mehr. Jetzt server-seitig dauerhaft gespeichert (übersteht Neuladen/Gerätewechsel) und treibt AMS-Matching + Vorschau (exakte Farbe).',
    ],
    en: [
      'Pin filament per file (File Library → “Pin filament”): the chosen material/color is ALWAYS used when printing — no more auto-guessing from slicer metadata. Now stored server-side permanently (survives reload/device change) and drives AMS matching + preview (exact color).',
    ],
  },
  {
    version: '1.0.74',
    de: [
      '„Nur exakte Farbe drucken" (Configuration → Auto Farm): wenn aktiv, weicht die Farm nicht mehr auf eine nur ähnliche Ersatzfarbe aus — ohne exakten Treffer pausiert sie und verlangt die manuelle AMS-Zuordnung, statt im falschen Farbton zu drucken.',
    ],
    en: [
      '“Print exact color only” (Configuration → Auto Farm): when on, the farm no longer substitutes a merely similar color — without an exact match it pauses and asks for manual AMS assignment instead of printing the wrong shade.',
    ],
  },
  {
    version: '1.0.73',
    de: [
      'AMS-Mapping-Vorschau pro Job: zeigt vor dem Druck je Filament den voraussichtlichen AMS-Slot mit Ampel — grün „exakt", gelb „ähnlich" (Ersatzfarbe), rot „kein Material".',
      'Farben im Klartext: AMS- und Datei-Farben werden nach Möglichkeit mit Bambu-Namen angezeigt (z. B. „Charcoal", „Terracotta") statt nur Hex.',
    ],
    en: [
      'Per-job AMS mapping preview: before printing, each filament shows the likely AMS slot with a traffic light — green “exact”, amber “similar” (substitute color), red “no material”.',
      'Plain-text colors: AMS and file colors now show Bambu names where possible (e.g. “Charcoal”, “Terracotta”) instead of just hex.',
    ],
  },
  {
    version: '1.0.72',
    de: [
      'Wichtiger Fix AMS-Farbwahl: Eine EXAKT passende Farbe wird jetzt immer bevorzugt. Vorher konnte eine nur farbähnliche, leerere Spule eine exakt passende verdrängen (z. B. „Latte Brown" statt des geladenen „Dark Red") — der Druck lief im falschen Filament. Drei Stufen: exakt → ähnlich (Ersatz) → weit weg; exakt schlägt immer ähnlich.',
    ],
    en: [
      'Important AMS color fix: an EXACT color match is now always preferred. Before, a merely similar but emptier spool could beat an exact match (e.g. “Latte Brown” instead of the loaded “Dark Red”) — printing in the wrong filament. Three tiers: exact → similar (substitute) → far; exact always beats similar.',
    ],
  },
  {
    version: '1.0.71',
    de: [
      'Behoben: Bei Multi-Material-Projektdateien (mehrere Filamente angelegt, eine Platte druckt aber nur eines) wurde fälschlich „Manuelle AMS-Zuordnung / keine Filament-Info" gemeldet. Es werden jetzt pro Platte nur die TATSÄCHLICH benutzten Filamente (Typ + Farbe) aus slice_info.config gelesen — die echte Farbe wird erkannt und das AMS-Matching verlangt keine ungenutzten Filamente mehr.',
    ],
    en: [
      'Fixed: multi-material project files (several filaments defined, but a plate prints only one) wrongly showed “Manual AMS assignment / no filament info”. Per plate, only the filaments actually USED (type + color) are now read from slice_info.config — the real color is detected and AMS matching no longer demands unused filaments.',
    ],
  },
  {
    version: '1.0.70',
    de: [
      'Behoben: Umsortieren WÄHREND des Start-Countdowns wirkt jetzt — der oberste wartende Job wird erst nach Ablauf des Countdowns bestimmt. Vorher startete trotz Tausch der zuvor oberste Job (z. B. Platte 1 statt der nach vorn gezogenen Platte 2).',
      'Auto-Start-Schalter wieder entfernt — die Farm läuft dauerhaft automatisch (kein „Jetzt starten" nötig).',
      'Planer zeigt jetzt auch die Platte je Job an (z. B. „P2/4").',
    ],
    en: [
      'Fixed: reordering DURING the start countdown now takes effect — the top waiting job is picked only after the countdown ends. Before, the previously-top job started despite the swap (e.g. plate 1 instead of the plate 2 you moved up).',
      'Removed the auto-start toggle again — the farm runs continuously and automatically (no “Start now” needed).',
      'Planner now also shows the plate per job (e.g. “P2/4”).',
    ],
  },
  {
    version: '1.0.69',
    de: [
      'Neuer „Auto-Start"-Schalter in der Warteschlange: standardmäßig EIN (voll automatisch wie bisher). Schaltest du ihn AUS, starten neu in den Leerlauf gekommene Jobs nicht von selbst — du legst die Reihenfolge in Ruhe fest und drückst dann „▶ Jetzt starten". Praktisch z. B. wenn du bei einer Mehr-Platten-Datei erst eine bestimmte Platte drucken willst.',
    ],
    en: [
      'New “Auto-start” toggle in the queue: on by default (fully automatic as before). Turn it off and newly idle jobs no longer start on their own — set the order calmly, then press “▶ Start now”. Handy e.g. when you want a specific plate of a multi-plate file to print first.',
    ],
  },
  {
    version: '1.0.68',
    de: [
      'Behoben: Eine Mehr-Platten-.3mf aus der Datei-Bibliothek („+ Queue") landete nur als EIN Job (Platte 1). Jetzt wird je Platte ein eigener Job angelegt (z. B. 13 Platten → 13 Jobs), jeweils mit Badge „Platte 3/13". (Der Auto-Farm-Picker war v1.0.67 der falsche Weg — Jobs kommen aus der Bibliothek.)',
    ],
    en: [
      'Fixed: a multi-plate .3mf added from the File Library (“+ Queue”) only became ONE job (plate 1). Now each plate gets its own job (e.g. 13 plates → 13 jobs), each with a “Plate 3/13” badge. (v1.0.67 fixed the wrong path — jobs are added from the library.)',
    ],
  },
  {
    version: '1.0.67',
    de: [
      'Mehr-Platten-.3mf: beim Hinzufügen werden jetzt automatisch ALLE Platten als eigene Jobs angelegt — kein Platten-Auswahlbalken mehr. Jeder Job zeigt „Platte 3/13".',
      'Behoben: der Platten-Auswahlbalken blieb oben hängen, obwohl die Jobs längst aus der Warteschlange entfernt waren.',
    ],
    en: [
      'Multi-plate .3mf: adding now creates a job for EVERY plate automatically — no more plate selection bar. Each job shows “Plate 3/13”.',
      'Fixed: the plate selection bar stayed at the top even after the jobs had been removed from the queue.',
    ],
  },
  {
    version: '1.0.66',
    de: [
      'Datei-Browser: mehrere markierte Dateien lassen sich jetzt auf einmal löschen (Knopf „Löschen (N)" in der Auswahl-Leiste, eine Sicherheitsabfrage).',
    ],
    en: [
      'File browser: multiple selected files can now be deleted at once (“Delete (N)” button in the selection bar, single confirmation).',
    ],
  },
  {
    version: '1.0.65',
    de: [
      'Fix: Nach längerer Wartezeit (leere Warteschlange, Magazin auffüllen, Regal voll) schalteten die OTTOeject-Motoren ab und verloren das Homing — der nächste Job scheiterte mit „Must home axis first" und der Arm holte keine Platte. Die Farm homed jetzt in dem Fall automatisch und wiederholt den Schritt.',
    ],
    en: [
      'Fix: after a longer wait (empty queue, refilling the magazine, rack full) the OTTOeject motors switched off and lost their homing — the next job failed with “Must home axis first” and the arm grabbed no plate. The farm now re-homes automatically in that case and retries the step.',
    ],
  },
  {
    version: '1.0.64',
    de: [
      'Uhrzeit (lokale Zeit) oben rechts in der Kopfleiste neben den Status-Anzeigen.',
    ],
    en: [
      'Local time shown at the top right of the header bar next to the status pills.',
    ],
  },
  {
    version: '1.0.63',
    de: [
      'Drucker-Fehler (HMS) verständlicher: Meldung zeigt Schweregrad + Kurzbeschreibung, und der Fehlercode ist ein Direktlink auf die Bambu-Wiki-Seite mit der genauen Erklärung.',
      'Pause / Fortsetzen / Stop im Auto Farm steuern jetzt auch den X1C direkt — der Drucker pausiert, setzt fort bzw. bricht den Druck mit ab.',
      'Zeitzone in der Konfiguration auswählbar (Basis für die Betriebszeiten) und speicherbar.',
    ],
    en: [
      'Clearer printer errors (HMS): the message shows severity + a short description, and the error code is a direct link to the Bambu wiki page with the exact explanation.',
      'Pause / Resume / Stop in Auto Farm now also drive the X1C directly — the printer pauses, resumes or cancels the print accordingly.',
      'Time zone is now selectable in Configuration (basis for operating hours) and saved.',
    ],
  },
  {
    version: '1.0.62',
    de: [
      'Bugfix Betriebszeiten: Zeiten werden jetzt in deiner lokalen Zeitzone geprüft. Der Container lief in UTC, dadurch startete die Farm Stunden zu spät (z. B. „Start ab 05:00" erst um 07:00).',
      'Projekte-Tab komplett neu: mehrere benannte Projekte, Dateien mit Stückzahl sammeln, „Drucken" startet bzw. füllt die Auto Farm automatisch, fertige Objekte werden pro Stück abgehakt (2/3 …).',
      'Planer: Preis-/€-Spalte entfernt.',
      'System: Backup-Warnung sitzt wieder direkt am „Update installieren"-Knopf (Patchnotes ans Ende der Karte verschoben).',
    ],
    en: [
      'Fix operating hours: times are now evaluated in your local timezone. The container ran in UTC, so the farm started hours late (e.g. “start at 05:00” only fired at 07:00).',
      'Projects tab rebuilt: multiple named projects, collect files with quantities, “Print” auto-starts or fills Auto Farm, finished objects are ticked off per piece (2/3 …).',
      'Planner: removed the price/€ column.',
      'System: the backup warning is back right next to the “Install update” button (patch notes moved to the end of the card).',
    ],
  },
  {
    version: '1.0.61',
    de: [
      'Job-Karten in der Warteschlange kompakter: Höhe + Fächer-Bedarf steht oben rechts; Fach-Anzeige, Filament-Punkte und das AMS-Dropdown entfallen. Die manuelle AMS-Festlegung erscheint nur noch, wenn die Farm wirklich darauf wartet.',
    ],
    en: [
      'More compact queue job cards: height + slot demand now top-right; the slot label, filament dots and AMS dropdown are gone. The manual AMS picker only appears when the farm is actually waiting for it.',
    ],
  },
  {
    version: '1.0.60',
    de: [
      'Auto-Farm-Planer zeigt jetzt zusätzlich den Tag an (heute / morgen / +N Tage), da ein Job durch Betriebszeiten erst an einem späteren Tag fertig werden kann.',
    ],
    en: [
      'Auto Farm planner now also shows the day (today / tomorrow / +N days), since operating hours can push a job’s finish to a later day.',
    ],
  },
  {
    version: '1.0.59',
    de: [
      'Betriebszeiten jetzt pro Wochentag einzeln einstellbar (eigenes Von–Bis je Tag, Tag ganz abschaltbar, „auf alle Tage übernehmen").',
      'Auto-Farm-Planer berücksichtigt die Betriebszeiten: die Fertig-Uhrzeit enthält jetzt die Wartezeit bis zum nächsten Zeitfenster.',
    ],
    en: [
      'Operating hours can now be set per weekday (own from–to per day, a day can be turned off entirely, “apply to all days”).',
      'Auto Farm planner now accounts for operating hours: the finish time includes the wait until the next window.',
    ],
  },
  {
    version: '1.0.58',
    de: [
      'Steuerung: Holen nur noch aus dem Magazin (Fach 7), Einlagern nur in die Lager-Fächer (1–6). Aus den Lager-Fächern wird nicht mehr geholt.',
    ],
    en: [
      'Control page: grab only from the magazine (slot 7), store only into the storage slots (1–6). Storage slots are no longer grabbed from.',
    ],
  },
  {
    version: '1.0.57',
    de: [
      'Auto-Farm-Layout: feineres, weiterhin einrastendes Raster zum Anordnen der Kacheln.',
      'Auto Farm: zweite Kamera (unten) lässt sich ausblenden.',
      'Steuerung nutzt während eines Farm-Laufs die Live-Verbindung der Farm, statt alle 15 s neu zu verbinden.',
      'System: Patchnotes der letzten Updates hier unter „Version" (Sprache folgt der Auswahl unten links).',
    ],
    en: [
      'Auto Farm layout: finer, still-snapping grid for arranging the panels.',
      'Auto Farm: the second (bottom) camera can be hidden.',
      'Control page uses the farm’s live connection during a run instead of reconnecting every 15 s.',
      'System: patch notes for recent updates shown here under “Version” (follows the language selected at bottom left).',
    ],
  },
  {
    version: '1.0.56',
    de: [
      'Auto Farm läuft jetzt im Dauerbetrieb: Start läuft bis zum manuellen Stopp oder Update — kein Auto-Stopp bei leerer Warteschlange.',
      'Neuer Job aus dem Leerlauf startet nach einem 15-Sekunden-Countdown (oben im Header sichtbar).',
      'Fächer werden live beim Druckstart berechnet und nicht mehr vorab angezeigt — nur der startende Job erscheint im Regal.',
      'Regal voll: die fertige Platte wartet im Drucker, bis genug Fächer übereinander frei sind, dann geht es automatisch weiter.',
      'Geringerer Speicherverbrauch (Logging und malloc-Tuning).',
    ],
    en: [
      'Auto Farm now runs continuously: Start runs until you stop it or an update arrives — no auto-stop on an empty queue.',
      'A new job out of idle starts after a 15-second countdown (shown in the header).',
      'Slots are computed live at print start and no longer shown in advance — only the starting job appears in the rack.',
      'Rack full: the finished plate waits in the printer until enough stacked slots are free, then continues automatically.',
      'Lower memory usage (logging and malloc tuning).',
    ],
  },
  {
    version: '1.0.55',
    de: [
      'Betriebszeiten/Zeitfenster: neue Drucke nur innerhalb eines gewählten Fensters starten (über Nacht möglich); laufende Drucke werden nie unterbrochen.',
      'Fix: Teil-Einstellungen (Farm/Strom/Fehlerstrategie) überschrieben sich gegenseitig nicht mehr — es wird jetzt zusammengeführt.',
    ],
    en: [
      'Operating hours/time windows: start new prints only within a chosen window (overnight supported); running prints are never interrupted.',
      'Fix: partial settings (farm/power/error-strategy) no longer overwrite each other — they are merged now.',
    ],
  },
  {
    version: '1.0.54',
    de: [
      'Fix: Fehler-Banner blieb nach „Fortsetzen" hängen — wird beim Fortsetzen jetzt gelöscht.',
      'Druck lässt sich direkt vom Dashboard aus fortsetzen.',
    ],
    en: [
      'Fix: the error banner stayed after “Resume” — it is now cleared on resume.',
      'A print can be resumed directly from the dashboard.',
    ],
  },
  {
    version: '1.0.53',
    de: [
      'Fächer-Toleranz konfigurierbar (Rack Manager).',
      'Geteilter WebSocket-Live-Kanal für Status; leichteres Aktivitäts-Log; sauberere Logik.',
    ],
    en: [
      'Configurable slot tolerance (Rack Manager).',
      'Shared WebSocket live channel for status; lighter activity log; cleaner logic.',
    ],
  },
  {
    version: '1.0.52',
    de: [
      'Fix: doppelte MQTT-Verbindung beim erneuten Senden einer Datei.',
      'Private IP-Adressen aus dem Projekt entfernt.',
    ],
    en: [
      'Fix: duplicate MQTT connection when re-sending a file.',
      'Removed private IP addresses from the project.',
    ],
  },
]
