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

/**
 * The reason prefix identifying a pattern-dedup park (a fan-out duplicate accounted
 * by its driven representative). Load-bearing: classify() keys 'pattern-covered' off
 * it, the runner GENERATES park reasons from it, and the parked CLI groups by it —
 * one exported constant so a wording tweak can never split generator from classifier.
 */
export const PATTERN_PARK_REASON_PREFIX = 'over-approximation fan-out of the nav call at '

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
  status: 'runtime' | 'stale-witness' | 'twin-witnessed' | 'static' | 'dynamic-open' | 'dynamic-resolved' | 'parked' | 'pattern-covered' | 'unanchorable' | 'refuted' | 'open'
  reason?: string
}

// Coverage of the proven graph under the honest metrics. THREE distinct ratios, do
// not conflate them: runtimeRatio (actually witnessed in a browser) ≤ verifiedRatio
// (witnessed OR a real deterministic must-static proof) ≤ accountedRatio (verified
// PLUS resolved-dynamic PLUS explicitly parked, i.e. "nothing left in limbo").
// accounted=100% does NOT mean "all verified" — parked + dynamic-resolved edges are
// accounted without being verified, so verifiedRatio/parkedCount are what a reader
// must consult to tell a fully-proven map from a fully-triaged one. `total` always
// counts EVERY edge, refuted ones included: shrinking the denominator would hide
// information, so refutedCount is reported separately (the accounted ratio already
// improves because a refuted edge carries a delivered verdict).
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
  unanchorableCount: number
  conditionGatedCount: number
  reachedCount: number
  verifiedOfReached: number
  refutedCount: number
  byModality: Record<string, number>
  bySource: Record<string, number>
  unverified: EdgeCoverage[]
  open: EdgeCoverage[]
  parked: EdgeCoverage[]
  tierDistribution: Record<TrustTier, number>
  frontierCount: number
}

/** Graph-derived context for edge accounting: node kinds, resolved dynamic sources, screen->target pairs witnessed via a control child (twins), and unanchorable source nodes. */
interface EdgeContext {
  nodeKind: Map<string, string>
  resolvedFroms: Set<string>
  twinWitnessed: Set<string>
  unanchorableFroms: Set<string>
}

/** Build the accounting context: a `from` is "resolved" once it has a concrete (non-sink) FRESH runtime out-edge — a stale witness credits nothing. `twinWitnessed` holds `screen=>to` pairs proven through a control child of that screen: the same user transition, witnessed at its drivable representation. `unanchorableFroms` holds synthetic pseudo-screens (routeless, parentless, ZERO in-edges — e.g. a shared nav helper the extractor over-approximated into a node): no drive can ever be anchored there, so their out-edges get their own honest accounting class instead of cycling open forever. */
function edgeContext(graph: UiGraph): EdgeContext {
  const nodeKind = new Map(graph.nodes.map((n) => [n.id, n.kind]))
  const parentOf = new Map(graph.nodes.map((n) => [n.id, n.parent]))
  const resolvedFroms = new Set<string>()
  const twinWitnessed = new Set<string>()
  for (const e of graph.edges) {
    if (e.source !== 'runtime' || e.witnessStale === true) continue
    if (nodeKind.get(e.to) !== 'unknown') resolvedFroms.add(e.from)
    const parent = parentOf.get(e.from)
    if (nodeKind.get(e.from) === 'control' && parent !== undefined) twinWitnessed.add(`${parent}=>${e.to}`)
  }
  const hasInEdge = new Set(graph.edges.map((e) => e.to))
  const unanchorableFroms = new Set(graph.nodes.filter((n) => n.route === null && n.parent === undefined && n.kind !== 'unknown' && !hasInEdge.has(n.id)).map((n) => n.id))
  return { nodeKind, resolvedFroms, twinWitnessed, unanchorableFroms }
}

/** The auditable reason attached to every 'unanchorable' classification. */
const UNANCHORABLE_REASON = 'source is a synthetic routeless screen with no in-edges (over-approximated shared nav helper) — no runtime path can ever anchor a drive; accounted, not witnessed'

/** The auditable reason attached to every 'refuted' classification (names the fold's observation threshold). */
const REFUTED_REASON = 'disproven at runtime — 2+ refuted observations on the current base, zero confirmations ever; the transition does not fire (verdict delivered, edge kept for audit)'

/**
 * Classify one edge. Precedence is LOAD-BEARING (first match wins): fresh runtime →
 * stale runtime witness (code changed since verification: NOT accounted — it goes
 * back on the worklist for re-confirmation) → refuted (the fold's falsification
 * verdict beats any park — including a stale 'unstable' park — so a disproven
 * hypothesis never masquerades as parked or open) → parked (before static, so a parked
 * edge is credited by its audit note not a witness) → dynamic sink (never credited
 * by its own witness; resolved only via a concrete runtime out-edge from the same
 * source) → must-static witness → unanchorable source → open. A `may` edge is OPEN
 * even with a static witness (the witness proves the call site, not that the
 * transition fires). Unanchorable ranks LAST among the accounted classes: a fresh
 * runtime witness (an agent CAN drive it manually), a bespoke park, and a real
 * must-static proof all say something stronger than "the runner can never get
 * there", so they win; only an edge that would otherwise cycle open forever
 * (dynamic-open / open) falls through to the unanchorable accounting.
 */
function classify(edge: UiGraph['edges'][number], ctx: EdgeContext, parkedById: Map<string, ParkedEdge>): { status: EdgeCoverage['status']; accounted: boolean; reason?: string } {
  if (edge.source === 'runtime') {
    if (edge.witnessStale === true) {
      // nextToVerify skips a screen-level edge whose pair is freshly witnessed via a
      // control twin — classifying it stale here would leave it stuck forever
      // (worklist says done, coverage says re-verify). The fresh twin IS the re-proof.
      if (ctx.nodeKind.get(edge.from) !== 'control' && ctx.twinWitnessed.has(`${edge.from}=>${edge.to}`)) {
        return { status: 'twin-witnessed', accounted: true, reason: 'stale witness superseded — the same transition is freshly runtime-witnessed via a control on this screen' }
      }
      // A stale witness from an UNANCHORABLE source can never be re-confirmed (no
      // drive can start there) — every era shift would strand it stale forever.
      if (ctx.unanchorableFroms.has(edge.from)) {
        return { status: 'unanchorable', accounted: true, reason: UNANCHORABLE_REASON }
      }
      return { status: 'stale-witness', accounted: false, reason: 'runtime witness predates the current base graph — re-verify' }
    }
    return { status: 'runtime', accounted: true }
  }
  if (edge.refuted === true) return { status: 'refuted', accounted: true, reason: REFUTED_REASON }
  const parked = parkedById.get(edge.id)
  if (parked) {
    // A pattern-dedup park is backed by a runtime witness on a sibling representative of the
    // same nav call ("accounted because we drove a representative"); an 'autonomous: …' park
    // is a witness-less give-up ("accounted because we could not drive it"). Same accounting,
    // different trust — split the status so a reader can tell them apart.
    const status: EdgeCoverage['status'] = parked.reason.startsWith(PATTERN_PARK_REASON_PREFIX) ? 'pattern-covered' : 'parked'
    return { status, accounted: true, reason: parked.reason }
  }
  if (ctx.nodeKind.get(edge.from) !== 'control' && ctx.twinWitnessed.has(`${edge.from}=>${edge.to}`)) {
    return { status: 'twin-witnessed', accounted: true, reason: 'the same transition is runtime-witnessed via a control on this screen' }
  }
  if (ctx.nodeKind.get(edge.to) === 'unknown') {
    if (ctx.resolvedFroms.has(edge.from)) return { status: 'dynamic-resolved', accounted: true }
    if (ctx.unanchorableFroms.has(edge.from)) return { status: 'unanchorable', accounted: true, reason: UNANCHORABLE_REASON }
    return { status: 'dynamic-open', accounted: false }
  }
  if ((edge.source === 'static' || edge.source === 'manual') && edge.modality === 'must' && edge.witness !== undefined) return { status: 'static', accounted: true }
  if (ctx.unanchorableFroms.has(edge.from)) return { status: 'unanchorable', accounted: true, reason: UNANCHORABLE_REASON }
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
  const parkedCount = rows.filter((r) => r.status === 'parked' || r.status === 'pattern-covered').length
  const staleWitnessCount = rows.filter((r) => r.status === 'stale-witness').length
  const unanchorableCount = rows.filter((r) => r.status === 'unanchorable').length
  const refutedCount = rows.filter((r) => r.status === 'refuted').length
  const accounted = rows.filter((r) => r.accounted).length
  const total = rows.length
  // The product KPI: verified / reached. `reached` excludes verdicts that remove an
  // edge from the user-tappable universe (refuted hypotheses, unanchorable
  // synthetics) and edges whose park reason names a precondition EXTERNAL to the
  // run conditions (payment-return state, tokens, admin sessions, guard states) —
  // those re-enter the denominator the moment the condition is supplied and the
  // park lifts. The regex is the single classifier for "external condition";
  // wording in park reasons must keep matching it.
  const conditionGated = rows.filter((r) => (r.status === 'parked' || r.status === 'pattern-covered') && r.reason !== undefined && /state\/precondition|Stripe|token|parameterized|estimation|admin|authenticated session|auth route|round cap|undrivable after|unreachable\/undrivable|no drivable/.test(r.reason)).length
  const reachedCount = total - refutedCount - unanchorableCount - conditionGated
  // twin-witnessed counts as verified here: the SAME user transition is
  // runtime-witnessed, at its drivable control representation.
  const verifiedForKpi = rows.filter((r) => r.verified || r.status === 'static' || r.status === 'twin-witnessed').length
  const verifiedOfReached = reachedCount > 0 ? verifiedForKpi / reachedCount : 1
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
    unanchorableCount,
    conditionGatedCount: conditionGated,
    reachedCount,
    verifiedOfReached,
    refutedCount,
    byModality,
    bySource,
    unverified: rows.filter((r) => !r.verified),
    open: rows.filter((r) => !r.accounted),
    parked: rows.filter((r) => r.status === 'parked' || r.status === 'pattern-covered'),
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

/** A thing a Tier-3 runner should confirm next: an uncertain edge or a proposed transition. `proven` marks a must-static edge included by the verify-all sweep — already statically proven, driven to upgrade it to runtime-witnessed (a refutation here means the extraction lied or code and runtime diverge). */
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
  proven?: boolean
  stale?: boolean
}

/** Options for nextToVerify. `includeProven` adds must-static edges (the verify-all sweep). */
export interface NextToVerifyOptions {
  includeProven?: boolean
  /** Re-litigate falsified edges: refuted may-edges re-enter the worklist (high priority) so a later app fix or corrected run config can clear the verdict — the unrefute lever. */
  includeRefuted?: boolean
}

/**
 * Rank what to verify next: `unknown` (dynamic-target) edges first, then
 * stale-witnessed runtime edges (verified against an older base — the code
 * changed, re-confirm), then `may` (conditional) edges, then proposed
 * transitions — each minus anything already fresh-runtime-witnessed, parked, or
 * (for a dynamic sink) resolved by a concrete runtime out-edge from its source.
 * Proven `must` static edges are skipped (already witnessed). Non-runtime edges
 * from an UNANCHORABLE source (synthetic routeless screen, no in-edges) are
 * skipped too: planForTarget can never anchor a drive there, so worklisting them
 * only burns attempts — classify() accounts them as 'unanchorable' instead.
 * Refuted edges (fold-disproven may-hypotheses) are skipped: the verdict is
 * delivered, re-driving a closed hypothesis only burns attempts. The open set
 * shrinks monotonically as edges are confirmed or parked. Returns the top
 * `limit`.
 */
export function nextToVerify(graph: UiGraph, proposalGraph: ProposalGraph, limit = 20, parkedIds: Set<string> = new Set(), opts: NextToVerifyOptions = {}): VerifyTarget[] {
  const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]))
  const ctx = edgeContext(graph)
  const runtimePairs = new Set(graph.edges.filter((e) => e.source === 'runtime' && e.witnessStale !== true).map((e) => `${e.from}->${e.to}`))
  const out: VerifyTarget[] = []

  for (const e of graph.edges) {
    if (e.source === 'runtime' && e.witnessStale !== true) continue
    if (e.refuted === true && opts.includeRefuted !== true) continue
    if (parkedIds.has(e.id)) continue
    if (e.refuted === true) {
      out.push({ kind: 'edge', id: e.id, from: e.from, to: e.to, toLabel: labelOf.get(e.to) ?? e.to, event: e.event, reason: 're-litigating a falsified edge — a confirmation clears the refuted verdict', priority: 3.6 })
      continue
    }
    if (ctx.nodeKind.get(e.from) !== 'control' && ctx.twinWitnessed.has(`${e.from}=>${e.to}`)) continue
    let priority = 0
    let reason = ''
    if (e.source === 'runtime') {
      // A stale witness was ALREADY proven drivable once — re-confirming it is the
      // cheapest coverage win there is, so it outranks exploring unknowns/mays.
      // Sharing priority 2 with the (often huge) may pool buried these behind the
      // limit cutoff and left them permanently unaccounted after every re-map.
      priority = 3.5
      reason = 'stale witness — the base graph changed since this was verified; re-confirm'
      out.push({ kind: 'edge', id: e.id, from: e.from, to: e.to, toLabel: labelOf.get(e.to) ?? e.to, event: e.event, reason, priority, stale: true })
      continue
    }
    if (ctx.unanchorableFroms.has(e.from)) continue
    if (e.modality === 'unknown') {
      if (ctx.resolvedFroms.has(e.from)) continue
      priority = 3
      reason = 'dynamic target — destination undecidable statically, confirm at runtime'
    } else if (e.modality === 'may') {
      priority = 2
      reason = 'conditional (may) edge — confirm it actually fires'
    } else if (opts.includeProven === true && e.modality === 'must') {
      priority = 0.5
      reason = 'static proof — drive it to upgrade to runtime-witnessed (verify-all); a refutation means extraction and runtime disagree'
      out.push({ kind: 'edge', id: e.id, from: e.from, to: e.to, toLabel: labelOf.get(e.to) ?? e.to, event: e.event, reason, priority, proven: true })
      continue
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

/**
 * The de-dup pattern key for a verify target: the SOURCE navigation call it fires,
 * identified by its static witness `file:line:col`. A shared nav component's `<Link>`
 * (sidebar/header) renders on every screen and, when its target is dynamic, the
 * extractor over-approximates it into a fan-out of `may` edges — ALL sharing that one
 * witness location. So one source call = one pattern: drive a representative, account
 * the rest by pattern instead of re-driving the same call from every screen.
 *
 * Returns null (NEVER deduped — always individually driven) for: must-static/proven
 * edges (the verify-all sweep must witness each), dynamic-sink targets (kind
 * 'unknown', resolved by capture not pattern), proposals, and any edge whose witness
 * lacks a file:line (nothing stable to key on).
 */
export function patternKey(graph: UiGraph, t: VerifyTarget): string | null {
  if (t.kind !== 'edge' || t.proven === true) return null
  if (graph.nodes.find((n) => n.id === t.to)?.kind === 'unknown') return null
  const w = graph.edges.find((e) => e.id === t.id)?.witness
  if (w?.file === undefined || w.loc === undefined) return null
  return `${w.file}:${w.loc.line}:${w.loc.col}`
}

/** A worklist split into the targets actually driven (one representative per pattern +
 *  every un-keyable target) and the duplicates held aside, grouped by their pattern key. */
export interface DedupedWorklist {
  representatives: VerifyTarget[]
  duplicates: Map<string, VerifyTarget[]>
}

/**
 * Collapse a worklist by pattern: keep the first `sample` representative(s) per pattern
 * key (deterministic, ordered by `from` id) plus every un-keyable target (patternKey
 * null → always its own representative); the remaining same-key targets become
 * duplicates the runner never drives. The runner parks a pattern's duplicates ONLY
 * after its representative is runtime-confirmed, so a duplicate is never credited as
 * driven — the win is purely NOT re-driving the same source call from every screen.
 * `tried` (target ids already driven in earlier rounds) rotates the representative to an untried pattern-mate.
 */
export function dedupWorklist(graph: UiGraph, targets: VerifyTarget[], sample = 1, tried: ReadonlySet<string> = new Set()): DedupedWorklist {
  const byKey = new Map<string, VerifyTarget[]>()
  const representatives: VerifyTarget[] = []
  for (const t of targets) {
    const key = patternKey(graph, t)
    // A stale target was individually witnessed before — a pattern-mate confirming
    // in its place would NOT refresh this edge's own witness, so it never folds.
    if (key === null || t.stale === true) {
      representatives.push(t)
      continue
    }
    const bucket = byKey.get(key)
    if (bucket === undefined) byKey.set(key, [t])
    else bucket.push(t)
  }
  const duplicates = new Map<string, VerifyTarget[]>()
  for (const [key, bucket] of byKey) {
    // Rotate: a pattern-mate that was already driven (and did not confirm — else the
    // bucket would be pattern-parked) yields the representative slot to an untried
    // mate. One template can serve several routes, so the same witness position can
    // be a phantom on one screen and the real control on another.
    bucket.sort((a, b) => Number(tried.has(a.id)) - Number(tried.has(b.id)) || a.from.localeCompare(b.from))
    representatives.push(...bucket.slice(0, sample))
    const rest = bucket.slice(sample)
    if (rest.length > 0) duplicates.set(key, rest)
  }
  return { representatives, duplicates }
}
