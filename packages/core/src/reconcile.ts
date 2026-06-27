// Proposal reconciliation (the self-healing loop's model-free half). A proposal's
// status is DERIVED from the observation log — the deterministic witness — never
// asserted by the model. A confirmed observation archives the lead ('confirmed';
// the proven runtime edge already exists via applyObservations). A refuted one
// withdraws it ('rejected', hallucinated). reconcileProposals is pure + idempotent
// and touches `status` ONLY — nothing here can mint a proven edge, so the golden
// invariant holds. buildResolution counts progress so an LLM loop knows when it is
// done. (dossier §5.1-5.2)

import type { Observation } from './runtime'
import type { Proposal, ProposalStatus } from './proposals'

/** The pair key a proposal/observation transitions over (screen acts as the edge `from`). */
function pairKey(from: string, to: string): string {
  return `${from}->${to}`
}

/**
 * Derive each proposal's status from the observation log. Pure + idempotent
 * (reconcile∘reconcile = reconcile); returns a new array, mutating nothing and
 * changing only `status`. Precedence: a CONFIRMED observation linked by
 * `proposalId` or matching the proposal's transition ⇒ 'confirmed' (confirmation
 * always wins over a refutation). Else a REFUTED observation so linked/matched ⇒
 * 'rejected'. Pair-matching is EVENT-AWARE: when a proposal specifies an event, an
 * observation only matches if BOTH the (from→to) pair AND the event agree — a
 * same-pair observation on a different event does not flip it (no loose pair-only
 * match). Only when the proposal specifies no event does the bare (from→to) pair
 * match. `confirmed`/`rejected`/`unverifiable` are terminal and never demoted by
 * later absence of evidence; `proposed` stays `proposed` when no observation
 * touches it.
 */
export function reconcileProposals(proposals: Proposal[], observations: Observation[]): Proposal[] {
  const confirmedPairs = new Set<string>()
  const refutedPairs = new Set<string>()
  const confirmedEventPairs = new Set<string>()
  const refutedEventPairs = new Set<string>()
  const confirmedIds = new Set<string>()
  const refutedIds = new Set<string>()
  for (const o of observations) {
    const pairs = o.outcome === 'confirmed' ? confirmedPairs : refutedPairs
    const eventPairs = o.outcome === 'confirmed' ? confirmedEventPairs : refutedEventPairs
    pairs.add(pairKey(o.from, o.to))
    eventPairs.add(`${pairKey(o.from, o.to)}->${o.event}`)
    if (o.proposalId !== undefined) (o.outcome === 'confirmed' ? confirmedIds : refutedIds).add(o.proposalId)
  }

  return proposals.map((p) => {
    if (p.status !== 'proposed') return p
    const pair = p.to !== undefined ? pairKey(p.from ?? p.screen, p.to) : undefined
    const eventPair = pair !== undefined && p.event !== undefined ? `${pair}->${p.event}` : undefined
    const matched = (ids: Set<string>, pairs: Set<string>, eventPairs: Set<string>): boolean => {
      if (ids.has(p.id)) return true
      if (pair === undefined) return false
      return eventPair !== undefined ? eventPairs.has(eventPair) : pairs.has(pair)
    }
    if (matched(confirmedIds, confirmedPairs, confirmedEventPairs)) return { ...p, status: 'confirmed' as ProposalStatus }
    if (matched(refutedIds, refutedPairs, refutedEventPairs)) return { ...p, status: 'rejected' as ProposalStatus }
    return p
  })
}

/** Progress over a proposal set: how many leads are resolved vs. still open. */
export interface ResolutionReport {
  total: number
  resolved: number
  openCount: number
  ratio: number
  byStatus: Record<ProposalStatus, number>
}

/**
 * Count proposal resolution. `resolved` = confirmed + rejected + unverifiable;
 * `openCount` = still 'proposed'; `ratio` = resolved/total (1 when empty — an empty
 * set is trivially fully resolved). The loop is done when openCount is 0 and the
 * verify worklist is empty.
 */
export function buildResolution(proposals: Proposal[]): ResolutionReport {
  const byStatus: Record<ProposalStatus, number> = { proposed: 0, confirmed: 0, rejected: 0, unverifiable: 0 }
  for (const p of proposals) byStatus[p.status] += 1
  const total = proposals.length
  const openCount = byStatus.proposed
  const resolved = total - openCount
  return { total, resolved, openCount, ratio: total > 0 ? resolved / total : 1, byStatus }
}
