// Tests for buildFrontier (spec §3/§7): the frontier is the set of known-unknowns —
// states whose out-edges include an unknown/dynamic-sink modality OR that have no
// enumerated out-edges at all. Only screen/route/modal states count; control nodes
// (which nest inside screens) are skipped. Pure read-time metric, no mutation.

import { describe, expect, it } from 'vitest'
import { buildFrontier } from './frontier'
import { edge, graph, node } from './fixtures'

describe('buildFrontier', () => {
  it('returns an empty frontier when every state has enumerated non-unknown out-edges', () => {
    const g = graph(
      [node('a'), node('b')],
      [edge('e1', 'a', 'b', { modality: 'must' }), edge('e2', 'b', 'a', { modality: 'may' })],
    )
    const f = buildFrontier(g)
    expect(f.states).toEqual([])
    expect(f.unknownCount).toBe(0)
  })

  it('identifies states with unknown-modality out-edges as frontier members', () => {
    const g = graph(
      [node('a'), node('b'), node('u_a', { kind: 'unknown' })],
      [edge('e1', 'a', 'b', { modality: 'must' }), edge('e2', 'b', 'u_a', { modality: 'unknown' })],
    )
    const f = buildFrontier(g)
    expect(f.states).toEqual(['b'])
    expect(f.unknownCount).toBe(1)
  })

  it('treats an out-edge to an unknown-kind sink node as a dynamic-sink frontier even if modality is not unknown', () => {
    const g = graph(
      [node('a'), node('u_a', { kind: 'unknown' })],
      [edge('e1', 'a', 'u_a', { modality: 'may' })],
    )
    const f = buildFrontier(g)
    expect(f.states).toEqual(['a'])
    expect(f.unknownCount).toBe(1)
  })

  it('identifies states with zero out-edges as frontier members (true dead ends)', () => {
    const g = graph([node('a'), node('b')], [edge('e1', 'a', 'b', { modality: 'must' })])
    const f = buildFrontier(g)
    expect(f.states).toEqual(['b'])
    expect(f.unknownCount).toBe(1)
  })

  it('ignores control nodes; only screens/routes/modals count', () => {
    const g = graph(
      [node('a'), node('c1', { kind: 'control', parent: 'a' }), node('r', { kind: 'route' }), node('m', { kind: 'modal' })],
      [edge('e1', 'a', 'r', { modality: 'must' })],
    )
    const f = buildFrontier(g)
    // a has an enumerated out-edge; r and m are dead ends; control c1 is skipped entirely
    expect(f.states.sort()).toEqual(['m', 'r'])
    expect(f.unknownCount).toBe(2)
  })

  it('ignores unknown-kind sink nodes as frontier states themselves (they are sinks, not states to probe)', () => {
    const g = graph([node('a'), node('u_a', { kind: 'unknown' })], [edge('e1', 'a', 'u_a', { modality: 'unknown' })])
    const f = buildFrontier(g)
    expect(f.states).toEqual(['a'])
  })

  it('counts a state once even when it has multiple unknown out-edges', () => {
    const g = graph(
      [node('a'), node('u1', { kind: 'unknown' }), node('u2', { kind: 'unknown' })],
      [edge('e1', 'a', 'u1', { modality: 'unknown' }), edge('e2', 'a', 'u2', { modality: 'unknown', event: 'x' })],
    )
    const f = buildFrontier(g)
    expect(f.states).toEqual(['a'])
    expect(f.unknownCount).toBe(1)
  })
})
