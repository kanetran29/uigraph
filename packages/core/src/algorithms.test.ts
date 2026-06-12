import { describe, it, expect } from 'vitest'
import { reachableFrom, planPath } from './algorithms'
import { edge, graph, node } from './fixtures'

const g = graph(
  [node('a'), node('b'), node('c'), node('d'), node('isolated')],
  [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'a', 'd', { modality: 'may' }), edge('e4', 'd', 'c', { modality: 'may' })],
)

describe('reachableFrom', () => {
  it('collects all reachable nodes', () => {
    expect([...reachableFrom(g, 'a')].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('excludes unreachable nodes', () => {
    expect(reachableFrom(g, 'a').has('isolated')).toBe(false)
  })
})

describe('planPath', () => {
  it('finds the shortest path by edge count', () => {
    const steps = planPath(g, 'a', 'c')
    expect(steps?.map((s) => s.edge.id)).toEqual(['e1', 'e2'])
  })

  it('returns an empty path for from === to', () => {
    expect(planPath(g, 'a', 'a')).toEqual([])
  })

  it('returns null when unreachable', () => {
    expect(planPath(g, 'a', 'isolated')).toBeNull()
  })

  it('respects allowed modalities', () => {
    const mustOnly = planPath(g, 'a', 'd', { allow: ['must'] })
    expect(mustOnly).toBeNull()
  })
})
