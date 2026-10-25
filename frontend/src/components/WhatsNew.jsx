import React, { useState, useEffect } from 'react'
import { CHANGELOG } from '../changelog'
import { VERSION } from '../version'
import { useLanguage } from '../services/i18n'

/* „Was ist neu" beim ersten Start nach einem Update (Phase 2.6).

   Der Changelog stand bisher nur auf der System-Seite — wer nicht dorthin ging,
   erfuhr nie, was sich geändert hat. Hier kommt er einmal von selbst, und zwar
   NUR nach einem echten Versionswechsel:

   - Erststart (nichts gespeichert) zeigt NICHTS. Sonst begrüßt eine
     Neuinstallation den Nutzer mit einer Änderungsliste zu Dingen, die er nie
     gesehen hat — die merkt sich einfach die aktuelle Version.
   - Danach erscheint das Fenster genau dann, wenn die gespeicherte Version von
     der laufenden abweicht, und zeigt alle Einträge dazwischen. */

const SEEN_KEY = 'printloom_seen_version'

function cmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

export default function WhatsNew() {
  const { tr, lang } = useLanguage()
  const [entries, setEntries] = useState(null)

  useEffect(() => {
    let seen
    try { seen = localStorage.getItem(SEEN_KEY) } catch { return }
    if (!seen) {
      // Erststart: nur merken, nichts zeigen.
      try { localStorage.setItem(SEEN_KEY, VERSION) } catch { /* Privatmodus */ }
      return
    }
    if (seen === VERSION) return
    const list = CHANGELOG.filter(e => cmp(e.version, seen) > 0 && cmp(e.version, VERSION) <= 0)
    if (list.length) setEntries(list.slice(0, 5))
    else { try { localStorage.setItem(SEEN_KEY, VERSION) } catch { /* egal */ } }
  }, [])

  if (!entries) return null

  const close = () => {
    try { localStorage.setItem(SEEN_KEY, VERSION) } catch { /* egal */ }
    setEntries(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={close}>
      <div className="w-full max-w-lg max-h-[80vh] overflow-auto rounded-xl border border-surface-700 bg-surface-900 p-5 space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-surface-100">{tr('Was ist neu')}</p>
            <p className="text-xs text-surface-500">{tr('Aktualisiert auf Version {0}', VERSION)}</p>
          </div>
          <button onClick={close} className="text-surface-600 hover:text-surface-300">✕</button>
        </div>

        {entries.map(e => (
          <div key={e.version} className="space-y-1.5">
            <p className="text-xs font-mono text-blue-400">v{e.version}</p>
            <ul className="space-y-1 list-disc pl-5">
              {((lang === 'de' ? e.de : e.en) ?? e.de ?? []).map((line, i) => (
                <li key={i} className="text-[12px] leading-relaxed text-surface-300">{line}</li>
              ))}
            </ul>
          </div>
        ))}

        <div className="flex justify-end pt-1">
          <button onClick={close} className="btn btn-primary text-sm">{tr('Verstanden')}</button>
        </div>
      </div>
    </div>
  )
}
