import { describe, it, expect } from 'vitest'
import { reconcilePrinters, adoptBlock } from './printerBlocks'

const seed = (base, d) => ({ id: `printer-${d.id}`, device_id: d.id, name: d.name,
                              eject: { x: (base?.eject?.x ?? 425) - 400, y: 340, z: 17.5 } })

describe('Drucker-Blöcke abgleichen', () => {
  it('verwaister Block wird Übernahme-Kandidat, kein erfundener Block', () => {
    const ps = [{ id: 'p1', device_id: 3, name: 'X1C alt', eject: { x: 542, y: 340, z: 17 } }]
    const { printers, adopt } = reconcilePrinters(ps, [{ id: 5, name: 'X1C neu' }], seed)
    expect(adopt).toEqual([{ deviceId: 5, deviceName: 'X1C neu', block: ps[0], blockId: 'p1', blockName: 'X1C alt' }])
    expect(printers.some(p => p.eject.x === 142)).toBe(false)     // kein Block mit x-400
    expect(adoptBlock(printers, adopt[0])[0]).toMatchObject({ device_id: 5, name: 'X1C neu', eject: { x: 542 } })
  })

  it('nach „Nein" bekommt das Gerät einen neuen Block, der verwaiste bleibt hinten', () => {
    const ps = [{ id: 'p1', device_id: 3, name: 'X1C alt', eject: { x: 542 } }]
    const { printers, adopt } = reconcilePrinters(ps, [{ id: 5, name: 'X1C neu' }], seed, { declined: new Set([5]) })
    expect(adopt).toEqual([])
    expect(printers[0].device_id).toBe(5)
    expect(printers[1].device_id).toBe(3)
  })

  it('zwei Drucker: „Ja" übernimmt den verwaisten Block, nicht den des anderen', () => {
    // P1 (id 1) gelöscht und neu angelegt (id 3); P2 (id 2) bleibt.
    const ps = [{ id: 'p1', device_id: 1, name: 'P1', eject: { x: 'P1-pos' } },
                { id: 'p2', device_id: 2, name: 'P2', eject: { x: 'P2-pos' } }]
    const devs = [{ id: 2, name: 'P2' }, { id: 3, name: 'P1 neu' }]
    const { printers, adopt } = reconcilePrinters(ps, devs, seed)
    expect(adopt.map(a => a.deviceId)).toEqual([3])
    const neu = adoptBlock(printers, adopt[0])          // nach dem Umsortieren angewendet
    expect(neu.find(p => p.device_id === 3).eject.x).toBe('P1-pos')
    expect(neu.find(p => p.device_id === 2).eject.x).toBe('P2-pos')
  })

  it('unverändert: dieselbe Referenz', () => {
    const ps = [{ id: 'p1', device_id: 5, name: 'X1C', model: 'x1c' }]
    expect(reconcilePrinters(ps, [{ id: 5, name: 'X1C', model: 'x1c' }], seed).printers).toBe(ps)
  })
})

describe('Bestätigung der Positionen (Snapmaker U1)', () => {
  it('jede Bewegungsänderung nimmt sie zurück, reine Anzeige nicht', async () => {
    const { withConfirmReset } = await import('./printerBlocks')
    expect(withConfirmReset({ eject: { x: 1, y: 2, z: 3 } })).toEqual({ eject: { x: 1, y: 2, z: 3 }, confirmed_for: null })
    expect(withConfirmReset({ door: null }).confirmed_for).toBe(null)
    expect(withConfirmReset({ use_gcode: { eject: true } }).confirmed_for).toBe(null)
    expect(withConfirmReset({ __preset: 'x1c' }).confirmed_for).toBe(null)
    expect(withConfirmReset({ speed_factors: { eject: 50 } })).toEqual({ speed_factors: { eject: 50 } })
    expect(withConfirmReset({ name: 'U1' })).toEqual({ name: 'U1' })
    // Die Bestätigung selbst bleibt, wie sie ist.
    expect(withConfirmReset({ confirmed_for: 31 })).toEqual({ confirmed_for: 31 })
  })
})
