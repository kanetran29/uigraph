// The dashboard root: "Obsidian for the UI graph". On load it fetches the merged
// graph from the serve API, falling back to a bundled sample so a static build
// still renders. It owns the selection and planned-path state, lays out the
// canvas, inspector, and steps panels, and turns manual edits into overlay POSTs
// (source:'manual'), re-fetching the merged graph after each successful write.

import { useCallback, useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { GraphEdge, Proposals, UiGraph } from '@uigraph/core'
import { EMPTY_PROPOSALS, fetchGraph, fetchProposals, postOverlay, type UpdateOp } from './api'
import { GraphCanvas, type Selection } from './GraphCanvas'
import { Inspector } from './Inspector'
import { ProposalsPanel } from './Proposals'
import { Steps } from './Steps'

/** Build a stable manual edge id from its endpoints so repeated adds are idempotent-ish. */
function manualEdgeId(from: string, to: string): string {
  return `e_manual_${from}_${to}`
}

/**
 * Construct a manual GraphEdge for a freshly connected pair. The server forces
 * source:'manual' and strips the witness; we send a may-edge (a manual link is
 * never a proven must) with a placeholder event the user can then edit.
 */
function newManualEdge(from: string, to: string): GraphEdge {
  return {
    id: manualEdgeId(from, to),
    from,
    to,
    event: 'manual',
    guard: null,
    effect: null,
    modality: 'may',
    source: 'manual',
    confidence: 0.5,
  }
}

/** The whole dashboard, wired to the serve API with a sample fallback. */
export function App(): JSX.Element {
  const [graph, setGraph] = useState<UiGraph | null>(null)
  const [proposals, setProposals] = useState<Proposals>(EMPTY_PROPOSALS)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<Selection>(null)
  const [pathEdgeIds, setPathEdgeIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ graph: g, live: isLive }, props] = await Promise.all([fetchGraph(), fetchProposals()])
    setGraph(g)
    setLive(isLive)
    setProposals(props)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const applyOp = useCallback(
    async (op: UpdateOp) => {
      setError(null)
      if (!live) {
        setError('Read-only: serve API not reachable, edits are not persisted.')
        return
      }
      try {
        await postOverlay(op)
        await load()
        setSelection(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [live, load],
  )

  const handleConnect = useCallback(
    (from: string, to: string) => {
      void applyOp({ kind: 'addEdge', edge: newManualEdge(from, to) })
    },
    [applyOp],
  )

  const handleEditEdge = useCallback(
    (edge: GraphEdge, event: string, guard: string | null) => {
      void applyOp({ kind: 'editEdge', edge: { ...edge, event, guard } })
    },
    [applyOp],
  )

  const handleDelete = useCallback(
    (id: string) => {
      void applyOp({ kind: 'remove', id })
    },
    [applyOp],
  )

  const handlePathChange = useCallback((edgeIds: string[]) => {
    setPathEdgeIds(new Set(edgeIds))
  }, [])

  if (loading || graph === null) {
    return <LoadingSkeleton />
  }

  const isEmpty = graph.nodes.length === 0

  return (
    <div className="app">
      <header className="topbar">
        <strong>uigraph</strong>
        <span className={live ? 'status live' : 'status offline'}>{live ? 'live' : 'sample (offline)'}</span>
        <span className="counts">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>
        {error ? <span className="error" role="alert">{error}</span> : null}
      </header>
      {!live ? (
        <div className="banner offline" role="status">
          Serve API unreachable — showing a bundled sample graph. Edits are not persisted. Run{' '}
          <code>uigraph serve</code> to connect a live project.
        </div>
      ) : null}
      <div className="body">
        <main className="canvas">
          {isEmpty ? (
            <EmptyState live={live} />
          ) : (
            <ReactFlowProvider>
              <GraphCanvas
                graph={graph}
                proposals={proposals}
                selection={selection}
                pathEdgeIds={pathEdgeIds}
                onSelect={setSelection}
                onConnect={handleConnect}
              />
            </ReactFlowProvider>
          )}
        </main>
        <div className="side">
          <Inspector selection={selection} onEditEdge={handleEditEdge} onDelete={handleDelete} />
          <Steps graph={graph} onPathChange={handlePathChange} />
          <ProposalsPanel
            proposals={proposals}
            graph={graph}
            selection={selection}
            onClearFilter={() => setSelection(null)}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * The initial fetch placeholder: a structural skeleton of the topbar, canvas, and
 * right rail rather than a bare spinner, so the layout is stable when data lands.
 */
function LoadingSkeleton(): JSX.Element {
  return (
    <div className="app" aria-busy="true" aria-label="Loading graph">
      <header className="topbar">
        <strong>uigraph</strong>
        <span className="skeleton skeleton-pill" />
        <span className="skeleton skeleton-text" />
      </header>
      <div className="body">
        <main className="canvas skeleton-canvas">
          <div className="skeleton skeleton-node" />
          <div className="skeleton skeleton-node" />
          <div className="skeleton skeleton-node" />
        </main>
        <div className="side">
          <div className="skeleton-panel">
            <span className="skeleton skeleton-heading" />
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
          </div>
          <div className="skeleton-panel">
            <span className="skeleton skeleton-heading" />
            <span className="skeleton skeleton-line" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Shown when the loaded graph has zero nodes: explains the likely cause per connection state. */
function EmptyState(props: { live: boolean }): JSX.Element {
  return (
    <div className="empty-state">
      <h2>No nodes in this graph</h2>
      <p className="muted">
        {props.live
          ? 'The serve API returned an empty graph. Extract a project (e.g. uigraph extract) so there is something to show.'
          : 'The bundled sample is empty. Connect a live project with uigraph serve to load a real graph.'}
      </p>
    </div>
  )
}
