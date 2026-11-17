/* Zahlen und Dauern einheitlich anzeigen (seit v1.1.72). Bis v1.1.71 hatten Datei-
   Bibliothek, Dashboard, Historie, Steuerung und die ETA je einen eigenen Formatierer,
   mit drei Schreibweisen („1 h 5 min", „1h 5m", „1h 5min") und demselben Fehler:
   Sie teilten erst und rundeten dann — aus 3599 s wurde „60 min". */
import { locale } from './i18n'

/** Sekunden → '2 h 5 min' bzw. '12 min'. Keine oder keine positive Dauer → null;
 *  die Stelle entscheidet selbst, ob sie dann '—' zeigt oder nichts. */
export function fmtDur(sec) {
  if (!sec || !(sec > 0)) return null
  // Erst auf ganze Minuten runden, dann teilen. Mindestens 1 min: Eine laufende
  // Dauer von 20 s ist nicht „0 min".
  const total = Math.max(1, Math.round(sec / 60))
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h} h ${m} min` : `${m} min`
}

/** Euro-Betrag in der Sprache der Oberfläche: de '12,34 €', en '€12.34'. */
export function fmtEur(value, loc = locale()) {
  return Number(value || 0).toLocaleString(loc, { style: 'currency', currency: 'EUR' })
}

/** kWh mit höchstens einer Nachkommastelle, im Zahlenformat der Sprache. */
export function fmtKwh(value, loc = locale()) {
  return Number(value || 0).toLocaleString(loc, { maximumFractionDigits: 1 })
}
