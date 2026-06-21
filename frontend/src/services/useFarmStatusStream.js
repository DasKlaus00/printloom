import { useEffect, useRef } from 'react'
import { autofarmService } from './api'

/* P6 — geteilter WebSocket-Live-Kanal für den Auto-Farm-Status.
   EINE Verbindung für die ganze App: Dashboard, Auto Farm und Mobile-View
   teilen sie (Singleton). Bricht sie ab, fällt der Hook automatisch auf
   HTTP-Polling zurück und baut den WebSocket im Hintergrund neu auf.

   Verwendung:  useFarmStatusStream(setFarmStatus)
   `onStatus` wird mit dem Status-Objekt aufgerufen (gleiche Form wie /status). */

function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/autofarm/ws`
}

// ── Modulweiter Singleton: eine Verbindung, viele Abonnenten ──
const _subs = new Set()
let _status = null
let _ws = null
let _pollTimer = null
let _reconnectTimer = null
let _started = false
let _pollMs = 5000

function _emit() { for (const fn of _subs) { try { fn(_status) } catch {} } }

function _startPoll() {
  if (_pollTimer) return
  const tick = () => autofarmService.getStatus().then(r => { _status = r.data; _emit() }).catch(() => {})
  tick()
  _pollTimer = setInterval(tick, _pollMs)
}
function _stopPoll() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null } }

function _connect() {
  if (!_started) return
  let sock
  try { sock = new WebSocket(wsUrl()) }
  catch { _startPoll(); _reconnectTimer = setTimeout(_connect, 4000); return }
  _ws = sock
  sock.onopen    = () => _stopPoll()                       // WS aktiv → Polling aus
  sock.onmessage = (e) => { try { _status = JSON.parse(e.data); _emit() } catch {} }
  sock.onerror   = () => { try { sock.close() } catch {} }
  sock.onclose   = () => {
    if (_ws === sock) _ws = null
    if (!_started) return
    _startPoll()                                           // Fallback bis WS zurück ist
    _reconnectTimer = setTimeout(_connect, 4000)
  }
}

function _teardown() {
  _started = false
  _stopPoll()
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
  if (_ws) { try { _ws.onclose = null; _ws.close() } catch { /* ignore */ } _ws = null }
  _status = null
}

export function subscribeFarmStatus(fn, pollMs = 5000) {
  _pollMs = pollMs
  _subs.add(fn)
  if (_status != null) { try { fn(_status) } catch { /* ignore */ } }  // letzten Stand sofort
  if (!_started) { _started = true; _connect() }
  return () => {
    _subs.delete(fn)
    if (_subs.size === 0) _teardown()
  }
}

export function useFarmStatusStream(onStatus, pollMs = 5000) {
  const cbRef = useRef(onStatus)
  cbRef.current = onStatus
  useEffect(() => subscribeFarmStatus(d => cbRef.current?.(d), pollMs), [pollMs])
}
