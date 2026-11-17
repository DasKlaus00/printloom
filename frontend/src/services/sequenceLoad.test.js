import { describe, it, expect } from 'vitest'
import { decideSequenceLoad, validateImportedSequences } from './sequenceLoad'
import { DEFAULT_SEQ_NEW, DEFAULT_SEQ_NEXT } from './sequenceData'

const defaults = { seqNew: DEFAULT_SEQ_NEW, seqNext: DEFAULT_SEQ_NEXT }
const known = [...new Set([...DEFAULT_SEQ_NEW, ...DEFAULT_SEQ_NEXT].map(s => s.type))]
// Antwortform von GET /autofarm/sequences (seit v1.1.59)
const antwort = (over) => ({ seq_new: [], seq_next: DEFAULT_SEQ_NEXT, schema_version: 9,
                             exists: true, outdated: false, revision: 'abc', ...over })

describe('Sequenzen laden', () => {
  it('ohne Datei: Standard, und nur dann von selbst speichern', () => {
    const r = decideSequenceLoad(antwort({ exists: false, seq_next: [] }), defaults)
    expect(r).toMatchObject({ mode: 'fresh', autoSave: true })
    expect(r.nextSteps).toBe(DEFAULT_SEQ_NEXT)
  })

  it('ein leerer First Start bleibt leer', () => {
    const r = decideSequenceLoad(antwort(), defaults)
    expect(r).toMatchObject({ mode: 'ok', autoSave: false, cleaned: false, revision: 'abc' })
    expect(r.newSteps).toEqual([])
  })

  it('altes Schema: eigene Schritte, nichts speichern', () => {
    const eigen = [{ id: 7, type: 'send_file', label: 'X' }]
    const r = decideSequenceLoad(antwort({ outdated: true, schema_version: 1, seq_next: eigen }), defaults)
    expect(r).toMatchObject({ mode: 'outdated', autoSave: false })
    expect(r.nextSteps).toEqual(eigen)
  })

  it('Bereinigung ist ein Entwurf, kein stilles Speichern', () => {
    const r = decideSequenceLoad(antwort({ seq_next: [{ id: 1, type: 'send_file', prep: true }] }), defaults)
    expect(r).toMatchObject({ cleaned: true, autoSave: false })
    expect(r.nextSteps[0].prep).toBe(false)
  })
})

describe('Import prüfen', () => {
  it('falsche Form', () => {
    expect(validateImportedSequences({ sequences: [] }, known).problem).toBe('format')
  })
  it('unbekannte Art', () => {
    const r = validateImportedSequences({ seq_new: [], seq_next: [{ id: 1, type: 'teleport' }] }, known)
    expect(r).toMatchObject({ ok: false, problem: 'unknown', unknownTypes: ['teleport'] })
  })
  it('fehlende und doppelte IDs werden vergeben', () => {
    const r = validateImportedSequences({ seq_new: [{ type: 'delay' }],
      seq_next: [{ id: 3, type: 'send_file' }, { id: 3, type: 'wait_print' }] }, [...known, 'delay'])
    expect(r.ok).toBe(true)
    expect([...r.seqNew, ...r.seqNext].map(s => s.id)).toEqual([4, 3, 5])
  })
})
