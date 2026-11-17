/* Sequenz-Editor: was beim Öffnen geladen wird und ob etwas von selbst gespeichert
   werden darf (seit v1.1.59).
   ──────────────────────────────────────────────────────────────────────────────────
   Bis v1.1.58 ersetzte der Editor beim Öffnen einen leeren First Start und jede
   Sequenz mit altem Schema still durch den Standard und speicherte ihn. Jetzt:
   - 'fresh'    (es gibt noch keine Datei): Standard laden und speichern.
   - 'outdated' (älteres Schema): die eigenen Schritte zeigen, nichts speichern, fragen.
   - 'ok':      die eigenen Schritte, so wie sie sind — ein leerer First Start bleibt
                leer. Was die Bereinigung ändern würde (⏱ an verbotenen Schritten, alte
                Bedingungen), erscheint als Entwurf (`cleaned`), nicht still gespeichert. */
import { prepAllowed } from './sequenceRules'

export function cleanSteps(steps) {
  let changed = false
  const out = (steps || []).map(s => {
    let t = s
    if (t.prep && !prepAllowed(t)) { changed = true; t = { ...t, prep: false } }
    if (t.condition) {
      changed = true
      const { condition, ...rest } = t   // eslint-disable-line no-unused-vars
      t = rest
    }
    return t
  })
  return { out, changed }
}

export function decideSequenceLoad(resp, defaults) {
  const d = resp || {}
  if (d.exists === false) {
    return { newSteps: defaults.seqNew, nextSteps: defaults.seqNext, mode: 'fresh',
             autoSave: true, cleaned: false, revision: d.revision ?? null }
  }
  const a = cleanSteps(Array.isArray(d.seq_new) ? d.seq_new : [])
  const b = cleanSteps(Array.isArray(d.seq_next) ? d.seq_next : [])
  return { newSteps: a.out, nextSteps: b.out, mode: d.outdated ? 'outdated' : 'ok',
           autoSave: false, cleaned: a.changed || b.changed, revision: d.revision ?? null }
}

/* Eine importierte Datei prüfen, bevor sie als Entwurf in den Editor kommt (N79).
   knownTypes = die Schritt-Arten des Editors (TYPE_META, ein Test hält sie gleich mit
   dem Backend) — keine zweite Liste.
   → { ok, problem: null|'format'|'unknown', unknownTypes, seqNew, seqNext }
   Fehlende oder doppelte IDs werden neu vergeben (sonst verwechselt der Editor Schritte). */
export function validateImportedSequences(data, knownTypes) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.seq_new) || !Array.isArray(data.seq_next)) {
    return { ok: false, problem: 'format', unknownTypes: [], seqNew: [], seqNext: [] }
  }
  const known = new Set(knownTypes)
  const all = [...data.seq_new, ...data.seq_next]
  const unknownTypes = [...new Set(all.filter(s => !s || typeof s !== 'object' || !known.has(s.type))
    .map(s => String(s?.type ?? '?')))]
  if (unknownTypes.length) return { ok: false, problem: 'unknown', unknownTypes, seqNew: [], seqNext: [] }
  const ids = all.map(s => Number(s.id)).filter(Number.isInteger)
  let next = (ids.length ? Math.max(...ids) : 0) + 1
  const seen = new Set()
  const fix = steps => steps.map(s => {
    let id = Number(s.id)
    if (!Number.isInteger(id) || seen.has(id)) id = next++
    seen.add(id)
    return { ...s, id }
  })
  return { ok: true, problem: null, unknownTypes: [], seqNew: fix(data.seq_new), seqNext: fix(data.seq_next) }
}
