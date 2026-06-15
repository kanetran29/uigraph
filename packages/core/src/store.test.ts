import { describe, it, expect } from 'vitest'
import { openStore } from './store'
import { edge, graph, node } from './fixtures'
import { emptyOverlay } from './overlay'
import { hashValue } from './hash'
import type { Proposals } from './proposals'
import type { Observation } from './runtime'

const g = () => graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')])

const sidecar = (over: Partial<Proposals> = {}): Proposals => ({
  version: 0,
  base: 'h',
  proposals: [
    { id: 'p1', kind: 'interaction', category: 'keyboard', screen: 'a', title: 'press enter', rationale: 'r', evidenced: true, confidence: 0.9, source: 'proposal', status: 'proposed', screenshot: 'shots/a.jpeg' },
    { id: 'p2', kind: 'edge', category: 'navigation', screen: 'b', title: 'go a', to: 'a', rationale: 'r', evidenced: false, confidence: 0.3, source: 'proposal', status: 'proposed' },
  ],
  ...over,
})

describe('Store (SQLite)', () => {
  it('round-trips the base graph + soundiness as documents', () => {
    const s = openStore(':memory:')
    expect(s.getBaseGraph()).toBeNull()
    s.setBaseGraph(g(), [{ kind: 'dynamic-target', detail: 'x' }])
    expect(s.getBaseGraph()).toEqual(g())
    expect(s.getSoundiness()).toEqual([{ kind: 'dynamic-target', detail: 'x' }])
    s.close()
  })

  it('rejects an invalid base graph', () => {
    const s = openStore(':memory:')
    const bad = graph([node('a')], [edge('e_ax', 'a', 'ghost')])
    expect(() => s.setBaseGraph(bad)).toThrow(/invalid graph/)
    s.close()
  })

  it('round-trips the overlay document', () => {
    const s = openStore(':memory:')
    const o = emptyOverlay(hashValue(g()))
    s.setOverlay(o)
    expect(s.getOverlay()).toEqual(o)
    s.close()
  })

  it('appends and reads observations in order, preserving optional fields', () => {
    const s = openStore(':memory:')
    const o1: Observation = { id: 'o1', from: 'a', to: 'b', event: 'click', outcome: 'confirmed', screenshot: 'e.png' }
    const o2: Observation = { id: 'o2', from: 'b', to: 'a', event: 'nav', outcome: 'refuted' }
    s.appendObservation(o1)
    s.appendObservation(o2)
    expect(s.getObservations()).toEqual([o1, o2])
    s.close()
  })

  it('stores proposals and reconstructs the sidecar, dropping null optionals', () => {
    const s = openStore(':memory:')
    expect(s.getProposals()).toBeNull()
    s.setProposals(sidecar())
    const got = s.getProposals()
    expect(got?.base).toBe('h')
    expect(got?.proposals).toHaveLength(2)
    const p2 = got?.proposals.find((p) => p.id === 'p2')
    expect(p2?.to).toBe('a')
    expect('screenshot' in (p2 as object)).toBe(false)
    expect(got?.proposals.find((p) => p.id === 'p1')?.screenshot).toBe('shots/a.jpeg')
    s.close()
  })

  it('filters proposals with SQL (screen, category, evidenced, confidence)', () => {
    const s = openStore(':memory:')
    s.setProposals(sidecar())
    expect(s.queryProposals({ screen: 'a' }).map((p) => p.id)).toEqual(['p1'])
    expect(s.queryProposals({ category: 'navigation' }).map((p) => p.id)).toEqual(['p2'])
    expect(s.queryProposals({ evidencedOnly: true }).map((p) => p.id)).toEqual(['p1'])
    expect(s.queryProposals({ minConfidence: 0.5 }).map((p) => p.id)).toEqual(['p1'])
    s.close()
  })

  it('setProposals replaces the previous set (no accumulation)', () => {
    const s = openStore(':memory:')
    s.setProposals(sidecar())
    s.setProposals(sidecar({ proposals: [{ id: 'p3', kind: 'interaction', category: 'x', screen: 'a', title: 't', rationale: 'r', evidenced: false, confidence: 0.5, source: 'proposal', status: 'proposed' }] }))
    expect(s.queryProposals().map((p) => p.id)).toEqual(['p3'])
    s.close()
  })

  it('persists proposals as a quarantined node/edge graph (queryable, not in the proven IR)', () => {
    const s = openStore(':memory:')
    s.setBaseGraph(g())
    s.setProposals(sidecar())
    const pg = s.getProposalGraph()
    // p2 targets a real screen 'a' -> a direct proposed edge b->a
    const direct = pg.edges.find((e) => e.from === 'b' && e.to === 'a')
    expect(direct?.proposalIds).toContain('p2')
    // the proven graph is untouched (still its single static edge)
    expect(s.getBaseGraph()?.edges).toHaveLength(1)
    s.close()
  })

  it('setProposalStatus updates one row + reason, dropping it from the active proposal graph', () => {
    const s = openStore(':memory:')
    s.setBaseGraph(g())
    s.setProposals(sidecar())
    expect(s.getProposalGraph().edges.some((e) => e.proposalIds.includes('p2'))).toBe(true)
    expect(s.setProposalStatus('p2', 'rejected', 'disproven at runtime')).toBe(true)
    expect(s.getProposalGraph().edges.some((e) => e.proposalIds.includes('p2'))).toBe(false)
    expect(s.queryProposals({ status: 'rejected' })[0]?.reason).toBe('disproven at runtime')
    expect(s.setProposalStatus('missing', 'rejected')).toBe(false)
    s.close()
  })

  it('reconcileFromObservations derives statuses from the log and is idempotent', () => {
    const s = openStore(':memory:')
    s.setBaseGraph(g())
    s.setProposals(sidecar())
    s.appendObservation({ id: 'o1', from: 'b', to: 'a', event: 'click', outcome: 'confirmed' })
    expect(s.reconcileFromObservations()).toEqual([{ id: 'p2', status: 'confirmed' }])
    expect(s.queryProposals({ status: 'confirmed' }).map((p) => p.id)).toEqual(['p2'])
    // p2 left the active worklist; the proven graph is unchanged
    expect(s.getProposalGraph().edges.some((e) => e.proposalIds.includes('p2'))).toBe(false)
    expect(s.getBaseGraph()?.edges).toHaveLength(1)
    // second call with no new observations changes nothing
    expect(s.reconcileFromObservations()).toEqual([])
    s.close()
  })

  it('parks and un-parks edges as auditable sidecar metadata (never touching the graph)', () => {
    const s = openStore(':memory:')
    s.setBaseGraph(g())
    expect(s.getParkedEdges()).toEqual([])
    const entry = s.parkEdge('e_ab', 'route behind a feature flag', 'runner')
    expect(entry).toMatchObject({ edgeId: 'e_ab', reason: 'route behind a feature flag', by: 'runner' })
    expect(s.getParkedEdges().map((p) => p.edgeId)).toEqual(['e_ab'])
    // upsert dedupes by edge id
    s.parkEdge('e_ab', 'updated reason')
    expect(s.getParkedEdges()).toHaveLength(1)
    // the proven graph is untouched
    expect(s.getBaseGraph()?.edges).toHaveLength(1)
    expect(s.unparkEdge('e_ab')).toBe(true)
    expect(s.getParkedEdges()).toEqual([])
    expect(s.unparkEdge('missing')).toBe(false)
    expect(() => s.parkEdge('e_ab', '   ')).toThrow(/reason/)
    s.close()
  })

  it('filters proposals by status', () => {
    const s = openStore(':memory:')
    s.setProposals(sidecar())
    s.setProposalStatus('p1', 'unverifiable', 'not reachable in dev')
    expect(s.queryProposals({ status: 'proposed' }).map((p) => p.id)).toEqual(['p2'])
    expect(s.queryProposals({ status: 'unverifiable' }).map((p) => p.id)).toEqual(['p1'])
    s.close()
  })

  it('round-trips a source fingerprint', () => {
    const s = openStore(':memory:')
    expect(s.getFingerprint()).toBeNull()
    const fp = { projectDir: '/p', adapter: 'react', hash: 'h', files: { 'a.ts': 'A' }, mappedAt: '2026-01-01T00:00:00Z' }
    s.setFingerprint(fp)
    expect(s.getFingerprint()).toEqual(fp)
    s.close()
  })
})
