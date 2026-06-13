// The proposals panel: renders the quarantined Tier-2 proposals sidecar as a
// read-only, AI-and-human navigable list. Proposals are grouped by screen (using
// the graph node label when available, 'app' shown as "Global") and then by
// category. Each row carries a category chip, an evidenced/speculative badge, a
// confidence bar, and an expand-to-read rationale with the compact event/effect/to.
// When a graph node is selected the panel filters to that screen plus 'app' so the
// proposals stay in lock-step with the canvas selection.

import { useMemo, useState } from 'react'
import type { Proposal, Proposals, UiGraph } from '@uigraph/core'
import type { Selection } from './GraphCanvas'

/** Props for the proposals panel: the sidecar, the graph (for screen labels), and the selection. */
export interface ProposalsPanelProps {
  proposals: Proposals
  graph: UiGraph
  selection: Selection
  onClearFilter: () => void
}

/** The screen id 'app' denotes a global (non-screen-scoped) proposal, shown as "Global". */
const GLOBAL_SCREEN = 'app'

/**
 * Resolve a screen id to a human label: the graph node's label when the id is a real
 * node, "Global" for the 'app' sentinel, else the raw id (e.g. a token that has no node).
 */
function screenLabel(screen: string, labels: Map<string, string>): string {
  if (screen === GLOBAL_SCREEN) return 'Global'
  return labels.get(screen) ?? screen
}

/**
 * Build a screen-id → node-label lookup so both the panel grouping and any rendered
 * `to` target can show the friendly label instead of an opaque node id.
 */
function nodeLabels(graph: UiGraph): Map<string, string> {
  const labels = new Map<string, string>()
  for (const n of graph.nodes) labels.set(n.id, n.label)
  return labels
}

/** A category chip: a small monospace tag that reads as the proposal's category. */
function CategoryChip(props: { category: string }): JSX.Element {
  return <span className="prop-chip">{props.category}</span>
}

/** The evidenced/speculative badge, green when grounded in source and amber when a guess. */
function EvidenceBadge(props: { evidenced: boolean }): JSX.Element {
  return (
    <span className={props.evidenced ? 'prop-badge evidenced' : 'prop-badge speculative'}>
      {props.evidenced ? 'evidenced' : 'speculative'}
    </span>
  )
}

/** A tiny confidence bar plus percent, filled in proportion to the proposal's confidence. */
function ConfidenceBar(props: { confidence: number }): JSX.Element {
  const pct = Math.round(Math.max(0, Math.min(1, props.confidence)) * 100)
  return (
    <div className="prop-conf" title={`confidence ${pct}%`}>
      <div className="prop-conf-track">
        <div className="prop-conf-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="prop-conf-pct">{pct}%</span>
    </div>
  )
}

/**
 * Compose the compact event → to · effect meta line for a proposal, using the friendly
 * screen label for a `to` that resolves to a real node and leaving tokens (e.g. '<modal>')
 * as-is. Returns null when the proposal carries none of these fields.
 */
function metaLine(p: Proposal, labels: Map<string, string>): string | null {
  const parts: string[] = []
  if (p.event) parts.push(p.event)
  if (p.to) parts.push(`→ ${labels.get(p.to) ?? p.to}`)
  if (p.effect) parts.push(p.effect)
  if (p.guard) parts.push(`[${p.guard}]`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Render text with `backtick`-quoted spans as inline <code>, plain text otherwise. */
function withInlineCode(text: string): JSX.Element {
  const parts = text.split('`')
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <code key={i} className="inline-code">{part}</code> : <span key={i}>{part}</span>))}
    </>
  )
}

/** A single expandable proposal row; the rationale is revealed on click. */
function ProposalRow(props: { proposal: Proposal; labels: Map<string, string> }): JSX.Element {
  const { proposal, labels } = props
  const [open, setOpen] = useState(false)
  const meta = metaLine(proposal, labels)
  return (
    <li className="prop-row">
      <button className="prop-row-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="prop-caret">{open ? '▾' : '▸'}</span>
        <CategoryChip category={proposal.category} />
        <span className="prop-title">{proposal.title}</span>
        <EvidenceBadge evidenced={proposal.evidenced} />
      </button>
      <ConfidenceBar confidence={proposal.confidence} />
      {meta ? <code className="prop-code">{meta}</code> : null}
      {open ? <p className="prop-rationale">{withInlineCode(proposal.rationale)}</p> : null}
      {open && proposal.screenshot ? (
        <img className="prop-shot" src={`/api/${proposal.screenshot}`} alt={`${proposal.screen} screen`} loading="lazy" />
      ) : null}
    </li>
  )
}

/** A category group: a small heading and its proposal rows. */
function CategoryGroup(props: { category: string; items: Proposal[]; labels: Map<string, string> }): JSX.Element {
  const { category, items, labels } = props
  return (
    <div className="prop-category">
      <h4 className="prop-category-head">
        {category} <span className="prop-count">{items.length}</span>
      </h4>
      <ul className="prop-list">
        {items.map((p) => (
          <ProposalRow key={p.id} proposal={p} labels={labels} />
        ))}
      </ul>
    </div>
  )
}

/** A screen group: the screen's friendly label and its per-category subgroups. */
function ScreenGroup(props: { screen: string; items: Proposal[]; labels: Map<string, string> }): JSX.Element {
  const { screen, items, labels } = props
  const byCategory = useMemo(() => groupBy(items, (p) => p.category), [items])
  return (
    <section className="prop-screen">
      <h3 className="prop-screen-head">{screenLabel(screen, labels)}</h3>
      {[...byCategory.entries()].map(([category, group]) => (
        <CategoryGroup key={category} category={category} items={group} labels={labels} />
      ))}
    </section>
  )
}

/** Group a list into an insertion-ordered Map keyed by the chosen field. */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = out.get(k)
    if (bucket) bucket.push(item)
    else out.set(k, [item])
  }
  return out
}

/**
 * The proposals panel. Shows a header with the visible count, a legend, and an
 * active-filter affordance when a node selection narrows the list to that screen
 * (plus 'app' globals). Proposals are grouped by screen then category. Read-only.
 */
export function ProposalsPanel(props: ProposalsPanelProps): JSX.Element {
  const { proposals, graph, selection, onClearFilter } = props
  const labels = useMemo(() => nodeLabels(graph), [graph])
  const filterScreen = selection?.kind === 'node' ? selection.node.id : null

  const visible = useMemo(() => {
    if (filterScreen === null) return proposals.proposals
    return proposals.proposals.filter((p) => p.screen === filterScreen || p.screen === GLOBAL_SCREEN)
  }, [proposals.proposals, filterScreen])

  const byScreen = useMemo(() => groupBy(visible, (p) => p.screen), [visible])

  return (
    <section className="proposals">
      <h2>Proposals ({visible.length})</h2>
      <div className="prop-legend">
        <span className="prop-badge evidenced">evidenced</span>
        <span className="prop-badge speculative">speculative</span>
      </div>
      {filterScreen !== null ? (
        <div className="prop-filter">
          <span>
            filtered to <strong>{screenLabel(filterScreen, labels)}</strong> + Global
          </span>
          <button className="prop-clear" onClick={onClearFilter}>
            clear filter
          </button>
        </div>
      ) : null}
      {visible.length === 0 ? (
        <p className="muted">
          {proposals.proposals.length === 0 ? 'No proposals.' : 'No proposals for this screen.'}
        </p>
      ) : (
        [...byScreen.entries()].map(([screen, items]) => (
          <ScreenGroup key={screen} screen={screen} items={items} labels={labels} />
        ))
      )}
    </section>
  )
}
