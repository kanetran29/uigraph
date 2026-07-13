// Route-level grouping for the graph canvas. A `--controls` map of a real app has
// dozens of screens fanning thousands of `may` edges — an unreadable, laggy hairball.
// This pure transform collapses screens into route groups (by first static path
// segment): a collapsed group is ONE super-node, cross-group edges aggregate into
// counted super-edges, and expanding a group reveals its member screens in place.
//
// The result is a synthetic UiGraph — group super-nodes are ordinary `kind:'screen'`
// nodes, super-edges ordinary GraphEdges — so it feeds the existing radial layout and
// the whole render/memo pipeline UNCHANGED (layout.ts is not touched). Witnessed
// (runtime) edges survive aggregation as green super-edges, or, when both endpoints
// sit inside one collapsed group, the group is flagged so its border marks the witness
// (never silently dropped). Coverage is computed over the real graph elsewhere and is
// unaffected.

import type { GraphEdge, GraphNode, UiGraph } from '@ui-graph/core'

// Below this many screens the graph is already legible, so the transform is a no-op
// and small apps (samples, the gauntlet) render exactly as before.
export const GROUP_THRESHOLD = 30

const GROUP_PREFIX = 'grp_'
const ROOT_KEY = '__root__'
const DYNAMIC_KEY = '__dynamic__'

/** The synthetic screen id for a route group. */
export function groupNodeId(key: string): string {
  return `${GROUP_PREFIX}${key}`
}

/** True for a group super-node id (`grp_<key>`). */
export function isGroupId(id: string): boolean {
  return id.startsWith(GROUP_PREFIX)
}

/** The group key a group super-node id carries. */
export function groupKeyOfId(id: string): string {
  return id.slice(GROUP_PREFIX.length)
}

/** A human label for a group key: '(dynamic)' for the all-dynamic bucket, else '/<key>'. */
export function groupLabel(key: string): string {
  if (key === DYNAMIC_KEY) return '(dynamic)'
  if (key === ROOT_KEY) return '/'
  return `/${key}`
}

function isDynamicSeg(s: string): boolean {
  return s.startsWith(':') || s.startsWith('*') || s.startsWith('[')
}

/**
 * The group key for a route: its first STATIC path segment, folding leading dynamic
 * (`:param` / `*` / `[slug]`) segments. Root ('/') is its own key; an all-dynamic
 * route falls in one shared dynamic bucket. So `/admin/:t/x` → `admin` and
 * `/:t/:w/settings` → `settings`, while `/:t/:w` → the dynamic bucket.
 */
export function groupKey(route: string | null): string {
  if (route === null || route === '' || route === '/') return ROOT_KEY
  const segs = route.split('/').filter(Boolean)
  const seg = segs.find((s) => !isDynamicSeg(s))
  return seg ?? DYNAMIC_KEY
}

/** A modal `m_<screen>_<i>` connects only through a control edge, so it inherits its
 *  owner screen's group. Returns the owner screen id, or null for a non-modal id. */
function modalOwner(id: string): string | null {
  return /^m_(.+)_\d+$/.exec(id)?.[1] ?? null
}

/** The group key for a node: modals inherit their owner screen's group; everything
 *  else uses its own route. */
function nodeGroupKey(node: GraphNode, byId: ReadonlyMap<string, GraphNode>): string {
  if (node.kind === 'modal') {
    const owner = modalOwner(node.id)
    const ownerNode = owner !== null ? byId.get(owner) : undefined
    if (ownerNode !== undefined) return groupKey(ownerNode.route)
  }
  return groupKey(node.route)
}

/**
 * Group the non-control nodes of a graph by route key, order-stable (first-seen).
 * Exposed for tests + callers that want the raw grouping without the view transform.
 */
export function screenGroups(graph: UiGraph): Map<string, string[]> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const groups = new Map<string, string[]>()
  for (const n of graph.nodes) {
    if (n.kind === 'control') continue
    const key = nodeGroupKey(n, byId)
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [n.id])
    else list.push(n.id)
  }
  return groups
}

/** The synthetic-graph result plus per-group metadata the canvas renders on super-nodes. */
export interface RouteView {
  graph: UiGraph
  /** grp_<key> → member screen count (for the super-node label). */
  groupCount: Map<string, number>
  /** grp_<key> → true when a runtime-witnessed edge lives entirely inside this collapsed
   *  group (so its own green edge is hidden); the super-node marks the witness instead. */
  groupHasWitnessed: Map<string, boolean>
}

/** Precedence rollups for aggregating a bundle of real edges into one super-edge. */
function rollupModality(edges: readonly GraphEdge[]): GraphEdge['modality'] {
  if (edges.some((e) => e.modality === 'must')) return 'must'
  if (edges.some((e) => e.modality === 'may')) return 'may'
  return 'unknown'
}
function rollupSource(edges: readonly GraphEdge[]): GraphEdge['source'] {
  if (edges.some((e) => e.source === 'runtime')) return 'runtime'
  if (edges.some((e) => e.source === 'manual')) return 'manual'
  return 'static'
}

/**
 * Collapse a graph into its route-group level-of-detail. `expandedGroups` holds the
 * group keys the user has drilled into (their members render as real screens); every
 * other multi-member group collapses to a single super-node. Returns the graph
 * unchanged (identity) when it is already small enough to read.
 */
export function levelView(graph: UiGraph, expandedGroups: ReadonlySet<string>): RouteView {
  const nonControl = graph.nodes.filter((n) => n.kind !== 'control')
  const groups = screenGroups(graph)
  // Only multi-member, non-root groups are worth boxing; a lone screen stays itself.
  const superKeys = new Set<string>()
  for (const [key, members] of groups) if (key !== ROOT_KEY && members.length >= 2) superKeys.add(key)

  if (nonControl.length <= GROUP_THRESHOLD || superKeys.size === 0) {
    return { graph, groupCount: new Map(), groupHasWitnessed: new Map() }
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const keyOf = new Map<string, string>()
  for (const n of graph.nodes) if (n.kind !== 'control') keyOf.set(n.id, nodeGroupKey(n, byId))

  // A node is absorbed into its group's super-node when its group is boxed and not expanded.
  const absorbed = (id: string): boolean => {
    const key = keyOf.get(id)
    return key !== undefined && superKeys.has(key) && !expandedGroups.has(key)
  }
  // Screen-level endpoint after collapsing: the super-node id if absorbed, else itself.
  const resolve = (id: string): string => {
    const key = keyOf.get(id)
    if (key !== undefined && superKeys.has(key) && !expandedGroups.has(key)) return groupNodeId(key)
    return id
  }

  // ── Nodes ────────────────────────────────────────────────────────────────────
  const nodes: GraphNode[] = []
  const emitted = new Set<string>()
  const groupCount = new Map<string, number>()
  for (const [key, members] of groups) if (superKeys.has(key)) groupCount.set(groupNodeId(key), members.length)

  // Real (non-control) nodes that are NOT absorbed: singletons, root, and members of
  // expanded groups.
  for (const n of graph.nodes) {
    if (n.kind === 'control') continue
    if (absorbed(n.id)) continue
    nodes.push(n)
    emitted.add(n.id)
  }
  // One super-node per collapsed boxed group.
  for (const key of superKeys) {
    if (expandedGroups.has(key)) continue
    const id = groupNodeId(key)
    nodes.push({ id, route: null, componentPath: null, label: groupLabel(key), kind: 'screen' })
    emitted.add(id)
  }
  // Controls of a visible member screen pass through (toFlowNodes still gates them on
  // the per-screen `expanded` set); controls of an absorbed screen are dropped.
  for (const n of graph.nodes) {
    if (n.kind !== 'control' || n.parent === undefined) continue
    if (!emitted.has(n.parent)) continue
    nodes.push(n)
    emitted.add(n.id)
  }

  // ── Edges ────────────────────────────────────────────────────────────────────
  const isControlEndpoint = (id: string): boolean => byId.get(id)?.kind === 'control'
  const groupHasWitnessed = new Map<string, boolean>()
  // Bundle screen-level edges by their collapsed endpoint pair; pass control edges through.
  const bundles = new Map<string, { from: string; to: string; edges: GraphEdge[] }>()
  const passthrough: GraphEdge[] = []
  for (const e of graph.edges) {
    if (isControlEndpoint(e.from) || isControlEndpoint(e.to)) {
      passthrough.push(e)
      continue
    }
    const rf = resolve(e.from)
    const rt = resolve(e.to)
    if (rf === rt) {
      // Intra-collapsed self-loop — the hairball we hide. Flag a hidden witness so the
      // group super-node can mark it rather than silently dropping a proven edge.
      if (e.source === 'runtime') groupHasWitnessed.set(rf, true)
      continue
    }
    const k = `${rf}->${rt}`
    const b = bundles.get(k)
    if (b === undefined) bundles.set(k, { from: rf, to: rt, edges: [e] })
    else b.edges.push(e)
  }

  const edges: GraphEdge[] = []
  for (const { from, to, edges: bundled } of bundles.values()) {
    const involvesSuper = isGroupId(from) || isGroupId(to)
    // Pure real→real edges keep their exact identity + labels (no behavior change for
    // visible screens); only bundles that touch a super-node aggregate into one edge.
    if (!involvesSuper) {
      edges.push(...bundled)
      continue
    }
    const count = bundled.length
    edges.push({
      id: `sg_${from}->${to}`,
      from,
      to,
      event: count > 1 ? `×${count}` : (bundled[0]?.event ?? 'navigate'),
      guard: null,
      effect: null,
      modality: rollupModality(bundled),
      source: rollupSource(bundled),
      confidence: Math.max(...bundled.map((e) => e.confidence)),
      witnessStale: bundled.some((e) => e.witnessStale === true),
    })
  }
  // Control (and modal-open) edges survive only when both endpoints are on canvas.
  for (const e of passthrough) if (emitted.has(e.from) && emitted.has(e.to)) edges.push(e)

  return {
    graph: { version: 0, meta: graph.meta, nodes, edges },
    groupCount,
    groupHasWitnessed,
  }
}
