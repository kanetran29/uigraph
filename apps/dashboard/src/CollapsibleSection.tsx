// A shared right-rail panel wrapper that adds a persisted collapse/expand toggle on the
// section header. The body is HIDDEN (native `hidden`), never unmounted, so a panel's
// local state — Coverage filter chips, Steps from/to, Inspector edit drafts, open
// Proposals rows — survives a collapse/expand. Adopted by all five rail panels so the
// button + aria + caret + localStorage logic lives in one place (DRY across 5 real uses).

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

const KEY_PREFIX = 'uigraph.section.'

/** Parse a persisted collapse value: only '1' is open; an absent key uses the fallback,
 *  and any other value reads as closed (so a future value format can't force-open). */
export function parseStored(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback
  return raw === '1'
}

/** Open/closed state for a section id, persisted under `uigraph.section.<id>`; resilient
 *  to localStorage being unavailable (private mode / quota) by falling back without throwing. */
function useCollapsed(id: string, fallback: boolean): [boolean, Dispatch<SetStateAction<boolean>>] {
  const key = KEY_PREFIX + id
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return parseStored(localStorage.getItem(key), fallback)
    } catch {
      return fallback
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, open ? '1' : '0')
    } catch {
      // localStorage unavailable — collapse still works for the session, just not persisted.
    }
  }, [key, open])
  return [open, setOpen]
}

/** Props for a collapsible rail section. `title` is a ReactNode (may carry a badge) but must
 *  NOT contain interactive controls — those go in `headerExtra` to avoid a button-in-button. */
export interface CollapsibleSectionProps {
  id: string
  title: ReactNode
  defaultOpen?: boolean
  className?: string
  headerExtra?: ReactNode
  children: ReactNode
}

/** A rail panel section whose header toggles its body open/closed (persisted per id). */
export function CollapsibleSection(props: CollapsibleSectionProps): JSX.Element {
  const { id, title, defaultOpen = true, className, headerExtra, children } = props
  const [open, setOpen] = useCollapsed(id, defaultOpen)
  const bodyId = `sec-${id}`
  return (
    <section className={className ? `panel-section ${className}` : 'panel-section'}>
      <div className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
          <span className="section-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <h2>{title}</h2>
        </button>
        {headerExtra ? <div className="section-extra">{headerExtra}</div> : null}
      </div>
      <div id={bodyId} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}
