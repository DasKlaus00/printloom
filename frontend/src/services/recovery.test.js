import { describe, it, expect } from 'vitest'
import { recoveryHint } from './recovery'

describe('Hinweis nach einem Abbruch', () => {
  it('unbekannter Greifer heißt nachsehen, nicht leer', () => {
    const h = recoveryHint({ arm: { holding: 'full' }, bed: 'empty' })
    expect(h.arm.key).toBe('Greifer-Inhalt unbekannt — bitte nachsehen')
    expect(h.clean).toBe(false)
  })
  it('leere Platte mit Fach', () => {
    const h = recoveryHint({ arm: { holding: 'empty', from: '1-7' }, bed: 'empty' })
    expect(h.arm).toEqual({ key: 'Im Greifer hängt eine LEERE Platte (aus Fach {0})', args: ['1-7'] })
  })
  it('Druck im Drucker', () => {
    const h = recoveryHint({ arm: { holding: 'none' }, bed: 'printing' })
    expect(h.bedFull).toBe(true)
    expect(h.armFull).toBe(false)
    expect(h.clean).toBe(false)
  })
  it('alles leer', () => {
    expect(recoveryHint({ arm: { holding: 'none' }, bed: 'empty' }).clean).toBe(true)
    expect(recoveryHint({}).clean).toBe(true)
  })
})
