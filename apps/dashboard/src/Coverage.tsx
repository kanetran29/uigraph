// The coverage panel: how much of the proven graph is runtime-witnessed (Tier-3
// confirmed) vs static/manual, with the list of unverified edges. Clicking an
// unverified edge selects it on the canvas so the user can see what to confirm.

import type { CoverageReport, GraphEdge, UiGraph } from '@uigraph/core'
import type { Selection } from './GraphCanvas'

/** Props: the coverage report, the graph (to resolve an edge id back to a GraphEdge), and select. */
export interface CoverageProps {
  coverage: CoverageReport
  graph: UiGraph
  onSelect: (selection: Selection) => void
}

/** A labelled count chip (e.g. "must 12"). */
function CountChip(props: { label: string; n: number }): JSX.Element {
  return (
    <span className="cov-chip">
      {props.label} <strong>{props.n}</strong>
    </span>
  )
}

/**
 * Render the coverage panel: a verified/total bar, modality + source breakdowns,
 * and the unverified-edge list. An edge row selects that edge on the canvas.
 */
export function Coverage(props: CoverageProps): JSX.Element {
  const { coverage, graph, onSelect } = props
  // Headline is the HONEST "done" metric (accounted-for); runtime-verified is always
  // co-reported beside it so a parked-heavy graph can never read as "100% verified".
  const accountedPct = Math.round((coverage.accountedRatio ?? coverage.ratio) * 100)
  const runtimePct = Math.round(coverage.runtimeRatio * 100)
  const open = coverage.open ?? coverage.unverified
  const parked = coverage.parked ?? []
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]))
  const selectEdge = (id: string): void => {
    const e: GraphEdge | undefined = edgeById.get(id)
    if (e) onSelect({ kind: 'edge', edge: e })
  }

  return (
    <section className="coverage">
      <h2>Coverage</h2>
      <div className="cov-headline" title={`${coverage.accounted} of ${coverage.total} edges accounted-for (witnessed or parked)`}>
        <div className="cov-bar">
          <div className="cov-bar-fill" style={{ width: `${accountedPct}%` }} />
        </div>
        <span className="cov-pct">
          {accountedPct}% accounted-for <span className="muted">({coverage.accounted ?? coverage.verified}/{coverage.total})</span>
        </span>
      </div>
      <p className="muted cov-sub">
        runtime-verified {runtimePct}% ({coverage.runtimeVerified ?? coverage.verified}/{coverage.total}) · parked {parked.length}
      </p>

      <div className="cov-chips">
        {Object.entries(coverage.bySource).map(([k, n]) => (
          <CountChip key={`s-${k}`} label={k} n={n} />
        ))}
      </div>
      <div className="cov-chips">
        {Object.entries(coverage.byModality).map(([k, n]) => (
          <CountChip key={`m-${k}`} label={k} n={n} />
        ))}
      </div>

      <h3>open ({open.length})</h3>
      {open.length > 0 ? (
        <ul className="cov-list">
          {open.map((e) => (
            <li key={e.id}>
              <button className="cov-row" onClick={() => selectEdge(e.id)} title="select this edge">
                <span className="cov-modality">{e.status ?? e.modality}</span>
                <span className="cov-edge">
                  {e.from} → {e.to}
                </span>
                <span className="cov-event">{e.event}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">100% accounted-for — every edge is witnessed or parked.</p>
      )}

      {parked.length > 0 && (
        <>
          <h3>parked ({parked.length})</h3>
          <ul className="cov-list">
            {parked.map((e) => (
              <li key={e.id}>
                <button className="cov-row" onClick={() => selectEdge(e.id)} title={e.reason ?? 'parked'}>
                  <span className="cov-modality">parked</span>
                  <span className="cov-edge">
                    {e.from} → {e.to}
                  </span>
                  <span className="cov-event">{e.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
