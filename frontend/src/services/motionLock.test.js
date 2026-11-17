import { describe, it, expect } from 'vitest'
import { motionLockReason } from './motionLock'

describe('Wer hat den Arm?', () => {
  it('ohne Ablauf ist alles frei', () => {
    expect(motionLockReason({ running: false }, { running: false })).toEqual({ arm: null, printer: null })
    expect(motionLockReason(null, null)).toEqual({ arm: null, printer: null })
  })
  it('laufende Farm sperrt Arm und Drucker', () => {
    expect(motionLockReason({ running: true, paused: false }, null)).toEqual({ arm: 'farm', printer: 'farm_printer' })
  })
  it('pausierte Farm gibt den Arm frei, den Drucker nicht', () => {
    expect(motionLockReason({ running: true, paused: true }, null)).toEqual({ arm: null, printer: 'farm_printer' })
  })
  it('Stresstest sperrt alles', () => {
    expect(motionLockReason({ running: false }, { running: true })).toEqual({ arm: 'stress', printer: 'stress' })
  })
})
