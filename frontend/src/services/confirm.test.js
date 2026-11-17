import { describe, it, expect } from 'vitest'
import { confirmKeyAction } from './confirm'

describe('Bestätigungsdialog: Tasten', () => {
  it('Escape bricht immer ab', () => {
    expect(confirmKeyAction({ key: 'Escape', focus: 'confirm' })).toBe('cancel')
  })
  it('gehaltenes Enter bestätigt nie', () => {
    expect(confirmKeyAction({ key: 'Enter', repeat: true, focus: 'confirm' })).toBe(null)
  })
  it('Enter bestätigt nur mit Fokus auf „Bestätigen"', () => {
    expect(confirmKeyAction({ key: 'Enter', focus: 'confirm' })).toBe('confirm')
    expect(confirmKeyAction({ key: 'Enter', focus: 'other' })).toBe(null)
  })
  it('Enter auf „Abbrechen" bricht ab', () => {
    expect(confirmKeyAction({ key: 'Enter', focus: 'cancel' })).toBe('cancel')
  })
  it('andere Tasten tun nichts', () => {
    expect(confirmKeyAction({ key: 'a', focus: 'confirm' })).toBe(null)
  })
})
