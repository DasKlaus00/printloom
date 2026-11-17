import { describe, it, expect } from 'vitest'
import {
  mergeLayout, mergeHomeLayouts, migrateLayout, acceptWidth, mergeChange, mergeVisible,
  shouldPersist, DEFAULT_LAYOUT, HOME_LAYOUTS, GRID_VERSION,
} from './dashboardLayout'

describe('Raster-Layouts', () => {
  it('Version 1 (ohne grid_v) wird ×2 gehoben', () => {
    // So stand es bis v1.0.x in dashboard_layout.json
    const v1 = { layout: [{ i: 'queue', x: 3, y: 0, w: 6, h: 23, moved: false, static: false }], hidden: [] }
    const q = mergeLayout(migrateLayout(v1.layout, v1.grid_v)).find(l => l.i === 'queue')
    expect(q).toMatchObject({ x: 6, w: 12, h: 46 })
  })

  it('Version 2 bleibt, fehlende Panels kommen aus dem Standard', () => {
    // Form, wie system.py sie schreibt
    const v2 = { layout: [{ i: 'queue', x: 6, y: 0, w: 12, h: 40 }], layouts: {}, hidden: [], grid_v: GRID_VERSION }
    const out = mergeLayout(migrateLayout(v2.layout, v2.grid_v))
    expect(out.map(l => l.i)).toEqual(DEFAULT_LAYOUT.map(l => l.i))
    expect(out.find(l => l.i === 'queue').h).toBe(40)
  })

  it('kaputte Werte werden zum Standard bzw. geklemmt, Unbekanntes fällt weg', () => {
    const out = mergeLayout([
      { i: 'camera', x: 0, y: 0, w: null, h: 'abc' },
      { i: 'rack', x: 20, y: 0, w: 10, h: 2 },        // ragt über 24 Spalten, zu niedrig
      { i: 'gibtsnicht', x: 0, y: 0, w: 4, h: 4 },
    ])
    const cam = out.find(l => l.i === 'camera')
    expect(cam).toMatchObject({ w: 6, h: 30 })
    const rack = out.find(l => l.i === 'rack')
    expect(rack.x + rack.w).toBeLessThanOrEqual(24)
    expect(rack.h).toBe(10)                              // minH
    expect(out.some(l => l.i === 'gibtsnicht')).toBe(false)
  })

  it('Startseite je Breite', () => {
    const out = mergeHomeLayouts({ lg: [{ i: 'queue', x: 18, y: 0, w: 99, h: 22 }] })
    const q = out.lg.find(l => l.i === 'queue')
    expect(q.w).toBeLessThanOrEqual(24)
    expect(q.x + q.w).toBeLessThanOrEqual(24)          // nie über den rechten Rand
    expect(out.xs).toEqual(HOME_LAYOUTS.xs)
  })

  it('Breite 0 (versteckte Seite) wird nicht übernommen', () => {
    expect(acceptWidth(1280, 0)).toBe(1280)
    expect(acceptWidth(1280, Number.NaN)).toBe(1280)
    expect(acceptWidth(1280, 900)).toBe(900)
  })

  it('ausgeblendete Panels behalten ihre Position', () => {
    const prev = [{ i: 'a', x: 0 }, { i: 'b', x: 5 }]
    expect(mergeVisible(prev, [{ i: 'a', x: 2 }])).toEqual([{ i: 'a', x: 2 }, { i: 'b', x: 5 }])
    expect(mergeChange({ lg: prev }, { lg: [{ i: 'b', x: 9 }] }).lg[1].x).toBe(9)
  })

  it('gespeichert wird nur im Bearbeiten-Modus nach dem Laden', () => {
    expect(shouldPersist({ editing: false, loaded: true })).toBe(false)
    expect(shouldPersist({ editing: true, loaded: false })).toBe(false)
    expect(shouldPersist({ editing: true, loaded: true })).toBe(true)
  })
})
