// Darstellung umschalten: Hell, Dunkel oder dem System folgen — wie in der
// Prüfplanung (☀ ☾ ◐). Jedes Thema tauscht nur die Farb-Variablen aus index.css;
// am <html> steht immer das AUFGELÖSTE Thema (light | dark), damit das CSS nichts
// über „auto" wissen muss.

export const THEMES = [
  { id: 'light', label: 'Hell',   barColor: '#ffffff' },
  { id: 'dark',  label: 'Dunkel', barColor: '#1d2228' },
  { id: 'auto',  label: 'System', barColor: null },
]

const KEY = 'printloom_theme'

// Frühere Themen (bis v1.1.35) — alle dunkel. Wer eines davon gewählt hatte,
// bleibt im Dunkeln, statt plötzlich weiß angestrahlt zu werden.
const LEGACY_DARK = new Set(['slate', 'midnight'])

export function getTheme() {
  let t = null
  try { t = localStorage.getItem(KEY) } catch { /* Privatmodus */ }
  if (LEGACY_DARK.has(t)) return 'dark'
  return THEMES.some(x => x.id === t) ? t : 'light'
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

export function applyTheme(id) {
  const theme = THEMES.some(x => x.id === id) ? id : 'light'
  try { localStorage.setItem(KEY, theme) } catch { /* Privatmodus */ }
  // „System" folgt dem Betriebssystem auch, während die Seite offen ist.
  if (!mql && window.matchMedia) {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener?.('change', onSystemChange)
  }
  paint(theme)
}
