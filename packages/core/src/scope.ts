// Anchored edges. Scope attribution stores an edge that fires from many screens once,
// at a `scope` node, instead of copying it to every screen. These functions expand
// such edges back to screens on query. The thesis claim is that the expansion equals
// the per-screen materialisation, modulo the declared approximations.

import type { GraphEdge, GraphNode, Modality, UiGraph, Witness } from './ir'

/** The screen ids a node stands for: itself for a screen, its members for a scope node. */
export function scopeMembers(graph: UiGraph, node: GraphNode): string[] {
  if (node.kind !== 'scope') return [node.id]
  if (node.scope?.kind === 'top') return graph.nodes.filter((n) => n.kind === 'screen').map((n) => n.id)
  return node.scope?.members ?? []
}

const MODALITY_RANK: Record<Modality, number> = { unknown: 0, may: 1, must: 2 }

const sameWitness = (a: Witness, b: Witness) =>
  a.file === b.file && a.loc?.line === b.loc?.line && a.loc?.col === b.loc?.col && a.observationId === b.observationId

/**
 * Join two edges that fire from the same screen with the same destination, event and guard.
 * An edge is as certain as the most certain construct that produces it, so the stronger
 * modality wins and its witness leads; every witness of both is kept. The result does not
 * depend on the order of the edge list.
 */
function joinEdges(a: GraphEdge, b: GraphEdge): GraphEdge {
  const ra = MODALITY_RANK[a.modality], rb = MODALITY_RANK[b.modality]
  const [lead, other] = rb > ra || (rb === ra && b.confidence > a.confidence) ? [b, a] : [a, b]
  const witnesses: Witness[] = []
  for (const w of [lead.witness, ...(lead.mergedWitnesses ?? []), other.witness, ...(other.mergedWitnesses ?? [])]) {
    if (w && !witnesses.some((x) => sameWitness(x, w))) witnesses.push(w)
  }
  const [witness, ...merged] = witnesses
  const out: GraphEdge = { ...lead, witness, mergedWitnesses: merged.length > 0 ? merged : undefined }
  if (witness === undefined) delete out.witness
  if (merged.length === 0) delete out.mergedWitnesses
  return out
}

/** Every edge that fires from `screenId`: its own edges plus those anchored at scopes containing it. */
export function edgesFrom(graph: UiGraph, screenId: string): GraphEdge[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const byKey = new Map<string, GraphEdge>()
  for (const e of graph.edges) {
    const from = byId.get(e.from)
    if (!from) continue
    const fires = e.from === screenId || (from.kind === 'scope' && scopeMembers(graph, from).includes(screenId))
    if (!fires) continue
    const key = `${e.to}|${e.event}|${e.guard ?? ''}`
    const here = e.from === screenId ? e : { ...e, from: screenId }
    const prev = byKey.get(key)
    byKey.set(key, prev ? joinEdges(prev, here) : here)
  }
  return [...byKey.values()]
}

/** Materialise all anchored edges: the graph a consumer would get without anchoring. */
export function expandAnchoredEdges(graph: UiGraph): UiGraph {
  const screens = graph.nodes.filter((n) => n.kind !== 'scope' && n.kind !== 'control')
  const edges: GraphEdge[] = []
  for (const s of screens) for (const e of edgesFrom(graph, s.id)) edges.push(e)
  return { ...graph, nodes: graph.nodes.filter((n) => n.kind !== 'scope'), edges }
}
