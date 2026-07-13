import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { validateGraph } from '@ui-graph/core'
import { extractNextGraph } from './index'

const layoutApp = fileURLToPath(new URL('../test-fixtures/layout-app', import.meta.url))
const groupApp = fileURLToPath(new URL('../test-fixtures/group-app', import.meta.url))

describe('next layout + wrapper navigation', () => {
  const { graph, soundiness } = extractNextGraph(layoutApp)
  const hasEdge = (from: string, to: string, modality: string): boolean =>
    graph.edges.some((e) => e.from === from && e.to === to && e.modality === modality)

  it('produces a valid graph', () => {
    expect(validateGraph(graph)).toEqual([])
  })

  it('discovers both routes', () => {
    const screens = new Set(graph.nodes.filter((n) => n.kind === 'screen').map((n) => n.id))
    expect(screens).toEqual(new Set(['n_root', 'n_dashboard']))
  })

  it('attributes a next/link <Link href> buried in a layout child (Header -> MainNav) to every wrapped route', () => {
    expect(hasEdge('n_root', 'n_root', 'may')).toBe(true)
    expect(hasEdge('n_dashboard', 'n_root', 'may')).toBe(true)
  })

  it('follows a custom Link wrapper (CustomLink href) to its internal target', () => {
    expect(hasEdge('n_root', 'n_dashboard', 'may')).toBe(true)
    expect(hasEdge('n_dashboard', 'n_dashboard', 'may')).toBe(true)
  })

  it('never invents an edge for an external <a href>', () => {
    const dynamic = graph.nodes.filter((n) => n.kind === 'unknown')
    expect(dynamic.length).toBe(0)
    expect(graph.edges.every((e) => e.to === 'n_root' || e.to === 'n_dashboard')).toBe(true)
  })

  it('stamps the layout-link witness rule', () => {
    const e = graph.edges.find((x) => x.from === 'n_dashboard' && x.to === 'n_root')
    expect(e?.witness?.ruleId).toBe('next.layout-link-href')
  })

  it('records a layout-nav soundiness note', () => {
    expect(soundiness.some((s) => s.kind === 'layout-nav')).toBe(true)
  })
})

describe('next route-group layout + custom Button(href) wrapper', () => {
  const { graph } = extractNextGraph(groupApp)
  const hasEdge = (from: string, to: string, modality: string): boolean =>
    graph.edges.some((e) => e.from === from && e.to === to && e.modality === modality)

  it('produces a valid graph', () => {
    expect(validateGraph(graph)).toEqual([])
  })

  it('attributes a (marketing) route-group layout <Button href="/pricing"> to the wrapped route', () => {
    expect(hasEdge('n_pricing', 'n_pricing', 'may')).toBe(true)
  })

  it('emits no edge for the external <Button href> in the same layout', () => {
    expect(graph.edges.every((e) => e.to === 'n_pricing')).toBe(true)
    expect(graph.nodes.some((n) => n.kind === 'unknown')).toBe(false)
  })
})
