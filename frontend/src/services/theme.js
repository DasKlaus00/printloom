// Runtime theme switching. Each theme just remaps the `surface` CSS-var ramp
// defined in index.css; the default (dark) needs no data-theme attribute.

export const THEMES = [
  { id: 'dark',     label: 'Dunkel',      swatch: '#0c0c0c', barColor: '#0a0a0a' },
  { id: 'slate',    label: 'Slate',       swatch: '#1e293b', barColor: '#0f172a' },
  { id: 'midnight', label: 'Mitternacht', swatch: '#141c30', barColor: '#0a0e1a' },
  { id: 'light',    label: 'Hell',        swatch: '#f4f4f6', barColor: '#fcfcfd' },
]

const KEY = 'printloom_theme'

export function getTheme() {
  const t = localStorage.getItem(KEY)
  return THEMES.some(x => x.id === t) ? t : 'dark'
}

export function applyTheme(id) {
  const theme = THEMES.find(x => x.id === id) ? id : 'dark'
  const root = document.documentElement
  if (theme === 'dark') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  localStorage.setItem(KEY, theme)
  // Keep the mobile/PWA status-bar colour in sync.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEMES.find(x => x.id === theme)?.barColor || '#0a0a0a')
  window.dispatchEvent(new CustomEvent('printloom:themeChanged', { detail: theme }))
}
