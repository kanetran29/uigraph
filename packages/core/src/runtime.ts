// Tier-3 runtime fold (dossier §5.1-5.2). A confirmed runtime observation is a
// deterministic witness, so it enters the graph as a real edge — this is the
// "the observation enters the graph, not the guess" half of the golden invariant.
// A refuted observation never produces an edge. The fold is pure: same
// observation log -> same runtime edges (G = fold(reduce_fn, static ++ obs_log)).

import type { GraphEdge, UiGraph } from './ir'
import { fnv1a } from './hash'

/** One runtime observation of attempting a transition (e.g. via Playwright). */
export interface Observation {
  id: string
  from: string
  to: string
  event: string
  effect?: string
  outcome: 'confirmed' | 'refuted'
  proposalId?: string
  screenshot?: string
  ts?: string
}

/** Stable id for the runtime edge produced by a confirmed transition. */
export function runtimeEdgeId(from: string, to: string, event: string): string {
  return `r_${from}__${to}__${fnv1a(event).slice(0, 6)}`
}

/**
 * The witnessed edges implied by a set of observations: one `must` edge per
 * distinct confirmed (from,to,event), sourced `runtime` with the observation id as
 * its witness. Refuted observations are ignored.
 */
export function confirmedEdges(observations: Observation[]): GraphEdge[] {
  const seen = new Set<string>()
  const edges: GraphEdge[] = []
  for (const o of observations) {
    if (o.outcome !== 'confirmed') continue
    const id = runtimeEdgeId(o.from, o.to, o.event)
    if (seen.has(id)) continue
    seen.add(id)
    edges.push({
      id,
      from: o.from,
      to: o.to,
      event: o.event,
      guard: null,
      effect: o.effect ?? 'navigate',
      modality: 'must',
      source: 'runtime',
      confidence: 1,
      witness: { source: 'runtime', observationId: o.id, ...(o.screenshot ? { screenshot: o.screenshot } : {}) },
    })
  }
  return edges
}

/**
 * Fold confirmed observations into a graph: append the runtime edges whose
 * endpoints exist and whose id is not already present. Returns a new graph; the
 * input is not mutated. Observations referencing unknown nodes are skipped (a
 * v1 conservatism — runtime-discovered states are future work).
 */
export function applyObservations(graph: UiGraph, observations: Observation[]): UiGraph {
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const existing = new Set(graph.edges.map((e) => e.id))
  const add = confirmedEdges(observations).filter((e) => !existing.has(e.id) && nodeIds.has(e.from) && nodeIds.has(e.to))
  if (add.length === 0) return graph
  return { ...graph, edges: [...graph.edges, ...add] }
}
