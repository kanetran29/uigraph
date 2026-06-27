import { describe, it, expect } from 'vitest'
import { validateGraphShape, assertGraphShape, validateObservationShape } from './schema'
import { edge, graph, node } from './fixtures'

const NUL = String.fromCharCode(0)

describe('validateGraphShape', () => {
  it('accepts a well-formed graph', () => {
    expect(validateGraphShape(graph([node('a')], []))).toEqual([])
  })

  it('rejects a wrong version', () => {
    const g = { ...graph([], []), version: 1 }
    expect(validateGraphShape(g)).toContain('graph.version must be 0')
  })

  it('rejects an invalid modality', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { modality: 'sometimes' as never })])
    expect(validateGraphShape(g).some((m) => m.includes('modality'))).toBe(true)
  })

  it('assertGraphShape throws on malformed input', () => {
    expect(() => assertGraphShape({ nope: true })).toThrow()
  })

  it('accepts an optional irreversible flag on an edge', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { irreversible: true })])
    expect(validateGraphShape(g)).toEqual([])
  })

  it('rejects a non-boolean irreversible flag', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { irreversible: 'yes' as never })])
    expect(validateGraphShape(g).some((m) => m.includes('irreversible'))).toBe(true)
  })

  it('rejects control characters in an edge effect string', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { effect: `delete${NUL}here` })])
    expect(validateGraphShape(g).some((m) => m.includes('control characters'))).toBe(true)
  })

  it('rejects an absurdly long guard string', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { guard: 'x'.repeat(5000) })])
    expect(validateGraphShape(g).some((m) => m.includes('exceeds'))).toBe(true)
  })

  it('allows ordinary whitespace (tab/newline) in text fields', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { guard: 'isAuth\t&& hasCart\n' })])
    expect(validateGraphShape(g)).toEqual([])
  })
})

describe('validateObservationShape', () => {
  it('accepts a well-formed observation', () => {
    expect(validateObservationShape({ id: 'o1', from: 'a', to: 'b', event: 'click', outcome: 'confirmed' })).toEqual([])
  })

  it('rejects control characters in the observation event', () => {
    const errs = validateObservationShape({ id: 'o1', from: 'a', to: 'b', event: `cl${NUL}ick`, outcome: 'confirmed' })
    expect(errs.some((m) => m.includes('control characters'))).toBe(true)
  })

  it('rejects a bad outcome', () => {
    const errs = validateObservationShape({ id: 'o1', from: 'a', to: 'b', event: 'click', outcome: 'maybe' })
    expect(errs.some((m) => m.includes('outcome'))).toBe(true)
  })
})
