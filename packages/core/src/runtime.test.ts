import { describe, it, expect } from 'vitest'
import { applyObservations, confirmedEdges, runtimeEdgeId, validateEvidence, type Observation } from './runtime'
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
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { source: 'static', modality: 'may', guard: null, event: 'click' })])
    const merged = applyObservations(g, [obs({ from: 'a', to: 'b', event: 'click' })])
    expect(merged.edges).toHaveLength(1)
    const e = merged.edges[0]
    expect(e?.id).toBe('e1')
    expect(e?.source).toBe('runtime')
    expect(e?.modality).toBe('must')
    expect(e?.witness?.source).toBe('runtime')
  })

  it('matches by the full (from,to,event) triple — a different event never steals the witness', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { source: 'static', modality: 'may', event: 'click confirm' })])
    const merged = applyObservations(g, [obs({ event: 'submit form' })])
    expect(merged.edges).toHaveLength(2)
    const original = merged.edges.find((e) => e.id === 'e1')
    expect(original?.source).toBe('static')
    expect(original?.witness?.observationId).toBeUndefined()
    const minted = merged.edges.find((e) => e.id !== 'e1')
    expect(minted?.event).toBe('submit form')
    expect(minted?.source).toBe('runtime')
  })

  it('keeps the guard AND modality when upgrading a guarded edge (existence proof is not unconditionality)', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { source: 'static', modality: 'may', guard: 'isAuth', event: 'click' })])
    const merged = applyObservations(g, [obs({ event: 'click' })])
    expect(merged.edges).toHaveLength(1)
    const e = merged.edges[0]
    expect(e?.modality).toBe('may')
    expect(e?.guard).toBe('isAuth')
    expect(e?.source).toBe('runtime')
    expect(e?.confidence).toBe(1)
    expect(e?.witness?.observationId).toBe('o1')
  })

  it('folds every confirmed observation on a pair — no first-per-pair shortcut', () => {
    const g = graph([node('a'), node('b')], [])
    const merged = applyObservations(g, [obs({ id: 'o1', event: 'click' }), obs({ id: 'o2', event: 'keydown:Enter' })])
    expect(merged.edges).toHaveLength(2)
  })

  it('flags witnessStale when the observation was recorded against a different base', () => {
    const g = graph([node('a'), node('b')], [])
    const merged = applyObservations(g, [obs({ base: 'oldhash' })], { baseHash: 'newhash' })
    expect(merged.edges[0]?.witnessStale).toBe(true)
  })

  it('does NOT flag witnessStale when the bases match or the observation predates base stamping', () => {
    const g = graph([node('a'), node('b')], [])
    const matching = applyObservations(g, [obs({ base: 'h1' })], { baseHash: 'h1' })
    expect(matching.edges[0]?.witnessStale).toBeUndefined()
    const unstamped = applyObservations(g, [obs()], { baseHash: 'h1' })
    expect(unstamped.edges[0]?.witnessStale).toBeUndefined()
  })
})

describe('validateEvidence', () => {
  it('accepts a real url change and rejects a non-change', () => {
    expect(validateEvidence({ kind: 'url-change', startUrl: '/a', landedUrl: '/b' })).toBeNull()
    expect(validateEvidence({ kind: 'url-change', startUrl: '/a', landedUrl: '/a' })).toMatch(/actual change/)
    expect(validateEvidence({ kind: 'url-change', startUrl: '', landedUrl: '/b' })).toMatch(/non-empty/)
  })

  it('requires a non-empty url-assert url and screenshot path', () => {
    expect(validateEvidence({ kind: 'url-assert', url: '/checkout' })).toBeNull()
    expect(validateEvidence({ kind: 'url-assert', url: '' })).toMatch(/non-empty/)
    expect(validateEvidence({ kind: 'screenshot', path: '' })).toMatch(/non-empty/)
    expect(validateEvidence({ kind: 'screenshot', path: '/tmp/s.png' })).toBeNull()
  })

  it('accepts dialog evidence as-is', () => {
    expect(validateEvidence({ kind: 'dialog' })).toBeNull()
  })
})
