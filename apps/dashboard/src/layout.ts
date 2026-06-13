// Radial layout for the graph canvas. The root screen (Home / route '/') sits at
// the centre; every other screen is placed on a ring whose radius grows with its
// BFS distance from the root, so neighbours fan out on ALL sides instead of a
// left-to-right column. Within a ring, nodes are ordered by their parent's angle
// so children stay near their parent and edges (drawn as floating curves between
// node boundaries) cross as little as possible, leaving open space for labels.
// Control nodes are laid out as a vertical stack inside their parent screen at
// parent-relative positions, so @xyflow/react renders them nested.

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

/** The computed layout: positions and sizes for every node (edge routing is floating, so no points). */
export interface GraphLayout {
  positions: Map<string, NodePosition>
  sizes: Map<string, NodeSize>
  edgePoints: Map<string, NodePosition[]>
}

const SCREEN_WIDTH = 248
// Collapsed screen height fits the four-line label (name, route, controls badge,
// proposals badge) without clipping.
const SCREEN_HEIGHT = 98

const GHOST_WIDTH = 150
const GHOST_HEIGHT = 40

const CONTROL_WIDTH = 188
const CONTROL_HEIGHT = 60
const CONTROL_GAP = 10
const CHILD_INSET_X = 14
const CHILD_TOP = 62
const CHILD_BOTTOM_PAD = 16

// Radius added per BFS ring. Generous so a ring's circumference comfortably holds
// its nodes and the spokes between rings have room for edge labels.
const RING = 520

/** Column count for an expanded screen's controls: wrap into a grid (max 3 cols) so a
 * control-heavy screen grows wide rather than into an unreadable tall column. */
function gridCols(count: number): number {
  if (count <= 3) return 1
  if (count <= 8) return 2
  return 3
}

/** The {cols, rows} grid an expanded screen lays its controls into. */
function gridDims(count: number): { cols: number; rows: number } {
  const cols = gridCols(count)
  return { cols, rows: Math.ceil(count / cols) }
}

/** Box size an expanded screen needs to contain its control grid. */
function expandedSize(count: number): { width: number; height: number } {
  if (count === 0) return { width: SCREEN_WIDTH, height: SCREEN_HEIGHT }
  const { cols, rows } = gridDims(count)
  const width = Math.max(SCREEN_WIDTH, CHILD_INSET_X * 2 + cols * CONTROL_WIDTH + (cols - 1) * CONTROL_GAP)
  const height = CHILD_TOP + rows * (CONTROL_HEIGHT + CONTROL_GAP) - CONTROL_GAP + CHILD_BOTTOM_PAD
  return { width, height }
}

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

/**
 * Compute the full canvas layout. Screens are placed radially around the root by
 * BFS depth (root centred); only screens in `expanded` are grown to contain their
 * control grid. Returns empty edge points — edges route as floating curves at render.
 */
export function layoutGraph(graph: UiGraph, expanded: ReadonlySet<string>): GraphLayout {
  const childrenOf = controlsByParent(graph)
  const screens = graph.nodes.filter((n) => !isControl(n))
  const screenIds = new Set(screens.map((n) => n.id))
  const isGhost = (id: string): boolean => id.startsWith('ps_')
  const childN = (id: string): number => (childrenOf.get(id) ?? []).length
  const widthOf = (id: string): number =>
    isGhost(id) ? GHOST_WIDTH : expanded.has(id) ? expandedSize(childN(id)).width : SCREEN_WIDTH
  const heightOf = (id: string): number =>
    isGhost(id) ? GHOST_HEIGHT : expanded.has(id) ? expandedSize(childN(id)).height : SCREEN_HEIGHT

  // Undirected adjacency among screen nodes (control edges are ignored for ranking).
  const adj = new Map<string, Set<string>>()
  for (const s of screens) adj.set(s.id, new Set())
  for (const e of graph.edges) {
    if (!screenIds.has(e.from) || !screenIds.has(e.to) || e.from === e.to) continue
    adj.get(e.from)?.add(e.to)
    adj.get(e.to)?.add(e.from)
  }

  const root = screens.find((s) => s.id === 'n_root') ?? screens.find((s) => s.route === '/') ?? screens[0]

  // BFS depth + parent from the root; unreached screens land one ring past the deepest.
  const depth = new Map<string, number>()
  const parent = new Map<string, string | null>()
  if (root !== undefined) {
    depth.set(root.id, 0)
    parent.set(root.id, null)
    const queue = [root.id]
    while (queue.length > 0) {
      const cur = queue.shift() as string
      for (const nb of adj.get(cur) ?? []) {
        if (!depth.has(nb)) {
          depth.set(nb, (depth.get(cur) ?? 0) + 1)
          parent.set(nb, cur)
          queue.push(nb)
        }
      }
    }
  }
  let maxReached = 0
  for (const d of depth.values()) maxReached = Math.max(maxReached, d)
  // A modal node `m_<screen>_<i>` connects to its screen only through a control
  // edge, so BFS never reaches it; anchor it one ring past its owning screen (and
  // inheriting its angle) so it sits beside that screen rather than off in a
  // catch-all ring.
  for (const s of screens) {
    if (depth.has(s.id)) continue
    const owner = /^m_(.+)_\d+$/.exec(s.id)?.[1]
    if (owner !== undefined && depth.has(owner)) {
      depth.set(s.id, (depth.get(owner) ?? 0) + 1)
      parent.set(s.id, owner)
    } else {
      depth.set(s.id, maxReached + 1)
      parent.set(s.id, null)
    }
  }

  const byDepth = new Map<number, string[]>()
  for (const s of screens) {
    const d = depth.get(s.id) ?? 0
    const list = byDepth.get(d)
    if (list === undefined) byDepth.set(d, [s.id])
    else list.push(s.id)
  }

  const angle = new Map<string, number>()
  const maxDepth = Math.max(0, ...byDepth.keys())
  for (let d = 0; d <= maxDepth; d++) {
    const ids = byDepth.get(d) ?? []
    if (d === 0) {
      for (const id of ids) angle.set(id, 0)
      continue
    }
    // Keep children near their parent: order this ring by the parent's angle.
    ids.sort((a, b) => (angle.get(parent.get(a) ?? '') ?? 0) - (angle.get(parent.get(b) ?? '') ?? 0))
    const n = ids.length
    ids.forEach((id, i) => angle.set(id, (i / Math.max(1, n)) * Math.PI * 2))
  }

  const positions = new Map<string, NodePosition>()
  const sizes = new Map<string, NodeSize>()

  for (const node of screens) {
    const width = widthOf(node.id)
    const height = heightOf(node.id)
    sizes.set(node.id, { width, height })

    const d = depth.get(node.id) ?? 0
    const a = angle.get(node.id) ?? 0
    // A modal anchored to an owner screen sits just OUTBOARD of it (half a ring,
    // slightly rotated) so it reads as "this screen's dialog" rather than a full
    // ring away; other nodes sit on their ring.
    const owned = node.kind === 'modal' && typeof parent.get(node.id) === 'string'
    const r = owned ? (d - 0.45) * RING : d * RING
    const ang = owned ? a + 0.18 : a
    const cx = d === 0 ? 0 : Math.cos(ang) * r
    const cy = d === 0 ? 0 : Math.sin(ang) * r
    positions.set(node.id, { x: cx - width / 2, y: cy - height / 2 })

    if (!expanded.has(node.id)) continue
    const kids = childrenOf.get(node.id) ?? []
    const cols = gridCols(kids.length)
    kids.forEach((childId, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      sizes.set(childId, { width: CONTROL_WIDTH, height: CONTROL_HEIGHT })
      positions.set(childId, {
        x: CHILD_INSET_X + col * (CONTROL_WIDTH + CONTROL_GAP),
        y: CHILD_TOP + row * (CONTROL_HEIGHT + CONTROL_GAP),
      })
    })
  }

  return { positions, sizes, edgePoints: new Map() }
}
