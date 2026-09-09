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
    { id: 'p2', kind: 'edge', category: 'navigation', screen: 'b', title: 'go a', to: 'a', event: 'click', rationale: 'r', evidenced: false, confidence: 0.3, source: 'proposal', status: 'proposed' },
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

  it('re-map with a changed graph drops runner parks but keeps agent parks (era-bound)', () => {
    const s = openStore(':memory:')
    s.setBaseGraph(g())
    s.parkEdge('e_ab', 'undrivable now', 'runner')
    s.parkEdge('e_other', 'human judgment', 'agent')
    s.setBaseGraph(graph([node('a'), node('b'), node('c')], [edge('e_ab', 'a', 'b'), edge('e_other', 'a', 'c')]))
    expect(s.getParkedEdges().map((p) => p.edgeId)).toEqual(['e_other'])
    s.close()
  })
  it('a re-map prunes agent parks whose edge no longer exists in the incoming graph', () => {
    const store = openStore(':memory:')
    const g1 = graph([node('a'), node('b'), node('c')], [edge('e1', 'a', 'b'), edge('e2', 'a', 'c')])
    store.setBaseGraph(g1)
    store.parkEdge('e2', 'needs a seeded account', 'agent')
    const g2 = graph([node('a'), node('b')], [edge('e1', 'a', 'b')])
    store.setBaseGraph(g2)
    expect(store.getParkedEdges()).toEqual([])
    store.close()
  })


  it('re-map with an identical graph keeps all parks', () => {
    const s = openStore(':memory:')
    s.setBaseGraph(g())
    s.parkEdge('e_ab', 'undrivable now', 'runner')
    s.parkEdge('e_other', 'human judgment', 'agent')
    s.setBaseGraph(g())
    expect(s.getParkedEdges().map((p) => p.edgeId)).toEqual(['e_ab', 'e_other'])
    s.close()
  })

  it('first-ever setBaseGraph (no prior graph) keeps existing parks', () => {
    const s = openStore(':memory:')
    s.parkEdge('e_ab', 'parked before first map', 'runner')
    s.setBaseGraph(g())
    expect(s.getParkedEdges().map((p) => p.edgeId)).toEqual(['e_ab'])
    s.close()
  })

  describe('screenshots + control names (sidecars keyed by node id)', () => {
    const shot = (path: string, source: 'landing' | 'goto' = 'landing') => ({ path, ts: '2026-01-01T00:00:00Z', base: 'h', source })
    const ctl = (id: string) => node(id, { route: null, label: 'button', kind: 'control', parent: 'a', control: { element: 'button', controlType: 'button' } })

    it('round-trips shots; the newest capture wins per node id', () => {
      const s = openStore(':memory:')
      expect(s.getScreenShots()).toEqual({})
      s.setScreenShot('a', shot('shots/a.jpg', 'goto'))
      s.setScreenShot('b', shot('shots/b.jpg'))
      s.setScreenShot('a', shot('shots/a.jpg'))
      expect(s.getScreenShots()).toEqual({ a: shot('shots/a.jpg'), b: shot('shots/b.jpg') })
      s.close()
    })

    it('round-trips names, upserts, clears, and rejects an empty name', () => {
      const s = openStore(':memory:')
      expect(s.getControlNames()).toEqual({})
      s.setControlName('c1', 'Save')
      s.setControlName('c1', 'Save draft')
      s.setControlName('c2', 'Cancel')
      expect(s.getControlNames()).toEqual({ c1: 'Save draft', c2: 'Cancel' })
      s.clearControlName('c1')
      s.clearControlName('missing')
      expect(s.getControlNames()).toEqual({ c2: 'Cancel' })
      expect(() => s.setControlName('c2', '  ')).toThrow(/name/)
      s.close()
    })

    it('rejects a name the fold could not serve as a label (control chars, multi-line, over the text cap) — nothing stored', () => {
      const s = openStore(':memory:')
      expect(() => s.setControlName('c1', 'Sign\x01in')).toThrow(/control characters/)
      expect(() => s.setControlName('c1', 'x\n  require("node:child_process")')).toThrow(/single-line/)
      expect(() => s.setControlName('c1', 'x'.repeat(2001))).toThrow(/2000/)
      expect(s.getControlNames()).toEqual({})
      s.close()
    })

    it('a re-map prunes shots/names whose node id disappeared but keeps survivors across a hash change', () => {
      const s = openStore(':memory:')
      s.setBaseGraph(graph([node('a'), node('b'), ctl('c1'), ctl('c2')], []))
      s.setScreenShot('a', shot('shots/a.jpg'))
      s.setScreenShot('b', shot('shots/b.jpg'))
      s.setControlName('c1', 'Save')
      s.setControlName('c2', 'Cancel')
      s.setBaseGraph(graph([node('a'), node('z'), ctl('c1')], []))
      expect(s.getScreenShots()).toEqual({ a: shot('shots/a.jpg') })
      expect(s.getControlNames()).toEqual({ c1: 'Save' })
      // the proven graph never carries either sidecar
      expect(s.getBaseGraph()?.nodes.every((n) => n.screenshot === undefined)).toBe(true)
      expect(s.getBaseGraph()?.nodes.find((n) => n.id === 'c1')?.control?.name).toBeUndefined()
      s.close()
    })

    it('a re-map with an identical graph keeps every shot and name', () => {
      const s = openStore(':memory:')
      s.setBaseGraph(g())
      s.setScreenShot('a', shot('shots/a.jpg'))
      s.setControlName('a', 'Home')
      s.setBaseGraph(g())
      expect(s.getScreenShots()).toEqual({ a: shot('shots/a.jpg') })
      expect(s.getControlNames()).toEqual({ a: 'Home' })
      s.close()
    })
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

  describe('snapshotCurrentAsPrevious / getPreviousGraph (temporal-diff rotation)', () => {
    const fp = (mappedAt: string) => ({ projectDir: '/p', adapter: 'react', hash: 'h', files: {}, mappedAt })

    it('is a no-op on the first map (no base graph yet): returns false, no previous written', () => {
      const s = openStore(':memory:')
      expect(s.snapshotCurrentAsPrevious()).toBe(false)
      expect(s.getPreviousGraph()).toBeNull()
      s.close()
    })

    it('captures the current graph + its fingerprint mappedAt as the previous snapshot', () => {
      const s = openStore(':memory:')
      const g1 = graph([node('a')], [])
      s.setBaseGraph(g1)
      s.setFingerprint(fp('2026-01-01T00:00:00Z'))
      expect(s.snapshotCurrentAsPrevious()).toBe(true)
      expect(s.getPreviousGraph()).toEqual({ graph: g1, mappedAt: '2026-01-01T00:00:00Z' })
      s.close()
    })

    it('reads the PRIOR fingerprint mappedAt at rotation time, not a later one (clock-free)', () => {
      const s = openStore(':memory:')
      const g1 = graph([node('a')], [])
      const g2 = graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')])
      s.setBaseGraph(g1)
      s.setFingerprint(fp('T1'))
      s.snapshotCurrentAsPrevious()
      s.setBaseGraph(g2)
      s.setFingerprint(fp('T2'))
      // previous still holds g1 stamped T1, untouched by the later T2 map
      expect(s.getPreviousGraph()).toEqual({ graph: g1, mappedAt: 'T1' })
      s.close()
    })

    it('stamps mappedAt="" when the current graph predates fingerprinting (e.g. a migrate import)', () => {
      const s = openStore(':memory:')
      s.setBaseGraph(graph([node('a')], []))
      expect(s.snapshotCurrentAsPrevious()).toBe(true)
      expect(s.getPreviousGraph()?.mappedAt).toBe('')
      s.close()
    })

    it('keeps history depth ONE: a second rotation overwrites the previous slot', () => {
      const s = openStore(':memory:')
      const g1 = graph([node('a')], [])
      const g2 = graph([node('a'), node('b')], [])
      const g3 = graph([node('a'), node('b'), node('c')], [])
      s.setBaseGraph(g1)
      s.snapshotCurrentAsPrevious()
      s.setBaseGraph(g2)
      s.snapshotCurrentAsPrevious()
      s.setBaseGraph(g3)
      // previous is g2 (the immediately-prior map), not g1
      expect(s.getPreviousGraph()?.graph).toEqual(g2)
      s.close()
    })
  })
})
