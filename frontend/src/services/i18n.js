import { systemService } from './api'

const translations = {
  de: {
    nav: {
      dashboard:     'Dashboard',
      files:         'Datei-Bibliothek',
      analyze:       'Datei-Analyse',
      steuerung:     'Steuerung',
      autofarm:      'Auto Farm',
      rack:          'Rack Manager',
      sequence:      'Sequenz-Editor',
      configuration: 'Konfiguration',
      system:        'System',
      profiles:      'Profile',
      schedule:      'Zeitplan',
      integration:   'Integration',
    },
    system: {
      title:       'System',
      subtitle:    'Versionsverwaltung & Updates',
      channel:     'Release-Kanal',
      stable:      'Latest',
      beta:        'Beta',
      version:     'Version',
      installed:   'Installiert',
      newest:      'Neueste',
      checkUpdate: 'Auf Updates prüfen',
      install:     'Update installieren',
      notifications: 'Benachrichtigungen',
      save:        'Speichern',
      test:        'Testnachricht',
    },
    common: {
      save:    'Speichern',
      cancel:  'Abbrechen',
      delete:  'Löschen',
      edit:    'Bearbeiten',
      add:     'Hinzufügen',
      close:   'Schließen',
      loading: 'Lädt…',
      error:   'Fehler',
      success: 'Erfolg',
      yes:     'Ja',
      no:      'Nein',
    },
    schedule: {
      title:        'Zeitplan',
      subtitle:     'Wiederkehrende Auto Farm Jobs',
      newSchedule:  'Neuer Zeitplan',
      noSchedules:  'Keine Zeitpläne vorhanden',
      name:         'Name',
      days:         'Wochentage',
      time:         'Uhrzeit',
      jobs:         'Jobs',
      enabled:      'Aktiv',
      disabled:     'Inaktiv',
      runNow:       'Jetzt ausführen',
      toggle:       'Aktivieren/Deaktivieren',
      dayNames:     ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    },
    integration: {
      title:    'Integration',
      subtitle: 'REST API für Home Assistant & andere Systeme',
    },
  },
  en: {
    nav: {
      dashboard:     'Dashboard',
      files:         'File Library',
      analyze:       'File Analysis',
      steuerung:     'Control',
      autofarm:      'Auto Farm',
      rack:          'Rack Manager',
      sequence:      'Sequence Editor',
      configuration: 'Configuration',
      system:        'System',
      profiles:      'Profiles',
      schedule:      'Schedule',
      integration:   'Integration',
    },
    system: {
      title:       'System',
      subtitle:    'Version Management & Updates',
      channel:     'Release Channel',
      stable:      'Latest',
      beta:        'Beta',
      version:     'Version',
      installed:   'Installed',
      newest:      'Latest',
      checkUpdate: 'Check for Updates',
      install:     'Install Update',
      notifications: 'Notifications',
      save:        'Save',
      test:        'Test Message',
    },
    common: {
      save:    'Save',
      cancel:  'Cancel',
      delete:  'Delete',
      edit:    'Edit',
      add:     'Add',
      close:   'Close',
      loading: 'Loading…',
      error:   'Error',
      success: 'Success',
      yes:     'Yes',
      no:      'No',
    },
    schedule: {
      title:        'Schedule',
      subtitle:     'Recurring Auto Farm Jobs',
      newSchedule:  'New Schedule',
      noSchedules:  'No schedules configured',
      name:         'Name',
      days:         'Days of week',
      time:         'Time',
      jobs:         'Jobs',
      enabled:      'Active',
      disabled:     'Inactive',
      runNow:       'Run now',
      toggle:       'Enable/Disable',
      dayNames:     ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    },
    integration: {
      title:    'Integration',
      subtitle: 'REST API for Home Assistant & other systems',
    },
  },
}

/* ── Dynamic language packs (downloaded from the server catalog) ──────────
   Built-in de/en above; installed packs are cached in localStorage and merged
   on top so t() can resolve them synchronously after the first load. */
const PACKS_KEY = 'ottomat3d_langpacks'
const LANG_KEY  = 'ottomat3d_lang'

let dynamicPacks = (() => {
  try { return JSON.parse(localStorage.getItem(PACKS_KEY) || '{}') } catch { return {} }
})()

// English overrides keyed by the exact German source string (see tr() below).
// Filled in incrementally per page; missing entries fall back to German.
const EN_STRINGS = {
  // ── Bibliothek (eigener Tab) ──
  'Sprachpakete, Drucker-Profile und Sequenzen': 'Language packs, printer profiles and sequences',
  'Alle': 'All',
  'Profile': 'Profiles',
  'Sprachpaket': 'Language pack',
  'Profil': 'Profil',
  'Sequenz': 'Sequence',
  'Autor': 'Author',
  'Kennung': 'ID',
  'Quelle': 'Source',
  'unbekannt': 'unknown',
  'Keine Beschreibung': 'No description',
  'Ansehen & übernehmen': 'View & apply',
  'Suchen (Name, Autor, Beschreibung)…': 'Search (name, author, description)…',
  '⟳ Aktualisieren': '⟳ Refresh',
  'Kein Eintrag passt zum Filter.': 'No entry matches the filter.',
  'Der Katalog ist leer — auf dem Server sind noch keine Inhalte veröffentlicht.':
    'The catalogue is empty — no content has been published on the server yet.',
  'angezeigt wird der letzte gespeicherte Stand.': 'showing the last saved state.',
  'Die Bibliothek lädt Inhalte von einem Server außerhalb deines Netzwerks und ist deshalb standardmäßig aus.':
    'The library loads content from a server outside your network and is therefore off by default.',
  'Solange sie aus ist, wird hier NICHTS abgerufen. Du kannst sie unter „System → Online-Dienste" freischalten — dort steht auch genau, was dabei übertragen wird (und was nicht).':
    'While it is off, NOTHING is fetched here. You can enable it under "System → Online services" — that page also states exactly what is transferred (and what is not).',
  'Zu den Online-Diensten →': 'Go to online services →',
  'Bibliothek freigeschaltet — Einträge mit Autor, Version und Vorschau findest du im Tab „Bibliothek".':
    'Library enabled — entries with author, version and preview are in the "Library" tab.',
  'Bibliothek öffnen →': 'Open library →',
  'Version des Eintrags': 'Version of this entry',
  'Sprachcode „{0}" · {1} Übersetzungen': 'Language code "{0}" · {1} translations',
  '{0} Schritte': '{0} steps',
  'Geometrie': 'Geometry',
  'Regal-Konfiguration': 'Rack configuration',
  'Profil-Daten': 'Profile data',
  'Wird als Sprache „{0}" ({1}) installiert — unabhängig vom Katalog-Namen.':
    'Will be installed as language "{0}" ({1}) — regardless of the catalogue name.',
  'Inhalte kommen von {0} und werden vor der Anzeige geprüft. Übernommen wird nur, was du bestätigst.':
    'Content comes from {0} and is validated before display. Only what you confirm gets applied.',
  'Sprachpaket „{0}" installiert — Sprache in Konfiguration → Allgemein umstellen.':
    'Language pack "{0}" installed — switch the language under Configuration → General.',
  'Sequenz „{0}" übernommen — VOR dem Einsatz im Sequenz-Editor prüfen und ohne Platte testen.':
    'Sequence "{0}" applied — review it in the sequence editor and test without a plate BEFORE using it.',
  '({0} Einträge)': '({0} entries)',
  // ── Online-Dienste (Opt-in) ──
  'Online-Dienste': 'Online services',
  'komplett aus': 'fully off',
  'teilweise aktiv': 'partly active',
  'Update-Prüfung im Internet': 'Check for updates online',
  'Bekannte Probleme & Hinweise': 'Known issues & notices',
  'Sprachpakete & Bibliothek': 'Language packs & library',
  'Alles freiwillig. Ist hier nichts eingeschaltet, verbindet sich Printloom mit KEINEM Server außerhalb deines Netzwerks — die App funktioniert vollständig offline.':
    'All optional. With nothing enabled here, Printloom connects to NO server outside your network — the app works fully offline.',
  'Prüft bei GitHub, ob eine neuere Printloom-Version da ist. Aus = Printloom prüft nichts von allein; du kannst jederzeit von Hand prüfen.':
    'Checks GitHub for a newer Printloom version. Off = Printloom never checks on its own; you can always check manually.',
  'Lädt Warnungen zur laufenden Version (z. B. „Fehler in 1.0.158"), damit du von Fehlern erfährst, ohne auf ein Update zu warten.':
    'Loads warnings about your running version (e.g. "bug in 1.0.158") so you hear about problems without waiting for an update.',
  'Katalog mit Sprachpaketen, Drucker-Profilen und Sequenzen. Wird nur angezeigt — übernommen erst nach deiner Bestätigung.':
    'Catalogue of language packs, printer profiles and sequences. Only displayed — applied only after you confirm.',
  '⚠ Verbindung nach außen bestätigen': '⚠ Confirm connection to the outside',
  'Damit verbindet sich Printloom mit einem Server AUSSERHALB deines Netzwerks:':
    'This makes Printloom connect to a server OUTSIDE your network:',
  'Es werden nur Daten ABGERUFEN (lesende Anfragen).': 'Data is only RETRIEVED (read-only requests).',
  'Es werden KEINE Drucker-Daten, Dateinamen, Zugangsdaten oder Nutzungsstatistiken gesendet.':
    'NO printer data, file names, credentials or usage statistics are sent.',
  'Der Abruf läuft über den Printloom-Server, nicht über deinen Browser.':
    'The request is made by the Printloom server, not by your browser.',
  'Alles wird lokal zwischengespeichert und funktioniert danach auch offline.':
    'Everything is cached locally and works offline afterwards.',
  'Du kannst das jederzeit wieder abschalten und den Zwischenspeicher löschen.':
    'You can switch this off again at any time and clear the cache.',
  'Die Update-Prüfung geht zusätzlich an GitHub (github.com / ghcr.io), da dort die Versionen liegen.':
    'The update check additionally contacts GitHub (github.com / ghcr.io), where the versions are hosted.',
  'Verstanden — verbinden': 'Understood — connect',
  'Verbindung widerrufen & Zwischenspeicher löschen': 'Revoke connection & clear cache',
  'Verbindung abgelehnt — alle Online-Funktionen aus, Zwischenspeicher gelöscht.':
    'Connection declined — all online features off, cache cleared.',
  '✓ Keine bekannten Probleme für diese Version.': '✓ No known issues for this version.',
  'Mehr dazu': 'Learn more',
  'Abruf fehlgeschlagen': 'Fetch failed',
  'Bibliothek': 'Library',
  'Sprachen': 'Languages',
  'Sequenzen': 'Sequences',
  'Nichts vorhanden.': 'Nothing available.',
  'Ansehen': 'View',
  'Vorschau': 'Preview',
  'Lade Inhalt …': 'Loading content …',
  'Übernehmen': 'Apply',
  'Übernehme…': 'Applying…',
  '⚠ Diese Sequenz steuert den OTTOeject. Nach dem Übernehmen im Sequenz-Editor prüfen und einmal ohne Platte testen — fremde Koordinaten können die Mechanik beschädigen.':
    '⚠ This sequence drives the OTTOeject. After applying, review it in the sequence editor and test once without a plate — foreign coordinates can damage the mechanics.',
  'Diagnose-Paket (Support)': 'Diagnostics package (support)',
  '⤓ Herunterladen': '⤓ Download',
  'ZIP mit Konfiguration, Geometrie, Sequenzen, Versions-Infos und den letzten Log-Zeilen — für die Fehlersuche zum Verschicken. Access-Codes, Tokens und Passwörter sind NICHT enthalten, Druckdateien und Kamerabilder auch nicht. Es wird nichts automatisch verschickt: die Datei landet nur in deinem Download-Ordner.':
    'ZIP with configuration, geometry, sequences, version info and the last log lines — to send for troubleshooting. Access codes, tokens and passwords are NOT included, nor are print files or camera images. Nothing is sent automatically: the file just lands in your downloads folder.',
  'Die automatische „Update-Prüfung im Internet" ist aus — Printloom fragt von allein NICHT bei GitHub nach. „Jetzt prüfen" macht eine einmalige Abfrage. Dauerhaft einschalten kannst du sie unter „Online-Dienste".':
    'The automatic "check for updates online" is off — Printloom does NOT contact GitHub on its own. "Check now" performs a one-off query. You can enable it permanently under "Online services".',
  'Jetzt prüfen (einmalig)': 'Check now (one-off)',
  'noch nie': 'never',
  'gerade eben': 'just now',
  'Server': 'Server',
  'Stand': 'Updated',
  // ── Setup: verbaute Komponenten ──
  'Komponenten': 'Components',
  'Regal-Halterung': 'Rack holder',
  'Welche Fachhalter sind verbaut?': 'Which slot holders are installed?',
  'Standard-Halterung': 'Standard holder',
  'Kompakt-Halterung': 'Compact holder',
  'Oberstes Fach': 'Top slot',
  'Wofür nutzt du die oberste Position?': 'What do you use the top position for?',
  'Oberstes Fach = Magazin': 'Top slot = magazine',
  'Alle Fächer = Lagerfächer': 'All slots = storage',
  // Die Beschreibungen der beiden Bauarten fehlten auf Englisch (standen deutsch
  // in der englischen UI) — nachgezogen mit der Markierung aus v1.0.163.
  'Das oberste Fach hält einen Stapel LEERER Druckplatten. Die Farm holt sich daraus selbst Nachschub — echter unbeaufsichtigter Dauerbetrieb. Die Fächer darunter lagern die fertigen Drucke.':
    'The top slot holds a stack of EMPTY build plates. The farm takes its own supply from there — real unattended operation. The slots below store the finished prints.',
  'Kein Magazin: die leeren Platten liegen BEREITS in den Fächern. In der Farm-Ansicht markierst du je Fach mit ▭, wo eine leere Platte liegt — die Farm greift von oben nach unten daraus und legt den fertigen Druck in ein Fach OHNE Platte. Ein Lagerfach mehr, aber Nachschub legst du selbst ein.':
    'No magazine: the empty plates ALREADY sit in the slots. In the farm view you mark with ▭ which slot holds an empty plate — the farm picks them top-down and stores the finished print in a slot WITHOUT a plate. One storage slot more, but you load the supply yourself.',
  'Anzahl Regale': 'Number of racks',
  'Wie viele Regal-Türme stehen neben dem Drucker? (Regal 1 = direkt am Drucker)':
    'How many rack towers stand next to the printer? (rack 1 = closest to the printer)',
  'Was hast du gebaut? Daraus setzt Printloom die Grundkonfiguration (Fächer je Regal, Magazin, Fach-Abstand). Alles bleibt danach änderbar.':
    'What did you build? Printloom derives the base configuration from this (slots per rack, magazine, slot spacing). Everything stays editable afterwards.',
  'Daraus folgt:': 'Resulting in:',
  'Verbaute Komponenten wählen (daraus kommt die Grundkonfiguration)':
    'Pick the installed components (the base configuration comes from this)',
  'Aus den Komponenten vorbelegt — hier fein justieren.': 'Pre-filled from your components — fine-tune here.',
  'Z-Schritt Fach→Fach (mm)': 'Z pitch slot→slot (mm)',
  'Gemessener Abstand von Fach zu Fach (Standard 55, Kompakt 25)':
    'Measured distance from slot to slot (standard 55, compact 25)',
  'Magazin-Fach (0 = keins)': 'Magazine slot (0 = none)',
  'Fach mit dem Stapel leerer Platten': 'Slot holding the stack of empty plates',
  '🖨 Drucker einrichten →': '🖨 Set up printer →',
  'Einrichtung': 'Setup',
  '🧭 Setup-Assistent öffnen': '🧭 Open setup wizard',
  'Verbaute Komponenten, Drucker, OTTOeject, Regal und Kalibrierung in einem Durchlauf — daraus entsteht die Grundkonfiguration.':
    'Installed components, printer, OTTOeject, rack and calibration in one pass — this creates the base configuration.',
  // ── Drucker-Einstellungen (Bambu) ──
  '⌂ Bett homen': '⌂ Home bed',
  'G28 an den Drucker — referenziert die Achsen neu': 'Sends G28 to the printer — re-references the axes',
  '🖨 Druckbett': '🖨 Print bed',
  'Erkennung (Kamera / KI)': 'Detection (camera / AI)',
  'Erste Schicht prüfen': 'First layer inspection',
  'Spaghetti-Erkennung': 'Spaghetti detection',
  'Bauplatten-Erkennung': 'Build plate detection',
  'KI-Drucküberwachung': 'AI print monitoring',
  'Druckgeschwindigkeit': 'Print speed',
  'Leise': 'Silent',
  'Sport': 'Sport',
  'Auto-Recovery bei Schrittverlust': 'Auto-recovery on step loss',
  'Kammerlicht': 'Chamber light',
  'Kalibrierung (X1-Serie)': 'Calibration (X1 series)',
  'Bett-Nivellierung': 'Bed leveling',
  'Vibrations-Kompensation': 'Vibration compensation',
  'Motorgeräusch-Abgleich': 'Motor noise cancellation',
  '▶ Kalibrierung starten': '▶ Start calibration',
  '⟳ Zustand neu lesen': '⟳ Re-read state',
  'Alle drei zusammen dauern ~16 Minuten und blockieren den Drucker. Nur starten, wenn nichts läuft — die Farm sollte gestoppt sein.':
    'All three together take ~16 minutes and block the printer. Only start when nothing is running — the farm should be stopped.',
  '„—" = der Drucker hat den Wert noch nicht gemeldet. Nicht jedes Modell unterstützt jede Option.':
    '"—" = the printer has not reported this value yet. Not every model supports every option.',
  'KI-Erkennung, Geschwindigkeit, Auto-Recovery, Licht und Kalibrierung — direkt hier, ohne an den Drucker zu gehen.':
    'AI detection, speed, auto-recovery, light and calibration — right here, without walking to the printer.',
  // ── Kamera (Modell-Auswahl) ──
  'Eingebaute Kamera': 'Built-in camera',
  'Automatisch erkennen (empfohlen)': 'Auto-detect (recommended)',
  'X1 / X1C / X1E — RTSPS (flüssig)': 'X1 / X1C / X1E — RTSPS (smooth)',
  'P1P / P1S / A1 — Port 6000 (Standbilder, langsam)': 'P1P / P1S / A1 — Port 6000 (stills, slow)',
  'Aus (keine eingebaute Kamera)': 'Off (no built-in camera)',
  'Der P1S/A1 liefert nur ~1–wenige Bilder/s (Hardware-Limit), kein flüssiges Video. „Automatisch" prüft den Drucker selbst — nur ändern, wenn die Erkennung danebenliegt.':
    'The P1S/A1 only delivers ~1–a few frames/s (hardware limit), not smooth video. "Auto-detect" probes the printer itself — only change this if detection gets it wrong.',
  'Oben · Drucker-Kamera (direkt)': 'Top · printer camera (direct)',
  'Drucker-Kamera nicht erreichbar': 'Printer camera unreachable',
  // ── Shared / status ──
  'Leer': 'Empty',
  'Bereit': 'Ready',
  'Druckt': 'Printing',
  'Fertig': 'Done',
  'Gesperrt': 'Locked',
  'Pausiert': 'Paused',
  'Läuft': 'Running',
  'Gestoppt': 'Stopped',
  'Lade…': 'Loading…',
  'FEHLER': 'ERROR',
  'läuft…': 'running…',
  'Fach {0}': 'Slot {0}',
  'Konfigurator': 'Configurator',
  // ── Drucker-Tab ──
  'Drucker': 'Printer',
  'Modell wählen, Positionen je Aufgabe einstellen und live testen — ohne Klipper-Config zu bearbeiten.':
    'Pick a model, set the position of each task and test it live — without editing the Klipper config.',
  '⚠ Erst jede Operation per „Test" prüfen und die Position feinjustieren. Falsche Werte können den Arm gegen den Drucker fahren. Danach je Operation „Farm nutzt diese Position" aktivieren.':
    '⚠ Test every operation first and fine-tune the position. Wrong values can drive the arm into the printer. Then enable “Farm uses this position” per operation.',
  '1 · Drucker-Modell': '1 · Printer model',
  'geschlossen · mit Tür': 'enclosed · with door',
  'offen · ohne Tür': 'open · no door',
  'Farm nutzt aktuell die Geräte-Macros (keine App-Position aktiv).':
    'Farm currently uses the device macros (no app position active).',
  'Farm nutzt {0} App-Position(en). Rest über Geräte-Macros.':
    'Farm uses {0} app position(s). Rest via device macros.',
  '⌂ Referenzfahrt': '⌂ Home',
  'Immer erst Referenzfahrt (OTTOEJECT_HOME), dann eine Operation testen. Printloom sendet den G-code direkt aus den Werten unten.':
    'Always home first (OTTOEJECT_HOME), then test an operation. Printloom sends the G-code straight from the values below.',
  'Referenzfahrt…': 'Homing…',
  '▾ Gesendeten G-code ausblenden': '▾ Hide sent G-code',
  '▸ Gesendeten G-code der letzten Aktion': '▸ Sent G-code of the last action',
  '▶ Test': '▶ Test',
  'Farm nutzt diese Position ✓': 'Farm uses this position ✓',
  'Farm nutzt diese Position (aus → Geräte-Macro)': 'Farm uses this position (off → device macro)',
  'Tür öffnen': 'Open door', 'Tür schließen': 'Close door',
  'Start-X': 'Start X', 'Pin-Abst.': 'Pin dist.', 'd_to_pin': 'd_to_pin',
  'Platte auswerfen': 'Eject plate', 'Platte einlegen': 'Load plate',
  'Platte einlegen (Place)': 'Place plate', 'Vor Drucker fahren': 'Move to printer',
  'Sichere Anfahrt vor den Drucker — nutzt die Auswurf-Position als Bezug. Eigene Geschwindigkeit für einen schnellen Wechsel.':
    'Safe approach in front of the printer — uses the eject position as reference. Its own speed for a fast swap.',
  'Speed: global': 'Speed: global', 'Geschwindigkeit dieser Operation (M220)': 'Speed for this operation (M220)',
  'Geschwindigkeit (global)': 'Speed (global)',
  'M220-Fallback · pro Operation oben eigene Geschwindigkeit einstellbar': 'M220 fallback · set a per-operation speed above',
  'G-code direkt an den OTTOeject — z. B. G1 X100 F6000': 'G-code straight to the OTTOeject — e.g. G1 X100 F6000',
  'X-Position je Regal (mm)': 'X position per rack (mm)',
  ' · am Drucker': ' · at printer',
  'Korrektur zurücksetzen (wieder Standard-Berechnung)': 'Reset correction (back to standard calculation)',
  'R{0} anfahren…': 'Approaching R{0}…',
  'Fach 1 dieses Regals anfahren (greift nicht)': 'Approach slot 1 of this rack (does not grab)',
  'Standard = Start-X + Regal-Versatz. Ein geänderter Wert wird als Δ-Korrektur pro Regal gespeichert und gilt für alle Fächer & das Magazin dieses Regals — auch im eigenen G-code über den Platzhalter für die Regal-X-Position. Ändert sich Start-X/Versatz, wandert die Korrektur mit.':
    'Default = start X + rack offset. A changed value is stored as a Δ correction per rack and applies to all slots & the magazine of that rack — also in custom G-code via the rack-X placeholder. If start X/offset change, the correction moves along.',
  '⬇ Entladen': '⬇ Unload',
  'Slicer-Prognose dieser Platte': 'Slicer prediction for this plate',
  'Magazin R{0}: {1} Platten': 'Magazine R{0}: {1} plates',
  'Magazin-Zähler speichern fehlgeschlagen': 'Saving magazine count failed',
  'Magazin R{0} — Bestand nach dem Auffüllen hier setzen': 'Magazine R{0} — set the stock here after refilling',
  // Leerplatten-Markierung im Aufbau ohne Magazin — seit v1.0.163
  '▭ Leerplatte': '▭ Empty plate',
  'Leere Platten in R{0} — je Fach mit ▭ markieren': 'Empty plates in R{0} — mark each slot with ▭',
  'Leere Platte liegt hier — die Farm holt sich von hier Nachschub':
    'An empty plate is in this slot — the farm takes its supply from here',
  'Hier liegt eine leere Platte — die Farm holt sie von hier und legt nichts darauf ab':
    'An empty plate is in this slot — the farm picks it up from here and never places anything on it',
  'Hier liegt KEINE leere Platte mehr': 'There is NO empty plate in this slot any more',
  'Fach {0}: Leerplatte liegt drin': 'Slot {0}: empty plate is in it',
  'Fach {0}: keine Leerplatte mehr': 'Slot {0}: no empty plate any more',
  'Markierung konnte nicht geändert werden': 'Could not change the marker',
  'Leere Platten in den Fächern (mit ▭ markiert) — Nachschub der Farm':
    'Empty plates in the slots (marked with ▭) — the farm’s supply',
  'Platten im Magazin': 'Plates in the magazine',
  '⚠ In jedem freien Fach liegt eine leere Platte — es bleibt kein Fach für den fertigen Druck. Mindestens ein Fach freilassen (▭ abwählen).':
    '⚠ Every free slot holds an empty plate — no slot is left for the finished print. Keep at least one slot free (unmark ▭).',
  'Aktuelles Filament aus dem Extruder zurück ins AMS entladen': 'Unload the current filament from the extruder back into the AMS',
  'Filament S{0} laden…': 'Loading filament S{0}…',
  'Filament entladen…': 'Unloading filament…',
  'Slot S{0} neu einlesen…': 'Re-reading slot S{0}…',
  'Slot neu einlesen (RFID) — wenn die Spule nicht erkannt wurde': 'Re-read slot (RFID) — when the spool was not recognized',
  'Dieses Filament in den Extruder laden': 'Load this filament into the extruder',
  'Laden/Entladen heizt die Düse und dauert ~1 Minute — Fortschritt am Drucker. Während eines Drucks gesperrt (Pause ist ok).':
    'Loading/unloading heats the nozzle and takes ~1 minute — progress on the printer. Blocked while printing (pause is fine).',
  '▶ Senden': '▶ Send',
  'G-code senden…': 'Sending G-code…',
  '✓ Gesendet: {0}': '✓ Sent: {0}',
  'Wird 1:1 an Klipper geschickt (Enter = Senden). Vorher homen; RACK=-Nummern werden automatisch in die Geräte-Zählung übersetzt.':
    'Sent 1:1 to Klipper (Enter = send). Home first; RACK= numbers are translated to the device numbering automatically.',
  'Platte holen': 'Grab from rack', 'Platte ablegen': 'Store to rack',
  // Sequenz-Editor: Printloom-Op (app_op)
  'Printloom-Op': 'Printloom op', 'Printloom-Operation': 'Printloom operation',
  '· immer als Printloom-G-code (Drucker-Tab)': '· always Printloom G-code (Printer tab)',
  'Nutzt Position & Geschwindigkeit aus dem Drucker-Tab. Bei „Platte holen/ablegen" liefert die Farm Regal/Fach automatisch.':
    'Uses the position & speed from the Printer tab. For grab/store the farm supplies rack/slot automatically.',
  'Printloom-eigene Operation (Tür, Auswurf, Einlegen, Greifen …) aus dem Drucker-Tab — immer als App-G-code, Position & Geschwindigkeit dort einstellbar':
    'Printloom’s own operation (door, eject, place, grab …) from the Printer tab — always App G-code, position & speed set there',
  '{0} ist offen (ohne Tür) — Tür-Aktionen entfallen. In der Farm-Sequenz die Tür-Schritte weglassen (Sequenz-Editor).':
    '{0} is open (no door) — door actions omitted. Remove the door steps from the farm sequence (Sequence Editor).',
  '📦 Regal & Greifen': '📦 Rack & grab',
  '▾ ausblenden': '▾ hide', '▸ anzeigen': '▸ show',

  // ── Stresstest (Drucker-Tab) ──
  '{0} s': '{0} s',
  '{0} min {1} s': '{0} min {1} s',
  '{0} h {1} min': '{0} h {1} min',
  '{0} mm': '{0} mm',
  '🏋 Stresstest (Dauerlauf)': '🏋 Stress test (endurance run)',
  'Magazine leerräumen und die Platten zufällig verteilen.':
    'Empty the magazines and scatter the plates at random.',
  '{0} Platte(n) aus den Magazinen verteilen · geschätzt {1}':
    'Distribute {0} plate(s) from the magazines · estimated {1}',
  'Kein freies Fach für die Platten — erst Fächer räumen.':
    'No free slot for the plates — clear some slots first.',
  'Die Magazine sind leer — nichts zu verteilen.': 'The magazines are empty — nothing to distribute.',
  'Holt eine leere Platte aus Magazin 1, legt sie in ein zufälliges freies Fach und wiederholt das, bis alle Magazine leer sind. Weil die Ziele gewürfelt werden, entstehen lauter unterschiedlich lange Wege quer über die Schiene statt derselben Strecke im Kreis — der Test für Riemen, Endschalter, Wiederholgenauigkeit und die eingemessene Geometrie, ganz ohne Druck.':
    'Takes an empty plate from magazine 1, puts it into a random free slot and repeats until every magazine is empty. Because the destinations are rolled at random, you get travels of many different lengths across the rail instead of the same loop over and over — the test for belts, endstops, repeatability and the geometry you measured in, without printing anything.',
  '⚠ Danach sind die Magazine LEER und die Platten liegen verteilt in den Fächern. Das ist das Ergebnis, kein Versehen — zurückräumen ist Handarbeit.':
    '⚠ Afterwards the magazines are EMPTY and the plates are spread across the slots. That is the result, not a mishap — putting them back is manual work.',
  'Nicht als Ziel vergeben werden: Magazin-Fächer (dort steht der Stapel), gesperrte Fächer, belegte Fächer und Fächer unter einem hohen Druck — dort käme die Platte nicht herein.':
    'Never used as a destination: magazine slots (that is where the stack sits), locked slots, occupied slots, and slots above a tall print — a plate could not enter there.',
  'Stresstest starten?': 'Start the stress test?',
  '{0} Platte(n) werden aus den Magazinen geholt und über die freien Fächer verteilt — geschätzt {1}. Danach sind die Magazine LEER und die Platten liegen verstreut; zurückräumen ist Handarbeit. Der Arm fährt durchgehend: steht jemand in der Anlage oder liegt etwas im Weg, jetzt nicht starten.':
    '{0} plate(s) will be taken from the magazines and spread across the free slots — estimated {1}. Afterwards the magazines are EMPTY and the plates lie scattered; putting them back is manual work. The arm keeps moving throughout: if anyone is inside the machine or something is in the way, do not start now.',
  'Stoppt nach der laufenden Bewegung…': 'Stopping after the current movement…',
  'Magazin R{0}': 'Magazine R{0}',
  '{0} Platte(n) bleiben im Magazin liegen: {1}': '{0} plate(s) stay in the magazine: {1}',
  'Abgebrochen: {0}': 'Aborted: {0}',
  '■ Stoppen': '■ Stop',
  '▶ Stresstest starten': '▶ Start stress test',
  '↻ Neu würfeln': '↻ Roll again',
  '{0} freie Fächer · weiteste Wege bis Regal {1}':
    '{0} free slots · longest travels out to rack {1}',
  'Die Ziele werden beim Start ausgewürfelt — die Liste oben zeigt eine mögliche Verteilung; gefahren wird der Wurf vom Startzeitpunkt. Die Dauer ist hochgerechnet: Printloom erzeugt den G-code, den der Test wirklich fährt, und rechnet Strecke ÷ Vorschub plus Zuschlag fürs Beschleunigen. Die echte Zeit hängt an deiner Klipper-Beschleunigung und liegt eher darüber.':
    'Destinations are rolled when you start — the list above shows one possible spread; what runs is the roll made at start time. The duration is extrapolated: Printloom generates the G-code the test would actually drive and computes distance ÷ feedrate plus an allowance for acceleration. The real time depends on your Klipper acceleration and will tend to be longer.',
  'Start-X (Regal 1)': 'Start X (rack 1)', 'x_unclamp': 'x_unclamp', 'first_z_flat': 'first_z_flat',
  'Z-Schritt = +30': 'Z step = +30', 'Regal-Versatz X (mm)': 'Rack offset X (mm)', 'rack_x_gap': 'rack_x_gap',
  'Regale': 'Racks', 'Lager-Fächer/Regal': 'Storage slots/rack',
  'Magazin-Fach (oben, frische Platten)': 'Magazine slot (top, fresh plates)',
  'Platte': 'Plate', 'Drucker hinter letztem Regal': 'Printer behind last rack',
  'Regal': 'Rack', 'Fach': 'Slot',
  '→ Anfahren': '→ Approach', 'Fach anfahren…': 'Approaching slot…',
  '▶ Greifen testen': '▶ Test grab', 'Greifen…': 'Grabbing…',
  '▶ Ablegen testen': '▶ Test store', 'Ablegen…': 'Storing…',
  '„Anfahren" fährt nur vors Fach (greift nicht). Magazin = oberstes Fach ({0}) wird ohne Anheben gegriffen.':
    '“Approach” only moves in front of the slot (no grab). Magazine = top slot ({0}) is grabbed without lifting.',
  'Greifen': 'Grab', 'Ablegen': 'Store', 'Farm: {0} als App-G-code': 'Farm: {0} as app G-code',
  'Printloom speichert diese Werte und sendet den G-code direkt (nur OTTOEJECT_HOME bleibt Geräte-Macro). Für die Auto-Farm wirken sie erst, wenn „Farm nutzt diese Position" für die jeweilige Operation aktiv ist — sonst fährt die Farm weiter die Geräte-Macros.':
    'Printloom stores these values and sends the G-code directly (only OTTOEJECT_HOME stays a device macro). For the auto farm they take effect once “Farm uses this position” is enabled for the operation — otherwise the farm keeps running the device macros.',
  '⚙ Eigener G-code — Werte werden ignoriert': '⚙ Custom G-code — values are ignored',
  '✕ zurück zu Werten': '✕ back to values',
  'Wird 1:1 an den OTTOeject gesendet. „Test" fährt genau diesen G-code.':
    'Sent verbatim to the OTTOeject. “Test” runs exactly this G-code.',
  'Platzhalter für Regale/Fächer:': 'Placeholders for racks/slots:',
  'Magazin:': 'Magazine:',
  '▶ Magazin R{0}': '▶ Magazine R{0}',
  'Magazin R{0} — Platte holen…': 'Magazine R{0} — grabbing plate…',
  '✓ Magazin R{0}': '✓ Magazine R{0}',
  'Magazin leer — im Rack Manager auffüllen': 'Magazine empty — refill in the Rack Manager',
  'Platte aus Magazin R{0} holen (NOLIFT, Fach {1})': 'Grab a plate from magazine R{0} (NOLIFT, slot {1})',
  'Zahl = Platten im Magazin · Entnahme zählt automatisch runter (Z greift je Platte 1 mm tiefer — Durchbiegung)':
    'Number = plates in the magazine · grabbing decrements automatically (Z grabs 1 mm lower per plate — sag)',
  'EIN G-code fährt so jedes Regal (R1 am Drucker) und Fach korrekt an.':
    'One G-code then reaches every rack (R1 at the printer) and slot correctly.',
  '⚙ Eigenen G-code bearbeiten (Feinjustage)': '⚙ Edit custom G-code (fine-tune)',
  'OTTOeject-Geschwindigkeit': 'OTTOeject speed',
  'M220-Vorschub · gilt für Test & aktivierte Farm-Operationen':
    'M220 feed factor · applies to test & enabled farm operations',
  'Geschwindigkeit {0}%': 'Speed {0}%',
  'rack_x_gap · pro Regal': 'rack_x_gap · per rack',
  'Physische Regal-Positionen (mm). Regalzahl ({0}), Fächer/Regal ({1}) & Magazin-Fach ({2}) kommen global aus der Konfiguration → Rack Configuration.':
    'Physical rack positions (mm). Rack count ({0}), slots/rack ({1}) & magazine slot ({2}) come globally from Configuration → Rack Configuration.',
  '→ effektiv X{0} (Drucker hinter Regal {1})': '→ effective X{0} (printer behind rack {1})',
  'Start-Y': 'Start Y',
  'Start-X/Y/Z = ERSTER Fahrpunkt der Bewegung. Der Rest der Türbewegung folgt daraus (Pin = Bogenradius).':
    'Start X/Y/Z = the FIRST travel point of the motion. The rest of the door motion follows from it (pin = arc radius).',
  'Start-X/Y/Z = ERSTER Fahrpunkt (dort greift der Arm die OFFENE Tür — Bogen-Seite, z. B. X~1036 Y~18). Die Schließform folgt automatisch (Pin = Bogenradius).':
    'Start X/Y/Z = the FIRST travel point (where the arm grabs the OPEN door — arc side, e.g. X~1036 Y~18). The closing shape follows automatically (pin = arc radius).',
  'Start-Z': 'Start Z',
  'Absoluter Start-X an der Maschine · Basis {0} + Regal-Versatz {1}':
    'Absolute start X at the machine · base {0} + rack offset {1}',
  'Diese Position steuert auch „Tür schließen".': 'This position also drives “Close door”.',
  'Position wird automatisch von „Tür öffnen" übernommen — hier nichts einzustellen. Nur „Test" & eigene Geschwindigkeit.':
    'Position is taken automatically from “Open door” — nothing to set here. Only “Test” & own speed.',
  'Andruck-Weg (mm)': 'Push distance (mm)',
  'Greifer-Andruck · 0 = Greifpunkt = Start-X': 'Gripper push · 0 = grab point = start X',
  'Andruck-Weg: der Arm fährt beim Greifen/Ablegen um diesen Weg über die X hinaus, um den Greifer in die Halterung zu drücken (Auswerfen/Einlegen: +, Greifen/Ablegen: −). Original 30. Auf 0 stellen, wenn der Greifer genau bei Start-X fassen soll.':
    'Push distance: on grab/place the arm moves this far beyond X to press the gripper into the bracket (eject/place: +, grab/store: −). Original 30. Set to 0 for the gripper to engage exactly at start X.',
  // Farm-Layout: Module auf einer X-Schiene, mehrere Drucker — seit v1.1.3
  'Farm-Layout': 'Farm layout',
  'Drucker und Regale stehen in einer Linie auf der X-Schiene. Jedes Modul hat hier seine eigene, absolute X-Position in mm.':
    'Printers and racks stand in one line on the X rail. Here every module has its own absolute X position in mm.',
  'Noch kein Layout eingerichtet.': 'No layout set up yet.',
  'Printloom rechnet die Regal-Positionen bisher aus einer Formel: gleicher Abstand für alle Regale, genau ein Drucker. Das Layout löst das ab — jedes Modul bekommt seine eigene X-Position. Der erste Schritt übernimmt dabei EXAKT die Werte, die die Formel heute liefert: es verschiebt sich keine einzige Position.':
    'Until now Printloom computed rack positions from a formula: the same spacing for every rack, exactly one printer. The layout replaces that — every module gets its own X position. The first step adopts EXACTLY the values the formula produces today: not a single position moves.',
  'Layout aus der bisherigen Konfiguration erzeugen': 'Create layout from the current configuration',
  'Erzeuge…': 'Creating…',
  'Farm läuft — erst stoppen.': 'The farm is running — stop it first.',
  'Layout gesperrt': 'Layout locked',
  'Layout entsperrt — Änderungen möglich': 'Layout unlocked — changes possible',
  'Bei laufender Farm bleibt das Layout gesperrt.': 'While the farm runs the layout stays locked.',
  'Zum Ändern entsperren. Falsche X-Werte fahren den Arm gegen die Mechanik.':
    'Unlock to make changes. Wrong X values drive the arm into the mechanics.',
  'Nach dem Speichern jede Position einzeln testen (📐 Einmessen im Drucker-Tab).':
    'After saving, test every position individually (📐 teach-in in the Printer tab).',
  'Entsperren': 'Unlock',
  'Sperren': 'Lock',
  'Layout entsperren': 'Unlock layout',
  'Falsche X-Werte fahren den Arm gegen die Mechanik. Nach dem Ändern jede Position einzeln testen (📐 Einmessen im Drucker-Tab). Fortfahren?':
    'Wrong X values drive the arm into the mechanics. After changing, test every position individually (📐 teach-in in the Printer tab). Continue?',
  'Schiene (X in mm) — 0 rechts': 'Rail (X in mm) — 0 on the right',
  'Achsgrenze X {0}': 'Axis limit X {0}',
  '0 · Home': '0 · home',
  'Home liegt bei X 0 (Endschalter, rechts am Gerät) — die Schiene ist deshalb von rechts nach links gezeichnet: je weiter links, desto größer X. Die Reihenfolge ergibt sich aus den X-Werten, es gibt nichts zu ziehen.':
    'Home sits at X 0 (endstop, right-hand side of the machine) — so the rail is drawn right to left: the further left, the larger X. The order follows from the X values, there is nothing to drag.',
  'Module': 'Modules',
  '+ Regal': '+ Rack',
  '+ Drucker': '+ Printer',
  'Fächer': 'Slots',
  'Fach-Nr.': 'Rack no.',
  'Regal-Nummer in den Fach-Adressen („2-3")': 'Rack number used in slot addresses ("2-3")',
  'Gerät #{0}': 'Device #{0}',
  'kein Gerät': 'no device',
  'entfernen': 'remove',
  'Verwerfen': 'Discard',
  'Layout zurücksetzen': 'Reset layout',
  'Das Layout wird verworfen. Printloom rechnet die Regal-Positionen danach wieder aus der Formel (gleicher Abstand für alle Regale). Fortfahren?':
    'The layout will be discarded. Printloom will compute rack positions from the formula again (same spacing for every rack). Continue?',
  'Zurückgesetzt.': 'Reset.',
  'Layout aus der bisherigen Konfiguration erzeugt — die Positionen sind unverändert.':
    'Layout created from the previous configuration — the positions are unchanged.',
  'Drucker in der Farm': 'Printers in the farm',
  '{0} freie Fächer': '{0} free slots',
  'Regale {0}': 'Racks {0}',
  'Regal {0}': 'Rack {0}',
  'Drucker {0}': 'Printer {0}',
  '🦾 Arm: {0}': '🦾 Arm: {0}',
  '🦾 Arm frei': '🦾 Arm free',
  'Der OTTOeject kann immer nur an EINER Station sein': 'The OTTOeject can only be at ONE station at a time',
  '{0} wartet': '{0} waiting',
  'am Arm': 'at the arm',
  'wartet': 'waiting',
  '{0} frei': '{0} free',
  '{0} in Warteschlange': '{0} queued',
  'R{0}': 'R{0}',
  'Verteilung ansehen': 'Preview distribution',
  '⇉ Jetzt verteilen': '⇉ Distribute now',
  '✓ übernommen': '✓ applied',
  'zugewiesen': 'assigned',
  '{0} ohne Drucker': '{0} without a printer',
  // Dauerbetrieb: unterbrochener Lauf, Arm-Zustand, Fehler-Historie — seit v1.1.2
  'Der letzte Lauf wurde unterbrochen': 'The last run was interrupted',
  'Job „{0}" stand bei: {1}': 'Job "{0}" was at: {1}',
  'Ein Lauf war aktiv, als Printloom beendet wurde.': 'A run was active when Printloom shut down.',
  'Platte ist abgenommen — quittieren': 'Plate removed — acknowledge',
  'Nur quittieren (Platte hängt noch)': 'Just acknowledge (plate still attached)',
  'Drucker-Fehler (HMS)': 'Printer error (HMS)',
  'Bisher kein Drucker-Fehler aufgezeichnet.': 'No printer error recorded yet.',
  'Fehler-Historie leeren': 'Clear error history',
  'Alle aufgezeichneten Drucker-Fehler löschen?': 'Delete all recorded printer errors?',
  'Bewegung hängt': 'Move is stuck',
  'OTTOeject meldet die Bewegung nicht als beendet — Arm steht an unbekannter Stelle':
    'The OTTOeject does not report the move as finished — the arm is at an unknown position',
  'Zeitlimit je Bewegung (s):': 'Time limit per move (s):',
  'Ein Griff über mehrere Regale darf dauern — großzügig einstellen. Nach dem Zeitlimit gilt die Position des Arms als unbekannt: die nächste Bewegung referenziert automatisch zuerst.':
    'A grab across several racks may take a while — set this generously. After the limit the arm position counts as unknown: the next move homes first automatically.',
  // Einmess-Assistent + Setup-Ausbau — seit v1.1.1
  '📐 Einmessen': '📐 Teach-in',
  'Position einmessen': 'Teach in position',
  'Schritt': 'Step',
  'links / rechts': 'left / right',
  'vor / zurück': 'forward / back',
  'runter / hoch': 'down / up',
  '→ Position anfahren': '→ Move to position',
  '✓ Hierher übernehmen': '✓ Use this position',
  'Fahre an…': 'Moving…',
  'Angefahren — jetzt mit den Pfeilen genau justieren': 'In position — now fine-tune with the arrows',
  'Anfahren fehlgeschlagen': 'Moving failed',
  'Bewegung abgelehnt': 'Move rejected',
  'Position nicht lesbar': 'Position not readable',
  'Position neu lesen': 'Read position again',
  'Nicht referenziert — erst „Referenzfahrt", sonst lehnt Klipper jede Bewegung ab.':
    'Not homed — run "home" first, otherwise Klipper rejects every move.',
  '✓ Übernommen: X {0} · Y {1} · Z {2}': '✓ Applied: X {0} · Y {1} · Z {2}',
  '📐 Regal einmessen': '📐 Teach in rack',
  '✕ Einmessen schließen': '✕ Close teach-in',
  'Regal 1, Fach 1': 'Rack 1, slot 1',
  'Der Greifer soll genau vor Fach 1 des ERSTEN Regals stehen (Regal 1 = am Drucker). Daraus folgen Start-X, Y-Engage und die Höhe von Fach 1; die übrigen Fächer/Regale rechnet Printloom aus Fach-Abstand und Regal-Versatz.':
    'The gripper should sit exactly in front of slot 1 of the FIRST rack (rack 1 = at the printer). Start X, Y engage and the height of slot 1 follow from that; Printloom computes the other slots/racks from slot spacing and rack offset.',
  'Anfahr-Position': 'Approach position',
  'Vor den Drucker fahren und so justieren, wie der Arm ansetzen soll.':
    'Move in front of the printer and adjust the way the arm should approach.',
  'Auswurf-Start': 'Eject start',
  'Der Greifer muss genau an der Platte im Drucker ansetzen. Erst anfahren, dann justieren.':
    'The gripper has to engage exactly at the plate in the printer. Approach first, then adjust.',
  'Einlege-Position': 'Place position',
  'Position, an der die Platte im Drucker abgesetzt wird.': 'Position where the plate is set down in the printer.',
  'Dein angelegter Drucker ist ein {0} — hier ist eine andere Vorlage gewählt. Die Positionen passen dann nicht.':
    'Your configured printer is a {0} — a different template is selected here. The positions will not match.',
  'Passende Vorlage wählen': 'Select matching template',
  'Für {0} gibt es keine fertige Vorlage — die Positionen einmessen (📐 an jeder Karte).':
    'There is no ready-made template for {0} — teach in the positions (📐 on each card).',
  '{0} nimmt keine Kalibrierung über Printloom entgegen — die läuft am Drucker selbst.':
    '{0} does not accept calibration via Printloom — run it on the printer itself.',
  'Sprache': 'Language',
  'Gilt für die ganze Oberfläche. Später jederzeit unter „System" änderbar.':
    'Applies to the whole interface. Changeable at any time under "System".',
  'Achsgrenzen des OTTOeject': 'Axis limits of the OTTOeject',
  'Einmal vom Gerät holen: danach wird jede Bewegung vorher geprüft und eine, die aus der Achse fährt, gar nicht erst gesendet.':
    'Read them from the device once: after that every move is checked up front and one that leaves the axis is never sent.',
  'Trockenlauf': 'Dry run',
  'Spielt die Sequenz Schritt für Schritt durch, OHNE etwas an Drucker oder OTTOeject zu senden — zeigt, welches Fach getroffen würde und ob eine Bewegung aus der Achse fährt.':
    'Walks the sequence step by step WITHOUT sending anything to the printer or OTTOeject — showing which slot would be used and whether a move leaves the axis.',
  '▶ Trockenlauf starten': '▶ Start dry run',
  'Läuft…': 'Running…',
  'Ziel-Fach': 'Target slot',
  '{0} Platten bereit': '{0} plates ready',
  '✓ Kein Schritt würde aus der Achse fahren.': '✓ No step would leave the axis.',
  'Geometrie plausibel': 'Geometry plausible',
  'nicht prüfbar': 'cannot be checked',
  '{0} Bewegung(en) außerhalb der Achse': '{0} move(s) outside the axis',
  'alle Bewegungen innerhalb der Achsen': 'all moves inside the axes',
  'Achsgrenzen bekannt': 'Axis limits known',
  'nicht gesetzt — „vom Gerät holen", dann wird auch nach oben geprüft':
    'not set — "read from device", then the upper bound is checked too',
  'Sequenz vorhanden': 'Sequence present',
  '{0} Schritte im Zyklus': '{0} steps in the cycle',
  'leer — im Sequenz-Editor anlegen': 'empty — create it in the sequence editor',
  'Leere Platten bereit': 'Empty plates ready',
  '{0} Fächer als bestückt markiert': '{0} slots marked as loaded',
  '{0} Platten im Magazin': '{0} plates in the magazine',
  'keine markiert — in der Farm-Ansicht mit ▭ setzen': 'none marked — set them with ▭ in the farm view',
  'Magazin leer': 'Magazine empty',
  'Was ist neu': 'What’s new',
  'Aktualisiert auf Version {0}': 'Updated to version {0}',
  'Verstanden': 'Got it',
  // Plausibilitätsprüfung der Geometrie (Achsgrenzen) — seit v1.0.162
  '🛡 Plausibilität & Achsgrenzen': '🛡 Plausibility & axis limits',
  '{0} Fehler': '{0} errors',
  '{0} Hinweise': '{0} notices',
  'geprüft': 'checked',
  'Achsgrenzen des OTTOeject (mm). Sind sie bekannt, prüft Printloom jede Bewegung VOR dem Senden und verweigert sie, wenn sie aus der Achse fährt. Leer = unbekannt → es wird nur geprüft, ob eine Bewegung unter 0 mm fährt.':
    'Axis limits of the OTTOeject (mm). Once known, Printloom checks every move BEFORE sending it and refuses moves that leave the axis. Empty = unknown → only moves below 0 mm are rejected.',
  'Lese…': 'Reading…',
  '⤓ Grenzen vom Gerät holen': '⤓ Read limits from device',
  'Leeren': 'Clear',
  '✓ Vom Gerät: X {0} · Y {1} · Z {2} mm': '✓ From device: X {0} · Y {1} · Z {2} mm',
  '✓ Alle Bewegungen liegen innerhalb der Achsen.': '✓ All moves stay inside the axes.',
  'Geprüft werden alle Operationen über alle Regale und das erste/letzte Fach — dort liegen die Extremwerte. Ob eine Position mechanisch passt (z. B. genau vor dem Fach), kann nur das Einmessen zeigen.':
    'All operations are checked across all racks and the first/last slot — that is where the extremes are. Whether a position fits mechanically (e.g. exactly in front of the slot) can only be found by measuring it in.',
  // Drucker-Modell am Gerät — seit v1.0.162
  'Modell': 'Model',
  'Nicht angegeben (automatisch erkennen)': 'Not specified (detect automatically)',
  'Modell wählen (optional — wird sonst erkannt)': 'Choose model (optional — detected otherwise)',
  'Kamera über RTSP (Port 322)': 'Camera via RTSP (port 322)',
  'Kamera über Bambu-Protokoll (Port 6000)': 'Camera via Bambu protocol (port 6000)',
  'Kamera wird automatisch erkannt': 'Camera is detected automatically',
  'geschlossen (Tür)': 'enclosed (door)',
  'offen (keine Tür)': 'open (no door)',
  '🖨 Druckerbett': '🖨 Print bed',
  '▶ Bett fahren': '▶ Move bed',
  '= Z200': '= Z200',
  'Auf Ladeposition Z200 setzen': 'Set to loading position Z200',
  'Drucker-Bett → Z{0}…': 'Print bed → Z{0}…',
  '✓ Bett → Z{0}': '✓ Bed → Z{0}',
  'Kein Bambu-Drucker verbunden — Bett-Fahrt nicht verfügbar.': 'No Bambu printer connected — bed move unavailable.',
  'Fährt das Druckerbett (X1C) absolut auf die Ziel-Z (G90/G1 Z). Z200 = Ladeposition für den Platten-Wechsel. Drucker muss idle sein.':
    'Moves the print bed (X1C) to the target Z in absolute terms (G90/G1 Z). Z200 = loading position for the plate swap. Printer must be idle.',
  '⚙ G-code dieser Operation': '⚙ G-code for this operation',
  '⤓ Vorlage laden': '⤓ Load template',
  'Eigener G-code für diese Operation … („Vorlage laden" füllt einen Startpunkt)':
    'Custom G-code for this operation … (“Load template” fills a starting point)',
  'Farm nutzt diesen G-code ✓': 'Farm uses this G-code ✓',
  'Farm nutzt diesen G-code (aus → Geräte-Macro)': 'Farm uses this G-code (off → device macro)',
  'nur eigener G-code': 'custom G-code only',
  'Custom Printer: eigener G-code je Operation — noch keine Op für die Farm aktiv.':
    'Custom Printer: custom G-code per operation — no op active for the farm yet.',
  'Custom Printer: Farm nutzt {0} eigene G-code-Operation(en). Rest über Geräte-Macros.':
    'Custom Printer: farm uses {0} custom G-code operation(s). Rest via device macros.',
  'Immer erst Referenzfahrt (OTTOEJECT_HOME), dann eine Operation testen. Custom Printer: jede Operation fährt ausschließlich deinen eigenen G-code unten — keine Start-Positionen.':
    'Always home first (OTTOEJECT_HOME), then test an operation. Custom Printer: every operation runs only your own G-code below — no start positions.',
  'Drucker & Regal einrichten → fertige Klipper-Config für die OTTOeject':
    'Set up printer & rack → ready-made Klipper config for the OTTOeject',
  '1 · Drucker': '1 · Printer',
  '2 · Regal & Magazin': '2 · Rack & magazine',
  'mit Tür-Macro': 'with door macro',
  'ohne Tür': 'no door',
  'Regale (Schränke)': 'Racks (cabinets)',
  'Lager-Fächer je Regal': 'Storage slots per rack',
  'Höhe Fach 1 (mm)': 'Slot 1 height (mm)',
  'Fach-Abstand (mm)': 'Slot spacing (mm)',
  'global_slot_gap · Z-Schritt = +30': 'global_slot_gap · Z step = +30',
  'Magazin-Fach (oben, für frische Platten)': 'Magazine slot (top, for fresh plates)',
  'Plattengröße': 'Plate size',
  '▸ Drucker-Positionen (Abstand zum Drucker) …': '▸ Printer positions (distance to printer) …',
  '▾ Drucker-Positionen ausblenden': '▾ Hide printer positions',
  'Abstand z. Drucker': 'Dist. to printer',
  'Auswurf X': 'Eject X', 'Auswurf Y': 'Eject Y', 'Auswurf Z': 'Eject Z',
  'Einlegen X': 'Load X', 'Einlegen Y': 'Load Y', 'Einlegen Z': 'Load Z',
  'X-Unclamp': 'X unclamp', 'Y-Engage': 'Y engage',
  'Drucker: {0} · {1} Fächer/Regal{2} · Fach 1 @ {3} mm · Schritt {4} mm':
    'Printer: {0} · {1} slots/rack{2} · slot 1 @ {3} mm · step {4} mm',
  ' (inkl. Magazin)': ' (incl. magazine)',
  'Kopieren': 'Copy', '✓ Kopiert': '✓ Copied', '↓ Download': '↓ Download',
  'Diese beiden Dateien in den Klipper-Config-Ordner der OTTOeject legen (neben ottoeject_macros.cfg) und Klipper neu starten. Feinjustierung pro Fach danach in „Steuerung".':
    'Put both files into the OTTOeject Klipper config folder (next to ottoeject_macros.cfg) and restart Klipper. Fine-tune per slot afterwards in “Control”.',
  'global_rack_x_gap · pro Regal nach rechts': 'global_rack_x_gap · per rack to the right',
  'global_first_z_flat': 'global_first_z_flat',
  'Live: Fach anfahren (OTTOeject)': 'Live: approach slot (OTTOeject)',
  'Live-Aktionen (OTTOeject)': 'Live actions (OTTOeject)',
  'Erst Referenzfahrt. Dann im Bild ein Fach anklicken (Arm fährt davor, greift nicht) oder eine Drucker-Aktion wählen.':
    'Home first. Then click a slot in the diagram (arm moves in front, does not grab) or pick a printer action.',
  '🚪 Tür öffnen': '🚪 Open door', '🚪 Tür schließen': '🚪 Close door',
  '⬆ Platte rausholen': '⬆ Eject plate', '⬇ Platte einlegen': '⬇ Load plate',
  'Tür öffnen…': 'Opening door…', 'Tür schließen…': 'Closing door…',
  'Platte rausholen…': 'Ejecting plate…', 'Platte einlegen…': 'Loading plate…',
  '{0} hat kein Tür-Macro — Tür-Aktionen entfallen.': '{0} has no door macro — door actions omitted.',
  '{0} hat keine Tür — Tür-Aktionen entfallen.': '{0} has no door — door actions omitted.',
  '📥 Magazin greifen': '📥 Grab magazine', 'Magazin greifen…': 'Grabbing magazine…',
  '📤 In R1/F1 ablegen': '📤 Store to R1/S1', 'In Regal 1 / Fach 1 ablegen…': 'Storing to rack 1 / slot 1…',
  'Printloom sendet den G-code direkt aus den Koordinaten oben (nur OTTOEJECT_HOME ist Macro). Erst Referenzfahrt.':
    'Printloom sends the G-code directly from the coordinates above (only OTTOEJECT_HOME is a macro). Home first.',
  '▾ Koordinaten je Operation ausblenden': '▾ Hide coordinates per operation',
  '▸ Koordinaten je Operation (Start-X …)': '▸ Coordinates per operation (start X …)',
  'Start-Koordinaten je Operation. Dieselben Werte nutzt der Config-Export UND der Live-G-code.':
    'Start coordinates per operation. The same values feed the config export AND the live G-code.',
  'Regal (Greifen / Ablegen)': 'Rack (grab / store)',
 'Regal-Versatz X': 'Rack offset X',
  '⬆ Platte rausholen (Start am Drucker)': '⬆ Eject plate (start at printer)',
  '⬇ Platte einlegen (Start am Drucker)': '⬇ Load plate (start at printer)',
 'Y': 'Y', 'Z': 'Z',
  'Drucker hinter letztem Regal (X = Start + (Racks−1)·Regal-Versatz)':
    'Printer behind last rack (X = start + (racks−1)·rack offset)',
  '🖨 Drucker sitzt hinter Regal {0} · Auswurf/Einlegen/Tür-X automatisch +{1} mm (ganz links, hinter dem letzten Regal)':
    '🖨 Printer sits behind rack {0} · eject/load/door X automatically +{1} mm (far left, behind the last rack)',
  '⚠ Drucker-X wird NICHT verschoben — Tür/Auswurf/Einlegen landen bei {0} Regalen evtl. mitten im Regal. Unten „Drucker hinter letztem Regal" einschalten.':
    '⚠ Printer X is NOT shifted — with {0} racks the door/eject/load may end up in the middle of the racks. Enable “printer behind last rack” below.',
  'Zwei Wege — beides möglich': 'Two ways — both possible',
  'A · Klipper-Config: die zwei Dateien unten aufs Gerät flashen (klassisch).':
    'A · Klipper config: flash the two files below onto the device (classic).',
  'B · Printloom sendet G-code: die Live-Aktionen oben nutzen die gespeicherten Koordinaten direkt — kein Flashen, sofort wirksam. Nur OTTOEJECT_HOME bleibt Geräte-Macro.':
    'B · Printloom sends G-code: the live actions above use the stored coordinates directly — no flashing, instantly effective. Only OTTOEJECT_HOME stays a device macro.',
  'Drucker links · Regal 1 rechts (Aufbau von rechts) · Fach anklicken zum Anfahren':
    'Printer left · rack 1 right (built from the right) · click a slot to approach',
  'Drucker links · Regal 1 rechts (Aufbau von rechts)': 'Printer left · rack 1 right (built from the right)',
  'Bemaßung oben: Drucker↔nächstes Regal · Regal-Raster (Anfang→Anfang) · Regalbreite · lichte Weite 2020↔2020. Rechts: Fach-Raster (Z).':
    'Dimensions top: printer↔nearest rack · rack pitch (start→start) · rack width · clear width 2020↔2020. Right: slot pitch (Z).',
  'Drucker-Aktionen brauchen die aufgespielte printer_calibration_variables.cfg + eine Referenzfahrt.':
    'Printer actions need the flashed printer_calibration_variables.cfg + homing.',
  'Regalbreite (mm)': 'Rack width (mm)',
  'nur fürs Bau-Schema · lichte Weite = Raster − 20': 'schematic only · clear width = pitch − 20',
  'global_rack_x_gap · Raster Anfang→Anfang': 'global_rack_x_gap · pitch start→start',
  'Bemaßung oben: Drucker↔Regal 1 · Regal-Raster (Anfang→Anfang) · Regalbreite · lichte Weite 2020↔2020. Rechts: Fach-Raster (Z).':
    'Dimensions top: printer↔rack 1 · rack pitch (start→start) · rack width · clear width 2020↔2020. Right: slot pitch (Z).',
  'Regal-Raster = Regalbreite + {0} mm Profil (2020) · Maße schematisch, Z-Höhen nicht maßstäblich':
    'Rack pitch = rack width + {0} mm profile (2020) · schematic, Z heights not to scale',
  'Erst Referenzfahrt, dann im Bild ein Fach anklicken — der Arm fährt mit den aktuellen Werten davor (greift nicht).':
    'Home first, then click a slot in the diagram — the arm moves in front of it with the current values (does not grab).',
  'Regal {0} · Fach {1} anfahren…': 'Rack {0} · slot {1} — approaching…',
  '✓ {0}': '✓ {0}',
  '{0} anfahren (Regal {1})': 'Approach {0} (rack {1})',
  'Gesamt: {0} Fächer · Fach anklicken zum Anfahren': 'Total: {0} slots · click a slot to approach',
  'Drucker fest links neben Regal 1 · jedes weitere Regal wächst nach rechts (Regal-Versatz X)':
    'Printer fixed on the left next to rack 1 · each additional rack grows to the right (rack offset X)',
  'Raster {0} mm': 'Pitch {0} mm',
  'Drucker fest links · Regale wachsen nach rechts · Fach anklicken zum Anfahren':
    'Printer fixed left · racks grow to the right · click a slot to approach',
  'Drucker fest links · Regale wachsen nach rechts': 'Printer fixed left · racks grow to the right',
  'Rahmen aus 2020-Alu (20 mm): Regal-Raster {0} mm Mitte–Mitte (min. Regalbreite + {1} mm Profil + Luft) · Maße schematisch':
    'Frame from 2020 extrusion (20 mm): rack pitch {0} mm centre-to-centre (min. rack width + {1} mm profile + clearance) · schematic',
  'Beide Dateien in den Klipper-Config-Ordner der OTTOeject legen (neben ottoeject_macros.cfg, in printer.cfg per [include slots.cfg] einbinden) und Klipper neu starten. Ein zusätzliches Regal verschiebt automatisch alles um „Regal-Versatz X".':
    'Put both files into the OTTOeject Klipper config folder (next to ottoeject_macros.cfg; add [include slots.cfg] to printer.cfg) and restart Klipper. Adding a rack automatically shifts everything by “Rack offset X”.',
  'Pausiert (Seite im Hintergrund)': 'Paused (page in background)',
  'Magazin (Fach {0})': 'Magazine (slot {0})',
  '+ Beispiel-Teil laden': '+ Load demo part',
  'Beispiel-Teil geladen': 'Demo part loaded',
  'Beispiel-Teil ist bereits vorhanden': 'Demo part already exists',
  'Beispiel-Teil konnte nicht geladen werden': 'Could not load demo part',
  'Klipper': 'Klipper',
  'Backend offline': 'Backend offline',

  // ── App shell / page titles ──
  'Datei-Bibliothek': 'File Library',
  'Datei-Analyse': 'File Analysis',
  'Steuerung': 'Control',
  'Projekt': 'Project',
  'Konfiguration': 'Configuration',
  'Sequenz-Editor': 'Sequence Editor',
  'Setup-Assistent': 'Setup Wizard',
  'Update läuft…': 'Update in progress…',
  'Container wird neugestartet — bitte warten': 'Container is restarting — please wait',
  'Keine Eingaben möglich während des Updates': 'No input possible during the update',
  'Die Seite lädt sich nach Fertigstellung automatisch neu': 'The page reloads automatically when finished',
  'Update abgeschlossen': 'Update complete',
  'Seite wird neu geladen…': 'Reloading page…',

  // ── MobileView ──
  '{0} mm Höhe': '{0} mm height',
  'Entnommen': 'Removed',
  'Rack-Übersicht · Mobile': 'Rack overview · Mobile',
  '{0} fertig': '{0} done',
  '{0} Fächer gesamt': '{0} slots total',
  'Job {0} läuft': 'Job {0} running',
  'Keine Fächer konfiguriert': 'No slots configured',
  'Konfiguriere das Rack im Rack Manager': 'Configure the rack in the Rack Manager',
  'Auto-Refresh alle 5s': 'Auto-refresh every 5s',
  'Jetzt aktualisieren': 'Refresh now',

  // ── AMS-Diagnose ──
  'Keine Schritte aufgezeichnet.': 'No steps recorded.',
  'AMS-Diagnose': 'AMS Diagnostics',
  'Zeigt für jeden Sende-Vorgang genau, woher das AMS-Mapping stammt und welcher Slot gewählt wurde. Seite aktualisiert sich alle 5 Sekunden automatisch.':
    'Shows for each send operation exactly where the AMS mapping came from and which slot was chosen. The page refreshes automatically every 5 seconds.',
  'Noch keine Sende-Vorgänge aufgezeichnet': 'No send operations recorded yet',
  'Sende eine Datei an den Drucker — der Vorgang wird hier vollständig protokolliert.':
    'Send a file to the printer — the operation will be logged here in full.',

  // ── Dashboard ──
  'Auslastung (24h)': 'Utilization (24h)',
  '{0}% aktiv': '{0}% active',
  'Fehler': 'Error',
  'jetzt': 'now',
  'aktiv': 'active',
  'idle': 'idle',
  'Farm läuft': 'Farm running',
  '~{0} verbleibend': '~{0} remaining',
  'Fast fertig…': 'Almost done…',
  '{0} wartend · ~{1} gesamt': '{0} waiting · ~{1} total',
  'Kein aktiver Druck': 'No active print',
  'Pause': 'Paused',
  'Nicht konfiguriert': 'Not configured',
  'Magazin': 'Magazine',
  'von {0} Platten': 'of {0} plates',
  'fertig / {0} Fächer': 'done / {0} slots',
  '{0} mm/Fach': '{0} mm/slot',
  'Warteschlange': 'Queue',
  'fertig ~{0} Uhr': 'done ~{0}',
  '{0}/{1} mit Zeit': '{0}/{1} with time',
  'Druckstatistiken': 'Print statistics',
  'seit {0}': 'since {0}',
  'Statistiken zurücksetzen': 'Reset statistics',
  'Jobs gesamt': 'Total jobs',
  'Erfolgsrate': 'Success rate',
  'Druckzeit gesamt': 'Total print time',
  'Fehlschläge': 'Failures',
  'Häufigste Fehler': 'Most frequent errors',
  'Aktualisiert {0} · alle 15s': 'Updated {0} · every 15s',

  // ── Datei-Analyse ──
  'Keine Datei gewählt': 'No file selected',
  'Übersicht': 'Overview',
  'Druckzeit': 'Print time',
  'Schichten': 'Layers',
  'Düse': 'Nozzle',
  'GCode eingebettet': 'G-code embedded',
  'Ja': 'Yes',
  'Nein': 'No',
  'Platte (Slicer)': 'Plate (slicer)',
  'Platte {0}': 'Plate {0}',
  'GCode-Pfad': 'G-code path',
  'Layer-Einstellungen': 'Layer settings',
  'Layer-Höhe': 'Layer height',
  'Erste Schicht': 'First layer',
  'Druckgeschw.': 'Print speed',
  'Filamente + AMS': 'Filaments + AMS',
  'nicht gedruckt': 'not printed',
  'Bett-Typ': 'Bed type',
  'ZIP-Inhalt': 'ZIP contents',
  'GCode-Header (roh)': 'G-code header (raw)',
  '(leer)': '(empty)',
  '— Datei wählen —': '— Select file —',
  'Analyse fehlgeschlagen': 'Analysis failed',
  'Slicing-Metadaten, Temperaturen, Filamente und AMS-Mapping aus .3mf / .gcode extrahieren. Zwei Dateien gleichzeitig wählen für Side-by-Side-Vergleich — Unterschiede werden orange hervorgehoben.':
    'Extract slicing metadata, temperatures, filaments and AMS mapping from .3mf / .gcode. Select two files at once for a side-by-side comparison — differences are highlighted in orange.',
  'Datei A': 'File A',
  'Datei B (Vergleich)': 'File B (compare)',
  'Analysiere…': 'Analyzing…',
  'Datei wählen um zu beginnen': 'Select a file to begin',
  'Zwei Dateien wählen für direkten Vergleich': 'Select two files for a direct comparison',

  // ── Shared form / actions ──
  'Speichern': 'Save',
  'Hinzufügen': 'Add',
  'Abbrechen': 'Cancel',
  'Farbe': 'Color',
  'Fehler beim Laden': 'Error loading',
  'Fehler beim Speichern': 'Error saving',
  'Fehler beim Löschen': 'Error deleting',
  'Gelöscht.': 'Deleted.',
  'Suchen…': 'Search…',

  // ── Filamente ──
  'Filament bearbeiten': 'Edit filament',
  'Neues Filament': 'New filament',
  'Marke*': 'Brand*',
  'Material*': 'Material*',
  'Name*': 'Name*',
  'Artikel-Nr.': 'Article no.',
  'z.B. Bambu Lab': 'e.g. Bambu Lab',
  'z.B. PLA Basic': 'e.g. PLA Basic',
  'z.B. Midnight Black': 'e.g. Midnight Black',
  'z.B. AC-P01A01': 'e.g. AC-P01A01',
  'Filament hinzugefügt.': 'Filament added.',
  'Filament aktualisiert.': 'Filament updated.',
  'Filament wirklich löschen?': 'Really delete this filament?',
  'Filamente': 'Filaments',
  'Bambu Lab Katalog · {0} eingebaut · {1} eigene': 'Bambu Lab catalog · {0} built-in · {1} custom',
  'Eigene Filamente': 'Custom filaments',
  '+ Hinzufügen': '+ Add',
  'Noch keine eigenen Filamente. Klicke „+ Hinzufügen".': 'No custom filaments yet. Click “+ Add”.',
  'Bambu Lab Katalog': 'Bambu Lab catalog',
  'Keine Ergebnisse.': 'No results.',

  // ── Projekt ──
  'Dateien mit Stückzahlen kombinieren und als Warteschlange an Auto Farm übergeben.':
    'Combine files with quantities and hand them off to Auto Farm as a queue.',
  '{0} hochgeladen': '{0} uploaded',
  '{0} Jobs in Warteschlange (Fächer: {1}) — Auto Farm öffnen': '{0} jobs queued (slots: {1}) — open Auto Farm',
  '↑ Hochladen': '↑ Upload',
  'Keine Treffer': 'No matches',
  'Noch keine Dateien — erst hochladen': 'No files yet — upload first',
  '✓ im Projekt': '✓ in project',
  'Projektname': 'Project name',
  'Druckliste': 'Print list',
  'Dateien aus der Bibliothek hinzufügen': 'Add files from the library',
  'Als Entwurf': 'Mark as draft',
  'Als druckbar': 'Mark as printable',
  '{0} druckbar · {1} Entwurf': '{0} printable · {1} draft',
  '▶ In Warteschlange ({0})': '▶ To queue ({0})',
  'Alle Einträge sind Entwürfe — Status auf "druckbar" setzen': 'All entries are drafts — set status to “printable”',
  'Druckbar — wird in Warteschlange eingeplant': 'Printable — scheduled into the queue',
  'Entwurf — wird übersprungen': 'Draft — skipped',
  // ── Projekte (Neuaufbau) ──
  'Projekte': 'Projects',
  'Dateien mit Stückzahl sammeln, drucken lassen und fertige Objekte automatisch abhaken.':
    'Collect files with quantities, print them, and tick off finished objects automatically.',
  '— kein Projekt —': '— no project —',
  '+ Neues Projekt': '+ New project',
  'Neues Projekt': 'New project',
  'Noch kein Projekt — leg eines an.': 'No project yet — create one.',
  'Projekt „{0}" löschen?': 'Delete project “{0}”?',
  'Fortschritt zurückgesetzt': 'Progress reset',
  'gedruckt': 'printed',
  'läuft {0}': 'running {0}',
  'offen': 'open',
  '{0} gesamt · {1} fertig': '{0} total · {1} done',
  '▶ Drucken ({0} offen)': '▶ Print ({0} open)',
  '↺ Fortschritt zurücksetzen': '↺ Reset progress',
  'Startet die Farm automatisch bzw. reiht in die laufende ein. Fertige Objekte werden abgehakt.':
    'Starts the farm automatically or adds to the running one. Finished objects are ticked off.',
  '{0} Objekt(e) zur Warteschlange hinzugefügt': '{0} object(s) added to the queue',
  'Auto Farm gestartet — {0} Objekt(e) eingereiht': 'Auto Farm started — {0} object(s) queued',

  // ── Profile ──
  'Kalibrierung': 'Calibration',
  'Regal-Konfig': 'Rack config',
  'Einstellungen': 'Settings',
  'Anderer / generisch': 'Other / generic',
  'Keine Felder': 'No fields',
  'Neuer Druck': 'New print',
  'Nächster Druck': 'Next print',
  'Poll-Intervall (s)': 'Poll interval (s)',
  'Mindestdruckzeit (min)': 'Minimum print time (min)',
  'AMS verwenden': 'Use AMS',
  'Magazin-Fach': 'Magazine slot',
  'keine anwendbaren Daten': 'no applicable data',
  'Bauteile & Anleitungen': 'Parts & instructions',
  'Bauteil {0}': 'Part {0}',
  'Profil aus aktueller Konfiguration erzeugt.': 'Profile created from current configuration.',
  '„{0}" in der Bibliothek gespeichert.': '“{0}” saved to the library.',
  'Keine gültige Profildatei (schema fehlt)': 'Not a valid profile file (schema missing)',
  'Datei konnte nicht gelesen werden: {0}': 'Could not read file: {0}',
  '„{0}" angewendet: {1}. Sequenzen werden erst beim nächsten Auto-Farm-Start ausgeführt.':
    '“{0}” applied: {1}. Sequences only run on the next Auto Farm start.',
  'Bündele Kalibrierung, Sequenzen, Regal-Konfiguration, Einstellungen und Bauteil-Anleitungen zu einer Datei — exportieren, importieren oder lokal speichern. Das Importieren führt keinen G-Code aus; Sequenzen laufen erst beim nächsten Auto-Farm-Start.':
    'Bundle calibration, sequences, rack configuration, settings and part instructions into a single file — export, import or save locally. Importing does not run any G-code; sequences only run on the next Auto Farm start.',
  'Profil erstellen & exportieren': 'Create & export profile',
  'Name': 'Name',
  'Drucker-Modell': 'Printer model',
  'Beschreibung': 'Description',
  '+ Bauteil': '+ Part',
  'Name (z.B. Greifer v2)': 'Name (e.g. Gripper v2)',
  'Link (optional)': 'Link (optional)',
  'Anleitung / Hinweise…': 'Instructions / notes…',
  'Aus aktueller Konfig erzeugen': 'Create from current config',
  '↓ Download (.om4d.json)': '↓ Download (.om4d.json)',
  'In Bibliothek speichern': 'Save to library',
  'Enthält:': 'Contains:',
  'Profil importieren': 'Import profile',
  '↑ Datei wählen': '↑ Select file',
  'Profildatei (.om4d.json) wählen oder ein Profil aus der Bibliothek laden.':
    'Select a profile file (.om4d.json) or load a profile from the library.',
  'Anwenden': 'Apply',
  '⚠ Überschreibt die aktuelle Kalibrierung/Sequenzen/Regal-Konfig. Vorher ggf. eigenes Profil sichern.':
    '⚠ Overwrites the current calibration/sequences/rack config. Back up your own profile first if needed.',
  'Lokale Bibliothek': 'Local library',
  'Noch keine Profile gespeichert.': 'No profiles saved yet.',
  'Laden': 'Load',

  /* ── RackManager ── */
  'Auf Leer zurücksetzen': 'Reset to empty',
  'Neues Rack anlegen': 'Create new rack',
  'z.B. Rack B': 'e.g. Rack B',
  'Reihen': 'Rows',
  'Spalten': 'Columns',
  'Höhe (mm)': 'Height (mm)',
  'Erstellt…': 'Creating…',
  'Erstellen': 'Create',
  'Laden fehlgeschlagen': 'Loading failed',
  'Fach {0} zurückgesetzt': 'Slot {0} reset',
  'Zurücksetzen fehlgeschlagen': 'Reset failed',
  'Fach {0} gesperrt': 'Slot {0} locked',
  'Fach {0} entsperrt': 'Slot {0} unlocked',
  'Aktion fehlgeschlagen': 'Action failed',
  'Alle Fächer auf "Leer" zurücksetzen?': 'Reset all slots to "Empty"?',
  '{0} Fach/Fächer zurückgesetzt': '{0} slot(s) reset',
  'Magazin aufgefüllt ({0} Platten)': 'Magazine refilled ({0} plates)',
  'Magazin auffüllen fehlgeschlagen': 'Magazine refill failed',
  'Gespeichert': 'Saved',
  'Speichern fehlgeschlagen': 'Save failed',
  'Rack wirklich löschen?': 'Really delete rack?',
  'Rack gelöscht': 'Rack deleted',
  'Löschen fehlgeschlagen': 'Delete failed',
  'Rack erstellt': 'Rack created',
  'Regal auswählen': 'Select rack',
  '+ Neues Rack': '+ New rack',
  'Rack löschen': 'Delete rack',
  'Aktiv:': 'Active:',
  '{0} Fächer': '{0} slots',
  '{0} Fach': '{0} slot',
  'Belegt durch „{0}" (ragt aus Fach {1})': 'Occupied by "{0}" (extends from slot {1})',
  '{0} mm Fachhöhe': '{0} mm slot height',
  'Rack Konfiguration': 'Rack configuration',
  'Anzahl Racks': 'Number of racks',
  '(nebeneinander)': '(side by side)',
  'Fächer pro Rack': 'Slots per rack',
  '(übereinander)': '(stacked)',
  'Fachhöhe (mm)': 'Slot height (mm)',
  'Speichert...': 'Saving...',
  'Aktuell: {0} Racks × {1} Fächer = {2} gesamt · {3} mm': 'Current: {0} racks × {1} slots = {2} total · {3} mm',
  'Rack Übersicht': 'Rack overview',
  'Platten entnehmen — Magazin füllt sich automatisch wieder auf': 'Remove plates — magazine refills automatically',
  'Alle entnehmen': 'Remove all',
  'Aktualisieren': 'Refresh',
  'Rack {0}': 'Rack {0}',
  'Status wird von Auto Farm verwaltet': 'Status is managed by Auto Farm',

  /* ── Setup wizard ── */
  'Willkommen': 'Welcome',
  'Überspringen →': 'Skip →',
  'Drucker · OTTOeject · Regal · Kalibrierung in einem Durchlauf.': 'Printer · OTTOeject · Rack · Calibration in one pass.',
  'Willkommen bei': 'Welcome to',
  'Bambu-Drucker verbinden (IP, Seriennummer, Access-Code)': 'Connect Bambu printer (IP, serial number, access code)',
  'OTTOeject/Klipper-Erreichbarkeit prüfen': 'Check OTTOeject/Klipper reachability',
  'Regal konfigurieren (Anzahl, Fächer, Fachhöhe)': 'Configure rack (count, slots, slot height)',
  'Homing-Datei für den Auswurf erstellen': 'Create homing file for ejection',
  "Los geht's →": "Let's go →",
  '✓ Drucker bereits konfiguriert:': '✓ Printer already configured:',
  'Bambu Lab Drucker verbinden. Access-Code & Seriennummer findest du am Druckerdisplay unter Einstellungen → WLAN.':
    "Connect a Bambu Lab printer. You'll find the access code & serial number on the printer display under Settings → WLAN.",
  'Name (z. B. Bambu X1C)': 'Name (e.g. Bambu X1C)',
  'IP-Adresse (192.168.1.100)': 'IP address (192.168.1.100)',
  'Seriennummer (z. B. 00M…)': 'Serial number (e.g. 00M…)',
  'Access-Code': 'Access code',
  'Teste…': 'Testing…',
  '🔌 Verbindung testen': '🔌 Test connection',
  '✓ Verbindung erfolgreich': '✓ Connection successful',
  'Verbindung fehlgeschlagen': 'Connection failed',
  '← Zurück': '← Back',
  'Weiter →': 'Next →',
  'Speichere…': 'Saving…',
  'Drucker speichern →': 'Save printer →',
  '✓ OTTOeject konfiguriert:': '✓ OTTOeject configured:',
  'Das OTTOeject läuft über Klipper/Moonraker. Gib die Moonraker-Adresse an (Standard-Port 7125).':
    'The OTTOeject runs via Klipper/Moonraker. Enter the Moonraker address (default port 7125).',
  'Name (z. B. OTTOeject)': 'Name (e.g. OTTOeject)',
  'IP-Adresse (192.168.1.101)': 'IP address (192.168.1.101)',
  'Port (7125)': 'Port (7125)',
  '✓ OTTOeject erreichbar': '✓ OTTOeject reachable',
  'nicht erreichbar': 'not reachable',
  'OTTOeject speichern →': 'Save OTTOeject →',
  'Wie ist dein Regal aufgebaut?': 'How is your rack set up?',
  'Fächer/Regal': 'Slots/rack',
  'Gesamt: {0} Fächer · bis {1} mm Objekthöhe je Fach': 'Total: {0} slots · up to {1} mm object height per slot',
  'Regal speichern →': 'Save rack →',
  'Für den Auswurf braucht die Farm eine Homing-Datei (G28 + Z200), die vor dem Greifen an den Drucker gesendet wird.':
    'For ejection the farm needs a homing file (G28 + Z200) that is sent to the printer before gripping.',
  '✓ Homing-Datei vorhanden': '✓ Homing file present',
  'Erstelle…': 'Creating…',
  'Homing-Datei erstellen': 'Create homing file',
  'Feinkalibrierung (Greifer-Offsets, Sequenzen) machst du danach unter': 'Fine calibration (gripper offsets, sequences) is done afterwards under',
  'und im': 'and in the',
  'Fertig ✓': 'Done ✓',

  /* ── System ── */
  'Darstellung': 'Appearance',
  'Farbschema der Oberfläche. Wird auf diesem Gerät gespeichert.': 'Interface color scheme. Saved on this device.',
  'Push aktiviert — du bekommst jetzt Benachrichtigungen': "Push enabled — you'll now receive notifications",
  'Aktivierung fehlgeschlagen': 'Activation failed',
  'Push deaktiviert': 'Push disabled',
  'Server-Push nicht verfügbar (Abhängigkeiten fehlen)': 'Server push not available (dependencies missing)',
  'Kein Gerät registriert — auf diesem Gerät „Push aktivieren" erneut antippen (über HTTPS).':
    'No device registered — tap "Enable push" again on this device (over HTTPS).',
  'Test gesendet ({0} Gerät(e))': 'Test sent ({0} device(s))',
  'unbekannter Fehler': 'unknown error',
  'Zustellung an {0} Gerät(e) fehlgeschlagen — {1}': 'Delivery to {0} device(s) failed — {1}',
  'Test fehlgeschlagen': 'Test failed',
  'Push-Benachrichtigungen': 'Push notifications',
  'Erhalte auf diesem Gerät Push-Meldungen bei „fertig / Fehler / Eingriff nötig" — auch als Home-Screen-App (iOS 16.4+).':
    'Receive push messages on this device for "done / error / intervention needed" — even as a home-screen app (iOS 16.4+).',
  'Dieser Browser/dieses Gerät unterstützt keine Web-Push-Benachrichtigungen.': 'This browser/device does not support web push notifications.',
  'Server-seitiger Push ist nicht verfügbar (Abhängigkeiten fehlen). Nach dem nächsten Image-Update aktiv.':
    'Server-side push is not available (dependencies missing). Active after the next image update.',
  'Aktiviere…': 'Enabling…',
  'Push aktivieren': 'Enable push',
  'Test senden': 'Send test',
  'Deaktivieren': 'Disable',
  'Versionscheck fehlgeschlagen — GitHub/Registry nicht erreichbar?': 'Version check failed — GitHub/registry unreachable?',
  'Fehler {0}': 'Error {0}',
  'Backup exportiert': 'Backup exported',
  'Export fehlgeschlagen: {0}': 'Export failed: {0}',
  'Backup wiederhergestellt (v{0}, exportiert: {1})': 'Backup restored (v{0}, exported: {1})',
  'Import fehlgeschlagen: {0}': 'Import failed: {0}',
  'Darstellung, Versionsverwaltung & Updates': 'Appearance, version management & updates',
  'Release-Kanal': 'Release channel',
  'Stabile Releases': 'Stable releases',
  'Aktive Entwicklung': 'Active development',
  'Beta-Kanal aktiv — neue Features vor dem stabilen Release. Docker-Image-Tag:':
    'Beta channel active — new features before the stable release. Docker image tag:',
  'Installiert': 'Installed',
  'Neueste': 'Latest',
  'Kanal': 'Channel',
  'Beta-Update verfügbar': 'Beta update available',
  'Update verfügbar — v{0}': 'Update available — v{0}',
  'Beta ist aktuell': 'Beta is up to date',
  'App ist aktuell (v{0})': 'App is up to date (v{0})',
  'Beta wird installiert/gewechselt': 'Installing/switching beta',
  'Update läuft': 'Update running',
  ' — App startet neu, bitte warten…': ' — app is restarting, please wait…',
  'Fertig — Seite wird neu geladen…': 'Done — reloading the page…',
  'Weder Docker-Socket noch Watchtower verfügbar — manuell:': 'Neither Docker socket nor Watchtower available — manually:',
  'Schließen': 'Close',
  'Kein Docker-Socket erkannt — Ein-Klick-Update ist nicht möglich. In der Compose-Datei':
    'No Docker socket detected — one-click update is not possible. In the compose file',
  'in den App-Container mounten (siehe': 'mount it into the app container (see',
  'Prüfe…': 'Checking…',
  'Auf Updates prüfen': 'Check for updates',
  'Aktualisiert…': 'Updating…',
  'Beta installieren / wechseln': 'Install / switch beta',
  'Update installieren': 'Install update',
  'Neu installieren': 'Reinstall',
  'Trotzdem neu installieren / Kanal wechseln': 'Reinstall anyway / switch channel',
  '⚠ Vor dem Update ein Backup machen': '⚠ Make a backup before updating',
  'Ein Update kann Einstellungen verändern. Exportiere zur Sicherheit zuerst ein Backup deiner Konfiguration (Geräte, Rack, Sequenzen, Zeitpläne) — dann erst aktualisieren.':
    'An update can change settings. To be safe, first export a backup of your configuration (devices, rack, sequences, schedules) — only then update.',
  '↓ Backup exportieren': '↓ Export backup',
  'Verstanden — Beta installieren / wechseln': 'Understood — install / switch beta',
  'Verstanden — jetzt aktualisieren': 'Understood — update now',
  'Updates laufen': 'Updates run',
  'nur auf Knopfdruck': 'only at the push of a button',
  '— kein automatisches Update im Hintergrund. Ein Klick zieht das gewählte Kanal-Image (':
    '— no automatic background update. One click pulls the selected channel image (',
  ' bzw.': ' or',
  ') und startet die App neu (auch der Kanalwechsel). Voraussetzung: Docker-Socket gemountet (siehe Compose).':
    ') and restarts the app (including the channel switch). Requirement: Docker socket mounted (see compose).',
  'Sichert die': 'Backs up the',
  'komplette Konfiguration': 'complete configuration',
  'als JSON: Geräte (Drucker & OTTOeject inkl. Zugangsdaten), Kamera-/HA-Einstellungen, Kalibrierung, Sequenzen, Farm-Einstellungen, Regal-Layout, Filamente, Zeitpläne & Sprachpakete — exportieren oder wiederherstellen.':
    'as JSON: devices (printer & OTTOeject incl. credentials), camera/HA settings, calibration, sequences, farm settings, rack layout, filaments, schedules & language packs — export or restore.',
  '⚠ Die Datei enthält Zugangsdaten (Drucker-Access-Code, HA-/Telegram-Token). Sicher aufbewahren und nicht teilen.':
    '⚠ The file contains credentials (printer access code, HA/Telegram token). Keep it safe and do not share it.',
  '↑ Backup importieren': '↑ Import backup',

  /* ── Datei-Browser: Multi-Plate-Dropdown ── */
  '{0} Platten': '{0} plates',
  'Diese Datei enthält {0} Platten — aufklappen für Einzeldruck': 'This file contains {0} plates — expand for per-plate printing',
  'Lade Platten…': 'Loading plates…',
  'Keine Platten-Infos in der Datei gefunden': 'No plate info found in the file',
  'Druckzeit dieser Platte': 'Print time of this plate',
  'Objekthöhe dieser Platte': 'Object height of this plate',
  'Nur diese Platte in die Auto-Farm-Queue legen': 'Add only this plate to the Auto Farm queue',
  'Nur diese Platte sofort drucken': 'Print only this plate now',
  '▶ Drucken': '▶ Print',
  'Platte {0}: {1}': 'Plate {0}: {1}',
  'Platte {0} in die Queue gelegt': 'Plate {0} added to the queue',

  /* ── System: native Linux-Installation ── */
  'Native Installation ohne Docker — Updates laufen per SSH-Befehl auf dem Gerät:':
    'Native installation without Docker — updates run via SSH command on the device:',

  /* ── System: Kamera-Energiesparmodus ── */
  'Kamera': 'Camera',
  'Kamera komplett deaktivieren (Energiesparmodus)': 'Disable camera completely (power-saving mode)',
  'Kamera ist komplett deaktiviert (Energiesparmodus)': 'Camera is completely disabled (power-saving mode)',
  'Schaltet den Kamera-Transcoder (ffmpeg) vollständig ab — Live-Bild und Drucker-Snapshots sind dann aus. Empfohlen für schwache Geräte wie Raspberry Pi: der Live-Stream kostet sonst mehrere CPU-Kerne. Externe Webcams (HTTP-URL) funktionieren weiter. Bei Neuinstallationen ist die Kamera standardmäßig deaktiviert.':
    'Completely turns off the camera transcoder (ffmpeg) — live view and printer snapshots are then off. Recommended for low-power devices like a Raspberry Pi: the live stream otherwise costs several CPU cores. External webcams (HTTP URL) keep working. On fresh installations the camera is disabled by default.',
  'Ein bereits laufender Kamera-Stream wird sofort beendet. Das Kamera-Panel im Auto-Farm-Dashboard zeigt einen Hinweis statt des Livebilds.':
    'An already running camera stream is stopped immediately. The camera panel on the Auto Farm dashboard shows a notice instead of the live view.',

  /* ── Netzwerk-Suche (Discovery) + Bauraumlüfter ── */
  '🔍 Netzwerk durchsuchen': '🔍 Scan network',
  'Netzwerk nach Bambu-Druckern (SSDP) und Klipper/Moonraker durchsuchen': 'Scan the network for Bambu printers (SSDP) and Klipper/Moonraker',
  'Suche…': 'Scanning…',
  'Suche im Netzwerk…': 'Scanning network…',
  '🔍 Drucker im Netzwerk suchen': '🔍 Find printer on the network',
  '🔍 OTTOeject im Netzwerk suchen': '🔍 Find OTTOeject on the network',
  'Gefundene Geräte': 'Discovered devices',
  'ausblenden': 'hide',
  'Suche fehlgeschlagen': 'Scan failed',
  'Nichts gefunden. In Docker (Bridge-Netz) kommen SSDP-Broadcasts nicht am Container an — nutze „network_mode: host" oder trage den Drucker manuell ein.':
    'Nothing found. In Docker (bridge network) SSDP broadcasts do not reach the container — use "network_mode: host" or add the printer manually.',
  'Kein Bambu gefunden — bitte manuell eintragen. (In Docker-Bridge-Netzen kommt SSDP nicht an.)':
    'No Bambu found — please enter manually. (In Docker bridge networks SSDP does not arrive.)',
  'Kein Klipper/Moonraker gefunden — bitte manuell eintragen.': 'No Klipper/Moonraker found — please enter manually.',
  'Seriennummer nicht ermittelt (Port-Scan) — bitte manuell': 'Serial number not detected (port scan) — please enter manually',
  'Seriennummer manuell nötig': 'Serial number needed manually',
  'Access-Code wird nie mitgesendet — den trägst du selbst ein.': 'The access code is never broadcast — you enter it yourself.',
  'bereits angelegt': 'already added',
  'Printloom läuft in einem Docker-Bridge-Netz und sieht dein LAN nicht automatisch (die erkannte IP ist die Container-Adresse 172.x). Gib dein LAN-Subnetz ein und suche erneut — oder nutze „network_mode: host".':
    'Printloom is running in a Docker bridge network and cannot see your LAN automatically (the detected IP is the container address 172.x). Enter your LAN subnet and scan again — or use "network_mode: host".',
  'Printloom läuft in einem Docker-Bridge-Netz und sieht dein LAN nicht automatisch. Gib dein LAN-Subnetz ein und suche erneut — oder nutze „network_mode: host".':
    'Printloom is running in a Docker bridge network and cannot see your LAN automatically. Enter your LAN subnet and scan again — or use "network_mode: host".',
  '(erste drei Zahlen deiner LAN-IP)': '(first three numbers of your LAN IP)',
  'Erneut suchen': 'Scan again',

  /* ── Historie + Crash-Warnung + Queue ── */
  'Historie': 'History',
  'anzeigen': 'show',
  'Status': 'Status',
  'Start': 'Start',
  'Ende': 'End',
  'Dauer': 'Duration',
  'Geborgen': 'Recovered',
  'Alle abgeschlossenen Druck-Jobs mit Datum, Anfangs- und End-Uhrzeit.': 'All completed print jobs with date, start and end time.',
  'Historie leeren': 'Clear history',
  'Wirklich die gesamte Druck-Historie löschen? Das kann nicht rückgängig gemacht werden.': 'Really delete the entire print history? This cannot be undone.',
  'Noch keine abgeschlossenen Drucke.': 'No completed prints yet.',
  '{0} fertig — ausgeblendet': '{0} done — hidden',
  'Historie öffnen →': 'Open history →',
  'Mögliche Kollision mit dem OTTOeject-Arm — klicken für Details': 'Possible collision with the OTTOeject arm — click for details',
  'Wahrscheinliche Kollision mit dem OTTOeject-Arm': 'Likely collision with the OTTOeject arm',
  'Oberhalb von {0} mm Höhe ragt der Druck bei Z={1} mm auf X={2} mm in die seitliche Randzone (0–{3} mm bzw. {4}–{5} mm). Dort fährt der OTTOeject-Arm beim Auswerfen und Einlagern entlang — beim Druck dieser Datei kommt es sehr wahrscheinlich zu einem Crash.':
    'Above {0} mm height the print reaches X={2} mm at Z={1} mm into the side margin (0–{3} mm or {4}–{5} mm). The OTTOeject arm travels there when ejecting and storing — printing this file will very likely cause a crash.',
  'Geprüft wird der gesamte G-code (inkl. Verfahrwege): oberhalb von {0} mm Höhe darf kein X-Wert unter {1} mm oder über {2} mm liegen. Verschiebe das Objekt zur Bettmitte oder halte in der Randzone unter {0} mm Höhe.':
    'The entire G-code is checked (incl. travel moves): above {0} mm height no X value may be below {1} mm or above {2} mm. Move the object toward the bed center or keep anything in the margin zone below {0} mm height.',

  /* ── Release-Kanal-Toggle + History-Requeue + Backup ── */
  'Zwischen Latest (stabil) und Beta umschalten': 'Toggle between Latest (stable) and Beta',
  'Beta ist NICHT stabil und kann Fehler enthalten — Nutzung auf eigene Gefahr. Vor dem Wechsel ein Backup exportieren.':
    'Beta is NOT stable and may contain bugs — use at your own risk. Export a backup before switching.',
  'Stabile Releases — empfohlen für den Produktivbetrieb.': 'Stable releases — recommended for production use.',
  'Stabil': 'Stable',
  'Entwicklung': 'Development',
  '„{0}" in die Warteschlange gelegt': '"{0}" added to the queue',
  'In die Warteschlange legen fehlgeschlagen': 'Adding to the queue failed',
  'Datei nicht mehr verfügbar': 'File no longer available',
  '+ Warteschlange': '+ Queue',
  'Dieses Modell erneut in die Warteschlange legen': 'Add this model to the queue again',
  'als JSON: Geräte (Drucker & OTTOeject inkl. Zugangsdaten), Drucker-/Kamera-/HA-Einstellungen, Drucker-Geometrie (X-Positionen & G-code-Overrides), Profile, Kalibrierung, Sequenzen, Farm-Einstellungen, Regal-Layout, Filamente, Zeitpläne & Sprachpakete — exportieren oder wiederherstellen.':
    'as JSON: devices (printer & OTTOeject incl. credentials), printer/camera/HA settings, printer geometry (X positions & G-code overrides), profiles, calibration, sequences, farm settings, rack layout, filaments, schedules & language packs — export or restore.',
  '🌀 Bauraumlüftung dauerhaft aus': '🌀 Keep chamber fan off',
  'Bauraumlüftung dauerhaft ausgeschaltet halten': 'Keep the chamber ventilation permanently off',
  'Prüft laufend über die MQTT-Verbindung und schaltet den Bauraumlüfter (P3) aus, sobald er anläuft.':
    'Continuously checks via the MQTT connection and turns the chamber fan (P3) off whenever it starts.',

  /* ── Configuration ── */
  'Geräte': 'Devices',
  'Kameras': 'Cameras',
  'Allgemein': 'General',
  'Pack braucht code + translations': 'Pack needs code + translations',
  'Sprachpaket „{0}" importiert.': 'Language pack "{0}" imported.',
  'Sprache & Sprachpakete': 'Language & language packs',
  'Standard ist Deutsch. Weitere Sprachen lassen sich aus dem Server-Katalog laden oder als Datei importieren.':
    'German is the default. Additional languages can be loaded from the server catalog or imported as a file.',
  'Installierte Pakete': 'Installed packs',
  'Pack importieren': 'Import pack',
  'Einstellungen gespeichert.': 'Settings saved.',
  'Homing-Datei erstellt.': 'Homing file created.',
  'Farm-Einstellungen': 'Farm settings',
  'Drucker-Poll, Mindestdruckzeit, AMS, Homing-Datei': 'Printer poll, minimum print time, AMS, homing file',
  'Drucker-Poll (Sekunden)': 'Printer poll (seconds)',
  'Mindestdruckzeit (Minuten)': 'Minimum print time (minutes)',
  '(deaktiviert)': '(disabled)',
  'min': 'min',
  'Homing-Datei (G28 + Z200)': 'Homing file (G28 + Z200)',
  '↺ Neu erstellen': '↺ Recreate',
  '+ Erstellen': '+ Create',
  'Generiert eine .3mf mit G28+Z200 — im Sequenzeditor als ⇫ Homing verwenden':
    'Generates a .3mf with G28+Z200 — use as ⇫ Homing in the sequence editor',
  'Regal gespeichert.': 'Rack saved.',
  'Größe, Fach-Höhen, Magazin-Fach und Platten-Anzahl pro Rack': 'Size, slot heights, magazine slot and plate count per rack',
  'Fächer/Rack': 'Slots/rack',
  'Fach-Höhe (mm)': 'Slot height (mm)',
  'Höhen-Toleranz (%)': 'Height tolerance (%)',
  '— Sicherheitspuffer': '— safety buffer',
  'z.B. 100 mm → {0} mm effektiv': 'e.g. 100 mm → {0} mm effective',
  'Fach in jedem Rack (Standard: 7)': 'Slot in each rack (default: 7)',
  'Platten pro Magazin': 'Plates per magazine',
  '— aktueller Bestand': '— current stock',
  '— feste Sollzahl': '— fixed target count',
  'Fest je Magazin. „↺ Reset" (Regal-Ansicht) und Auffüllen stellen genau diese Zahl wieder her; sie bildet auch die Obergrenze im Magazin-Badge. Farm leert Rack 1 zuerst, dann 2, dann 3 usw.':
    'Fixed per magazine. "↺ Reset" (rack view) and refill restore exactly this number; it is also the upper limit in the magazine badge. Farm empties rack 1 first, then 2, then 3, etc.',
  'Farm leert Rack 1 zuerst, dann 2, dann 3 usw.': 'Farm empties rack 1 first, then 2, then 3, etc.',
  '= {0} gesamt': '= {0} total',
  'z. B. 00M…': 'e.g. 00M…',
  'Kameras (AutoFarm)': 'Cameras (AutoFarm)',
  'Erst unter „Geräte" einen Bambu-Drucker anlegen — dann hier die Kameras konfigurieren.':
    'First add a Bambu printer under "Devices" — then configure the cameras here.',
  'Oben (Bambu / quer)': 'Top (Bambu / landscape)',
  'Unten (hochkant)': 'Bottom (portrait)',
  '🏠 X1C-Kamera über Home Assistant': '🏠 X1C camera via Home Assistant',
  ' — für die eingebaute Cam (oben). Wird in AutoFarm automatisch als „Oben"-Kamera genutzt.':
    ' — for the built-in cam (top). Used automatically as the "Top" camera in AutoFarm.',
  'HA-URL': 'HA URL',
  'Entity-ID': 'Entity ID',
  'Token': 'Token',
  '•••••• (gesetzt — leer lassen zum Behalten)': '•••••• (set — leave empty to keep)',
  'Long-Lived Access Token aus HA': 'Long-Lived Access Token from HA',
  'Testen': 'Test',
  'prüfe …': 'checking …',
  'erst speichern, dann testen': 'save first, then test',
  'HA-Kamera entfernen': 'Remove HA camera',
  'Typ wird automatisch erkannt — Port 8889 = WebRTC (<1 s), 8888/.m3u8 = HLS, sonst MJPEG.':
    'Type is auto-detected — port 8889 = WebRTC (<1 s), 8888/.m3u8 = HLS, otherwise MJPEG.',

  /* ── Navigation ── */
  'Nur .gcode / .3mf': 'Only .gcode / .3mf',
  'Upload fehlgeschlagen': 'Upload failed',
  'Hochladen…': 'Uploading…',
  'Hochgeladen': 'Uploaded',
  'Hier ablegen': 'Drop here',
  'Schnell-Upload': 'Quick upload',
  'Seitenleiste erweitern': 'Expand sidebar',
  'Navigation': 'Navigation',
  'Seitenleiste minimieren': 'Collapse sidebar',
  'Update verfügbar': 'Update available',

  /* ── Steuerung (Control) ── */
  'Offline': 'Offline',
  'Klipper Konfiguration': 'Klipper configuration',
  'Nur lesend — Mainsail config/': 'Read-only — Mainsail config/',
  'Klicke „Laden" um die Konfigurationsdateien anzuzeigen.': 'Click "Load" to show the configuration files.',
  'Keine .cfg Dateien gefunden.': 'No .cfg files found.',
  'Kein Bambu Lab Gerät konfiguriert': 'No Bambu Lab device configured',
  '{0} — gesendet': '{0} — sent',
  '{0} — OK': '{0} — OK',
  'Ungültiger Z-Wert': 'Invalid Z value',
  'NOTAUS — alle Geräte deaktivieren?': 'EMERGENCY STOP — disable all devices?',
  'Notaus aktiviert': 'Emergency stop activated',
  'Betrieb fortgesetzt': 'Operation resumed',
  'Düse: {0}°C (Ziel {1}°C)': 'Nozzle: {0}°C (target {1}°C)',
  'Bett: {0}°C (Ziel {1}°C)': 'Bed: {0}°C (target {1}°C)',
  'Notaus': 'Emergency stop',
  '▶ Betrieb fortsetzen': '▶ Resume operation',
  'Warnschwelle': 'Warning threshold',
  '⟳ Man.': '⟳ Man.',
  'Jetzt': 'Now',
  'Temperaturwarnung': 'Temperature warning',
  'Fortschritt': 'Progress',
  'Schicht {0} / {1}': 'Layer {0} / {1}',
  '{0} verbleibend': '{0} remaining',
  'Webcam': 'Webcam',
  'Eingebaute X1C-Kamera (LAN-Liveview muss am Drucker aktiv sein)': 'Built-in X1C camera (LAN live view must be enabled on the printer)',
  '⏹ Live stoppen': '⏹ Stop live',
  '📷 Live (X1C)': '📷 Live (X1C)',
  'URL ändern': 'Change URL',
  'Externe Kamera (MJPEG/HTTP). Für die eingebaute X1C-Kamera einfach „📷 Live (X1C)".':
    'External camera (MJPEG/HTTP). For the built-in X1C camera just use "📷 Live (X1C)".',
  'X1C-Kamera nicht erreichbar': 'X1C camera not reachable',
  '„LAN-Modus Liveview" am Drucker aktivieren (Einstellungen → Allgemein), im selben Netz sein und sicherstellen, dass keine andere App (Bambu Studio / Handy-App) die Kamera belegt.':
    'Enable "LAN Mode Live View" on the printer (Settings → General), be on the same network and make sure no other app (Bambu Studio / phone app) is using the camera.',
  'Neu verbinden': 'Reconnect',
  'Stream-Verbindung abgebrochen': 'Stream connection dropped',
  'Verbinde mit Kamera …': 'Connecting to camera …',
  'Webcam nicht erreichbar': 'Webcam not reachable',
  'Keine Kamera aktiv': 'No camera active',
  '📷 X1C Live starten': '📷 Start X1C live',
  'Externe URL': 'External URL',
  'Düsentemperatur': 'Nozzle temperature',
  'Betttemperatur': 'Bed temperature',
  'Auswerfen': 'Eject',
  'Einlegen': 'Load',
  'Holen aus Fach': 'Grab from slot',
  'Einlagern in Fach': 'Store to slot',
  'Läuft:': 'Running:',
  'Z Kalibrierung': 'Z calibration',
  'Schrittweite (mm)': 'Step size (mm)',
  'Z Zielwert mm': 'Z target value mm',
  'Fahren': 'Move',
  'Einzel-Fach': 'Single slot',
  'Fach {0} holen': 'Grab slot {0}',
  'Fach {0} einlagern': 'Store slot {0}',
  'Holen': 'Grab',
  'Einlagern': 'Store',
  'In Drucker': 'Into printer',
  'Aus Drucker': 'From printer',

  /* ── Sequence Editor ── */
  'OTTOeject Makro': 'OTTOeject macro',
  'OTTOeject GCode': 'OTTOeject GCode',
  'Bambu GCode': 'Bambu GCode',
  'Bambu Position Z': 'Bambu position Z',
  'Bambu Homing': 'Bambu homing',
  'Druckdatei senden': 'Send print file',
  'Auf Druckende warten': 'Wait for print end',
  'Bambu IDLE (alt)': 'Bambu IDLE (old)',
  'Feste Datei': 'Fixed file',
  'Warten (PAUSE)': 'Wait (PAUSE)',
  'Warten (FAILED)': 'Wait (FAILED)',
  'Fehler quit.': 'Clear error',
  'Fehler werden ignoriert': 'Errors are ignored',
  'Nur wenn {0} {1} {2}': 'Only if {0} {1} {2}',
  'Wird ~1 Min vor Druckende vorgezogen': 'Brought forward ~1 min before print end',
  'Einzeln ausführen: {0}': 'Run individually: {0}',
  'Schritt aktivieren': 'Enable step',
  'Schritt deaktivieren': 'Disable step',
  'Parallel mit vorherigem Schritt ausführen': 'Run in parallel with previous step',
  'Bearbeiten': 'Edit',
  'Nach oben': 'Move up',
  'Nach unten': 'Move down',
  'Löschen': 'Delete',
  'Löschen ({0})': 'Delete ({0})',
  'Dateien löschen': 'Delete files',
  'Ausgewählte Dateien löschen': 'Delete selected files',
  '{0} ausgewählte Datei(en) löschen? Das kann nicht rückgängig gemacht werden.':
    'Delete {0} selected file(s)? This cannot be undone.',
  '{0} Datei(en) gelöscht': '{0} file(s) deleted',
  '{0} Datei(en) konnten nicht gelöscht werden': '{0} file(s) could not be deleted',
  'Schritt verschieben': 'Move step',
  'Bezeichnung': 'Label',
  'Verwendet die Homing-Datei aus Auto Farm → Einstellungen. Bambu meldet FINISH wenn G28+Z200 abgeschlossen → danach wait_print.':
    'Uses the homing file from Auto Farm → Settings. Bambu reports FINISH when G28+Z200 is done → then wait_print.',
  'Datei-ID': 'File ID',
  '· Dateiliste → ID der hochgeladenen Homing-.3mf': '· File list → ID of the uploaded homing .3mf',
  'z.B. 3': 'e.g. 3',
  'Sendet diese Datei als echten Druckjob → Bambu meldet FINISH wenn fertig. Danach wait_print für zuverlässige Z200-Erkennung.':
    'Sends this file as a real print job → Bambu reports FINISH when done. Then wait_print for reliable Z200 detection.',
  'Makro-Name': 'Macro name',
  'GCode (an OTTOeject)': 'GCode (to OTTOeject)',
  'G-Code (an Bambu)': 'G-code (to Bambu)',
  'Ziel': 'Target',
  'Vorrat': 'Stock',
  '· blockiert bis Position erreicht — kein Delay nötig': '· blocks until position reached — no delay needed',
  'Wartezeit': 'Wait time',
  'Sekunden': 'Seconds',
  'Z-Höhe (mm)': 'Z height (mm)',
  'Feed (mm/min)': 'Feed (mm/min)',
  'Sendet G1 Z{0} F{1} + M400 als Mini-Druck und wartet, bis der Drucker FINISH meldet — also wirklich in Position ist (kein blinder Timer).':
    'Sends G1 Z{0} F{1} + M400 as a mini print and waits until the printer reports FINISH — i.e. is really in position (no blind timer).',
  'Mindestdauer G28+Z200': 'Minimum duration G28+Z200',
  'Wartet die verbleibende Zeit bis G28+Z200 fertig ist. Zeit der Zwischenschritte (Homen, Tür, Platte holen) wird automatisch abgezogen.':
    'Waits the remaining time until G28+Z200 is done. The time of the intermediate steps (homing, door, grab plate) is subtracted automatically.',
  'Timeout': 'Timeout',
  'Pollt MQTT bis gcode_state == PAUSE (= M400 U1 fertig, Drucker auf Z200 geparkt). Crash-Schutz: bei FAILED oder Timeout → Platte NICHT einlegen, Sequenz abgebrochen.':
    'Polls MQTT until gcode_state == PAUSE (= M400 U1 done, printer parked at Z200). Crash protection: on FAILED or timeout → do NOT load plate, sequence aborted.',
  'Optional — Fehler ignorieren, Schritt gilt immer als fertig': 'Optional — ignore errors, step always counts as done',
  '⏱ Vor Druckende vorziehen — startet ~1 Min vor Druckende (OTTOeject schon mal in Position)':
    '⏱ Bring forward before print end — starts ~1 min before print end (OTTOeject already in position)',
  'Bedingung': 'Condition',
  '— immer ausführen —': '— always run —',
  'Kammertemperatur': 'Chamber temperature',
  'Druckerstatus': 'Printer status',
  'Sonst wird der Schritt übersprungen (bei Lesefehler läuft er sicherheitshalber).':
    'Otherwise the step is skipped (on a read error it runs as a safety measure).',
  '↺ Standard': '↺ Default',
  'Keine Schritte — über + Hinzufügen ergänzen': 'No steps — add via + Add',
  '∥ gleichzeitig': '∥ simultaneously',
  '+ Hinzufügen:': '+ Add:',
  'Ziel-Fach des Jobs': "job's target slot",
  'Vorrat-Stapel (aus Regal-Einstellungen)': 'stock stack (from rack settings)',
  'R1 = Regal am Drucker — RACK=… wird beim Senden automatisch in die Geräte-Zählung übersetzt (Geräte-Macro zählt vom Homing-Punkt rechts)':
    'R1 = rack next to the printer — RACK=… is translated to the device numbering automatically on send (device macros count from the homing point on the right)',
  'Auf Z200 warten': 'Wait for Z200',
  'Sendet G28 + schnelles Z200 (F3000) als Mini-Druck — die Datei wird automatisch frisch erzeugt.':
    'Sends G28 + a fast Z200 (F3000) as a mini print — the file is regenerated automatically.',
  '⏩ Nicht warten — Drucker homet im Hintergrund, OTTOeject arbeitet parallel weiter (danach Schritt „Auf Z200 warten" einplanen!)':
    '⏩ Don\'t wait — the printer homes in the background while the OTTOeject keeps working (add a "Wait for Z200" step afterwards!)',
  'Wartet, bis der im Hintergrund gestartete Homing-Druck fertig ist (Bett wirklich auf Z200) — gehört ans Ende des First Start, wenn beim Homing-Schritt „Nicht warten" aktiv ist.':
    'Waits until the homing print started in the background has finished (bed truly at Z200) — belongs at the end of First Start when the homing step has "Don\'t wait" enabled.',
  'Wartet nicht — Drucker homet im Hintergrund („Auf Z200 warten" holt das Ergebnis ab)':
    'Does not wait — the printer homes in the background ("Wait for Z200" picks up the result)',
  '▶ First Start — einmal beim Start-Knopf': '▶ First Start — once when you press Start',
  '↻ Zyklus — jeder Job': '↻ Cycle — every job',
  'Endet mit Platte im Greifer vor dem Drucker — Job 1 startet im Zyklus direkt HINTER dem Griff (alles davor entfällt).':
    'Ends with the plate in the gripper in front of the printer — job 1 starts in the cycle right AFTER the grab (everything before it is skipped).',
  'Job 1 überspringt alles bis inkl. diesem Griff (First Start übergibt) — ab Job 2 läuft der Zyklus komplett':
    'Job 1 skips everything up to and including this grab (First Start hands over) — from job 2 on the full cycle runs',
  'Kein aktiver Griff-Schritt im Zyklus — ab Job 2 wird KEINE neue Platte geholt! Der Zyklus-Griff ist keine Dopplung zum First Start: Job 1 überspringt ihn automatisch, ab Job 2 holt er die Platte. Bitte „Platte holen" wieder einfügen (Makro GRAB_FROM_RACK oder Printloom-Op „Aus Magazin holen").':
    'No active grab step in the cycle — from job 2 on, NO new plate will be fetched! The cycle grab is not a duplicate of First Start: job 1 skips it automatically, from job 2 on it fetches the plate. Please re-add "grab plate" (macro GRAB_FROM_RACK or Printloom op "Grab from magazine").',
  'First Start hat die Platte schon geholt und wartet vor dem Drucker (Tür offen). Beim 1. Job überspringt der Zyklus deshalb alles bis einschließlich diesem Griff und macht direkt danach weiter. Ab Job 2 läuft der Zyklus komplett — der Griff ist KEINE Dopplung.':
    'First Start already fetched the plate and waits in front of the printer (door open). On job 1 the cycle therefore skips everything up to and including this grab and continues right after it. From job 2 on the full cycle runs — the grab is NOT a duplicate.',
  'Sendet G28 + schnelles Z200 als Mini-Druck (Datei wird automatisch erzeugt) — mit ⏩ homet der Drucker im Hintergrund weiter':
    'Sends G28 + a fast Z200 as a mini print (file is generated automatically) — with ⏩ the printer keeps homing in the background',
  'Holt das Ergebnis des im Hintergrund gestarteten Homings ab — Bett sicher auf Z200, dann geht es weiter':
    'Picks up the result of the background homing — bed safely at Z200, then the flow continues',
  'Bett per Roh-G-Code auf Z fahren (schnell, ohne Druck-Vorbereitung)':
    'Move the bed to Z via raw G-code (fast, no print preparation)',
  'Vorziehen': 'Run early',
  'Badge am Schritt: startet ~1 Min vor Druckende (nur im Zyklus wählbar) — z.B. Homen + vor Drucker fahren':
    'Badge on a step: starts ~1 min before the print ends (cycle only) — e.g. homing + moving to the printer',
  'Übergabe': 'Handover',
  'Grüne Marke im Zyklus: hier übergibt der First Start — der Griff des 1. Jobs wird übersprungen (Platte schon im Greifer)':
    'Green mark in the cycle: First Start hands over here — job 1 skips its grab (plate already in the gripper)',
  'Schritt gleichzeitig mit dem vorigen Schritt ausführen':
    'Run this step simultaneously with the previous one',
  'Ungültiges Format — seq_new / seq_next fehlen': 'Invalid format — seq_new / seq_next missing',
  'Ablauf des Auto Farms anpassen — Reihenfolge, Zeiten und Parallelausführung. Änderungen werden sofort gespeichert und beim nächsten Lauf verwendet.':
    'Customize the Auto Farm workflow — order, timings and parallel execution. Changes are saved immediately and used on the next run.',
  'Sequenzen aus JSON-Datei laden': 'Load sequences from JSON file',
  '↑ Import': '↑ Import',
  'Alle Sequenzen als JSON-Datei speichern': 'Save all sequences as a JSON file',
  '↓ Export': '↓ Export',
  'First Start (einmal)': 'First Start (once)',
  'Läuft genau einmal beim Farm-Start. Standard: Drucker homet im Hintergrund auf Z200, währenddessen holt das OTTOeject schon die erste Platte und wartet vor dem Drucker — der Zyklus überspringt seinen Griff dann automatisch.':
    'Runs exactly once at farm start. Default: the printer homes to Z200 in the background while the OTTOeject already fetches the first plate and waits in front of the printer — the cycle then skips its own grab automatically.',
  'Zyklus (jeder Job)': 'Cycle (every job)',
  'Wiederkehrender Ablauf für JEDEN Job. ⏱-markierte Schritte starten ~1 Min vor Druckende.':
    'Recurring workflow for EVERY job. ⏱-marked steps start ~1 min before print end.',
  'Legende': 'Legend',
  'Klipper GCode': 'Klipper GCode',
  'Makro': 'Macro',
  'Warte Z200': 'Wait Z200',
  'Delay': 'Delay',
  'Homing': 'Homing',
  'Senden': 'Send',
  'Warten': 'Wait',
  'Optional': 'Optional',
  'Parallel': 'Parallel',
  'Aktiv/Inaktiv': 'Active/Inactive',
  'Drag-Handle': 'Drag handle',
  'G-Code an Bambu Lab via MQTT — fire-and-forget, kein Completion-Feedback':
    'G-code to Bambu Lab via MQTT — fire-and-forget, no completion feedback',
  'Raw GCode an OTTOeject (Klipper) — blockiert bis Position erreicht, kein Delay nötig':
    'Raw GCode to OTTOeject (Klipper) — blocks until position reached, no delay needed',
  'OTTOeject-Makro — {rack} = Rack-Nr, {slot} = Fach-Nr (z.B. GRAB_FROM_RACK RACK={rack} SLOT={slot})':
    'OTTOeject macro — {rack} = rack no., {slot} = slot no. (e.g. GRAB_FROM_RACK RACK={rack} SLOT={slot})',
  'Wartet verbleibende G28-Zeit — Zwischenschritte (Homen, Tür, Platte) werden automatisch abgezogen':
    'Waits the remaining G28 time — intermediate steps (homing, door, plate) are subtracted automatically',
  'Feste Wartezeit — nur nötig wenn kein synchrones Feedback möglich':
    'Fixed wait time — only needed when no synchronous feedback is possible',
  'Konfigurierte Homing-.3mf senden (G28+Z200) — Bambu meldet FINISH → wait_print erkennt Z200 zuverlässig':
    'Send the configured homing .3mf (G28+Z200) — Bambu reports FINISH → wait_print reliably detects Z200',
  'Aktuelle Job-Druckdatei an den Bambu Lab senden': 'Send the current job print file to the Bambu Lab',
  'Beliebige Datei per ID aus der Dateiliste senden': 'Send any file by ID from the file list',
  'Per MQTT-Polling auf Druckende warten (FINISH) — hier läuft der 1-min Vorstart':
    'Wait for print end via MQTT polling (FINISH) — the 1-min pre-start runs here',
  'Pollt MQTT bis gcode_state=PAUSE (M400 U1 fertig) — Crash-Schutz bei FAILED oder Timeout':
    'Polls MQTT until gcode_state=PAUSE (M400 U1 done) — crash protection on FAILED or timeout',
  'Per MQTT-Polling auf Druckfehler warten (FAILED) — Sequenz läuft normal weiter':
    'Wait for a print error via MQTT polling (FAILED) — sequence continues normally',
  'Sendet stop-Befehl an Bambu — setzt FAILED zurück auf IDLE, Drucker bereit für nächsten Job':
    'Sends a stop command to Bambu — resets FAILED back to IDLE, printer ready for the next job',
  'Fehler werden ignoriert — Schritt gilt immer als erfolgreich abgeschlossen, Sequenz läuft weiter':
    'Errors are ignored — step always counts as successfully completed, sequence continues',
  'Schritt gleichzeitig mit dem vorigen Schritt ausführen (asyncio.gather)':
    'Run step simultaneously with the previous step (asyncio.gather)',
  'on = Schritt aktiv · off = deaktiviert (wird beim Ausführen übersprungen, bleibt in der Liste)':
    'on = step active · off = disabled (skipped during execution, stays in the list)',
  'Rechts am Schritt — Klicken und Ziehen zum freien Verschieben in der Liste':
    'On the right of the step — click and drag to move it freely in the list',

  /* ── File Library ── */
  'Vorschau anzeigen': 'Show preview',
  'Hochgeladen am {0} um {1} Uhr': 'Uploaded on {0} at {1}',
  'AMS-Analyse': 'AMS analysis',
  'Keine Filament-Info gefunden': 'No filament info found',
  'Filament-Preset für AutoFarm': 'Filament preset for AutoFarm',
  'Filament-Preset': 'Filament preset',
  'Filament für diese Datei fixieren — wird beim Druck immer so verwendet':
    'Pin the filament for this file — always used when printing',
  'Filament fixieren': 'Pin filament',
  'Filament fixiert': 'Filament pinned',
  'Filamente im Druck': 'Filaments in the print',
  'Filamente & AMS-Zuordnung': 'Filaments & AMS mapping',
  'manuell': 'manual',
  'Manuell — wird beim Druck verwendet': 'Manual — used when printing',
  'Automatisch (Material + Farbe)': 'Automatic (material + color)',
  'Anderes Material — Druck pausiert': 'Different material — print pauses',
  '↺ Automatisch': '↺ Automatic',
  'Automatisch aus dem aktiven AMS gelernt + manuell · {0} Filament(e)':
    'Learned automatically from the active AMS + manual · {0} filament(s)',
  'Filamente (AMS + manuell)': 'Filaments (AMS + manual)',
  'Alle löschen': 'Clear all',
  '↻ Aus AMS aktualisieren': '↻ Refresh from AMS',
  'Lese AMS…': 'Reading AMS…',
  'Kein AMS erkannt — Drucker offline oder keine Spulen?': 'No AMS detected — printer offline or no spools?',
  '{0} aus dem AMS hinzugefügt': '{0} added from the AMS',
  'AMS bereits aktuell ({0} Spulen)': 'AMS already up to date ({0} spools)',
  'AMS konnte nicht gelesen werden': 'Could not read the AMS',
  '+ Manuell hinzufügen': '+ Add manually',
  'Neu geladene Spulen im AMS werden automatisch erkannt und hier ergänzt (mit Hinweis unten).':
    'Newly loaded AMS spools are detected automatically and added here (with a toast at the bottom).',
  'Alle Filamente löschen': 'Clear all filaments',
  'Die gesamte Filament-Bibliothek leeren? Sie wird danach automatisch wieder aus dem aktiven AMS gelernt.':
    'Clear the entire filament library? It will be re-learned automatically from the active AMS afterwards.',
  'Bibliothek geleert.': 'Library cleared.',
  'Noch keine Filamente. Lade Spulen ins AMS (werden automatisch erkannt) oder füge manuell hinzu.':
    'No filaments yet. Load spools into the AMS (auto-detected) or add manually.',
  'Keine Filament-Info in der Datei': 'No filament info in the file',
  'Wird beim Druck material- und farbgenau dem AMS zugeordnet (nie materialübergreifend).':
    'Mapped to the AMS by exact material and color when printing (never across materials).',
  'Festgelegtes Filament wird beim Drucken IMMER verwendet (kein Auto-Raten aus der Datei) und im AMS exakt gesucht. Dauerhaft gespeichert.':
    'The chosen filament is ALWAYS used when printing (no auto-guessing from the file) and matched exactly in the AMS. Saved permanently.',
  'AMS: {0} Slots — beim Hinzufügen wird exakte Farbe gesucht, sonst nächstes gleiches Material':
    'AMS: {0} slots — on adding, the exact color is searched, otherwise the nearest same material',
  'Einmal festlegen — wird beim Hinzufügen zur Queue automatisch auf den passenden AMS-Slot gemappt':
    'Set once — automatically mapped to the matching AMS slot when added to the queue',
  'Exakte Farbe im AMS': 'Exact color in AMS',
  'Material passt, andere Farbe (Slot {0})': 'Material matches, different color (slot {0})',
  'Kein passender AMS-Slot': 'No matching AMS slot',
  'Filament ändern': 'Change filament',
  'Keine Ergebnisse': 'No results',
  '+ Filament': '+ Filament',
  'Preset löschen': 'Delete preset',
  'Für Queue auswählen': 'Select for queue',
  'SKU / Teile-Nr.': 'SKU / part no.',
  'Teilenummer / SKU': 'Part number / SKU',
  'Material': 'Material',
  '#Farbe': '#Color',
  'Tags (Komma)': 'Tags (comma)',
  'Tags': 'Tags',
  'Ordner': 'Folder',
  '📁 Wurzel': '📁 Root',
  'In die Auto-Farm-Queue legen': 'Add to the Auto Farm queue',
  '+ Queue': '+ Queue',
  'Sofort an Drucker senden (ohne Queue)': 'Send to printer immediately (no queue)',
  'Kein Bambu-Gerät konfiguriert': 'No Bambu device configured',
  'Sende…': 'Sending…',
  'Drucken': 'Print',
  'Ordner „{0}" erstellt': 'Folder "{0}" created',
  'Ordner konnte nicht erstellt werden': 'Folder could not be created',
  'Ordner „{0}" löschen? Inhalt wandert eine Ebene nach oben.': 'Delete folder "{0}"? Its contents move up one level.',
  'Ordner „{0}" gelöscht': 'Folder "{0}" deleted',
  'Ordner konnte nicht gelöscht werden': 'Folder could not be deleted',
  'Umbenennen fehlgeschlagen': 'Rename failed',
  'Verschieben fehlgeschlagen': 'Move failed',
  '{0} Dateien hochgeladen': '{0} files uploaded',
  '{0} hochgeladen, {1} fehlgeschlagen': '{0} uploaded, {1} failed',
  '"{0}" löschen?': 'Delete "{0}"?',
  'Senden fehlgeschlagen': 'Send failed',
  'Nur .3mf / .gcode können in die Queue': 'Only .3mf / .gcode can be queued',
  '{0} Job(s) in die Queue gelegt': '{0} job(s) added to the queue',
  'In die Queue legen fehlgeschlagen': 'Adding to the queue failed',
  'Upload': 'Upload',
  'Wird hochgeladen…': 'Uploading…',
  'Dateien hier ablegen oder klicken': 'Drop files here or click',
  '.3mf · .gcode · .stl · landet im aktuellen Ordner': '.3mf · .gcode · .stl · lands in the current folder',
  '📁 Alle': '📁 All',
  '· Suche „{0}"': '· Search "{0}"',
  'Alle Ordner durchsuchen…': 'Search all folders…',
  'Neuer Ordner…': 'New folder…',
  '+ Ordner': '+ Folder',
  '{0} ausgewählt': '{0} selected',
  'Menge je Datei': 'Quantity per file',
  'Füge hinzu…': 'Adding…',
  'In Queue ({0})': 'To queue ({0})',
  'Auswahl aufheben': 'Clear selection',
  'Geschätzte Gesamt-Druckzeit (reine Druckzeit, ohne Wechsel)': 'Estimated total print time (pure print time, without swaps)',
  'Geschätztes Gesamt-Filament': 'Estimated total filament',
  'Für einige Dateien fehlt die Slicer-Zeitangabe': 'The slicer time is missing for some files',
  '({0}/{1} mit Zeit)': '({0}/{1} with time)',
  'Lädt…': 'Loading…',
  '{0} Datei(en)': '{0} file(s)',
  ', {0} Unterordner': ', {0} subfolders',
  'Ordner umbenennen': 'Rename folder',
  'Ordner löschen': 'Delete folder',
  'Dieser Ordner ist leer': 'This folder is empty',

  /* ── Auto Farm ── */
  'Keine Filament-Info in Datei (älteres Format)': 'No filament info in file (older format)',
  'Kein AMS erkannt — Drucker offline?': 'No AMS detected — printer offline?',
  'Farbe unterschiedlich': 'Color differs',
  'Nur exakte Farbe drucken': 'Print exact color only',
  'Keine ähnliche Ersatzfarbe — ohne exakten Treffer pausiert die Farm zur manuellen Zuordnung':
    'No similar substitute color — without an exact match the farm pauses for manual assignment',
  'keine exakte Farbe': 'no exact color',
  'AMS-Zuordnung (Vorschau)': 'AMS mapping (preview)',
  'Trefferqualität': 'Match quality',
  'exakt': 'exact',
  'ähnlich': 'similar',
  'Farbe weicht ab': 'color differs',
  'kein Material': 'no material',
  'AMS offline': 'AMS offline',
  'Map:': 'Map:',
  'Auto-Match': 'Auto-match',
  'Aktueller Schritt': 'Current step',
  'Kein aktiver Schritt': 'No active step',
  'Holen aus Magazin': 'Grab from magazine',
  'Zum Drucker': 'To printer',
  'Druckt…': 'Printing…',
  'Zum Regal': 'To rack',
  'Zurück': 'Back',
  'Ablauf-Phasen': 'Workflow phases',
  'URL in Konfiguration → Kameras': 'URL in Configuration → Cameras',
  '{0} nicht erreichbar': '{0} not reachable',
  'Oben · X1C (RTSPS · direkt)': 'Top · X1C (RTSPS · direct)',
  'LAN-Liveview muss am Drucker aktiv sein': 'LAN live view must be enabled on the printer',
  '⏹ Stopp': '⏹ Stop',
  '📷 Live': '📷 Live',
  'X1C nicht erreichbar': 'X1C not reachable',
  'Verbinde …': 'Connecting …',
  'X1C bereit': 'X1C ready',
  'Kein Drucker': 'No printer',
  '„📷 Live" drücken': 'Press "📷 Live"',
  'Verbinde mit Home Assistant …': 'Connecting to Home Assistant …',
  'Home Assistant / Token prüfen': 'Check Home Assistant / token',
  'Konfiguration → Kameras': 'Configuration → Cameras',
  'Kamera ausschalten (Anzeige + Snapshots)': 'Turn camera off (display + snapshots)',
  'Kamera einschalten': 'Turn camera on',
  '📷 An': '📷 On',
  '⨯ Aus': '⨯ Off',
  'X1C (Home Assistant)': 'X1C (Home Assistant)',
  'Bambu (oben)': 'Bambu (top)',
  'Hochkant (unten)': 'Portrait (bottom)',
  'Kamera aus': 'Camera off',
  'Kein Livebild, keine automatischen Snapshots': 'No live image, no automatic snapshots',
  'Kamera-Status konnte nicht gespeichert werden': 'Camera status could not be saved',
  'Dashboard auf Standard zurückgesetzt': 'Dashboard reset to default',
  '✓ Alle Jobs abgearbeitet — Auto Farm beendet': '✓ All jobs processed — Auto Farm finished',
  'Einige Daten konnten nicht geladen werden': 'Some data could not be loaded',
  'Vorlage „{0}" gespeichert ({1} Jobs)': 'Template "{0}" saved ({1} jobs)',
  '{0} Jobs geladen — {1} Datei(en) nicht mehr vorhanden': '{0} jobs loaded — {1} file(s) no longer present',
  'Vorlage „{0}" geladen ({1} Jobs)': 'Template "{0}" loaded ({1} jobs)',
  'Fach konnte nicht geleert werden': 'Slot could not be emptied',
  'Fach {0} als belegt markiert': 'Slot {0} marked as occupied',
  'Fach {0} freigegeben': 'Slot {0} released',
  'Fach konnte nicht geändert werden': 'Slot could not be changed',
  '🔒 Belegt': '🔒 Occupied',
  'Belegt': 'Occupied',
  'Fach als belegt markieren — der Roboter legt hier nichts ab': 'Mark slot as occupied — the robot places nothing here',
  'Fach wieder freigeben': 'Release slot again',
  'Fach {0} → "{1}" zugewiesen': 'Slot {0} → "{1}" assigned',
  'Fach {0} geleert — kein ausstehender Job': 'Slot {0} emptied — no pending job',
  'Zuweisung fehlgeschlagen': 'Assignment failed',
  '{0} Fach/Fächer geleert': '{0} slot(s) emptied',
  'Regal konnte nicht geleert werden': 'Rack could not be emptied',
  'Magazin konnte nicht aufgefüllt werden': 'Magazine could not be refilled',
  'Bambu X1C nicht erreichbar — Verbindung prüfen': 'Bambu X1C not reachable — check connection',
  'OTTOeject nicht bereit ({0}{1}) — bitte Firmware neu starten': 'OTTOeject not ready ({0}{1}) — please restart the firmware',
  'OTTOeject nicht erreichbar — Verbindung prüfen': 'OTTOeject not reachable — check connection',
  'Keine Jobs in der Warteschlange': 'No jobs in the queue',
  'Manuelle AMS-Festlegung notwendig für {0} Job(s) — Filament zuweisen, dann starten':
    'Manual AMS assignment needed for {0} job(s) — assign filament, then start',
  '⚠ Nur Platz für {0}/{1} Jobs — Farm pausiert bei vollem Regal':
    '⚠ Only room for {0}/{1} jobs — farm pauses when the rack is full',
  'ℹ Regal evtl. zu klein für {0}/{1} Jobs — übrige warten dann im Drucker, bis Platz frei wird':
    'ℹ Rack may be too small for {0}/{1} jobs — the rest then wait in the printer until space frees up',
  'Start in {0}s': 'Starting in {0}s',
  'Nächster Job startet automatisch': 'Next job starts automatically',
  'Cam 2': 'Cam 2',
  'Cam 2 ⨯': 'Cam 2 ⨯',
  'Zweite Kamera (unten) ausblenden': 'Hide second camera (bottom)',
  'Zweite Kamera (unten) einblenden': 'Show second camera (bottom)',
  '● Live': '● Live',
  'Holen aus Magazin (Fach 7)': 'Grab from magazine (slot 7)',
  'Aus Magazin holen': 'Grab from magazine',
  'Live über die Verbindung der laufenden Farm': 'Live via the running farm’s connection',
  'Auto-Aktualisierung alle 15 s': 'Auto-refresh every 15 s',
  'Auto Farm gestartet': 'Auto Farm started',
  'Farm-State zurückgesetzt': 'Farm state reset',
  'Kein Bambu Lab Gerät konfiguriert — bitte erst unter Configuration einrichten':
    'No Bambu Lab device configured — please set it up under Configuration first',
  'Wartet auf neue Jobs — "+ Datei" klicken um fortzufahren': 'Waiting for new jobs — click "+ File" to continue',
  'Auto Farm läuft im Server — Status wird live aktualisiert': 'Auto Farm is running on the server — status updates live',
  'Läuft · {0}': 'Running · {0}',
  '{0} Job(s) wartet': '{0} job(s) waiting',
  'Wartet auf Jobs…': 'Waiting for jobs…',
  'Dashboard anpassen: Panels verschieben, Größe ändern, ein-/ausblenden':
    'Customize dashboard: move panels, resize, show/hide',
  '✓ Fertig': '✓ Done',
  '✎ Layout': '✎ Layout',
  'Alle auf Ausstehend zurücksetzen': 'Reset all to pending',
  '↺ Reset': '↺ Reset',
  '▶ Aktivieren': '▶ Activate',
  '▶ Fortsetzen': '▶ Resume',
  '⏸ Pause': '⏸ Pause',
  '■ Stopp': '■ Stop',
  'Erzwingt das Zurücksetzen des Farm-States — benutze dies wenn Stopp nicht reagiert':
    'Forces a reset of the farm state — use this if Stop does not respond',
  'Pausiert — warte auf Fortsetzen…': 'Paused — waiting to resume…',
  'Panels': 'Panels',
  'Ausblenden': 'Hide',
  'Einblenden': 'Show',
  'Positionen, Größen und Sichtbarkeit auf Standard zurücksetzen': 'Reset positions, sizes and visibility to default',
  '~{0} gesamt': '~{0} total',
  ' · fertig ~{0} Uhr': ' · done ~{0}',
  'Gesamtzeit unbekannt': 'Total time unknown',
  'Warteschlangen-Vorlagen speichern/laden': 'Save/load queue templates',
  '☰ Vorlagen': '☰ Templates',
  'Name der aktuellen Queue…': 'Name of the current queue…',
  'Warteschlange ist leer': 'Queue is empty',
  'Aktuelle Warteschlange speichern': 'Save current queue',
  'Noch keine Vorlagen': 'No templates yet',
  '{0} Jobs laden': 'Load {0} jobs',
  '{0} Datei(en) · {1} Jobs': '{0} file(s) · {1} jobs',
  'Vorlage löschen': 'Delete template',
  'Jobs in der': 'Add jobs in the',
  'hinzufügen →': '→',
  'Platte {0}/{1}': 'Plate {0}/{1}',
  'Platte {0} von {1}': 'Plate {0} of {1}',
  'P{0}/{1}': 'P{0}/{1}',
  'P{0}': 'P{0}',
  'Keine Jobs': 'No jobs',
  '+ Datei klicken um zu beginnen': 'Click + File to start',
  'Regal-Fächer werden automatisch vergeben': 'Rack slots are assigned automatically',
  'Platte {0} aus Multi-Plate-.3mf': 'Plate {0} from multi-plate .3mf',
  'Höhe…': 'Height…',
  'Roh: {0} mm · {1} Schichten × {2} mm · +{3}% = {4} mm': 'Raw: {0} mm · {1} layers × {2} mm · +{3}% = {4} mm',
  'Höhe unbekannt': 'Height unknown',
  'Regal voll — kein freies Fach in der Vorschau': 'Rack full — no free slot in the preview',
  'Regal voll': 'Rack full',
  'Fach wird bei Ausführung automatisch zugewiesen': 'Slot is assigned automatically at runtime',
  'Auto': 'Auto',
  '⚠ Manuelle AMS-Festlegung': '⚠ Manual AMS assignment',
  'AMS laden…': 'Loading AMS…',
  'Fehlgeschlagen': 'Failed',
  '↺ Wiederholen': '↺ Retry',
  'Fertige Platten entnehmen — Magazin füllt sich automatisch wieder auf':
    'Remove finished plates — magazine refills automatically',
  'Kein Regal konfiguriert': 'No rack configured',
  'Sperr': 'Lock',
  'Fach leeren': 'Empty slot',
  'Leeren + nächsten Job zuweisen': 'Empty + assign next job',
  'Aktivität': 'Activity',
  'Persistentes Log-File herunterladen (alle Läufe)': 'Download persistent log file (all runs)',
  '↓ Log': '↓ Log',
  'Aktuellen Log als .txt': 'Current log as .txt',
  'Noch keine Aktivität': 'No activity yet',
  'Filter…': 'Filter…',
  'Filter löschen': 'Clear filter',
  'Sichtbare Zeilen kopieren': 'Copy visible lines',
  'Log kopiert ({0} Zeilen)': 'Log copied ({0} lines)',
  'Kopieren nicht möglich': 'Copy failed',
  'Kein Treffer für „{0}"': 'No match for “{0}”',
  '{0} von {1} Zeilen': '{0} of {1} lines',
  'Tastenkürzel: Leertaste': 'Shortcut: Spacebar',
  'Ziehen zum Umsortieren': 'Drag to reorder',
  'Bestätigen': 'Confirm',
  'Gerät löschen': 'Delete device',
  'Gerät bearbeiten': 'Edit device',
  'Neues Gerät': 'New device',
  'Änderungen speichern': 'Save changes',
  'leer lassen = unverändert': 'leave empty = unchanged',
  'nicht änderbar': 'cannot be changed',
  'Speichert…': 'Saving…',
  'Dieses Gerät wirklich löschen?': 'Really delete this device?',
  'Filament löschen': 'Delete filament',
  'Datei löschen': 'Delete file',
  'Regal zurücksetzen': 'Reset rack',
  'Zurücksetzen': 'Reset',
  'NOTAUS': 'EMERGENCY STOP',
  'Hängendes Fach (Status: {0}) — ✓ zum Leeren': 'Stuck slot (status: {0}) — ✓ to clear',
  'belegt': 'occupied',
  'Uhrzeit': 'Time',
  'Zeitzone': 'Time zone',
  'Maßgeblich für Betriebszeiten & angezeigte Uhrzeiten. Der Server läuft sonst in UTC — die Farm würde zur falschen Uhrzeit starten.':
    'Determines operating hours & displayed times. Otherwise the server runs in UTC — the farm would start at the wrong time.',
  ' (erkannt)': ' (detected)',
  'Einrichtungs-Status': 'Setup status',
  'Zeitzone gesetzt': 'Time zone set',
  'nicht gesetzt — Betriebszeiten laufen sonst in UTC': 'not set — operating hours run in UTC otherwise',
  'Bambu-Drucker konfiguriert': 'Bambu printer configured',
  'kein Drucker angelegt': 'no printer added',
  'OTTOeject / Klipper konfiguriert': 'OTTOeject / Klipper configured',
  'kein OTTOeject angelegt': 'no OTTOeject added',
  'Regal konfiguriert': 'Rack configured',
  '{0} Regal(e) · {1} Fächer · {2} mm': '{0} rack(s) · {1} slots · {2} mm',
  'Homing-Datei erstellt': 'Homing file created',
  'nicht erstellt — für den Auswurf nötig': 'not created — required for ejecting',
  'Alles bereit ✓': 'All set ✓',
  'Es fehlt noch etwas': 'Something is still missing',
  'Fast fertig': 'Almost done',
  '↻ Neu prüfen': '↻ Re-check',
  'online': 'online',
  'offline': 'offline',
  'unconfigured': 'not configured',
  'stale': 'stale',
  'ready': 'ready',
  'Maßgeblich für Betriebszeiten & Uhrzeiten.': 'Determines operating hours & clock times.',
  'Betriebszeiten': 'Operating hours',
  'Neue Drucke nur im Zeitfenster starten (Ruhezeiten / Stromtarif). Laufende Drucke werden nicht unterbrochen.': 'Only start new prints within the time window (quiet hours / electricity tariff). Running prints are not interrupted.',
  'Von': 'From',
  'Bis': 'To',
  '(über Nacht)': '(overnight)',
  'über Nacht': 'overnight',
  'kein Druck an diesem Tag': 'no printing on this day',
  'Diese Zeiten auf alle Tage übernehmen': 'Apply these times to all days',
  'auf alle': 'to all',
  'Über-Nacht-Fenster (z. B. 22:00–06:00) erlaubt. Gilt nur für den Start neuer Drucke.':
    'Overnight windows (e.g. 22:00–06:00) are allowed. Applies only to starting new prints.',
  '🕒 inkl. Wartezeit bis zur nächsten Betriebszeit': '🕒 incl. wait until the next operating window',
  'Mo': 'Mon', 'Di': 'Tue', 'Mi': 'Wed', 'Do': 'Thu', 'Fr': 'Fri', 'Sa': 'Sat', 'So': 'Sun',
  'Fächer-Toleranz (mm)': 'Slot tolerance (mm)',
  '(Überstand nach oben)': '(overshoot at top)',
  'Wie weit ein Objekt über sein oberstes Fach ragen darf, bevor ein weiteres reserviert wird. Höher = weniger Fächer, aber Kollisionsgefahr.': 'How far an object may extend above its top slot before another is reserved. Higher = fewer slots, but risk of collision.',

  // ── Language packs ──
  'Pack braucht code + strings': 'Pack needs code + strings',
  'Template exportieren': 'Export template',
  'Template exportieren lädt eine JSON-Vorlage mit allen deutschen Strings und englischen Referenz-Übersetzungen. Einfach einer KI geben: „Übersetze alle Werte auf Französisch" — dann code + name anpassen und importieren.':
    'Export template downloads a JSON template with all German strings and English reference translations. Just hand it to an AI: "Translate all values to French" — then adjust code + name and import.',

  // ── Planer (B.3) ──
  '🗓 Planer': '🗓 Planner',
  'Zeitplan der Warteschlange anzeigen (Was-wäre-wenn)': 'Show queue schedule (what-if)',
  '· 📊 {0} aus Historie': '· 📊 {0} from history',
  'Basierend auf echten früheren Druckzeiten': 'Based on real past print times',
  'Keine wartenden Jobs zum Planen': 'No waiting jobs to plan',
  'Live-Restzeit': 'Live remaining time',
  'aus echter Historie': 'from real history',
  'Slicer-Schätzung': 'Slicer estimate',
  'keine Zeitangabe': 'no time data',
  'voraussichtlich fertig': 'projected finish',
  '{0} Jobs': '{0} jobs',
  '~{0} · fertig ~{1} Uhr': '~{0} · done ~{1}',
  '~{0} · fertig {1} ~{2} Uhr': '~{0} · done {1} ~{2}',
  'heute': 'today',
  'morgen': 'tomorrow',
  '+{0} Tage': '+{0} days',

  // ── Datei-Bibliothek: Sortieren & Filtern ──
  'Keine Datei passt zum Filter': 'No file matches the filter',
  'Sortieren': 'Sort',
  'Datum': 'Date',
  'Größe': 'Size',
  'Typ': 'Type',
  'Aufsteigend': 'Ascending',
  'Absteigend': 'Descending',
  'Sortieren / filtern': 'Sort / filter',
  '↑ Aufsteigend': '↑ Ascending',
  '↓ Absteigend': '↓ Descending',
  'Alle anzeigen': 'Show all',
  '(keine Werte)': '(no values)',

  // ── Energie & Kosten / Smart-Plug (3.1/3.2/3.4) ──
  'Energie & Kosten': 'Energy & costs',
  // Steckdosen-Schalter in der Kopfleiste (components/PowerToggle.jsx)
  'Steckdose ausschalten?': 'Switch the plug off?',
  'Die Auto-Farm läuft gerade. „{0}" jetzt stromlos zu schalten bricht den laufenden Druck ab.':
    'The auto farm is running. Cutting power to "{0}" now will abort the print in progress.',
  '„{0}" wird stromlos. Ein laufender Druck bricht dabei ab.':
    '"{0}" will lose power. Any print in progress will be aborted.',
  'Steckdose nicht erreichbar': 'Plug not reachable',
  'An — klicken zum Ausschalten': 'On — click to switch off',
  'Aus — klicken zum Einschalten': 'Off — click to switch on',
  'An': 'On',
  'Smart-Steckdose für Stromverbrauch, Auto-Abschaltung und Kostenrechnung':
    'Smart plug for power consumption, auto-shutdown and cost calculation',
  'Steckdosen-Typ': 'Plug type',
  'Keine': 'None',
  'Home Assistant': 'Home Assistant',
  'Nutzt URL + Token aus der Kamera-Konfiguration. Entitäten angeben:':
    'Uses the URL + token from the camera config. Enter the entities:',
  'Eigene Home-Assistant-URL + Token eingeben (oder leer lassen → nutzt die Kamera-Konfiguration). Dann die Entitäten angeben:':
    'Enter your own Home Assistant URL + token (or leave empty → uses the camera config). Then enter the entities:',
  'Home-Assistant-URL': 'Home Assistant URL',
  'Long-Lived-Token': 'Long-lived token',
  'leer = aus Kamera-Konfig': 'empty = from camera config',
  'Eigene Home-Assistant-URL + Long-Lived-Token eintragen. Leer lassen funktioniert nur, wenn HA bereits für die Kamera eingerichtet ist (dann werden dessen URL + Token genutzt).':
    'Enter your own Home Assistant URL + long-lived token. Leaving it empty only works if HA is already set up for the camera (its URL + token are then used).',
  'Token aus HA → Profil → Sicherheit': 'Token from HA → Profile → Security',
  '⚠ Kein Token vorhanden — bitte Long-Lived-Token eintragen (deine Kamera nutzt kein Home Assistant).':
    '⚠ No token available — please enter a long-lived token (your camera does not use Home Assistant).',
  'Schalter-Entität (switch.…)': 'Switch entity (switch.…)',
  'Leistungs-Sensor (W, sensor.…)': 'Power sensor (W, sensor.…)',
  'Energie-Zähler (kWh, sensor.…)': 'Energy counter (kWh, sensor.…)',
  'Geräte-URL': 'Device URL',
  'Passwort (optional)': 'Password (optional)',
  '(gesetzt)': '(set)',
  'Live prüfen': 'Check live',
  'AN': 'ON',
  'AUS': 'OFF',
  'Ein': 'On',
  'Aus': 'Off',
  'Auto-Abschaltung nach Leerlauf (min)': 'Auto-shutdown after idle (min)',
  '(aus)': '(off)',
  'Strompreis (€/kWh)': 'Power price (€/kWh)',
  'Maschinenstundensatz (€/h)': 'Machine rate (€/h)',
  'Filamentpreis (€/kg)': 'Filament price (€/kg)',
  'Gespeichert.': 'Saved.',
  'kWh gesamt': 'kWh total',
  'Stromkosten': 'Power cost',
  'Gesamtkosten': 'Total cost',
  'Kosten: Strom + Maschine + Filament': 'Cost: power + machine + filament',
  'Noch kein Stromverbrauch erfasst — Smart-Steckdose unter Konfiguration → Energie & Kosten einrichten.':
    'No power consumption recorded yet — set up the smart plug under Configuration → Energy & costs.',

  // ── Fehlerstrategie (1.3) ──
  'Fehlerstrategie': 'Error strategy',
  'Festlegen, was die Farm bei jedem Fehlertyp automatisch tut': 'Define what the farm does automatically for each error type',
  'Schwere/fatale Druckermeldung (z. B. Hardwarefehler)': 'Severe/fatal printer message (e.g. hardware fault)',
  'Druck fehlgeschlagen': 'Print failed',
  'Drucker meldet FAILED nach den Wiederholungen': 'Printer reports FAILED after the retries',
  'Verbindung verloren': 'Connection lost',
  'Drucker nach mehreren Reconnects nicht erreichbar': 'Printer unreachable after several reconnects',
  'Stillstand / kein Fortschritt': 'Stall / no progress',
  'Watchdog: kein Druckfortschritt (mögliche Verstopfung)': 'Watchdog: no print progress (possible clog)',
  'Kein freies Regalfach': 'No free rack slot',
  'Regal voll — kein Platz für die fertige Platte': 'Rack full — no room for the finished plate',
  'AMS-Festlegung nötig': 'AMS assignment needed',
  'Kein passendes Filament im AMS gefunden': 'No matching filament found in the AMS',
  'Pausieren': 'Pause',
  'Job überspringen': 'Skip job',
  'Farm stoppen': 'Stop farm',
  'Ignorieren': 'Ignore',
  'Platte auswerfen & weiter': 'Eject plate & continue',
  '„Platte auswerfen & weiter": Bett auf Z200, Tür öffnen, Platte auswerfen und ins Fach einlagern — dann startet der nächste Job automatisch. „Job überspringen" lässt die fehlgeschlagene Platte im Drucker (nur wählen, wenn du sie selbst entnimmst).':
    '“Eject plate & continue”: bed to Z200, open door, eject the plate and store it in the rack — then the next job starts automatically. “Skip job” leaves the failed plate in the printer (only pick this if you remove it yourself).',
  'Wiederholungen:': 'Retries:',

  // ── Watchdog (1.1 / 1.7) ──
  'Watchdog': 'Watchdog',
  'Alarm bei Verbindungsverlust': 'Alert on connection loss',
  'Push, wenn der Reconnect zum Drucker mehrfach scheitert': 'Push when reconnecting to the printer fails repeatedly',
  'Stillstand-Watchdog (Minuten ohne Fortschritt)': 'Stall watchdog (minutes without progress)',
  'min → pausiert bei möglicher Verstopfung': 'min → pauses on possible clog',

  // ── Nachgetragen 1.1.5: Texte, die bisher ohne Uebersetzung auf Deutsch
  // zurueckfielen, plus die Vorlagen der Backend-Meldungen (siehe trProblem). ──
  'Neue Version verfügbar': 'New version available',
  // Hinweis, wenn Neuladen die Versionen nicht zusammenbringt (App.jsx)
  'Der Server läuft auf v{0}, dieser Tab zeigt noch v{1}. Neu laden hat nicht geholfen — der Browser hält die alte Fassung fest.':
    'The server is running v{0} while this tab still shows v{1}. Reloading did not help — the browser is holding on to the old version.',
  'lädt unter Umgehung des Caches.': 'loads it bypassing the cache.',
  'Nochmal versuchen': 'Try again',
  'Fehler auf dieser Seite': 'Error on this page',
  'Die App wurde aktualisiert — bitte neu laden.':
    'The app has been updated — please reload.',
  'Neu laden': 'Reload',
  'Lade …': 'Loading …',
  'Hinweise zu Version {0}': 'Notices for version {0}',
  '⟳ prüfen': '⟳ check',
  'Im Greifer hängt eine LEERE Platte (aus Fach {0})':
    'The gripper is holding an EMPTY plate (from slot {0})',
  'Im Greifer hängt eine LEERE Platte': 'The gripper is holding an EMPTY plate',
  'Im Greifer hängt eine Platte mit einem FERTIGEN Druck':
    'The gripper is holding a plate with a FINISHED print',
  'Der Greifer war leer': 'The gripper was empty',
  'Erst nachsehen: Steht eine Platte im Greifer oder im Drucker? Danach hier bestätigen — die Farm referenziert vor der nächsten Bewegung selbst.':
    'Check first: is there a plate in the gripper or in the printer? Then confirm here — the farm re-references itself before the next move.',
  'Standard': 'Default',
  '{0} {1} → {2} mm': '{0} {1} → {2} mm',
  'Browser kann HLS nicht abspielen': 'This browser cannot play HLS',
  'HLS-Player konnte nicht geladen werden': 'The HLS player could not be loaded',
  'Regal gespeichert': 'Rack saved',
  'Wartet': 'Waiting',
  'Datei senden': 'Sending file',
  '+ Gerät hinzufügen': '+ Add device',
  'Gerätename': 'Device name',
  'z. B. Bambu Lab X1C': 'e.g. Bambu Lab X1C',
  'Gerätetyp': 'Device type',
  'IP-Adresse': 'IP address',
  'Seriennummer': 'Serial number',
  'Zugangscode': 'Access code',
  'TLS verwenden (empfohlen)': 'Use TLS (recommended)',
  'Gerät hinzufügen': 'Add device',
  'Noch kein Gerät angelegt': 'No device configured yet',
  'Language Name': 'Language name',
  '✓ Übernommen': '✓ Applied',
  'Kalibrierung gestartet': 'Calibration started',
  'Drucker hat diesen Wert noch nicht gemeldet':
    'The printer has not reported this value yet',
  '⚙ Drucker-Einstellungen ({0})': '⚙ Printer settings ({0})',
  'Kein Bambu-Drucker unter „Geräte" angelegt.':
    'No Bambu printer configured under “Devices”.',
  'Drucker nicht erreichbar — Einstellungen können nicht gelesen werden. Setzen wird erst nach dem Verbinden wirksam.':
    'Printer not reachable — settings cannot be read. Setting them takes effect once connected.',
  '(aktuell unbekannt)': '(currently unknown)',
  'Druckt nach einem Schrittverlust weiter statt abzubrechen.':
    'Keeps printing after a lost step instead of aborting.',
  'Beleuchtung im Bauraum (wird für die Kamera automatisch eingeschaltet).':
    'Chamber lighting (switched on automatically for the camera).',
  'Starte…': 'Starting…',
  'Drucker-Bett homen…': 'Homing the print bed…',
  '✓ Bett gehomt (G28)': '✓ Bed homed (G28)',
  'Kein Bambu-Drucker unter „Geräte" angelegt — Bett-Steuerung nicht verfügbar.':
    'No Bambu printer configured under “Devices” — bed control unavailable.',
  '„Bett fahren" setzt das Bett absolut auf die Ziel-Z (G90/G1 Z), Z200 = Ladeposition für den Platten-Wechsel. „Bett homen" (G28) referenziert die Achsen neu — danach stimmt die Z-Höhe wieder. Drucker muss idle sein.':
    '“Move bed” sets the bed to the absolute target Z (G90/G1 Z), Z200 = loading position for the plate change. “Home bed” (G28) re-references the axes — after that the Z height is correct again. The printer must be idle.',
  '{0}: Printloom kann diesen Drucker nicht direkt steuern (nur Bambu Lab über MQTT) — Bett-Fahrt, Homing und Drucker-Einstellungen entfallen. Der OTTOeject wird normal bedient.':
    '{0}: Printloom cannot control this printer directly (Bambu Lab over MQTT only) — bed movement, homing and printer settings are unavailable. The OTTOeject works as usual.',
  'Sichere Anfahrt vor den Drucker — eigene Start-Position. Standard = Auswurf-Position; hier fein justierbar.':
    'Safe approach in front of the printer — its own start position. Default = eject position; fine-tune it here.',
  'Positionen': 'Positions',
  'Drucker-X — setzt „Vor Drucker fahren“, „Platte auswerfen“ und „Platte einlegen“ gemeinsam':
    'Printer X — sets “Move to printer”, “Eject plate” and “Place plate” together',
  'Vor Drucker fahren…': 'Moving to printer…',
  'Vor den Drucker fahren (Test)': 'Move in front of the printer (test)',
  '🖨 Drucker (ganz links) = Start-X von „Vor Drucker fahren“, „Platte auswerfen“ und „Platte einlegen“ gemeinsam (absoluter Maschinen-X). Regale: Standard = Start-X + Regal-Versatz; ein geänderter Wert wird als Δ-Korrektur pro Regal gespeichert und gilt für alle Fächer & das Magazin dieses Regals — auch im eigenen G-code über den Platzhalter für die Regal-X-Position. Ändert sich Start-X/Versatz, wandert die Korrektur mit.':
    '🖨 Printer (far left) = start X for “Move to printer”, “Eject plate” and “Place plate” together (absolute machine X). Racks: default = start X + rack offset; a changed value is stored as a Δ correction per rack and applies to every slot & the magazine of that rack — including in your own G-code via the placeholder for the rack X position. If start X/offset changes, the correction moves with it.',
  'Kamera prüft die erste Schicht und hält den Druck bei Fehlern an.':
    'The camera checks the first layer and stops the print on failure.',
  'Erkennt Fehldrucke („Spaghetti") und hält den Druck an.':
    'Detects failed prints (“spaghetti”) and stops the print.',
  'Prüft per Marker, ob die richtige Druckplatte eingelegt ist.':
    'Uses a marker to check that the correct build plate is inserted.',
  'Allgemeine KI-Überwachung des Drucks.': 'General AI monitoring of the print.',
  'Ludicrous': 'Ludicrous',
  'Filament': 'Filament',
  'Home (Endschalter)': 'Home (endstop)',
  'Profil „{0}" importiert.': 'Profile “{0}” imported.',
  'Mein Profil': 'My profile',
  '▶ {0} — läuft…': '▶ {0} — running…',
  'Bambu G-Code': 'Bambu G-code',
  'Homing senden': 'Send homing',
  'Auf Z200 warten (Homing-Ende)': 'Wait for Z200 (end of homing)',
  'Feste Datei (ID)': 'Fixed file (ID)',
  'Warte auf PAUSE (Z200)': 'Wait for PAUSE (Z200)',
  'Auf Druckfehler warten': 'Wait for print failure',
  'Fehler quittieren': 'Acknowledge error',
  'R{0} Fach {1}': 'R{0} slot {1}',
  '✓ X {0} · Y {1} · Z {2} mm': '✓ X {0} · Y {1} · Z {2} mm',
  '{0} Regale × {1} Lagerfächer': '{0} racks × {1} storage slots',
  'Magazin = Fach {0}': 'Magazine = slot {0}',
  'kein Magazin': 'no magazine',
  'Z-Schritt {0} mm': 'Z step {0} mm',
  'Fachhöhe {0} mm': 'Slot height {0} mm',
  'Nachschub: {0} leere Platten je Magazin (später änderbar).':
    'Supply: {0} empty plates per magazine (changeable later).',
  'Start-Bestückung: {0} Fächer je Regal mit leerer Platte. Die Farm greift von OBEN nach unten und legt den fertigen Druck in dasselbe Fach zurück.':
    'Initial stock: {0} slots per rack with an empty plate. The farm grabs from the TOP downwards and puts the finished print back into the same slot.',
  '⚠ Der Z-Schritt (Fach zu Fach) bestimmt, wo der Arm zugreift. Miss ihn am eigenen Regal nach und korrigiere ihn im Schritt „Regal" — ein falscher Wert lässt den Arm ins Blech fahren.':
    '⚠ The Z step (slot to slot) determines where the arm reaches in. Measure it on your own rack and correct it in the “Rack” step — a wrong value drives the arm into the sheet metal.',
  'Übernehmen →': 'Apply →',
  'Bambu X1C': 'Bambu X1C',
  'OTTOeject': 'OTTOeject',
  'Bambu Lab X1C': 'Bambu Lab X1C',
  'Bambu Lab P1S': 'Bambu Lab P1S',
  'Bambu Lab P1P': 'Bambu Lab P1P',
  'Bambu Lab A1': 'Bambu Lab A1',
  'Elegoo Centauri Carbon': 'Elegoo Centauri Carbon',
  'Anycubic Kobra S1': 'Anycubic Kobra S1',
  'Creality K1C': 'Creality K1C',
  'Flashforge AD5X': 'Flashforge AD5X',
  'System': 'System',
  'Version': 'Version',
  'Installer wurde gestartet. Printloom wird geschlossen und aktualisiert — folge dem Installer und starte die App danach neu.':
    'The installer has been started. Printloom will close and update — follow the installer and restart the app afterwards.',
  '— kein automatisches Update im Hintergrund. Ein Klick lädt den passenden Installer vom GitHub-Release und startet ihn; die App wird geschlossen und aktualisiert.':
    '— no automatic background update. One click downloads the matching installer from the GitHub release and starts it; the app closes and updates.',
  'Backup & Restore': 'Backup & restore',
  '{0} hinzugefügt': '{0} added',
  'AMS nicht lesbar': 'AMS not readable',
  'kein passendes Material': 'no matching material',
  '25 mm Spalt zwischen den Haltern → 55 mm von Fach zu Fach. 7 Positionen je Regal. Passt zur Original-Kalibrierdatei des OTTOeject.':
    '25 mm gap between the holders → 55 mm from slot to slot. 7 positions per rack. Matches the original OTTOeject calibration file.',
  'Flache Halter: alle 25 mm ein Fach, ~260 mm von Aluprofil zu Aluprofil → 10 Positionen je Regal. Viel mehr Platten, aber nur ~20 mm Bauhöhe je Druck. Noch in Arbeit: die Y-Tiefe des Greifpunkts ist am realen Aufbau noch nicht nachgemessen.':
    'Flat holders: one slot every 25 mm, ~260 mm from extrusion to extrusion → 10 positions per rack. Many more plates, but only ~20 mm build height per print. Still in progress: the Y depth of the grip point has not been measured on the real build yet.',
  'Custom Printer': 'Custom printer',
  'Kein sicherer Kontext: Du öffnest die Farm über HTTP (lokale IP). iOS erlaubt Web-Push nur über HTTPS. Lösung: die Farm über HTTPS erreichbar machen (z. B. Reverse-Proxy mit Zertifikat) — danach zum Home-Bildschirm hinzufügen.':
    'No secure context: you are opening the farm over HTTP (local IP). iOS only allows web push over HTTPS. Fix: make the farm reachable over HTTPS (e.g. a reverse proxy with a certificate) — then add it to the home screen.',
  'Kein sicherer Kontext (HTTP). Web-Push braucht HTTPS — nur „localhost" ist ausgenommen.':
    'No secure context (HTTP). Web push needs HTTPS — only “localhost” is exempt.',
  'Auf iPhone/iPad: Seite über „Teilen → Zum Home-Bildschirm" installieren und die App vom Home-Screen-Icon aus öffnen (iOS 16.4+). Im normalen Safari-Tab gibt es kein Web-Push.':
    'On iPhone/iPad: install the page via “Share → Add to Home Screen” and open the app from the home-screen icon (iOS 16.4+). A normal Safari tab has no web push.',
  'Push wird von diesem Browser/Gerät nicht unterstützt':
    'Push is not supported by this browser/device',
  'Benachrichtigungen wurden nicht erlaubt': 'Notifications were not allowed',
  'Fach {0}-{1} (Objekt zu hoch)': 'Slot {0}-{1} (object too tall)',
  'Regal {0} hat nur {1} Fächer': 'Rack {0} only has {1} slots',
  'Bambu Homing (G28+Z200, im Hintergrund)': 'Bambu homing (G28+Z200, in the background)',
  'OTTOeject homen': 'Home OTTOeject',
  'Parken': 'Park',
  'Bambu Position Z200': 'Bambu position Z200',
  'Platte zurücklegen': 'Put plate back',
  'Dunkel': 'Dark',
  'Slate': 'Slate',
  'Mitternacht': 'Midnight',
  'Hell': 'Light',
  'vor {0} Min.': '{0} min ago',
  'vor {0} Std.': '{0} h ago',
  'vor {0} Tagen': '{0} days ago',
  'Regalzahl ist kleiner als 1 — mindestens ein Regal wird gebraucht.':
    'The rack count is below 1 — at least one rack is needed.',
  'Fächer pro Regal ist kleiner als 1.': 'Slots per rack is below 1.',
  'Fach-Abstand ergibt keinen Schritt nach oben ({0} mm) — alle Fächer lägen auf derselben Höhe. Gemessener Abstand von Fach zu Fach muss über {1} mm liegen.':
    'The slot spacing produces no upward step ({0} mm) — every slot would sit at the same height. The measured distance from slot to slot must be greater than {1} mm.',
  'Regal-Abstand ist 0 — bei mehreren Regalen lägen alle an derselben X-Position.':
    'Rack spacing is 0 — with several racks they would all sit at the same X position.',
  'Greif-Y ({0} mm) liegt nicht vor der Rückzugsposition ({1} mm) — der Arm würde beim Greifen nach hinten statt nach vorn fahren.':
    'Grab Y ({0} mm) is not in front of the pullback position ({1} mm) — when grabbing, the arm would move backwards instead of forwards.',
  'Magazin-Fach {0} liegt über dem letzten Fach ({1} Lagerfächer + 1) — prüfe die Regal-Konfiguration.':
    'Magazine slot {0} sits above the last slot ({1} storage slots + 1) — check the rack configuration.',
  'Klemm-Andruck ist negativ — der Arm drückt dann in die falsche Richtung. 0 = ohne Andruck.':
    'The clamp push is negative — the arm would push in the wrong direction. 0 = no push.',
  'Achsgrenzen unbekannt ({0}) — es wird nur geprüft, ob eine Bewegung unter 0 mm fährt. Einmal „Grenzen vom Gerät holen“, dann warnt Printloom auch, wenn eine Position über die Achse hinausgeht.':
    'Axis limits unknown ({0}) — only moves below 0 mm are checked. Fetch the limits from the device once, then Printloom also warns when a position runs past the axis.',
  'Regal {0} Fach {1}: „{2}“ fährt auf {3} {4} mm — unter den Endschalter (0 mm). Klipper würde die Bewegung mitten im Ablauf abbrechen.':
    'Rack {0} slot {1}: “{2}” moves to {3} {4} mm — below the endstop (0 mm). Klipper would abort the move mid-sequence.',
  '„{0}“ fährt auf {1} {2} mm — unter den Endschalter (0 mm). Klipper würde die Bewegung mitten im Ablauf abbrechen.':
    '“{0}” moves to {1} {2} mm — below the endstop (0 mm). Klipper would abort the move mid-sequence.',
  'Regal {0} Fach {1}: „{2}“ fährt auf {3} {4} mm — über die Achsgrenze {5} {6} mm. Klipper würde die Bewegung abbrechen.':
    'Rack {0} slot {1}: “{2}” moves to {3} {4} mm — beyond the axis limit {5} {6} mm. Klipper would abort the move.',
  '„{0}“ fährt auf {1} {2} mm — über die Achsgrenze {3} {4} mm. Klipper würde die Bewegung abbrechen.':
    '“{0}” moves to {1} {2} mm — beyond the axis limit {3} {4} mm. Klipper would abort the move.',
  'Kein Drucker im Layout.': 'No printer in the layout.',
  'Kein Regal im Layout — die Farm hat keinen Ablageplatz.':
    'No rack in the layout — the farm has nowhere to store plates.',
  '„{0}“ steht bei X {1} mm — unter dem Endschalter (0 mm).':
    '“{0}” sits at X {1} mm — below the endstop (0 mm).',
  '„{0}“ steht bei X {1} mm — über der Achsgrenze X {2} mm.':
    '“{0}” sits at X {1} mm — beyond the axis limit X {2} mm.',
  '„{0}“ ist einem Drucker zugeordnet, den es nicht (mehr) gibt.':
    '“{0}” is assigned to a printer that no longer exists.',
  'Zwei Drucker-Module zeigen auf dasselbe Gerät.':
    'Two printer modules point at the same device.',
  'Kein freies Fach für ein {0} mm hohes Objekt — die Farm würde hier nach der eingestellten Fehlerstrategie reagieren.':
    'No free slot for a {0} mm tall object — the farm would react according to the configured error strategy.',
  'Keine leeren Platten gemeldet — der Griff würde ins Magazin-Gate laufen (parken + pausieren).':
    'No empty plates reported — the grab would run into the magazine gate (park + pause).',
  'Keine aktiven Schritte in der Sequenz.': 'No active steps in the sequence.',
  'kein Magazin — greift aus dem Lagerfach': 'no magazine — grabs from the storage slot',
  'läuft als Printloom-G-code (use_gcode)': 'runs as Printloom G-code (use_gcode)',
  'Geräte-Macro (Printloom-G-code nicht aktiviert)':
    'device macro (Printloom G-code not enabled)',

  // ── 1.1.6: Andruck-Weg 0 = kein Griff ──
  'Greifer-Andruck · 0 = kein Griff!': 'Gripper push · 0 = no grab!',
  'Andruck-Weg: der Arm fährt beim Greifen/Ablegen um diesen Weg über die X hinaus, um den Greifer in die Halterung zu drücken (Auswerfen/Einlegen: +, Greifen/Ablegen: −). Original 30. ACHTUNG: Genau diese Bewegung IST der Griff — bei 0 hakt der Greifer nicht ein, der Arm fährt vor und kommt leer zurück. 0 ist nur sinnvoll, wenn du für Greifen/Ablegen eigenen G-code hinterlegt hast.':
    'Push distance: on grab/place the arm moves this far beyond X to press the gripper into the bracket (eject/place: +, grab/store: −). Original 30. CAUTION: that move IS the grab — at 0 the gripper never engages, the arm moves in and comes back empty. 0 only makes sense if you have your own G-code for grab/store.',
  'Andruck-Weg ist 0 — dann fährt der Arm beim Greifen und Ablegen nicht in die Halterung, der Greifer hakt nicht ein und die Platte bleibt liegen (der Arm kommt leer zurück). Original: 30 mm.':
    'Push distance is 0 — the arm then never moves into the bracket when grabbing or storing, the gripper does not engage and the plate stays where it is (the arm comes back empty). Original: 30 mm.',
  'Regal {0} steht bei X {1} mm — zu dicht am Endschalter. Beim Greifen und Ablegen fährt der Arm um den Andruck-Weg ({2} mm) weiter Richtung Null und käme auf X {3} mm. Das Regal braucht mindestens {2} mm Abstand zum Endschalter (X 0); „Anfahren“ geht trotzdem, weil es diese Bewegung nicht macht.':
    'Rack {0} sits at X {1} mm — too close to the endstop. When grabbing and storing, the arm moves the push distance ({2} mm) further towards zero and would end up at X {3} mm. This rack needs at least {2} mm of clearance from the endstop (X 0); "Approach" still works because it does not make that move.',
  'Der Drucker steht bei X {0} mm — beim Auswerfen und Einlegen fährt der Arm um den Andruck-Weg ({1} mm) weiter und käme auf X {2} mm, über die Achsgrenze X {3} mm.':
    'The printer sits at X {0} mm — when ejecting and placing, the arm moves the push distance ({1} mm) further and would end up at X {2} mm, beyond the axis limit X {3} mm.',

  // ── 1.1.8: Schiene im Drucker-Tab (früher eigener Tab „Farm-Layout") ──
  'Home': 'Home',
  'Home liegt bei X 0 (Endschalter, rechts am Gerät) — deshalb ist die Schiene von rechts nach links gezeichnet. Die Positionen kommen aus den Feldern oben; es gibt keine zweite Stelle, an der sie stehen.':
    'Home sits at X 0 (endstop, right-hand side of the machine) — that is why the rail is drawn right to left. The positions come from the fields above; there is no second place where they live.',
  '⚠ Rot markiert: weniger als der Andruck-Weg ({0} mm) vom Endschalter entfernt — Greifen und Ablegen sind dort nicht möglich.':
    '⚠ Marked red: less than the push distance ({0} mm) away from the endstop — grabbing and storing are impossible there.',

  // ── 1.1.9: mehrere Drucker, Abschnitt je Modul, Werte je Regal ──
  'Drucker & Regale': 'Printers & racks',
  'Der ganze Aufbau auf einer Seite: was steht wo auf der Schiene, und welche Position fährt der Arm dort an.':
    'The whole setup on one page: what sits where on the rail, and which position the arm drives to there.',
  'Der OTTOeject fährt auf EINER Schiene an allen Modulen entlang. Jedes Modul — jeder Drucker und jedes Regal — hat hier seinen eigenen Abschnitt mit seiner eigenen Position in mm. Was in einem Abschnitt steht, fährt der Arm genau so; es gibt keine zweite Stelle, an der dieselbe Zahl noch einmal steht.':
    'The OTTOeject travels along ONE rail past every module. Each module — every printer and every rack — has its own section here with its own position in mm. Whatever a section says is exactly what the arm drives; there is no second place holding the same number.',
  'Referenzfahrt — danach kennt der Arm seinen Nullpunkt (rechts).':
    'Home the arm — after that it knows its zero point (on the right).',
  'Abschnitt aufklappen, mit 📐 einmessen oder Werte eintippen, mit „▶ Test" prüfen.':
    'Open a section, teach the position with 📐 or type the values, check it with "▶ Test".',
  'Erst wenn eine Bewegung sauber läuft: „Farm nutzt diese Position" einschalten.':
    'Only once a move runs cleanly: switch on "Farm uses this position".',
  '⚠ Falsche Werte können den Arm gegen den Drucker fahren. Jede Operation erst einzeln testen — Printloom prüft vorher nur, ob eine Bewegung die Achse verlässt, nicht ob sie mechanisch passt.':
    '⚠ Wrong values can drive the arm into the printer. Test every operation on its own first — Printloom only checks beforehand whether a move leaves the axis, not whether it fits mechanically.',
  'M220-Fallback · pro Operation eigene Geschwindigkeit einstellbar':
    'M220 fallback · each operation can have its own speed',
  '+ Drucker hinzufügen': '+ Add printer',
  'Geometrie wird geladen …': 'Loading geometry …',
  'Ohne Namen': 'Unnamed',
  '{0}× Farm': '{0}× farm',
  'Geräte-Macros': 'Device macros',
  'Tür, Anfahrt, Auswerfen und Einlegen für diesen Drucker.':
    'Door, approach, eject and place for this printer.',
  'Gerät': 'Device',
  '— kein Gerät —': '— no device —',
  '— unbekannt —': '— unknown —',
  'Geschlossen (mit Tür)': 'Enclosed (with door)',
  '+ Tür-Positionen anlegen': '+ Add door positions',
  'Tür-Positionen entfernen': 'Remove door positions',
  'Y/Z und Tür-Form der Modell-Vorlage übernehmen; die eingemessene X bleibt':
    'Take Y/Z and the door shape from the model template; the measured X stays',
  '⤓ Werte aus Modell-Vorlage': '⤓ Values from model template',
  '🗑 Drucker entfernen': '🗑 Remove printer',
  'Für dieses Modell gibt es keine fertige Vorlage — die Positionen einmessen (📐 an jeder Karte).':
    'There is no ready-made template for this model — teach the positions (📐 on each card).',
  'Ohne Gerät kann Printloom diesen Drucker nicht überwachen (Druckstatus, Bett, Einstellungen). Geräte werden unter Konfiguration → Geräte angelegt.':
    'Without a device Printloom cannot monitor this printer (print status, bed, settings). Devices are created under Configuration → Devices.',
  'Diesem Drucker ist kein Gerät zugeordnet — oben auswählen.':
    'No device is assigned to this printer — pick one above.',
  '{0} Drucker — Anzahl in Konfiguration → Geräte':
    '{0} printers — the count lives under Configuration → Devices',
  'Noch kein Drucker angelegt — Konfiguration → Geräte':
    'No printer created yet — Configuration → Devices',
  'Name und Modell werden unter Konfiguration → Geräte gepflegt.':
    'Name and model are maintained under Configuration → Devices.',
  'Noch kein Drucker unter Konfiguration → Geräte angelegt. Einmessen und Testen geht trotzdem; Druckstatus, Bett und Drucker-Einstellungen brauchen das Gerät. Sobald es angelegt ist, gehören diese Werte dazu.':
    'No printer has been created under Configuration → Devices yet. Teaching and testing still work; print status, bed and printer settings need the device. Once it exists, these values belong to it.',

  // ── 1.1.11: Platte darüber = weniger Nutzhöhe · Vorlage mit Platzhaltern ──
  'Nutzhöhe unter belegtem Fach (%)': 'Usable height below an occupied slot (%)',
  '— z. B. unter dem Magazin': '— e.g. below the magazine',
  '→ max. {0} mm unter einer Platte': '→ max. {0} mm below a plate',
  'Die Platte fährt nicht waagerecht auf ihre Endhöhe ein, sondern kommt etwa 25 mm höher herein und wird abgesenkt — beim Holen wird sie genauso angehoben. Solange von unten nach oben gefüllt wird, ist das Fach darüber in dem Moment noch leer. Über dem Magazin (immer belegt) und unter einem schon belegten Fach fehlt diese Luft, deshalb zählt dort nur ein Teil der Fachhöhe.':
    'The plate does not slide in level at its final height — it enters about 25 mm higher and is then lowered, and it is lifted the same way when fetched. As long as filling goes bottom-up, the slot above is still empty at that moment. Below the magazine (always occupied) and below an already occupied slot that clearance is missing, so only part of the slot height counts there.',
  'EIN G-code fährt so jedes Regal (R1 am Drucker) und Fach korrekt an. Versätze gehen mit: {slot_z+25} ist die Fachhöhe plus 25 mm.':
    'ONE G-code then drives every rack (R1 at the printer) and slot correctly. Offsets work too: {slot_z+25} is the slot height plus 25 mm.',
  'Lädt die eingebaute Bewegung als Vorlage — mit Platzhaltern, damit sie für jedes Regal und Fach gilt':
    'Loads the built-in movement as a template — with placeholders, so it applies to every rack and slot',
  'Magazin darüber — hier passen nur {0} mm': 'Magazine above — only {0} mm fit here',
  'Platte in Fach {0}-{1} darüber — hier passen nur {2} mm':
    'Plate in slot {0}-{1} above — only {2} mm fit here',
  'X': 'X',
  'X/Y/Z = ERSTER Fahrpunkt der Bewegung. Der Rest der Türbewegung folgt daraus (Pin = Bogenradius).':
    'X/Y/Z = FIRST travel point of the move. The rest of the door motion follows from it (pin = arc radius).',
  'X/Y/Z = ERSTER Fahrpunkt (dort greift der Arm die OFFENE Tür — Bogen-Seite). Die Schließform folgt automatisch (Pin = Bogenradius).':
    'X/Y/Z = FIRST travel point (where the arm grabs the OPEN door — arc side). The closing shape follows automatically (pin = arc radius).',
  'Sichere Anfahrt vor den Drucker — eigene Start-Position. Ohne eigene Werte gilt die Auswurf-Position.':
    'Safe approach in front of the printer — its own start position. Without own values the eject position applies.',
  'Drucker-Bett → Z{0}': 'Printer bed → Z{0}',
  'Drucker-Bett homen': 'Home printer bed',
  'Z200 = Ladeposition für den Platten-Wechsel. Drucker muss idle sein.':
    'Z200 = load position for the plate change. The printer must be idle.',

  // Regal-Abschnitt
  'am Drucker': 'at the printer',
  'zu dicht am Endschalter': 'too close to the endstop',
  '{0} Fächer · Höhe Fach 1 {1} mm · Abstand {2} mm':
    '{0} slots · height of slot 1 {1} mm · spacing {2} mm',
  'X-Position (mm)': 'X position (mm)',
  'absolut auf der Schiene': 'absolute on the rail',
  'Y-Engage (mm)': 'Y engage (mm)',
  'wie weit der Arm ins Fach fährt': 'how far the arm reaches into the slot',
  'Höhe Fachboden 1 (mm)': 'Height of shelf 1 (mm)',
  'Name (optional)': 'Name (optional)',
  'Gehört zu Drucker': 'Belongs to printer',
  '— alle Drucker —': '— all printers —',
  'Die Zuordnung entscheidet, wo die Farm die fertigen Platten dieses Druckers einlagert und woher sie leere holt. „Alle Drucker" = gemeinsamer Pool.':
    'The assignment decides where the farm stores this printer\'s finished plates and where it takes empty ones from. "All printers" = shared pool.',
  'X {0} mm liegt näher am Endschalter als der Andruck-Weg ({1} mm) — Greifen und Ablegen gehen hier nicht, nur Anfahren. Regal weiter weg stellen oder den Andruck-Weg verkleinern.':
    'X {0} mm is closer to the endstop than the push distance ({1} mm) — grabbing and storing are impossible here, only approaching. Move the rack further away or reduce the push distance.',
  'Einmessen & Test': 'Teach-in & test',
  'Regal {0}, Fach 1': 'Rack {0}, slot 1',
  'Der Greifer soll genau vor Fach 1 dieses Regals stehen. Daraus folgen X, Y-Engage und die Höhe von Fachboden 1; die übrigen Fächer rechnet Printloom aus dem Fach-Abstand.':
    'The gripper should sit exactly in front of slot 1 of this rack. X, Y engage and the height of shelf 1 follow from that; Printloom computes the other slots from the slot spacing.',
  'R{0} Fach {1} anfahren…': 'Approach R{0} slot {1}…',
  '▶ Magazin': '▶ Magazine',
  '„Anfahren" fährt nur vors Fach (greift nicht). Magazin = oberstes Fach ({0}) wird ohne Anheben gegriffen; die Entnahme zählt den Bestand runter.':
    '"Approach" only drives in front of the slot (no grab). Magazine = top slot ({0}) is grabbed without lifting; taking one counts the stock down.',
  'Zugeordnet: {0}.': 'Assigned to: {0}.',
  '{0} Regale · {1} Fächer · Magazin-Fach {2} — Anzahl in Konfiguration → Rack Configuration':
    '{0} racks · {1} slots · magazine slot {2} — counts under Configuration → Rack Configuration',

  // Gemeinsame Werte + Prüfung
  '🔧 Greifer & Platte (für alle Module)': '🔧 Gripper & plate (for all modules)',
  'Andruck-Weg {0} mm · Platte {1} mm': 'Push distance {0} mm · plate {1} mm',
  'bestimmt den Rückzugs-Y ({0} mm)': 'sets the pullback Y ({0} mm)',
  'Andruck-Weg: der Arm fährt beim Greifen/Ablegen um diesen Weg über die X hinaus, um den Greifer in die Halterung zu drücken (Auswerfen/Einlegen: +, Greifen/Ablegen: −). Original 30. ACHTUNG: Genau diese Bewegung IST der Griff — bei 0 hakt der Greifer nicht ein, der Arm fährt vor und kommt leer zurück.':
    'Push distance: on grab/store the arm moves this far beyond X to press the gripper into the bracket (eject/place: +, grab/store: −). Original 30. CAUTION: that move IS the grab — at 0 the gripper never engages, the arm moves in and comes back empty.',
  'Greifen & Ablegen (alle Regale)': 'Grab & store (all racks)',
  'Farm: Greifen als App-G-code': 'Farm: grab as app G-code',
  'Farm: Ablegen als App-G-code': 'Farm: store as app G-code',
  'Prüft jede Bewegung aller Drucker und Regale, bevor sie gesendet wird.':
    'Checks every move of every printer and rack before it is sent.',
  'Geprüft werden alle Operationen über alle Drucker, Regale und das erste/letzte Fach — dort liegen die Extremwerte. Ob eine Position mechanisch passt (z. B. genau vor dem Fach), kann nur das Einmessen zeigen.':
    'All operations are checked across every printer, every rack and the first/last slot — that is where the extremes are. Whether a position fits mechanically (e.g. exactly in front of the slot) can only be shown by teaching it in.',

  // Schiene
  'Home liegt bei X 0 (Endschalter, rechts am Gerät) — deshalb ist die Schiene von rechts nach links gezeichnet. Die Positionen kommen aus den Abschnitten unten; es gibt keine zweite Stelle, an der sie stehen. Ein Klick springt zum Abschnitt.':
    'Home sits at X 0 (endstop, right-hand side of the machine) — that is why the rail is drawn right to left. The positions come from the sections below; there is no second place where they live. A click jumps to the section.',
  '⚠ Zwei Module stehen an derselben X-Position — das kann nur eines von beiden sein.':
    '⚠ Two modules sit at the same X position — it can only be one of them.',

  // Backend-Vorlagen (siehe trProblem)
  'Regal {0} und Regal {1} stehen beide bei X {2} mm — zwei Regale können nicht an derselben Stelle stehen.':
    'Rack {0} and rack {1} both sit at X {2} mm — two racks cannot be in the same place.',
  '„{0}“ steht bei X {1} mm — beim Auswerfen und Einlegen fährt der Arm um den Andruck-Weg ({2} mm) weiter und käme auf X {3} mm, über die Achsgrenze X {4} mm.':
    '"{0}" sits at X {1} mm — when ejecting and placing, the arm moves the push distance ({2} mm) further and would end up at X {3} mm, beyond the axis limit X {4} mm.',
  '„{0}“ und „{1}“ stehen beide bei X {2} mm — zwei Drucker können nicht an derselben Stelle stehen.':
    '"{0}" and "{1}" both sit at X {2} mm — two printers cannot be in the same place.',
  '„{0}“ ({1}) fährt auf {2} {3} mm — unter den Endschalter (0 mm). Klipper würde die Bewegung mitten im Ablauf abbrechen.':
    '"{0}" ({1}) moves to {2} {3} mm — below the endstop (0 mm). Klipper would abort the move mid-sequence.',
  '„{0}“ ({1}) fährt auf {2} {3} mm — über die Achsgrenze {4} {5} mm. Klipper würde die Bewegung abbrechen.':
    '"{0}" ({1}) moves to {2} {3} mm — beyond the axis limit {4} {5} mm. Klipper would abort the move.',
  'Regal {2}: Fach-Abstand ergibt keinen Schritt nach oben ({0} mm) — alle Fächer lägen auf derselben Höhe. Gemessener Abstand von Fach zu Fach muss über {1} mm liegen.':
    'Rack {2}: the slot spacing produces no upward step ({0} mm) — all slots would sit at the same height. The measured slot-to-slot distance must be more than {1} mm.',
  'Regal {2}: Greif-Y ({0} mm) liegt nicht vor der Rückzugsposition ({1} mm) — der Arm würde beim Greifen nach hinten statt nach vorn fahren.':
    'Rack {2}: the engage Y ({0} mm) is not in front of the pullback position ({1} mm) — the arm would move backwards instead of forwards when grabbing.',
  'In Arbeit': 'In progress',
  'Noch in Arbeit — diese Bauform lässt sich noch nicht auswählen.':
    'Still in progress — this variant cannot be selected yet.',
  'Aktueller Druck': 'Current print',
  'Kennzahlen': 'Key figures',
  '{0} Fach/Fächer druckt gerade': '{0} slot(s) currently printing',
  'Panel am Rahmen ziehen zum Verschieben, an der rechten unteren Ecke zum Größe-Ändern. Jede Bildschirmbreite hat ihre eigene Anordnung — am Handy liegt alles untereinander.':
    'Drag a panel by its frame to move it, by its bottom-right corner to resize it. Every screen width has its own arrangement — on a phone everything is stacked.',
  'Nichts in der Warteschlange.': 'Nothing in the queue.',
  'Kein Regal konfiguriert.': 'No rack configured.',
  'Noch keine abgeschlossenen Jobs.': 'No completed jobs yet.',
  'Noch keine Ereignisse in den letzten 24 Stunden.': 'No events in the last 24 hours.',
  'Greifer': 'Gripper',
  'Welcher Greifarm ist am OTTOeject?': 'Which gripper arm is fitted to the OTTOeject?',
  'Standard-Greifer': 'Standard gripper',
  'Der ausgelieferte Greifarm. Er fährt seitlich über den Greifpunkt hinaus und klemmt die Platte in ihrer Halterung fest bzw. schiebt sie beim Ablegen wieder heraus.':
    'The gripper arm as shipped. It moves sideways past the grip point and clamps the plate into its holder, or pushes it back out when storing.',
  'Magnet-Greifer': 'Magnetic gripper',
  'Material ({0} g)': 'Material ({0} g)',
  'Filamentpreis steht auf 0 — unter Konfiguration → Energie & Kosten eintragen.':
    'The filament price is set to 0 — enter it under Configuration → Energy & costs.',
  'Material aus {0} von {1} Drucken — die übrigen Dateien nennen keinen Verbrauch.':
    'Material from {0} of {1} prints — the remaining files do not state their usage.',
  'Einmessen': 'Measuring in',
  'Komponenten · Drucker · OTTOeject · Regal · Kalibrierung · Einmessen in einem Durchlauf.':
    'Components · printer · OTTOeject · rack · calibration · measuring in, in one pass.',
  '! Dieser Assistent richtet die Farm in einem Durchlauf ein. Du kannst jeden Schritt überspringen und später in der Konfiguration ändern.':
    '! This wizard sets the farm up in one pass. You can skip any step and change it later in the configuration.',
  'Positionen einmessen — geführt, Station für Station': 'Measure the positions in — guided, station by station',
  'Weiter zum Einmessen →': 'On to measuring in →',
  'Jetzt die echten Positionen: Regal 1 als Anker, dann Magazin, äußerstes Regal und Drucker. Printloom fährt hin, du justierst nach.':
    'Now the real positions: rack 1 as the anchor, then the magazine, the outermost rack and the printer. Printloom drives there, you adjust.',
  'Feinjustage, Tür und Greif-Test danach im Drucker-Tab — dorthin führt der Knopf unten. Sequenzen im':
    'Fine-tuning, door and grip test afterwards in the printer tab — the button below takes you there. Sequences in the',
  'Geometrie nicht lesbar': 'Geometry could not be read',
  'Anker': 'Anchor',
  'Fach-Abstand': 'Slot spacing',
  'Regal-Abstand': 'Rack spacing',
  'Der Greifer soll genau vor Fach 1 des Regals direkt am Drucker stehen. Daraus folgen X, Greif-Y und die Höhe von Fachboden 1.':
    'The gripper should sit exactly in front of slot 1 of the rack next to the printer. X, the engage Y and the height of shelf 1 follow from that.',
  'Magazin in Regal 1': 'Magazine in rack 1',
  'Printloom fährt die gerechnete Höhe des Magazins an. Steht der Greifer daneben, hier nachjustieren — aus den beiden gemessenen Höhen folgt der Fach-Abstand, ohne dass du ihn abmessen musst.':
    'Printloom drives to the calculated height of the magazine. If the gripper is off, adjust here — the slot spacing follows from the two measured heights, so you never have to measure it yourself.',
  'Das äußerste Regal. Daraus folgt der Abstand der Regale; die Regale dazwischen werden gleichmäßig verteilt und bleiben einzeln korrigierbar.':
    'The outermost rack. The rack spacing follows from it; the racks in between are spaced evenly and stay individually adjustable.',
  'Drucker: Auswurf': 'Printer: eject',
  'Drucker: Einlegen': 'Printer: place',
  'Der Greifer muss genau an der Platte im Drucker ansetzen.':
    'The gripper has to engage the plate in the printer exactly.',
  'Anfahren, mit den Pfeilen justieren, übernehmen — der Wert kommt aus der echten Ist-Position, nicht aus einem Eingabefeld.':
    'Drive there, adjust with the arrows, apply — the value comes from the real current position, not from an input field.',
  'Diese Station überspringen →': 'Skip this station →',
  'Übersprungene Stationen behalten die Werte der Drucker-Vorlage. Nachholen kannst du sie jederzeit im Drucker-Tab über 📐.':
    'Skipped stations keep the values from the printer template. You can catch up any time in the printer tab via 📐.',
  '✓ Einmessen abgeschlossen': '✓ Measuring in complete',
  'Einmessen später fortsetzen': 'Continue measuring in later',
  'Test': 'Testing',
  'Magnet · Anheben {0} mm · Ablegen +{1}/−{2} mm · Platte {3} mm':
    'Magnet · lift {0} mm · store +{1}/−{2} mm · plate {3} mm',
  'Anheben (mm)': 'Lift (mm)',
  'Greifen: über Fachhöhe': 'Grabbing: above slot height',
  'Einfahrhöhe (mm)': 'Entry height (mm)',
  'Ablegen: über Fachhöhe': 'Storing: above slot height',
  'Ablöse-Tiefe (mm)': 'Release depth (mm)',
  'Ablegen: UNTER Fachhöhe': 'Storing: BELOW slot height',
  'Y-Vorposition (mm)': 'Y approach (mm)',
  'Abstand vor dem Fach': 'distance in front of the slot',
  'X-Versatz Ablegen (mm)': 'X offset when storing (mm)',
  '0 = wie beim Greifen': '0 = same as when grabbing',
  'Magnet-Greifer: beim GREIFEN fährt der Arm auf Fachhöhe unter die Platte und hebt sie an. Beim ABLEGEN kommt er höher herein und senkt sich UNTER die Fachhöhe — dabei bleibt die Platte liegen und löst sich vom Magneten. Kein Weg nach links/rechts; der Andruck-Weg gilt nur noch für Auswurf und Einlegen am Drucker.':
    'Magnetic gripper: when GRABBING the arm moves in at slot height underneath the plate and lifts it. When STORING it enters higher and lowers BELOW the slot height — the plate stays behind and releases from the magnet. No left/right travel; the push distance now only applies to ejecting and placing at the printer.',
  'Die Startwerte stammen aus einer Messung an Regal 3 Fach 1 (Fachhöhe 15 mm): Greifen Z15 → Y300 → Y342 → Z30 → Y20, Ablegen Z50 → Y342 → Z10 → Y300. Weicht dein Aufbau ab, sind das die Stellschrauben.':
    'The starting values come from a measurement on rack 3 slot 1 (slot height 15 mm): grabbing Z15 → Y300 → Y342 → Z30 → Y20, storing Z50 → Y342 → Z10 → Y300. If your build differs, these are the adjustments.',
  'Umgebauter Greifarm mit magnetischem Greifmechanismus. Beim Greifen fährt der Arm auf Fachhöhe unter die Platte und hebt sie an; beim Ablegen kommt er höher herein und senkt sich unter die Fachhöhe, sodass die Platte liegen bleibt. Kein Weg mehr nach links/rechts, und Magazin und Lagerfach werden zur selben Bewegung. Die Z-Wege stellst du im Drucker-Tab ein.':
    'A converted gripper arm with a magnetic grip mechanism. When grabbing, the arm moves in at slot height underneath the plate and lifts it; when storing it enters higher and lowers below the slot height so the plate stays behind. No more left/right travel, and magazine and storage slot become the same motion. You set the Z travels in the printer tab.',
  'Fährt…': 'Moving…',
  '⌂ OTTOeject homen': '⌂ Home the OTTOeject',
  '✓ Referenzfahrt gemacht — jetzt kannst du anfahren und justieren.':
    '✓ Homed — you can now drive to a position and adjust it.',
  'Referenzfahrt fehlgeschlagen — ohne sie verweigert der OTTOeject jede Bewegung.':
    'Homing failed — without it the OTTOeject refuses every move.',
  'Zuerst einmal homen. Ohne Referenzfahrt lehnt der OTTOeject jede Bewegung ab, und die Meldung sagt nicht, dass sie fehlt.':
    'Home it once first. Without a homing run the OTTOeject rejects every move, and the message does not say that homing is what is missing.',
}

function deepMerge(base, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return over
  const out = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {}
  for (const k of Object.keys(over)) out[k] = deepMerge(out[k], over[k])
  return out
}

function dictFor(lang) {
  const builtin = translations[lang]
  const pack = dynamicPacks[lang]?.translations
  if (builtin && pack) return deepMerge(builtin, pack)
  if (builtin) return builtin
  if (pack) return deepMerge(translations.de, pack)   // unknown lang → de base + pack
  return translations.de
}

const BUILTIN_NAMES = { de: 'Deutsch', en: 'English' }

export function availableLanguages() {
  const codes = new Set(['de', 'en', ...Object.keys(dynamicPacks)])
  return [...codes].map(code => ({
    code,
    name: dynamicPacks[code]?.name || BUILTIN_NAMES[code] || code.toUpperCase(),
    builtin: code === 'de' || code === 'en',
  }))
}

/* Refresh installed packs from the backend; call once at app startup. */
export async function loadLangPacks() {
  try {
    const r = await systemService.getLangInstalled()
    dynamicPacks = (r.data && typeof r.data === 'object') ? r.data : {}
    localStorage.setItem(PACKS_KEY, JSON.stringify(dynamicPacks))
  } catch { /* keep cached packs on failure */ }
}

/* localStorage gibt es nicht überall (Tests, Service-Worker, „Cookies blockiert").
   tr() wird inzwischen auch aus reinen Service-Modulen gerufen — eine Ausnahme
   hier würde dort echte Logik mitreißen, deshalb still auf Deutsch zurückfallen. */
export function currentLang() {
  try { return localStorage.getItem(LANG_KEY) || 'de' } catch { return 'de' }
}

/* tr(germanText, …args): the app is authored in German; pass the exact German
   source string and get the translation for the active language.
   Missing entries fall back to the German source verbatim — so a forgotten
   string is never broken, just untranslated. Dynamic language packs may add a
   "strings" map ({ "<de source>": "<translation>" }) for other languages.

   Diese Funktion steht bewusst AUSSERHALB von useLanguage(): Etliche Texte
   stehen in Modul-Konstanten (Status-Tabellen, Schritt-Namen, Fehlergründe) oder
   in reinen Service-Dateien ohne Komponente. Ohne freie Funktion blieben genau
   die hartkodiert. Der Sprachwechsel lädt die Seite neu (siehe setLanguage),
   deshalb ist ein Lesen zur Aufrufzeit immer aktuell. */
export function tr(de, ...args) {
  const lang = currentLang()
  const map = lang === 'en' ? EN_STRINGS : (dynamicPacks[lang]?.strings || null)
  let out = (map && map[de] != null) ? map[de] : de
  args.forEach((a, i) => { out = out.replaceAll(`{${i}}`, String(a)) })
  return out
}

/* Meldung aus dem Backend übersetzen.

   Das Backend kennt die eingestellte Sprache nicht — die steht im Browser. Es
   schickt deshalb zu Prüf-Meldungen (Geometrie, Layout) neben dem fertigen
   deutschen Satz auch die VORLAGE mit {0}-Platzhaltern und die Werte einzeln.
   Hier wird die Vorlage übersetzt und dann gefüllt. Werte, die selbst Text sind
   (z. B. „Auswerfen"), sind wieder Übersetzungs-Schlüssel und laufen erneut
   durch tr(); Zahlen bleiben, wie sie sind.
   Ohne Vorlage (älteres Backend) bleibt der mitgelieferte Satz stehen. */
export function trProblem(p) {
  if (!p) return ''
  if (typeof p === 'string') return tr(p)
  if (!p.template) return p.message || ''
  const args = (p.params || []).map(v => (typeof v === 'string' ? tr(v) : v))
  return tr(p.template, ...args)
}

/* BCP-47-Kennung für Datum/Uhrzeit/Zahlen. Ohne die stünde in der englischen
   Oberfläche weiter „24.07.2026" statt „07/24/2026". */
const LOCALES = { de: 'de-DE', en: 'en-GB' }
export function locale() {
  const lang = currentLang()
  return LOCALES[lang] || dynamicPacks[lang]?.locale || lang
}

export function useLanguage() {
  const lang = currentLang()
  const dict = dictFor(lang)
  const fallback = translations.de
  const t = (key) => {
    const parts = key.split('.')
    let r = dict, f = fallback
    for (const p of parts) { r = r?.[p]; f = f?.[p] }
    return r ?? f ?? key
  }
  return { lang, t, tr, locale: locale() }
}

export function setLanguage(lang) {
  try { localStorage.setItem(LANG_KEY, lang) } catch {}
  window.location.reload()
}

/* Returns all translateable German source strings with their English reference
   translations as values — ready to hand to an AI ("translate each value to XY"). */
export function getTranslationTemplate() {
  return { ...EN_STRINGS }
}
