import React, { useState, useEffect, useCallback } from 'react'

/* Globaler Bottom-Toast-Stapel. Hört auf window 'printloom:toast' (siehe
   services/toast.js → pushToast) und zeigt kurze Hinweise unten rechts. */
export default function Toaster() {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((id) => setToasts(t => t.filter(x => x.id !== id)), [])

  useEffect(() => {
    const onToast = (e) => {
      const t = e.detail
      if (!t?.message) return
      setToasts(prev => [...prev, t].slice(-4))   // höchstens 4 gleichzeitig
      setTimeout(() => remove(t.id), 5000)
    }
    window.addEventListener('printloom:toast', onToast)
    return () => window.removeEventListener('printloom:toast', onToast)
  }, [remove])

  if (!toasts.length) return null
  const tone = {
    success: 'bg-emerald-950/90 border-emerald-800 text-emerald-200',
    error:   'bg-red-950/90 border-red-800 text-red-200',
    info:    'bg-surface-800/95 border-surface-600 text-surface-200',
  }
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div key={t.id}
          onClick={() => remove(t.id)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border shadow-xl shadow-black/30 cursor-pointer animate-[fadeIn_.15s_ease-out] ${tone[t.kind] ?? tone.info}`}>
          <span className="text-base leading-none">🧵</span>
          <span className="flex-1">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
