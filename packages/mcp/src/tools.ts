// Model-free tool logic for the @uigraph/mcp server (milestone M5). Every tool
// here is a PURE function over a small ToolContext { dir } plus its args, built
// on @uigraph/core + @uigraph/core/node. No LLM is ever called and no MCP
// transport is touched, so these are directly unit-testable without a server.
// src/server.ts wires these to the SDK; the bulk of the value lives here.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GraphEdge, GraphNode, Modality, Overlay, Proposal, UiGraph } from '@uigraph/core'
import { diffGraphs, emptyOverlay, hashValue, mergeOverlay, planPath, validateMerged, validateOverlay } from '@uigraph/core'
import type { GraphDiff } from '@uigraph/core'
import { loadGraph, loadOverlay, loadProposals, saveOverlay } from '@uigraph/core/node'

/**
 * Where a server instance is rooted: a workspace directory holding
 * `ui-graph.json` (base), an optional `ui-graph.overlay.json` (manual overlay),
 * and an append-only `observations.log.jsonl`.
 */
export interface ToolContext {
  dir: string
}

/** Standard file names inside a uigraph workspace directory. */
export const BASE_FILE = 'ui-graph.json'
export const OVERLAY_FILE = 'ui-graph.overlay.json'
export const OBSERVATIONS_FILE = 'observations.log.jsonl'

/** Absolute path to the base graph file for a context. */
export function baseGraphPath(ctx: ToolContext): string {
  return join(ctx.dir, BASE_FILE)
}

/** Absolute path to the manual overlay file for a context. */
export function overlayPath(ctx: ToolContext): string {
  return join(ctx.dir, OVERLAY_FILE)
}

/** Absolute path to the observation log file for a context. */
export function observationsPath(ctx: ToolContext): string {
  return join(ctx.dir, OBSERVATIONS_FILE)
}

/**
 * Load the base graph and apply the overlay if one exists on disk, returning the
 * merged UiGraph the agent should see. The base file is never mutated.
 */
export function loadMergedGraph(ctx: ToolContext): UiGraph {
  const base = loadGraph(baseGraphPath(ctx))
  const op = overlayPath(ctx)
  if (!existsSync(op)) return base
  const overlay = loadOverlay(op)
  if (overlay.base && overlay.base !== hashValue(base)) {
    throw new Error(
      `stale overlay: it was authored against base ${overlay.base}, but the current base hashes to ${hashValue(base)} — re-author or discard the overlay`,
    )
  }
  const merged = mergeOverlay(base, overlay)
  const errs = validateMerged(merged)
  if (errs.length > 0) throw new Error(`merged graph is invalid:\n  ${errs.map((e) => e.message).join('\n  ')}`)
  return merged
}

/** The merged graph plus node/edge counts, the payload returned by get_graph. */
export interface GetGraphResult {
  version: 0
  meta: UiGraph['meta']
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeCount: number
  edgeCount: number
}

/**
 * Serve the merged (base + overlay) graph to the agent as plain JSON, including
 * node and edge counts so a consumer need not recount.
 */
export function getGraph(ctx: ToolContext): GetGraphResult {
  const g = loadMergedGraph(ctx)
  return {
    version: g.version,
    meta: g.meta,
    nodes: g.nodes,
    edges: g.edges,
    nodeCount: g.nodes.length,
    edgeCount: g.edges.length,
  }
}

/** Standard file name for the quarantined Tier-2 proposals sidecar. */
export const PROPOSALS_FILE = 'proposals.json'

/** Absolute path to the proposals sidecar for a context. */
export function proposalsPath(ctx: ToolContext): string {
  return join(ctx.dir, PROPOSALS_FILE)
}

/** Optional filters for get_proposals so an agent can request a focused slice. */
export interface GetProposalsArgs {
  screen?: string
  category?: string
  evidencedOnly?: boolean
  minConfidence?: number
}

/** get_proposals result: the filtered quarantined proposals plus quick aggregates. */
export interface GetProposalsResult {
  total: number
  evidenced: number
  byCategory: Record<string, number>
  proposals: Proposal[]
}

/**
 * Serve the quarantined Tier-2 proposals (the reviewer agent's long-tail
 * hypotheses) to the connecting agent, with optional filters. These are
 * possibilities to explore/confirm — NOT proven edges; an agent should treat them
 * as leads and confirm via runtime observation before trusting them.
 */
export function getProposals(ctx: ToolContext, args: GetProposalsArgs = {}): GetProposalsResult {
  const path = proposalsPath(ctx)
  const all: Proposal[] = existsSync(path) ? loadProposals(path).proposals : []
  const filtered = all.filter(
    (p) =>
      (args.screen === undefined || p.screen === args.screen) &&
      (args.category === undefined || p.category === args.category) &&
      (args.evidencedOnly !== true || p.evidenced) &&
      (args.minConfidence === undefined || p.confidence >= args.minConfidence),
  )
  const byCategory: Record<string, number> = {}
  for (const p of filtered) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1
  return {
    total: filtered.length,
    evidenced: filtered.filter((p) => p.evidenced).length,
    byCategory,
    proposals: filtered,
  }
}

/** Arguments for plan_path: source/target node ids and optional allowed modalities. */
export interface PlanPathArgs {
  from: string
  to: string
  allow?: Modality[]
}

/** One leg of a planned route, flattened to labels the agent can read. */
export interface PlanPathStep {
  edgeId: string
  from: string
  to: string
  fromLabel: string
  toLabel: string
  event: string
  guard: string | null
  modality: Modality
}

/** plan_path result: either an ordered list of steps or a clear "no path" signal. */
export interface PlanPathResult {
  found: boolean
  from: string
  to: string
  steps: PlanPathStep[]
}

/**
 * Plan a route over the merged graph via core planPath, flattening each step to
 * readable labels. Returns `found: false` with no steps when the target is
 * unreachable under the allowed modalities.
 */
export function planPathTool(ctx: ToolContext, args: PlanPathArgs): PlanPathResult {
  const g = loadMergedGraph(ctx)
  const path = planPath(g, args.from, args.to, args.allow !== undefined ? { allow: args.allow } : {})
  if (path === null) return { found: false, from: args.from, to: args.to, steps: [] }
  const steps: PlanPathStep[] = path.map((s) => ({
    edgeId: s.edge.id,
    from: s.from.id,
    to: s.to.id,
    fromLabel: s.from.label,
    toLabel: s.to.label,
    event: s.edge.event,
    guard: s.edge.guard,
    modality: s.edge.modality,
  }))
  return { found: true, from: args.from, to: args.to, steps }
}

/** A manual edit applied to the overlay only; one of four discriminated ops. */
export type UpdateOp =
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'addEdge'; edge: GraphEdge }
  | { kind: 'editEdge'; edge: GraphEdge }
  | { kind: 'remove'; id: string }

/** Arguments for update_graph: a single overlay edit. */
export interface UpdateGraphArgs {
  op: UpdateOp
}

/** update_graph result: the op applied and the overlay's element counts after saving. */
export interface UpdateGraphResult {
  applied: UpdateOp['kind']
  addedNodes: number
  addedEdges: number
  editedEdges: number
  removedRefs: number
}

/**
 * Load the manual overlay for a context, creating an empty one bound to the
 * current base hash when none exists. Edits target the overlay exclusively so
 * the base graph is never touched.
 */
function loadOrInitOverlay(ctx: ToolContext): Overlay {
  const op = overlayPath(ctx)
  if (existsSync(op)) return loadOverlay(op)
  const base = loadGraph(baseGraphPath(ctx))
  return emptyOverlay(hashValue(base))
}

/**
 * Force an edge to `source: 'manual'`, the only provenance the overlay accepts.
 * Edits arrive from an agent and must not claim static/runtime origin, nor a
 * proven `must` modality — a human/agent assertion is at most a `may`-edge.
 */
function asManualEdge(edge: GraphEdge): GraphEdge {
  return { ...edge, source: 'manual', modality: edge.modality === 'must' ? 'may' : edge.modality, witness: undefined }
}

/**
 * Apply a manual edit to the OVERLAY only (never the base), validate the result
 * with validateOverlay, and persist it. Supports addNode, addEdge, editEdge, and
 * remove (by id). Throws if the resulting overlay is invalid.
 */
export function updateGraph(ctx: ToolContext, args: UpdateGraphArgs): UpdateGraphResult {
  const overlay = loadOrInitOverlay(ctx)
  const op = args.op

  switch (op.kind) {
    case 'addNode':
      overlay.addedNodes.push(op.node)
      break
    case 'addEdge':
      overlay.addedEdges.push(asManualEdge(op.edge))
      break
    case 'editEdge':
      overlay.editedEdges.push(asManualEdge(op.edge))
      break
    case 'remove':
      overlay.removedRefs.push(op.id)
      break
  }

  const errs = validateOverlay(overlay)
  if (errs.length > 0) throw new Error(`Invalid overlay after ${op.kind}:\n  ${errs.map((e) => e.message).join('\n  ')}`)

  saveOverlay(overlayPath(ctx), overlay)
  return {
    applied: op.kind,
    addedNodes: overlay.addedNodes.length,
    addedEdges: overlay.addedEdges.length,
    editedEdges: overlay.editedEdges.length,
    removedRefs: overlay.removedRefs.length,
  }
}

/** Arguments for report_observation: a witnessed runtime transition, logged only. */
export interface ReportObservationArgs {
  from: string
  to: string
  event: string
  outcome: string
}

/** A single recorded observation line, with the server-stamped timestamp. */
export interface ObservationEntry {
  ts: string
  from: string
  to: string
  event: string
  outcome: string
}

/**
 * Append a runtime observation as one JSON line to observations.log.jsonl
 * (append-only; created if absent) and return the recorded entry. v1 has no
 * replay engine — observations are logged, never folded into the base graph.
 */
export function reportObservation(ctx: ToolContext, args: ReportObservationArgs): ObservationEntry {
  const entry: ObservationEntry = {
    ts: new Date().toISOString(),
    from: args.from,
    to: args.to,
    event: args.event,
    outcome: args.outcome,
  }
  appendFileSync(observationsPath(ctx), JSON.stringify(entry) + '\n', 'utf8')
  return entry
}

/** Arguments for diff: two graph file paths to compare. */
export interface DiffArgs {
  a: string
  b: string
}

/**
 * Diff two graph files by stable id via core diffGraphs, returning the structured
 * diff (added/removed nodes+edges and per-edge changed-field lists).
 */
export function diffTool(args: DiffArgs): GraphDiff {
  const a = loadGraph(args.a)
  const b = loadGraph(args.b)
  return diffGraphs(a, b)
}

/**
 * Read an observation log into an array of entries (one per line). Tolerant of a
 * missing file (returns []) and of blank trailing lines.
 */
export function readObservations(ctx: ToolContext): ObservationEntry[] {
  const op = observationsPath(ctx)
  if (!existsSync(op)) return []
  return readFileSync(op, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ObservationEntry)
}
