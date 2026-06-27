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

/**
 * Stable id for the runtime edge produced by a confirmed transition. Uses a
 * readable sanitized event token PLUS the full (non-truncated) FNV-1a of the
 * canonical event, so two distinct events on the same from→to pair can never
 * collide into one id — a collision here would silently merge separate
 * transitions during dedup. The full hash disambiguates events that sanitize to
 * the same token (e.g. `a b` vs `a_b`).
 */
export function runtimeEdgeId(from: string, to: string, event: string): string {
  return `r_${from}__${to}__${sanitizeEvent(event)}_${fnv1a(event)}`
}

/** Map an event string to a readable id token (non-`[A-Za-z0-9_-]` → `_`). */
function sanitizeEvent(event: string): string {
  return event.replace(/[^A-Za-z0-9_-]/g, '_')
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
 * Fold confirmed observations into a graph. A confirmation of an EXISTING edge
 * (same from→to) UPGRADES that edge in place to a witnessed runtime must-edge —
 * keeping its event/guard/effect and stable id, so the graph is not doubled up
 * with a static/runtime twin. A confirmation of a NEW transition appends a fresh
 * runtime edge. Refuted observations and ones referencing unknown nodes are
 * skipped. Returns a new graph; the input is not mutated.
 */
export function applyObservations(graph: UiGraph, observations: Observation[]): UiGraph {
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const edges = graph.edges.slice()
  const idxByPair = new Map<string, number>()
  edges.forEach((e, i) => {
    const pair = `${e.from}->${e.to}`
    if (!idxByPair.has(pair)) idxByPair.set(pair, i)
  })

  let changed = false
  const seen = new Set<string>()
  for (const o of observations) {
    if (o.outcome !== 'confirmed' || !nodeIds.has(o.from) || !nodeIds.has(o.to)) continue
    const pair = `${o.from}->${o.to}`
    if (seen.has(pair)) continue
    seen.add(pair)
    const witness = { source: 'runtime' as const, observationId: o.id, ...(o.screenshot ? { screenshot: o.screenshot } : {}) }
    const idx = idxByPair.get(pair)
    const cur = idx !== undefined ? edges[idx] : undefined
    if (idx !== undefined && cur !== undefined) {
      edges[idx] = { ...cur, modality: 'must', source: 'runtime', confidence: 1, witness }
    } else {
      edges.push({
        id: runtimeEdgeId(o.from, o.to, o.event),
        from: o.from,
        to: o.to,
        event: o.event,
        guard: null,
        effect: o.effect ?? 'navigate',
        modality: 'must',
        source: 'runtime',
        confidence: 1,
        witness,
      })
      idxByPair.set(pair, edges.length - 1)
    }
    changed = true
  }
  return changed ? { ...graph, edges } : graph
}
