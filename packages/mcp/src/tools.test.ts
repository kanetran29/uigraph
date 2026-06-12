// Tests for the pure, model-free MCP tools. They run against a real temp
// workspace dir (no transport, no LLM): save a small valid graph, then exercise
// each tool's contract directly per docs/20-development-cycle.md (TDD).

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode, UiGraph, Witness } from '@uigraph/core'
import { loadGraph, loadOverlay, saveGraph } from '@uigraph/core/node'
import {
  baseGraphPath,
  diffTool,
  getGraph,
  observationsPath,
  overlayPath,
  planPathTool,
  readObservations,
  reportObservation,
  updateGraph,
  type ToolContext,
} from './tools'

const staticWitness: Witness = { source: 'static', file: 'x.tsx', loc: { line: 1, col: 1 }, ruleId: 'test' }

function node(id: string): GraphNode {
  return { id, route: `/${id}`, componentPath: null, label: id.toUpperCase(), kind: 'screen' }
}

function edge(id: string, from: string, to: string): GraphEdge {
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
  }
}

function graph(nodes: GraphNode[], edges: GraphEdge[]): UiGraph {
  return {
    version: 0,
    meta: { adapter: '@uigraph/test', adapterVersion: '0.0.0', rulesetVersion: 'test' },
    nodes,
    edges,
  }
}

function newWorkspace(g: UiGraph): ToolContext {
  const dir = mkdtempSync(join(tmpdir(), 'uigraph-mcp-'))
  saveGraph(join(dir, 'ui-graph.json'), g)
  return { dir }
}

// A 3-node, 2-hop chain: a -> b -> c. c is unreachable from itself backwards.
function chainWorkspace(): ToolContext {
  const g = graph([node('a'), node('b'), node('c')], [edge('e_ab', 'a', 'b'), edge('e_bc', 'b', 'c')])
  return newWorkspace(g)
}

describe('getGraph', () => {
  it('returns the merged nodes/edges and counts from the base graph', () => {
    const ctx = chainWorkspace()
    const res = getGraph(ctx)
    expect(res.nodeCount).toBe(3)
    expect(res.edgeCount).toBe(2)
    expect(res.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    expect(res.edges.map((e) => e.id).sort()).toEqual(['e_ab', 'e_bc'])
  })

  it('reflects an overlay-added manual edge after update_graph', () => {
    const ctx = chainWorkspace()
    updateGraph(ctx, { op: { kind: 'addEdge', edge: edge('e_ca', 'c', 'a') } })
    const res = getGraph(ctx)
    expect(res.edgeCount).toBe(3)
    const added = res.edges.find((e) => e.id === 'e_ca')
    expect(added).toBeDefined()
    expect(added?.source).toBe('manual')
  })
})

describe('planPathTool', () => {
  it('returns a correct ordered path on a 2-hop graph', () => {
    const ctx = chainWorkspace()
    const res = planPathTool(ctx, { from: 'a', to: 'c' })
    expect(res.found).toBe(true)
    expect(res.steps.map((s) => s.edgeId)).toEqual(['e_ab', 'e_bc'])
    expect(res.steps.map((s) => s.fromLabel)).toEqual(['A', 'B'])
    expect(res.steps.map((s) => s.toLabel)).toEqual(['B', 'C'])
  })

  it('returns "no path" when the target is unreachable', () => {
    const ctx = chainWorkspace()
    const res = planPathTool(ctx, { from: 'c', to: 'a' })
    expect(res.found).toBe(false)
    expect(res.steps).toEqual([])
  })
})

describe('updateGraph', () => {
  it('addEdge writes a source:manual edge to the overlay and leaves the base unchanged', () => {
    const ctx = chainWorkspace()
    const baseBefore = readFileSync(baseGraphPath(ctx), 'utf8')

    updateGraph(ctx, { op: { kind: 'addEdge', edge: edge('e_ca', 'c', 'a') } })

    expect(existsSync(overlayPath(ctx))).toBe(true)
    const overlay = loadOverlay(overlayPath(ctx))
    expect(overlay.addedEdges).toHaveLength(1)
    expect(overlay.addedEdges[0]?.id).toBe('e_ca')
    expect(overlay.addedEdges[0]?.source).toBe('manual')
    expect(overlay.addedEdges[0]?.witness).toBeUndefined()

    const baseAfter = readFileSync(baseGraphPath(ctx), 'utf8')
    expect(baseAfter).toBe(baseBefore)
    const reloaded = loadGraph(baseGraphPath(ctx))
    expect(reloaded.edges.map((e) => e.id).sort()).toEqual(['e_ab', 'e_bc'])
  })
})

describe('reportObservation', () => {
  it('appends a JSON line to observations.log.jsonl and returns the entry', () => {
    const ctx = chainWorkspace()
    const entry = reportObservation(ctx, { from: 'a', to: 'b', event: 'click', outcome: 'success' })
    expect(entry.from).toBe('a')
    expect(entry.outcome).toBe('success')
    expect(typeof entry.ts).toBe('string')

    expect(existsSync(observationsPath(ctx))).toBe(true)
    const logged = readObservations(ctx)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toEqual(entry)

    reportObservation(ctx, { from: 'b', to: 'c', event: 'submit', outcome: 'blocked' })
    expect(readObservations(ctx)).toHaveLength(2)
  })
})

describe('diffTool', () => {
  it('detects an added edge between two graph files', () => {
    const a = graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')])
    const b = graph([node('a'), node('b')], [edge('e_ab', 'a', 'b'), edge('e_ba', 'b', 'a')])
    const dir = mkdtempSync(join(tmpdir(), 'uigraph-mcp-diff-'))
    const aPath = join(dir, 'a.json')
    const bPath = join(dir, 'b.json')
    saveGraph(aPath, a)
    saveGraph(bPath, b)

    const res = diffTool({ a: aPath, b: bPath })
    expect(res.addedEdges.map((e) => e.id)).toEqual(['e_ba'])
    expect(res.removedEdges).toEqual([])
    expect(res.changedEdges).toEqual([])
  })
})
