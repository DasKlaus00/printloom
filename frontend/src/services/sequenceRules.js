/* Welche Sequenz-Schritte dürfen vorgezogen werden (⏱, ~1 min vor Druckende)?
   ─────────────────────────────────────────────────────────────────────────────
   Dieselbe Regel wie im Backend (backend/app/services/sequence_steps.py,
   prep_allowed); ein Backend-Test hält die Listen gleich. Nur was den Drucker nicht
   berührt: warten, homen, parken, vor den Drucker fahren. Bis v1.1.45 bot der Editor
   ⏱ fast überall an: Ein ⏱ an „Auswerfen" fuhr in den laufenden Druck. */
export const PREP_APP_OPS = ['move_to_printer']
export const PREP_MACROS = ['OTTOEJECT_HOME', 'PARK_OTTOEJECT']
export const PREP_MACRO_PREFIXES = ['MOVE_TO_PRINTER']

export function prepAllowed(step) {
  const t = step?.type
  const v = String(step?.value ?? '').trim()
  if (t === 'delay') return true
  if (t === 'app_op') return PREP_APP_OPS.includes(v.toLowerCase())
  if (t === 'macro') {
    const first = (v.split(/\s+/)[0] || '').toUpperCase()
    return PREP_MACROS.includes(first) || PREP_MACRO_PREFIXES.some(p => first.startsWith(p))
  }
  return false
}
