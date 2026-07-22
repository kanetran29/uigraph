import { describe, it, expect } from 'vitest'
import { renderStateChart, renderStateChartMermaid } from './uml'
import { edge, graph, node } from './fixtures'
import type { GraphNode } from './ir'

/** A control node parented to a screen/modal, with a usable selector. */
function control(id: string, parent: string, label: string): GraphNode {
  return {
    id,
    route: null,
    componentPath: null,
    label,
    kind: 'control',
    parent,
    control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: `button|${label}` } },
  }
}

describe('renderStateChart', () => {
  it('renders a modal as a NESTED composite state inside the screen that opens it', () => {
    const g = graph(
      [node('n_home', { route: '/', kind: 'screen', label: 'Home' }), node('m_login', { route: null, kind: 'modal', parent: 'n_home', label: 'Login' })],
      [],
    )
    const out = renderStateChart(g)
    expect(out).toContain('state "Home" as n_home <<screen>> {')
    // the modal declaration sits between the screen's opening brace and its close
    expect(out).toMatch(/state "Home" as n_home <<screen>> \{[\s\S]*state "Login" as m_login <<modal>>[\s\S]*\}/)
  })

  it("collapses a control's out-edge into a transition on its parent screen carrying the control label", () => {
    const g = graph(
      [node('n_home', { route: '/', kind: 'screen', label: 'Home' }), node('n_cart', { route: '/cart', kind: 'screen', label: 'Cart' }), control('c_buy', 'n_home', 'Buy Now')],
      [edge('e1', 'c_buy', 'n_cart', { event: 'click' })],
    )
    const out = renderStateChart(g)
    // default fixture edge is a static must witness -> proven -> darkgreen
    expect(out).toContain('n_home -[#darkgreen]-> n_cart : click "Buy Now"')
  })

  it('draws a refuted edge red/dashed with a REFUTED note on the link', () => {
    const g = graph(
      [node('n_home', { route: '/', kind: 'screen', label: 'Home' }), node('n_cart', { route: '/cart', kind: 'screen', label: 'Cart' })],
      [edge('e1', 'n_home', 'n_cart', { modality: 'may', refuted: true })],
    )
    const out = renderStateChart(g)
    expect(out).toContain('n_home -[#red,dashed]-> n_cart')
    expect(out).toMatch(/note on link[\s\S]*REFUTED[\s\S]*end note/)
  })

  it('draws a runtime-witnessed edge as a green arrow', () => {
    const g = graph(
      [node('n_home', { route: '/', kind: 'screen', label: 'Home' }), node('n_cart', { route: '/cart', kind: 'screen', label: 'Cart' })],
      [edge('e1', 'n_home', 'n_cart', { source: 'runtime' })],
    )
    const out = renderStateChart(g)
    expect(out).toContain('n_home -[#green]-> n_cart')
  })

  it('escapes quotes/newlines in guards and stays a balanced single-state-per-screen document', () => {
    const g = graph(
      [node('n_a', { route: '/', kind: 'screen', label: 'A' }), node('n_b', { route: '/b', kind: 'screen', label: 'B' })],
      [edge('e1', 'n_a', 'n_b', { guard: 'response.ok && name === "x"\nsecond' })],
    )
    const out = renderStateChart(g)
    expect((out.match(/@startuml/g) ?? []).length).toBe(1)
    expect((out.match(/@enduml/g) ?? []).length).toBe(1)
    expect((out.match(/<<screen>>/g) ?? []).length).toBe(2)
    // inner double-quotes neutralized, newline collapsed to a space -> one unbroken guard bracket
    expect(out).toContain("[response.ok && name === 'x' second]")
    expect(out).not.toContain('"x"')
  })

  it('in screen scope emits ONLY the requested screen (its modals nested), omitting other screens', () => {
    const g = graph(
      [
        node('n_a', { route: '/', kind: 'screen', label: 'A' }),
        node('m_a', { route: null, kind: 'modal', parent: 'n_a', label: 'A Modal' }),
        node('n_b', { route: '/b', kind: 'screen', label: 'B' }),
        control('c_b', 'n_b', 'B Button'),
      ],
      [edge('e1', 'c_b', 'n_a', { event: 'click' })],
    )
    const out = renderStateChart(g, { scope: 'screen', screenId: 'n_a' })
    expect(out).toContain('as n_a')
    expect(out).toMatch(/as n_a <<screen>> \{[\s\S]*as m_a <<modal>>[\s\S]*\}/)
    expect(out).not.toContain('as n_b')
  })
})

describe('renderStateChartMermaid', () => {
  it('renders a modal as a NESTED mermaid state inside the screen that opens it', () => {
    const g = graph(
      [node('n_home', { route: '/', kind: 'screen', label: 'Home' }), node('m_login', { route: null, kind: 'modal', parent: 'n_home', label: 'Login' })],
      [],
    )
    const out = renderStateChartMermaid(g)
    expect(out).toContain('stateDiagram-v2')
    expect(out).toMatch(/state "Home" as n_home \{[\s\S]*state "Login" as m_login[\s\S]*\}/)
  })

  it('classes a proven state verified and a refuted-incident state refuted', () => {
    const g = graph(
      [node('n_home', { route: '/', kind: 'screen', label: 'Home' }), node('n_cart', { route: '/cart', kind: 'screen', label: 'Cart' }), node('n_bad', { route: '/bad', kind: 'screen', label: 'Bad' })],
      [edge('e1', 'n_home', 'n_cart', { modality: 'must' }), edge('e2', 'n_home', 'n_bad', { modality: 'may', refuted: true })],
    )
    const out = renderStateChartMermaid(g)
    expect(out).toContain('class n_cart verified')
    expect(out).toContain('class n_bad refuted')
    // n_home has BOTH a verified (e1) and a refuted (e2) incident edge — refuted must win, never be masked green.
    expect(out).toContain('class n_home refuted')
    expect(out).not.toContain('class n_home verified')
    expect(out).toContain('classDef verified')
    expect(out).toContain('classDef refuted')
    expect(out).toContain('classDef gated')
  })

  it('prefixes each transition label with its trust glyph', () => {
    const g = graph(
      [node('n_home', { route: '/', kind: 'screen', label: 'Home' }), node('n_cart', { route: '/cart', kind: 'screen', label: 'Cart' }), node('n_bad', { route: '/bad', kind: 'screen', label: 'Bad' })],
      [edge('e1', 'n_home', 'n_cart', { source: 'runtime', event: 'click' }), edge('e2', 'n_home', 'n_bad', { modality: 'may', refuted: true, event: 'tap' })],
    )
    const out = renderStateChartMermaid(g)
    expect(out).toMatch(/n_home --> n_cart : ✓ click/)
    expect(out).toMatch(/n_home --> n_bad : ✗ tap/)
  })

  it('is a stateDiagram-v2 doc with balanced braces and no dangling class assignment', () => {
    const g = graph(
      [
        node('n_a', { route: '/', kind: 'screen', label: 'A' }),
        node('m_a', { route: null, kind: 'modal', parent: 'n_a', label: 'A "quoted" {brace}' }),
        node('n_b', { route: '/b', kind: 'screen', label: 'B' }),
      ],
      [edge('e1', 'n_a', 'n_b', { guard: 'a < b && c > d;e', modality: 'must' })],
    )
    const out = renderStateChartMermaid(g)
    expect(out).toContain('stateDiagram-v2')
    expect((out.match(/\{/g) ?? []).length).toBe((out.match(/\}/g) ?? []).length)
    const defined = new Set([...out.matchAll(/classDef (\w+)/g)].map((m) => m[1]))
    for (const m of out.matchAll(/^\s*class \S+ (\w+)$/gm)) expect(defined.has(m[1])).toBe(true)
  })

  it('drops transitions into dynamic unknown sink nodes', () => {
    const g = graph(
      [node('n_home', { route: '/', kind: 'screen', label: 'Home' }), node('u_dyn', { route: null, kind: 'unknown', label: '?' })],
      [edge('e1', 'n_home', 'u_dyn', { modality: 'may' })],
    )
    const out = renderStateChartMermaid(g)
    expect(out).not.toContain('u_dyn')
  })
})
