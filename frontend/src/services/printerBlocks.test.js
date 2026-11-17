import { describe, it, expect } from 'vitest'
import { reconcilePrinters, adoptBlock } from './printerBlocks'

const seed = (base, d) => ({ id: `printer-${d.id}`, device_id: d.id, name: d.name,
                              eject: { x: (base?.eject?.x ?? 425) - 400, y: 340, z: 17.5 } })

describe('Drucker-Blöcke abgleichen', () => {
  it('verwaister Block wird Übernahme-Kandidat, kein erfundener Block', () => {
    const ps = [{ id: 'p1', device_id: 3, name: 'X1C alt', eject: { x: 542, y: 340, z: 17 } }]
    const { printers, adopt } = reconcilePrinters(ps, [{ id: 5, name: 'X1C neu' }], seed)
    expect(adopt).toEqual([{ deviceId: 5, deviceName: 'X1C neu', blockIdx: 0, blockName: 'X1C alt' }])
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

  it('unverändert: dieselbe Referenz', () => {
    const ps = [{ id: 'p1', device_id: 5, name: 'X1C', model: 'x1c' }]
    expect(reconcilePrinters(ps, [{ id: 5, name: 'X1C', model: 'x1c' }], seed).printers).toBe(ps)
  })
})
