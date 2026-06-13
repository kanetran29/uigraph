// Graph algorithms (feature F1.6): adjacency, reachability, and shortest-path
// planning. These power plan_path over the MCP server and the dashboard's steps
// view. All operate on the framework-agnostic IR.

import type { GraphEdge, GraphNode, Modality, UiGraph } from './ir'

/** A synthetic "the control is available on this screen" edge (screen → control). */
function containmentEdge(parent: string, child: string): GraphEdge {
  return { id: `contains_${parent}__${child}`, from: parent, to: child, event: '(available)', guard: null, effect: 'contains', modality: 'must', source: 'static', confidence: 1 }
}

/**
 * Outgoing edges keyed by source node id, for traversal. Includes synthetic
 * containment edges (screen → its control children): a control is available once
 * you are on its parent screen, so planning can route THROUGH a control into the
 * state it opens (e.g. a modal reachable only via that control's open:modal edge),
 * which is otherwise edge-reachable from the control but not from the screen.
 */
export function buildAdjacency(graph: UiGraph): Map<string, GraphEdge[]> {
  const adj = new Map<string, GraphEdge[]>()
  const push = (e: GraphEdge): void => {
    const list = adj.get(e.from)
    if (list === undefined) adj.set(e.from, [e])
    else list.push(e)
  }
  for (const e of graph.edges) push(e)
  for (const n of graph.nodes) {
    if (n.kind === 'control' && n.parent !== undefined) push(containmentEdge(n.parent, n.id))
  }
  return adj
}

/** Set of node ids reachable from `startId` following edges (BFS). */
export function reachableFrom(graph: UiGraph, startId: string): Set<string> {
  const adj = buildAdjacency(graph)
  const seen = new Set<string>([startId])
  const queue: string[] = [startId]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    for (const e of adj.get(cur) ?? []) {
      if (!seen.has(e.to)) {
        seen.add(e.to)
        queue.push(e.to)
      }
    }
  }
  return seen
}

export interface PlanStep {
  edge: GraphEdge
  from: GraphNode
  to: GraphNode
}

export interface PlanPathOptions {
  /** Modalities allowed when traversing. Defaults to all three. */
  allow?: Modality[]
}

/**
 * Shortest path (fewest edges) from one node to another via BFS, returned as an
 * ordered list of steps, or null if no path exists under the allowed modalities.
 */
export function planPath(graph: UiGraph, fromId: string, toId: string, opts: PlanPathOptions = {}): PlanStep[] | null {
  const allow = new Set<Modality>(opts.allow ?? ['must', 'may', 'unknown'])
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  if (!nodeById.has(fromId) || !nodeById.has(toId)) return null

  const adj = buildAdjacency(graph)
  const prev = new Map<string, GraphEdge>()
  const seen = new Set<string>([fromId])
  const queue: string[] = [fromId]

  while (queue.length > 0) {
    const cur = queue.shift() as string
    if (cur === toId) break
    for (const e of adj.get(cur) ?? []) {
      if (!allow.has(e.modality) || seen.has(e.to)) continue
      seen.add(e.to)
      prev.set(e.to, e)
      queue.push(e.to)
    }
  }

  if (fromId !== toId && !prev.has(toId)) return null

  const steps: PlanStep[] = []
  let cursor = toId
  while (cursor !== fromId) {
    const edge = prev.get(cursor)
    if (edge === undefined) return null
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    if (from === undefined || to === undefined) return null
    steps.push({ edge, from, to })
    cursor = edge.from
  }
  steps.reverse()
  return steps
}
