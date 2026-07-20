import React, { useState, useEffect, useCallback, useRef } from 'react'
import { systemService, healthService, pushService } from '../services/api'
import SetupHealth from '../components/SetupHealth'
import { pushSupported, pushUnsupportedReason, isSubscribed, syncSubscription, subscribe as pushSubscribe, unsubscribe as pushUnsubscribe } from '../services/push'
import { VERSION } from '../version'
import { THEMES, getTheme, applyTheme } from '../services/theme'
import { useLanguage } from '../services/i18n'
import { CHANGELOG } from '../changelog'

function ThemePicker() {
  const { tr } = useLanguage()
  const [theme, setTheme] = useState(getTheme())
  const pick = (id) => { applyTheme(id); setTheme(id) }
  return (
    <div className="card p-6 space-y-4">
      <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">{tr('Darstellung')}</h2>
      <p className="text-xs text-surface-500 -mt-2">{tr('Farbschema der Oberfläche. Wird auf diesem Gerät gespeichert.')}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {THEMES.map(t => (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            className={`flex flex-col items-center gap-2 px-3 py-3 rounded-xl border text-sm transition-colors ${
              theme === t.id
                ? 'border-blue-600 bg-blue-600/10 text-blue-300'
                : 'border-surface-700 bg-surface-900 text-surface-400 hover:border-surface-600'
            }`}
          >
            <span className="w-full h-8 rounded-lg border border-white/10" style={{ backgroundColor: t.swatch }} />
            <span className="font-medium">{tr(t.label)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function PushNotifications() {
  const { tr } = useLanguage()
  const [supported]   = useState(pushSupported())
  const [reason]      = useState(pushUnsupportedReason())
  const [available, setAvailable] = useState(null) // server-side push deps present?
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState(null)

  useEffect(() => {
    pushService.getStatus().then(r => setAvailable(r.data.available)).catch(() => setAvailable(false))
    isSubscribed().then(sub => {
      setSubscribed(sub)
      // If the browser already holds a subscription, make sure the backend knows
      // it too (heals a desync that otherwise makes "Test" report 0 devices).
      if (sub) syncSubscription().catch(() => {})
    }).catch(() => {})
  }, [])

  const flash = (text, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 5000) }

  const enable = async () => {
    setBusy(true)
    try { await pushSubscribe(); setSubscribed(true); flash(tr('Push aktiviert — du bekommst jetzt Benachrichtigungen')) }
    catch (e) { flash(e.message || tr('Aktivierung fehlgeschlagen'), false) }
    finally { setBusy(false) }
  }
  const disable = async () => {
    setBusy(true)
    try { await pushUnsubscribe(); setSubscribed(false); flash(tr('Push deaktiviert')) }
    catch (e) { flash(e.message || tr('Fehler'), false) }
    finally { setBusy(false) }
  }
  const test = async () => {
    setBusy(true)
    try {
      // Ensure THIS device's subscription is registered server-side before testing,
      // so a desync doesn't make the test silently hit 0 devices.
      await syncSubscription().catch(() => {})
      const d = r.data
      if (d.disabled) {
        flash(tr('Server-Push nicht verfügbar (Abhängigkeiten fehlen)'), false)
      } else if ((d.total ?? 0) === 0) {
        flash(tr('Kein Gerät registriert — auf diesem Gerät „Push aktivieren" erneut antippen (über HTTPS).'), false)
      } else if (d.sent > 0) {
        flash(tr('Test gesendet ({0} Gerät(e))', d.sent))
      } else {
        // Device(s) registered but delivery failed — surface the real reason.
        const why = (d.errors && d.errors.length) ? d.errors.join(' · ') : tr('unbekannter Fehler')
        flash(tr('Zustellung an {0} Gerät(e) fehlgeschlagen — {1}', d.total, why), false)
      }
    } catch { flash(tr('Test fehlgeschlagen'), false) }
    finally { setBusy(false) }
  }

  return (
    <div className="card p-6 space-y-4">
      <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">{tr('Push-Benachrichtigungen')}</h2>
      <p className="text-xs text-surface-500">
        {tr('Erhalte auf diesem Gerät Push-Meldungen bei „fertig / Fehler / Eingriff nötig" — auch als Home-Screen-App (iOS 16.4+).')}
      </p>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-xs border ${msg.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-red-950/40 border-red-800 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {!supported ? (
        <p className="text-xs text-amber-400">{reason || tr('Dieser Browser/dieses Gerät unterstützt keine Web-Push-Benachrichtigungen.')}</p>
      ) : available === false ? (
        <p className="text-xs text-amber-400">{tr('Server-seitiger Push ist nicht verfügbar (Abhängigkeiten fehlen). Nach dem nächsten Image-Update aktiv.')}</p>
      ) : (
        <div className="flex gap-3 flex-wrap">
          {!subscribed ? (
            <button onClick={enable} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? tr('Aktiviere…') : tr('Push aktivieren')}
            </button>
          ) : (
            <>
              <button onClick={test} disabled={busy} className="btn-secondary text-sm">{tr('Test senden')}</button>
              <button onClick={disable} disabled={busy} className="btn-secondary text-sm">{tr('Deaktivieren')}</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function waitForRestart() {
  return new Promise(resolve => {
    let wentOffline = false
    const deadline = setTimeout(resolve, 120000)
    const poll = setInterval(async () => {
      try {
        await healthService.check()
        if (wentOffline) {
          clearInterval(poll)
          clearTimeout(deadline)
          resolve()
        }
      } catch {
        wentOffline = true
      }
    }, 3000)
  })
}

export default function System({ onUpdateAvailable, onUpdatePhase }) {
  const { tr, lang } = useLanguage()
  const [info, setInfo]               = useState(null)
  const [checking, setChecking]       = useState(false)
  const [updating, setUpdating]       = useState(false)
  const [phase, setPhase]             = useState(null)
  const [error, setError]             = useState(null)
  const [channel, setChannel]         = useState(() => localStorage.getItem('ottomat3d_channel') ?? 'latest')
  const [confirmUpdate, setConfirmUpdate] = useState(false)

  const [backupFeedback, setBackupFeedback] = useState(null)
  const importRef = useRef(null)

  const checkVersion = useCallback(async (silent = false) => {
    if (!silent) setChecking(true)
    setError(null)
    try {
      const r = await systemService.getVersion(channel)
      setInfo(r.data)
      onUpdateAvailable?.(r.data.update_available)
    } catch {
      if (!silent) setError(tr('Versionscheck fehlgeschlagen — GitHub/Registry nicht erreichbar?'))
    } finally {
      if (!silent) setChecking(false)
    }
  }, [onUpdateAvailable, channel])

  useEffect(() => { checkVersion() }, [checkVersion])

  const triggerUpdate = async () => {
    setUpdating(true)
    setPhase('running')
    setError(null)
    onUpdatePhase?.('running')
    try {
      // Native Desktop-App: der Server lädt den Installer und startet ihn; die App
      // wird vom Installer geschlossen → NICHT auf Neustart warten / neu laden.
      if (info?.runtime === 'native') {
        const r = await systemService.triggerUpdate(channel)
        if (r.data?.reason === 'up_to_date') { setPhase(null); setUpdating(false); return }
        setPhase('native-launched')
        onUpdatePhase?.(null)
        return
      }
      await systemService.triggerUpdate(channel)
      await waitForRestart()
      setPhase('done')
      onUpdatePhase?.('done')
      setTimeout(() => window.location.reload(), 2500)
    } catch (e) {
      if (e.response) {
        // Backend answered with an error → the update did NOT start. Show the real
        // reason (e.g. private ghcr package, no Docker socket) instead of waiting.
        const detail = e.response.data?.detail || tr('Fehler {0}', e.response.status)
        if (/watchtower|service not known/i.test(detail)) {
          setPhase('no-watchtower')
        } else {
          setPhase(null)
          setError(detail)
        }
        onUpdatePhase?.(null)
      } else {
        // No response = connection dropped because the container restarted mid-request.
        await waitForRestart()
        setPhase('done')
        onUpdatePhase?.('done')
        setTimeout(() => window.location.reload(), 2500)
      }
    } finally {
      setUpdating(false)
    }
  }

  const exportBackup = async () => {
    setBackupFeedback(null)
    try {
      const r = await systemService.exportBackup()
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `printloom-backup-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
      setBackupFeedback({ ok: true, msg: tr('Backup exportiert') })
    } catch (e) {
      const detail = e.response?.data?.detail || e.message || tr('unbekannter Fehler')
      setBackupFeedback({ ok: false, msg: tr('Export fehlgeschlagen: {0}', detail) })
    } finally {
      setTimeout(() => setBackupFeedback(null), 4000)
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBackupFeedback(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await systemService.importBackup(data)
      setBackupFeedback({ ok: true, msg: tr('Backup wiederhergestellt (v{0}, exportiert: {1})', data.current_version ?? '?', data.exported_at?.split('T')[0] ?? '?') })
    } catch (err) {
      setBackupFeedback({ ok: false, msg: tr('Import fehlgeschlagen: {0}', err.message ?? err) })
    } finally {
      e.target.value = ''
      setTimeout(() => setBackupFeedback(null), 6000)
    }
  }

  const canUpdate = !updating && !checking
  const isBeta = channel === 'beta'
  const isNative = info?.runtime === 'native'   // native Desktop-App (Windows/macOS) statt Docker
  const isNativeLinux = info?.runtime === 'native-linux'   // nativer Linux-Dienst (systemd, ohne Docker)

  const switchChannel = (ch) => {
    setChannel(ch)
    localStorage.setItem('ottomat3d_channel', ch)
    setInfo(null)
    setPhase(null)
    setError(null)
    setConfirmUpdate(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-100">{tr('System')}</h1>
        <p className="text-sm text-surface-500 mt-1">{tr('Darstellung, Versionsverwaltung & Updates')}</p>
      </div>

      <ThemePicker />

      {/* Release channel — kompakter Toggle Latest ↔ Beta */}
      <div className="card p-4 space-y-3">
        <h2 className="text-xs font-semibold text-surface-300 uppercase tracking-wider">{tr('Release-Kanal')}</h2>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-sm font-medium ${!isBeta ? 'text-emerald-300' : 'text-surface-500'}`}>🏷️ Latest</span>
            <span className="text-[10px] text-surface-600 hidden sm:inline">{tr('Stabil')}</span>
          </div>
          {/* Toggle-Schalter: links = Latest, rechts = Beta */}
          <button
            onClick={() => switchChannel(isBeta ? 'latest' : 'beta')}
            aria-pressed={isBeta}
            title={tr('Zwischen Latest (stabil) und Beta umschalten')}
            className={`relative w-14 h-7 rounded-full transition-colors shrink-0 ${isBeta ? 'bg-blue-600' : 'bg-emerald-700'}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${isBeta ? 'left-[30px]' : 'left-0.5'}`} />
          </button>
          <div className="flex items-center gap-2 min-w-0 justify-end">
            <span className="text-[10px] text-surface-600 hidden sm:inline">{tr('Entwicklung')}</span>
            <span className={`text-sm font-medium ${isBeta ? 'text-blue-300' : 'text-surface-500'}`}>🧪 Beta</span>
          </div>
        </div>
        {/* Beta = Warnung „auf eigene Gefahr"; Latest = neutraler Hinweis */}
        {isBeta ? (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
            <span className="text-amber-400 text-sm mt-0.5">⚠</span>
            <p className="text-amber-300 text-[11px] leading-relaxed">
              {tr('Beta ist NICHT stabil und kann Fehler enthalten — Nutzung auf eigene Gefahr. Vor dem Wechsel ein Backup exportieren.')}
              {!isNative && <>{' '}<span className="font-mono bg-amber-950/40 px-1 rounded">:beta</span></>}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-surface-600">{tr('Stabile Releases — empfohlen für den Produktivbetrieb.')}</p>
        )}
      </div>

      {/* Version card */}
      <div className="card p-6 space-y-5">
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">{tr('Version')}</h2>

        <div className="flex items-end gap-8">
          <div>
            <p className="text-xs text-surface-500 mb-1">{tr('Installiert')}</p>
            <p className="text-3xl font-mono font-bold text-surface-100">v{VERSION}</p>
          </div>
          {info?.latest && !isBeta && (
            <div>
              <p className="text-xs text-surface-500 mb-1">{tr('Neueste')}</p>
              <p className={`text-3xl font-mono font-bold ${info.update_available ? 'text-amber-400' : 'text-emerald-400'}`}>
                v{info.latest}
              </p>
            </div>
          )}
          {isBeta && (
            <div>
              <p className="text-xs text-surface-500 mb-1">{tr('Kanal')}</p>
              <p className="text-xl font-mono font-bold text-blue-400">beta</p>
            </div>
          )}
        </div>

        {/* Update status (both channels) */}
        {info && !['done', 'running'].includes(phase) && (() => {
          if (info.error)
            return (
              <div className="bg-surface-800 rounded-lg px-4 py-3">
                <p className="text-surface-400 text-xs">{info.error}</p>
              </div>
            )
          if (info.update_available)
            return (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                <span className="text-amber-300 text-sm font-medium">
                  {isBeta ? tr('Beta-Update verfügbar') : tr('Update verfügbar — v{0}', info.latest)}
                </span>
              </div>
            )
          return (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="text-emerald-400 text-sm">
                {isBeta ? tr('Beta ist aktuell') : tr('App ist aktuell (v{0})', info.latest)}
              </span>
            </div>
          )
        })()}

        {phase === 'running' && (
          <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
            <span className="text-blue-300 text-sm">
              {isBeta ? tr('Beta wird installiert/gewechselt') : tr('Update läuft')}{tr(' — App startet neu, bitte warten…')}
            </span>
          </div>
        )}
        {phase === 'done' && (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            <span className="text-emerald-400 text-sm">{tr('Fertig — Seite wird neu geladen…')}</span>
          </div>
        )}
        {phase === 'native-launched' && (
          <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3">
            <span className="text-blue-400 text-sm mt-0.5">⬇</span>
            <p className="text-blue-300 text-sm">
              {tr('Installer wurde gestartet. Printloom wird geschlossen und aktualisiert — folge dem Installer und starte die App danach neu.')}
            </p>
          </div>
        )}
        {phase === 'no-watchtower' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-4 space-y-3">
            <p className="text-amber-300 text-sm font-medium">{tr('Weder Docker-Socket noch Watchtower verfügbar — manuell:')}</p>
            <pre className="bg-surface-900 rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 select-all overflow-x-auto">
{`docker pull ghcr.io/dasklaus00/printloom:${isBeta ? 'beta' : 'latest'}
docker compose up -d`}
            </pre>
            <button onClick={() => setPhase(null)} className="text-xs text-surface-500 hover:text-surface-300">{tr('Schließen')}</button>
          </div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* No Docker socket → one-click update can't work; tell the user up front.
            Nicht in den nativen Betriebsarten (dort ist Docker erwartungsgemäß nicht da). */}
        {info && info.docker_available === false && !isNative && !isNativeLinux && !['done', 'running'].includes(phase) && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
            <span className="text-amber-400 text-sm mt-0.5">⚠</span>
            <p className="text-amber-300 text-xs">
              {tr('Kein Docker-Socket erkannt — Ein-Klick-Update ist nicht möglich. In der Compose-Datei')}
              {' '}<span className="font-mono bg-amber-950/40 px-1 rounded">/var/run/docker.sock</span>{' '}
              {tr('in den App-Container mounten (siehe')} <span className="font-mono">docker-compose.prod.yml.example</span>).
            </p>
          </div>
        )}

        {/* Action buttons (both channels) */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => checkVersion()}
            disabled={!canUpdate}
            className="btn-secondary text-sm"
          >
            {checking ? tr('Prüfe…') : tr('Auf Updates prüfen')}
          </button>
          {!confirmUpdate && !isNativeLinux && !['done', 'running'].includes(phase) && (
            <button
              onClick={() => setConfirmUpdate(true)}
              disabled={!canUpdate}
              className="btn-primary text-sm"
            >
              {updating
                ? tr('Aktualisiert…')
                : isBeta
                  ? tr('Beta installieren / wechseln')
                  : (info?.update_available ? tr('Update installieren') : tr('Neu installieren'))}
            </button>
          )}
        </div>

        {/* Backup-Disclaimer vor dem Update */}
        {confirmUpdate && !['done', 'running'].includes(phase) && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg px-4 py-4 space-y-3">
            <p className="text-amber-300 text-sm font-medium">{tr('⚠ Vor dem Update ein Backup machen')}</p>
            <p className="text-amber-200/80 text-xs">
              {tr('Ein Update kann Einstellungen verändern. Exportiere zur Sicherheit zuerst ein Backup deiner Konfiguration (Geräte, Rack, Sequenzen, Zeitpläne) — dann erst aktualisieren.')}
            </p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={exportBackup} className="btn-secondary text-sm">{tr('↓ Backup exportieren')}</button>
              <button
                onClick={() => { setConfirmUpdate(false); triggerUpdate() }}
                disabled={!canUpdate}
                className="btn-primary text-sm"
              >
                {isBeta ? tr('Verstanden — Beta installieren / wechseln') : tr('Verstanden — jetzt aktualisieren')}
              </button>
              <button onClick={() => setConfirmUpdate(false)} className="btn-ghost text-sm">{tr('Abbrechen')}</button>
            </div>
          </div>
        )}

        {isNativeLinux ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-surface-600">
              {tr('Native Installation ohne Docker — Updates laufen per SSH-Befehl auf dem Gerät:')}
            </p>
            <pre className="bg-surface-900 rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 select-all overflow-x-auto">bash ~/printloom/scripts/update-native.sh</pre>
          </div>
        ) : isNative ? (
          <p className="text-[11px] text-surface-600">
            {tr('Updates laufen')} <span className="text-surface-400">{tr('nur auf Knopfdruck')}</span> {tr('— kein automatisches Update im Hintergrund. Ein Klick lädt den passenden Installer vom GitHub-Release und startet ihn; die App wird geschlossen und aktualisiert.')}
          </p>
        ) : (
          <p className="text-[11px] text-surface-600">
            {tr('Updates laufen')} <span className="text-surface-400">{tr('nur auf Knopfdruck')}</span> {tr('— kein automatisches Update im Hintergrund. Ein Klick zieht das gewählte Kanal-Image (')}<span className="font-mono">:latest</span>{tr(' bzw.')}
            <span className="font-mono"> :beta</span>{tr(') und startet die App neu (auch der Kanalwechsel). Voraussetzung: Docker-Socket gemountet (siehe Compose).')}
          </p>
        )}

        {/* Patchnotes der letzten Updates — ganz unten, damit die Backup-Warnung
            direkt am Installieren-Knopf bleibt (Sprache folgt der Auswahl unten links) */}
        {CHANGELOG.length > 0 && (
          <div className="pt-3 border-t border-surface-800/60 space-y-3">
            <p className="text-xs text-surface-500 uppercase tracking-wider">{tr('Was ist neu')}</p>
            <div className="space-y-3">
              {CHANGELOG.slice(0, 5).map(entry => (
                <div key={entry.version} className="space-y-1">
                  <p className="text-sm font-mono font-semibold text-surface-300">v{entry.version}</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {(lang === 'en' ? entry.en : entry.de).map((line, i) => (
                      <li key={i} className="text-xs text-surface-400 leading-snug">{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2.9 — Einrichtungs-Status / Health-Checkliste */}
      <div className="card p-6 space-y-3">
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">{tr('Einrichtungs-Status')}</h2>
        <SetupHealth />
      </div>

      {/* Backup & Restore */}
      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">{tr('Backup & Restore')}</h2>
        <p className="text-xs text-surface-500">
          {tr('Sichert die')} <span className="text-surface-300">{tr('komplette Konfiguration')}</span> {tr('als JSON: Geräte (Drucker & OTTOeject inkl. Zugangsdaten), Drucker-/Kamera-/HA-Einstellungen, Drucker-Geometrie (X-Positionen & G-code-Overrides), Profile, Kalibrierung, Sequenzen, Farm-Einstellungen, Regal-Layout, Filamente, Zeitpläne & Sprachpakete — exportieren oder wiederherstellen.')}
        </p>
        <p className="text-[11px] text-amber-500/90">
          {tr('⚠ Die Datei enthält Zugangsdaten (Drucker-Access-Code, HA-/Telegram-Token). Sicher aufbewahren und nicht teilen.')}
        </p>

        {backupFeedback && (
          <div className={`px-3 py-2 rounded-lg text-xs border ${backupFeedback.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-red-950/40 border-red-800 text-red-300'}`}>
            {backupFeedback.msg}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          <button onClick={exportBackup} className="btn-secondary text-sm">
            {tr('↓ Backup exportieren')}
          </button>
          <div>
            <input
              type="file"
              accept=".json"
              ref={importRef}
              onChange={handleImport}
              className="hidden"
            />
            <button onClick={() => importRef.current?.click()} className="btn-secondary text-sm">
              {tr('↑ Backup importieren')}
            </button>
          </div>
        </div>
      </div>

      {/* Push notifications */}
      <PushNotifications />

    </div>
  )
}
