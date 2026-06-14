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
const EN_STRINGS = {}

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
