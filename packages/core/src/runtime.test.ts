import { describe, it, expect } from 'vitest'
import { applyObservations, confirmedEdges, runtimeEdgeId, type Observation } from './runtime'
import { edge, graph, node } from './fixtures'

function obs(over: Partial<Observation> = {}): Observation {
  return { id: 'o1', from: 'a', to: 'b', event: 'click', outcome: 'confirmed', ...over }
}

describe('confirmedEdges', () => {
  it('turns a confirmed observation into a witnessed runtime must-edge', () => {
    const [e] = confirmedEdges([obs()])
    expect(e?.source).toBe('runtime')
    expect(e?.modality).toBe('must')
    expect(e?.witness).toEqual({ source: 'runtime', observationId: 'o1' })
  })

  it('ignores refuted observations', () => {
    expect(confirmedEdges([obs({ outcome: 'refuted' })])).toEqual([])
  })

  it('dedupes repeated confirmations of the same transition', () => {
    expect(confirmedEdges([obs({ id: 'o1' }), obs({ id: 'o2' })])).toHaveLength(1)
  })

  it('does NOT merge two distinct events on the same from→to pair', () => {
    const edges = confirmedEdges([obs({ id: 'o1', event: 'click' }), obs({ id: 'o2', event: 'keydown:Enter' })])
    expect(edges).toHaveLength(2)
    expect(new Set(edges.map((e) => e.id)).size).toBe(2)
  })
})

describe('runtimeEdgeId', () => {
  it('is collision-free across distinct events (no truncated-hash collision)', () => {
    expect(runtimeEdgeId('a', 'b', 'click')).not.toBe(runtimeEdgeId('a', 'b', 'submit'))
  })

  it('distinguishes events that sanitize to the same readable token', () => {
    expect(runtimeEdgeId('a', 'b', 'a b')).not.toBe(runtimeEdgeId('a', 'b', 'a_b'))
  })

  it('is stable for the same (from,to,event)', () => {
    expect(runtimeEdgeId('a', 'b', 'click')).toBe(runtimeEdgeId('a', 'b', 'click'))
  })
})

describe('applyObservations', () => {
  it('folds a confirmed edge into the graph without mutating the input', () => {
    const g = graph([node('a'), node('b')], [])
    const merged = applyObservations(g, [obs()])
    expect(merged.edges).toHaveLength(1)
    expect(merged.edges[0]?.source).toBe('runtime')
    expect(g.edges).toHaveLength(0)
  })

  it('skips observations referencing unknown nodes', () => {
    const g = graph([node('a')], [])
    expect(applyObservations(g, [obs({ to: 'ghost' })]).edges).toHaveLength(0)
  })

  it('upgrades an existing edge in place instead of adding a duplicate twin', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { source: 'static', modality: 'may', guard: 'isAuth' })])
    const merged = applyObservations(g, [obs({ from: 'a', to: 'b' })])
    expect(merged.edges).toHaveLength(1)
    const e = merged.edges[0]
    expect(e?.id).toBe('e1')
    expect(e?.source).toBe('runtime')
    expect(e?.modality).toBe('must')
    expect(e?.guard).toBe('isAuth')
    expect(e?.witness?.source).toBe('runtime')
  })
})
