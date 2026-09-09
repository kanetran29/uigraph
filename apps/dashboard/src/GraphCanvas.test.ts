import { describe, it, expect } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import type { GraphEdge, GraphNode, UiGraph } from '@ui-graph/core'
import { GraphCanvas, toFlowEdges, toFlowNodes, type EdgeContext, type GraphCanvasProps } from './GraphCanvas'
import { layoutGraph } from './layout'

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

describe('screenshots on the canvas', () => {
  const withShot = graph([{ ...screen('s'), screenshot: 'shots/s.jpg' }], [])
  const noShot = graph([screen('s')], [])
  const none = new Set<string>()

  /** Static-render the canvas chrome (toggles panel) for a graph — React Flow renders without a DOM. */
  function canvasHtml(g: UiGraph): string {
    const props: GraphCanvasProps = { graph: g, proposals: { version: 0, base: '', proposals: [] }, selection: null, pathEdgeIds: none, onSelect: () => {} }
    return renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(GraphCanvas, props)))
  }
  /** The static markup of the screen node's label as toFlowNodes built it. */
  function screenLabel(g: UiGraph, showShots: boolean): string {
    const [node] = toFlowNodes(g, layoutGraph(g, none, showShots), none, new Map(), new Map(), undefined, undefined, showShots)
    return renderToStaticMarkup(node?.data.label as ReactNode)
  }

  it('offers a "show screenshots" toggle that is OFF by default when a node has a shot', () => {
    expect(canvasHtml(withShot)).toContain('<input type="checkbox"/>show screenshots · 1')
  })

  it('offers no toggle when nothing has a shot (offline sample)', () => {
    expect(canvasHtml(noShot)).not.toContain('show screenshots')
  })

  it('draws the thumbnail inside the screen node only when the toggle is on', () => {
    expect(screenLabel(withShot, false)).not.toContain('<img')
    expect(screenLabel(withShot, true)).toContain('<img class="node-shot" src="/api/shots/s.jpg"')
    expect(screenLabel(noShot, true)).not.toContain('<img')
  })

  it('grows the screen box by the thumbnail strip so the layout has room for it', () => {
    const base = layoutGraph(withShot, none).sizes.get('s')?.height ?? 0
    expect(layoutGraph(withShot, none, true).sizes.get('s')?.height).toBe(base + 70)
    expect(layoutGraph(noShot, none, true).sizes.get('s')?.height).toBe(base)
  })
})
