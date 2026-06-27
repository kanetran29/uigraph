// The frontier (spec §3/§7): the explicit known-unknowns of the map. A state is on
// the frontier when its out-edges include an `unknown`-modality / dynamic-sink edge
// (the destination is undecidable) OR it has no enumerated out-edges at all (a dead
// end whose real behavior is simply un-mapped). Surfacing the frontier is the safety
// spine: the agent is never silently blind — it is told exactly where to probe/ask.
//
// Only real states (screen/route/modal) count. Control nodes nest inside screens
// and unknown-kind sink nodes are themselves the undecidable target, not a state to
// probe, so both are excluded. Pure read-time metric — no mutation, no IO.

import type { UiGraph } from './ir'

/** The frontier: the ids of states that are known-unknowns, and how many there are. */
export interface Frontier {
  states: string[]
  unknownCount: number
}

/** Node kinds that represent a real, probe-able state (the only candidates for the frontier). */
const STATE_KINDS = new Set(['screen', 'route', 'modal'])

/**
 * Identify the frontier of a graph: states whose out-edges include an unknown-modality
 * or dynamic-sink (to an `unknown`-kind node) edge, OR that have zero enumerated
 * out-edges. Returns the frontier state ids (in node order) and their count, for
 * safety-aware planning. Pure: derives everything from the graph, mutates nothing.
 */
export function buildFrontier(graph: UiGraph): Frontier {
  const nodeKind = new Map(graph.nodes.map((n) => [n.id, n.kind]))
  const hasEnumeratedOut = new Set<string>()
  const hasUnknownOut = new Set<string>()
  for (const e of graph.edges) {
    if (e.modality === 'unknown' || nodeKind.get(e.to) === 'unknown') hasUnknownOut.add(e.from)
    else hasEnumeratedOut.add(e.from)
  }
  const states = graph.nodes
    .filter((n) => STATE_KINDS.has(n.kind))
    .filter((n) => hasUnknownOut.has(n.id) || !hasEnumeratedOut.has(n.id))
    .map((n) => n.id)
  return { states, unknownCount: states.length }
}
