// Trust-tier projection (spec §3): a pure, on-read derivation of how far an agent
// should trust a discovered case (one IR edge), from its existing `source` +
// `modality` + any proposal status. Recall stays maximal — every case is kept;
// safety comes from an honest tier label, not from dropping the long tail.
//
// The tier is PROJECTED on read, never stored on the IR, so a proposal can change
// status without rewriting the graph. The order
// witnessed > proven > asserted > llm-verified > proposed > unknown is a TRUST
// order (how far to lean for autonomous action), NOT a confidence order:
// llm-verified can be high-confidence yet lower trust than witnessed because it
// was never run.

import type { GraphEdge, UiGraph } from './ir'
import type { ProposalGraphEdge, ProposalStatus } from './proposals'

/**
 * Ordered tier labels describing how far an agent should trust a case based on
 * evidence strength. Index in `TIER_ORDER` is the precedence (lower = more
 * trusted) used to sort enriched reads.
 */
export type TrustTier = 'witnessed' | 'proven' | 'asserted' | 'llm-verified' | 'proposed' | 'unknown'

/** A graph edge enriched with its projected trust tier on read, without stored redundancy. */
export interface EdgeWithTier extends GraphEdge {
  trustTier: TrustTier
}

/** Trust precedence (most-trusted first); used to sort enriched edge reads. */
const TIER_ORDER: TrustTier[] = ['witnessed', 'proven', 'asserted', 'llm-verified', 'proposed', 'unknown']

/** Human-readable explanation per tier, for agent docs / UI / reporting. */
const TIER_LABELS: Record<TrustTier, string> = {
  witnessed: 'trust to plan/act; confirmed runtime observation',
  proven: 'trust; deterministic static must-edge (silent witness ok)',
  asserted: 'exists in code, not exercised; verify before relying on the outcome',
  'llm-verified': 'plausible (LLM-judged) but not run; verify before relying',
  proposed: 'weak hypothesis, unjudged; treat as a lead to confirm',
  unknown: 'frontier — un-enumerated/dynamic; probe or ask before relying',
}

/**
 * Project the trust tier from an edge's source + modality + an optional final
 * proposal status. Pure: returns a label, never mutates the input edge.
 *
 * Precedence (spec §3): a runtime witness wins outright (`witnessed`) — this also
 * covers a confirmed proposal, whose edge is already source:runtime via the
 * observation fold. Otherwise `unverifiable` marks an LLM-plausible-but-undrivable
 * case (`llm-verified`), while a `proposed` OR `rejected` status keeps the case a
 * weak `proposed` hypothesis — a rejected proposal must NOT be promoted to
 * `asserted` (that tier means "exists in real code"); a disproven lead stays a
 * lead and never enters the proven graph. With no proposal status, source+modality
 * decide: static|manual must → `proven`, may → `asserted`, unknown → `unknown`.
 */
export function projectTrustTier(edge: GraphEdge, proposalStatus?: ProposalStatus): TrustTier {
  if (edge.source === 'runtime') return 'witnessed'
  if (proposalStatus === 'unverifiable') return 'llm-verified'
  if (proposalStatus === 'proposed' || proposalStatus === 'rejected') return 'proposed'
  if (edge.modality === 'must') return 'proven'
  if (edge.modality === 'may') return 'asserted'
  return 'unknown'
}

/**
 * Project a synthetic GraphEdge from a proposal-graph edge so the same tier logic
 * applies. Proposal edges carry no `source`/witness/confidence; they are
 * source:'manual' hypotheses (never static/runtime), tiered by their proposal
 * status (always 'proposed' for materialized proposal edges).
 */
function proposalEdgeAsGraphEdge(pe: ProposalGraphEdge): GraphEdge {
  return {
    id: pe.id,
    from: pe.from,
    to: pe.to,
    event: pe.event,
    guard: pe.guard,
    effect: pe.effect,
    modality: pe.modality,
    source: 'manual',
    confidence: 0,
  }
}

/**
 * Enrich a merged graph's edges plus the proposal-graph edges with their projected
 * trust tier in one pass, sorted by trust precedence (most-trusted first). Used by
 * the MCP read layer to serve tier-aware cases without storing the tier. Proposal
 * edges are tiered as 'proposed' (they only exist while a proposal is active).
 */
export function enrichEdgesWithTier(graph: UiGraph, proposalEdges: ProposalGraphEdge[]): EdgeWithTier[] {
  const base: EdgeWithTier[] = graph.edges.map((e) => ({ ...e, trustTier: projectTrustTier(e) }))
  const proposed: EdgeWithTier[] = proposalEdges.map((pe) => ({
    ...proposalEdgeAsGraphEdge(pe),
    trustTier: projectTrustTier(proposalEdgeAsGraphEdge(pe), 'proposed'),
  }))
  return [...base, ...proposed].sort((a, b) => TIER_ORDER.indexOf(a.trustTier) - TIER_ORDER.indexOf(b.trustTier))
}

/** Human-readable explanation of a tier, for agent docs / UI / reporting. */
export function getTierLabel(tier: TrustTier): string {
  return TIER_LABELS[tier]
}
