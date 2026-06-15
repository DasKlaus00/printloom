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
