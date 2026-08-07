import React, { useState, useEffect, useCallback, useRef } from 'react'
import { deviceSettingsService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'

/* Smart-Steckdose direkt in der Kopfleiste schalten.
   ────────────────────────────────────────────────
   Eingerichtet wird sie unter Konfiguration → Geräte → „Energie & Kosten"
   (Home Assistant, Tasmota oder Shelly). Ist dort eine Steckdose hinterlegt,
   erscheint hier je Drucker ein Schalter — sonst gar nichts.

   Der Zustand kommt gesammelt über EINEN Request (/devices/power), nicht je
   Drucker: die Leiste ist immer sichtbar und fragt im Takt nach.

   AUSschalten wird immer nachgefragt. Der Schalter sitzt dauerhaft oben rechts,
   und ein Fehlklick kappt dem Drucker mitten im Druck den Strom. Einschalten
   ist harmlos und geht direkt. */

// Steckdose eingerichtet → im Takt nachsehen. Keine eingerichtet → selten
// nachfassen (nur falls gerade eine angelegt wird; das Ereignis unten meldet
// sich ohnehin sofort).
const POLL_MS = 30000
const POLL_IDLE_MS = 300000

export default function PowerToggle({ farmRunning = false }) {
  const { tr } = useLanguage()
  const [plugs, setPlugs] = useState([])
  const [busy, setBusy] = useState(null)      // device_id, der gerade schaltet
  const busyRef = useRef(null)

  const load = useCallback(() => (
    deviceSettingsService.listPower()
      .then(r => setPlugs(r.data?.plugs ?? []))
      // Fehler NICHT auf „keine Steckdose" abbilden: ein kurzer Aussetzer
      // ließe den Schalter sonst verschwinden und wieder auftauchen.
      .catch(() => {})
  ), [])

  useEffect(() => {
    let timer
    const run = () => {
      // Beim Schalten nicht dazwischenfunken — der Aufruf danach frischt selbst auf.
      const p = busyRef.current == null ? load() : Promise.resolve()
      p.finally(() => {
        timer = setTimeout(run, plugs.length ? POLL_MS : POLL_IDLE_MS)
      })
    }
    // Versteckter Tab fragt nichts ab (jede Abfrage geht an Home Assistant).
    const sichtbar = () => document.visibilityState !== 'hidden'
    if (sichtbar()) run()
    const onVisible = () => { if (sichtbar()) { clearTimeout(timer); run() } }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    // Konfiguration meldet das Speichern → Schalter erscheint sofort, nicht erst
    // nach dem nächsten Takt.
    window.addEventListener('printloom:powerChanged', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('printloom:powerChanged', onVisible)
    }
  }, [load, plugs.length])

  const toggle = async (plug) => {
    const einschalten = !plug.on
    if (!einschalten) {
      const ok = await confirmDialog({
        title: tr('Steckdose ausschalten?'),
        message: farmRunning
          ? tr('Die Auto-Farm läuft gerade. „{0}" jetzt stromlos zu schalten bricht den laufenden Druck ab.', plug.name)
          : tr('„{0}" wird stromlos. Ein laufender Druck bricht dabei ab.', plug.name),
        danger: true,
      })
      if (!ok) return
    }
    setBusy(plug.device_id); busyRef.current = plug.device_id
    try {
      await deviceSettingsService.switchPower(plug.device_id, einschalten)
      // Sofort umschalten, damit der Knopf nicht ~1 s alt aussieht; die Abfrage
      // gleich darauf bringt den echten Zustand (und die Leistung).
      setPlugs(ps => ps.map(p => p.device_id === plug.device_id ? { ...p, on: einschalten } : p))
      await new Promise(res => setTimeout(res, 1200))   // Steckdose meldet verzögert
      await load()
    } catch {
      await load()      // Fehlschlag → echten Zustand zeigen, nicht den gewünschten
    } finally {
      setBusy(null); busyRef.current = null
    }
  }

  if (!plugs.length) return null

  return plugs.map(plug => {
    const an = plug.on === true
    const unbekannt = plug.on == null
    const watt = typeof plug.watts === 'number' ? Math.round(plug.watts) : null
    const stil = unbekannt
      ? 'bg-amber-950/60 text-amber-400 border-amber-800/50 hover:border-amber-600'
      : an
        ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50 hover:border-emerald-600'
        : 'bg-surface-800 text-surface-500 border-surface-700/50 hover:border-surface-500'
    const zustand = unbekannt ? tr('Steckdose nicht erreichbar')
      : an ? tr('An — klicken zum Ausschalten')
           : tr('Aus — klicken zum Einschalten')
    return (
      <button
        key={plug.device_id}
        onClick={() => toggle(plug)}
        disabled={busy === plug.device_id}
        title={`${plug.name} · ${zustand}${watt != null ? ` · ${watt} W` : ''}`}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono border
                    transition-colors disabled:opacity-50 disabled:cursor-wait ${stil}`}
      >
        <span aria-hidden="true">⏻</span>
        <span className="hidden sm:inline">
          {unbekannt ? '?' : an ? (watt != null ? `${watt} W` : tr('An')) : tr('Aus')}
        </span>
      </button>
    )
  })
}
