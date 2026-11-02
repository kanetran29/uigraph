// edgesFrom joins edges that collide on one screen: the stronger modality wins and every
// witness survives, whatever the order of the edge list.
import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode, UiGraph } from './ir'
import { edgesFrom, expandAnchoredEdges } from './scope'

const screen = (id: string): GraphNode => ({ id, kind: 'screen', label: id, source: 'static', confidence: 1 } as unknown as GraphNode)
const scope = (id: string, members: string[]): GraphNode =>
  ({ id, kind: 'scope', label: id, source: 'static', confidence: 1, scope: { kind: 'set', members } } as unknown as GraphNode)
const edge = (id: string, from: string, modality: GraphEdge['modality'], line: number): GraphEdge => ({
  id, from, to: 'b', event: 'click', guard: null, effect: 'navigate', modality, source: 'static', confidence: 1,
  witness: { source: 'static', file: 'x.ts', loc: { line, col: 1 }, modality },
})
const graph = (edges: GraphEdge[]): UiGraph =>
  ({ nodes: [screen('a'), screen('b'), scope('s', ['a'])], edges } as unknown as UiGraph)

describe('edgesFrom', () => {
  const own = edge('e1', 'a', 'may', 1)
  const anchored = edge('e2', 's', 'must', 2)

  it('keeps the stronger modality and both witnesses, in either order', () => {
    for (const edges of [[own, anchored], [anchored, own]]) {
      const out = edgesFrom(graph(edges), 'a')
      expect(out).toHaveLength(1)
      expect(out[0]!.modality).toBe('must')
      expect(out[0]!.from).toBe('a')
      expect(out[0]!.witness?.loc?.line).toBe(2)
      expect(out[0]!.mergedWitnesses?.map((w) => w.loc?.line)).toEqual([1])
    }
  })

  it('does not list one witness twice', () => {
    const dup = { ...anchored, id: 'e3', witness: { ...own.witness! } , modality: 'may' as const }
    const out = edgesFrom(graph([own, dup]), 'a')
    expect(out[0]!.witness?.loc?.line).toBe(1)
    expect(out[0]!.mergedWitnesses).toBeUndefined()
  })

  it('expansion carries the joined edge', () => {
    const g = expandAnchoredEdges(graph([own, anchored]))
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.modality}`)).toEqual(['a>b:must'])
  })
})
