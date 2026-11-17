import { useCallback, useEffect, useState } from 'react'
import { apiError } from '../services/apiError'
import { systemService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'
import { pushToast } from '../services/toast'

/* Datenspeicher (System): Welche Datendatei ist unlesbar?
   ──────────────────────────────────────────────────────
   Seit v1.1.48 ersetzt Printloom eine kaputte Datei nicht mehr still durch die
   Vorgabe — bis dahin überschrieb das nächste Speichern die echten Daten (Regal,
   Warteschlange, Einstellungen …). Hier sieht man die betroffene Datei und setzt sie
   auf ausdrücklichen Wunsch zurück; die kaputte Fassung bleibt als Kopie liegen. */
export default function DataFiles() {
  const { tr } = useLanguage()
  const [files, setFiles] = useState(null)
  const [busy, setBusy]   = useState('')

  const load = useCallback(() => {
    systemService.dataFiles()
      .then(r => setFiles(r.data?.files || []))
      .catch(e => console.warn('Datenspeicher nicht geladen:', e?.message || e))
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('printloom:brokenFile', load)
    return () => window.removeEventListener('printloom:brokenFile', load)
  }, [load])

  const reset = async (f) => {
    if (!(await confirmDialog({
      title: tr('Datei zurücksetzen?'),
      message: tr('„{0}“ wird durch die Vorgabe ersetzt. Die kaputte Fassung bleibt als Kopie liegen ({0}.broken-…). Was darin stand, ist danach in Printloom weg.', f.file),
      confirmLabel: tr('Zurücksetzen'),
    }))) return
    setBusy(f.key)
    try {
      const r = await systemService.resetDataFile(f.key)
      pushToast(tr('Zurückgesetzt, Kopie: {0}', r.data?.backup || '?'), 'success')
      load()
      window.dispatchEvent(new CustomEvent('printloom:brokenFile', { detail: {} }))
    } catch (e) {
      pushToast(apiError(e), 'error')
    } finally { setBusy('') }
  }

  if (!files) return null
  const broken = files.filter(f => f.broken)

  return (
    <div className="card space-y-2">
      <p className="section-label">{tr('Datenspeicher')}</p>
      {broken.length === 0 ? (
        <p className="text-[12px] text-surface-400">{tr('Alle Datendateien sind lesbar.')}</p>
      ) : broken.map(f => (
        <div key={f.key} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded border border-red-700 bg-red-950">
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-mono text-red-300">{f.file}</p>
            <p className="text-[11px] text-red-300/80 break-words">{tr('unlesbar: {0}', f.reason || '?')}</p>
          </div>
          {f.resettable
            ? <button onClick={() => reset(f)} disabled={busy === f.key} className="btn btn-danger btn-sm text-[11px]">
                {tr('Zurücksetzen (Kopie bleibt)')}
              </button>
            : <span className="text-[11px] text-surface-400">{tr('Aus einem Backup einspielen')}</span>}
        </div>
      ))}
    </div>
  )
}
