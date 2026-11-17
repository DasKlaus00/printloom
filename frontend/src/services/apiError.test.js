import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiError, apiDetail } from './apiError'

// Echte Formen von axios-Fehlern
const resp = (status, detail) => ({ response: { status, data: detail === undefined ? {} : { detail } } })

describe('API-Fehler als Satz', () => {
  it('Pydantic-Liste (422) wird lesbar, nie ein Objekt', () => {
    const t = apiError(resp(422, [{ loc: ['body', 'count'], msg: 'field required', type: 'missing' }]))
    expect(typeof t).toBe('string')
    expect(t).toContain('count')
  })
  it('ohne Antwort: Server nicht erreichbar', () => {
    expect(apiError({ message: 'Network Error' })).toBe('Server nicht erreichbar')
  })
  it('Zeitüberschreitung', () => {
    expect(apiError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' })).toMatch(/Zeitüberschreitung/)
  })
  it('502 ohne detail', () => {
    expect(apiError(resp(502))).toBe('Server antwortet nicht (HTTP 502)')
  })
  it('detail als Text', () => {
    expect(apiError(resp(404, 'Job nicht gefunden'))).toBe('Job nicht gefunden')
  })
  it('Objekt mit message oder problems', () => {
    expect(apiError(resp(409, { error: 'X', message: 'Sequenzen geändert' }))).toBe('Sequenzen geändert')
    expect(apiError(resp(400, { problems: [{ template: 'A {0}', params: ['b'], message: 'A b' }] }))).toBe('A b')
  })
  it('Rückfall nur, wenn nichts Besseres da ist', () => {
    expect(apiError(resp(500), 'Speichern fehlgeschlagen')).toBe('Speichern fehlgeschlagen')
    expect(apiError(null, 'x')).toBe('x')
  })
  it('apiDetail liefert das rohe detail für Entscheidungen', () => {
    expect(apiDetail(resp(400, 'BACKUP_PASSWORT_FALSCH'))).toBe('BACKUP_PASSWORT_FALSCH')
    expect(apiDetail({})).toBeUndefined()
  })
})

describe('Quelltext', () => {
  it('rohes response?.data?.detail nur in apiError.js', () => {
    const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const funde = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'apiError.js') {
          if (fs.readFileSync(p, 'utf8').includes('response?.data?.detail')) funde.push(path.relative(SRC, p))
        }
      }
    }
    walk(SRC)
    expect(funde).toEqual([])
  })
})
