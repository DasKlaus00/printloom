/* Fehler einer API-Anfrage als ein verständlicher Satz (seit v1.1.65).
   ──────────────────────────────────────────────────────────────────────────────────
   FastAPI liefert `detail` als Text, als Liste (Pydantic-Prüfung, 422) oder als Objekt
   ({error, message, problems}). Bis v1.1.64 stand an ~70 Stellen
   `e.response?.data?.detail ?? e.message`: Ein Objekt landete als React-Kind auf der
   Seite (Absturz „Minified React error #31") oder als rohes JSON, ein Netzfehler als
   englisches „Network Error".

   apiError(e, fallback) → Text für die Anzeige (durch tr()).
   apiDetail(e)          → das rohe `detail`, nur für Entscheidungen (z. B. === 'CODE').
   Ein Quelltext-Test hält `response?.data?.detail` aus allen anderen Dateien heraus. */
import { tr, trProblem } from './i18n'

export function apiDetail(e) {
  return e?.response?.data?.detail
}

function _pydanticItem(x) {
  if (!x || typeof x !== 'object') return String(x ?? '')
  const where = Array.isArray(x.loc) ? x.loc.filter(p => p !== 'body').join('.') : ''
  return where ? `${where}: ${tr(x.msg || '')}` : tr(x.msg || '')
}

export function apiError(e, fallback) {
  if (!e) return fallback ?? tr('Unbekannter Fehler')
  const res = e.response
  if (!res) {
    if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '')) {
      return tr('Zeitüberschreitung — der Server hat nicht rechtzeitig geantwortet')
    }
    if (e.code === 'ERR_NETWORK' || e.message === 'Network Error') return tr('Server nicht erreichbar')
    return e.message ? tr(e.message) : (fallback ?? tr('Unbekannter Fehler'))
  }
  const d = res.data?.detail
  if (typeof d === 'string' && d) {
    if (d === 'FREMDE_HERKUNFT') return tr('Anfrage abgelehnt: Sie kam nicht von der Printloom-Oberfläche')
    if (d === 'DATEI_UNLESBAR') return tr('Eine Datendatei ist unlesbar — System → Datenspeicher')
    return tr(d)
  }
  if (Array.isArray(d) && d.length) return d.map(_pydanticItem).join(' · ')
  if (d && typeof d === 'object') {
    if (Array.isArray(d.problems) && d.problems.length) return d.problems.map(trProblem).join(' · ')
    if (d.message) return tr(d.message)
    if (d.error) return tr(d.error)
  }
  if ([502, 503, 504].includes(res.status)) return tr('Server antwortet nicht (HTTP {0})', res.status)
  return fallback ?? tr('Fehler {0}', res.status)
}
