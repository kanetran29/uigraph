import { describe, it, expect } from 'vitest'
import { reconcileProposals, buildResolution } from './reconcile'
import type { Proposal } from './proposals'
import type { Observation } from './runtime'

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p1',
    kind: 'edge',
    category: 'disclosure',
    screen: 'n_a',
    title: 'A leads to B',
    rationale: 'a control hints at navigation',
    evidenced: true,
    confidence: 0.6,
    source: 'proposal',
    status: 'proposed',
    to: 'n_b',
    ...over,
  }
}

function obs(over: Partial<Observation> = {}): Observation {
  return { id: 'o1', from: 'n_a', to: 'n_b', event: 'click', outcome: 'confirmed', ...over }
}

describe('reconcileProposals', () => {
  it('archives a proposal to confirmed when a matching (from,to) observation is confirmed', () => {
    const [p] = reconcileProposals([proposal()], [obs()])
    expect(p?.status).toBe('confirmed')
  })

  it('archives by proposalId even when the pair differs slightly', () => {
    const [p] = reconcileProposals([proposal({ to: 'n_other' })], [obs({ to: 'n_else', proposalId: 'p1' })])
    expect(p?.status).toBe('confirmed')
  })

  it('withdraws a proposal to rejected on a refuted observation with no confirmation', () => {
    const [p] = reconcileProposals([proposal()], [obs({ outcome: 'refuted' })])
    expect(p?.status).toBe('rejected')
  })

  it('lets confirmation win over refutation for the same pair', () => {
    const [p] = reconcileProposals([proposal()], [obs({ id: 'o1', outcome: 'refuted' }), obs({ id: 'o2', outcome: 'confirmed' })])
    expect(p?.status).toBe('confirmed')
  })

  it('matches an observation against a screen-as-from proposal', () => {
    const [p] = reconcileProposals([proposal({ from: undefined, screen: 'n_a', to: 'n_b' })], [obs()])
    expect(p?.status).toBe('confirmed')
  })

  it('leaves an untouched proposal proposed and never demotes terminal statuses', () => {
    const out = reconcileProposals(
      [proposal({ id: 'open', to: 'n_z' }), proposal({ id: 'done', status: 'confirmed' }), proposal({ id: 'park', status: 'unverifiable' })],
      [],
    )
    expect(out.map((p) => p.status)).toEqual(['proposed', 'confirmed', 'unverifiable'])
  })

  it('is pure (no input mutation) and idempotent', () => {
    const input = [proposal()]
    const snapshot = JSON.parse(JSON.stringify(input))
    const once = reconcileProposals(input, [obs()])
    expect(input).toEqual(snapshot)
    expect(reconcileProposals(once, [obs()])).toEqual(once)
  })
})

describe('buildResolution', () => {
  it('counts resolved (confirmed+rejected+unverifiable) vs open (proposed)', () => {
    const r = buildResolution([
      proposal({ id: '1', status: 'proposed' }),
      proposal({ id: '2', status: 'confirmed' }),
      proposal({ id: '3', status: 'rejected' }),
      proposal({ id: '4', status: 'unverifiable' }),
    ])
    expect(r).toMatchObject({ total: 4, resolved: 3, openCount: 1, byStatus: { proposed: 1, confirmed: 1, rejected: 1, unverifiable: 1 } })
    expect(r.ratio).toBeCloseTo(0.75)
  })

  it('is trivially fully resolved (ratio 1) when empty', () => {
    expect(buildResolution([]).ratio).toBe(1)
  })
})
