/* Relative Zeitangabe („vor 5 Min.") aus einem Unix-Zeitstempel in SEKUNDEN.
   Die Online-Dienste liefern `fetched_at` als Sekunden (Python time.time()) —
   deshalb hier bewusst Sekunden, nicht Millisekunden.
   `tr` wird übergeben, damit die Übersetzung an der Aufrufstelle greift. */
export function timeAgo(ts, tr) {
  if (!ts) return tr('noch nie')
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (secs < 90) return tr('gerade eben')
  const mins = Math.floor(secs / 60)
  if (mins < 60) return tr('vor {0} Min.', mins)
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return tr('vor {0} Std.', hrs)
  return tr('vor {0} Tagen', Math.floor(hrs / 24))
}
