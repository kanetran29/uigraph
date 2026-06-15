// Topbar settings popover: theme (system/light/dark) + language. Non-modal (role=dialog,
// no focus trap) — closes on Escape (returns focus to the gear), outside pointerdown, or
// re-clicking the gear. App owns theme; language comes from the i18n context.

import { useEffect, useRef, useState } from 'react'
import { LANGS, useT, type Lang } from './i18n'
import type { Theme } from './theme'

const THEMES: Theme[] = ['system', 'light', 'dark']

/** The gear button + its settings popover. */
export function Settings(props: { theme: Theme; setTheme: (t: Theme) => void }): JSX.Element {
  const { theme, setTheme } = props
  const { lang, setLang, t } = useT()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const gearRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        gearRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="settings" ref={wrapRef}>
      <button
        ref={gearRef}
        type="button"
        className="settings-gear"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="settings-menu"
        aria-label={t('settings.title')}
        onClick={() => setOpen((v) => !v)}
      >
        ⚙
      </button>
      {open ? (
        <div id="settings-menu" role="dialog" aria-label={t('settings.title')} className="settings-popover">
          <div className="settings-row" role="radiogroup" aria-label={t('settings.theme')}>
            <span className="settings-label">{t('settings.theme')}</span>
            <div className="settings-segments">
              {THEMES.map((th) => (
                <button key={th} type="button" role="radio" aria-checked={theme === th} className={theme === th ? 'seg active' : 'seg'} onClick={() => setTheme(th)}>
                  {t(`theme.${th}`)}
                </button>
              ))}
            </div>
          </div>
          <label className="settings-row">
            <span className="settings-label">{t('settings.language')}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  )
}
