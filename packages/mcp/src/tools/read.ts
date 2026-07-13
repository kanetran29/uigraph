// Read-side tools for the @ui-graph/mcp server: the agent-facing views over the
// merged graph — the graph itself, proposals, grounding, per-screen action
// surfaces, coverage, and the trust-tiered case set (get_state / list_cases /
// get_frontier). All pure over a ToolContext; the case-projection helpers live
// here because only the read tools render cases.

import type { CoverageReport, EdgeWithTier, GraphEdge, GraphNode, GroundedEdge, Grounding, Modality, Proposal, ProposalGraph, ProposalGraphEdge, ProposalStatus, ScreenGrounding, Source, StalenessReport, TrustTier, UiGraph } from '@ui-graph/core'
import { buildCoverage, buildFrontier, buildGrounding, classifyEffectRisk, projectTrustTier } from '@ui-graph/core'
import { loadMergedGraph, TIER_ORDER, tierAtLeast, withStore, type ToolContext } from './context'
import { getFreshness } from './diff'

/** The merged graph plus node/edge counts and source freshness, the payload returned by get_graph. */
export interface GetGraphResult {
  version: 0
  meta: UiGraph['meta']
  nodes: GraphNode[]
  edges: EdgeWithTier[]
  nodeCount: number
  edgeCount: number
  freshness: 'fresh' | 'stale' | 'unknown'
}

/**
 * A one-line honesty caveat for negative answers ("no path", "no such screen"):
 * how much of the graph is accounted for and whether the map is even current, so
 * an agent can tell an extraction blind spot from a proven absence. Served with
 * every negative instead of a bare error — the red-team failure mode was an
 * authoritative-sounding "no" from a half-blind graph.
 */
export function blindSpotCaveat(ctx: ToolContext): string {
  const cov = withStore(ctx, (store) => buildCoverage(loadMergedGraph(ctx), store.getParkedEdges()))
  const fresh = getFreshness(ctx).state
  return `the graph may be partial (accounted ${Math.round(cov.accountedRatio * 100)}% of ${cov.total} edges, freshness: ${fresh}) — a missing screen or path can be an extraction blind spot, not proof of absence; check get_coverage and the soundiness report before trusting this negative`
}

/**
 * Serve the merged (base + overlay) graph to the agent as plain JSON, including
 * node and edge counts so a consumer need not recount. Each edge is enriched on
 * read with its projected trust tier (spec §3) so the agent knows how far to lean
 * on each case; the projection is derived, never stored on the IR. `freshness`
 * reports whether the map still matches the source (recomputed per call — never
 * serve a stale graph silently).
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
    freshness: getFreshness(ctx).state,
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

/** describe_screen result: a screen's controls + proven AND proposed actions, or an error with a blind-spot caveat. */
export type ScreenDescription =
  | (Omit<ScreenGrounding, 'knownEdges'> & { knownEdges: KnownEdgeWithTier[]; proposedEdges: ProposedEdgeWithTier[] })
  | { error: string; caveat: string }

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
  if (screen === undefined) return { error: `no screen "${args.screen}" in the graph`, caveat: blindSpotCaveat(ctx) }
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
