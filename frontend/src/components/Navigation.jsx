import React, { useState, useRef } from 'react'
import { VERSION } from '../version'
import { useLanguage, setLanguage, availableLanguages } from '../services/i18n'
import { fileService } from '../services/api'

const icons = {
  autofarm: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      <circle cx="19" cy="19" r="3" fill="currentColor" className="text-emerald-400"/>
    </svg>
  ),
  live: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M7.76 7.76a6 6 0 0 0 0 8.49"/>
      <path d="M20.07 4.93a10 10 0 0 1 0 14.14"/><path d="M3.93 4.93a10 10 0 0 0 0 14.14"/>
    </svg>
  ),
  projekt: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="4" rx="1"/>
      <rect x="3" y="10" width="11" height="4" rx="1"/>
      <rect x="3" y="17" width="14" height="4" rx="1"/>
      <circle cx="19" cy="19" r="3" fill="none"/>
      <line x1="17.5" y1="19" x2="20.5" y2="19"/><line x1="19" y1="17.5" x2="19" y2="20.5"/>
    </svg>
  ),
  rack: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="4" rx="1"/>
      <rect x="2" y="10" width="20" height="4" rx="1"/>
      <rect x="2" y="17" width="20" height="4" rx="1"/>
    </svg>
  ),
  calibration: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
    </svg>
  ),
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  files: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
    </svg>
  ),
  controls: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
      <path d="M14.66 9.34a5 5 0 0 1 0 5.32M9.34 9.34a5 5 0 0 0 0 5.32"/>
    </svg>
  ),
  system: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  ),
  sequence: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
      <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  ),
  analyze: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  ),
  simulator: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="8" width="5" height="9" rx="1"/>
      <rect x="9.5" y="5" width="5" height="14" rx="1"/>
      <rect x="17" y="8" width="5" height="9" rx="1"/>
      <line x1="7" y1="12.5" x2="9.5" y2="12.5"/>
      <line x1="14.5" y1="12.5" x2="17" y2="12.5"/>
    </svg>
  ),
  diagnose: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M9 3h6"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/>
      <path d="M3 9v6"/><path d="M21 9v6"/>
      <path d="M3 15v2a2 2 0 0 0 2 2h4"/><path d="M21 15v2a2 2 0 0 1-2 2h-4"/>
      <path d="M9 21h6"/>
      <path d="M12 8v4"/><path d="M10 12h4"/>
    </svg>
  ),
  profiles: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <circle cx="12" cy="14" r="2.2"/><path d="M8.5 19a3.5 3.5 0 0 1 7 0"/>
    </svg>
  ),
  filamente: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  ),
  config: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
}

function buildPages(t, tr) {
  return [
    { id: 'dashboard',     label: t('nav.dashboard'),     icon: 'dashboard'   },
    { id: 'files',         label: t('nav.files'),         icon: 'files'       },
    { id: 'steuerung',     label: tr('Steuerung'),        icon: 'controls'    },
    { id: 'autofarm',      label: t('nav.autofarm'),      icon: 'autofarm'    },
    { id: 'projekt',       label: tr('Projekt'),          icon: 'projekt'     },
    { id: 'sequence',      label: t('nav.sequence'),      icon: 'sequence'    },
    { id: 'profiles',      label: t('nav.profiles'),      icon: 'profiles'    },
    { id: 'filamente',     label: tr('Filamente'),        icon: 'filamente'   },
    { id: 'configuration', label: t('nav.configuration'), icon: 'config'      },
    { id: 'setup',         label: tr('Setup-Assistent'),  icon: 'config'      },
    { id: 'system',        label: t('nav.system'),        icon: 'system'      },
  ]
}

/* ─── Schnell-Upload ──────────────────────────────────────────────── */
function QuickUpload() {
  const { tr } = useLanguage()
  const [dragging,   setDragging]   = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [lastFile,   setLastFile]   = useState(null)
  const [err,        setErr]        = useState(null)
  const inputRef = useRef()

  const doUpload = async (files) => {
    const valid = [...files].filter(f => f.name.endsWith('.gcode') || f.name.endsWith('.3mf'))
    if (!valid.length) { setErr(tr('Nur .gcode / .3mf')); setTimeout(() => setErr(null), 3000); return }
    setUploading(true); setErr(null)
    try {
      for (const file of valid) {
        const fd = new FormData()
        fd.append('file', file)
        await fileService.uploadFile(fd)
        setLastFile(file.name.replace(/\.[^.]+$/, ''))
      }
      window.dispatchEvent(new CustomEvent('printloom:fileUploaded'))
      setTimeout(() => setLastFile(null), 4000)
    } catch (e) {
      setErr(e.response?.data?.detail ?? tr('Upload fehlgeschlagen'))
      setTimeout(() => setErr(null), 4000)
    }
    setUploading(false)
  }

  return (
    <div className="px-3 py-2 border-t border-surface-800/60">
      <input ref={inputRef} type="file" accept=".gcode,.3mf" multiple className="hidden"
        onChange={e => { doUpload(e.target.files); e.target.value = '' }} />
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
        onDrop={e => { e.preventDefault(); setDragging(false); doUpload(e.dataTransfer.files) }}
        className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed cursor-pointer select-none transition-all duration-200 py-5 ${
          uploading
            ? 'border-blue-600/50 bg-blue-950/20'
            : err
              ? 'border-red-700/50 bg-red-950/15'
              : lastFile
                ? 'border-emerald-700/50 bg-emerald-950/15'
                : dragging
                  ? 'border-blue-500/80 bg-blue-900/25 shadow-[0_0_18px_rgba(59,130,246,0.12)] scale-[1.02]'
                  : 'border-surface-700/40 bg-surface-800/10 hover:border-surface-600/60 hover:bg-surface-800/25'
        }`}
      >
        {uploading ? (
          <>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-blue-400 animate-spin">
              <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
            </svg>
            <span className="text-[11px] font-medium text-blue-400">{tr('Hochladen…')}</span>
          </>
        ) : err ? (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span className="text-[10px] text-red-400 text-center px-1">{err}</span>
          </>
        ) : lastFile ? (
          <>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-emerald-400">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span className="text-[11px] font-medium text-emerald-400 truncate max-w-[140px] text-center">{lastFile}</span>
            <span className="text-[9px] text-emerald-600">{tr('Hochgeladen')}</span>
          </>
        ) : (
          <>
            <div className={`transition-transform duration-150 ${dragging ? 'scale-110 -translate-y-0.5' : ''}`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
                className={`transition-colors duration-200 ${dragging ? 'text-blue-400' : 'text-surface-600'}`}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <span className={`text-[11px] font-medium transition-colors duration-200 ${dragging ? 'text-blue-300' : 'text-surface-500'}`}>
              {dragging ? tr('Hier ablegen') : tr('Schnell-Upload')}
            </span>
            <span className="text-[9px] text-surface-700 font-mono">.gcode · .3mf</span>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── Language Toggle ─────────────────────────────────────────────── */
function LanguageToggle() {
  const { lang } = useLanguage()
  const langs = availableLanguages()
  return (
    <div className="px-3 py-2 border-t border-surface-800 flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-surface-700 uppercase tracking-wide mr-1">Lang</span>
      {langs.map(l => (
        <button
          key={l.code}
          onClick={() => setLanguage(l.code)}
          title={l.name}
          className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
            lang === l.code
              ? 'bg-blue-700 border-blue-600 text-white'
              : 'bg-surface-800 border-surface-700 text-surface-500 hover:text-surface-300 hover:border-surface-600'
          }`}
        >
          {l.code.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/* ─── Navigation ─────────────────────────────────────────────────── */
function Navigation({ currentPage, setCurrentPage, updateAvailable }) {
  const { t, tr } = useLanguage()
  const pages = buildPages(t, tr)
  const [compact, setCompact] = useState(() => localStorage.getItem('ottomat3d_nav_compact') === '1')

  const toggleCompact = () => setCompact(v => {
    const next = !v
    localStorage.setItem('ottomat3d_nav_compact', next ? '1' : '0')
    return next
  })

  if (compact) {
    return (
      <nav className="w-12 flex-shrink-0 bg-surface-900/60 border-r border-surface-800/50 flex flex-col backdrop-blur-sm">
        <div className="flex-1 overflow-y-auto py-2">
          {pages.map(page => (
            <button
              key={page.id}
              onClick={() => setCurrentPage(page.id)}
              title={page.label}
              className={`w-full flex items-center justify-center py-2.5 transition-colors relative ${
                currentPage === page.id ? 'text-blue-400' : 'text-surface-600 hover:text-surface-300'
              }`}
            >
              {icons[page.icon]}
              {page.id === 'system' && updateAvailable && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>
        <button
          onClick={toggleCompact}
          title={tr('Seitenleiste erweitern')}
          className="w-full py-3 flex items-center justify-center text-surface-700 hover:text-surface-400 border-t border-surface-800/50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>
          </svg>
        </button>
        <div className="py-2.5 flex items-center justify-center border-t border-surface-800/50">
          <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-500 to-blue-700" />
        </div>
      </nav>
    )
  }

  return (
    <nav className="w-56 flex-shrink-0 bg-surface-900/60 border-r border-surface-800/50 flex flex-col backdrop-blur-sm">
      <div className="p-3 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-3 mb-3">
          <p className="section-label">{tr('Navigation')}</p>
          <button
            onClick={toggleCompact}
            title={tr('Seitenleiste minimieren')}
            className="text-surface-700 hover:text-surface-400 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>
            </svg>
          </button>
        </div>
        <div className="space-y-0.5">
          {pages.map(page => (
            <button
              key={page.id}
              onClick={() => setCurrentPage(page.id)}
              className={`nav-item w-full ${currentPage === page.id ? 'active' : ''}`}
            >
              <span className={currentPage === page.id ? 'text-blue-400' : 'text-surface-600'}>
                {icons[page.icon]}
              </span>
              <span className="flex-1 text-left">{page.label}</span>
              {page.id === 'system' && updateAvailable && (
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 animate-pulse" title={tr('Update verfügbar')} />
              )}
            </button>
          ))}
        </div>
      </div>

      <QuickUpload />
      <LanguageToggle />

      <div className="px-4 py-3 border-t border-surface-800/50">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-500 to-blue-700 flex-shrink-0" />
          <div>
            <p className="text-[10px] text-surface-600 font-mono leading-none">Printloom</p>
            <p className="text-[10px] text-surface-700 font-mono mt-0.5">v{VERSION}</p>
          </div>
        </div>
      </div>
    </nav>
  )
}

export default Navigation
