import { describe, it, expect } from 'vitest'
import { validateRefs } from './staleness'
import { edge, graph, node } from './fixtures'
import { emptyOverlay } from './overlay'
import { applyObservations } from './runtime'
import { hashValue } from './hash'
import { openStore } from './store'
import type { Overlay } from './ir'
import type { Proposals } from './proposals'
import type { Observation } from './runtime'

const g = () => graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')])

const sidecar = (over: Partial<Proposals> = {}): Proposals => ({
  version: 0,
  base: hashValue(g()),
  proposals: [
    { id: 'p1', kind: 'interaction', category: 'keyboard', screen: 'a', title: 't', rationale: 'r', evidenced: true, confidence: 0.9, source: 'proposal', status: 'proposed' },
  ],
  ...over,
})

describe('validateRefs (pure staleness report)', () => {
  it('reports ok with no issues when every ref resolves and hashes match', () => {
    const r = validateRefs({ base: g(), overlay: emptyOverlay(hashValue(g())), proposals: sidecar(), observations: [] })
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.baseHash).toBe(hashValue(g()))
  })

  it('flags a ghost-node observation as dropped (no edge minted)', () => {
    const obs: Observation = { id: 'o1', from: 'a', to: 'ghost', event: 'click', outcome: 'confirmed' }
    const r = validateRefs({ base: g(), observations: [obs] })
    expect(r.ok).toBe(false)
    expect(r.droppedObservationIds).toEqual(['o1'])
    expect(r.issues[0]?.code).toBe('OBSERVATION_DANGLING')
  })

  it('does not flag an observation whose from/to are both real', () => {
    const obs: Observation = { id: 'o1', from: 'a', to: 'b', event: 'click', outcome: 'confirmed' }
    const r = validateRefs({ base: g(), observations: [obs] })
    expect(r.droppedObservationIds).toEqual([])
  })

  it('flags a stale-hash proposals sidecar', () => {
    const r = validateRefs({ base: g(), proposals: sidecar({ base: 'deadbeef' }) })
    expect(r.proposalsStaleHash).toBe(true)
    expect(r.issues.some((i) => i.code === 'PROPOSAL_STALE_HASH')).toBe(true)
  })

  it('flags a proposal pointing at a ghost node', () => {
    const r = validateRefs({ base: g(), proposals: sidecar({ proposals: [{ id: 'p9', kind: 'edge', category: 'nav', screen: 'a', title: 't', to: 'ghost', rationale: 'r', evidenced: false, confidence: 0.5, source: 'proposal', status: 'proposed' }] }) })
    expect(r.issues.some((i) => i.code === 'PROPOSAL_DANGLING' && i.id === 'p9')).toBe(true)
  })

  it('does not flag a proposal whose to is the synthetic <modal> placeholder', () => {
    const r = validateRefs({ base: g(), proposals: sidecar({ proposals: [{ id: 'pm', kind: 'edge', category: 'disclosure', screen: 'a', title: 't', to: '<modal>', rationale: 'r', evidenced: false, confidence: 0.5, source: 'proposal', status: 'proposed' }] }) })
    expect(r.issues.some((i) => i.code === 'PROPOSAL_DANGLING')).toBe(false)
  })

  it('flags a stale-hash overlay and a dangling overlay edge ref', () => {
    const o: Overlay = {
      ...emptyOverlay('deadbeef'),
      addedEdges: [edge('m_e', 'a', 'ghost', { source: 'manual', witness: undefined })],
    }
    const r = validateRefs({ base: g(), overlay: o })
    expect(r.overlayStaleHash).toBe(true)
    expect(r.issues.some((i) => i.code === 'OVERLAY_EDGE_DANGLING' && i.id === 'm_e')).toBe(true)
  })

  it('treats overlay addedNodes as valid edge targets', () => {
    const o: Overlay = {
      ...emptyOverlay(hashValue(g())),
      addedNodes: [node('c')],
      addedEdges: [edge('m_e', 'a', 'c', { source: 'manual', witness: undefined })],
    }
    const r = validateRefs({ base: g(), overlay: o })
    expect(r.ok).toBe(true)
  })

  it('flags dangling overlay removedRefs and editedNodes', () => {
    const o: Overlay = { ...emptyOverlay(hashValue(g())), removedRefs: ['ghost'], editedNodes: [node('ghost2')] }
    const r = validateRefs({ base: g(), overlay: o })
    expect(r.issues.some((i) => i.code === 'OVERLAY_REMOVED_DANGLING' && i.id === 'ghost')).toBe(true)
    expect(r.issues.some((i) => i.code === 'OVERLAY_EDITED_NODE_DANGLING' && i.id === 'ghost2')).toBe(true)
  })

  it('agrees with applyObservations: a flagged ghost observation mints no edge', () => {
    const obs: Observation = { id: 'o1', from: 'a', to: 'ghost', event: 'click', outcome: 'confirmed' }
    const r = validateRefs({ base: g(), observations: [obs] })
    const folded = applyObservations(g(), [obs])
    expect(r.droppedObservationIds).toContain('o1')
    expect(folded.edges).toHaveLength(g().edges.length)
  })
})

describe('Store.stalenessReport', () => {
  it('returns an ok empty report when there is no base graph', () => {
    const s = openStore(':memory:')
    const r = s.stalenessReport()
    expect(r.ok).toBe(true)
    expect(r.baseHash).toBe('')
    s.close()
  })

  it('flags a ghost-node observation that the fold never folds into an edge', () => {
    const s = openStore(':memory:')
    s.setBaseGraph(g())
    s.appendObservation({ id: 'o1', from: 'a', to: 'ghost', event: 'click', outcome: 'confirmed' })
    const r = s.stalenessReport()
    expect(r.ok).toBe(false)
    expect(r.droppedObservationIds).toEqual(['o1'])
    expect(applyObservations(s.getBaseGraph()!, s.getObservations()).edges).toHaveLength(1)
    s.close()
  })

  it('flags stale-hash proposals stored against a different base', () => {
    const s = openStore(':memory:')
    s.setBaseGraph(g())
    s.setProposals(sidecar({ base: 'deadbeef' }))
    const r = s.stalenessReport()
    expect(r.proposalsStaleHash).toBe(true)
    expect(r.issues.some((i) => i.code === 'PROPOSAL_STALE_HASH')).toBe(true)
    s.close()
  })
})
