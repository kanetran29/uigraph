// Layered layout for the graph canvas. Screen nodes are placed by dagre over the
// screen→screen edge graph only (control edges are excluded from ranking so a
// button does not warp the route layout), giving proper spacing and far fewer
// crossings. Control nodes are laid out as a vertical stack inside their parent
// screen at parent-relative positions, so @xyflow/react subflows render them
// nested; screens that own controls are grown to contain the stack.

import * as dagre from '@dagrejs/dagre'
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

/** The computed layout: positions and sizes for every node. */
export interface GraphLayout {
  positions: Map<string, NodePosition>
  sizes: Map<string, NodeSize>
}

const SCREEN_WIDTH = 210
const SCREEN_HEIGHT = 64

const CONTROL_WIDTH = 176
const CONTROL_HEIGHT = 56
const CONTROL_GAP = 10
const CHILD_INSET_X = 14
const CHILD_TOP = 58
const CHILD_BOTTOM_PAD = 14

/** Whether a node is a nested control (has a parent screen). */
function isControl(node: GraphNode): boolean {
  return node.kind === 'control'
}

/** Group control node ids by their parent screen id, preserving graph order. */
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

/** Height a screen needs to contain its stack of child controls. */
function screenHeight(childCount: number): number {
  if (childCount === 0) return SCREEN_HEIGHT
  return CHILD_TOP + childCount * (CONTROL_HEIGHT + CONTROL_GAP) - CONTROL_GAP + CHILD_BOTTOM_PAD
}

/**
 * Compute the full canvas layout. Screens are ranked left-to-right by dagre over
 * the screen→screen edges; only screens in `expanded` are grown to contain their
 * controls (collapsed screens stay compact, and their controls are not placed).
 */
export function layoutGraph(graph: UiGraph, expanded: ReadonlySet<string>): GraphLayout {
  const childrenOf = controlsByParent(graph)
  const screens = graph.nodes.filter((n) => !isControl(n))
  const screenIds = new Set(screens.map((n) => n.id))
  const heightOf = (id: string): number =>
    expanded.has(id) ? screenHeight((childrenOf.get(id) ?? []).length) : SCREEN_HEIGHT

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 110, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of screens) {
    g.setNode(node.id, { width: SCREEN_WIDTH, height: heightOf(node.id) })
  }
  const seenEdge = new Set<string>()
  for (const e of graph.edges) {
    if (!screenIds.has(e.from) || !screenIds.has(e.to) || e.from === e.to) continue
    const key = `${e.from}->${e.to}`
    if (seenEdge.has(key)) continue
    seenEdge.add(key)
    g.setEdge(e.from, e.to)
  }

  dagre.layout(g)

  const positions = new Map<string, NodePosition>()
  const sizes = new Map<string, NodeSize>()

  for (const node of screens) {
    const height = heightOf(node.id)
    sizes.set(node.id, { width: SCREEN_WIDTH, height })

    const laid = g.node(node.id)
    positions.set(node.id, {
      x: (laid?.x ?? 0) - SCREEN_WIDTH / 2,
      y: (laid?.y ?? 0) - height / 2,
    })

    if (!expanded.has(node.id)) continue
    ;(childrenOf.get(node.id) ?? []).forEach((childId, i) => {
      sizes.set(childId, { width: CONTROL_WIDTH, height: CONTROL_HEIGHT })
      positions.set(childId, {
        x: CHILD_INSET_X,
        y: CHILD_TOP + i * (CONTROL_HEIGHT + CONTROL_GAP),
      })
    })
  }

  return { positions, sizes }
}
