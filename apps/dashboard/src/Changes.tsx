// The "Changes since last map" panel: what the latest re-map did to the proven UI graph
// (current base vs the previous map). It answers "what did my code change do to the graph?"
// Added/changed nodes+edges resolve in the current graph and select on click; removed ones
// are not in the rendered graph, so they show dimmed and non-navigable. Base-graph only —
// never overlay/proposals. It reads the same SinceLastDiff the CLI and MCP tool return.

import type { GraphEdge, GraphNode, UiGraph } from '@uigraph/core'
import { CollapsibleSection } from './CollapsibleSection'
import { useT } from './i18n'
import type { Selection } from './GraphCanvas'
import type { ChangesState } from './api'

/** Props: the since-last diff, the current graph (to resolve ids for selection), and select. */
export interface ChangesProps {
  changes: ChangesState
  graph: UiGraph
  onSelect: (selection: Selection) => void
}

/** A labelled count chip (e.g. "+2 edges"); muted when zero so the eye skips it. */
function CountChip(props: { label: string; n: number }): JSX.Element {
  return (
    <span className={props.n > 0 ? 'cov-chip' : 'cov-chip muted'}>
      {props.label} <strong>{props.n}</strong>
    </span>
  )
}

/**
 * Render the changes panel across the three SinceLastDiff states: no-current (never mapped /
 * offline), no-prior (only one map yet), and ok (a real delta — possibly empty).
 */
export function Changes(props: ChangesProps): JSX.Element {
  const { changes, graph, onSelect } = props
  const { t } = useT()
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]))
  const selectNode = (n: GraphNode): void => {
    const live = nodeById.get(n.id)
    if (live) onSelect({ kind: 'node', node: live })
  }
  const selectEdge = (e: GraphEdge): void => {
    const live = edgeById.get(e.id)
    if (live) onSelect({ kind: 'edge', edge: live })
  }

  return (
    <CollapsibleSection id="changes" className="changes" title={t('panel.changes')}>
      {changes.state !== 'ok' ? (
        <p className="muted">
          {changes.state === 'no-prior'
            ? 'Only one map so far — re-map after a code change to see what it did to the UI graph.'
            : 'No map yet. Run uigraph map to extract a graph, then re-map after a change to see the delta.'}
        </p>
      ) : (
        <ChangesBody diff={changes.diff!} prevMappedAt={changes.previousMappedAt} mappedAt={changes.currentMappedAt} selectNode={selectNode} selectEdge={selectEdge} nodeById={nodeById} edgeById={edgeById} />
      )}
    </CollapsibleSection>
  )
}

/** The 'ok'-state body: timestamps, counts, and the added/removed/changed lists. */
function ChangesBody(props: {
  diff: NonNullable<ChangesState['diff']>
  prevMappedAt: string | null
  mappedAt: string | null
  selectNode: (n: GraphNode) => void
  selectEdge: (e: GraphEdge) => void
  nodeById: Map<string, GraphNode>
  edgeById: Map<string, GraphEdge>
}): JSX.Element {
  const { diff, prevMappedAt, mappedAt, selectNode, selectEdge, nodeById, edgeById } = props
  // changedNodes is defensive against an older serve that predates it.
  const changedNodes = diff.changedNodes ?? []
  const total =
    diff.addedNodes.length + diff.removedNodes.length + changedNodes.length + diff.addedEdges.length + diff.removedEdges.length + diff.changedEdges.length

  return (
    <>
      <p className="muted cov-sub">
        previous {prevMappedAt ?? 'unknown'} → current {mappedAt ?? 'unknown'}
      </p>
      {total === 0 ? (
        <p className="muted">No changes to the proven UI graph since the last map.</p>
      ) : (
        <>
          <div className="cov-chips">
            <CountChip label="+nodes" n={diff.addedNodes.length} />
            <CountChip label="−nodes" n={diff.removedNodes.length} />
            <CountChip label="~nodes" n={changedNodes.length} />
            <CountChip label="+edges" n={diff.addedEdges.length} />
            <CountChip label="−edges" n={diff.removedEdges.length} />
            <CountChip label="~edges" n={diff.changedEdges.length} />
          </div>

          {changedNodes.length > 0 ? (
            <>
              <h3>changed screens ({changedNodes.length})</h3>
              <ul className="cov-list">
                {changedNodes.map((c) => (
                  <li key={`cn-${c.id}`}>
                    <button className="cov-row cov-row--stacked" onClick={() => selectNode(c.after)} disabled={!nodeById.has(c.id)} title="select this screen">
                      <span className="cov-row-head">
                        <span className="cov-modality">~screen</span>
                        <span className="cov-edge">
                          {c.fields.includes('label') ? (
                            <>
                              <span className="diff-old">{c.before.label}</span> → <span className="diff-new">{c.after.label}</span>
                            </>
                          ) : (
                            c.after.label
                          )}
                        </span>
                      </span>
                      <span className="cov-chips">
                        {c.fields.map((f) => (
                          <span key={f} className="cov-chip">{f}</span>
                        ))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {diff.addedNodes.length + diff.addedEdges.length > 0 ? (
            <>
              <h3>added ({diff.addedNodes.length + diff.addedEdges.length})</h3>
              <ul className="cov-list">
                {diff.addedNodes.map((n) => (
                  <li key={`an-${n.id}`}>
                    <button className="cov-row" onClick={() => selectNode(n)} title="select this screen">
                      <span className="cov-modality">+screen</span>
                      <span className="cov-edge">{n.label}</span>
                    </button>
                  </li>
                ))}
                {diff.addedEdges.map((e) => (
                  <li key={`ae-${e.id}`}>
                    <button className="cov-row" onClick={() => selectEdge(e)} title="select this transition">
                      <span className="cov-modality">+edge</span>
                      <span className="cov-edge">{e.from} → {e.to}</span>
                      <span className="cov-event">{e.event}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {diff.removedNodes.length + diff.removedEdges.length > 0 ? (
            <>
              <h3>removed ({diff.removedNodes.length + diff.removedEdges.length})</h3>
              <ul className="cov-list">
                {diff.removedNodes.map((n) => (
                  <li key={`rn-${n.id}`} className="cov-removed">
                    <span className="cov-row cov-row--dim" title="no longer in the current graph">
                      <span className="cov-modality">−screen</span>
                      <span className="cov-edge">{n.label}</span>
                    </span>
                  </li>
                ))}
                {diff.removedEdges.map((e) => (
                  <li key={`re-${e.id}`} className="cov-removed">
                    <span className="cov-row cov-row--dim" title="no longer in the current graph">
                      <span className="cov-modality">−edge</span>
                      <span className="cov-edge">{e.from} → {e.to}</span>
                      <span className="cov-event">{e.event}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {diff.changedEdges.length > 0 ? (
            <>
              <h3>changed edges ({diff.changedEdges.length})</h3>
              <ul className="cov-list">
                {diff.changedEdges.map((c) => {
                  const live = edgeById.get(c.id) ?? nodeById.get(c.id)
                  return (
                    <li key={`ce-${c.id}`}>
                      <button className="cov-row cov-row--stacked" onClick={() => selectEdge(c.after)} disabled={!live} title="select this transition">
                        <span className="cov-row-head">
                          <span className="cov-modality">~edge</span>
                          <span className="cov-edge">{c.after.from} → {c.after.to}</span>
                        </span>
                        <span className="cov-chips">
                          {c.fields.map((f) => (
                            <span key={f} className="cov-chip">{f}</span>
                          ))}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
        </>
      )}
    </>
  )
}
