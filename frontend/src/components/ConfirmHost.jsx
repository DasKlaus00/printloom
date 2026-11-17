import { useEffect, useState, useCallback, useRef } from 'react'
import { registerConfirm, confirmKeyAction } from '../services/confirm'
import { useLanguage } from '../services/i18n'

/* Einmal in App gemountet. Stellt den Bestätigungsdialog für confirmDialog() bereit. */
export default function ConfirmHost() {
  const { tr } = useLanguage()
  const [state, setState] = useState(null)   // { opts, resolve } | null
  const confirmRef = useRef(null)
  const cancelRef = useRef(null)

  useEffect(() => {
    registerConfirm((opts) => new Promise(resolve => setState({ opts, resolve })))
  }, [])

  const close = useCallback((val) => {
    setState(s => { s?.resolve(val); return null })
  }, [])

  useEffect(() => {
    if (!state) return
    const onKey = (e) => {
      const el = document.activeElement
      const focus = el === confirmRef.current ? 'confirm' : el === cancelRef.current ? 'cancel' : 'other'
      const act = confirmKeyAction({ key: e.key, repeat: e.repeat, focus })
      // Enter immer selbst behandeln: sonst löst der Browser zusätzlich den Klick
      // auf den Knopf mit Fokus aus, bei gehaltener Taste wiederholt.
      if (e.key === 'Enter' || e.key === 'Escape') e.preventDefault()
      if (act) close(act === 'confirm')
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
          {/* Bei gefährlichen Aktionen liegt der Fokus auf „Abbrechen": Ein Enter, das
              eigentlich der vorigen Seite galt, bestätigt dann nichts. */}
          <button ref={cancelRef} onClick={() => close(false)} autoFocus={danger} className="btn btn-ghost btn-sm">
            {o.cancelLabel || tr('Abbrechen')}
          </button>
          <button ref={confirmRef} onClick={() => close(true)} autoFocus={!danger} className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}>
            {o.confirmLabel || tr('Bestätigen')}
          </button>
        </div>
      </div>
    </div>
  )
}
