import React, { useState, useEffect, useCallback } from 'react'
import { onlineService, systemService, profileService, autofarmService } from '../services/api'
import { useLanguage } from '../services/i18n'

/* ── Online-Dienste (Opt-in) ─────────────────────────────────────────────────
   Printloom verbindet sich NIE ungefragt nach außen. Hier schaltet der Nutzer
   einzelne Funktionen frei; vor der ersten Aktivierung kommt ein Hinweis, dass
   dabei ein Server AUSSERHALB des eigenen Netzwerks kontaktiert wird.
   Bibliotheks-Inhalte werden immer erst als VORSCHAU gezeigt und nur auf Klick
   übernommen — Sequenzen bewegen Hardware. */

const FEATURES = [
  { key: 'update_check', label: 'Update-Prüfung im Internet',
    desc: 'Prüft bei GitHub, ob eine neuere Printloom-Version da ist. Aus = Printloom prüft nichts von allein; du kannst jederzeit von Hand prüfen.' },
  { key: 'notices',      label: 'Bekannte Probleme & Hinweise',
    desc: 'Lädt Warnungen zur laufenden Version (z. B. „Fehler in 1.0.158"), damit du von Fehlern erfährst, ohne auf ein Update zu warten.' },
  { key: 'library',      label: 'Sprachpakete & Bibliothek',
    desc: 'Katalog mit Sprachpaketen, Drucker-Profilen und Sequenzen. Wird nur angezeigt — übernommen erst nach deiner Bestätigung.' },
]

const SEV_STYLE = {
  critical: 'border-red-800/60 bg-red-950/25 text-red-300',
  warning:  'border-amber-800/60 bg-amber-950/20 text-amber-300',
  info:     'border-surface-700 bg-surface-900/40 text-surface-300',
}
const SEV_ICON = { critical: '⛔', warning: '⚠', info: 'ℹ' }

function Toggle({ on, onClick, disabled, color = 'bg-blue-600' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={!!on}
      className={`relative w-10 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? color : 'bg-surface-700'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

function timeAgo(ts, tr) {
  if (!ts) return tr('noch nie')
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (secs < 90) return tr('gerade eben')
  const mins = Math.floor(secs / 60)
  if (mins < 60) return tr('vor {0} Min.', mins)
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return tr('vor {0} Std.', hrs)
  return tr('vor {0} Tagen', Math.floor(hrs / 24))
}

export default function OnlineServices() {
  const { tr } = useLanguage()
  const [cfg, setCfg]         = useState(null)
  const [busy, setBusy]       = useState(false)
  const [askConsent, setAsk]  = useState(null)   // { feature } — Dialog vor der ersten Aktivierung
  const [notices, setNotices] = useState(null)
  const [library, setLibrary] = useState(null)
  const [libKind, setLibKind] = useState('language')
  const [preview, setPreview] = useState(null)   // { item, content } — Vorschau vor dem Übernehmen
  const [msg, setMsg]         = useState(null)   // { text, err }

  const load = useCallback(async () => {
    try { setCfg((await onlineService.getSettings()).data) } catch { setCfg(null) }
  }, [])
  useEffect(() => { load() }, [load])

  const loadNotices = useCallback(async (refresh) => {
    try { setNotices((await onlineService.getNotices(refresh)).data) } catch { /* leise */ }
  }, [])
  const loadLibrary = useCallback(async (kind, refresh) => {
    try { setLibrary((await onlineService.getLibrary(kind, refresh)).data) } catch { /* leise */ }
  }, [])

  useEffect(() => { if (cfg?.consented && cfg?.notices) loadNotices(false) }, [cfg?.consented, cfg?.notices, loadNotices])
  useEffect(() => { if (cfg?.consented && cfg?.library) loadLibrary(libKind, false) }, [cfg?.consented, cfg?.library, libKind, loadLibrary])

  const save = async (patch) => {
    setBusy(true); setMsg(null)
    try {
      setCfg((await onlineService.saveSettings(patch)).data)
    } catch (e) {
      setMsg({ text: e.response?.data?.detail ?? e.message, err: true })
    } finally { setBusy(false) }
  }

  // Einschalten einer Funktion: ohne Zustimmung erst den Hinweis zeigen.
  const toggleFeature = (key) => {
    const turningOn = !cfg?.[key]
    if (turningOn && !cfg?.consented) { setAsk({ feature: key }); return }
    save({ [key]: turningOn })
  }

  const acceptConsent = () => {
    const f = askConsent?.feature
    setAsk(null)
    save({ consented: true, ...(f ? { [f]: true } : {}) })
  }

  const revoke = async () => {
    await save({ consented: false })
    setNotices(null); setLibrary(null); setPreview(null)
    try { await onlineService.clearCache() } catch { /* egal */ }
    setMsg({ text: tr('Verbindung abgelehnt — alle Online-Funktionen aus, Zwischenspeicher gelöscht.'), err: false })
  }

  // Bibliotheks-Eintrag holen und als Vorschau zeigen (noch NICHT anwenden).
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

  // Erst hier wird wirklich etwas übernommen — über die bestehenden Import-Wege.
  const applyPreview = async () => {
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
        setMsg({ text: tr('Sprachpaket „{0}" installiert. Sprache in Konfiguration umstellen.', content.code), err: false })
      } else if (item.kind === 'profile') {
        await profileService.import(content)
        setMsg({ text: tr('Profil „{0}" importiert.', item.name), err: false })
      } else if (item.kind === 'sequence') {
        // Sequenzen liegen als EIN Dokument; die neue Sequenz wird eingemischt
        // (read-modify-write), damit bestehende Sequenzen erhalten bleiben.
        const cur = (await autofarmService.getSequences()).data ?? {}
        const list = Array.isArray(cur.sequences) ? [...cur.sequences] : []
        const name = content.name || item.name
        const idx = list.findIndex(s => s?.name === name)
        const entry = { name, description: content.description || item.description, steps: content.steps }
        if (idx >= 0) list[idx] = entry; else list.push(entry)
        await autofarmService.saveSequences({ ...cur, sequences: list })
        setMsg({ text: tr('Sequenz „{0}" übernommen — VOR dem Einsatz im Sequenz-Editor prüfen und trocken testen.', name), err: false })
      }
      setPreview(null)
    } catch (e) {
      setMsg({ text: e.response?.data?.detail ?? e.message, err: true })
    } finally { setBusy(false) }
  }

  if (!cfg) {
    return (
      <div className="card p-4">
        <h2 className="text-xs font-semibold text-surface-300 uppercase tracking-wider">{tr('Online-Dienste')}</h2>
        <p className="text-[11px] text-surface-600 mt-2">{tr('Lade …')}</p>
      </div>
    )
  }

  const anyOn = cfg.consented && FEATURES.some(f => cfg[f.key])

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold text-surface-300 uppercase tracking-wider">{tr('Online-Dienste')}</h2>
          <p className="text-[11px] text-surface-500 mt-1">
            {tr('Alles freiwillig. Ist hier nichts eingeschaltet, verbindet sich Printloom mit KEINEM Server außerhalb deines Netzwerks — die App funktioniert vollständig offline.')}
          </p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded shrink-0 ${anyOn ? 'bg-blue-950/50 text-blue-300' : 'bg-surface-800 text-surface-400'}`}>
          {anyOn ? tr('teilweise aktiv') : tr('komplett aus')}
        </span>
      </div>

      {/* Einzelschalter */}
      <div className="space-y-2 pt-1 border-t border-surface-800/60">
        {FEATURES.map(f => (
          <div key={f.key} className="flex items-start gap-2.5">
            <Toggle on={!!cfg[f.key]} disabled={busy} onClick={() => toggleFeature(f.key)} />
            <div className="min-w-0">
              <p className={`text-[12px] ${cfg[f.key] ? 'text-surface-200' : 'text-surface-400'}`}>{tr(f.label)}</p>
              <p className="text-[10px] text-surface-600 leading-relaxed">{tr(f.desc)}</p>
            </div>
          </div>
        ))}
      </div>

      {cfg.consented && (
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-surface-800/60">
          <span className="text-[10px] text-surface-600">
            {tr('Server')}: <span className="font-mono text-surface-500">{cfg.server_url}</span>
          </span>
          <button onClick={revoke} disabled={busy}
            className="text-[10px] text-red-400/80 hover:text-red-300 ml-auto">
            {tr('Verbindung widerrufen & Zwischenspeicher löschen')}
          </button>
        </div>
      )}

      {/* Bekannte Probleme */}
      {cfg.consented && cfg.notices && (
        <div className="pt-2 border-t border-surface-800/60 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-surface-300">
              {tr('Hinweise zu Version {0}', notices?.version || '—')}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-surface-600">{tr('Stand')}: {timeAgo(notices?.fetched_at, tr)}</span>
              <button onClick={() => loadNotices(true)} className="text-[10px] text-blue-400 hover:text-blue-300">{tr('⟳ prüfen')}</button>
            </div>
          </div>
          {notices?.error && <p className="text-[10px] text-amber-400">{tr('Abruf fehlgeschlagen')}: {notices.error}</p>}
          {notices && !notices.notices?.length && !notices.error && (
            <p className="text-[10px] text-emerald-400/90">{tr('✓ Keine bekannten Probleme für diese Version.')}</p>
          )}
          {notices?.notices?.map(n => (
            <div key={n.id} className={`rounded-lg border px-3 py-2 ${SEV_STYLE[n.severity] || SEV_STYLE.info}`}>
              <p className="text-[11px] font-medium">{SEV_ICON[n.severity] || 'ℹ'} {n.title}</p>
              {n.text && <p className="text-[10px] opacity-90 mt-0.5 leading-relaxed">{n.text}</p>}
              {n.url && (
                <a href={n.url} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] underline opacity-80 hover:opacity-100">{tr('Mehr dazu')}</a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bibliothek */}
      {cfg.consented && cfg.library && (
        <div className="pt-2 border-t border-surface-800/60 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] font-medium text-surface-300">{tr('Bibliothek')}</p>
            <div className="flex items-center gap-1.5">
              {[['language', 'Sprachen'], ['profile', 'Profile'], ['sequence', 'Sequenzen']].map(([k, label]) => (
                <button key={k} onClick={() => setLibKind(k)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                    libKind === k ? 'border-blue-600 bg-blue-950/40 text-blue-300'
                                  : 'border-surface-700 text-surface-500 hover:text-surface-300'}`}>
                  {tr(label)}
                </button>
              ))}
              <button onClick={() => loadLibrary(libKind, true)} className="text-[10px] text-blue-400 hover:text-blue-300 ml-1">{tr('⟳')}</button>
            </div>
          </div>
          {library?.error && <p className="text-[10px] text-amber-400">{tr('Abruf fehlgeschlagen')}: {library.error}</p>}
          {library && !library.items?.length && !library.error && (
            <p className="text-[10px] text-surface-600">{tr('Nichts vorhanden.')}</p>
          )}
          <div className="space-y-1.5">
            {library?.items?.map(it => (
              <div key={it.id} className="flex items-start gap-2 rounded-lg border border-surface-800 bg-surface-900/40 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-surface-200 truncate">
                    {it.name}
                    {it.version && <span className="text-surface-600 font-mono text-[9px]"> · {it.version}</span>}
                  </p>
                  {it.description && <p className="text-[9px] text-surface-600 leading-snug">{it.description}</p>}
                </div>
                <button onClick={() => openPreview(it)}
                  className="btn-secondary text-[10px] px-2 py-0.5 shrink-0">{tr('Ansehen')}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diagnose-Paket — rein lokal, kein Upload */}
      <div className="pt-2 border-t border-surface-800/60 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-surface-300">{tr('Diagnose-Paket (Support)')}</p>
          <a href={systemService.diagnosticsUrl()} download
            className="btn-secondary text-[11px] shrink-0">{tr('⤓ Herunterladen')}</a>
        </div>
        <p className="text-[10px] text-surface-600 leading-relaxed">
          {tr('ZIP mit Konfiguration, Geometrie, Sequenzen, Versions-Infos und den letzten Log-Zeilen — für die Fehlersuche zum Verschicken. Access-Codes, Tokens und Passwörter sind NICHT enthalten, Druckdateien und Kamerabilder auch nicht. Es wird nichts automatisch verschickt: die Datei landet nur in deinem Download-Ordner.')}
        </p>
      </div>

      {msg && <p className={`text-[11px] ${msg.err ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}

      {/* ── Hinweis-Dialog VOR der ersten Aktivierung ── */}
      {askConsent && (
        <div className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setAsk(null)}>
          <div className="card p-5 max-w-lg w-full space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-surface-100">
              {tr('⚠ Verbindung nach außen bestätigen')}
            </h3>
            <p className="text-[12px] text-surface-300 leading-relaxed">
              {tr('Damit verbindet sich Printloom mit einem Server AUSSERHALB deines Netzwerks:')}
            </p>
            <p className="font-mono text-[12px] text-blue-300 bg-surface-950/60 border border-surface-700 rounded px-2 py-1">
              {cfg.server_url}
            </p>
            <ul className="text-[11px] text-surface-400 space-y-1 list-disc pl-5 leading-relaxed">
              <li>{tr('Es werden nur Daten ABGERUFEN (lesende Anfragen).')}</li>
              <li>{tr('Es werden KEINE Drucker-Daten, Dateinamen, Zugangsdaten oder Nutzungsstatistiken gesendet.')}</li>
              <li>{tr('Der Abruf läuft über den Printloom-Server, nicht über deinen Browser.')}</li>
              <li>{tr('Alles wird lokal zwischengespeichert und funktioniert danach auch offline.')}</li>
              <li>{tr('Du kannst das jederzeit wieder abschalten und den Zwischenspeicher löschen.')}</li>
            </ul>
            <p className="text-[10px] text-amber-400/90">
              {tr('Die Update-Prüfung geht zusätzlich an GitHub (github.com / ghcr.io), da dort die Versionen liegen.')}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setAsk(null)} className="btn-secondary text-sm">{tr('Abbrechen')}</button>
              <button onClick={acceptConsent} className="btn-primary text-sm">{tr('Verstanden — verbinden')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vorschau vor dem Übernehmen ── */}
      {preview && (
        <div className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreview(null)}>
          <div className="card p-5 max-w-2xl w-full space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-surface-100">
              {tr('Vorschau')}: {preview.item?.name}
            </h3>
            {preview.loading ? (
              <p className="text-[11px] text-surface-500">{tr('Lade Inhalt …')}</p>
            ) : (
              <>
                {preview.item?.kind === 'sequence' && (
                  <p className="text-[11px] text-amber-300 bg-amber-950/20 border border-amber-800/60 rounded px-2 py-1.5">
                    {tr('⚠ Diese Sequenz steuert den OTTOeject. Nach dem Übernehmen im Sequenz-Editor prüfen und einmal ohne Platte testen — fremde Koordinaten können die Mechanik beschädigen.')}
                  </p>
                )}
                <pre className="text-[10px] leading-snug font-mono text-surface-300 bg-surface-900/70 border border-surface-700/60 rounded-lg p-2 overflow-auto max-h-72 whitespace-pre-wrap">
                  {JSON.stringify(preview.content, null, 2)?.slice(0, 8000)}
                </pre>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setPreview(null)} className="btn-secondary text-sm">{tr('Abbrechen')}</button>
                  <button onClick={applyPreview} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
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
