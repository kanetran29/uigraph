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

/**
 * Render an overlay as a human/agent-readable markdown "planned changes" spec: the
 * new screens, new + edited transitions, and removals — resolving node ids to
 * labels against the base. The hand-off artifact for "I planned a feature on the
 * graph; here's what changes." Returns a clear notice when nothing is planned.
 */
export function exportOverlaySpec(base: UiGraph, overlay: Overlay): string {
  const labelOf = (id: string): string => base.nodes.find((n) => n.id === id)?.label ?? id
  const edgeLine = (e: GraphEdge): string => `- ${labelOf(e.from)} → ${labelOf(e.to)} — \`${e.event}\`${e.guard ? ` [${e.guard}]` : ''} (${e.modality})`
  const lines: string[] = ['# Planned changes', '']

  if (overlay.addedNodes.length > 0) {
    lines.push('## New screens', '')
    for (const n of overlay.addedNodes) lines.push(`- **${n.label}** (${n.route ?? n.id}) — ${n.kind}`)
    lines.push('')
  }
  if (overlay.addedEdges.length > 0) {
    lines.push('## New transitions', '')
    for (const e of overlay.addedEdges) lines.push(edgeLine(e))
    lines.push('')
  }
  if (overlay.editedEdges.length > 0) {
    lines.push('## Edited transitions', '')
    for (const e of overlay.editedEdges) lines.push(edgeLine(e))
    lines.push('')
  }
  if (overlay.removedRefs.length > 0) {
    lines.push('## Removed', '')
    for (const id of overlay.removedRefs) lines.push(`- ${labelOf(id)} (${id})`)
    lines.push('')
  }

  const planned = overlay.addedNodes.length + overlay.addedEdges.length + overlay.editedEdges.length + overlay.removedRefs.length
  if (planned === 0) lines.push('_No planned changes yet — add screens and transitions to the overlay._')
  return lines.join('\n').trimEnd() + '\n'
}
