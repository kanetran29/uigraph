import { describe, it, expect } from 'vitest'
import { validateProposals, emptyProposals, type Proposal } from './proposals'

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
})
