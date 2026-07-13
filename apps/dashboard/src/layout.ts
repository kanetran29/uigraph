// Radial layout for the graph canvas. The root screen (Home / route '/') sits at
// the centre; every other screen is placed on a ring whose radius grows with its
// BFS distance from the root, so neighbours fan out on ALL sides instead of a
// left-to-right column. Within a ring, nodes are ordered by their parent's angle
// so children stay near their parent and edges (drawn as floating curves between
// node boundaries) cross as little as possible, leaving open space for labels.
// Control nodes are laid out as a vertical stack inside their parent screen at
// parent-relative positions, so @xyflow/react renders them nested.

import type { GraphNode, Proposal, UiGraph } from '@ui-graph/core'

/** A proposed (quarantined) screen-level edge to overlay on the canvas, deduped per pair. */
export interface ProposedEdge {
  id: string
  from: string
  to: string
  count: number
}

/**
 * The proposed edges worth drawing on the canvas: one per (screen → to) pair among
 * 'proposed' proposals whose target is a REAL non-control node already on the canvas
 * (the formerly-orphan modals/overlays). Proposals without such a target (e.g. an
 * external Stripe redirect, or a synthetic state sink) stay panel-only. Deterministic
 * + deduped so the dashed overlay mirrors the materialized proposal graph.
 */
export function proposedScreenEdges(graph: UiGraph, proposals: readonly Proposal[]): ProposedEdge[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const byPair = new Map<string, ProposedEdge>()
  for (const p of proposals) {
    if (p.status !== 'proposed' || p.to === undefined) continue
    if (!byId.has(p.screen)) continue
    const target = byId.get(p.to)
    if (target === undefined || target.kind === 'control') continue
    const key = `${p.screen}->${p.to}`
    const existing = byPair.get(key)
    if (existing) existing.count++
    else byPair.set(key, { id: `pe_${key}`, from: p.screen, to: p.to, count: 1 })
  }
  return [...byPair.values()]
}

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

/** A component band drawn inside an expanded screen, grouping that component's controls. */
export interface Band {
  id: string
  parent: string
  label: string
}

/** The computed layout: positions and sizes for every node (edge routing is floating, so no points). */
export interface GraphLayout {
  positions: Map<string, NodePosition>
  sizes: Map<string, NodeSize>
  edgePoints: Map<string, NodePosition[]>
  bands: Band[]
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
// A component band groups one component's controls inside an expanded screen: a
// header strip (BAND_HEADER) over the controls, inset from the screen edge.
const BAND_HEADER = 22
const BAND_GAP = 12
const BAND_INSET = 8

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

/** A readable component name from a control's componentPath ("components/Header/index.tsx" -> "Header"). */
export function componentLabel(path: string | null): string {
  if (path === null || path.length === 0) return '(page)'
  const parts = path.split('/').filter(Boolean)
  let base = parts[parts.length - 1] ?? path
  if (/^index\.[jt]sx?$/.test(base) && parts.length >= 2) base = parts[parts.length - 2] ?? base
  return base.replace(/\.[jt]sx?$/, '')
}

/** One group of a screen's controls: the page-root (flat, unlabeled) or a child component band. */
export interface ControlGroup {
  key: string
  label: string
  controlIds: string[]
  isBand: boolean
}

/**
 * Group a screen's controls by their owning component. Controls from the screen's
 * own component file (or with no file) are the page root and render FLAT; each
 * distinct child component becomes a labeled band. Order-stable (first-seen).
 */
export function componentGroups(graph: UiGraph, screenId: string): ControlGroup[] {
  const screenPath = graph.nodes.find((n) => n.id === screenId)?.componentPath ?? null
  const order: string[] = []
  const byKey = new Map<string, string[]>()
  for (const n of graph.nodes) {
    if (n.kind !== 'control' || n.parent !== screenId) continue
    const path = n.componentPath
    const key = path === null || path === screenPath ? '__root__' : path
    const list = byKey.get(key)
    if (list === undefined) {
      byKey.set(key, [n.id])
      order.push(key)
    } else list.push(n.id)
  }
  return order.map((key) =>
    key === '__root__'
      ? { key, label: '(page)', controlIds: byKey.get(key) ?? [], isBand: false }
      : { key, label: componentLabel(key), controlIds: byKey.get(key) ?? [], isBand: true },
  )
}

/**
 * Lay an expanded screen's controls in stacked component bands. Returns the screen
 * box size + positions/sizes for every sub-node (controls AND band boxes) and the
 * band list. Pure: no shared state, so repeated calls are independent.
 */
function layoutExpanded(screenId: string, groups: ControlGroup[]): { size: NodeSize; positions: Map<string, NodePosition>; sizes: Map<string, NodeSize>; bands: Band[] } {
  const positions = new Map<string, NodePosition>()
  const sizes = new Map<string, NodeSize>()
  const bands: Band[] = []
  let y = CHILD_TOP
  let maxW = SCREEN_WIDTH
  let bandIdx = 0
  for (const g of groups) {
    if (g.controlIds.length === 0) continue
    const cols = gridCols(g.controlIds.length)
    const rows = Math.ceil(g.controlIds.length / cols)
    const gridH = rows * (CONTROL_HEIGHT + CONTROL_GAP) - CONTROL_GAP
    const gridW = cols * CONTROL_WIDTH + (cols - 1) * CONTROL_GAP
    const insetX = g.isBand ? BAND_INSET + CHILD_INSET_X : CHILD_INSET_X
    const headerH = g.isBand ? BAND_HEADER : 0
    const ctlTop = y + headerH
    g.controlIds.forEach((id, i) => {
      positions.set(id, { x: insetX + (i % cols) * (CONTROL_WIDTH + CONTROL_GAP), y: ctlTop + Math.floor(i / cols) * (CONTROL_HEIGHT + CONTROL_GAP) })
      sizes.set(id, { width: CONTROL_WIDTH, height: CONTROL_HEIGHT })
    })
    if (g.isBand) {
      const id = `cg_${screenId}__${bandIdx++}`
      const bandW = gridW + CHILD_INSET_X * 2
      bands.push({ id, parent: screenId, label: g.label })
      positions.set(id, { x: BAND_INSET, y })
      sizes.set(id, { width: bandW, height: headerH + gridH + 10 })
      maxW = Math.max(maxW, BAND_INSET * 2 + bandW)
    } else {
      maxW = Math.max(maxW, CHILD_INSET_X * 2 + gridW)
    }
    y = ctlTop + gridH + BAND_GAP
  }
  return { size: { width: maxW, height: Math.max(SCREEN_HEIGHT, y - BAND_GAP + CHILD_BOTTOM_PAD) }, positions, sizes, bands }
}

/**
 * A canonical structural key over node ids, edge endpoints, and the expanded screen
 * set: it changes ONLY on a relayout-worthy edit. It is the cache key that lets the
 * canvas memoize `layoutGraph` so the O(nodes+edges) radial layout is not recomputed
 * on selection/search/hover — those churn a fresh `expanded` Set without changing its
 * contents, so keying the memo on the Set identity would relayout 200+ nodes per click.
 * An edge selection or a childless-node selection collapses to the same empty expanded
 * set and therefore the same key.
 */
export function structuralKey(graph: UiGraph, expanded: ReadonlySet<string>): string {
  const nodeIds = graph.nodes.map((n) => n.id).join(',')
  const edgeIds = graph.edges.map((e) => `${e.from}>${e.to}`).join(',')
  const exp = [...expanded].sort().join(',')
  return `${nodeIds}|${edgeIds}|${exp}`
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
  // Per expanded screen: its component-banded inner layout (controls + band boxes + size).
  const expLayout = new Map<string, ReturnType<typeof layoutExpanded>>()
  for (const s of screens) {
    if (expanded.has(s.id) && childN(s.id) > 0) expLayout.set(s.id, layoutExpanded(s.id, componentGroups(graph, s.id)))
  }
  const widthOf = (id: string): number =>
    isGhost(id) ? GHOST_WIDTH : expLayout.get(id)?.size.width ?? (expanded.has(id) ? expandedSize(childN(id)).width : SCREEN_WIDTH)
  const heightOf = (id: string): number =>
    isGhost(id) ? GHOST_HEIGHT : expLayout.get(id)?.size.height ?? (expanded.has(id) ? expandedSize(childN(id)).height : SCREEN_HEIGHT)

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

  // Expanded screens grow into tall control-grid boxes; push the rings apart by the
  // largest expanded box so boxes don't overlap (esp. with "expand all controls").
  // Zero when nothing is expanded, so the collapsed layout is unchanged.
  const expandedExtent =
    expanded.size === 0
      ? 0
      : Math.max(0, ...[...expanded].map((id) => {
          const e = expLayout.get(id)?.size ?? expandedSize(childN(id))
          return Math.max(e.width, e.height)
        }))
  const ringStep = RING + expandedExtent

  const bands: Band[] = []
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
    const r = owned ? (d - 0.45) * ringStep : d * ringStep
    const ang = owned ? a + 0.18 : a
    const cx = d === 0 ? 0 : Math.cos(ang) * r
    const cy = d === 0 ? 0 : Math.sin(ang) * r
    positions.set(node.id, { x: cx - width / 2, y: cy - height / 2 })

    // Place this screen's controls + component bands from its banded inner layout.
    const e = expLayout.get(node.id)
    if (e === undefined) continue
    for (const [id, p] of e.positions) positions.set(id, p)
    for (const [id, sz] of e.sizes) sizes.set(id, sz)
    bands.push(...e.bands)
  }

  return { positions, sizes, edgePoints: new Map(), bands }
}
