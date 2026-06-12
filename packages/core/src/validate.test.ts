import { describe, it, expect } from 'vitest'
import { validateGraph, validateOverlay } from './validate'
import { edge, graph, node } from './fixtures'
import type { Overlay } from './ir'

describe('validateGraph', () => {
  it('accepts a valid witnessed static graph', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b')])
    expect(validateGraph(g)).toEqual([])
  })

  it('flags dangling edge targets', () => {
    const g = graph([node('a')], [edge('e1', 'a', 'missing')])
    expect(validateGraph(g).map((e) => e.code)).toContain('DANGLING_TO')
  })

  it('flags duplicate ids', () => {
    const g = graph([node('a'), node('a')], [])
    expect(validateGraph(g).map((e) => e.code)).toContain('DUP_NODE_ID')
  })

  it('enforces the golden invariant: static edges need a witness', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { witness: undefined })])
    expect(validateGraph(g).map((e) => e.code)).toContain('UNWITNESSED')
  })

  it('rejects manual edges in the base graph', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { source: 'manual', modality: 'may', witness: undefined })])
    expect(validateGraph(g).map((e) => e.code)).toContain('MANUAL_IN_BASE')
  })

  it('rejects must-edges that are not static or runtime', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { source: 'manual', modality: 'must', witness: undefined })])
    expect(validateGraph(g).map((e) => e.code)).toContain('MUST_PROVENANCE')
  })

  it('rejects out-of-range confidence', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { confidence: 1.5 })])
    expect(validateGraph(g).map((e) => e.code)).toContain('CONFIDENCE_RANGE')
  })
})

describe('validateOverlay', () => {
  it('accepts a manual overlay', () => {
    const ov: Overlay = {
      version: 0,
      base: 'abc',
      addedNodes: [],
      addedEdges: [edge('m1', 'a', 'b', { source: 'manual', modality: 'may', witness: undefined })],
      editedEdges: [],
      removedRefs: [],
    }
    expect(validateOverlay(ov)).toEqual([])
  })

  it('rejects non-manual overlay edges', () => {
    const ov: Overlay = {
      version: 0,
      base: 'abc',
      addedNodes: [],
      addedEdges: [edge('m1', 'a', 'b', { source: 'static' })],
      editedEdges: [],
      removedRefs: [],
    }
    expect(validateOverlay(ov).map((e) => e.code)).toContain('OVERLAY_NOT_MANUAL')
  })
})
