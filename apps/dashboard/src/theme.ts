// Theme override: 'system' (follow OS), 'light', or 'dark'. The pure helpers below are
// unit-tested; useTheme() applies the choice to <html data-theme> + persists it and
// returns the resolved concrete mode for the React Flow colorMode prop.

import { useEffect, useState } from 'react'
import { readStored, writeStored } from './storage'

export type Theme = 'system' | 'light' | 'dark'
const KEY = 'uigraph.theme'

/** Parse a stored theme value; anything unexpected (incl. null) falls back to 'system'. */
export function parseStoredTheme(raw: string | null): Theme {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/** The concrete mode to render: 'system' resolves against the OS preference. */
export function resolveTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return theme
}

/** The `data-theme` attribute value: undefined for 'system' (attribute removed, OS decides). */
export function resolveThemeAttr(theme: Theme): 'light' | 'dark' | undefined {
  return theme === 'system' ? undefined : theme
}

/**
 * Theme state: persists the choice, writes <html data-theme> ('system' removes it so the
 * prefers-color-scheme media query takes over), and tracks the OS preference live so the
 * resolved mode updates when the system flips while on 'system'. Returns the resolved mode
 * for the canvas colorMode prop.
 */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; resolved: 'light' | 'dark' } {
  const [theme, setThemeState] = useState<Theme>(() => parseStoredTheme(readStored(KEY)))
  const [prefersDark, setPrefersDark] = useState<boolean>(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    const attr = resolveThemeAttr(theme)
    if (attr === undefined) document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', attr)
  }, [theme])

  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const onChange = (e: MediaQueryListEvent): void => setPrefersDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setTheme = (t: Theme): void => {
    setThemeState(t)
    writeStored(KEY, t)
  }
  return { theme, setTheme, resolved: resolveTheme(theme, prefersDark) }
}
