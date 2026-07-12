// Coverage + a verification worklist over the proven graph. TWO honest metrics:
//   • runtimeRatio — fraction runtime-witnessed (source:'runtime'). Strict; never
//     forced to 1. "How much did we actually observe in a browser."
//   • accountedRatio — fraction with a VERDICT: a must-static witness (a real
//     deterministic proof), a runtime witness, a resolved dynamic dispatch, or an
//     explicit park (audited, reasoned). "Nothing left in limbo."
// 100% (loopDone) = accountedRatio 1 = the open set is empty. A `may`/over-approx
// edge's static witness proves the call site EXISTS, not that the transition fires,
// so it is OPEN until runtime-confirmed or parked — never auto-credited. A dynamic
// `u_<screen>` sink edge is never credited by its own witness; it is resolved only
// when its source gains a concrete runtime out-edge. Pure + browser-safe (no IO).

import type { UiGraph } from './ir'
import type { ProposalGraph } from './proposals'
import { buildFrontier } from './frontier'
import { projectTrustTier, type TrustTier } from './trust-tier'

/** A may/unknown edge an agent has parked out of the worklist with an auditable reason. Never edits the edge. */
export interface ParkedEdge {
  edgeId: string
  reason: string
  ts?: string
  by?: 'agent' | 'runner'
}

/** How one edge is accounted for. `verified` (= FRESH runtime witness) kept for back-compat. */
export interface EdgeCoverage {
  id: string
  from: string
  to: string
  event: string
  modality: string
  source: string
  verified: boolean
  accounted: boolean
  status: 'runtime' | 'stale-witness' | 'static' | 'dynamic-open' | 'dynamic-resolved' | 'parked' | 'open'
  reason?: string
}

// Coverage of the proven graph under the honest metrics. THREE distinct ratios, do
// not conflate them: runtimeRatio (actually witnessed in a browser) ≤ verifiedRatio
// (witnessed OR a real deterministic must-static proof) ≤ accountedRatio (verified
// PLUS resolved-dynamic PLUS explicitly parked, i.e. "nothing left in limbo").
// accounted=100% does NOT mean "all verified" — parked + dynamic-resolved edges are
// accounted without being verified, so verifiedRatio/parkedCount are what a reader
// must consult to tell a fully-proven map from a fully-triaged one.
/** Coverage of the proven graph under the strict, verified, and accounted-for metrics. */
export interface CoverageReport {
  total: number
  verified: number
  ratio: number
  runtimeVerified: number
  runtimeRatio: number
  verifiedCount: number
  verifiedRatio: number
  accounted: number
  accountedRatio: number
  parkedCount: number
  staleWitnessCount: number
  byModality: Record<string, number>
  bySource: Record<string, number>
  unverified: EdgeCoverage[]
  open: EdgeCoverage[]
  parked: EdgeCoverage[]
  tierDistribution: Record<TrustTier, number>
  frontierCount: number
}

/** Graph-derived context for edge accounting: node kinds + sources whose dynamic dispatch is witnessed. */
interface EdgeContext {
  nodeKind: Map<string, string>
  resolvedFroms: Set<string>
}

/** Build the accounting context: a `from` is "resolved" once it has a concrete (non-sink) FRESH runtime out-edge — a stale witness credits nothing. */
function edgeContext(graph: UiGraph): EdgeContext {
  const nodeKind = new Map(graph.nodes.map((n) => [n.id, n.kind]))
  const resolvedFroms = new Set<string>()
  for (const e of graph.edges) if (e.source === 'runtime' && e.witnessStale !== true && nodeKind.get(e.to) !== 'unknown') resolvedFroms.add(e.from)
  return { nodeKind, resolvedFroms }
}

/**
 * Classify one edge. Precedence is LOAD-BEARING (first match wins): fresh runtime →
 * stale runtime witness (code changed since verification: NOT accounted — it goes
 * back on the worklist for re-confirmation) → parked (before static, so a parked
 * edge is credited by its audit note not a witness) → dynamic sink (never credited
 * by its own witness; resolved only via a concrete runtime out-edge from the same
 * source) → must-static witness → open. A `may` edge is OPEN even with a static
 * witness (the witness proves the call site, not that the transition fires).
 */
function classify(edge: UiGraph['edges'][number], ctx: EdgeContext, parkedById: Map<string, ParkedEdge>): { status: EdgeCoverage['status']; accounted: boolean; reason?: string } {
  if (edge.source === 'runtime') {
    if (edge.witnessStale === true) return { status: 'stale-witness', accounted: false, reason: 'runtime witness predates the current base graph — re-verify' }
    return { status: 'runtime', accounted: true }
  }
  const parked = parkedById.get(edge.id)
  if (parked) return { status: 'parked', accounted: true, reason: parked.reason }
  if (ctx.nodeKind.get(edge.to) === 'unknown') {
    return ctx.resolvedFroms.has(edge.from) ? { status: 'dynamic-resolved', accounted: true } : { status: 'dynamic-open', accounted: false }
  }
  if ((edge.source === 'static' || edge.source === 'manual') && edge.modality === 'must' && edge.witness !== undefined) return { status: 'static', accounted: true }
  return { status: 'open', accounted: false }
}

/**
 * Tally how many edges fall in each trust tier (spec §7 "tier distribution"), using
 * the shared on-read projection so the tier logic is never duplicated. Always emits
 * all 6 tiers (zero-filled) so the distribution shape is stable for readers.
 */
function tierDistribution(graph: UiGraph): Record<TrustTier, number> {
  const dist: Record<TrustTier, number> = { witnessed: 0, proven: 0, asserted: 0, 'llm-verified': 0, proposed: 0, unknown: 0 }
  for (const e of graph.edges) dist[projectTrustTier(e)] += 1
  return dist
}

/** Compute coverage under both metrics, given the proven graph + any parked edges. */
export function buildCoverage(graph: UiGraph, parked: ParkedEdge[] = []): CoverageReport {
  const ctx = edgeContext(graph)
  const parkedById = new Map(parked.map((p) => [p.edgeId, p]))
  const rows: EdgeCoverage[] = graph.edges.map((e) => {
    const c = classify(e, ctx, parkedById)
    return { id: e.id, from: e.from, to: e.to, event: e.event, modality: e.modality, source: e.source, verified: c.status === 'runtime', accounted: c.accounted, status: c.status, ...(c.reason !== undefined ? { reason: c.reason } : {}) }
  })
  const byModality: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  for (const e of graph.edges) {
    byModality[e.modality] = (byModality[e.modality] ?? 0) + 1
    bySource[e.source] = (bySource[e.source] ?? 0) + 1
  }
  const runtimeVerified = rows.filter((r) => r.verified).length
  const verifiedCount = rows.filter((r) => r.status === 'runtime' || r.status === 'static').length
  const parkedCount = rows.filter((r) => r.status === 'parked').length
  const staleWitnessCount = rows.filter((r) => r.status === 'stale-witness').length
  const accounted = rows.filter((r) => r.accounted).length
  const total = rows.length
  return {
    total,
    verified: runtimeVerified,
    ratio: total > 0 ? runtimeVerified / total : 0,
    runtimeVerified,
    runtimeRatio: total > 0 ? runtimeVerified / total : 0,
    verifiedCount,
    verifiedRatio: total > 0 ? verifiedCount / total : 1,
    accounted,
    accountedRatio: total > 0 ? accounted / total : 1,
    parkedCount,
    staleWitnessCount,
    byModality,
    bySource,
    unverified: rows.filter((r) => !r.verified),
    open: rows.filter((r) => !r.accounted),
    parked: rows.filter((r) => r.status === 'parked'),
    tierDistribution: tierDistribution(graph),
    frontierCount: buildFrontier(graph).unknownCount,
  }
}

/** Path segments (non-empty), for route matching. */
function pathSegments(p: string): string[] {
  return p.split('/').filter((s) => s.length > 0)
}

/**
 * Map an observed browser URL to a declared screen node id, or null when it maps to
 * none (undeclared / external / ambiguous). Strips the app origin + query/hash,
 * normalizes a trailing slash, then matches the path against declared non-wildcard
 * routes: an exact route wins; else the SOLE parameterized candidate (e.g. observed
 * `/products/42` → the only `/products/:id` node); zero or >1 candidates → null.
 * Used by the Tier-3 runner to resolve a dynamic landing into a concrete edge.
 */
export function nodeForUrl(graph: UiGraph, observedUrl: string, appUrl: string): string | null {
  if (!observedUrl.startsWith(appUrl)) return null
  let path = observedUrl.slice(appUrl.length).split('?')[0]?.split('#')[0] ?? ''
  if (!path.startsWith('/')) path = '/' + path
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  const exact = graph.nodes.find((n) => n.kind !== 'unknown' && n.route === path)
  if (exact) return exact.id
  const ps = pathSegments(path)
  const candidates = graph.nodes.filter((n) => {
    if (n.kind === 'unknown' || n.route === null || n.route.includes('*')) return false
    const rs = pathSegments(n.route)
    if (rs.length !== ps.length) return false
    return rs.every((s, i) => s.startsWith(':') || s === ps[i])
  })
  return candidates.length === 1 ? (candidates[0]?.id ?? null) : null
}

/** A thing a Tier-3 runner should confirm next: an uncertain edge or a proposed transition. */
export interface VerifyTarget {
  kind: 'edge' | 'proposal'
  id: string
  from: string
  to: string
  toLabel: string
  event: string
  reason: string
  priority: number
  proposalIds?: string[]
}

/**
 * Rank what to verify next: `unknown` (dynamic-target) edges first, then
 * stale-witnessed runtime edges (verified against an older base — the code
 * changed, re-confirm), then `may` (conditional) edges, then proposed
 * transitions — each minus anything already fresh-runtime-witnessed, parked, or
 * (for a dynamic sink) resolved by a concrete runtime out-edge from its source.
 * Proven `must` static edges are skipped (already witnessed). The open set
 * shrinks monotonically as edges are confirmed or parked. Returns the top `limit`.
 */
export function nextToVerify(graph: UiGraph, proposalGraph: ProposalGraph, limit = 20, parkedIds: Set<string> = new Set()): VerifyTarget[] {
  const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]))
  const ctx = edgeContext(graph)
  const runtimePairs = new Set(graph.edges.filter((e) => e.source === 'runtime' && e.witnessStale !== true).map((e) => `${e.from}->${e.to}`))
  const out: VerifyTarget[] = []

  for (const e of graph.edges) {
    if (e.source === 'runtime' && e.witnessStale !== true) continue
    if (parkedIds.has(e.id)) continue
    let priority = 0
    let reason = ''
    if (e.source === 'runtime') {
      priority = 2
      reason = 'stale witness — the base graph changed since this was verified; re-confirm'
      out.push({ kind: 'edge', id: e.id, from: e.from, to: e.to, toLabel: labelOf.get(e.to) ?? e.to, event: e.event, reason, priority })
      continue
    }
    if (e.modality === 'unknown') {
      if (ctx.resolvedFroms.has(e.from)) continue
      priority = 3
      reason = 'dynamic target — destination undecidable statically, confirm at runtime'
    } else if (e.modality === 'may') {
      priority = 2
      reason = 'conditional (may) edge — confirm it actually fires'
    } else {
      continue
    }
    out.push({ kind: 'edge', id: e.id, from: e.from, to: e.to, toLabel: labelOf.get(e.to) ?? e.to, event: e.event, reason, priority })
  }

  for (const pe of proposalGraph.edges) {
    if (runtimePairs.has(`${pe.from}->${pe.to}`)) continue
    out.push({
      kind: 'proposal',
      id: pe.id,
      from: pe.from,
      to: pe.to,
      toLabel: labelOf.get(pe.to) ?? pe.to,
      event: pe.event,
      reason: `proposed transition (${pe.proposalIds.length} proposal(s)) — confirm via runtime observation`,
      priority: 1,
      proposalIds: pe.proposalIds,
    })
  }

  return out.sort((a, b) => b.priority - a.priority).slice(0, limit)
}
