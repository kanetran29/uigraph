import { describe, it, expect } from 'vitest'
import { diffGraphs } from './diff'
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
