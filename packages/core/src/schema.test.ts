import { describe, it, expect } from 'vitest'
import { validateGraphShape, assertGraphShape } from './schema'
import { edge, graph, node } from './fixtures'

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
})
