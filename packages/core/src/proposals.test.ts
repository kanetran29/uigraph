import { describe, it, expect } from 'vitest'
import { validateProposals, emptyProposals, materializeProposalGraph, type Proposal } from './proposals'
import { node, graph } from './fixtures'

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p1',
    kind: 'edge',
    category: 'disclosure',
    screen: 'n_products',
    title: 'Read more expands the description',
    rationale: 'truncated text + a "Read more" control suggests an expand interaction',
    evidenced: true,
    confidence: 0.6,
    source: 'proposal',
    status: 'proposed',
    ...over,
  }
}

describe('validateProposals', () => {
  it('accepts a well-formed quarantined proposal', () => {
    expect(validateProposals({ ...emptyProposals('h'), proposals: [proposal()] })).toEqual([])
  })

  it('rejects a proposal that is not source:proposal (quarantine breach)', () => {
    const bad = { ...proposal(), source: 'static' }
    expect(validateProposals({ ...emptyProposals('h'), proposals: [bad] }).map((e) => e.code)).toContain('NOT_QUARANTINED')
  })

  it('rejects duplicate ids and bad confidence', () => {
    const codes = validateProposals({
      ...emptyProposals('h'),
      proposals: [proposal(), proposal({ confidence: 2 })],
    }).map((e) => e.code)
    expect(codes).toContain('DUP_ID')
    expect(codes).toContain('CONFIDENCE_RANGE')
  })

  it('accepts the unverifiable status and an optional reason', () => {
    const p = { ...proposal(), status: 'unverifiable' as const, reason: 'route is behind a feature flag not enabled in dev' }
    expect(validateProposals({ ...emptyProposals('h'), proposals: [p] })).toEqual([])
  })
})

describe('materializeProposalGraph — active-graph guard', () => {
  const g = graph([node('n_a'), node('n_b')], [])
  const p = (over: Partial<Proposal> = {}) => proposal({ screen: 'n_a', to: 'n_b', ...over })

  it('emits an edge for a proposed proposal', () => {
    expect(materializeProposalGraph(g, [p()]).edges).toHaveLength(1)
  })

  it('excludes resolved proposals (confirmed/rejected/unverifiable) from the active graph', () => {
    for (const status of ['confirmed', 'rejected', 'unverifiable'] as const) {
      expect(materializeProposalGraph(g, [p({ status })]).edges).toHaveLength(0)
    }
  })
})
