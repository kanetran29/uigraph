import { describe, it, expect } from 'vitest'
import { parseStoredTheme, resolveTheme, resolveThemeAttr } from './theme'

describe('parseStoredTheme', () => {
  it('keeps a valid stored theme', () => {
    expect(parseStoredTheme('light')).toBe('light')
    expect(parseStoredTheme('dark')).toBe('dark')
    expect(parseStoredTheme('system')).toBe('system')
  })
  it('falls back to system for null/garbage', () => {
    expect(parseStoredTheme(null)).toBe('system')
    expect(parseStoredTheme('purple')).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('resolves system against the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
  it('an explicit choice ignores the OS preference', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('resolveThemeAttr', () => {
  it('removes the attribute for system, sets it for explicit', () => {
    expect(resolveThemeAttr('system')).toBeUndefined()
    expect(resolveThemeAttr('light')).toBe('light')
    expect(resolveThemeAttr('dark')).toBe('dark')
  })
})
