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

/**
 * The temporal "since last map" diff result: a single shape shared by the CLI, the MCP
 * tool, and the serve /api/changes endpoint. `state` discriminates: 'no-current' (the
 * workspace was never mapped), 'no-prior' (mapped exactly once — nothing to compare yet),
 * 'ok' (a real delta in `diff`). Timestamps are null when unknown (a graph that predates
 * fingerprinting, e.g. a migrate import, carries an empty mappedAt → null here).
 */
export interface SinceLastDiff {
  state: 'ok' | 'no-prior' | 'no-current'
  diff: GraphDiff | null
  previousMappedAt: string | null
  currentMappedAt: string | null
  detail: string | null
}

/**
 * Compute the temporal diff from plain data (NOT the Store, so this stays pure + browser-
 * safe and is the single source of the 3-state branch for every consumer). Orientation is
 * load-bearing: diffGraphs(previous, current) so added* = what the new code introduced and
 * removed* = what it deleted. An empty-string previous timestamp normalizes to null.
 */
export function diffSinceLast(
  current: UiGraph | null,
  currentMappedAt: string | null,
  previous: { graph: UiGraph; mappedAt: string } | null,
): SinceLastDiff {
  if (current === null) {
    return { state: 'no-current', diff: null, previousMappedAt: null, currentMappedAt: null, detail: 'no graph in this workspace — run `uigraph map` first' }
  }
  if (previous === null) {
    return { state: 'no-prior', diff: null, previousMappedAt: null, currentMappedAt: currentMappedAt, detail: 'only one map — re-map after a code change to see what it did to the UI graph' }
  }
  return {
    state: 'ok',
    diff: diffGraphs(previous.graph, current),
    previousMappedAt: previous.mappedAt === '' ? null : previous.mappedAt,
    currentMappedAt: currentMappedAt,
    detail: null,
  }
}
