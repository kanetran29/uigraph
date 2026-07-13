// The dashboard root: "Obsidian for the UI graph". On load it fetches the merged
// graph from the serve API, falling back to a bundled sample so a static build
// still renders. Viewer-grade: it owns the selection and planned-path state and
// lays out the canvas, inspector, and read panels — editing, scenarios, and e2e
// suite generation live in uigraph studio.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { CoverageReport, Proposals, UiGraph } from '@uigraph/core'
import { EMPTY_CHANGES, EMPTY_PROPOSALS, UNKNOWN_FRESHNESS, fetchChanges, fetchCoverage, fetchFreshness, fetchGraph, fetchProposals, fetchWorkspaces, type ChangesState, type FreshnessState, type WorkspaceSummary } from './api'
import { readStored, writeStored } from './storage'
import { searchMatchIds } from './search'
import { GraphCanvas, type DiffHighlight, type Selection } from './GraphCanvas'
import { Logo } from './Logo'
import { Settings } from './Settings'
import { useTheme } from './theme'
import { useT } from './i18n'
import { Coverage } from './Coverage'
import { Changes } from './Changes'
import { Inspector } from './Inspector'
import { ProposalsPanel } from './Proposals'
import { Steps } from './Steps'
import { VerifyPanel } from './Verify'

/** The whole dashboard, wired to the serve API with a sample fallback. */
export function App(): JSX.Element {
  const [graph, setGraph] = useState<UiGraph | null>(null)
  const [proposals, setProposals] = useState<Proposals>(EMPTY_PROPOSALS)
  const [coverage, setCoverage] = useState<CoverageReport | null>(null)
  const [changes, setChanges] = useState<ChangesState>(EMPTY_CHANGES)
  const [freshness, setFreshness] = useState<FreshnessState>(UNKNOWN_FRESHNESS)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState<Selection>(null)
  const [pathEdgeIds, setPathEdgeIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [activeWs, setActiveWs] = useState<string | null>(() => readStored('uigraph.activeWorkspace'))
  const { theme, setTheme, resolved } = useTheme()
  const { t } = useT()

  // Node ids matching the canvas search — dims everything else (selection still wins).
  // Memoized on [graph, search] so it isn't recomputed on unrelated re-renders.
  const matchIds = useMemo(() => (graph ? searchMatchIds(graph.nodes, search) : new Set<string>()), [graph, search])

  // The since-last-map delta projected onto the current graph (added/changed only — removed
  // elements aren't on the canvas). Null unless there is a real delta, so the canvas toggle hides.
  const diffHighlight = useMemo<DiffHighlight | null>(() => {
    if (changes.state !== 'ok' || !changes.diff) return null
    const d = changes.diff
    // changedNodes is defensive against an older serve that predates it (offline-safe contract).
    const changedNodes = d.changedNodes ?? []
    const renameById = new Map<string, { before: string; after: string }>()
    for (const c of changedNodes) if (c.fields.includes('label')) renameById.set(c.id, { before: c.before.label, after: c.after.label })
    return {
      addedNodeIds: new Set(d.addedNodes.map((n) => n.id)),
      addedEdgeIds: new Set(d.addedEdges.map((e) => e.id)),
      changedEdgeIds: new Set(d.changedEdges.map((c) => c.id)),
      changedNodeIds: new Set(changedNodes.map((c) => c.id)),
      renameById,
      removedNodes: d.removedNodes,
      removedEdges: d.removedEdges,
    }
  }, [changes])

  // Load the registry once + reconcile the active workspace: keep a valid stored id, else
  // fall back to the first one. Empty list = single-workspace (or offline) — activeWs null.
  const reconcileWorkspaces = useCallback(async () => {
    const list = await fetchWorkspaces()
    setWorkspaces(list)
    setActiveWs((prev) => {
      if (list.length === 0) return null
      const next = prev && list.some((w) => w.id === prev) ? prev : (list.find((w) => w.available)?.id ?? list[0]!.id)
      writeStored('uigraph.activeWorkspace', next)
      return next
    })
  }, [])

  const load = useCallback(async (ws: string | null) => {
    const [{ graph: g, live: isLive }, props, cov, chg, fresh] = await Promise.all([fetchGraph(ws), fetchProposals(ws), fetchCoverage(ws), fetchChanges(ws), fetchFreshness(ws)])
    setGraph(g)
    setLive(isLive)
    setProposals(props)
    setCoverage(cov)
    setChanges(chg)
    setFreshness(fresh)
    setLoading(false)
  }, [])

  // Switch the active project: reset the focused view, persist, and let the load effect refetch.
  const handleSwitchWorkspace = useCallback((id: string) => {
    setSelection(null)
    setPathEdgeIds(new Set())
    setSearch('')
    setActiveWs(id)
    writeStored('uigraph.activeWorkspace', id)
  }, [])

  useEffect(() => {
    void reconcileWorkspaces()
  }, [reconcileWorkspaces])

  useEffect(() => {
    void load(activeWs)
  }, [activeWs, load])

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
        <Logo />
        {workspaces.length > 1 ? (
          <select
            className="workspace-switcher"
            aria-label="Switch project"
            value={activeWs ?? ''}
            onChange={(e) => handleSwitchWorkspace(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id} disabled={!w.available}>
                {w.name}
                {w.available ? '' : ' (re-map)'}
              </option>
            ))}
          </select>
        ) : null}
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
        <Settings theme={theme} setTheme={setTheme} />
      </header>
      {!live ? (
        <div className="banner offline" role="status">
          Serve API unreachable — showing a bundled sample graph. Run{' '}
          <code>uigraph serve</code> to connect a live project.
        </div>
      ) : (
        <FreshnessBanner freshness={freshness} mappedAt={changes.currentMappedAt} />
      )}
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
                searchMatchIds={matchIds}
                diffHighlight={diffHighlight}
                colorMode={resolved}
              />
            </ReactFlowProvider>
          )}
        </main>
        <div className="side">
          <Changes changes={changes} graph={graph} onSelect={setSelection} />
          <Inspector selection={selection} />
          <Steps graph={graph} onPathChange={handlePathChange} />
          <VerifyPanel graph={graph} proposals={proposals} coverage={coverage} onSelect={setSelection} />
          {coverage ? <Coverage coverage={coverage} graph={graph} onSelect={setSelection} /> : null}
          <ProposalsPanel
            proposals={proposals}
            graph={graph}
            selection={selection}
            onClearFilter={() => setSelection(null)}
          />
          <p className="side-footnote muted">{t('sidebar.studio')}</p>
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

/**
 * The non-blocking staleness warning under the topbar. Shown only when live and the
 * graph is NOT known-fresh: 'stale' names how many source files drifted; 'unknown'
 * is honest about not knowing (today's serve API has no freshness route — see the
 * TODO in api.ts). Either way the fix is the same: re-run `uigraph map`.
 */
function FreshnessBanner(props: { freshness: FreshnessState; mappedAt: string | null }): JSX.Element | null {
  const { freshness, mappedAt } = props
  if (freshness.state === 'fresh') return null
  const drifted = (freshness.changed?.length ?? 0) + (freshness.added?.length ?? 0) + (freshness.removed?.length ?? 0)
  const when = freshness.mappedAt ?? mappedAt
  return (
    <div className="banner stale" role="status">
      {freshness.state === 'stale'
        ? `Graph is out of date — ${drifted} source file${drifted === 1 ? '' : 's'} changed since the last map`
        : 'Graph freshness is unknown — it may be out of date'}
      {when ? ` (last mapped ${new Date(when).toLocaleString()})` : ''}. Re-run <code>uigraph map</code> to refresh.
    </div>
  )
}

/** Shown when the loaded graph has zero nodes: explains the likely cause per connection state. */
function EmptyState(props: { live: boolean }): JSX.Element {
  return (
    <div className="empty-state">
      <h2>No nodes in this graph</h2>
      {props.live ? (
        <p className="muted">
          The serve API returned an empty graph. Map a project first —{' '}
          <code className="inline-code">uigraph map &lt;dir&gt; --adapter &lt;name&gt;</code> — then reload.
        </p>
      ) : (
        <p className="muted">
          The bundled sample is empty. Run <code className="inline-code">uigraph map &lt;dir&gt; --adapter &lt;name&gt;</code>{' '}
          and then <code className="inline-code">uigraph serve</code> to load a real graph.
        </p>
      )}
    </div>
  )
}
