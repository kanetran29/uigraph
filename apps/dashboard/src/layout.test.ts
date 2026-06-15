import { describe, it, expect } from 'vitest'
import type { GraphEdge, GraphNode, UiGraph } from '@uigraph/core'
import { componentGroups, componentLabel, layoutGraph } from './layout'

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
