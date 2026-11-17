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

/* Was eine Taste im Bestätigungsdialog auslöst: 'confirm' | 'cancel' | null.
   Bis v1.1.42 bestätigte JEDES Enter, auch ein gehaltenes: Wer Enter auf dem
   Notaus-Knopf hielt, bestätigte die nächste Rückfrage gleich mit, und Enter mit dem
   Fokus auf „Abbrechen" bestätigte ebenfalls. Jetzt zählt nur ein frisches Enter auf
   dem Knopf, der den Fokus hat. `focus`: 'confirm' | 'cancel' | 'other'. */
export function confirmKeyAction({ key, repeat = false, focus = 'other' }) {
  if (key === 'Escape') return 'cancel'
  if (key !== 'Enter' || repeat) return null
  if (focus === 'confirm') return 'confirm'
  if (focus === 'cancel') return 'cancel'
  return null
}
