// The frontier (spec §3/§7): the explicit known-unknowns of the map. A state is on
// the frontier when its out-edges include a GENUINELY UNRESOLVED `unknown`-modality /
// dynamic-sink edge (the destination is still undecidable) OR it has no enumerated
// out-edges at all (a dead end whose real behavior is simply un-mapped). Surfacing
// the frontier is the safety spine: the agent is never silently blind — it is told
// exactly where to probe/ask.
//
// Frontier vs. the open set (coverage.ts): the open set is per-EDGE accounting (what
// is left to witness/park), whereas the frontier is per-STATE blindness (where the
// map still has a hole to probe). They share the "resolved" notion: a dynamic-sink
// edge whose source already has a concrete (non-sink) runtime out-edge is RESOLVED —
// the dispatch was witnessed — so it neither sits in the open set nor pulls its
// source onto the frontier. This is what stops a synthetic proposal sub-state sink
// (a `ps_*` / kind:'unknown' node from materializeProposalGraph) from being counted
// as a frontier hole once its in-edge has been witnessed/resolved.
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
 * Identify the frontier of a graph: states whose out-edges include an UNRESOLVED
 * unknown-modality or dynamic-sink (to an `unknown`-kind node) edge, OR that have
 * zero enumerated out-edges. A dynamic-sink edge is resolved (and so does NOT count)
 * once its source already has a concrete non-sink runtime out-edge — the dispatch was
 * witnessed — matching coverage's resolved/open accounting. Returns the frontier
 * state ids (in node order) and their count. Pure: derives everything from the graph,
 * mutates nothing.
 */
export function buildFrontier(graph: UiGraph): Frontier {
  const nodeKind = new Map(graph.nodes.map((n) => [n.id, n.kind]))
  const resolvedFroms = new Set<string>()
  for (const e of graph.edges) if (e.source === 'runtime' && nodeKind.get(e.to) !== 'unknown') resolvedFroms.add(e.from)
  const hasEnumeratedOut = new Set<string>()
  const hasUnknownOut = new Set<string>()
  for (const e of graph.edges) {
    const isUnknownOut = e.modality === 'unknown' || nodeKind.get(e.to) === 'unknown'
    if (isUnknownOut && !resolvedFroms.has(e.from)) hasUnknownOut.add(e.from)
    else hasEnumeratedOut.add(e.from)
  }
  const states = graph.nodes
    .filter((n) => STATE_KINDS.has(n.kind))
    .filter((n) => hasUnknownOut.has(n.id) || !hasEnumeratedOut.has(n.id))
    .map((n) => n.id)
  return { states, unknownCount: states.length }
}
