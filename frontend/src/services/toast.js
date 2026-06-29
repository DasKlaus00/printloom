// Globaler Bottom-Toast. pushToast(msg) feuert ein window-Event, das der <Toaster>
// (in App.jsx gemountet) anzeigt — so funktioniert die Notification von überall.
export function pushToast(message, kind = 'info') {
  if (!message) return
  window.dispatchEvent(new CustomEvent('printloom:toast', {
    detail: { message, kind, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
  }))
}
