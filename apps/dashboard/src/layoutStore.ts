// Persisted canvas layout: save/restore the user's dragged TOP-LEVEL node positions per
// graph identity. Control/band nodes are parent-relative (extent:'parent') and must NOT
// round-trip, so only nodes without a parent are stored. Pure + unit-tested; the React
// Flow wiring (read live nodes, re-seed) lives in GraphCanvas.

import type { UiGraph } from '@uigraph/core'

export interface XY {
  x: number
  y: number
}
export type Positions = Record<string, XY>
interface SavedLayout {
  v: 1
  positions: Positions
}

/** A cheap deterministic string fold (fnv1a-ish) for the layout key's node-set hash. */
function fold(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/**
 * The localStorage key for a graph's saved layout. Identity is the SORTED set of top-level
 * (non-control) node ids plus the adapter + commit — so adding/removing a screen yields a
 * new key (a stale save simply won't match), while re-styling/selecting/expanding does not.
 */
export function layoutStorageKey(graph: UiGraph): string {
  const ids = graph.nodes
    .filter((n) => n.kind !== 'control')
    .map((n) => n.id)
    .sort()
  const adapter = graph.meta?.adapter ?? 'graph'
  const commit = graph.meta?.commit ?? 'nocommit'
  return `uigraph.layout.${adapter}.${commit}.${fold(ids.join('|'))}`
}

/** Serialize a positions map to a versioned JSON string for storage. */
export function serializePositions(positions: Positions): string {
  return JSON.stringify({ v: 1, positions } satisfies SavedLayout)
}

/** Parse a stored layout; returns null for absent/garbage/wrong-version (never throws). */
export function parsePositions(raw: string | null): Positions | null {
  if (raw === null) return null
  try {
    const o = JSON.parse(raw) as Partial<SavedLayout>
    if (o === null || typeof o !== 'object' || o.v !== 1 || typeof o.positions !== 'object' || o.positions === null) return null
    return o.positions
  } catch {
    return null
  }
}

/**
 * Overlay saved positions onto freshly laid-out nodes: a top-level node present in the save
 * gets its saved position; a node with a parent (control/band) or absent from the save keeps
 * its dagre position. Null save = unchanged.
 */
export function applySaved<T extends { id: string; position: XY; parentId?: string }>(laid: T[], saved: Positions | null): T[] {
  if (saved === null) return laid
  return laid.map((n) => (n.parentId === undefined && saved[n.id] ? { ...n, position: saved[n.id] } : n))
}
