// Model-free tool logic for the @uigraph/mcp server (milestone M5). Every tool
// here is a PURE function over a small ToolContext { dir } plus its args, built
// on @uigraph/core + @uigraph/core/node. No LLM is ever called and no MCP
// transport is touched, so these are directly unit-testable without a server.
// src/server.ts wires these to the SDK; the bulk of the value lives here.

import { join } from 'node:path'
import type { GraphEdge, GraphNode, Modality, Overlay, Proposal, UiGraph } from '@uigraph/core'
import { applyObservations, buildCoverage, buildGrounding, buildResolution, buildSpecPlan, diffGraphs, emptyOverlay, hashValue, mergeOverlay, nextToVerify, planPath, renderPlaywrightSpec, validateMerged, validateOverlay } from '@uigraph/core'
import type { CoverageReport, Grounding, ProposalGraph, ProposalStatus, ResolutionReport, ScreenGrounding, VerifyTarget } from '@uigraph/core'
import type { Observation } from '@uigraph/core'
import type { GraphDiff } from '@uigraph/core'
import { loadGraph, openStore, type Store } from '@uigraph/core/node'

/**
 * Where a server instance is rooted: a workspace directory holding
 * `ui-graph.json` (base), an optional `ui-graph.overlay.json` (manual overlay),
 * and an append-only `observations.log.jsonl`.
 */
export interface ToolContext {
  dir: string
}

/** The SQLite database file that is the workspace's canonical store. */
export const DB_FILE = 'uigraph.db'

/** Absolute path to the workspace SQLite database for a context. */
export function dbPath(ctx: ToolContext): string {
  return join(ctx.dir, DB_FILE)
}

/** Open the workspace store, run `fn`, and always close it. */
function withStore<T>(ctx: ToolContext, fn: (store: Store) => T): T {
  const store = openStore(dbPath(ctx))
  try {
    return fn(store)
  } finally {
    store.close()
  }
}

/**
 * Load the base graph, apply the manual overlay (if any) and fold in runtime
 * observations, returning the merged UiGraph the agent should see. The stored base
 * is never mutated. Reads from the workspace SQLite database.
 */
export function loadMergedGraph(ctx: ToolContext): UiGraph {
  return withStore(ctx, (store) => {
    const base = store.getBaseGraph()
    if (base === null) throw new Error(`no base graph in ${dbPath(ctx)} — run \`uigraph map\` or \`uigraph migrate\` first`)
    let merged = base
    const overlay = store.getOverlay()
    if (overlay !== null) {
      if (overlay.base && overlay.base !== hashValue(base)) {
        throw new Error(
          `stale overlay: it was authored against base ${overlay.base}, but the current base hashes to ${hashValue(base)} — re-author or discard the overlay`,
        )
      }
      merged = mergeOverlay(base, overlay)
    }
    merged = applyObservations(merged, store.getObservations())
    const errs = validateMerged(merged)
    if (errs.length > 0) throw new Error(`merged graph is invalid:\n  ${errs.map((e) => e.message).join('\n  ')}`)
    return merged
  })
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

/** Optional filters for get_proposals so an agent can request a focused slice. */
export interface GetProposalsArgs {
  screen?: string
  category?: string
  evidencedOnly?: boolean
  minConfidence?: number
  status?: ProposalStatus
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
  const filtered = withStore(ctx, (store) =>
    store.queryProposals({
      ...(args.screen !== undefined ? { screen: args.screen } : {}),
      ...(args.category !== undefined ? { category: args.category } : {}),
      ...(args.evidencedOnly !== undefined ? { evidencedOnly: args.evidencedOnly } : {}),
      ...(args.minConfidence !== undefined ? { minConfidence: args.minConfidence } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    }),
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

/** Optional filter for get_grounding: restrict the digest to a single screen. */
export interface GetGroundingArgs {
  screen?: string
}

/**
 * Serve the Tier-2 grounding digest (controls + their wired events/effects, and
 * the already-witnessed transitions, per screen) derived from the merged graph.
 * A reviewer agent feeds this to itself to propose only the uncovered long tail,
 * cite real controls/effects, and prune hypotheses that reference nothing real.
 */
export function getGrounding(ctx: ToolContext, args: GetGroundingArgs = {}): Grounding {
  const g = buildGrounding(loadMergedGraph(ctx))
  if (args.screen === undefined) return g
  return { ...g, screens: g.screens.filter((s) => s.screen === args.screen) }
}

/**
 * Serve the quarantined proposal graph (proposals projected to nodes + edges,
 * stored separately from the proven IR). Lets an agent query proposed transitions
 * AS a graph — distinct from get_proposals (the raw quarantined list).
 */
export function getProposalGraph(ctx: ToolContext): ProposalGraph {
  return withStore(ctx, (store) => store.getProposalGraph())
}

/** Arguments for describe_screen: the screen node id to describe. */
export interface DescribeScreenArgs {
  screen: string
}

/** describe_screen result: a screen's controls + proven AND proposed actions, or an error. */
export type ScreenDescription = (ScreenGrounding & { proposedEdges: ProposalGraph['edges'] }) | { error: string }

/**
 * Describe one screen as an action surface for an agent: its controls (with stable
 * selectors, events, effects), the transitions PROVEN out of it (knownEdges), and
 * the PROPOSED transitions out of it (proposedEdges). Answers "I am on screen X —
 * what can I do and where does each action lead?" without dumping the whole graph.
 */
export function describeScreen(ctx: ToolContext, args: DescribeScreenArgs): ScreenDescription {
  const grounding = buildGrounding(loadMergedGraph(ctx))
  const screen = grounding.screens.find((s) => s.screen === args.screen)
  if (screen === undefined) return { error: `no screen "${args.screen}" in the graph` }
  const proposed = getProposalGraph(ctx).edges.filter((e) => e.from === args.screen)
  return { ...screen, proposedEdges: proposed }
}

/** get_coverage result: both the strict runtime metric and the accounted-for metric, plus parked edges. */
export function getCoverage(ctx: ToolContext): CoverageReport {
  return withStore(ctx, (store) => buildCoverage(loadMergedGraph(ctx), store.getParkedEdges()))
}

/** Arguments for next_to_verify: an optional cap on the returned worklist size. */
export interface NextToVerifyArgs {
  limit?: number
}

/**
 * The ranked worklist of transitions to confirm at runtime next: dynamic-target
 * (`unknown`) edges, then `may` edges, then proposed transitions — minus anything
 * already runtime-witnessed. Drives a Tier-3 runner / an agent's report_observation.
 */
export function nextToVerifyTool(ctx: ToolContext, args: NextToVerifyArgs = {}): VerifyTarget[] {
  const parkedIds = new Set(withStore(ctx, (store) => store.getParkedEdges()).map((p) => p.edgeId))
  return nextToVerify(loadMergedGraph(ctx), getProposalGraph(ctx), args.limit, parkedIds)
}

/** Arguments for gen_spec: the from/to node ids and an optional base URL. */
export interface GenSpecArgs {
  from: string
  to: string
  baseUrl?: string
}

/** gen_spec result: the rendered Playwright spec + its leg count, or an error. */
export type GenSpecResult = { spec: string; legs: number } | { error: string }

/**
 * Generate a Playwright e2e spec for the route from one node to another: plan the
 * path over the merged graph, then render each leg to a locator action (from the
 * control's stable selector) + assertions (target URL, dialog, request).
 */
export function genSpec(ctx: ToolContext, args: GenSpecArgs): GenSpecResult {
  const graph = loadMergedGraph(ctx)
  const steps = planPath(graph, args.from, args.to)
  if (steps === null) return { error: `no path from ${args.from} to ${args.to}` }
  const plan = buildSpecPlan(graph, steps, { baseUrl: args.baseUrl ?? '', title: `${args.from} → ${args.to}` })
  return { spec: renderPlaywrightSpec(plan), legs: plan.legs.length }
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

/** A manual edit applied to the overlay only; one of five discriminated ops. */
export type UpdateOp =
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'editNode'; node: GraphNode }
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
  editedNodes: number
  addedEdges: number
  editedEdges: number
  removedRefs: number
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
 * with validateOverlay, and persist it to the store. Supports addNode, addEdge,
 * editEdge, and remove (by id). Throws if the resulting overlay is invalid.
 */
export function updateGraph(ctx: ToolContext, args: UpdateGraphArgs): UpdateGraphResult {
  return withStore(ctx, (store) => {
    const base = store.getBaseGraph()
    if (base === null) throw new Error(`no base graph in ${dbPath(ctx)} — run \`uigraph map\` or \`uigraph migrate\` first`)
    const overlay: Overlay = store.getOverlay() ?? emptyOverlay(hashValue(base))
    const op = args.op

    switch (op.kind) {
      case 'addNode':
        overlay.addedNodes.push(op.node)
        break
      case 'editNode':
        overlay.editedNodes = [...(overlay.editedNodes ?? []).filter((n) => n.id !== op.node.id), op.node]
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

    store.setOverlay(overlay)
    return {
      applied: op.kind,
      addedNodes: overlay.addedNodes.length,
      editedNodes: (overlay.editedNodes ?? []).length,
      addedEdges: overlay.addedEdges.length,
      editedEdges: overlay.editedEdges.length,
      removedRefs: overlay.removedRefs.length,
    }
  })
}

/** The set of named planning scenarios (overlays) and which one is active. */
export interface ScenariosResult {
  active: string
  names: string[]
}

/** List the planning scenarios (named overlays) and the active one. */
export function listScenarios(ctx: ToolContext): ScenariosResult {
  return withStore(ctx, (store) => ({ active: store.getActiveScenario(), names: store.listScenarios() }))
}

/** Arguments for set_scenario: the scenario name to activate (created empty if new). */
export interface SetScenarioArgs {
  name: string
}

/**
 * Switch the active planning scenario — subsequent overlay edits + the merged graph
 * target it, so you can draft/toggle/compare features independently. Creates an
 * empty scenario if the name is new. Returns the active name + the full list.
 */
export function setScenario(ctx: ToolContext, args: SetScenarioArgs): ScenariosResult {
  return withStore(ctx, (store) => {
    store.setActiveScenario(args.name)
    return { active: store.getActiveScenario(), names: store.listScenarios() }
  })
}

/**
 * Arguments for report_observation: the result of actually attempting a
 * transition at runtime (e.g. via Playwright). `outcome:'confirmed'` means the
 * transition was observed to happen — it becomes a witnessed runtime edge;
 * `'refuted'` means it did not, and produces no edge. `proposalId` links the
 * observation back to the Tier-2 proposal it verifies.
 */
export interface ReportObservationArgs {
  from: string
  to: string
  event: string
  outcome: 'confirmed' | 'refuted'
  effect?: string
  proposalId?: string
  screenshot?: string
}

/** A recorded observation line (the core Observation plus a server timestamp). */
export type ObservationEntry = Observation

/**
 * report_observation result: the recorded entry, any proposals it reconciled, and
 * `dropped` — true when a CONFIRMED landing references a `to` node not yet in the
 * graph, so the fold minted no edge (the runner must add the node, e.g. via
 * update_graph, then re-report). A dropped observation must never be counted as
 * progress or silently parked.
 */
export type ReportObservationResult = ObservationEntry & { reconciled: { id: string; status: ProposalStatus }[]; dropped: boolean }

/**
 * Append a runtime observation to the workspace store (append-only observations
 * table), reconcile any proposal it witnesses (confirmed→archived, refuted→
 * withdrawn), and return the entry plus the reconciled proposals. A confirmed
 * observation is independently folded into the served graph by loadMergedGraph
 * (Tier-3): the observation — not the original guess — enters the graph as a
 * witnessed edge. Two derivations from one witness; no proposal ever becomes an edge.
 */
export function reportObservation(ctx: ToolContext, args: ReportObservationArgs): ReportObservationResult {
  const ts = new Date().toISOString()
  const entry: ObservationEntry = {
    id: `o_${hashValue({ from: args.from, to: args.to, event: args.event, ts }).slice(0, 10)}`,
    ts,
    from: args.from,
    to: args.to,
    event: args.event,
    outcome: args.outcome,
    ...(args.effect ? { effect: args.effect } : {}),
    ...(args.proposalId ? { proposalId: args.proposalId } : {}),
    ...(args.screenshot ? { screenshot: args.screenshot } : {}),
  }
  const { reconciled, dropped } = withStore(ctx, (store) => {
    store.appendObservation(entry)
    const base = store.getBaseGraph()
    // a confirmed landing on a node not in the graph mints no edge (applyObservations skips it)
    const droppedFlag = args.outcome === 'confirmed' && base !== null && !base.nodes.some((n) => n.id === args.to)
    return { reconciled: store.reconcileFromObservations(), dropped: droppedFlag }
  })
  return { ...entry, reconciled, dropped }
}

/** reconcile_proposals result: how many statuses changed + the proposal resolution snapshot. */
export interface ReconcileResult {
  changed: { id: string; status: ProposalStatus }[]
  resolution: ResolutionReport
}

/**
 * Re-derive every proposal's status from the observation log (idempotent) and
 * return what changed plus the resolution snapshot. Use after observations are
 * appended out-of-band (e.g. by the Tier-3 runner) to re-sync the proposal set.
 */
export function reconcileProposalsTool(ctx: ToolContext): ReconcileResult {
  return withStore(ctx, (store) => {
    const changed = store.reconcileFromObservations()
    return { changed, resolution: buildResolution(store.queryProposals()) }
  })
}

/** Arguments for withdraw_proposal / mark_unverifiable: the proposal id + a reason. */
export interface ResolveProposalArgs {
  id: string
  reason: string
}

/**
 * Withdraw a proposal the agent has judged hallucinated/impossible (no refuting
 * observation needed): set status 'rejected' with a reason, removing it from the
 * active worklist. NEVER touches the proven graph — a proposal cannot become an edge.
 */
export function withdrawProposal(ctx: ToolContext, args: ResolveProposalArgs): { id: string; status: ProposalStatus; reason: string } {
  withStore(ctx, (store) => store.setProposalStatus(args.id, 'rejected', args.reason))
  return { id: args.id, status: 'rejected', reason: args.reason }
}

/** Arguments for park_edge: the edge id + a mandatory reason. */
export interface ParkEdgeArgs {
  id: string
  reason: string
}

/**
 * Park a may/unknown edge out of the verify worklist with an auditable reason (an
 * edge that cannot be reached/driven now — feature flag, external dep, dead code,
 * dynamic target with no reachable concrete landing). It becomes "accounted-for"
 * but is NEVER counted as runtime-verified and NEVER edits the edge (no modality,
 * witness, or source change). The proven graph is untouched.
 */
export function parkEdge(ctx: ToolContext, args: ParkEdgeArgs): { id: string; reason: string } {
  withStore(ctx, (store) => store.parkEdge(args.id, args.reason, 'agent'))
  return { id: args.id, reason: args.reason }
}

/** Un-park an edge, returning it to the verify worklist. */
export function unparkEdge(ctx: ToolContext, args: { id: string }): { id: string; unparked: boolean } {
  return { id: args.id, unparked: withStore(ctx, (store) => store.unparkEdge(args.id)) }
}

/**
 * Park a plausible-but-undrivable proposal as 'unverifiable' with a reason: it
 * leaves the active worklist (so the loop can terminate) but stays queryable for a
 * human. Distinct from withdraw (which marks a disproven/hallucinated lead).
 */
export function markUnverifiable(ctx: ToolContext, args: ResolveProposalArgs): { id: string; status: ProposalStatus; reason: string } {
  withStore(ctx, (store) => store.setProposalStatus(args.id, 'unverifiable', args.reason))
  return { id: args.id, status: 'unverifiable', reason: args.reason }
}

/** get_loop_status result: the deterministic DONE signal for the reconciliation loop. */
export interface LoopStatus {
  coverage: CoverageReport
  resolution: ResolutionReport
  worklistSize: number
  openEdges: CoverageReport['open']
  loopDone: boolean
}

/**
 * Compose the model-free loop-completion signal: 100% = every uncertain edge
 * runtime-witnessed AND every proposal resolved. loopDone is true iff the verify
 * worklist is empty AND no 'proposed' proposals remain. The LLM loops until this
 * flips true (or it parks the stuck remainder via mark_unverifiable).
 */
export function getLoopStatus(ctx: ToolContext): LoopStatus {
  const merged = loadMergedGraph(ctx)
  const { coverage, resolution, parkedIds } = withStore(ctx, (store) => ({
    coverage: buildCoverage(merged, store.getParkedEdges()),
    resolution: buildResolution(store.queryProposals()),
    parkedIds: new Set(store.getParkedEdges().map((p) => p.edgeId)),
  }))
  const worklist = nextToVerify(merged, getProposalGraph(ctx), undefined, parkedIds)
  // done = no OPEN edges (accounted-for via witness/park) AND no open proposals.
  return { coverage, resolution, worklistSize: worklist.length, openEdges: coverage.open, loopDone: coverage.open.length === 0 && resolution.openCount === 0 }
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

/** Read all recorded observations from the workspace store, in insertion order. */
export function readObservations(ctx: ToolContext): ObservationEntry[] {
  return withStore(ctx, (store) => store.getObservations())
}
