// Coverage + a verification worklist over the proven graph. "Verified" means an
// edge is runtime-witnessed (source:'runtime' — the Tier-3 fold confirmed it);
// static/manual edges are statically proven but not yet runtime-confirmed, and
// `may`/`unknown` edges + proposed transitions are the uncertain frontier a Tier-3
// runner should attack next. Pure + browser-safe (no IO).

import type { UiGraph } from './ir'
import type { ProposalGraph } from './proposals'

/** One edge's coverage status. `verified` is true only for runtime-witnessed edges. */
export interface EdgeCoverage {
  id: string
  from: string
  to: string
  event: string
  modality: string
  source: string
  verified: boolean
}

/** Coverage of the proven graph: how many edges are runtime-witnessed vs not. */
export interface CoverageReport {
  total: number
  verified: number
  ratio: number
  byModality: Record<string, number>
  bySource: Record<string, number>
  unverified: EdgeCoverage[]
}

/** Compute coverage: an edge is verified iff it carries a runtime witness. */
export function buildCoverage(graph: UiGraph): CoverageReport {
  const rows: EdgeCoverage[] = graph.edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    event: e.event,
    modality: e.modality,
    source: e.source,
    verified: e.source === 'runtime',
  }))
  const byModality: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  for (const e of graph.edges) {
    byModality[e.modality] = (byModality[e.modality] ?? 0) + 1
    bySource[e.source] = (bySource[e.source] ?? 0) + 1
  }
  const verified = rows.filter((r) => r.verified).length
  return {
    total: rows.length,
    verified,
    ratio: rows.length > 0 ? verified / rows.length : 0,
    byModality,
    bySource,
    unverified: rows.filter((r) => !r.verified),
  }
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
 * Rank what to verify next: `unknown` (dynamic-target) edges first, then `may`
 * (conditional) edges, then proposed transitions — each minus any pair already
 * runtime-witnessed. Proven `must` static edges are skipped (already witnessed).
 * Returns the top `limit`. A worklist an agent + Tier-3 runner consume.
 */
export function nextToVerify(graph: UiGraph, proposalGraph: ProposalGraph, limit = 20): VerifyTarget[] {
  const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]))
  const runtimePairs = new Set(graph.edges.filter((e) => e.source === 'runtime').map((e) => `${e.from}->${e.to}`))
  const out: VerifyTarget[] = []

  for (const e of graph.edges) {
    if (e.source === 'runtime') continue
    let priority = 0
    let reason = ''
    if (e.modality === 'unknown') {
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
