/* Raster der Auto Farm und der Startseite: Maße, Standards und reine Funktionen
   (seit v1.1.67 ohne React und CSS, damit vitest sie direkt testet).
   components/DashboardGrid.jsx exportiert alles weiter.

   Warum die Funktionen: Bis v1.1.66 maß das Raster auf der versteckten Seite die
   Breite 0 und meldete daraufhin ein zusammengeschobenes Layout. Die Seite speicherte
   es ungefragt, auch über die Anordnung, die ein anderes Gerät gerade gespeichert
   hatte. Und ein kaputter gespeicherter Wert (w: null, h: 'abc') kam ungeprüft an. */

// Feineres Raster (doppelte Auflösung) → kleinere, aber rastende Schritte. Layouts
// der Version 1 (12 Spalten / 30 px) werden einmal ×2 skaliert (migrateLayout).
export const COLS = 24
export const ROW_HEIGHT = 15
export const GRID_VERSION = 2

/* Alle Panels der Auto Farm in Standard-Reihenfolge (für die Bearbeiten-Leiste). */
export const PANELS = [
  { id: 'camera',   label: 'Kameras' },
  { id: 'phases',   label: 'Ablauf-Phasen' },
  { id: 'queue',    label: 'Warteschlange' },
  { id: 'step',     label: 'Aktueller Schritt' },
  { id: 'rack',     label: 'Regal' },
  { id: 'activity', label: 'Aktivität' },
]

/* Standard-Layout (24 Spalten) — die frühere 3-Spalten-Ansicht. minW/minH
   verhindern, dass ein Panel unbrauchbar klein gezogen wird. */
export const DEFAULT_LAYOUT = [
  { i: 'camera',   x: 0,  y: 0,  w: 6,  h: 30, minW: 4, minH: 12 },
  { i: 'phases',   x: 0,  y: 30, w: 6,  h: 16, minW: 4, minH: 8  },
  { i: 'queue',    x: 6,  y: 0,  w: 12, h: 46, minW: 6, minH: 12 },
  { i: 'step',     x: 18, y: 0,  w: 6,  h: 6,  minW: 4, minH: 4  },
  { i: 'rack',     x: 18, y: 6,  w: 6,  h: 24, minW: 4, minH: 10 },
  { i: 'activity', x: 18, y: 30, w: 6,  h: 16, minW: 4, minH: 8  },
]

/* ── Startseite: Fassung je Bildschirmbreite ────────────────────────────────── */
export const HOME_BREAKPOINTS = { lg: 1100, md: 700, xs: 0 }
export const HOME_COLS = { lg: 24, md: 12, xs: 1 }
export const HOME_ROW_HEIGHT = 15

export const HOME_PANELS = [
  { id: 'status',   label: 'Aktueller Druck' },
  { id: 'stats',    label: 'Kennzahlen' },
  { id: 'queue',    label: 'Warteschlange' },
  { id: 'rack',     label: 'Regal' },
  { id: 'figures',  label: 'Druckstatistiken' },
  { id: 'costs',    label: 'Energie & Kosten' },
  { id: 'timeline', label: 'Auslastung (24h)' },
]

const HOME_MIN_H = { status: 7, stats: 6, queue: 8, rack: 10, figures: 10, costs: 7, timeline: 8 }
const lay = (arr, minW) => arr.map(l => ({ ...l, minW, minH: HOME_MIN_H[l.i] }))

/* Für jede Breite ausgeschrieben, statt aus einer Fassung herunterrechnen zu lassen:
   die Umrechnung staucht nur die Spalten und ergibt am Handy übereinanderliegende Fetzen. */
export const HOME_LAYOUTS = {
  lg: lay([
    { i: 'status',   x: 0,  y: 0,  w: 9,  h: 10 },
    { i: 'stats',    x: 9,  y: 0,  w: 9,  h: 10 },
    { i: 'queue',    x: 18, y: 0,  w: 6,  h: 22 },
    { i: 'rack',     x: 0,  y: 10, w: 9,  h: 16 },
    { i: 'figures',  x: 9,  y: 10, w: 9,  h: 16 },
    { i: 'costs',    x: 0,  y: 26, w: 9,  h: 9  },
    { i: 'timeline', x: 9,  y: 26, w: 15, h: 10 },
  ], 4),
  md: lay([
    { i: 'status',   x: 0, y: 0,  w: 12, h: 10 },
    { i: 'stats',    x: 0, y: 10, w: 12, h: 8  },
    { i: 'queue',    x: 0, y: 18, w: 6,  h: 14 },
    { i: 'rack',     x: 6, y: 18, w: 6,  h: 14 },
    { i: 'figures',  x: 0, y: 32, w: 6,  h: 16 },
    { i: 'costs',    x: 6, y: 32, w: 6,  h: 12 },
    { i: 'timeline', x: 0, y: 48, w: 12, h: 10 },
  ], 3),
  // Handy: eine Spalte. Breite ist nicht verschiebbar, nur Reihenfolge und Höhe.
  xs: lay([
    { i: 'status',   x: 0, y: 0,  w: 1, h: 11 },
    { i: 'stats',    x: 0, y: 11, w: 1, h: 8  },
    { i: 'queue',    x: 0, y: 19, w: 1, h: 12 },
    { i: 'rack',     x: 0, y: 31, w: 1, h: 16 },
    { i: 'figures',  x: 0, y: 47, w: 1, h: 16 },
    { i: 'costs',    x: 0, y: 63, w: 1, h: 13 },
    { i: 'timeline', x: 0, y: 76, w: 1, h: 10 },
  ], 1),
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)

/* Gespeichertes Layout bereinigen: bekannte Panels übernehmen (kaputte Werte → Standard),
   fehlende aus dem Standard ergänzen, unbekannte weglassen; Breite in [minW, cols],
   Höhe ≥ minH, nicht über den rechten Rand. Kleinstmaße kommen immer aus dem Standard. */
export function sanitizeLayout(items, defaults, cols) {
  const byId = new Map((Array.isArray(items) ? items : [])
    .filter(l => l && typeof l === 'object' && typeof l.i === 'string').map(l => [l.i, l]))
  return defaults.map(def => {
    const s = byId.get(def.i)
    if (!s) return def
    const pick = (k) => (Number.isFinite(num(s[k])) ? Math.round(num(s[k])) : def[k])
    const w = Math.min(Math.max(pick('w'), def.minW ?? 1), cols)
    const h = Math.max(pick('h'), def.minH ?? 1)
    const x = Math.min(Math.max(pick('x'), 0), Math.max(0, cols - w))
    const y = Math.max(pick('y'), 0)
    return { ...def, x, y, w, h }
  })
}

export function mergeLayout(saved) {
  return sanitizeLayout(saved, DEFAULT_LAYOUT, COLS)
}

export function mergeHomeLayouts(saved) {
  const out = {}
  for (const bp of Object.keys(HOME_LAYOUTS)) {
    out[bp] = sanitizeLayout(saved?.[bp], HOME_LAYOUTS[bp], HOME_COLS[bp])
  }
  return out
}

/* Layout der Raster-Version 1 (12 Spalten / 30 px) auf Version 2 heben. */
export function migrateLayout(layout, gridV) {
  if (!Array.isArray(layout) || (gridV ?? 1) >= GRID_VERSION) return layout
  return layout.map(l => ({ ...l, x: num(l.x) * 2, y: num(l.y) * 2, w: num(l.w) * 2, h: num(l.h) * 2 }))
}

/* Gemessene Breite nur übernehmen, wenn sie echt ist: Eine versteckte Seite misst 0. */
export function acceptWidth(prev, measured) {
  return Number.isFinite(measured) && measured > 0 ? measured : prev
}

/* Die gemeldeten (nur SICHTBAREN) Panels in den Gesamtstand mischen: Ein ausgeblendetes
   Panel behält so seine Position. Flach (Auto Farm) … */
export function mergeVisible(prev, visible) {
  const map = new Map((prev || []).map(l => [l.i, l]))
  for (const l of visible || []) map.set(l.i, { ...map.get(l.i), ...l })
  return Array.from(map.values())
}

/* … und je Bildschirmbreite (Startseite). */
export function mergeChange(prevByBp, allByBp) {
  const next = {}
  for (const bp of Object.keys(prevByBp || {})) next[bp] = mergeVisible(prevByBp[bp], allByBp?.[bp])
  return next
}

/* Gespeichert wird nur, was jemand im Bearbeiten-Modus selbst geändert hat. */
export function shouldPersist({ editing, loaded }) {
  return !!editing && !!loaded
}


/* ── Auto Farm je Rasterbreite (seit v1.1.68) ───────────────────────────────────
   Gemessen an der Breite des Rasters (nicht am Fenster): Bei offener Seitenleiste
   ist das Raster eines Laptops (1366 px) rund 1100 px breit. Bis v1.1.67 hatte die
   Auto Farm EINE Anordnung für 24 Spalten; auf dem Laptop drängten sich die Panels,
   am Handy waren sie unbenutzbar. */
export const FARM_BREAKPOINTS = { xl: 1500, lg: 1100, md: 700, xs: 0 }
export const FARM_COLS = { xl: 24, lg: 24, md: 12, xs: 1 }
export const FARM_GRID_VERSION = 3

const fm = (arr) => arr.map(l => {
  const d = DEFAULT_LAYOUT.find(x => x.i === l.i)
  return { ...l, minW: Math.min(d.minW, l.w), minH: d.minH }
})

export const FARM_LAYOUTS = {
  xl: DEFAULT_LAYOUT,
  lg: fm([
    { i: 'camera',   x: 0,  y: 0,  w: 6,  h: 30 },
    { i: 'phases',   x: 0,  y: 30, w: 6,  h: 16 },
    { i: 'queue',    x: 6,  y: 0,  w: 10, h: 46 },
    { i: 'step',     x: 16, y: 0,  w: 8,  h: 6  },
    { i: 'rack',     x: 16, y: 6,  w: 8,  h: 24 },
    { i: 'activity', x: 16, y: 30, w: 8,  h: 16 },
  ]),
  md: fm([
    { i: 'step',     x: 0, y: 0,  w: 12, h: 6  },
    { i: 'camera',   x: 0, y: 6,  w: 6,  h: 30 },
    { i: 'rack',     x: 6, y: 6,  w: 6,  h: 30 },
    { i: 'queue',    x: 0, y: 36, w: 12, h: 40 },
    { i: 'phases',   x: 0, y: 76, w: 6,  h: 16 },
    { i: 'activity', x: 6, y: 76, w: 6,  h: 16 },
  ]),
  // Handy: eine Spalte in der Reihenfolge, die man unterwegs braucht.
  xs: fm([
    { i: 'step',     x: 0, y: 0,   w: 1, h: 6  },
    { i: 'camera',   x: 0, y: 6,   w: 1, h: 24 },
    { i: 'queue',    x: 0, y: 30,  w: 1, h: 40 },
    { i: 'rack',     x: 0, y: 70,  w: 1, h: 26 },
    { i: 'activity', x: 0, y: 96,  w: 1, h: 16 },
    { i: 'phases',   x: 0, y: 112, w: 1, h: 16 },
  ]),
}

export function mergeFarmLayouts(saved) {
  const out = {}
  for (const bp of Object.keys(FARM_LAYOUTS)) {
    out[bp] = sanitizeLayout(saved?.[bp], FARM_LAYOUTS[bp], FARM_COLS[bp])
  }
  return out
}

/* Gespeichertes Farm-Layout → Fassungen je Breite. Bis Raster-Version 2 gab es nur
   EIN Layout (24 Spalten): Es gilt dann für xl und lg weiter; md und xs kommen aus
   dem Standard. Version 1 (12 Spalten) wird vorher ×2 gehoben. */
export function migrateFarmLayout(saved) {
  const d = saved || {}
  if ((d.grid_v ?? 1) >= FARM_GRID_VERSION && d.layouts && Object.keys(d.layouts).length) {
    return mergeFarmLayouts(d.layouts)
  }
  const one = migrateLayout(d.layout, d.grid_v)
  if (Array.isArray(one) && one.length) {
    const flat = sanitizeLayout(one, DEFAULT_LAYOUT, COLS)
    return mergeFarmLayouts({ xl: flat, lg: flat })
  }
  return mergeFarmLayouts({})
}

/* Welche Fassung gilt bei dieser Rasterbreite? */
export function breakpointFor(width, bps) {
  const sorted = Object.entries(bps).sort((a, b) => b[1] - a[1])
  return (sorted.find(([, min]) => width >= min) || sorted[sorted.length - 1])[0]
}
