/* Farm-Log in der Sprache der Oberfläche (seit v1.1.90): Deutsch → `log`, jede andere
   Sprache → `log_en` (der Server schreibt jede Zeile in beiden Fassungen). Fehlt die
   englische Liste (älterer Server), bleibt es bei `log`. */
export function farmLogFor(status, lang) {
  const de = status?.log ?? []
  if (lang === 'de') return de
  const en = status?.log_en
  return Array.isArray(en) && en.length ? en : de
}
