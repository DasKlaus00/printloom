/* Q6 — Promise-basierter Bestätigungsdialog statt window.confirm().
   Aufruf von überall:  if (!(await confirmDialog({ title, message, danger }))) return
   Solange kein ConfirmHost gemountet ist, fällt es auf window.confirm() zurück. */

let _handler = null

export function registerConfirm(fn) { _handler = fn }

export function confirmDialog(opts) {
  const o = typeof opts === 'string' ? { message: opts } : (opts || {})
  if (!_handler) return Promise.resolve(window.confirm(o.message || ''))
  return _handler(o)
}
