import { describe, it, expect } from 'vitest'
import { ISO_639_1, requestState, requestableLanguages, languageName } from './requestable'
import { PACKS } from './catalog'

describe('Sprache anfragen', () => {
  it('vorhandene Sprachen sind nicht anfragbar', () => {
    expect(requestState('de').state).toBe('exists')
    expect(requestState('zh-CN').state).toBe('exists')
  })

  it('ähnliche Sprachen (gleiche Grundsprache) auch nicht', () => {
    expect(requestState('zh').state).toBe('exists')          // Alias von zh-cn
    expect(requestState('pt-br')).toEqual({ state: 'ok', pack: null })
    expect(requestState('zh-tw')).toEqual({ state: 'similar', pack: PACKS.find(p => p.code === 'zh-cn') })
    expect(requestState('en-us').state).toBe('similar')
  })

  it('neue Sprache ist anfragbar', () => {
    expect(requestState('fr')).toEqual({ state: 'ok', pack: null })
  })

  it('die Auswahl enthält keine vorhandene oder ähnliche Sprache', () => {
    const codes = requestableLanguages('en').map(l => l.code)
    for (const c of ['de', 'en', 'zh']) expect(codes).not.toContain(c)
    expect(codes).toContain('fr')
    expect(codes.length).toBe(ISO_639_1.length - 3)
    expect(new Set(ISO_639_1).size).toBe(ISO_639_1.length)
  })

  it('Namen in der Sprache der Oberfläche', () => {
    expect(languageName('fr', 'de-DE')).toBe('Französisch')
    expect(languageName('fr', 'en-GB')).toBe('French')
  })
})
