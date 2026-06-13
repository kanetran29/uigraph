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
  const pct = Math.round(coverage.ratio * 100)
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]))
  const selectEdge = (id: string): void => {
    const e: GraphEdge | undefined = edgeById.get(id)
    if (e) onSelect({ kind: 'edge', edge: e })
  }

  return (
    <section className="coverage">
      <h2>Coverage</h2>
      <div className="cov-headline" title={`${coverage.verified} of ${coverage.total} edges runtime-witnessed`}>
        <div className="cov-bar">
          <div className="cov-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="cov-pct">
          {pct}% verified <span className="muted">({coverage.verified}/{coverage.total})</span>
        </span>
      </div>

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

      <h3>unverified ({coverage.unverified.length})</h3>
      {coverage.unverified.length > 0 ? (
        <ul className="cov-list">
          {coverage.unverified.map((e) => (
            <li key={e.id}>
              <button className="cov-row" onClick={() => selectEdge(e.id)} title="select this edge">
                <span className="cov-modality">{e.modality}</span>
                <span className="cov-edge">
                  {e.from} → {e.to}
                </span>
                <span className="cov-event">{e.event}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Every edge is runtime-witnessed.</p>
      )}
    </section>
  )
}
