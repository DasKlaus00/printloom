import { useEffect, useRef } from 'react'
import { autofarmService } from './api'

/* P6 — WebSocket-Live-Kanal für den Auto-Farm-Status.
   Der Server pusht den Farm-Status (inkl. Log) bei jeder Änderung, statt dass
   jeder Client pollt. Bricht die Verbindung ab, fällt der Hook automatisch auf
   HTTP-Polling zurück und versucht parallel, den WebSocket neu aufzubauen.

   Verwendung:  useFarmStatusStream(setFarmStatus)
   `onStatus` wird mit dem Status-Objekt aufgerufen (gleiche Form wie /status). */

function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/autofarm/ws`
}

export function useFarmStatusStream(onStatus, pollMs = 5000) {
  const cbRef = useRef(onStatus)
  cbRef.current = onStatus

  useEffect(() => {
    let closed = false
    let ws = null
    let pollTimer = null
    let reconnectTimer = null

    const emit = (data) => { try { cbRef.current?.(data) } catch {} }

    const startPoll = () => {
      if (pollTimer) return
      const tick = () => autofarmService.getStatus().then(r => emit(r.data)).catch(() => {})
      tick()
      pollTimer = setInterval(tick, pollMs)
    }
    const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }

    const connect = () => {
      if (closed) return
      let sock
      try { sock = new WebSocket(wsUrl()) }
      catch { startPoll(); reconnectTimer = setTimeout(connect, 4000); return }
      ws = sock
      sock.onopen    = () => stopPoll()                       // WS aktiv → Polling aus
      sock.onmessage = (e) => { try { emit(JSON.parse(e.data)) } catch {} }
      sock.onerror   = () => { try { sock.close() } catch {} }
      sock.onclose   = () => {
        if (ws === sock) ws = null
        if (closed) return
        startPoll()                                           // Fallback bis WS zurück ist
        reconnectTimer = setTimeout(connect, 4000)
      }
    }

    connect()

    return () => {
      closed = true
      stopPoll()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) { try { ws.onclose = null; ws.close() } catch {} }
    }
  }, [pollMs])
}
