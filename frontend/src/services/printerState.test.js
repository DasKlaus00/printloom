import { describe, it, expect } from 'vitest'
import { printerState } from './printerState'

describe('Druckerzustand', () => {
  it('Vorbereiten ist nicht offline', () => {
    expect(printerState('PREPARE').label).toBe('Bereitet vor…')
    expect(printerState('SLICING').label).toBe('Bereitet vor…')
  })
  it('unbekannt wird genannt', () => {
    expect(printerState('INIT').label).toBe('Unbekannt (INIT)')
  })
  it('Offline nur ohne Status', () => {
    expect(printerState(undefined).label).toBe('Offline')
    expect(printerState('').label).toBe('Offline')
  })
  it('bekannte Zustände', () => {
    expect(printerState('RUNNING').label).toBe('Druckt')
  })
})
