/* Warteschlange in der Oberfläche (seit v1.1.58).
   ──────────────────────────────────────────────────────────────────────────────────
   Die Liste gehört dem Server (GET /autofarm/queue, Status, WebSocket). Die Seite
   hält nur ihre eigene Analyse je Job-ID dazu: rohe Höhe, Schichten, Filamente,
   „lädt". Bis v1.1.57 führte jede Seite eine eigene Kopie, zählte IDs selbst und
   schrieb die ganze Liste zurück; was andere inzwischen eingereiht hatten, war weg.

   mergeServerJobs(prev, serverJobs) → Liste in der Reihenfolge und mit dem Stand des
   Servers; lokale Felder aus `prev` bleiben je ID erhalten. Jobs, die der Server
   nicht mehr kennt, fallen weg. */
export function mergeServerJobs(prev, serverJobs) {
  const local = new Map((prev || []).map(j => [j.id, j]))
  return (serverJobs || []).map(sj => {
    const mine = local.get(sj.id) || {}
    const height = sj.object_height_mm ?? mine.computedHeight ?? null
    return {
      ...mine,
      ...sj,
      // Die Fachhöhe (mit Zuschlag) rechnet der Server; die rohe Höhe nur die Seite.
      computedHeight: height,
      objectHeight:   mine.objectHeight ?? height,
      // '1-0' heißt „Fach wird beim Druckstart gewählt" → in der Anzeige „Auto".
      slot:           (sj.slot && sj.slot !== '1-0') ? sj.slot : null,
      heightLoading:  mine.heightLoading ?? false,
      note:           mine.note ?? '',
    }
  })
}

/* IDs der wartenden Jobs in Anzeige-Reihenfolge (für PUT /queue/order). */
export function pendingOrder(jobs) {
  return (jobs || []).filter(j => j.status === 'pending').map(j => j.id)
}
