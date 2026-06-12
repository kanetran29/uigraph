// Graph diff (feature F1.5). Compares two graphs by stable id and reports a
// behavior change edge by edge — the "lockfile for behavior" diff (dossier §5.2).

import type { GraphEdge, GraphNode, UiGraph } from './ir'

export interface EdgeChange {
  id: string
  fields: string[]
  before: GraphEdge
  after: GraphEdge
}

export interface GraphDiff {
  addedNodes: GraphNode[]
  removedNodes: GraphNode[]
  addedEdges: GraphEdge[]
  removedEdges: GraphEdge[]
  changedEdges: EdgeChange[]
}

const EDGE_FIELDS = ['from', 'to', 'event', 'guard', 'effect', 'modality', 'source', 'confidence'] as const

function changedFields(a: GraphEdge, b: GraphEdge): string[] {
  return EDGE_FIELDS.filter((f) => a[f] !== b[f])
}

/**
 * Diff two graphs by id. Nodes report add/remove; edges report add/remove and,
 * for ids present in both, the list of fields whose values differ.
 */
export function diffGraphs(a: UiGraph, b: UiGraph): GraphDiff {
  const aNodes = new Map(a.nodes.map((n) => [n.id, n]))
  const bNodes = new Map(b.nodes.map((n) => [n.id, n]))
  const aEdges = new Map(a.edges.map((e) => [e.id, e]))
  const bEdges = new Map(b.edges.map((e) => [e.id, e]))

  const addedNodes = b.nodes.filter((n) => !aNodes.has(n.id))
  const removedNodes = a.nodes.filter((n) => !bNodes.has(n.id))
  const addedEdges = b.edges.filter((e) => !aEdges.has(e.id))
  const removedEdges = a.edges.filter((e) => !bEdges.has(e.id))

  const changedEdges: EdgeChange[] = []
  for (const [id, before] of aEdges) {
    const after = bEdges.get(id)
    if (after === undefined) continue
    const fields = changedFields(before, after)
    if (fields.length > 0) changedEdges.push({ id, fields, before, after })
  }

  return { addedNodes, removedNodes, addedEdges, removedEdges, changedEdges }
}
