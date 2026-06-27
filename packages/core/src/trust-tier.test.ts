// Tests for the trust-tier projection: a pure, on-read derivation of how far an
// agent should trust a discovered case (edge), from its source + modality + any
// proposal status (spec §3). The projection must never mutate the input edge and
// must order tiers witnessed > proven > asserted > llm-verified > proposed > unknown.

import { describe, expect, it } from 'vitest'
import type { GraphEdge, UiGraph } from './ir'
import type { ProposalGraphEdge } from './proposals'
import { enrichEdgesWithTier, getTierLabel, projectTrustTier, type TrustTier } from './trust-tier'

/** A minimal GraphEdge with sensible defaults, overridable per test. */
function edge(over: Partial<GraphEdge>): GraphEdge {
  return {
    id: 'e1',
    from: 'a',
    to: 'b',
    event: 'click',
    guard: null,
    effect: null,
    modality: 'may',
    source: 'static',
    confidence: 1,
    ...over,
  }
}

describe('projectTrustTier', () => {
  it('witnessed tier — source:runtime edges always get witnessed regardless of modality or proposal status', () => {
    expect(projectTrustTier(edge({ source: 'runtime', modality: 'must' }))).toBe('witnessed')
    expect(projectTrustTier(edge({ source: 'runtime', modality: 'unknown' }))).toBe('witnessed')
    expect(projectTrustTier(edge({ source: 'runtime', modality: 'may' }), 'proposed')).toBe('witnessed')
  })

  it('proven tier — source:static|manual + modality:must + witness → proven', () => {
    const w = { source: 'static' as const, file: 'f.ts', loc: { line: 1, col: 1 } }
    expect(projectTrustTier(edge({ source: 'static', modality: 'must', witness: w }))).toBe('proven')
    expect(projectTrustTier(edge({ source: 'manual', modality: 'must', witness: { source: 'manual' } }))).toBe('proven')
  })

  it('asserted tier — source:static|manual + modality:may → asserted (exists in code, not exercised)', () => {
    expect(projectTrustTier(edge({ source: 'static', modality: 'may' }))).toBe('asserted')
    expect(projectTrustTier(edge({ source: 'manual', modality: 'may' }))).toBe('asserted')
  })

  it('unknown tier — modality:unknown + no witness/proposal → unknown (frontier; probe/ask)', () => {
    expect(projectTrustTier(edge({ source: 'static', modality: 'unknown' }))).toBe('unknown')
    expect(projectTrustTier(edge({ source: 'manual', modality: 'unknown' }))).toBe('unknown')
  })

  it('llm-verified tier — proposal status:unverifiable → llm-verified (plausible but undrivable, parked)', () => {
    expect(projectTrustTier(edge({ source: 'static', modality: 'may' }), 'unverifiable')).toBe('llm-verified')
  })

  it('proposed tier — proposal status:proposed → proposed (unjudged, weak hypothesis)', () => {
    expect(projectTrustTier(edge({ source: 'static', modality: 'may' }), 'proposed')).toBe('proposed')
    expect(projectTrustTier(edge({ source: 'static', modality: 'unknown' }), 'proposed')).toBe('proposed')
  })

  it('proposal-confirmed promotion — a confirmed proposal whose edge is source:runtime → witnessed (observation wins)', () => {
    expect(projectTrustTier(edge({ source: 'runtime', modality: 'must' }), 'confirmed')).toBe('witnessed')
  })

  it('proposal-rejected — a rejected proposal edge stays proposed (rejected proposals do not enter the proven graph)', () => {
    expect(projectTrustTier(edge({ source: 'static', modality: 'may' }), 'rejected')).toBe('proposed')
  })

  it('static must with NO witness → proven (silent witness ok per spec; static must is proven)', () => {
    expect(projectTrustTier(edge({ source: 'static', modality: 'must', witness: undefined }))).toBe('proven')
  })

  it('projection is pure — never mutates the input edge', () => {
    const e = Object.freeze(edge({ source: 'static', modality: 'must' }))
    expect(() => projectTrustTier(e)).not.toThrow()
    expect(projectTrustTier(e)).toBe('proven')
    expect('trustTier' in e).toBe(false)
  })
})

describe('enrichEdgesWithTier', () => {
  /** A minimal graph with one proven edge and one asserted edge. */
  function graph(edges: GraphEdge[]): UiGraph {
    return {
      version: 0,
      meta: { adapter: 't', adapterVersion: '0', rulesetVersion: '0' },
      nodes: [
        { id: 'a', route: '/a', componentPath: null, label: 'A', kind: 'screen' },
        { id: 'b', route: '/b', componentPath: null, label: 'B', kind: 'screen' },
      ],
      edges,
    }
  }

  it('all edges (base + proposed) get tier labels, sorted by tier precedence', () => {
    const g = graph([
      edge({ id: 'asserted', source: 'static', modality: 'may' }),
      edge({ id: 'witnessed', source: 'runtime', modality: 'must' }),
      edge({ id: 'proven', source: 'static', modality: 'must' }),
    ])
    const proposed: ProposalGraphEdge[] = [
      { id: 'prop', from: 'a', to: 'b', event: 'x', guard: null, effect: null, modality: 'may', proposalIds: ['p1'] },
    ]
    const out = enrichEdgesWithTier(g, proposed)
    expect(out.every((e) => typeof e.trustTier === 'string')).toBe(true)
    expect(out.map((e) => e.trustTier)).toEqual(['witnessed', 'proven', 'asserted', 'proposed'])
  })

  it('does not mutate the source graph edges', () => {
    const e = edge({ id: 'proven', source: 'static', modality: 'must' })
    const g = graph([e])
    enrichEdgesWithTier(g, [])
    expect('trustTier' in e).toBe(false)
  })
})

describe('getTierLabel', () => {
  it('each tier has a non-empty human-readable description', () => {
    const tiers: TrustTier[] = ['witnessed', 'proven', 'asserted', 'llm-verified', 'proposed', 'unknown']
    for (const t of tiers) {
      expect(getTierLabel(t).length).toBeGreaterThan(0)
    }
  })
})
