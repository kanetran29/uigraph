import { describe, it, expect } from 'vitest'
import { applyControlNames, namelessControls } from './names'
import { graph, node } from './fixtures'
import type { ControlMeta, GraphNode } from './ir'

const meta = (over: Partial<ControlMeta> = {}): ControlMeta => ({
  element: 'button',
  controlType: 'button',
  selector: { strategy: 'structural', value: 'button:nth(2)' },
  ...over,
})

/** A control node; label defaults to the tag, the adapters' fallback for a nameless control. */
const control = (id: string, over: Partial<GraphNode> = {}, m: Partial<ControlMeta> = {}): GraphNode =>
  node(id, { route: null, label: 'button', kind: 'control', parent: 'a', control: meta(m), ...over })

describe('applyControlNames', () => {
  const base = graph([node('a'), control('c1'), control('c2')], [])

  it('sets label and control.name, leaving the selector and id untouched', () => {
    const out = applyControlNames(base, { c1: 'Save draft' })
    const c1 = out.nodes.find((n) => n.id === 'c1')
    expect(c1?.label).toBe('Save draft')
    expect(c1?.control?.name).toBe('Save draft')
    expect(c1?.control?.selector).toEqual({ strategy: 'structural', value: 'button:nth(2)' })
    expect(out.nodes.map((n) => n.id)).toEqual(['a', 'c1', 'c2'])
    expect(out.nodes.find((n) => n.id === 'c2')?.label).toBe('button')
  })

  it('ignores unknown ids and non-control ids', () => {
    const out = applyControlNames(base, { ghost: 'x', a: 'Home' })
    expect(out.nodes).toEqual(base.nodes)
  })

  it('is pure: the input graph is not mutated', () => {
    applyControlNames(base, { c1: 'Save draft' })
    expect(base.nodes.find((n) => n.id === 'c1')?.label).toBe('button')
    expect(base.nodes.find((n) => n.id === 'c1')?.control?.name).toBeUndefined()
  })
})

describe('namelessControls', () => {
  it('lists controls with no control.name (a tag/controlType label is not a name)', () => {
    const g = graph([node('a'), control('c1'), control('c2', { label: 'Save' }, { name: 'Save' }), control('c3', { label: 'element' }, { element: 'div', controlType: 'element' })], [])
    expect(namelessControls(g).map((n) => n.id)).toEqual(['c1', 'c3'])
  })

  it('excludes screens and modals', () => {
    expect(namelessControls(graph([node('a'), node('m', { kind: 'modal' })], []))).toEqual([])
  })

  it('a control named via applyControlNames is no longer nameless', () => {
    const g = applyControlNames(graph([node('a'), control('c1')], []), { c1: 'Save draft' })
    expect(namelessControls(g)).toEqual([])
  })
})
