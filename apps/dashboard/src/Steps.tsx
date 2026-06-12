// The steps panel: pick a from-node and a to-node, run the core planPath over the
// loaded graph (browser-safe — imported from @uigraph/core, never @uigraph/core/node),
// and list the ordered legs. Reporting the path's edge ids upward lets the canvas
// highlight the route.

import { useEffect, useMemo, useState } from 'react'
import { planPath, type PlanStep } from '@uigraph/core'
import type { UiGraph } from '@uigraph/core'

/** Props for the steps panel: the graph to plan over and a path-change reporter. */
export interface StepsProps {
  graph: UiGraph
  onPathChange: (edgeIds: string[]) => void
}

/**
 * Render the from/to selectors and the planned route. Recomputes the path with
 * core planPath whenever the endpoints or graph change, lists each ordered step
 * (event, guard, modality), and reports the path's edge ids so the canvas can
 * highlight them. Shows a clear "no path" message when the target is unreachable.
 */
export function Steps(props: StepsProps): JSX.Element {
  const { graph, onPathChange } = props
  const first = graph.nodes[0]?.id ?? ''
  const last = graph.nodes[graph.nodes.length - 1]?.id ?? first
  const [from, setFrom] = useState(first)
  const [to, setTo] = useState(last)

  const path = useMemo<PlanStep[] | null>(() => {
    if (from === '' || to === '') return null
    return planPath(graph, from, to)
  }, [graph, from, to])

  const pathKey = path ? path.map((s) => s.edge.id).join(',') : ''
  useEffect(() => {
    onPathChange(pathKey === '' ? [] : pathKey.split(','))
  }, [pathKey, onPathChange])

  return (
    <section className="steps">
      <h2>Plan path</h2>
      <div className="steps-controls">
        <label>
          <span>from</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>to</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {path === null ? (
        <p className="muted">No path under any modality.</p>
      ) : path.length === 0 ? (
        <p className="muted">Start and target are the same node.</p>
      ) : (
        <ol className="steps-list">
          {path.map((s, i) => (
            <li key={s.edge.id}>
              <span className="step-index">{i + 1}.</span> {s.from.label} → {s.to.label}
              <span className="step-meta">
                {s.edge.event}
                {s.edge.guard ? ` [${s.edge.guard}]` : ''} · {s.edge.modality}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
