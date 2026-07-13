// Tiny graph builders shared across the core test suite. Defaults produce a
// valid, witnessed static must-edge so individual tests override only what they
// exercise.

import type { GraphEdge, GraphNode, UiGraph, Witness } from './ir'

const staticWitness: Witness = { source: 'static', file: 'x.tsx', loc: { line: 1, col: 1 }, ruleId: 'test' }

/** Build a GraphNode with sensible defaults. */
export function node(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return { id, route: `/${id}`, componentPath: null, label: id, kind: 'screen', ...over }
}

/** Build a GraphEdge with sensible (valid, witnessed static must) defaults. */
export function edge(id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id,
    from,
    to,
    event: 'navigate',
    guard: null,
    effect: 'navigate',
    modality: 'must',
    source: 'static',
    confidence: 1,
    witness: staticWitness,
    ...over,
  }
}

/** Build a UiGraph from nodes and edges. */
export function graph(nodes: GraphNode[], edges: GraphEdge[], over: Partial<UiGraph['meta']> = {}): UiGraph {
  return {
    version: 0,
    meta: { adapter: '@ui-graph/test', adapterVersion: '0.0.0', rulesetVersion: 'test', ...over },
    nodes,
    edges,
  }
}
