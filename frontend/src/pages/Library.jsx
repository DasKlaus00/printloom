import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { onlineService, systemService, profileService, autofarmService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { timeAgo } from '../services/timeAgo'

/* ── Bibliothek ──────────────────────────────────────────────────────────────
   Eigener Tab für den Online-Katalog (Sprachpakete, Drucker-Profile, Sequenzen)
   mit allen Metadaten: Autor, Version, Beschreibung, Art, Quelle.

   Opt-in: Ohne Freigabe unter „System → Online-Dienste" wird hier NICHTS abgerufen —
   die Seite zeigt dann nur einen Hinweis. Inhalte werden immer erst als Vorschau
   gezeigt und nur auf ausdrücklichen Klick übernommen (Sequenzen bewegen Hardware). */

const KINDS = [
  { id: 'all',      label: 'Alle',      icon: '📚' },
  { id: 'language', label: 'Sprachen',  icon: '🌐' },
  { id: 'profile',  label: 'Profile',   icon: '🖨' },
  { id: 'sequence', label: 'Sequenzen', icon: '🔁' },
]
const KIND_META = {
  language: { icon: '🌐', label: 'Sprachpaket', cls: 'bg-sky-950/50 text-sky-300 border-sky-800/60' },
  profile:  { icon: '🖨', label: 'Profil',      cls: 'bg-violet-950/50 text-violet-300 border-violet-800/60' },
  sequence: { icon: '🔁', label: 'Sequenz',     cls: 'bg-amber-950/40 text-amber-300 border-amber-800/60' },
}

/* Kurz-Statistik zum Inhalt — damit man in der Vorschau sofort sieht, was drin ist. */
function contentSummary(kind, content, tr) {
  if (!content) return null
  if (kind === 'language') {
    const n = Object.keys(content.strings || content.translations || {}).length
    return tr('Sprachcode „{0}" · {1} Übersetzungen', content.code || '?', n)
  }
  if (kind === 'sequence') return tr('{0} Schritte', (content.steps || []).length)
  if (kind === 'profile') {
    const parts = []
    if (content.geometry) parts.push(tr('Geometrie'))
    if (content.rack_config) parts.push(tr('Regal-Konfiguration'))
    if (content.printer) parts.push(tr('Drucker'))
    return parts.length ? parts.join(' · ') : tr('Profil-Daten')
  }
  return null
}

export default function Library({ setCurrentPage }) {
  const { tr } = useLanguage()
  const [cfg, setCfg]         = useState(null)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [kind, setKind]       = useState('all')
  const [q, setQ]             = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy]       = useState(false)
  const [msg, setMsg]         = useState(null)

  useEffect(() => {
    onlineService.getSettings().then(r => setCfg(r.data)).catch(() => setCfg(null))
  }, [])

  const allowed = !!(cfg?.consented && cfg?.library)

  const load = useCallback(async (refresh = false) => {
    if (!allowed) return
    setLoading(true)
    try {
      // Immer den GESAMTEN Katalog holen und lokal filtern — so stimmen die
      // Zähler je Art, ohne pro Filterklick neu abzurufen.
      setData((await onlineService.getLibrary(null, refresh)).data)
    } catch (e) {
      setData({ items: [], error: e.response?.data?.detail ?? e.message })
    } finally { setLoading(false) }
  }, [allowed])
  useEffect(() => { load(false) }, [load])

  const items = data?.items ?? []
  const counts = useMemo(() => items.reduce((a, i) => ({ ...a, [i.kind]: (a[i.kind] || 0) + 1 }), {}), [items])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items
      .filter(i => kind === 'all' || i.kind === kind)
      .filter(i => !needle || [i.name, i.description, i.author, i.id]
        .some(v => (v || '').toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items, kind, q])

  const openPreview = async (item) => {
    setMsg(null); setPreview({ item, content: null, loading: true })
    try {
      const r = await onlineService.getItem(item.id)
      setPreview({ item: r.data.item, content: r.data.content, loading: false })
    } catch (e) {
      setPreview(null)
      setMsg({ text: e.response?.data?.detail ?? e.message, err: true })
    }
  }

  /* Übernehmen läuft über die BESTEHENDEN Import-Wege — hier wird nichts
     Eigenes geschrieben, damit die vorhandene Validierung greift. */
  const apply = async () => {
    if (!preview?.content) return
    const { item, content } = preview
    setBusy(true); setMsg(null)
    try {
      if (item.kind === 'language') {
        await systemService.importLang({
          code: content.code, name: content.name,
          strings: content.strings ?? undefined,
          translations: content.translations ?? undefined,
        })
        setMsg({ text: tr('Sprachpaket „{0}" installiert — Sprache in Konfiguration → Allgemein umstellen.', content.code), err: false })
      } else if (item.kind === 'profile') {
        await profileService.import(content)
        setMsg({ text: tr('Profil „{0}" importiert.', item.name), err: false })
      } else if (item.kind === 'sequence') {
        // Sequenzen liegen als EIN Dokument → einmischen statt ersetzen.
        const cur = (await autofarmService.getSequences()).data ?? {}
        const list = Array.isArray(cur.sequences) ? [...cur.sequences] : []
        const name = content.name || item.name
        const idx = list.findIndex(s => s?.name === name)
        const entry = { name, description: content.description || item.description, steps: content.steps }
        if (idx >= 0) list[idx] = entry; else list.push(entry)
        await autofarmService.saveSequences({ ...cur, sequences: list })
        setMsg({ text: tr('Sequenz „{0}" übernommen — VOR dem Einsatz im Sequenz-Editor prüfen und ohne Platte testen.', name), err: false })
      }
      setPreview(null)
    } catch (e) {
      setMsg({ text: e.response?.data?.detail ?? e.message, err: true })
    } finally { setBusy(false) }
  }

  // ── Nicht freigeschaltet → nur Hinweis, kein Abruf ──
  if (cfg && !allowed) {
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-surface-100">{tr('Bibliothek')}</h1>
          <p className="text-sm text-surface-500 mt-1">{tr('Sprachpakete, Drucker-Profile und Sequenzen')}</p>
        </div>
        <div className="card p-5 space-y-3">
          <p className="text-sm text-surface-300">
            {tr('Die Bibliothek lädt Inhalte von einem Server außerhalb deines Netzwerks und ist deshalb standardmäßig aus.')}
          </p>
          <p className="text-[11px] text-surface-500">
            {tr('Solange sie aus ist, wird hier NICHTS abgerufen. Du kannst sie unter „System → Online-Dienste" freischalten — dort steht auch genau, was dabei übertragen wird (und was nicht).')}
          </p>
          <button onClick={() => setCurrentPage?.('system')} className="btn-primary text-sm">
            {tr('Zu den Online-Diensten →')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-surface-100">{tr('Bibliothek')}</h1>
          <p className="text-sm text-surface-500 mt-1">{tr('Sprachpakete, Drucker-Profile und Sequenzen')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-surface-600">{tr('Stand')}: {timeAgo(data?.fetched_at, tr)}</span>
          <button onClick={() => load(true)} disabled={loading}
            className="btn-secondary text-sm disabled:opacity-50">
            {loading ? tr('Lade…') : tr('⟳ Aktualisieren')}
          </button>
        </div>
      </div>

      {/* Filter + Suche */}
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        {KINDS.map(k => {
          const n = k.id === 'all' ? items.length : (counts[k.id] || 0)
          return (
            <button key={k.id} onClick={() => setKind(k.id)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                kind === k.id ? 'border-blue-600 bg-blue-950/40 text-blue-300'
                              : 'border-surface-700 text-surface-400 hover:text-surface-200'}`}>
              {k.icon} {tr(k.label)} <span className="text-surface-600">({n})</span>
            </button>
          )
        })}
        <input type="text" value={q} onChange={e => setQ(e.target.value)}
          placeholder={tr('Suchen (Name, Autor, Beschreibung)…')}
          className="flex-1 min-w-[180px] text-xs py-1" />
      </div>

      {data?.error && (
        <p className="text-[11px] text-amber-400">{tr('Abruf fehlgeschlagen')}: {data.error}
          {' — '}{tr('angezeigt wird der letzte gespeicherte Stand.')}</p>
      )}

      {/* Einträge */}
      {!shown.length ? (
        <div className="card p-5">
          <p className="text-sm text-surface-500">
            {items.length
              ? tr('Kein Eintrag passt zum Filter.')
              : tr('Der Katalog ist leer — auf dem Server sind noch keine Inhalte veröffentlicht.')}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map(it => {
            const meta = KIND_META[it.kind] || {}
            return (
              <div key={it.id} className="card p-3.5 flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-surface-100 break-words">{it.name}</p>
                    <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded border ${meta.cls || 'border-surface-700 text-surface-400'}`}>
                      {meta.icon} {tr(meta.label || it.kind)}
                    </span>
                  </div>
                  {it.version && (
                    <span className="text-[10px] font-mono text-surface-500 shrink-0"
                      title={tr('Version des Eintrags')}>v{it.version}</span>
                  )}
                </div>

                {it.description
                  ? <p className="text-[11px] text-surface-400 leading-relaxed">{it.description}</p>
                  : <p className="text-[11px] text-surface-600 italic">{tr('Keine Beschreibung')}</p>}

                <dl className="text-[10px] space-y-0.5 pt-1.5 border-t border-surface-800/60">
                  <div className="flex gap-2">
                    <dt className="text-surface-600 w-14 shrink-0">{tr('Autor')}</dt>
                    <dd className="text-surface-400 min-w-0 break-words">{it.author || tr('unbekannt')}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-surface-600 w-14 shrink-0">{tr('Kennung')}</dt>
                    <dd className="text-surface-500 font-mono min-w-0 break-all">{it.id}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-surface-600 w-14 shrink-0">{tr('Quelle')}</dt>
                    <dd className="text-surface-600 font-mono min-w-0 break-all">{it.path}</dd>
                  </div>
                </dl>

                <button onClick={() => openPreview(it)}
                  className="btn-secondary text-[11px] mt-auto">{tr('Ansehen & übernehmen')}</button>
              </div>
            )
          })}
        </div>
      )}

      {msg && <p className={`text-[12px] ${msg.err ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}

      <p className="text-[10px] text-surface-600">
        {tr('Inhalte kommen von {0} und werden vor der Anzeige geprüft. Übernommen wird nur, was du bestätigst.', cfg?.server_url || '—')}
      </p>

      {/* ── Vorschau ── */}
      {preview && (
        <div className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreview(null)}>
          <div className="card p-5 max-w-2xl w-full space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-surface-100 break-words">{preview.item?.name}</h3>
                <p className="text-[10px] text-surface-500 mt-0.5">
                  {tr(KIND_META[preview.item?.kind]?.label || preview.item?.kind)}
                  {preview.item?.version && ` · v${preview.item.version}`}
                  {preview.item?.author && ` · ${preview.item.author}`}
                </p>
              </div>
              <button onClick={() => setPreview(null)}
                className="text-surface-500 hover:text-surface-300 text-lg leading-none shrink-0">×</button>
            </div>

            {preview.loading ? (
              <p className="text-[11px] text-surface-500">{tr('Lade Inhalt …')}</p>
            ) : (
              <>
                {contentSummary(preview.item?.kind, preview.content, tr) && (
                  <p className="text-[11px] text-blue-300">
                    {contentSummary(preview.item?.kind, preview.content, tr)}
                  </p>
                )}
                {preview.item?.kind === 'sequence' && (
                  <p className="text-[11px] text-amber-300 bg-amber-950/20 border border-amber-800/60 rounded px-2 py-1.5 leading-relaxed">
                    {tr('⚠ Diese Sequenz steuert den OTTOeject. Nach dem Übernehmen im Sequenz-Editor prüfen und einmal ohne Platte testen — fremde Koordinaten können die Mechanik beschädigen.')}
                  </p>
                )}
                {preview.item?.kind === 'language' && preview.content?.code && (
                  <p className="text-[10px] text-surface-500">
                    {tr('Wird als Sprache „{0}" ({1}) installiert — unabhängig vom Katalog-Namen.',
                        preview.content.code, preview.content.name || preview.content.code)}
                  </p>
                )}
                <pre className="text-[10px] leading-snug font-mono text-surface-300 bg-surface-900/70 border border-surface-700/60 rounded-lg p-2 overflow-auto max-h-72 whitespace-pre-wrap">
                  {JSON.stringify(preview.content, null, 2)?.slice(0, 8000)}
                </pre>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setPreview(null)} className="btn-secondary text-sm">{tr('Abbrechen')}</button>
                  <button onClick={apply} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
                    {busy ? tr('Übernehme…') : tr('Übernehmen')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
