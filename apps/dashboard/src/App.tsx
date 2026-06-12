// The dashboard root: "Obsidian for the UI graph". On load it fetches the merged
// graph from the serve API, falling back to a bundled sample so a static build
// still renders. It owns the selection and planned-path state, lays out the
// canvas, inspector, and steps panels, and turns manual edits into overlay POSTs
// (source:'manual'), re-fetching the merged graph after each successful write.

import { useCallback, useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { GraphEdge, UiGraph } from '@uigraph/core'
import { fetchGraph, postOverlay, type UpdateOp } from './api'
import { GraphCanvas, type Selection } from './GraphCanvas'
import { Inspector } from './Inspector'
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
  const [live, setLive] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [pathEdgeIds, setPathEdgeIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { graph: g, live: isLive } = await fetchGraph()
    setGraph(g)
    setLive(isLive)
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

  if (graph === null) {
    return <div className="loading">Loading graph…</div>
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>uigraph</strong>
        <span className={live ? 'status live' : 'status offline'}>{live ? 'live' : 'sample (offline)'}</span>
        <span className="counts">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>
        {error ? <span className="error">{error}</span> : null}
      </header>
      <div className="body">
        <main className="canvas">
          <ReactFlowProvider>
            <GraphCanvas
              graph={graph}
              selection={selection}
              pathEdgeIds={pathEdgeIds}
              onSelect={setSelection}
              onConnect={handleConnect}
            />
          </ReactFlowProvider>
        </main>
        <div className="side">
          <Inspector selection={selection} onEditEdge={handleEditEdge} onDelete={handleDelete} />
          <Steps graph={graph} onPathChange={handlePathChange} />
        </div>
      </div>
    </div>
  )
}
