import { describe, it, expect } from 'vitest'
import { buildCoverage, nextToVerify, nodeForUrl } from './coverage'
import { buildFrontier } from './frontier'
import type { TrustTier } from './trust-tier'
import { edge, graph, node } from './fixtures'
import { materializeProposalGraph, type Proposal, type ProposalGraph } from './proposals'

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

  it('exposes verifiedCount/verifiedRatio = witnessed + proven (runtime + must-static), below accounted', () => {
    // e1 runtime (witnessed) + e4 must-static (proven) = 2 verified; e3 dynamic-resolved is
    // accounted but NOT verified, so verifiedRatio (0.5) < accountedRatio (0.75).
    const cov = buildCoverage(g())
    expect(cov.verifiedCount).toBe(2)
    expect(cov.verifiedRatio).toBeCloseTo(0.5)
    expect(cov.verifiedRatio).toBeLessThan(cov.accountedRatio)
    expect(cov.runtimeRatio).toBeLessThanOrEqual(cov.verifiedRatio)
  })

  it('accounted=100% does not imply verified=100%: a parked edge is accounted, not verified', () => {
    // park the lone open `may` edge => accountedRatio 1, but verifiedRatio stays at the
    // witnessed+proven fraction and parkedCount surfaces the un-verified triage.
    const cov = buildCoverage(g(), [{ edgeId: 'e2', reason: 'behind a flag', by: 'agent' }])
    expect(cov.accountedRatio).toBe(1)
    expect(cov.parkedCount).toBe(1)
    expect(cov.verifiedRatio).toBeLessThan(1)
    expect(cov.verifiedCount).toBe(2)
  })

  it('verifiedRatio is 1 for an empty graph and equals 1 only when every edge is witnessed/proven', () => {
    expect(buildCoverage(graph([], [])).verifiedRatio).toBe(1)
    const allProven = buildCoverage(graph([node('x'), node('y')], [edge('p', 'x', 'y', { source: 'static', modality: 'must' })]))
    expect(allProven.verifiedRatio).toBe(1)
    expect(allProven.parkedCount).toBe(0)
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

describe('buildCoverage — tier distribution + frontier (additive)', () => {
  const ALL_TIERS: TrustTier[] = ['witnessed', 'proven', 'asserted', 'llm-verified', 'proposed', 'unknown']

  it('exposes tierDistribution keyed by exactly the 6 trust tiers', () => {
    const cov = buildCoverage(g())
    expect(cov.tierDistribution).toBeDefined()
    expect(Object.keys(cov.tierDistribution ?? {}).sort()).toEqual([...ALL_TIERS].sort())
  })

  it('tierDistribution sums to the total edge count', () => {
    const cov = buildCoverage(g())
    const sum = Object.values(cov.tierDistribution ?? {}).reduce((a, b) => a + b, 0)
    expect(sum).toBe(cov.total)
  })

  it('counts tiers correctly for a mixed runtime+static graph', () => {
    // e1 runtime->witnessed, e2 may->asserted, e3 unknown->unknown, e4 must->proven
    const cov = buildCoverage(g())
    expect(cov.tierDistribution).toEqual({ witnessed: 1, proven: 1, asserted: 1, 'llm-verified': 0, proposed: 0, unknown: 1 })
  })

  it('frontierCount matches buildFrontier on the same graph', () => {
    const cov = buildCoverage(g())
    expect(cov.frontierCount).toBe(buildFrontier(g()).unknownCount)
  })

  it('frontierCount excludes a RESOLVED dynamic source but keeps dead-end states', () => {
    // a has a dynamic sink (e3) BUT also a concrete runtime out-edge (e1 a->b), so its
    // dispatch is resolved => a is NOT frontier; b has an out-edge (e2); c is a dead end
    // => frontier; u_a is an unknown sink, not counted.
    const cov = buildCoverage(g())
    const f = buildFrontier(g())
    expect(cov.frontierCount).toBe(f.unknownCount)
    expect(f.states.sort()).toEqual(['c'])
  })

  it('keeps existing fields unchanged (backward compatible)', () => {
    const cov = buildCoverage(g())
    expect(cov.total).toBe(4)
    expect(cov.verified).toBe(1)
    expect(cov.accounted).toBe(3)
    expect(cov.byModality).toBeDefined()
    expect(cov.bySource).toBeDefined()
    expect(cov.unverified).toBeDefined()
    expect(cov.open).toBeDefined()
    expect(cov.parked).toBeDefined()
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

  it('never ranks a rejected proposal alongside proposed ones (only proposed reach the worklist)', () => {
    const pg2 = graph([node('a'), node('b'), node('c')], [])
    const base = (over: Partial<Proposal>): Proposal => ({
      id: 'x', kind: 'edge', category: 'nav', screen: 'a', title: 't', rationale: 'r',
      evidenced: true, confidence: 0.5, source: 'proposal', status: 'proposed', event: 'click', ...over,
    })
    const proposalGraph = materializeProposalGraph(pg2, [
      base({ id: 'open', to: 'b', status: 'proposed' }),
      base({ id: 'gone', to: 'c', status: 'rejected' }),
    ])
    const ids = nextToVerify(pg2, proposalGraph).filter((t) => t.kind === 'proposal').map((t) => t.id)
    expect(ids).toEqual(['pe_a->b'])
  })
})
