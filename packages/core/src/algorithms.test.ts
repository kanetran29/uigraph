import { describe, it, expect } from 'vitest'
import { reachableFrom, planPath, planForTarget } from './algorithms'
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

  it('routes through a control into the modal it opens (containment)', () => {
    // a -> b (screen), b owns a control btn, btn opens modal m via open:modal.
    const gm = graph(
      [node('a'), node('b'), { id: 'btn', route: null, componentPath: null, label: 'Review', kind: 'control', parent: 'b' }, { id: 'm', route: null, componentPath: null, label: 'Dialog', kind: 'modal' }],
      [edge('e1', 'a', 'b'), edge('e2', 'btn', 'm', { event: 'click', effect: 'open:modal' })],
    )
    expect(reachableFrom(gm, 'a').has('m')).toBe(true)
    const steps = planPath(gm, 'a', 'm')
    expect(steps?.map((s) => s.to.id)).toEqual(['b', 'btn', 'm'])
    expect(steps?.[1]?.edge.effect).toBe('contains')
  })
})

describe('planForTarget', () => {
  // screen s ('/') owns opener c_open -> modal m; inner control c_in (parent m) -> screen s2 ('/x').
  const modalGraph = graph(
    [
      node('s', { route: '/' }),
      node('c_open', { route: null, kind: 'control', parent: 's' }),
      node('m', { route: null, kind: 'modal' }),
      node('c_in', { route: null, kind: 'control', parent: 'm' }),
      node('s2', { route: '/x' }),
    ],
    [edge('e_open', 'c_open', 'm', { event: 'click', effect: 'open:modal' }), edge('e_in', 'c_in', 's2', { event: 'click' })],
  )

  it('prefixes a modal-parented control with the path that opens the modal', () => {
    const steps = planForTarget(modalGraph, 'c_in', 's2')
    // contains_m__c_in is the synthetic availability leg; buildSpecPlan renders it as a no-op
    expect(steps?.map((s) => s.edge.id)).toEqual(['e_open', 'contains_m__c_in', 'e_in'])
  })

  it('returns the plain planPath result for an anchored control', () => {
    const ga = graph(
      [node('s', { route: '/' }), node('c', { route: null, kind: 'control', parent: 's' }), node('s2', { route: '/x' })],
      [edge('e1', 'c', 's2', { event: 'click' })],
    )
    expect(planForTarget(ga, 'c', 's2')).toEqual(planPath(ga, 'c', 's2'))
  })

  it('returns null when no anchored node reaches the modal control', () => {
    const gu = graph(
      [node('m', { route: null, kind: 'modal' }), node('c_in', { route: null, kind: 'control', parent: 'm' }), node('s2', { route: '/x' })],
      [edge('e_in', 'c_in', 's2', { event: 'click' })],
    )
    expect(planForTarget(gu, 'c_in', 's2')).toBeNull()
  })

  it('keeps the modal-opening click edge when explicit contains edges exist', () => {
    const gc = graph(
      [...modalGraph.nodes],
      [
        ...modalGraph.edges,
        edge('x1', 's', 'c_open', { event: '(available)', effect: 'contains' }),
        edge('x2', 'm', 'c_in', { event: '(available)', effect: 'contains' }),
      ],
    )
    const ids = planForTarget(gc, 'c_in', 's2')?.map((s) => s.edge.id) ?? []
    expect(ids).toContain('e_open')
    expect(ids.indexOf('e_open')).toBeLessThan(ids.indexOf('e_in'))
  })
})
