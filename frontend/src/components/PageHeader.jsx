/* Seitenkopf aller Seiten (seit v1.1.69): EINE Stelle für Größe und Stil der
   Überschrift. Bis v1.1.68 stand die Klasse in 14 Seiten einzeln, und drei Seiten
   (Datei-Bibliothek, Steuerung, Konfiguration) hatten gar keine Überschrift.
   Titel immer als fertiges tr('…') übergeben — sonst sieht der i18n-Test sie nicht. */
import React from 'react'

export function PageTitle({ children, className = '' }) {
  return <h1 className={`text-[1.45rem] font-semibold text-surface-100 leading-tight ${className}`}>{children}</h1>
}

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <PageTitle className="mb-1">{title}</PageTitle>
        {subtitle && <p className="text-sm text-surface-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}
