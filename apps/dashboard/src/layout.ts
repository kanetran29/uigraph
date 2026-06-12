// Simple layered layout for the graph canvas: assign each node an x by its BFS
// depth (distance from a root) and stack nodes within a depth vertically. Roots
// are nodes with no incoming edge; any node unreached from a root falls into a
// trailing column so disconnected pieces still render.

import type { UiGraph } from '@uigraph/core'

/** A laid-out position in canvas pixels for one node id. */
export interface NodePosition {
  x: number
  y: number
}

const COL_WIDTH = 240
const ROW_HEIGHT = 110
const ORIGIN_X = 40
const ORIGIN_Y = 40

/**
 * Compute an x/y position per node id by layering on BFS depth from the graph's
 * roots (nodes with no incoming edge, or the first node when every node has one).
 * Nodes at the same depth are stacked vertically; unreached nodes get a final
 * column so the layout never drops a node.
 */
export function layoutByDepth(graph: UiGraph): Map<string, NodePosition> {
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) {
    const list = adj.get(e.from)
    if (list === undefined) adj.set(e.from, [e.to])
    else list.push(e.to)
  }

  const hasIncoming = new Set(graph.edges.map((e) => e.to))
  const roots = graph.nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id)
  if (roots.length === 0 && graph.nodes.length > 0) {
    const first = graph.nodes[0]
    if (first !== undefined) roots.push(first.id)
  }

  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const r of roots) {
    depth.set(r, 0)
    queue.push(r)
  }
  while (queue.length > 0) {
    const cur = queue.shift() as string
    const d = depth.get(cur) ?? 0
    for (const next of adj.get(cur) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, d + 1)
        queue.push(next)
      }
    }
  }

  let maxDepth = 0
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d)
  const unreachedDepth = maxDepth + 1

  const rowCursor = new Map<number, number>()
  const positions = new Map<string, NodePosition>()
  for (const node of graph.nodes) {
    const d = depth.get(node.id) ?? unreachedDepth
    const row = rowCursor.get(d) ?? 0
    rowCursor.set(d, row + 1)
    positions.set(node.id, {
      x: ORIGIN_X + d * COL_WIDTH,
      y: ORIGIN_Y + row * ROW_HEIGHT,
    })
  }
  return positions
}
