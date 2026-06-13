import { describe, it, expect } from 'vitest'
import { mergeOverlay, emptyOverlay, exportOverlaySpec } from './overlay'
import { edge, graph, node } from './fixtures'
import type { Overlay } from './ir'

describe('exportOverlaySpec', () => {
  const planBase = graph([node('a', { label: 'Home' }), node('b', { label: 'Login' })], [])

  it('renders new screens + transitions as a markdown plan, resolving labels', () => {
    const ov: Overlay = {
      ...emptyOverlay('h'),
      addedNodes: [node('n_new', { label: 'Settings', route: '/settings' })],
      addedEdges: [edge('m1', 'a', 'b', { source: 'manual', modality: 'may', event: 'click', witness: undefined })],
    }
    const md = exportOverlaySpec(planBase, ov)
    expect(md).toContain('## New screens')
    expect(md).toContain('- **Settings** (/settings) — screen')
    expect(md).toContain('## New transitions')
    expect(md).toContain('- Home → Login — `click`')
  })

  it('reports an empty plan clearly', () => {
    expect(exportOverlaySpec(planBase, emptyOverlay('h'))).toContain('No planned changes yet')
  })

  it('merges editedNodes by id (replacing the base node) and lists them in the spec', () => {
    const ov: Overlay = { ...emptyOverlay('h'), editedNodes: [node('a', { label: 'Dashboard', route: '/dash' })] }
    const merged = mergeOverlay(planBase, ov)
    const a = merged.nodes.find((n) => n.id === 'a')
    expect(a?.label).toBe('Dashboard')
    expect(a?.route).toBe('/dash')
    expect(exportOverlaySpec(planBase, ov)).toContain('## Edited screens')
  })
})

describe('mergeOverlay', () => {
  const base = graph([node('a'), node('b'), node('c')], [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')])

  it('appends added nodes and edges', () => {
    const ov: Overlay = {
      ...emptyOverlay('h'),
      addedNodes: [node('d')],
      addedEdges: [edge('m1', 'c', 'd', { source: 'manual', modality: 'may', witness: undefined })],
    }
    const merged = mergeOverlay(base, ov)
    expect(merged.nodes.map((n) => n.id)).toContain('d')
    expect(merged.edges.map((e) => e.id)).toContain('m1')
  })

  it('replaces edited edges by id', () => {
    const ov: Overlay = {
      ...emptyOverlay('h'),
      editedEdges: [edge('e1', 'a', 'c', { source: 'manual', modality: 'may', witness: undefined })],
    }
    const merged = mergeOverlay(base, ov)
    expect(merged.edges.find((e) => e.id === 'e1')?.to).toBe('c')
  })

  it('soft-removes referenced ids', () => {
    const ov: Overlay = { ...emptyOverlay('h'), removedRefs: ['e2'] }
    const merged = mergeOverlay(base, ov)
    expect(merged.edges.map((e) => e.id)).not.toContain('e2')
  })

  it('does not mutate the base graph', () => {
    const before = base.edges.length
    mergeOverlay(base, { ...emptyOverlay('h'), removedRefs: ['e1'] })
    expect(base.edges.length).toBe(before)
  })
})
