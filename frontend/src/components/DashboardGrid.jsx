import React from 'react'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

/* Auto-Farm-Dashboard: frei konfigurierbares Raster (Position + Größe per Drag,
   Panels ein-/ausblendbar). Layout wird serverseitig gespeichert (überall gleich). */

const Grid = WidthProvider(GridLayout)

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
