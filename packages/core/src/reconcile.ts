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
 * `proposalId` or matching the proposal's (from→to[, event]) pair ⇒ 'confirmed'
 * (confirmation always wins over a refutation for the same pair). Else a REFUTED
 * observation so linked/matched ⇒ 'rejected'. `confirmed`/`rejected`/`unverifiable`
 * are terminal and never demoted by later absence of evidence; `proposed` stays
 * `proposed` when no observation touches it.
 */
export function reconcileProposals(proposals: Proposal[], observations: Observation[]): Proposal[] {
  const confirmedPairs = new Set<string>()
  const refutedPairs = new Set<string>()
  const confirmedIds = new Set<string>()
  const refutedIds = new Set<string>()
  for (const o of observations) {
    const set = o.outcome === 'confirmed' ? confirmedPairs : refutedPairs
    set.add(pairKey(o.from, o.to))
    set.add(`${pairKey(o.from, o.to)}->${o.event}`)
    if (o.proposalId !== undefined) (o.outcome === 'confirmed' ? confirmedIds : refutedIds).add(o.proposalId)
  }

  return proposals.map((p) => {
    if (p.status !== 'proposed') return p
    const pair = p.to !== undefined ? pairKey(p.from ?? p.screen, p.to) : undefined
    const eventPair = pair !== undefined && p.event !== undefined ? `${pair}->${p.event}` : undefined
    const matched = (ids: Set<string>, pairs: Set<string>): boolean =>
      ids.has(p.id) || (pair !== undefined && (pairs.has(pair) || (eventPair !== undefined && pairs.has(eventPair))))
    if (matched(confirmedIds, confirmedPairs)) return { ...p, status: 'confirmed' as ProposalStatus }
    if (matched(refutedIds, refutedPairs)) return { ...p, status: 'rejected' as ProposalStatus }
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
