import React, { useState, useEffect } from 'react'
import { THEMES, getTheme, applyTheme } from '../services/theme'
import { useLanguage } from '../services/i18n'

// Eigene Symbole statt ☀ ☾ ◐ — die Zeichen fallen je nach Schrift winzig aus.
export function ThemeIcon({ id, size = 14 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
              strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  if (id === 'dark') return <svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
  if (id === 'auto') return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/></svg>
  return (
    <svg {...p}>
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
    </svg>
  )
}

/* Hell · Dunkel · System — der kleine Umschalter oben rechts, wie in der
   Prüfplanung. Dieselbe Einstellung wie unter System → Darstellung; beide
   bleiben über das themeChanged-Ereignis gleich. */
export default function ThemeToggle() {
  const { tr } = useLanguage()
  const [theme, setTheme] = useState(getTheme())
  useEffect(() => {
    const sync = () => setTheme(getTheme())
    window.addEventListener('printloom:themeChanged', sync)
    return () => window.removeEventListener('printloom:themeChanged', sync)
  }, [])
  return (
    <div className="segmented" role="group" aria-label={tr('Darstellung')}>
      {THEMES.map(t => (
        <button key={t.id} type="button" title={tr(t.label)} aria-pressed={theme === t.id}
          className={`w-[28px] flex items-center justify-center ${theme === t.id ? 'active' : ''}`}
          onClick={() => { applyTheme(t.id); setTheme(t.id) }}>
          <ThemeIcon id={t.id} size={13} />
        </button>
      ))}
    </div>
  )
}
