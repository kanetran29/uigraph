// Model-free tool logic for the @uigraph/mcp server (milestone M5). Every tool
// here is a PURE function over a small ToolContext { dir } plus its args, built
// on @uigraph/core + @uigraph/core/node. No LLM is ever called and no MCP
// transport is touched, so these are directly unit-testable without a server.
// src/server.ts wires these to the SDK; the bulk of the value lives here.

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { EdgeWithTier, GraphEdge, GraphNode, Modality, Overlay, Proposal, Source, TrustTier, UiGraph } from '@uigraph/core'
import { applyObservations, buildCoverage, buildFrontier, buildGrounding, buildResolution, buildSpecPlan, classifyEffectRisk, diffGraphs, diffSinceLast, emptyOverlay, getTierLabel, hashValue, mergeOverlay, nextToVerify, planPath, projectTrustTier, renderPlaywrightSpec, validateMerged, validateOverlay } from '@uigraph/core'
import type { StalenessReport } from '@uigraph/core'
import type { CoverageReport, Grounding, GroundedEdge, ProposalGraph, ProposalGraphEdge, ProposalStatus, ResolutionReport, ScreenGrounding, VerifyTarget } from '@uigraph/core'
import type { Observation } from '@uigraph/core'
import type { GraphDiff, SinceLastDiff } from '@uigraph/core'
import { loadGraph, openStore, fingerprintSources, compareFingerprint, type Store } from '@uigraph/core/node'

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
  edges: EdgeWithTier[]
  nodeCount: number
  edgeCount: number
}

/**
 * Serve the merged (base + overlay) graph to the agent as plain JSON, including
 * node and edge counts so a consumer need not recount. Each edge is enriched on
 * read with its projected trust tier (spec §3) so the agent knows how far to lean
 * on each case; the projection is derived, never stored on the IR.
 */
export function getGraph(ctx: ToolContext): GetGraphResult {
  const g = loadMergedGraph(ctx)
  const edges = g.edges.map((e) => ({ ...e, trustTier: projectTrustTier(e) }))
  return {
    version: g.version,
    meta: g.meta,
    nodes: g.nodes,
    edges,
    nodeCount: g.nodes.length,
    edgeCount: edges.length,
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

/** A screen's known edge enriched on read with its projected trust tier. */
export type KnownEdgeWithTier = GroundedEdge & { trustTier: TrustTier }

/** A screen's proposed edge enriched on read with its (always 'proposed') trust tier. */
export type ProposedEdgeWithTier = ProposalGraph['edges'][number] & { trustTier: TrustTier }

/** describe_screen result: a screen's controls + proven AND proposed actions, or an error. */
export type ScreenDescription =
  | (Omit<ScreenGrounding, 'knownEdges'> & { knownEdges: KnownEdgeWithTier[]; proposedEdges: ProposedEdgeWithTier[] })
  | { error: string }

/**
 * Project a trust tier from a grounded edge's `source` + `modality` strings. A
 * GroundedEdge is a flattened digest (no GraphEdge object), so we tier from those
 * two fields only — sufficient because the witness is irrelevant to the tier
 * (static must is `proven` per spec, witness or not).
 */
function tierOfGroundedEdge(e: GroundedEdge): TrustTier {
  const synthetic: GraphEdge = {
    id: '', from: e.from, to: e.to, event: e.event, guard: e.guard, effect: e.effect,
    modality: e.modality as Modality, source: e.source as GraphEdge['source'], confidence: 1,
  }
  return projectTrustTier(synthetic)
}

/**
 * Describe one screen as an action surface for an agent: its controls (with stable
 * selectors, events, effects), the transitions PROVEN out of it (knownEdges), and
 * the PROPOSED transitions out of it (proposedEdges). Each edge carries its trust
 * tier (spec §3) so the agent knows how far to lean. Answers "I am on screen X —
 * what can I do and where does each action lead?" without dumping the whole graph.
 */
export function describeScreen(ctx: ToolContext, args: DescribeScreenArgs): ScreenDescription {
  const grounding = buildGrounding(loadMergedGraph(ctx))
  const screen = grounding.screens.find((s) => s.screen === args.screen)
  if (screen === undefined) return { error: `no screen "${args.screen}" in the graph` }
  const knownEdges = screen.knownEdges.map((e) => ({ ...e, trustTier: tierOfGroundedEdge(e) }))
  const proposedEdges = getProposalGraph(ctx).edges
    .filter((e) => e.from === args.screen)
    .map((e) => ({ ...e, trustTier: projectTrustTier({ id: e.id, from: e.from, to: e.to, event: e.event, guard: e.guard, effect: e.effect, modality: e.modality, source: 'manual', confidence: 0 }, 'proposed') }))
  return { ...screen, knownEdges, proposedEdges }
}

/**
 * get_coverage result: the full CoverageReport (strict runtime metric, verified
 * metric, accounted-for metric, parked edges) plus a `staleness` summary so the
 * agent never reads coverage numbers without seeing whether the underlying base +
 * sidecars are stale (dangling refs / hash mismatch). Additive: the coverage
 * fields are unchanged; `staleness` is a new sibling.
 */
export type GetCoverageResult = CoverageReport & { staleness: StalenessReport }

/** Coverage of the proven graph plus a staleness summary for the base + its sidecars. */
export function getCoverage(ctx: ToolContext): GetCoverageResult {
  return withStore(ctx, (store) => ({
    ...buildCoverage(loadMergedGraph(ctx), store.getParkedEdges()),
    staleness: store.stalenessReport(),
  }))
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

/**
 * Trust precedence (most-trusted first), the agent-facing read layer's copy of the
 * tier order. It mirrors core's projection enum and is the basis for `minTier`
 * filtering + tier sorting in the case tools; it is a comparison concern of the
 * consumer, not a re-derivation of the projection logic (which stays in core).
 */
const TIER_ORDER: TrustTier[] = ['witnessed', 'proven', 'asserted', 'llm-verified', 'proposed', 'unknown']

/** True when `tier` is at least as trusted as `floor` (lower index = more trusted). */
function tierAtLeast(tier: TrustTier, floor: TrustTier): boolean {
  return TIER_ORDER.indexOf(tier) <= TIER_ORDER.indexOf(floor)
}

/**
 * One behavioral case as served to an agent (spec §3/§8): an out-edge flattened to
 * its event/guard, the behaviorally-distinct outcome (`outcomeClass` = the to-node
 * id, a real screen or a synthesized `ps_*` sub-state), the target's label, the
 * projected `trustTier`, a short `evidence` cite, and the raw modality/source. This
 * answers "what can I do from here and how far can I trust each path?".
 * `irreversible` is the destructive-action gate: true when this case performs a
 * non-undoable effect (delete, pay, submit-order, logout, reset), so an agent can
 * require confirmation before traversal instead of treating every case as safe.
 */
export interface CaseEdge {
  event: string
  guard: string | null
  outcomeClass: string
  toNode: string
  toLabel: string
  trustTier: TrustTier
  evidence: string
  modality: Modality
  source: Source
  irreversible: boolean
}

/**
 * Summarize where the evidence for an edge comes from, for the agent's `evidence`
 * cite: a runtime observation id, a static source location/rule, a manual overlay
 * edit, or (for a quarantined proposal edge) the originating proposal ids.
 */
function evidenceOf(edge: GraphEdge, proposalIds?: string[]): string {
  if (proposalIds !== undefined) return `proposal:${proposalIds.join(',')}`
  const w = edge.witness
  if (w === undefined) return `${edge.source} (no witness)`
  if (w.observationId !== undefined) return `runtime:${w.observationId}`
  if (w.file !== undefined) return `${w.file}${w.loc ? `:${w.loc.line}:${w.loc.col}` : ''}${w.ruleId ? ` (${w.ruleId})` : ''}`
  return edge.source
}

/**
 * Whether a case is destructive/non-undoable. Honors an explicit `irreversible`
 * flag on the edge when present (the IR may carry one), otherwise derives it from
 * the effect string via core's `classifyEffectRisk`. Lets an agent gate dangerous
 * traversals without re-implementing the risk heuristic at the wire.
 */
function isIrreversible(irreversible: boolean | undefined, effect: string | null | undefined): boolean {
  return irreversible ?? classifyEffectRisk(effect)
}

/**
 * Project one merged-graph edge to a CaseEdge: tier from source+modality, label from
 * the node map, evidence from its witness. Used by every case tool so proven/witnessed
 * cases share one rendering.
 */
function graphEdgeToCase(edge: GraphEdge, labelOf: Map<string, string>): CaseEdge {
  return {
    event: edge.event,
    guard: edge.guard,
    outcomeClass: edge.to,
    toNode: edge.to,
    toLabel: labelOf.get(edge.to) ?? edge.to,
    trustTier: projectTrustTier(edge),
    evidence: evidenceOf(edge),
    modality: edge.modality,
    source: edge.source,
    irreversible: isIrreversible(edge.irreversible, edge.effect),
  }
}

/**
 * Project one quarantined proposal-graph edge to a CaseEdge tagged `proposed`. A
 * proposal edge is a `source:'manual'` may/unknown hypothesis carrying the proposal
 * ids it came from; only `proposed`-status proposals materialize into this graph, so
 * the tier is always `proposed`. Its target may be a synthesized `ps_*` sub-state.
 */
function proposalEdgeToCase(pe: ProposalGraphEdge, labelOf: Map<string, string>): CaseEdge {
  return {
    event: pe.event,
    guard: pe.guard,
    outcomeClass: pe.to,
    toNode: pe.to,
    toLabel: labelOf.get(pe.to) ?? pe.to,
    trustTier: 'proposed',
    evidence: evidenceOf({ id: pe.id, from: pe.from, to: pe.to, event: pe.event, guard: pe.guard, effect: pe.effect, modality: pe.modality, source: 'manual', confidence: 0 }, pe.proposalIds),
    modality: pe.modality,
    source: 'manual',
    irreversible: isIrreversible(undefined, pe.effect),
  }
}

/**
 * Build the full case set for a workspace: every merged-graph edge plus every
 * quarantined proposal-graph edge, each rendered as a CaseEdge and sorted by trust
 * precedence (most-trusted first). The single source of cases reused by get_state,
 * list_cases, and get_frontier so the three tools cannot disagree about a case.
 */
function buildCases(ctx: ToolContext): { cases: CaseEdge[]; fromOf: string[] } {
  const g = loadMergedGraph(ctx)
  const labelOf = new Map(g.nodes.map((n) => [n.id, n.label]))
  const proposalEdges = getProposalGraph(ctx).edges
  const cases: CaseEdge[] = []
  const fromOf: string[] = []
  for (const e of g.edges) {
    cases.push(graphEdgeToCase(e, labelOf))
    fromOf.push(e.from)
  }
  for (const pe of proposalEdges) {
    cases.push(proposalEdgeToCase(pe, labelOf))
    fromOf.push(pe.from)
  }
  const order = cases
    .map((c, i) => ({ c, from: fromOf[i] as string }))
    .sort((a, b) => TIER_ORDER.indexOf(a.c.trustTier) - TIER_ORDER.indexOf(b.c.trustTier))
  return { cases: order.map((x) => x.c), fromOf: order.map((x) => x.from) }
}

/** Arguments for get_state: the node id to describe as an action surface. */
export interface GetStateArgs {
  id: string
}

/**
 * get_state result: a node plus all out-edges as trust-tiered cases (spec §8).
 * Answers "what can I do from state X and how far can I trust each path?".
 */
export interface GetStateResult {
  id: string
  label: string
  route: string | null
  nodeKind: GraphNode['kind']
  cases: CaseEdge[]
}

/**
 * Fetch a node and its out-edges rendered as trust-tiered cases. Reuses the merged
 * graph + proposal graph via buildCases and filters to edges leaving `id`. Returns
 * an `{ error }` when the node id is not in the graph (so an invalid id never serves
 * an empty-looking state silently; risk §"outcomeClass must exist").
 */
export function getState(ctx: ToolContext, args: GetStateArgs): GetStateResult | { error: string } {
  const g = loadMergedGraph(ctx)
  const node = g.nodes.find((n) => n.id === args.id)
  if (node === undefined) return { error: `no node "${args.id}" in the graph` }
  const { cases, fromOf } = buildCases(ctx)
  const out = cases.filter((_, i) => fromOf[i] === args.id)
  return { id: node.id, label: node.label, route: node.route, nodeKind: node.kind, cases: out }
}

/**
 * Optional filters for list_cases: `from` (source node id), `outcomeClass` (target
 * node id), and `minTier` (include only cases whose tier is at least the floor).
 */
export interface ListCasesArgs {
  from?: string
  outcomeClass?: string
  minTier?: TrustTier
}

/** list_cases result: the filtered case set plus its total count. */
export interface ListCasesResult {
  total: number
  cases: CaseEdge[]
}

/**
 * Query the full case set with optional `from` / `outcomeClass` / `minTier` filters,
 * each case projected to its trust tier (spec §8). Supports tier-aware planning:
 * `minTier: 'proven'` returns only witnessed/proven cases. Cases stay sorted by
 * trust precedence (most-trusted first).
 */
export function listCases(ctx: ToolContext, args: ListCasesArgs = {}): ListCasesResult {
  const { cases, fromOf } = buildCases(ctx)
  const filtered = cases.filter((c, i) => {
    if (args.from !== undefined && fromOf[i] !== args.from) return false
    if (args.outcomeClass !== undefined && c.outcomeClass !== args.outcomeClass) return false
    if (args.minTier !== undefined && !tierAtLeast(c.trustTier, args.minTier)) return false
    return true
  })
  return { total: filtered.length, cases: filtered }
}

/** A frontier state: the node, how many unknown out-edges it has, and those cases. */
export interface FrontierNode {
  id: string
  label: string
  unknownCount: number
  cases: CaseEdge[]
}

/** Arguments for get_frontier: an optional single-state filter. */
export interface GetFrontierArgs {
  state?: string
}

/** get_frontier result: the frontier states (known-unknowns) plus their count. */
export interface GetFrontierResult {
  total: number
  nodes: FrontierNode[]
}

/**
 * Fetch the frontier — the states with unresolved (`unknown`-modality or
 * dynamic-sink) out-edges (spec §3/§7), reusing core buildFrontier to identify them.
 * Each frontier state carries its `unknown`-tier cases and their count so the agent
 * knows exactly where the map is incomplete and what to probe. Optional `state`
 * filter narrows to one node. The safety spine: the agent is never silently blind.
 */
export function getFrontier(ctx: ToolContext, args: GetFrontierArgs = {}): GetFrontierResult {
  const g = loadMergedGraph(ctx)
  const labelOf = new Map(g.nodes.map((n) => [n.id, n.label]))
  const frontierIds = new Set(buildFrontier(g).states)
  const wanted = args.state !== undefined ? [args.state].filter((id) => frontierIds.has(id)) : [...frontierIds]
  const unknownByFrom = new Map<string, CaseEdge[]>()
  for (const e of g.edges) {
    if (projectTrustTier(e) !== 'unknown') continue
    const list = unknownByFrom.get(e.from) ?? []
    list.push(graphEdgeToCase(e, labelOf))
    unknownByFrom.set(e.from, list)
  }
  const nodes: FrontierNode[] = wanted.map((id) => {
    const cases = unknownByFrom.get(id) ?? []
    return { id, label: labelOf.get(id) ?? id, unknownCount: cases.length, cases }
  })
  return { total: nodes.length, nodes }
}

/**
 * Arguments for plan_path: source/target node ids, optional allowed modalities, and
 * an optional `minTier` floor. `minTier` does not exclude low-trust hops from the
 * search (that could strand the agent); instead any hop below the floor is reported
 * in `tierWarnings` so the agent plans with eyes open (spec §8).
 */
export interface PlanPathArgs {
  from: string
  to: string
  allow?: Modality[]
  minTier?: TrustTier
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

/**
 * plan_path result: either an ordered list of steps or a clear "no path" signal.
 * `tierWarnings` lists any hop whose projected trust tier is below the requested
 * `minTier` floor — present only when a `minTier` was given and some hop fell short.
 */
export interface PlanPathResult {
  found: boolean
  from: string
  to: string
  steps: PlanPathStep[]
  tierWarnings?: string[]
}

/**
 * Plan a route over the merged graph via core planPath, flattening each step to
 * readable labels. Returns `found: false` with no steps when the target is
 * unreachable under the allowed modalities. When `minTier` is given, each step's
 * edge is projected to its trust tier and any hop below the floor is surfaced in
 * `tierWarnings` (the path is still returned — low-trust hops are flagged, never
 * silently dropped, so the agent is never stranded without knowing why; spec §9).
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
  const result: PlanPathResult = { found: true, from: args.from, to: args.to, steps }
  if (args.minTier !== undefined) {
    const warnings = path
      .map((s) => ({ edge: s.edge, tier: projectTrustTier(s.edge) }))
      .filter((x) => !tierAtLeast(x.tier, args.minTier as TrustTier))
      .map((x) => `${x.edge.id} is '${x.tier}' (below minTier '${args.minTier as TrustTier}'): ${getTierLabel(x.tier)}`)
    if (warnings.length > 0) result.tierWarnings = warnings
  }
  return result
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

/** Whether the stored graph is current with its source: fresh / stale / unknown. */
export interface FreshnessResult {
  state: 'fresh' | 'stale' | 'unknown'
  mappedAt?: string
  projectDir?: string
  changed: string[]
  added: string[]
  removed: string[]
  detail?: string
}

/**
 * Compare the source fingerprint stamped at map time against the source now, so an agent
 * knows whether the graph still reflects the code. 'unknown' when never mapped or the
 * mapped source dir isn't reachable from here (a remote/CI map) — it NEVER reports 'fresh'
 * when it cannot recompute, so an agent treats unknown as could-be-stale. Pure report; the
 * agent (per the freshness kit rule) decides whether to notify the user + re-map.
 */
export function getFreshness(ctx: ToolContext): FreshnessResult {
  const fp = withStore(ctx, (store) => store.getFingerprint())
  if (fp === null) {
    return { state: 'unknown', changed: [], added: [], removed: [], detail: 'no fingerprint — run `uigraph map` first' }
  }
  if (!existsSync(fp.projectDir)) {
    return { state: 'unknown', mappedAt: fp.mappedAt, projectDir: fp.projectDir, changed: [], added: [], removed: [], detail: 'mapped source dir is not on this machine — cannot recompute freshness' }
  }
  const diff = compareFingerprint(fp, fingerprintSources(fp.projectDir))
  return { state: diff.stale ? 'stale' : 'fresh', mappedAt: fp.mappedAt, projectDir: fp.projectDir, changed: diff.changed, added: diff.added, removed: diff.removed }
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
 * The temporal "since last map" diff for the bound workspace — what the latest re-map did to
 * the proven UI graph (current base vs the previous map). Distinct from get_freshness (which
 * compares source files to the map, not two maps). The previous base is rotated INSIDE the db,
 * so unlike diff (two file paths) the agent can call this with no arguments after a re-map.
 */
export function diffSinceLastTool(ctx: ToolContext): SinceLastDiff {
  return withStore(ctx, (store) => diffSinceLast(store.getBaseGraph(), store.getFingerprint()?.mappedAt ?? null, store.getPreviousGraph()))
}

/** Read all recorded observations from the workspace store, in insertion order. */
export function readObservations(ctx: ToolContext): ObservationEntry[] {
  return withStore(ctx, (store) => store.getObservations())
}
