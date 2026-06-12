// Sidecar overlay merge (feature F1.4). The displayed graph is merge(base,
// overlay); the base on disk is never mutated. Identity is the stable id.

import type { GraphEdge, GraphNode, Overlay, UiGraph } from './ir'

/**
 * Apply a manual overlay onto a base graph and return a new merged graph.
 * removedRefs hide base nodes/edges (soft delete), editedEdges replace base edges
 * by id, and addedNodes/addedEdges are appended. The base graph is not mutated.
 */
export function mergeOverlay(base: UiGraph, overlay: Overlay): UiGraph {
  const removed = new Set(overlay.removedRefs)
  const edited = new Map(overlay.editedEdges.map((e) => [e.id, e]))

  const nodes: GraphNode[] = base.nodes.filter((n) => !removed.has(n.id))
  for (const n of overlay.addedNodes) nodes.push(n)

  const edges: GraphEdge[] = []
  for (const e of base.edges) {
    if (removed.has(e.id)) continue
    edges.push(edited.get(e.id) ?? e)
  }
  for (const e of overlay.addedEdges) edges.push(e)

  return { version: base.version, meta: base.meta, nodes, edges }
}

/** An empty overlay bound to a given base content hash. */
export function emptyOverlay(baseHash: string): Overlay {
  return { version: 0, base: baseHash, addedNodes: [], addedEdges: [], editedEdges: [], removedRefs: [] }
}
