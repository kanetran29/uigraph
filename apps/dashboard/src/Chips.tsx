// Shared filter-chip primitives for the right-panel list filters (Proposals, Coverage).
// A chip set with nothing selected means "all" (the matchX predicates pass-through).

/** Return a new Set with `value` toggled in or out — for the filter chip rows. */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/** A toggle chip, pressed (filtering-on) when `active`. */
export function FilterChip(props: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className={props.active ? 'filter-chip active' : 'filter-chip'} aria-pressed={props.active} onClick={props.onClick}>
      {props.label}
    </button>
  )
}
