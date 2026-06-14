import React, { useState, useEffect, useCallback, useRef } from 'react'
import { systemService, healthService, pushService } from '../services/api'
import { pushSupported, pushUnsupportedReason, isSubscribed, syncSubscription, subscribe as pushSubscribe, unsubscribe as pushUnsubscribe } from '../services/push'
import { VERSION } from '../version'
import { THEMES, getTheme, applyTheme } from '../services/theme'

function ThemePicker() {
  const [theme, setTheme] = useState(getTheme())
  const pick = (id) => { applyTheme(id); setTheme(id) }
  return (
    <div className="card p-6 space-y-4">
      <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Darstellung</h2>
      <p className="text-xs text-surface-500 -mt-2">Farbschema der Oberfläche. Wird auf diesem Gerät gespeichert.</p>
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
            <span className="font-medium">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function PushNotifications() {
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
    try { await pushSubscribe(); setSubscribed(true); flash('Push aktiviert — du bekommst jetzt Benachrichtigungen') }
    catch (e) { flash(e.message || 'Aktivierung fehlgeschlagen', false) }
    finally { setBusy(false) }
  }
  const disable = async () => {
    setBusy(true)
    try { await pushUnsubscribe(); setSubscribed(false); flash('Push deaktiviert') }
    catch (e) { flash(e.message || 'Fehler', false) }
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
        flash('Server-Push nicht verfügbar (Abhängigkeiten fehlen)', false)
      } else if ((d.total ?? 0) === 0) {
        flash('Kein Gerät registriert — auf diesem Gerät „Push aktivieren" erneut antippen (über HTTPS).', false)
      } else if (d.sent > 0) {
        flash(`Test gesendet (${d.sent} Gerät(e))`)
      } else {
        // Device(s) registered but delivery failed — surface the real reason.
        const why = (d.errors && d.errors.length) ? d.errors.join(' · ') : 'unbekannter Fehler'
        flash(`Zustellung an ${d.total} Gerät(e) fehlgeschlagen — ${why}`, false)
      }
    } catch { flash('Test fehlgeschlagen', false) }
    finally { setBusy(false) }
  }

  return (
    <div className="card p-6 space-y-4">
      <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Push-Benachrichtigungen</h2>
      <p className="text-xs text-surface-500">
        Erhalte auf diesem Gerät Push-Meldungen bei „fertig / Fehler / Eingriff nötig" — auch als Home-Screen-App (iOS 16.4+).
      </p>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-xs border ${msg.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-red-950/40 border-red-800 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {!supported ? (
        <p className="text-xs text-amber-400">{reason || 'Dieser Browser/dieses Gerät unterstützt keine Web-Push-Benachrichtigungen.'}</p>
      ) : available === false ? (
        <p className="text-xs text-amber-400">Server-seitiger Push ist nicht verfügbar (Abhängigkeiten fehlen). Nach dem nächsten Image-Update aktiv.</p>
      ) : (
        <div className="flex gap-3 flex-wrap">
          {!subscribed ? (
            <button onClick={enable} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Aktiviere…' : 'Push aktivieren'}
            </button>
          ) : (
            <>
              <button onClick={test} disabled={busy} className="btn-secondary text-sm">Test senden</button>
              <button onClick={disable} disabled={busy} className="btn-secondary text-sm">Deaktivieren</button>
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
      if (!silent) setError('Versionscheck fehlgeschlagen — GitHub/Registry nicht erreichbar?')
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
      await systemService.triggerUpdate(channel)
      await waitForRestart()
      setPhase('done')
      onUpdatePhase?.('done')
      setTimeout(() => window.location.reload(), 2500)
    } catch (e) {
      if (e.response) {
        // Backend answered with an error → the update did NOT start. Show the real
        // reason (e.g. private ghcr package, no Docker socket) instead of waiting.
        const detail = e.response.data?.detail || `Fehler ${e.response.status}`
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
      setBackupFeedback({ ok: true, msg: 'Backup exportiert' })
    } catch {
      setBackupFeedback({ ok: false, msg: 'Export fehlgeschlagen' })
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
      setBackupFeedback({ ok: true, msg: `Backup wiederhergestellt (v${data.current_version ?? '?'}, exportiert: ${data.exported_at?.split('T')[0] ?? '?'})` })
    } catch (err) {
      setBackupFeedback({ ok: false, msg: `Import fehlgeschlagen: ${err.message ?? err}` })
    } finally {
      e.target.value = ''
      setTimeout(() => setBackupFeedback(null), 6000)
    }
  }

  const canUpdate = !updating && !checking
  const isBeta = channel === 'beta'

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
        <h1 className="text-xl font-semibold text-surface-100">System</h1>
        <p className="text-sm text-surface-500 mt-1">Darstellung, Versionsverwaltung &amp; Updates</p>
      </div>

      <ThemePicker />

      {/* Release channel */}
      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Release-Kanal</h2>
        <div className="flex gap-3">
          <button
            onClick={() => switchChannel('latest')}
            className={`flex-1 flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border text-sm transition-colors ${
              !isBeta
                ? 'border-emerald-700 bg-emerald-950/30 text-emerald-300'
                : 'border-surface-700 bg-surface-900 text-surface-400 hover:border-surface-600'
            }`}
          >
            <span className="text-lg">🏷️</span>
            <span className="font-semibold">Latest</span>
            <span className="text-[11px] text-surface-500 text-center">Stabile Releases</span>
          </button>
          <button
            onClick={() => switchChannel('beta')}
            className={`flex-1 flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border text-sm transition-colors ${
              isBeta
                ? 'border-blue-700 bg-blue-950/30 text-blue-300'
                : 'border-surface-700 bg-surface-900 text-surface-400 hover:border-surface-600'
            }`}
          >
            <span className="text-lg">🧪</span>
            <span className="font-semibold">Beta</span>
            <span className="text-[11px] text-surface-500 text-center">Aktive Entwicklung</span>
          </button>
        </div>
        {isBeta && (
          <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3">
            <span className="text-blue-400 text-sm mt-0.5">ℹ</span>
            <p className="text-blue-300 text-xs">
              Beta-Kanal aktiv — neue Features vor dem stabilen Release. Docker-Image-Tag:
              {' '}<span className="font-mono bg-blue-950/50 px-1 rounded">:beta</span>
            </p>
          </div>
        )}
      </div>

      {/* Version card */}
      <div className="card p-6 space-y-5">
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Version</h2>

        <div className="flex items-end gap-8">
          <div>
            <p className="text-xs text-surface-500 mb-1">Installiert</p>
            <p className="text-3xl font-mono font-bold text-surface-100">v{VERSION}</p>
          </div>
          {info?.latest && !isBeta && (
            <div>
              <p className="text-xs text-surface-500 mb-1">Neueste</p>
              <p className={`text-3xl font-mono font-bold ${info.update_available ? 'text-amber-400' : 'text-emerald-400'}`}>
                v{info.latest}
              </p>
            </div>
          )}
          {isBeta && (
            <div>
              <p className="text-xs text-surface-500 mb-1">Kanal</p>
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
                  {isBeta ? 'Beta-Update verfügbar' : `Update verfügbar — v${info.latest}`}
                </span>
              </div>
            )
          return (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="text-emerald-400 text-sm">
                {isBeta ? 'Beta ist aktuell' : `App ist aktuell (v${info.latest})`}
              </span>
            </div>
          )
        })()}

        {phase === 'running' && (
          <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
            <span className="text-blue-300 text-sm">
              {isBeta ? 'Beta wird installiert/gewechselt' : 'Update läuft'} — App startet neu, bitte warten…
            </span>
          </div>
        )}
        {phase === 'done' && (
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            <span className="text-emerald-400 text-sm">Fertig — Seite wird neu geladen…</span>
          </div>
        )}
        {phase === 'no-watchtower' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-4 space-y-3">
            <p className="text-amber-300 text-sm font-medium">Weder Docker-Socket noch Watchtower verfügbar — manuell:</p>
            <pre className="bg-surface-900 rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 select-all overflow-x-auto">
{`docker pull ghcr.io/dasklaus00/printloom:${isBeta ? 'beta' : 'latest'}
docker compose up -d`}
            </pre>
            <button onClick={() => setPhase(null)} className="text-xs text-surface-500 hover:text-surface-300">Schließen</button>
          </div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* No Docker socket → one-click update can't work; tell the user up front. */}
        {info && info.docker_available === false && !['done', 'running'].includes(phase) && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
            <span className="text-amber-400 text-sm mt-0.5">⚠</span>
            <p className="text-amber-300 text-xs">
              Kein Docker-Socket erkannt — Ein-Klick-Update ist nicht möglich. In der Compose-Datei
              {' '}<span className="font-mono bg-amber-950/40 px-1 rounded">/var/run/docker.sock</span>{' '}
              in den App-Container mounten (siehe <span className="font-mono">docker-compose.prod.yml.example</span>).
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
            {checking ? 'Prüfe…' : 'Auf Updates prüfen'}
          </button>
          {!confirmUpdate && !['done', 'running'].includes(phase) && (
            <button
              onClick={() => setConfirmUpdate(true)}
              disabled={!canUpdate}
              className="btn-primary text-sm"
            >
              {updating
                ? 'Aktualisiert…'
                : isBeta
                  ? 'Beta installieren / wechseln'
                  : (info?.update_available ? 'Update installieren' : 'Neu installieren')}
            </button>
          )}
        </div>

        {/* Backup-Disclaimer vor dem Update */}
        {confirmUpdate && !['done', 'running'].includes(phase) && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg px-4 py-4 space-y-3">
            <p className="text-amber-300 text-sm font-medium">⚠ Vor dem Update ein Backup machen</p>
            <p className="text-amber-200/80 text-xs">
              Ein Update kann Einstellungen verändern. Exportiere zur Sicherheit zuerst ein Backup deiner
              Konfiguration (Geräte, Rack, Sequenzen, Zeitpläne) — dann erst aktualisieren.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={exportBackup} className="btn-secondary text-sm">↓ Backup exportieren</button>
              <button
                onClick={() => { setConfirmUpdate(false); triggerUpdate() }}
                disabled={!canUpdate}
                className="btn-primary text-sm"
              >
                {isBeta ? 'Verstanden — Beta installieren / wechseln' : 'Verstanden — jetzt aktualisieren'}
              </button>
              <button onClick={() => setConfirmUpdate(false)} className="btn-ghost text-sm">Abbrechen</button>
            </div>
          </div>
        )}

        <p className="text-[11px] text-surface-600">
          Updates laufen <span className="text-surface-400">nur auf Knopfdruck</span> — kein automatisches Update im
          Hintergrund. Ein Klick zieht das gewählte Kanal-Image (<span className="font-mono">:latest</span> bzw.
          <span className="font-mono"> :beta</span>) und startet die App neu (auch der Kanalwechsel). Voraussetzung:
          Docker-Socket gemountet (siehe Compose).
        </p>
      </div>

      {/* Backup & Restore */}
      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Backup &amp; Restore</h2>
        <p className="text-xs text-surface-500">
          Sichert die <span className="text-surface-300">komplette Konfiguration</span> als JSON: Geräte
          (Drucker &amp; OTTOeject inkl. Zugangsdaten), Kamera-/HA-Einstellungen, Kalibrierung, Sequenzen,
          Farm-Einstellungen, Regal-Layout, Filamente, Zeitpläne &amp; Sprachpakete — exportieren oder wiederherstellen.
        </p>
        <p className="text-[11px] text-amber-500/90">
          ⚠ Die Datei enthält Zugangsdaten (Drucker-Access-Code, HA-/Telegram-Token). Sicher aufbewahren und nicht teilen.
        </p>

        {backupFeedback && (
          <div className={`px-3 py-2 rounded-lg text-xs border ${backupFeedback.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-red-950/40 border-red-800 text-red-300'}`}>
            {backupFeedback.msg}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          <button onClick={exportBackup} className="btn-secondary text-sm">
            ↓ Backup exportieren
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
              ↑ Backup importieren
            </button>
          </div>
        </div>
      </div>

      {/* Push notifications */}
      <PushNotifications />

    </div>
  )
}
