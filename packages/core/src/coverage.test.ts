import { describe, it, expect } from 'vitest'
import { buildCoverage, nextToVerify, nodeForUrl } from './coverage'
import { edge, graph, node } from './fixtures'
import type { ProposalGraph } from './proposals'

describe('nodeForUrl', () => {
  const g = graph(
    [node('n_root', { route: '/' }), node('n_profile', { route: '/profile' }), node('n_product', { route: '/products/:id' }), node('u_n_root', { kind: 'unknown', route: null })],
    [],
  )
  const A = 'http://app.local:3000'
  it('matches an exact route', () => {
    expect(nodeForUrl(g, `${A}/profile`, A)).toBe('n_profile')
    expect(nodeForUrl(g, `${A}/`, A)).toBe('n_root')
  })
  it('strips query/hash + trailing slash', () => {
    expect(nodeForUrl(g, `${A}/profile/?tab=x#y`, A)).toBe('n_profile')
  })
  it('maps to the sole parameterized candidate', () => {
    expect(nodeForUrl(g, `${A}/products/42`, A)).toBe('n_product')
  })
  it('returns null for undeclared, external, or wildcard-only paths', () => {
    expect(nodeForUrl(g, `${A}/nope`, A)).toBeNull()
    expect(nodeForUrl(g, 'http://evil.com/profile', A)).toBeNull()
  })
})

// a has a concrete runtime out-edge (e1), so the dynamic sink edge e3 out of a is
// resolved; e2 is a `may` (open until driven/parked); e4 is a proven must-static.
const g = () =>
  graph(
    [node('a'), node('b'), node('c'), node('u_a', { kind: 'unknown' })],
    [
      edge('e1', 'a', 'b', { source: 'runtime', modality: 'must' }),
      edge('e2', 'b', 'c', { source: 'static', modality: 'may', guard: 'x' }),
      edge('e3', 'a', 'u_a', { source: 'static', modality: 'unknown' }),
      edge('e4', 'a', 'b', { source: 'static', modality: 'must', event: 'navigate2' }),
    ],
  )

const pg: ProposalGraph = {
  nodes: [],
  edges: [{ id: 'pe_a->c', from: 'a', to: 'c', event: 'click', guard: null, effect: null, modality: 'may', proposalIds: ['p1', 'p2'] }],
}

describe('buildCoverage — two metrics', () => {
  it('keeps the strict runtime metric (verified = runtime only)', () => {
    const cov = buildCoverage(g())
    expect(cov.total).toBe(4)
    expect(cov.verified).toBe(1)
    expect(cov.runtimeVerified).toBe(1)
    expect(cov.ratio).toBeCloseTo(0.25)
    expect(cov.runtimeRatio).toBeCloseTo(0.25)
    expect(cov.unverified.map((e) => e.id).sort()).toEqual(['e2', 'e3', 'e4'])
  })

  it('credits must-static + runtime + resolved-dynamic as accounted, leaving only the may edge open', () => {
    const cov = buildCoverage(g())
    // e1 runtime, e4 must-static, e3 dynamic-resolved (a has runtime out-edge e1) => accounted; e2 may => open
    expect(cov.accounted).toBe(3)
    expect(cov.accountedRatio).toBeCloseTo(0.75)
    expect(cov.open.map((e) => e.id)).toEqual(['e2'])
    const byId = new Map(cov.unverified.concat(cov.open, cov.parked).map((e) => [e.id, e]))
    expect(byId.get('e3')?.status).toBe('dynamic-resolved')
    expect(byId.get('e4')?.status).toBe('static')
  })

  it('does NOT credit a `may` static edge (witness proves the call site, not that it fires)', () => {
    const cov = buildCoverage(graph([node('x'), node('y')], [edge('m', 'x', 'y', { source: 'static', modality: 'may' })]))
    expect(cov.open.map((e) => e.id)).toEqual(['m'])
    expect(cov.accountedRatio).toBe(0)
  })

  it('does NOT credit a dynamic sink edge whose source has no concrete runtime landing', () => {
    const cov = buildCoverage(graph([node('x'), node('u_x', { kind: 'unknown' })], [edge('d', 'x', 'u_x', { source: 'static', modality: 'unknown' })]))
    expect(cov.open[0]?.status).toBe('dynamic-open')
    expect(cov.accountedRatio).toBe(0)
  })

  it('counts a parked edge as accounted but NOT verified, in its own bucket with a reason', () => {
    const cov = buildCoverage(g(), [{ edgeId: 'e2', reason: 'route behind a feature flag', by: 'agent' }])
    expect(cov.parked.map((e) => e.id)).toEqual(['e2'])
    expect(cov.parked[0]?.reason).toBe('route behind a feature flag')
    expect(cov.open).toHaveLength(0)
    expect(cov.accountedRatio).toBe(1)
    // parked is excluded from the strict runtime count
    expect(cov.runtimeVerified).toBe(1)
  })

  it('accountedRatio is 1 only when the open set is empty', () => {
    expect(buildCoverage(graph([node('x'), node('y')], [edge('m', 'x', 'y', { source: 'static', modality: 'may' })])).accountedRatio).toBe(0)
    expect(buildCoverage(graph([], [])).accountedRatio).toBe(1)
  })
})

describe('nextToVerify', () => {
  it('ranks unknown > may > proposal; skips runtime, proven must, AND a resolved dynamic source', () => {
    // e3 (a->u_a) is skipped because a already has a concrete runtime out-edge (e1)
    const targets = nextToVerify(g(), pg)
    expect(targets.map((t) => t.id)).toEqual(['e2', 'pe_a->c'])
  })

  it('surfaces an unresolved dynamic sink edge as the top priority', () => {
    const g2 = graph([node('x'), node('y'), node('u_x', { kind: 'unknown' })], [edge('d', 'x', 'u_x', { source: 'static', modality: 'unknown' }), edge('m', 'x', 'y', { source: 'static', modality: 'may' })])
    const targets = nextToVerify(g2, { nodes: [], edges: [] })
    expect(targets.map((t) => t.id)).toEqual(['d', 'm'])
    expect(targets[0]?.priority).toBe(3)
  })

  it('excludes a parked edge from the worklist', () => {
    expect(nextToVerify(g(), pg, 20, new Set(['e2'])).map((t) => t.id)).toEqual(['pe_a->c'])
  })

  it('honours the limit', () => {
    expect(nextToVerify(g(), pg, 1)).toHaveLength(1)
  })
})
