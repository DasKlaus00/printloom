// Globaler Toast. pushToast(msg) feuert ein window-Event, das der <Toaster>
// (in App.jsx gemountet) anzeigt — so funktioniert die Meldung von überall.
export const TOAST_EVENT = 'printloom:toast'

// Fehler bleiben länger stehen: Sie sagen meist, was zu tun ist (seit v1.1.71).
const DURATION_MS = { error: 12000, success: 5000, info: 5000 }
export const toastDuration = (kind) => DURATION_MS[kind] ?? DURATION_MS.info

// icon nur, wenn mitgegeben: Bis v1.1.70 trug JEDER Toast das Faden-Symbol, auch
// „Notaus ausgelöst" oder „Zurückgesetzt".
export function pushToast(message, kind = 'info', { icon } = {}) {
  if (!message) return
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, {
    detail: { message, kind, icon: icon || null, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
  }))
}
