import { controlService } from './api'
import { tr } from './i18n'
import { pushToast } from './toast'

/* Notaus-Zustand für alle Notaus-Knöpfe (Kopfzeile, Handy-Ansicht, Steuerung).
   ───────────────────────────────────────────────────────────────────────────
   Eine Quelle: Der Zustand steht in der Datenbank (gesperrte Geräte). Hier liegt nur
   die letzte bekannte Antwort, damit alle Knöpfe dasselbe zeigen und nicht jeder
   seinen eigenen Timer startet. Nachgeladen wird nach jeder Aktion und alle 10 s,
   solange der Tab sichtbar ist: Den Notaus kann auch ein anderer Tab, das Handy
   oder ein Skript auslösen. */

const POLL_MS = 10_000

let _state = { active: false, armWarning: null, feedback: null }
const _subs = new Set()
let _timer = null

function _set(next) {
  _state = next
  for (const fn of _subs) fn(_state)
}

// Rückmeldung einmal hier statt in jedem Knopf: Kopfzeile und Steuerung können
// gleichzeitig sichtbar sein, die Meldung soll trotzdem nur einmal kommen.
function _announce(feedback) {
  if (!feedback) return
  const text = feedback.key === 'stopped' ? tr('Notaus: Arm angehalten, Abläufe gestoppt, Drucker pausiert')
    : feedback.key === 'stopped_no_arm' ? tr('Notaus: kein OTTOeject eingerichtet — Abläufe gestoppt, Drucker pausiert')
    : feedback.key === 'released' ? tr('Betrieb freigegeben')
    : (feedback.text || tr('Fehler'))
  pushToast(text, feedback.ok ? 'success' : 'error')
}

function _apply(action, data) {
  _set(nextEmergencyState(_state, action, data))
  if (action !== 'state' && action !== 'dismiss') _announce(_state.feedback)
}

/* Die Entscheidung, was nach einer Antwort gilt, als reine Funktion (getestet).
   armWarning: null | 'not_stopped' | 'unreachable' — bleibt stehen, bis jemand
   „Verstanden" klickt oder die Freigabe wirklich geklappt hat.
   feedback: { key | text, ok } — die Texte übersetzt _announce. */
export function nextEmergencyState(prev, action, data) {
  if (action === 'stop') {
    const arms = data?.arms?.length
    if (arms && !data?.arm_stopped) return { active: true, armWarning: 'not_stopped', feedback: null }
    return { active: true, armWarning: prev.armWarning,
             feedback: { key: arms ? 'stopped' : 'stopped_no_arm', ok: true } }
  }
  if (action === 'stop_failed') {
    // Printloom nicht erreichbar: Über den Arm wissen wir NICHTS.
    return { active: true, armWarning: 'unreachable', feedback: { text: data, ok: false } }
  }
  if (action === 'resume') {
    // Nur nach erfolgreichem Klipper-Neustart frei; sonst bleibt alles gesperrt.
    if (data?.success === false) return { ...prev, active: true, feedback: { text: data?.message, ok: false } }
    return { active: false, armWarning: null, feedback: { key: 'released', ok: true } }
  }
  if (action === 'resume_failed') return { ...prev, feedback: { text: data, ok: false } }
  if (action === 'state') return { ...prev, active: !!data?.active }
  if (action === 'dismiss') return { ...prev, armWarning: null }
  return prev
}

export function getEmergency() { return _state }

export async function refreshEmergency() {
  try {
    const r = await controlService.emergencyState()
    _apply('state', r.data)
  } catch (e) {
    // Offline: Die Kopfzeile meldet „Backend offline" schon selbst. Den letzten
    // bekannten Zustand behalten, nicht auf „kein Notaus" zurückfallen.
    console.warn('Notaus-Zustand nicht abrufbar:', e?.message || e)
  }
}

export async function triggerEmergencyStop() {
  // Sofort als aktiv zeigen: Die Antwort kann dauern (Drucker-Pause bis 8 s).
  _set({ ..._state, active: true })
  try {
    const r = await controlService.emergencyStop()
    _apply('stop', r.data)
  } catch (e) {
    _apply('stop_failed', e?.message || String(e))
  }
}

export async function resumeAfterEmergency() {
  try {
    const r = await controlService.resume()
    _apply('resume', r.data)
  } catch (e) {
    _apply('resume_failed', e?.message || String(e))
  }
  refreshEmergency()
}

export function dismissArmWarning() { _apply('dismiss') }

function _tick() { if (document.visibilityState === 'visible') refreshEmergency() }

export function subscribeEmergency(fn) {
  _subs.add(fn)
  if (!_timer) {
    refreshEmergency()
    _timer = setInterval(_tick, POLL_MS)
    document.addEventListener('visibilitychange', _tick)
  }
  return () => {
    _subs.delete(fn)
    if (!_subs.size && _timer) {
      clearInterval(_timer)
      _timer = null
      document.removeEventListener('visibilitychange', _tick)
    }
  }
}
