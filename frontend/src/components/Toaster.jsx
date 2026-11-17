import React, { useState, useEffect, useCallback, useRef } from 'react'
import { TOAST_EVENT, toastDuration } from '../services/toast'

/* Globaler Toast-Stapel. Hört auf window 'printloom:toast' (services/toast.js →
   pushToast). Seit v1.1.71: liegt über Dialogen (z-toast), Fehler bleiben länger
   stehen und werden sofort angesagt (role=alert), die Zeitgeber werden beim Abbau
   gelöscht, lange Texte brechen um, und auf dem Handy nutzt der Stapel die Breite.
   Der Bereich bleibt auch leer im DOM, sonst sagen Screenreader den ersten Toast
   nicht an (aria-live muss vor dem Inhalt da sein). */
export default function Toaster() {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const remove = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  useEffect(() => {
    const all = timers.current
    const onToast = (e) => {
      const t = e.detail
      if (!t?.message) return
      setToasts(prev => [...prev, t].slice(-4))   // höchstens 4 gleichzeitig
      all.set(t.id, setTimeout(() => remove(t.id), toastDuration(t.kind)))
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast)
      for (const timer of all.values()) clearTimeout(timer)
      all.clear()
    }
  }, [remove])

  const tone = {
    success: 'bg-emerald-950/90 border-emerald-800 text-emerald-200',
    error:   'bg-red-950/90 border-red-800 text-red-200',
    info:    'bg-surface-800/95 border-surface-600 text-surface-200',
  }
  return (
    <div role="status" aria-live="polite"
      className="fixed bottom-3 left-3 right-3 sm:left-auto sm:bottom-5 sm:right-5 sm:max-w-sm z-toast flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : undefined}
          onClick={() => remove(t.id)}
          className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border shadow-xl shadow-black/30 cursor-pointer animate-[fadeIn_.15s_ease-out] ${tone[t.kind] ?? tone.info}`}>
          {t.icon && <span className="text-base leading-none" aria-hidden="true">{t.icon}</span>}
          <span className="flex-1 min-w-0 break-words">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
