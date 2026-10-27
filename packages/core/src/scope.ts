// Anchored edges. Scope attribution stores an edge that fires from many screens once,
// at a `scope` node, instead of copying it to every screen. These functions expand
// such edges back to screens on query. The thesis claim is that the expansion equals
// the per-screen materialisation, modulo the declared approximations.

import type { GraphEdge, GraphNode, UiGraph } from './ir'

/** The screen ids a node stands for: itself for a screen, its members for a scope node. */
export function scopeMembers(graph: UiGraph, node: GraphNode): string[] {
  if (node.kind !== 'scope') return [node.id]
  if (node.scope?.kind === 'top') return graph.nodes.filter((n) => n.kind === 'screen').map((n) => n.id)
  return node.scope?.members ?? []
}

/** Every edge that fires from `screenId`: its own edges plus those anchored at scopes containing it. */
export function edgesFrom(graph: UiGraph, screenId: string): GraphEdge[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const out: GraphEdge[] = []
  const seen = new Set<string>()
  for (const e of graph.edges) {
    const from = byId.get(e.from)
    if (!from) continue
    const fires = e.from === screenId || (from.kind === 'scope' && scopeMembers(graph, from).includes(screenId))
    if (!fires) continue
    const key = `${e.to}|${e.event}|${e.guard ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e.from === screenId ? e : { ...e, from: screenId })
  }
  return out
}

/** Materialise all anchored edges: the graph a consumer would get without anchoring. */
export function expandAnchoredEdges(graph: UiGraph): UiGraph {
  const screens = graph.nodes.filter((n) => n.kind !== 'scope' && n.kind !== 'control')
  const edges: GraphEdge[] = []
  for (const s of screens) for (const e of edgesFrom(graph, s.id)) edges.push(e)
  return { ...graph, nodes: graph.nodes.filter((n) => n.kind !== 'scope'), edges }
}
