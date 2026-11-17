/* Toasts (seit v1.1.71): Form des Ereignisses, Symbol nur auf Wunsch, Dauer je Art.
   Testumgebung ist node — window und CustomEvent als Attrappe wie in theme.test.js. */
import { describe, it, expect, beforeEach } from 'vitest'
import { pushToast, toastDuration, TOAST_EVENT } from './toast'

let events
beforeEach(() => {
  events = []
  globalThis.window = { dispatchEvent: (e) => events.push(e) }
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
})

describe('pushToast', () => {
  it('feuert ein Ereignis mit Text, Art und eindeutiger ID', () => {
    pushToast('Gespeichert', 'success')
    pushToast('Nochmal', 'success')
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe(TOAST_EVENT)
    expect(events[0].detail).toMatchObject({ message: 'Gespeichert', kind: 'success', icon: null })
    expect(events[0].detail.id).not.toBe(events[1].detail.id)
  })
  it('ohne Angabe ist die Art „info"', () => {
    pushToast('Hallo')
    expect(events[0].detail.kind).toBe('info')
  })
  it('ein Symbol nur, wenn es mitgegeben wird', () => {
    pushToast('PLA hinzugefügt', 'success', { icon: '🧵' })
    expect(events[0].detail.icon).toBe('🧵')
  })
  it('ohne Text kein Ereignis', () => {
    pushToast('')
    pushToast(null, 'error')
    expect(events).toHaveLength(0)
  })
})

describe('toastDuration', () => {
  it('Fehler bleiben 12 s, alles andere 5 s', () => {
    expect(toastDuration('error')).toBe(12000)
    expect(toastDuration('success')).toBe(5000)
    expect(toastDuration('info')).toBe(5000)
    expect(toastDuration('unbekannt')).toBe(5000)
  })
})
