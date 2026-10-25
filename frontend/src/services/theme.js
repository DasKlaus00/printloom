// Darstellung umschalten: Hell, Dunkel oder dem System folgen — wie in der
// Prüfplanung. Jedes Thema tauscht nur die Farb-Variablen aus index.css; am
// <html> steht immer das AUFGELÖSTE Thema (light | dark), damit das CSS nichts
// über „auto" wissen muss.
//
// Standard ist „System" (seit v1.1.38). Gespeichert wird NUR eine ausdrückliche
// Wahl — der Startwert nicht. Sonst würde aus „nie gewählt" beim ersten Laden ein
// fest gespeichertes „Hell", und ein späterer Wechsel des Standards käme bei
// niemandem mehr an. Genau das war in v1.1.36 der Fall: Dort schrieb jeder Start
// den Wert in `printloom_theme`. Deshalb gibt es jetzt einen eigenen Schlüssel für
// die Wahl; der alte zählt nur noch, wenn er ein dunkles Thema meint.
//
// Gleiche Logik als Vorab-Skript in index.html (gegen das Aufblitzen) — beide
// zusammen ändern.

export const THEMES = [
  { id: 'light', label: 'Hell',   barColor: '#ffffff' },
  { id: 'dark',  label: 'Dunkel', barColor: '#1d2228' },
  { id: 'auto',  label: 'System', barColor: null },
]

export const DEFAULT_THEME = 'auto'
const CHOICE_KEY = 'printloom_theme_choice'   // nur ausdrückliche Wahl
const LEGACY_KEY = 'printloom_theme'          // bis v1.1.37

// Frühere dunkle Themen (bis v1.1.35: dark, slate, midnight). Wer eines davon
// hatte, bleibt im Dunkeln, statt plötzlich weiß angestrahlt zu werden.
const LEGACY_DARK = new Set(['dark', 'slate', 'midnight'])

const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }

export function getTheme() {
  const choice = read(CHOICE_KEY)
  if (THEMES.some(x => x.id === choice)) return choice
  if (LEGACY_DARK.has(read(LEGACY_KEY))) return 'dark'
  return DEFAULT_THEME
}

const systemDark = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches

export function resolveTheme(id) {
  return id === 'auto' ? (systemDark() ? 'dark' : 'light') : id
}

let mql = null
const onSystemChange = () => { if (getTheme() === 'auto') paint('auto') }

function paint(id) {
  const resolved = resolveTheme(id)
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  // Statusleisten-Farbe (Mobil/PWA) mitziehen.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEMES.find(x => x.id === resolved)?.barColor || '#ffffff')
  window.dispatchEvent(new CustomEvent('printloom:themeChanged', { detail: resolved }))
}

function watchSystem() {
  // „System" folgt dem Betriebssystem auch, während die Seite offen ist.
  if (!mql && typeof window !== 'undefined' && window.matchMedia) {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener?.('change', onSystemChange)
  }
}

/** Beim Start: anwenden, was gilt — ohne etwas zu speichern. */
export function initTheme() {
  watchSystem()
  paint(getTheme())
}

/** Ausdrückliche Wahl (Umschalter oben rechts, System → Darstellung): merken und anwenden. */
export function applyTheme(id) {
  const theme = THEMES.some(x => x.id === id) ? id : DEFAULT_THEME
  try { localStorage.setItem(CHOICE_KEY, theme) } catch { /* Privatmodus */ }
  watchSystem()
  paint(theme)
}
