// Browser-side API client + shared types for the dashboard. Talks to the CLI
// serve API: GET /api/graph returns the merged UiGraph, POST /api/overlay applies
// a single manual overlay edit. The overlay op shape mirrors @uigraph/mcp's
// UpdateGraphArgs so the dashboard and the server cannot drift apart.

import type { CoverageReport, GraphEdge, GraphNode, Proposals, UiGraph } from '@uigraph/core'
import { buildCoverage } from '@uigraph/core'
import sampleGraph from './sample-graph.json'

/** The bundled fallback graph, used when the serve API is unreachable (static open). */
export const SAMPLE_GRAPH = sampleGraph as unknown as UiGraph

/**
 * A single manual overlay edit, the discriminated op the serve API accepts under
 * `{ op }`. Identical to @uigraph/mcp's UpdateOp so the POST body is type-checked
 * against the same contract the server applies.
 */
export type UpdateOp =
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'editNode'; node: GraphNode }
  | { kind: 'addEdge'; edge: GraphEdge }
  | { kind: 'editEdge'; edge: GraphEdge }
  | { kind: 'remove'; id: string }

/**
 * Fetch the merged (base + overlay) graph from the serve API. On any failure
 * (network error, non-OK status, bad JSON) it resolves to the bundled sample so
 * a static `vite build` open still renders a graph.
 */
export async function fetchGraph(): Promise<{ graph: UiGraph; live: boolean }> {
  try {
    const res = await fetch('/api/graph')
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
export async function fetchProposals(): Promise<Proposals> {
  try {
    const res = await fetch('/api/proposals')
    if (!res.ok) return EMPTY_PROPOSALS
    return (await res.json()) as Proposals
  } catch {
    return EMPTY_PROPOSALS
  }
}

/** The named planning scenarios and the active one. */
export interface ScenariosState {
  active: string
  names: string[]
}

/** Fetch the planning scenarios; falls back to a single default when offline. */
export async function fetchScenarios(): Promise<ScenariosState> {
  try {
    const res = await fetch('/api/scenarios')
    if (!res.ok) return { active: 'default', names: ['default'] }
    return (await res.json()) as ScenariosState
  } catch {
    return { active: 'default', names: ['default'] }
  }
}

/** Switch (or create) the active planning scenario; returns the new state. */
export async function postScenario(name: string): Promise<ScenariosState> {
  const res = await fetch('/api/scenario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`scenario switch failed (${res.status})`)
  return (await res.json()) as ScenariosState
}

/**
 * Fetch runtime-verification coverage from the serve API. On any failure, fall back
 * to computing coverage over the bundled sample graph so the panel still renders.
 */
export async function fetchCoverage(): Promise<CoverageReport> {
  try {
    const res = await fetch('/api/coverage')
    if (!res.ok) return buildCoverage(SAMPLE_GRAPH)
    return (await res.json()) as CoverageReport
  } catch {
    return buildCoverage(SAMPLE_GRAPH)
  }
}

/**
 * POST a single overlay edit to the serve API. Throws on a non-OK response with
 * the server's error message so the caller can surface it. Only meaningful when
 * the live API is reachable; manual edits against the sample fallback are local.
 */
export async function postOverlay(op: UpdateOp): Promise<void> {
  const res = await fetch('/api/overlay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op }),
  })
  if (!res.ok) {
    let message = `overlay POST failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // keep the status-based message
    }
    throw new Error(message)
  }
}
