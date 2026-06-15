import { describe, it, expect } from 'vitest'
import type { GraphNode, UiGraph } from '@uigraph/core'
import { applySaved, layoutStorageKey, parsePositions, serializePositions } from './layoutStore'

function node(id: string, kind: GraphNode['kind'] = 'screen'): GraphNode {
  return { id, route: null, componentPath: null, label: id, kind }
}
function graph(nodes: GraphNode[], meta?: Partial<UiGraph['meta']>): UiGraph {
  return { version: 0, meta: { adapter: 'react', adapterVersion: '1', rulesetVersion: '1', ...meta }, nodes, edges: [] }
}

describe('layoutStorageKey', () => {
  it('is identical for the same top-level id set regardless of order', () => {
    const a = graph([node('n_a'), node('n_b'), node('c1', 'control')])
    const b = graph([node('n_b'), node('n_a')])
    expect(layoutStorageKey(a)).toBe(layoutStorageKey(b))
  })
  it('changes when a top-level node is added or removed', () => {
    const a = graph([node('n_a'), node('n_b')])
    const c = graph([node('n_a'), node('n_b'), node('n_c')])
    expect(layoutStorageKey(a)).not.toBe(layoutStorageKey(c))
  })
  it('ignores control nodes (their positions are parent-relative)', () => {
    const a = graph([node('n_a')])
    const b = graph([node('n_a'), node('c1', 'control'), node('c2', 'control')])
    expect(layoutStorageKey(a)).toBe(layoutStorageKey(b))
  })
  it('uses a stable nocommit segment when meta.commit is absent', () => {
    expect(layoutStorageKey(graph([node('n_a')]))).toContain('.nocommit.')
    expect(layoutStorageKey(graph([node('n_a')], { commit: 'abc' }))).toContain('.abc.')
  })
})

describe('serialize/parsePositions', () => {
  it('round-trips a positions map', () => {
    const p = { n_a: { x: 1, y: 2 }, n_b: { x: 3, y: 4 } }
    expect(parsePositions(serializePositions(p))).toEqual(p)
  })
  it('returns null for absent / garbage / wrong version', () => {
    expect(parsePositions(null)).toBeNull()
    expect(parsePositions('not json')).toBeNull()
    expect(parsePositions(JSON.stringify({ v: 99, positions: {} }))).toBeNull()
  })
})

describe('applySaved', () => {
  const laid = [
    { id: 'n_a', position: { x: 0, y: 0 } },
    { id: 'n_b', position: { x: 0, y: 0 } },
    { id: 'c1', position: { x: 5, y: 5 }, parentId: 'n_a' },
  ]
  it('overlays saved positions onto matching top-level nodes', () => {
    const out = applySaved(laid, { n_a: { x: 9, y: 9 } })
    expect(out.find((n) => n.id === 'n_a')?.position).toEqual({ x: 9, y: 9 })
    expect(out.find((n) => n.id === 'n_b')?.position).toEqual({ x: 0, y: 0 })
  })
  it('never overwrites a node with a parent, even if present in the save', () => {
    const out = applySaved(laid, { c1: { x: 99, y: 99 } })
    expect(out.find((n) => n.id === 'c1')?.position).toEqual({ x: 5, y: 5 })
  })
  it('returns nodes unchanged for a null save', () => {
    expect(applySaved(laid, null)).toBe(laid)
  })
})
