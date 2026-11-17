import { describe, it, expect } from 'vitest'
import { tabTitle, farmTitleState } from './tabTitle'

describe('Tab-Titel', () => {
  it('ohne laufende Farm: Seite · Printloom', () => {
    expect(tabTitle('Drucker', { running: false })).toBe('Drucker · Printloom')
    expect(tabTitle('', null)).toBe('Printloom')
  })
  it('druckt die Farm: Fortschritt und Datei', () => {
    expect(tabTitle('Drucker', { running: true, progress: 42, fileName: 'teil.gcode.3mf' })).toBe('[42%] teil — Printloom')
  })
  it('aus dem Status (echte Form: jobs + current_job_id)', () => {
    const st = { running: true, current_job_id: 7, jobs: [{ id: 7, status: 'printing', progress: 42, fileName: 'teil.3mf' }] }
    expect(farmTitleState(st)).toEqual({ running: true, progress: 42, fileName: 'teil.3mf' })
    expect(farmTitleState({ running: true, current_job_id: 7, jobs: [{ id: 7, status: 'running' }] }).progress).toBe(0)
  })
})
