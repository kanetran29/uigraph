// The dashboard root: "Obsidian for the UI graph". On load it fetches the merged
// graph from the serve API, falling back to a bundled sample so a static build
// still renders. It owns the selection and planned-path state, lays out the
// canvas, inspector, and steps panels, and turns manual edits into overlay POSTs
// (source:'manual'), re-fetching the merged graph after each successful write.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { CoverageReport, GraphEdge, GraphNode, Proposals, UiGraph } from '@uigraph/core'
import { EMPTY_PROPOSALS, fetchCoverage, fetchGraph, fetchProposals, fetchScenarios, postOverlay, postScenario, type ScenariosState, type UpdateOp } from './api'
import { searchMatchIds } from './search'
import { GraphCanvas, type Selection } from './GraphCanvas'
import { Logo } from './Logo'
import { Settings } from './Settings'
import { useTheme } from './theme'
import { useT } from './i18n'
import { Coverage } from './Coverage'
import { Plan } from './Plan'
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
  const [coverage, setCoverage] = useState<CoverageReport | null>(null)
  const [scenarios, setScenarios] = useState<ScenariosState>({ active: 'default', names: ['default'] })
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<Selection>(null)
  const [pathEdgeIds, setPathEdgeIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { theme, setTheme, resolved } = useTheme()
  const { t } = useT()

  // Node ids matching the canvas search — dims everything else (selection still wins).
  // Memoized on [graph, search] so it isn't recomputed on unrelated re-renders.
  const matchIds = useMemo(() => (graph ? searchMatchIds(graph.nodes, search) : new Set<string>()), [graph, search])

  const load = useCallback(async () => {
    const [{ graph: g, live: isLive }, props, cov, scen] = await Promise.all([fetchGraph(), fetchProposals(), fetchCoverage(), fetchScenarios()])
    setGraph(g)
    setLive(isLive)
    setProposals(props)
    setCoverage(cov)
    setScenarios(scen)
    setLoading(false)
  }, [])

  // Switch (or create) the active planning scenario, then reload so the merged
  // graph reflects that scenario's overlay.
  const handleSwitchScenario = useCallback(
    async (name: string) => {
      setError(null)
      if (!live) {
        setError('Read-only: serve API not reachable, scenarios need a live project.')
        return
      }
      try {
        await postScenario(name)
        await load()
        setSelection(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [live, load],
  )

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

  const handleEditNode = useCallback(
    (node: GraphNode) => {
      void applyOp({ kind: 'editNode', node })
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

  // Sketch a new screen for a planned feature: a manual screen node in the overlay.
  const handleAddScreen = useCallback(
    (label: string, route: string) => {
      const id = `n_manual_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`
      void applyOp({ kind: 'addNode', node: { id, route: route.length > 0 ? route : null, componentPath: null, label, kind: 'screen' } })
    },
    [applyOp],
  )

  // Export the overlay as a markdown "planned changes" spec for a dev/agent.
  const handleExport = useCallback(async () => {
    try {
      const res = await fetch('/api/plan')
      const body = (await res.json()) as { spec?: string }
      const spec = body.spec ?? '# Planned changes\n\n_unavailable_\n'
      const blob = new Blob([spec], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'uigraph-plan.md'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Export needs a live serve API (uigraph serve).')
    }
  }, [])

  if (loading || graph === null) {
    return <LoadingSkeleton />
  }

  const isEmpty = graph.nodes.length === 0

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <span className={live ? 'status live' : 'status offline'}>{live ? t('status.live') : t('status.offline')}</span>
        <span className="counts">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>
        <input
          type="search"
          className="topbar-search"
          role="searchbox"
          aria-label="Search nodes by label, route, id, or control name"
          placeholder={t('search.placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim().length > 0 ? (
          <span className="search-hint muted" role="status" aria-live="polite">
            {matchIds.size > 0 ? `${matchIds.size} match${matchIds.size > 1 ? 'es' : ''}` : 'no matches'}
          </span>
        ) : null}
        {error ? <span className="error" role="alert">{error}</span> : null}
        <Settings theme={theme} setTheme={setTheme} />
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
                searchMatchIds={matchIds}
                colorMode={resolved}
              />
            </ReactFlowProvider>
          )}
        </main>
        <div className="side">
          <Inspector selection={selection} onEditEdge={handleEditEdge} onEditNode={handleEditNode} onDelete={handleDelete} />
          <Plan live={live} scenarios={scenarios} onAddScreen={handleAddScreen} onExport={handleExport} onSwitchScenario={handleSwitchScenario} />
          <Steps graph={graph} onPathChange={handlePathChange} />
          {coverage ? <Coverage coverage={coverage} graph={graph} onSelect={setSelection} /> : null}
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
        <Logo />
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
