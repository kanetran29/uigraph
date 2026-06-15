import { describe, it, expect } from 'vitest'
import type { EdgeCoverage, GraphNode, Proposal } from '@uigraph/core'
import { matchCoverageRow, matchProposal, matchesNode, searchMatchIds } from './search'

function node(over: Partial<GraphNode> & { id: string }): GraphNode {
  return { route: null, componentPath: null, label: over.id, kind: 'screen', ...over }
}
function prop(over: Partial<Proposal> & { id: string }): Proposal {
  return { kind: 'edge', category: 'disclosure', screen: 'n_root', title: 't', rationale: 'r', evidenced: true, confidence: 0.8, source: 'proposal', status: 'proposed', ...over }
}
function row(over: Partial<EdgeCoverage> & { id: string }): EdgeCoverage {
  return { from: 'a', to: 'b', event: 'click', modality: 'may', source: 'static', verified: false, accounted: false, status: 'open', ...over }
}

describe('matchesNode', () => {
  const checkout = node({ id: 'n_checkout', route: '/checkout', label: 'Checkout' })
  const payBtn = node({ id: 'c_pay', kind: 'control', parent: 'n_checkout', label: 'pay', control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Pay now' }, name: 'Pay now' } })
  const sink = node({ id: 'u_n_checkout', kind: 'unknown', label: 'dynamic ⋯' })

  it('matches on label / route / id, case-insensitive and trimmed', () => {
    expect(matchesNode(checkout, 'check')).toBe(true)
    expect(matchesNode(checkout, '/CHECKOUT')).toBe(true)
    expect(matchesNode(checkout, '  n_checkout ')).toBe(true)
    expect(matchesNode(checkout, 'login')).toBe(false)
  })

  it('matches a control on its control.name', () => {
    expect(matchesNode(payBtn, 'pay now')).toBe(true)
    expect(matchesNode(payBtn, 'PAY')).toBe(true)
  })

  it('never matches on an empty/whitespace query (search stays inactive)', () => {
    expect(matchesNode(checkout, '')).toBe(false)
    expect(matchesNode(checkout, '   ')).toBe(false)
  })

  it("never matches a kind:'unknown' sink, even if the query hits its id/label", () => {
    expect(matchesNode(sink, 'dynamic')).toBe(false)
    expect(matchesNode(sink, 'u_n_checkout')).toBe(false)
  })
})

describe('searchMatchIds', () => {
  const nodes = [
    node({ id: 'n_checkout', label: 'Checkout', route: '/checkout' }),
    node({ id: 'm_login', kind: 'modal', label: 'Login modal' }),
    node({ id: 'c_pay', kind: 'control', parent: 'n_checkout', label: 'pay', control: { element: 'button', controlType: 'button', selector: { strategy: 'structural', value: 'button' }, name: 'Pay now' } }),
    node({ id: 'u_n_checkout', kind: 'unknown', label: 'dynamic' }),
  ]
  it('returns the exact id set for a query and excludes unknown sinks', () => {
    expect(searchMatchIds(nodes, 'checkout')).toEqual(new Set(['n_checkout']))
    expect([...searchMatchIds(nodes, 'login')]).toEqual(['m_login'])
  })
  it('returns an empty Set for an empty query', () => {
    expect(searchMatchIds(nodes, '').size).toBe(0)
  })
})

describe('matchProposal', () => {
  const all = { statuses: new Set<Proposal['status']>(), categories: new Set<string>(), evidenced: 'all' as const }
  const p = prop({ id: 'p1', status: 'proposed', category: 'redirect', evidenced: false })
  it('passes through when every filter is empty/all', () => {
    expect(matchProposal(p, all)).toBe(true)
  })
  it('narrows by status and category multi-select', () => {
    expect(matchProposal(p, { ...all, statuses: new Set(['confirmed']) })).toBe(false)
    expect(matchProposal(p, { ...all, statuses: new Set(['proposed']) })).toBe(true)
    expect(matchProposal(p, { ...all, categories: new Set(['disclosure']) })).toBe(false)
  })
  it('splits evidenced vs speculative', () => {
    expect(matchProposal(p, { ...all, evidenced: 'speculative' })).toBe(true)
    expect(matchProposal(p, { ...all, evidenced: 'evidenced' })).toBe(false)
  })
})

describe('matchCoverageRow', () => {
  const all = { statuses: new Set<EdgeCoverage['status']>(), modalities: new Set<string>(), sources: new Set<string>() }
  const open = row({ id: 'e1', status: 'open', modality: 'may', source: 'static' })
  const parked = row({ id: 'e2', status: 'parked', modality: 'unknown', source: 'static' })
  it('passes through when every axis is empty', () => {
    expect(matchCoverageRow(open, all)).toBe(true)
    expect(matchCoverageRow(parked, all)).toBe(true)
  })
  it('filters independently by status / modality / source', () => {
    expect(matchCoverageRow(open, { ...all, statuses: new Set(['parked']) })).toBe(false)
    expect(matchCoverageRow(parked, { ...all, statuses: new Set(['parked']) })).toBe(true)
    expect(matchCoverageRow(open, { ...all, modalities: new Set(['must']) })).toBe(false)
    expect(matchCoverageRow(open, { ...all, sources: new Set(['static']) })).toBe(true)
  })
})
