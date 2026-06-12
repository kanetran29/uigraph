// Browser-side API client + shared types for the dashboard. Talks to the CLI
// serve API: GET /api/graph returns the merged UiGraph, POST /api/overlay applies
// a single manual overlay edit. The overlay op shape mirrors @uigraph/mcp's
// UpdateGraphArgs so the dashboard and the server cannot drift apart.

import type { GraphEdge, GraphNode, UiGraph } from '@uigraph/core'
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
