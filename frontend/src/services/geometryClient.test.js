import { describe, it, expect } from 'vitest'
import { patchGeometry } from './geometryClient'

describe('Geometrie mit Revision', () => {
  it('bei 409 frisch lesen und die Änderung auf den NEUEN Stand anwenden', async () => {
    const staende = [
      { geometry: { storage: { slot_gap: 25 } }, revision: 'alt' },
      { geometry: { storage: { slot_gap: 30 } }, revision: 'neu' },   // inzwischen anderswo geändert
    ]
    const gespeichert = []
    const api = {
      loadGeometry: async () => staende.shift(),
      saveGeometry: async (g, rev) => {
        gespeichert.push({ g, rev })
        if (rev === 'alt') { const e = new Error('409'); e.response = { status: 409 }; throw e }
        return { data: { revision: 'danach' } }
      },
    }
    await patchGeometry(g => ({ ...g, machine_limits: { x: 1000 } }), 'test', api)
    expect(gespeichert).toHaveLength(2)
    expect(gespeichert[1].rev).toBe('neu')
    expect(gespeichert[1].g.storage.slot_gap).toBe(30)           // fremde Änderung bleibt
    expect(gespeichert[1].g.machine_limits).toEqual({ x: 1000 })
  })

  it('andere Fehler gehen sofort weiter', async () => {
    const api = {
      loadGeometry: async () => ({ geometry: {}, revision: 'r' }),
      saveGeometry: async () => { const e = new Error('500'); e.response = { status: 500 }; throw e },
    }
    await expect(patchGeometry(g => g, '', api)).rejects.toThrow('500')
  })
})
