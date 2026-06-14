import React from 'react'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

/* Auto-Farm-Dashboard: frei konfigurierbares Raster (Position + Größe per Drag,
   Panels ein-/ausblendbar). Layout wird serverseitig gespeichert (überall gleich). */

const Grid = WidthProvider(GridLayout)

export const COLS = 12
export const ROW_HEIGHT = 30

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
  { i: 'camera',   x: 0, y: 0,  w: 3, h: 15, minW: 2, minH: 6 },
  { i: 'phases',   x: 0, y: 15, w: 3, h: 8,  minW: 2, minH: 4 },
  { i: 'queue',    x: 3, y: 0,  w: 6, h: 23, minW: 3, minH: 6 },
  { i: 'step',     x: 9, y: 0,  w: 3, h: 3,  minW: 2, minH: 2 },
  { i: 'rack',     x: 9, y: 3,  w: 3, h: 12, minW: 2, minH: 5 },
  { i: 'activity', x: 9, y: 15, w: 3, h: 8,  minW: 2, minH: 4 },
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
