import { describe, it, expect } from 'vitest'
import { buildCoverage, nextToVerify } from './coverage'
import { edge, graph, node } from './fixtures'
import type { ProposalGraph } from './proposals'

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

describe('buildCoverage', () => {
  it('counts runtime-witnessed edges as verified, lists the rest', () => {
    const cov = buildCoverage(g())
    expect(cov.total).toBe(4)
    expect(cov.verified).toBe(1)
    expect(cov.ratio).toBeCloseTo(0.25)
    expect(cov.bySource.runtime).toBe(1)
    expect(cov.unverified.map((e) => e.id).sort()).toEqual(['e2', 'e3', 'e4'])
  })
})

describe('nextToVerify', () => {
  it('ranks unknown > may > proposal, skips runtime + proven must, dedupes runtime pairs', () => {
    const targets = nextToVerify(g(), pg)
    // e1 is runtime (skip); e4 is must-static (skip); e3 unknown(3) > e2 may(2) > pe proposal(1)
    expect(targets.map((t) => t.id)).toEqual(['e3', 'e2', 'pe_a->c'])
    expect(targets[0]?.priority).toBe(3)
    expect(targets.find((t) => t.kind === 'proposal')?.proposalIds).toEqual(['p1', 'p2'])
  })

  it('honours the limit', () => {
    expect(nextToVerify(g(), pg, 1)).toHaveLength(1)
  })
})
