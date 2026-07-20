import { describe, it, expect } from 'vitest'
import type { GraphEdge, GraphNode, UiGraph } from '@ui-graph/core'
import { toFlowEdges, type EdgeContext } from './GraphCanvas'

/** A screen node fixture, matching layout.test.ts's helper shape. */
function screen(id: string): GraphNode {
  return { id, route: `/${id}`, componentPath: null, label: id, kind: 'screen' }
}
/** A control node fixture, parented to `parent`. */
function ctrl(id: string, parent: string): GraphNode {
  return { id, route: null, componentPath: null, label: id, kind: 'control', parent, control: { element: 'button', controlType: 'button' } }
}
function graph(nodes: GraphNode[], edges: GraphEdge[]): UiGraph {
  return { version: 0, meta: { adapter: 't', adapterVersion: '0', rulesetVersion: 't' }, nodes, edges }
}
/** A default EdgeContext with the screen's controls expanded (so control edges render) and no focus/search/diff state. */
function ctx(expanded: string[] = []): EdgeContext {
  return {
    selection: null,
    pathEdgeIds: new Set(),
    expanded: new Set(expanded),
    hoveredEdgeId: null,
    incidentEdgeIds: new Set(),
    focusEdgeActive: false,
    searchActive: false,
    searchMatchIds: new Set(),
    diffActive: false,
    addedEdgeIds: new Set(),
    changedEdgeIds: new Set(),
    groupedView: false,
    hoverIncidentEdgeIds: new Set(),
    showEffects: true,
  }
}

describe('toFlowEdges: effect-class colouring scope', () => {
  const nodes = [screen('s'), ctrl('c', 's')]

  it('does NOT tint a runtime-witnessed navigate control edge — it keeps the runtime source colour', () => {
    const edge: GraphEdge = { id: 'e', from: 'c', to: 's', event: 'click', guard: null, effect: 'navigate', modality: 'must', source: 'runtime', confidence: 1 }
    const [flowEdge] = toFlowEdges(graph(nodes, [edge]), ctx(['s']))
    expect((flowEdge?.style as { stroke?: string } | undefined)?.stroke).toBe('var(--edge-runtime)')
  })

  it('does NOT tint a runtime-witnessed close:modal control edge either', () => {
    const edge: GraphEdge = { id: 'e', from: 'c', to: 's', event: 'click', guard: null, effect: 'close:modal', modality: 'must', source: 'runtime', confidence: 1 }
    const [flowEdge] = toFlowEdges(graph(nodes, [edge]), ctx(['s']))
    expect((flowEdge?.style as { stroke?: string } | undefined)?.stroke).toBe('var(--edge-runtime)')
  })

  it('DOES tint an effect self-loop (api) control edge with the api effect colour', () => {
    const edge: GraphEdge = { id: 'e', from: 'c', to: 's', event: 'click', guard: null, effect: 'api:POST /orders', modality: 'must', source: 'static', confidence: 1 }
    const [flowEdge] = toFlowEdges(graph(nodes, [edge]), ctx(['s']))
    expect((flowEdge?.style as { stroke?: string } | undefined)?.stroke).toBe('#ea580c')
  })
})
