import { describe, it, expect } from 'vitest'
import { diffGraphs, diffSinceLast } from './diff'
import { edge, graph, node } from './fixtures'

describe('diffGraphs', () => {
  it('detects added and removed nodes and edges', () => {
    const a = graph([node('a'), node('b')], [edge('e1', 'a', 'b')])
    const b = graph([node('a'), node('c')], [edge('e2', 'a', 'c')])
    const d = diffGraphs(a, b)
    expect(d.addedNodes.map((n) => n.id)).toEqual(['c'])
    expect(d.removedNodes.map((n) => n.id)).toEqual(['b'])
    expect(d.addedEdges.map((e) => e.id)).toEqual(['e2'])
    expect(d.removedEdges.map((e) => e.id)).toEqual(['e1'])
  })

  it('reports changed fields for same-id edges', () => {
    const a = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { modality: 'must', guard: null })])
    const b = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { modality: 'may', guard: 'isAuth' })])
    const d = diffGraphs(a, b)
    expect(d.changedEdges).toHaveLength(1)
    expect(d.changedEdges[0]?.fields.sort()).toEqual(['guard', 'modality'])
  })

  it('reports no changes for identical graphs', () => {
    const a = graph([node('a'), node('b')], [edge('e1', 'a', 'b')])
    const d = diffGraphs(a, a)
    expect(d.changedEdges).toEqual([])
    expect(d.addedEdges).toEqual([])
  })
})

describe('diffSinceLast (temporal "since last map" diff)', () => {
  const cur = graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')])

  it('state no-current when the workspace was never mapped', () => {
    const r = diffSinceLast(null, null, null)
    expect(r.state).toBe('no-current')
    expect(r.diff).toBeNull()
    expect(r.detail).toMatch(/uigraph map/)
  })

  it('state no-prior when mapped exactly once (no previous to compare)', () => {
    const r = diffSinceLast(cur, '2026-02-02T00:00:00Z', null)
    expect(r.state).toBe('no-prior')
    expect(r.diff).toBeNull()
    expect(r.currentMappedAt).toBe('2026-02-02T00:00:00Z')
    expect(r.detail).toMatch(/re-map/)
  })

  it('state ok diffs previous->current with load-bearing orientation (added in current = added)', () => {
    const prev = graph([node('a')], [])
    const r = diffSinceLast(cur, 'T2', { graph: prev, mappedAt: 'T1' })
    expect(r.state).toBe('ok')
    // node b + edge e_ab exist only in current -> ADDED (not removed) — pins diffGraphs(prev, current)
    expect(r.diff?.addedNodes.map((n) => n.id)).toEqual(['b'])
    expect(r.diff?.addedEdges.map((e) => e.id)).toEqual(['e_ab'])
    expect(r.diff?.removedNodes).toEqual([])
    expect(r.previousMappedAt).toBe('T1')
    expect(r.currentMappedAt).toBe('T2')
  })

  it('normalizes an empty-string previous timestamp (migrated workspace) to null', () => {
    const r = diffSinceLast(cur, 'T2', { graph: cur, mappedAt: '' })
    expect(r.state).toBe('ok')
    expect(r.previousMappedAt).toBeNull()
  })
})
