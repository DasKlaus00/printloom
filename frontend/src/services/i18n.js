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
  'Drucker': 'Printer',
  'Klipper': 'Klipper',
  'Backend offline': 'Backend offline',

  // ── App shell / page titles ──
  'Datei-Bibliothek': 'File Library',
  'Datei-Analyse': 'File Analysis',
  'Steuerung': 'Control',
  'Projekt': 'Project',
  'Konfiguration': 'Configuration',
  'Sequenz-Editor': 'Sequence Editor',
  'Profile': 'Profiles',
  'Setup-Assistent': 'Setup Wizard',
  'Update läuft…': 'Update in progress…',
  'Container wird neugestartet — bitte warten': 'Container is restarting — please wait',
  'Keine Eingaben möglich während des Updates': 'No input possible during the update',
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
  'Bereit': 'Ready',
  'Nicht konfiguriert': 'Not configured',
  'Magazin': 'Magazine',
  'von {0} Platten': 'of {0} plates',
  'Regal': 'Rack',
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
  'Quelle': 'Source',
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
  'Alle': 'All',
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

  // ── Profile ──
  'Kalibrierung': 'Calibration',
  'Sequenzen': 'Sequences',
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
  'Entsperren': 'Unlock',
  'Sperren': 'Lock',
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
  '! Dieser Assistent richtet die Farm in vier Schritten ein. Du kannst jeden Schritt überspringen und später in der Konfiguration ändern.':
    '! This wizard sets up the farm in four steps. You can skip any step and change it later in the configuration.',
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
  'Regale': 'Racks',
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
  'Nicht konfiguriert': 'Not configured',
  '↺ Neu erstellen': '↺ Recreate',
  '+ Erstellen': '+ Create',
  'Generiert eine .3mf mit G28+Z200 — im Sequenzeditor als ⇫ Homing verwenden':
    'Generates a .3mf with G28+Z200 — use as ⇫ Homing in the sequence editor',
  'Regal gespeichert.': 'Rack saved.',
  'Regal-Konfiguration': 'Rack configuration',
  'Größe, Fach-Höhen, Magazin-Fach und Platten-Anzahl pro Rack': 'Size, slot heights, magazine slot and plate count per rack',
  'Fächer/Rack': 'Slots/rack',
  'Fach-Höhe (mm)': 'Slot height (mm)',
  'Höhen-Toleranz (%)': 'Height tolerance (%)',
  '— Sicherheitspuffer': '— safety buffer',
  'z.B. 100 mm → {0} mm effektiv': 'e.g. 100 mm → {0} mm effective',
  'Fach in jedem Rack (Standard: 7)': 'Slot in each rack (default: 7)',
  'Platten pro Magazin': 'Plates per magazine',
  '— aktueller Bestand': '— current stock',
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
  'aktiv': 'active',
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
  'Tür öffnen': 'Open door',
  'Tür schließen': 'Close door',
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
  '{0} Schritte': '{0} steps',
  '+ Hinzufügen:': '+ Add:',
  'Ziel-Fach des Jobs': "job's target slot",
  'Vorrat-Stapel (aus Regal-Einstellungen)': 'stock stack (from rack settings)',
  'Ungültiges Format — seq_new / seq_next fehlen': 'Invalid format — seq_new / seq_next missing',
  'Ablauf des Auto Farms anpassen — Reihenfolge, Zeiten und Parallelausführung. Änderungen werden sofort gespeichert und beim nächsten Lauf verwendet.':
    'Customize the Auto Farm workflow — order, timings and parallel execution. Changes are saved immediately and used on the next run.',
  'Sequenzen aus JSON-Datei laden': 'Load sequences from JSON file',
  '↑ Import': '↑ Import',
  'Alle Sequenzen als JSON-Datei speichern': 'Save all sequences as a JSON file',
  '↓ Export': '↓ Export',
  'First Start (einmal)': 'First Start (once)',
  'Läuft genau einmal beim Farm-Start: Drucker homen + auf Z200 fahren (positionsgenau).':
    'Runs exactly once at farm start: home the printer + move to Z200 (position-accurate).',
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

export function useLanguage() {
  const lang = localStorage.getItem(LANG_KEY) || 'de'
  const dict = dictFor(lang)
  const fallback = translations.de
  const t = (key) => {
    const parts = key.split('.')
    let r = dict, f = fallback
    for (const p of parts) { r = r?.[p]; f = f?.[p] }
    return r ?? f ?? key
  }
  // tr(germanText): the app is authored in German; pass the exact German source
  // string and get the English translation when the UI language is "en".
  // Missing entries fall back to the German source verbatim — so a forgotten
  // string is never broken, just untranslated. Dynamic language packs may add a
  // "strings" map ({ "<de source>": "<translation>" }) for other languages.
  const stringMap = lang === 'en' ? EN_STRINGS : (dynamicPacks[lang]?.strings || null)
  const tr = (de, ...args) => {
    let out = (stringMap && stringMap[de] != null) ? stringMap[de] : de
    // tr('… {0} …', a, b) → positional interpolation
    args.forEach((a, i) => { out = out.replaceAll(`{${i}}`, String(a)) })
    return out
  }
  return { lang, t, tr }
}

export function setLanguage(lang) {
  localStorage.setItem(LANG_KEY, lang)
  window.location.reload()
}
