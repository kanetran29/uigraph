// The verify worklist panel: what a Tier-3 runner (or a human) should confirm
// next. Derived entirely client-side from data the dashboard already has, via the
// core's pure nextToVerify ranking: stale-witnessed runtime edges (re-queued —
// their witness predates the last re-map) and dynamic targets, then may edges,
// then proposed transitions, minus anything fresh-runtime-witnessed or parked.
// Clicking a row selects the edge (or, for a proposal, its source screen).

import { useMemo } from 'react'
import type { CoverageReport, GraphEdge, Proposals, UiGraph, VerifyTarget } from '@ui-graph/core'
import { materializeProposalGraph, nextToVerify } from '@ui-graph/core'
import { CollapsibleSection } from './CollapsibleSection'
import { useT } from './i18n'
import type { Selection } from './GraphCanvas'

/** How many worklist rows render before collapsing into a "+N more" line. */
const VISIBLE_LIMIT = 10

/** Props: the graph + proposals to derive the worklist from, coverage (for parked ids), and select. */
export interface VerifyPanelProps {
  graph: UiGraph
  proposals: Proposals
  coverage: CoverageReport | null
  onSelect: (selection: Selection) => void
}

/** The short row tag for a target, read off the underlying edge: a re-queued stale
 *  witness, a dynamic (unknown-target) edge, a conditional may edge, or a proposal. */
function targetTag(t: VerifyTarget, edgeById: ReadonlyMap<string, GraphEdge>): string {
  if (t.kind === 'proposal') return 'proposed'
  const edge = edgeById.get(t.id)
  if (edge?.source === 'runtime') return 'stale'
  if (edge?.modality === 'unknown') return 'dynamic'
  return 'may'
}

/**
 * Render the "next to verify" worklist: ranked open/uncertain transitions with the
 * reason each needs confirming, capped at VISIBLE_LIMIT rows (the full open set
 * lives in Coverage). Empty when every edge is witnessed or parked.
 */
export function VerifyPanel(props: VerifyPanelProps): JSX.Element {
  const { graph, proposals, coverage, onSelect } = props
  const { t } = useT()

  const targets = useMemo(() => {
    const parkedIds = new Set((coverage?.parked ?? []).map((p) => p.id))
    const proposalGraph = materializeProposalGraph(graph, proposals.proposals)
    const limit = graph.edges.length + proposalGraph.edges.length
    return nextToVerify(graph, proposalGraph, limit, parkedIds)
  }, [graph, proposals, coverage])

  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph])
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])

  /** Focus a target on the canvas: the edge itself, or the source screen for a proposal. */
  const select = (target: VerifyTarget): void => {
    if (target.kind === 'edge') {
      const edge = edgeById.get(target.id)
      if (edge) onSelect({ kind: 'edge', edge })
      return
    }
    const node = nodeById.get(target.from)
    if (node) onSelect({ kind: 'node', node })
  }

  const visible = targets.slice(0, VISIBLE_LIMIT)

  return (
    <CollapsibleSection id="verify" className="verify" title={`${t('panel.verify')} (${targets.length})`}>
      {targets.length === 0 ? (
        <p className="muted">Nothing to verify — every transition is runtime-witnessed or parked.</p>
      ) : (
        <>
          <ul className="cov-list">
            {visible.map((target) => (
              <li key={`${target.kind}_${target.id}`}>
                <button className="cov-row cov-row--stacked" onClick={() => select(target)} title={target.reason}>
                  <span className="cov-row-head">
                    <span className="cov-modality">{targetTag(target, edgeById)}</span>
                    <span className="cov-edge">
                      {target.from} → {target.to}
                    </span>
                    <span className="cov-event">{target.event}</span>
                  </span>
                  <span className="cov-reason">{target.reason}</span>
                </button>
              </li>
            ))}
          </ul>
          {targets.length > visible.length ? (
            <p className="muted">+{targets.length - visible.length} more — the full open set is in Coverage.</p>
          ) : null}
          <p className="muted">
            Confirm with <code className="inline-code">uigraph verify</code> or the agent loop — a confirmation
            needs proof (URL change, dialog, or screenshot).
          </p>
        </>
      )}
    </CollapsibleSection>
  )
}
