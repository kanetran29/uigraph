import { describe, it, expect } from 'vitest'
import { buildGrounding } from './grounding'
import { edge, graph, node } from './fixtures'

const sample = () =>
  graph(
    [
      node('s_home', { kind: 'screen', label: 'Home', route: '/' }),
      node('s_products', { kind: 'screen', label: 'Products', route: '/products' }),
      node('cc_home_btn', {
        kind: 'control',
        parent: 's_home',
        label: 'Back to products',
        control: { element: 'button', controlType: 'button', events: ['click'], effects: ['state:setOpen'] },
      }),
    ],
    [
      edge('e1', 'cc_home_btn', 's_products', { event: 'click', effect: 'navigate', modality: 'must', witness: { source: 'static', ruleId: 'rr.use-navigate.interprocedural' } }),
      edge('e2', 's_products', 's_home', { event: 'click:Link', effect: 'navigate', modality: 'must' }),
    ],
  )

describe('buildGrounding', () => {
  it('groups each screen with its controls and outgoing edges', () => {
    const g = buildGrounding(sample())
    const home = g.screens.find((s) => s.screen === 's_home')
    expect(home?.controls.map((c) => c.id)).toEqual(['cc_home_btn'])
    expect(home?.controls[0]?.events).toEqual(['click'])
    expect(home?.controls[0]?.effects).toEqual(['state:setOpen'])
  })

  it('attributes a control-originated edge to its parent screen and resolves the target label', () => {
    const home = buildGrounding(sample()).screens.find((s) => s.screen === 's_home')
    const e = home?.knownEdges.find((x) => x.to === 's_products')
    expect(e?.toLabel).toBe('Products')
    expect(e?.interprocedural).toBe(true)
  })

  it('excludes control nodes from the screen list and binds to the graph hash', () => {
    const g = buildGrounding(sample())
    expect(g.screens.some((s) => s.screen === 'cc_home_btn')).toBe(false)
    expect(g.base).toMatch(/^[0-9a-f]+$/)
    expect(buildGrounding(sample()).base).toBe(g.base)
  })
})
