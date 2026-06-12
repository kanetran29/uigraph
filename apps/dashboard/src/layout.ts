// Layered layout for the graph canvas. Screen-like nodes are placed by BFS depth
// from a root (distance over the screen→screen edge graph) and stacked vertically
// within a depth. Control nodes are NOT placed on the main grid: each is laid out
// as a vertical stack inside its parent screen, at a position relative to that
// parent (so @xyflow/react subflows render them nested). Screens that contain
// controls are grown so their children fit.

import type { GraphNode, UiGraph } from '@uigraph/core'

/** A laid-out position in canvas pixels (absolute for screens, parent-relative for controls). */
export interface NodePosition {
  x: number
  y: number
}

/** A box size in canvas pixels. */
export interface NodeSize {
  width: number
  height: number
}

/**
 * The computed layout: an absolute position for every screen-like node, a
 * parent-relative position for every control node, and a size for every node
 * (screens with controls are enlarged to contain them).
 */
export interface GraphLayout {
  positions: Map<string, NodePosition>
  sizes: Map<string, NodeSize>
}

const COL_WIDTH = 300
const ROW_HEIGHT = 130
const ORIGIN_X = 40
const ORIGIN_Y = 40

const SCREEN_WIDTH = 200
const SCREEN_HEIGHT = 64

const CONTROL_WIDTH = 168
const CONTROL_HEIGHT = 52
const CONTROL_GAP = 10
const CHILD_INSET_X = 12
const CHILD_TOP = 56
const CHILD_BOTTOM_PAD = 12

/** Whether a node is a nested control (has a parent screen). */
function isControl(node: GraphNode): boolean {
  return node.kind === 'control'
}

/**
 * Group control node ids by their parent screen id, preserving graph order so the
 * vertical stack inside a screen is stable across renders.
 */
function controlsByParent(graph: UiGraph): Map<string, string[]> {
  const byParent = new Map<string, string[]>()
  for (const n of graph.nodes) {
    if (!isControl(n) || n.parent === undefined) continue
    const list = byParent.get(n.parent)
    if (list === undefined) byParent.set(n.parent, [n.id])
    else list.push(n.id)
  }
  return byParent
}

/**
 * Compute the full canvas layout. Screen-like nodes are layered by BFS depth over
 * the screen→screen edges (control nodes and their edges are excluded from the
 * grid so a button does not push its screen into a new column). Each screen that
 * owns controls is sized to fit a vertical stack of child boxes, and every child
 * gets a parent-relative position within that stack.
 */
export function layoutGraph(graph: UiGraph): GraphLayout {
  const childrenOf = controlsByParent(graph)
  const screenIds = new Set(graph.nodes.filter((n) => !isControl(n)).map((n) => n.id))

  const adj = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (!screenIds.has(e.from) || !screenIds.has(e.to)) continue
    const list = adj.get(e.from)
    if (list === undefined) adj.set(e.from, [e.to])
    else list.push(e.to)
  }

  const hasIncoming = new Set(
    graph.edges.filter((e) => screenIds.has(e.from) && screenIds.has(e.to)).map((e) => e.to),
  )
  const screens = graph.nodes.filter((n) => !isControl(n))
  const roots = screens.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id)
  if (roots.length === 0 && screens.length > 0) {
    const first = screens[0]
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

  const positions = new Map<string, NodePosition>()
  const sizes = new Map<string, NodeSize>()

  const rowCursor = new Map<number, number>()
  for (const node of screens) {
    const children = childrenOf.get(node.id) ?? []
    const height =
      children.length === 0
        ? SCREEN_HEIGHT
        : CHILD_TOP + children.length * (CONTROL_HEIGHT + CONTROL_GAP) - CONTROL_GAP + CHILD_BOTTOM_PAD
    sizes.set(node.id, { width: SCREEN_WIDTH, height })

    const d = depth.get(node.id) ?? unreachedDepth
    const row = rowCursor.get(d) ?? 0
    rowCursor.set(d, row + 1)
    positions.set(node.id, {
      x: ORIGIN_X + d * COL_WIDTH,
      y: ORIGIN_Y + row * ROW_HEIGHT,
    })

    children.forEach((childId, i) => {
      sizes.set(childId, { width: CONTROL_WIDTH, height: CONTROL_HEIGHT })
      positions.set(childId, {
        x: CHILD_INSET_X,
        y: CHILD_TOP + i * (CONTROL_HEIGHT + CONTROL_GAP),
      })
    })
  }

  return { positions, sizes }
}
