import React, { useLayoutEffect, useRef, useState } from 'react'
import GridLayout, { Responsive } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import {
  COLS, ROW_HEIGHT, HOME_BREAKPOINTS, HOME_COLS, HOME_ROW_HEIGHT, acceptWidth,
} from '../services/dashboardLayout'

/* Frei konfigurierbare Raster (Position + Größe per Drag, Panels ein-/ausblendbar).
   Layouts werden serverseitig gespeichert (überall gleich).

   Zwei Ausführungen, weil die beiden Ansichten verschiedene Anforderungen haben:
     DashboardGrid          — Auto-Farm: EIN festes 24-Spalten-Raster (Bedienplatz
                              am Rechner, dort ist die Breite gegeben).
     ResponsiveDashboardGrid — Startseite: Fassung JE Bildschirmbreite. Die Startseite
                              wird auch am Handy aufgerufen; ein Desktop-Raster auf
                              360 px zusammengestaucht ist dort unbenutzbar.

   Maße, Standards und reine Funktionen stehen in services/dashboardLayout.js. */
export {
  COLS, ROW_HEIGHT, GRID_VERSION, PANELS, DEFAULT_LAYOUT, mergeLayout,
  HOME_BREAKPOINTS, HOME_COLS, HOME_ROW_HEIGHT, HOME_PANELS, HOME_LAYOUTS, mergeHomeLayouts,
} from '../services/dashboardLayout'

/* Eigene Breitenmessung statt WidthProvider: Der maß auf einer versteckten Seite
   (App.jsx blendet Seiten per `hidden` aus) die Breite 0 und schob alle Panels links
   übereinander; beim Zurückwechseln glitten sie sichtbar zurück, und das so gemeldete
   Layout wurde gespeichert (bis v1.1.66). Hier zählt nur eine echte Breite (> 0), und
   das Raster zeichnet erst, wenn es eine hat. */
function useMeasuredWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setWidth(w => acceptWidth(w, el.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

export default function DashboardGrid({ layout, editing, onLayoutChange, children }) {
  const [ref, width] = useMeasuredWidth()
  return (
    <div ref={ref}>
      {width > 0 && (
        <GridLayout
          className={`dashboard-grid ${editing ? 'is-editing' : ''}`}
          width={width}
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
        </GridLayout>
      )}
    </div>
  )
}

/* ── Startseite: responsives Raster ────────────────────────────────────────── */
export function ResponsiveDashboardGrid({ layouts, editing, onLayoutChange, children,
  breakpoints = HOME_BREAKPOINTS, cols = HOME_COLS, rowHeight = HOME_ROW_HEIGHT, margin = [12, 12] }) {
  const [ref, width] = useMeasuredWidth()
  return (
    <div ref={ref}>
      {width > 0 && (
        <Responsive
          className={`dashboard-grid ${editing ? 'is-editing' : ''}`}
          width={width}
          layouts={layouts}
          breakpoints={breakpoints}
          cols={cols}
          rowHeight={rowHeight}
          margin={margin}
          containerPadding={[0, 0]}
          isDraggable={editing}
          isResizable={editing}
          isBounded={false}
          compactType="vertical"
          onLayoutChange={onLayoutChange}
          draggableCancel=".no-drag"
        >
          {children}
        </Responsive>
      )}
    </div>
  )
}
