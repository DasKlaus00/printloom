import { describe, it, expect } from 'vitest'
import { mergeServerJobs, pendingOrder } from './queueModel'

// Echte Server-Form (backend/app/services/farm_queue.normalize_job)
const server = (id, over = {}) => ({
  id, fileId: 3, fileName: `t${id}.3mf`, slot: '1-0', status: 'pending', progress: 0,
  remaining: 0, estimatedMinutes: null, amsMap: '', layerHeightMm: 0.2, object_height_mm: 47.2,
  plate: null, plateTotal: null, plateName: '', tag: '', reason: '', ...over,
})

describe('Warteschlange: Server ist die Quelle', () => {
  it('Reihenfolge und Stand kommen vom Server, lokale Analyse bleibt je ID', () => {
    const prev = [{ id: 1, filaments: [{ type: 'PLA' }], objectHeight: 41, status: 'pending' },
                  { id: 2, filaments: [] }]
    const out = mergeServerJobs(prev, [server(2, { status: 'printing', slot: '2-3' }), server(1)])
    expect(out.map(j => j.id)).toEqual([2, 1])
    expect(out[0]).toMatchObject({ status: 'printing', slot: '2-3', computedHeight: 47.2 })
    expect(out[1]).toMatchObject({ filaments: [{ type: 'PLA' }], objectHeight: 41, slot: null })
  })

  it('was der Server nicht mehr kennt, fällt weg; neue kommen dazu', () => {
    const out = mergeServerJobs([{ id: 9, status: 'pending' }], [server(10)])
    expect(out.map(j => j.id)).toEqual([10])
    expect(out[0]).toMatchObject({ heightLoading: false, note: '', objectHeight: 47.2 })
  })

  it('unbekannte Höhe bleibt null, nie 0', () => {
    expect(mergeServerJobs([], [server(1, { object_height_mm: null })])[0].computedHeight).toBeNull()
  })

  it('Reihenfolge der wartenden', () => {
    expect(pendingOrder([server(1, { status: 'printing' }), server(3), server(2)])).toEqual([3, 2])
  })
})
