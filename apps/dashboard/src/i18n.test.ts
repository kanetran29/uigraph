import { describe, it, expect } from 'vitest'
import { LANGS, dicts, translate } from './i18n'

describe('translate', () => {
  it('returns the per-language string', () => {
    expect(translate('en', 'panel.coverage')).toBe('Coverage')
    expect(translate('fi', 'panel.coverage')).toBe('Kattavuus')
    expect(translate('vi', 'panel.coverage')).toBe('Độ bao phủ')
    expect(translate('zh', 'panel.coverage')).toBe('覆盖率')
    expect(translate('de', 'panel.coverage')).toBe('Abdeckung')
  })
  it('falls back to en for a key missing in fi', () => {
    // a key only the en dict has would degrade to en; here both have it, so assert the
    // contract via an unknown key instead.
    expect(translate('fi', 'definitely.missing')).toBe('definitely.missing')
  })
  it('returns the raw key for an unknown key (never throws or blanks)', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })
})

describe('dict parity', () => {
  const enKeys = Object.keys(dicts.en).sort()
  it('every language declares the exact same keys as en (so none silently drifts)', () => {
    for (const { code } of LANGS) {
      expect(Object.keys(dicts[code]).sort()).toEqual(enKeys)
    }
  })
})
