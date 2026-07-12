// Reconciliation-loop tools for the @uigraph/mcp server: recording runtime
// observations (report_observation), re-deriving proposal statuses
// (reconcile_proposals), resolving proposals/edges (withdraw / park / unpark /
// mark_unverifiable), and the deterministic DONE signal (get_loop_status). Pure
// over a ToolContext; the observation write path is behavior-critical.

import type { CoverageReport, ProposalStatus, ResolutionReport } from '@uigraph/core'
import { buildCoverage, buildResolution, hashValue, nextToVerify } from '@uigraph/core'
import { loadMergedGraph, withStore, type ObservationEntry, type ToolContext } from './context'
import { getProposalGraph } from './read'

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
