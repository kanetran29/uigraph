// Browser-side API client + shared types for the dashboard. Read-only: it talks
// to the CLI serve API's GET routes (graph, proposals, coverage, changes,
// freshness, workspaces) — the write routes (/api/overlay, /api/scenario) are for
// agents and uigraph studio, never this viewer.

import type { CoverageReport, Proposals, SinceLastDiff, UiGraph } from '@ui-graph/core'
import { buildCoverage } from '@ui-graph/core'
import sampleGraph from './sample-graph.json'

/** The bundled fallback graph, used when the serve API is unreachable (static open). */
export const SAMPLE_GRAPH = sampleGraph as unknown as UiGraph

/** A registered workspace as the switcher sees it (no absolute dir — never leaked to the client). */
export interface WorkspaceSummary {
  id: string
  name: string
  adapter: string
  available: boolean
}

/** Append the opaque ?ws selector to a path; a null/undefined id leaves the path unchanged
 *  (single-workspace mode + back-compat — bare /api/graph still works). */
function withWs(path: string, wsId: string | null | undefined): string {
  return wsId ? `${path}${path.includes('?') ? '&' : '?'}ws=${encodeURIComponent(wsId)}` : path
}

/** Fetch the registry of workspaces for the switcher; empty when offline / single-mode. */
export async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  try {
    const res = await fetch('/api/workspaces')
    if (!res.ok) return []
    return (await res.json()) as WorkspaceSummary[]
  } catch {
    return []
  }
}

/**
 * Fetch the merged (base + overlay) graph from the serve API. On any failure
 * (network error, non-OK status, bad JSON) it resolves to the bundled sample so
 * a static `vite build` open still renders a graph.
 */
export async function fetchGraph(wsId?: string | null): Promise<{ graph: UiGraph; live: boolean }> {
  try {
    const res = await fetch(withWs('/api/graph', wsId))
    if (!res.ok) return { graph: SAMPLE_GRAPH, live: false }
    const graph = (await res.json()) as UiGraph
    return { graph, live: true }
  } catch {
    return { graph: SAMPLE_GRAPH, live: false }
  }
}

/** An empty proposals sidecar, used when the serve API is offline or lacks the route. */
export const EMPTY_PROPOSALS: Proposals = { version: 0, base: '', proposals: [] }

/**
 * Fetch the quarantined Tier-2 proposals sidecar from the serve API. Proposals are
 * read-only and optional: on any failure (network error, 404 from an older server,
 * non-OK status, bad JSON) this resolves to an empty sidecar so the dashboard still
 * renders the proven graph without them.
 */
export async function fetchProposals(wsId?: string | null): Promise<Proposals> {
  try {
    const res = await fetch(withWs('/api/proposals', wsId))
    if (!res.ok) return EMPTY_PROPOSALS
    return (await res.json()) as Proposals
  } catch {
    return EMPTY_PROPOSALS
  }
}

/** Graph freshness vs the current source, mirroring the CLI's `uigraph status` shape:
 *  'fresh' (nothing changed since the map), 'stale' (re-map needed), 'unknown' (no map /
 *  cannot recompute / endpoint not served). File lists are present only when stale. */
export interface FreshnessState {
  state: 'fresh' | 'stale' | 'unknown'
  mappedAt?: string
  changed?: string[]
  added?: string[]
  removed?: string[]
  detail?: string
}

/** The offline / not-served fallback: freshness cannot be determined. */
export const UNKNOWN_FRESHNESS: FreshnessState = { state: 'unknown' }

/**
 * Fetch graph freshness from the serve API. Resolves to UNKNOWN_FRESHNESS on any
 * failure (offline, 404, bad JSON) so the banner degrades to the honest "unknown".
 * TODO(serve-api): the serve API does not expose GET /api/freshness yet — the CLI
 * computes this in runStatus (packages/cli/src/commands.ts) but never serves it.
 * When the route lands (StatusResult shape), this starts returning fresh/stale for free.
 */
export async function fetchFreshness(wsId?: string | null): Promise<FreshnessState> {
  try {
    const res = await fetch(withWs('/api/freshness', wsId))
    if (!res.ok) return UNKNOWN_FRESHNESS
    return (await res.json()) as FreshnessState
  } catch {
    return UNKNOWN_FRESHNESS
  }
}

/** The temporal "since last map" diff for the active workspace (same shape the CLI/MCP return). */
export type ChangesState = SinceLastDiff

/** Offline / older-server fallback: looks like a never-mapped workspace (no panel content). */
export const EMPTY_CHANGES: ChangesState = { state: 'no-current', diff: null, previousMappedAt: null, currentMappedAt: null, detail: null }

/**
 * Fetch the "what did the last re-map change" delta for the active workspace. Read-only and
 * offline-safe: on any failure (network, 404 from an older server, non-OK, bad JSON) it
 * resolves to EMPTY_CHANGES so the dashboard still renders the rest of the graph.
 */
export async function fetchChanges(wsId?: string | null): Promise<ChangesState> {
  try {
    const res = await fetch(withWs('/api/changes', wsId))
    if (!res.ok) return EMPTY_CHANGES
    return (await res.json()) as ChangesState
  } catch {
    return EMPTY_CHANGES
  }
}

/**
 * Fetch runtime-verification coverage from the serve API. On any failure, fall back
 * to computing coverage over the bundled sample graph so the panel still renders.
 */
export async function fetchCoverage(wsId?: string | null): Promise<CoverageReport> {
  try {
    const res = await fetch(withWs('/api/coverage', wsId))
    if (!res.ok) return buildCoverage(SAMPLE_GRAPH)
    return (await res.json()) as CoverageReport
  } catch {
    return buildCoverage(SAMPLE_GRAPH)
  }
}
