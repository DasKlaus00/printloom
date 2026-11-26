import React, { useMemo, useRef, useState } from 'react'
import { apiError } from '../services/apiError'
import { systemService, onlineService } from '../services/api'
import { confirmDialog } from '../services/confirm'
import { useLanguage, activePacks, customPacks, customOverridesFor, setLanguage, setPackActive,
         getTranslationTemplate, loadLangPacks } from '../services/i18n'
import { PACKS, SOURCE } from '../services/lang/catalog'
import { requestableLanguages, languageName } from '../services/lang/requestable'

const REQUESTED_KEY = 'printloom_lang_requested'   // nur Anzeige „schon angefragt“ in diesem Browser
const readRequested = () => { try { return JSON.parse(localStorage.getItem(REQUESTED_KEY) || '[]') } catch { return [] } }

/* Sprachen-Store (seit v1.1.91): die mit Printloom ausgelieferten Sprachpakete
   aktivieren, deaktivieren und verwenden; dazu eigene Pakete (Datei-Import).

   Ausgelieferte Pakete sind immer vollständig — i18n.test.js lässt kein Release mit
   einer Lücke durch —, deshalb steht hier keine Prozentzahl. Aktiv heißt: erscheint im
   Umschalter der Seitenleiste und im Setup. Die gewählte Sprache und die Liste der
   aktiven Pakete speichert der Server für die ganze Installation.
   Steht in Konfiguration → Allgemein und in der Bibliothek (dort auch ohne Online-Freigabe). */
export default function LanguageStore() {
  const { lang, tr, locale } = useLanguage()
  const [active, setActive] = useState(() => activePacks())
  const [custom, setCustom] = useState(() => customPacks())
  const [busy, setBusy]     = useState('')
  const [status, setStatus] = useState(null)
  const fileRef = useRef()
  const [wish, setWish]           = useState('')
  const [requested, setRequested] = useState(readRequested)
  const choices = useMemo(() => requestableLanguages(locale), [locale])

  /* Sprachwunsch (seit v1.1.93): erst sagen, was wohin geht, dann senden. Vorhandene
     und ähnliche Sprachen stehen gar nicht erst in der Auswahl (requestable.js). */
  const sendWish = async () => {
    if (!wish) return
    setStatus(null)
    // Der Dialog nennt den Server, an den das Backend WIRKLICH sendet. Ist der nicht
    // lesbar, wird nicht gesendet (kein geratener Name — Sicherheitsprüfung 26.11.).
    let host = ''
    try { host = new URL((await onlineService.getSettings()).data?.server_url || '').hostname }
    catch (e) { console.warn('Online-Einstellungen nicht gelesen:', e?.message || e) }
    if (!host) {
      setStatus({ ok: false, msg: tr('Online-Einstellungen nicht lesbar — Anfrage nicht gesendet') })
      return
    }
    const ok = await confirmDialog({
      title: tr('Sprache anfragen?'),
      message: tr('Printloom sendet an {0} nur den Sprachcode „{1}“ und die Printloom-Version — keine Geräte-, Datei- oder Nutzerdaten. Die Website sieht dabei die öffentliche IP-Adresse deines Anschlusses (nur zum Begrenzen der Anfragen, nicht gespeichert). Die Anfrage ist auf der Website nicht öffentlich sichtbar.', host, wish),
      confirmLabel: tr('Anfrage senden'),
    })
    if (!ok) return
    setBusy('wish')
    try {
      const r = await onlineService.requestLanguage(wish)
      const next = [...new Set([...requested, wish])]
      try { localStorage.setItem(REQUESTED_KEY, JSON.stringify(next)) } catch (e) { console.warn('localStorage:', e?.message || e) }
      setRequested(next)
      setStatus({ ok: true, msg: r.data?.already_sent
        ? tr('Diese Sprache wurde gerade schon angefragt — danke!')
        : tr('Anfrage gesendet — danke! Neue Sprachen kommen mit einem der nächsten Updates.') })
      setWish('')
    } catch (e) {
      setStatus({ ok: false, msg: apiError(e) })
    } finally { setBusy('') }
  }

  const toggle = async (code, on) => {
    setBusy(code); setStatus(null)
    try {
      setActive(await setPackActive(code, on))
      setStatus({ ok: true, msg: on ? tr('Sprache aktiviert — sie steht jetzt in der Auswahl.')
                                    : tr('Sprache deaktiviert.') })
    } catch (e) {
      setStatus({ ok: false, msg: apiError(e) })
    } finally { setBusy('') }
  }

  const reloadCustom = async () => { await loadLangPacks(); setCustom(customPacks()) }

  const importFile = (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setStatus(null)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const pack = JSON.parse(ev.target.result)
        const hasStrings = pack.strings && typeof pack.strings === 'object' && Object.keys(pack.strings).length > 0
        if (!pack.code || !hasStrings) throw new Error(tr('Pack braucht code + strings'))
        await systemService.importLang({ code: pack.code, name: pack.name, strings: pack.strings })
        await reloadCustom()
        setStatus({ ok: true, msg: tr('Sprachpaket „{0}" importiert.', pack.code) })
      } catch (e2) {
        setStatus({ ok: false, msg: apiError(e2) })
      }
    }
    reader.readAsText(file)
  }

  const exportTemplate = () => {
    const template = { code: 'xy', name: 'Language Name', strings: getTranslationTemplate() }
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'printloom-lang-template.json'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const removeCustom = async (code) => {
    setBusy(code); setStatus(null)
    try {
      await systemService.deleteLang(code)
      await reloadCustom()
    } catch (e) {
      setStatus({ ok: false, msg: apiError(e) })
    } finally { setBusy('') }
  }

  // Korrekturen = eigene Pakete mit dem Code eines ausgelieferten (z. B. ein älteres zh-cn).
  const removeCorrections = async (code) => {
    setBusy(code); setStatus(null)
    try {
      for (const o of customOverridesFor(code)) await systemService.deleteLang(o.code)
      await reloadCustom()
      setStatus({ ok: true, msg: tr('Eigene Korrekturen entfernt — es gilt das ausgelieferte Paket.') })
    } catch (e) {
      setStatus({ ok: false, msg: apiError(e) })
    } finally { setBusy('') }
  }

  const total = Object.keys(getTranslationTemplate()).length

  return (
    <div className="card space-y-3">
      <div>
        <p className="section-label">{tr('Sprachen')}</p>
        <p className="text-[11px] text-surface-500 mt-0.5">
          {tr('Sprachpakete kommen mit jedem Update und sind immer vollständig. Aktivierte Sprachen stehen im Umschalter unten in der Seitenleiste und im Setup; die Wahl gilt für die ganze Installation.')}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {PACKS.map(p => {
          const on = active.includes(p.code)
          const current = lang === p.code
          const fixed = p.code === SOURCE
          const corrections = customOverridesFor(p.code).reduce((n, o) => n + o.count, 0)
          return (
            <div key={p.code} className={`rounded-lg border p-3 space-y-2 ${
              current ? 'border-blue-700 bg-blue-950/30' : 'border-surface-700 bg-surface-900'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-surface-100">{p.name}</p>
                  <p className="text-[11px] text-surface-500">{p.english} · <span className="font-mono">{p.code}</span></p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {current && <span className="badge badge-blue">{tr('In Verwendung')}</span>}
                  {!current && on && <span className="badge badge-green">{tr('Aktiv')}</span>}
                  {p.standard && <span className="badge badge-gray">{tr('Standardsprache')}</span>}
                </div>
              </div>
              <p className="text-[11px] text-surface-500">
                {fixed ? tr('Quelltext der Oberfläche — immer aktiv')
                       : tr('Vollständig · wird mit jedem Update aktualisiert')}
              </p>
              {corrections > 0 && (
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-surface-400 flex-1">{tr('+ eigene Korrekturen: {0} Texte', corrections)}</p>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy}
                    onClick={() => removeCorrections(p.code)}>{tr('Entfernen')}</button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!fixed && (on ? (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy || current}
                    title={current ? tr('Die verwendete Sprache bleibt aktiv') : undefined}
                    onClick={() => toggle(p.code, false)}>{tr('Deaktivieren')}</button>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" disabled={!!busy}
                    onClick={() => toggle(p.code, true)}>{tr('Aktivieren')}</button>
                ))}
                {on && !current && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy}
                    onClick={() => setLanguage(p.code)}>{tr('Verwenden')}</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Eigene Pakete: Datei-Import oder Online-Bibliothek. Fehlt ihnen ein Text,
          erscheint er auf Englisch. */}
      <div className="border-t border-surface-700 pt-3 space-y-2">
        <p className="text-[11px] font-medium text-surface-300">{tr('Eigene Sprachpakete')}</p>
        {custom.length === 0 ? (
          <p className="text-[11px] text-surface-500">{tr('Keine eigenen Pakete installiert.')}</p>
        ) : custom.map(c => (
          <div key={c.code} className="flex items-center gap-2 text-xs">
            <span className="font-mono text-surface-300">{c.code}</span>
            <span className="flex-1 truncate text-surface-400">{c.name}</span>
            <span className="text-surface-500">{tr('{0} von {1} Texten', c.count, total)}</span>
            {lang !== c.code && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy}
                onClick={() => setLanguage(c.code)}>{tr('Verwenden')}</button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy}
              onClick={() => removeCustom(c.code)}>{tr('Entfernen')}</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importFile} />
          <button type="button" onClick={exportTemplate} className="btn btn-ghost btn-sm">{tr('Template exportieren')}</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-ghost btn-sm">{tr('Pack importieren')}</button>
        </div>
        <p className="text-[10px] text-surface-500 leading-relaxed">
          {tr('Eigene Pakete ergänzen die ausgelieferten: Ein Paket mit demselben Code (z. B. zh-cn) gilt als Korrektur und geht vor. Was einem Paket fehlt, erscheint auf Englisch, nie auf Deutsch. Das Template enthält alle deutschen Texte mit englischer Vorlage.')}
        </p>
      </div>

      {/* Sprache anfragen: geht nur auf Klick an den Printloom-Server, nicht öffentlich. */}
      <div className="border-t border-surface-700 pt-3 space-y-2">
        <p className="text-[11px] font-medium text-surface-300">{tr('Sprache anfragen')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={wish} onChange={e => setWish(e.target.value)} className="text-sm" aria-label={tr('Sprache anfragen')}>
            <option value="">{tr('— Sprache wählen —')}</option>
            {choices.map(c => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code}){requested.includes(c.code) ? ` · ${tr('angefragt')}` : ''}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!wish || !!busy}
            onClick={sendWish}>{tr('Anfrage senden')}</button>
        </div>
        <p className="text-[10px] text-surface-500 leading-relaxed">
          {tr('Fehlt deine Sprache? Wähle sie aus — Printloom schickt nach deiner Bestätigung nur den Sprachcode und die Version an den Printloom-Server. Vorhandene und ähnliche Sprachen (z. B. eine zweite Chinesisch-Variante) stehen nicht in der Liste: Für sie kommt kein eigenes Paket.')}
        </p>
        {wish && <p className="text-[10px] text-surface-500">{languageName(wish, 'en')}</p>}
      </div>

      {status && (
        <div className={`text-[11px] px-2 py-1 rounded border ${
          status.ok ? 'text-emerald-400 border-emerald-900/50 bg-emerald-950/20'
                    : 'text-red-400 border-red-900/50 bg-red-950/20'}`}>
          {status.msg}
        </div>
      )}
    </div>
  )
}
