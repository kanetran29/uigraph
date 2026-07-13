// Planning tools for the @uigraph/mcp server: what to verify next
// (next_to_verify), Playwright spec generation for a route (gen_spec), and route
// planning over the merged graph with trust-tier warnings (plan_path). Pure over
// a ToolContext, built on core's nextToVerify / planPath / spec renderer.

import type { Modality, TrustTier, VerifyTarget } from '@uigraph/core'
import { buildSpecPlan, getTierLabel, nextToVerify, planPath, projectTrustTier, renderPlaywrightSpec } from '@uigraph/core'
import { loadMergedGraph, tierAtLeast, withStore, type ToolContext } from './context'
import { blindSpotCaveat, getProposalGraph } from './read'

/** Arguments for next_to_verify: an optional cap on the returned worklist size. */
export interface NextToVerifyArgs {
  includeProven?: boolean
  limit?: number
}

/**
 * The ranked worklist of transitions to confirm at runtime next: dynamic-target
 * (`unknown`) edges, then `may` edges, then proposed transitions — minus anything
 * already runtime-witnessed. Drives a Tier-3 runner / an agent's report_observation.
 */
export function nextToVerifyTool(ctx: ToolContext, args: NextToVerifyArgs = {}): VerifyTarget[] {
  const parkedIds = new Set(withStore(ctx, (store) => store.getParkedEdges()).map((p) => p.edgeId))
  return nextToVerify(loadMergedGraph(ctx), getProposalGraph(ctx), args.limit, parkedIds, { includeProven: args.includeProven === true })
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
 * `minTier` floor — present only when a `minTier` was given and some hop fell
 * short. `caveat` accompanies every negative (found:false): how partial/stale the
 * graph is, so "no path" is never mistaken for proof of absence.
 */
export interface PlanPathResult {
  found: boolean
  from: string
  to: string
  steps: PlanPathStep[]
  tierWarnings?: string[]
  caveat?: string
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
  if (path === null) return { found: false, from: args.from, to: args.to, steps: [], caveat: blindSpotCaveat(ctx) }
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
