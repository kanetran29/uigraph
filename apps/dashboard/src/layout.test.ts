import { describe, it, expect } from 'vitest'
import type { GraphEdge, GraphNode, Proposal, UiGraph } from '@ui-graph/core'
import { componentGroups, componentLabel, layoutGraph, proposedScreenEdges, structuralKey } from './layout'

function screen(id: string, componentPath: string | null): GraphNode {
  return { id, route: `/${id}`, componentPath, label: id, kind: 'screen' }
}
function ctrl(id: string, parent: string, componentPath: string | null): GraphNode {
  return { id, route: null, componentPath, label: id, kind: 'control', parent, control: { element: 'button', controlType: 'button' } }
}
function graph(nodes: GraphNode[], edges: GraphEdge[] = []): UiGraph {
  return { version: 0, meta: { adapter: 't', adapterVersion: '0', rulesetVersion: 't' }, nodes, edges }
}

describe('componentLabel', () => {
  it('derives a readable component name from a path', () => {
    expect(componentLabel('pages/Checkout.tsx')).toBe('Checkout')
    expect(componentLabel('components/Header/index.tsx')).toBe('Header')
    expect(componentLabel('src/components/CartSummary.tsx')).toBe('CartSummary')
    expect(componentLabel(null)).toBe('(page)')
  })
})

describe('componentGroups', () => {
  const g = graph([
    screen('s', 'pages/Checkout.tsx'),
    ctrl('c_root', 's', 'pages/Checkout.tsx'),
    ctrl('c_h1', 's', 'components/Header.tsx'),
    ctrl('c_h2', 's', 'components/Header.tsx'),
    ctrl('c_cart', 's', 'components/Cart.tsx'),
    ctrl('c_null', 's', null),
  ])

  it('puts page-root + null-path controls in a flat (non-band) group, child components in bands', () => {
    const groups = componentGroups(g, 's')
    const root = groups.find((x) => !x.isBand)
    expect(root?.controlIds.sort()).toEqual(['c_null', 'c_root'])
    expect(root?.label).toBe('(page)')
    const header = groups.find((x) => x.label === 'Header')
    expect(header?.isBand).toBe(true)
    expect(header?.controlIds).toEqual(['c_h1', 'c_h2'])
    const cart = groups.find((x) => x.label === 'Cart')
    expect(cart?.controlIds).toEqual(['c_cart'])
  })

  it('keeps controls from different components separate (no flattening)', () => {
    const groups = componentGroups(g, 's')
    expect(groups.find((x) => x.label === 'Header')?.controlIds).not.toContain('c_cart')
  })

  it('produces NO band labeled like the page for page-root controls', () => {
    const groups = componentGroups(g, 's')
    expect(groups.filter((x) => x.isBand).map((x) => x.label)).not.toContain('Checkout')
  })
})

describe('proposedScreenEdges', () => {
  const prop = (over: Partial<Proposal>): Proposal => ({
    id: over.id ?? 'p', kind: 'edge', category: 'disclosure', screen: 'n_root', title: 't',
    rationale: 'r', evidenced: true, confidence: 0.8, source: 'proposal', status: 'proposed', ...over,
  })
  const g = graph([
    screen('n_root', 'App.tsx'),
    { id: 'm_x', route: null, componentPath: null, label: 'Modal X', kind: 'modal' },
    ctrl('c1', 'n_root', 'App.tsx'),
  ])

  it('emits a deduped screen->target edge for a proposed proposal whose target is a real non-control node', () => {
    const edges = proposedScreenEdges(g, [prop({ id: 'a', to: 'm_x' }), prop({ id: 'b', to: 'm_x' })])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'n_root', to: 'm_x', count: 2, id: 'pe_n_root->m_x' })
  })

  it('skips proposals with no target, an external target, a control target, or a non-proposed status', () => {
    const edges = proposedScreenEdges(g, [
      prop({ id: 'noTo' }),
      prop({ id: 'ext', to: 'stripe-external' }),
      prop({ id: 'ctrl', to: 'c1' }),
      prop({ id: 'done', to: 'm_x', status: 'confirmed' }),
    ])
    expect(edges).toEqual([])
  })
})

describe('structuralKey — layout memo cache key', () => {
  const edge = (id: string, from: string, to: string): GraphEdge => ({
    id, from, to, event: 'click', guard: null, effect: null, modality: 'must', source: 'static', confidence: 1,
  })
  const g = graph([screen('a', null), screen('b', null), ctrl('c_b', 'b', null)], [edge('e1', 'a', 'b')])

  it('is stable across selections that leave the expanded set unchanged (fresh empty Set each time)', () => {
    // An edge selection and a childless-node selection both produce a brand-new empty
    // Set; the key must be identical so layoutGraph is not recomputed per click.
    expect(structuralKey(g, new Set())).toBe(structuralKey(g, new Set()))
  })

  it('changes when a screen is expanded vs collapsed', () => {
    expect(structuralKey(g, new Set(['b']))).not.toBe(structuralKey(g, new Set()))
  })

  it('changes on a relayout-worthy structural edit (a new edge)', () => {
    const g2 = graph([screen('a', null), screen('b', null), ctrl('c_b', 'b', null)], [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')])
    expect(structuralKey(g2, new Set())).not.toBe(structuralKey(g, new Set()))
  })

  it('is order-independent over the expanded set', () => {
    const ga = graph([screen('a', null), ctrl('c_a', 'a', null), screen('b', null), ctrl('c_b', 'b', null)])
    expect(structuralKey(ga, new Set(['a', 'b']))).toBe(structuralKey(ga, new Set(['b', 'a'])))
  })
})

describe('layoutGraph — component bands', () => {
  const g = graph([
    screen('s', 'pages/Checkout.tsx'),
    ctrl('c_root', 's', 'pages/Checkout.tsx'),
    ctrl('c_h1', 's', 'components/Header.tsx'),
    ctrl('c_cart', 's', 'components/Cart.tsx'),
  ])

  it('emits a band per child component for an expanded screen, none for collapsed', () => {
    const expanded = layoutGraph(g, new Set(['s']))
    expect(expanded.bands.map((b) => b.label).sort()).toEqual(['Cart', 'Header'])
    for (const b of expanded.bands) expect(b.parent).toBe('s')
    expect(layoutGraph(g, new Set()).bands).toEqual([])
  })

  it('positions every control (ids unchanged) inside the expanded screen', () => {
    const { positions } = layoutGraph(g, new Set(['s']))
    for (const id of ['c_root', 'c_h1', 'c_cart']) expect(positions.has(id)).toBe(true)
  })

  it('does not invent graph nodes — bands use the reserved cg_ id prefix', () => {
    const { bands } = layoutGraph(g, new Set(['s']))
    expect(bands.every((b) => b.id.startsWith('cg_'))).toBe(true)
  })
})
