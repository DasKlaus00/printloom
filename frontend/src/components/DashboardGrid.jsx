import React from 'react'
import GridLayout, { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

/* Frei konfigurierbare Raster (Position + Größe per Drag, Panels ein-/ausblendbar).
   Layouts werden serverseitig gespeichert (überall gleich).

   Zwei Ausführungen, weil die beiden Ansichten verschiedene Anforderungen haben:
     DashboardGrid          — Auto-Farm: EIN festes 24-Spalten-Raster (Bedienplatz
                              am Rechner, dort ist die Breite gegeben).
     ResponsiveDashboardGrid — Startseite: Fassung JE Bildschirmbreite. Die Startseite
                              wird auch am Handy aufgerufen; ein Desktop-Raster auf
                              360 px zusammengestaucht ist dort unbenutzbar. */

const Grid = WidthProvider(GridLayout)
const RGrid = WidthProvider(Responsive)

// Feineres Raster (doppelte Auflösung) → kleinere, aber weiterhin rastende
// Schritte beim Ziehen/Größe-Ändern. Beim Versionswechsel werden alte Layouts
// (GRID_VERSION 1: 12 Spalten / 30 px) einmalig ×2 skaliert (siehe AutoFarm).
export const COLS = 24
export const ROW_HEIGHT = 15
export const GRID_VERSION = 2

/* Alle Panels in Standard-Reihenfolge (für die Bearbeiten-Leiste). */
export const PANELS = [
  { id: 'camera',   label: 'Kameras' },
  { id: 'phases',   label: 'Ablauf-Phasen' },
  { id: 'queue',    label: 'Warteschlange' },
  { id: 'step',     label: 'Aktueller Schritt' },
  { id: 'rack',     label: 'Regal' },
  { id: 'activity', label: 'Aktivität' },
]

/* Standard-Layout (12 Spalten) — bildet die bisherige 3-Spalten-Ansicht nach.
   minW/minH verhindern, dass ein Panel unbrauchbar klein gezogen wird. */
export const DEFAULT_LAYOUT = [
  { i: 'camera',   x: 0,  y: 0,  w: 6,  h: 30, minW: 4, minH: 12 },
  { i: 'phases',   x: 0,  y: 30, w: 6,  h: 16, minW: 4, minH: 8  },
  { i: 'queue',    x: 6,  y: 0,  w: 12, h: 46, minW: 6, minH: 12 },
  { i: 'step',     x: 18, y: 0,  w: 6,  h: 6,  minW: 4, minH: 4  },
  { i: 'rack',     x: 18, y: 6,  w: 6,  h: 24, minW: 4, minH: 10 },
  { i: 'activity', x: 18, y: 30, w: 6,  h: 16, minW: 4, minH: 8  },
]

/* Ein vollständiges Layout aus (evtl. unvollständigen) gespeicherten Daten bauen:
   bekannte Einträge übernehmen, fehlende Panels aus dem Standard ergänzen. */
export function mergeLayout(saved) {
  const byId = new Map((saved || []).map(l => [l.i, l]))
  return DEFAULT_LAYOUT.map(def => {
    const s = byId.get(def.i)
    return s ? { ...def, ...s, i: def.i, minW: def.minW, minH: def.minH } : def
  })
}

export default function DashboardGrid({ layout, editing, onLayoutChange, children }) {
  return (
    <Grid
      className={`dashboard-grid ${editing ? 'is-editing' : ''}`}
      layout={layout}
      cols={COLS}
      rowHeight={ROW_HEIGHT}
      margin={[14, 14]}
      containerPadding={[0, 0]}
      isDraggable={editing}
      isResizable={editing}
      isBounded={false}
      compactType="vertical"
      onLayoutChange={onLayoutChange}
      draggableCancel=".no-drag"
    >
      {children}
    </Grid>
  )
}


/* ── Startseite: responsives Raster ────────────────────────────────────────── */
/* Drei Breiten statt einer. Die Spaltenzahl fällt mit der Breite, damit ein Panel
   nicht auf Briefmarkengröße schrumpft; am Handy ist alles einspaltig, dort zählt
   also nur noch die Reihenfolge. */
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

/* Kleinstmaße je Panel — verhindern, dass eines unlesbar klein gezogen wird. */
const HOME_MIN_H = {
  status: 7, stats: 6, queue: 8, rack: 10, figures: 10, costs: 7, timeline: 8,
}

/* Standard-Layouts, bewusst FÜR JEDE BREITE ausgeschrieben statt von
   react-grid-layout aus einer Fassung herunterrechnen zu lassen: dessen Umrechnung
   staucht nur die Spalten und ergibt am Handy übereinanderliegende Fetzen. So ist
   jede Breite eine bewusste Anordnung. */
const lay = (arr, minW) => arr.map(l => ({ ...l, minW, minH: HOME_MIN_H[l.i] }))

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

/* Gespeicherte Layouts mit den Standards auffüllen: bekannte Einträge übernehmen,
   fehlende Panels ergänzen. Ohne das würde ein nach einem Update neu hinzugekommenes
   Panel bei jedem fehlen, der schon einmal etwas verschoben hat. Die Kleinstmaße
   kommen immer aus dem Standard — ein alter gespeicherter Wert darf ein Panel nicht
   dauerhaft unter die lesbare Größe festnageln. */
export function mergeHomeLayouts(saved) {
  const out = {}
  for (const bp of Object.keys(HOME_LAYOUTS)) {
    const byId = new Map((saved?.[bp] || []).map(l => [l.i, l]))
    out[bp] = HOME_LAYOUTS[bp].map(def => {
      const s = byId.get(def.i)
      if (!s) return def
      const w = Math.min(Math.max(s.w ?? def.w, def.minW), HOME_COLS[bp])
      return { ...def, ...s, i: def.i, w, minW: def.minW, minH: def.minH }
    })
  }
  return out
}

export function ResponsiveDashboardGrid({ layouts, editing, onLayoutChange, children }) {
  return (
    <RGrid
      className={`dashboard-grid ${editing ? 'is-editing' : ''}`}
      layouts={layouts}
      breakpoints={HOME_BREAKPOINTS}
      cols={HOME_COLS}
      rowHeight={HOME_ROW_HEIGHT}
      margin={[12, 12]}
      containerPadding={[0, 0]}
      isDraggable={editing}
      isResizable={editing}
      isBounded={false}
      compactType="vertical"
      onLayoutChange={onLayoutChange}
      draggableCancel=".no-drag"
    >
      {children}
    </RGrid>
  )
}
