import { useEffect, useState, useCallback } from 'react'
import { registerConfirm } from '../services/confirm'
import { useLanguage } from '../services/i18n'

/* Einmal in App gemountet. Stellt den Bestätigungsdialog für confirmDialog() bereit. */
export default function ConfirmHost() {
  const { tr } = useLanguage()
  const [state, setState] = useState(null)   // { opts, resolve } | null

  useEffect(() => {
    registerConfirm((opts) => new Promise(resolve => setState({ opts, resolve })))
  }, [])

  const close = useCallback((val) => {
    setState(s => { s?.resolve(val); return null })
  }, [])

  useEffect(() => {
    if (!state) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
      else if (e.key === 'Enter') { e.preventDefault(); close(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, close])

  if (!state) return null
  const o = state.opts || {}
  const danger = o.danger ?? true

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-surface-950/70 backdrop-blur-sm p-4"
      onClick={() => close(false)}
    >
      <div
        className="card max-w-sm w-full space-y-4 border-surface-700 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-surface-100">{o.title || tr('Bestätigen')}</p>
        {o.message && <p className="text-sm text-surface-300 whitespace-pre-line">{o.message}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={() => close(false)} className="btn btn-ghost btn-sm">
            {o.cancelLabel || tr('Abbrechen')}
          </button>
          <button onClick={() => close(true)} autoFocus className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}>
            {o.confirmLabel || tr('Bestätigen')}
          </button>
        </div>
      </div>
    </div>
  )
}
