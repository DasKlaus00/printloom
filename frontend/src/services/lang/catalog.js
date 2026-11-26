/* Sprachpakete, die mit Printloom ausgeliefert werden (seit v1.1.91) — eine Quelle für
   Store, Sprachumschalter, Setup und Tests.

   Warum mitgeliefert: Ein Paket, das mit jedem Update kommt, ist nie älter als die App.
   Bis v1.1.90 kamen weitere Sprachen nur aus dem Online-Katalog oder als Datei. Jedes
   Update brachte neue Texte, die dort fehlten, und ein fehlender Text erschien deutsch.
   Jetzt gilt:
   - i18n.test.js prüft, dass jedes ausgelieferte Paket jeden Text der Oberfläche hat
     (sonst ist das Release rot) und dieselben Platzhalter benutzt;
   - fehlt trotzdem einer (eigenes Paket, älterer Stand), zeigt tr() Englisch, nie Deutsch;
   - die gewählte Sprache und die aktivierten Pakete speichert der Server
     (/api/system/ui-language), nicht der Browser.

   Ein neues Paket: Datei ./<code>.js mit `export default { '<deutscher Text>': '…' }`
   (wie zh-cn.js), Eintrag hier mit load(). Geplante Sprachen: ROADMAP.md. */

export const SOURCE = 'de'      // in dieser Sprache ist die Oberfläche geschrieben
export const FALLBACK = 'en'    // fehlt ein Text im Paket, gilt Englisch

// standard: ohne eigene Wahl im Store aktiv. load(): Wörterbuch als eigener Chunk —
// nur die gewählte Sprache wird geladen, das Start-Bundle bleibt klein.
export const PACKS = [
  { code: 'de', name: 'Deutsch', english: 'German', short: 'DE', locale: 'de-DE', standard: true },
  { code: 'en', name: 'English', english: 'English', short: 'EN', locale: 'en-GB', standard: true },
  { code: 'zh-cn', name: '简体中文', english: 'Chinese (Simplified)', short: '中文', locale: 'zh-CN',
    standard: true, load: () => import('./zh-cn.js') },
]

export const STANDARD = PACKS.filter(p => p.standard).map(p => p.code)

// Ältere Schreibweisen (eigene Pakete, Browser-Einstellung) → ausgeliefertes Paket.
const ALIASES = { zh: 'zh-cn', 'zh-hans': 'zh-cn' }

export const normalizeCode = (code) => {
  const c = String(code || '').trim().toLowerCase().replace(/_/g, '-')
  return ALIASES[c] || c
}

export const packOf = (code) => PACKS.find(p => p.code === normalizeCode(code)) || null
