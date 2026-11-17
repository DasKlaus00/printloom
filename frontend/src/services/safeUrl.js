/* Links aus fremden Daten (importierte Profile, Bibliothek) nur, wenn sie http(s)
   sind. Bis v1.1.62 wurde ein „javascript:"-Link aus einem importierten Profil beim
   Klick als Code ausgeführt. → die URL oder null (dann keinen Link zeigen). */
export function safeHref(url) {
  const u = String(url ?? '').trim()
  return /^https?:\/\//i.test(u) ? u : null
}
