// Tests for the pure, model-free MCP tools. They run against a real temp
// workspace whose canonical store is a SQLite uigraph.db (no transport, no LLM):
// seed a small valid graph into the store, then exercise each tool's contract
// directly per docs/20-development-cycle.md (TDD).

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode, Overlay, Proposals, UiGraph, Witness } from '@uigraph/core'
import { type Proposal } from '@uigraph/core'
import { openStore, saveGraph } from '@uigraph/core/node'
import {
  dbPath,
  describeScreen,
  diffTool,
  getCoverage,
  getGraph,
  getGrounding,
  getProposalGraph,
  getProposals,
  getLoopStatus,
  markUnverifiable,
  nextToVerifyTool,
  planPathTool,
  readObservations,
  reconcileProposalsTool,
  reportObservation,
  updateGraph,
  withdrawProposal,
  type ToolContext,
} from './tools'

const staticWitness: Witness = { source: 'static', file: 'x.tsx', loc: { line: 1, col: 1 }, ruleId: 'test' }

function node(id: string): GraphNode {
  return { id, route: `/${id}`, componentPath: null, label: id.toUpperCase(), kind: 'screen' }
}

function edge(id: string, from: string, to: string): GraphEdge {
  return { id, from, to, event: 'navigate', guard: null, effect: 'navigate', modality: 'must', source: 'static', confidence: 1, witness: staticWitness }
}

function graph(nodes: GraphNode[], edges: GraphEdge[]): UiGraph {
  return { version: 0, meta: { adapter: '@uigraph/test', adapterVersion: '0.0.0', rulesetVersion: 'test' }, nodes, edges }
}

function newWorkspace(g: UiGraph): ToolContext {
  const dir = mkdtempSync(join(tmpdir(), 'uigraph-mcp-'))
  const ctx: ToolContext = { dir }
  const store = openStore(dbPath(ctx))
  store.setBaseGraph(g)
  store.close()
  return ctx
}

function seedOverlay(ctx: ToolContext, overlay: Overlay): void {
  const store = openStore(dbPath(ctx))
  store.setOverlay(overlay)
  store.close()
}

function seedProposals(ctx: ToolContext, sidecar: Proposals): void {
  const store = openStore(dbPath(ctx))
  store.setProposals(sidecar)
  store.close()
}

// A 3-node, 2-hop chain: a -> b -> c. c is unreachable from itself backwards.
function chainWorkspace(): ToolContext {
  return newWorkspace(graph([node('a'), node('b'), node('c')], [edge('e_ab', 'a', 'b'), edge('e_bc', 'b', 'c')]))
}

function proposal(id: string, over: Partial<Proposal> = {}): Proposal {
  return {
    id,
    kind: 'interaction',
    category: 'disclosure',
    screen: 'a',
    title: 'read more expands',
    rationale: 'truncated text + read-more control',
    evidenced: true,
    confidence: 0.6,
    source: 'proposal',
    status: 'proposed',
    ...over,
  }
}

describe('Tier-3 fold: confirmed observation enters the graph', () => {
  it('a confirmed report_observation becomes a witnessed runtime edge in get_graph', () => {
    const ctx = chainWorkspace()
    expect(getGraph(ctx).edges.find((e) => e.from === 'a' && e.to === 'c')).toBeUndefined()
    reportObservation(ctx, { from: 'a', to: 'c', event: 'click', outcome: 'confirmed' })
    const e = getGraph(ctx).edges.find((x) => x.from === 'a' && x.to === 'c')
    expect(e?.source).toBe('runtime')
    expect(e?.witness?.source).toBe('runtime')
  })

  it('a refuted observation does not add an edge', () => {
    const ctx = chainWorkspace()
    reportObservation(ctx, { from: 'a', to: 'c', event: 'click', outcome: 'refuted' })
    expect(getGraph(ctx).edges.find((x) => x.from === 'a' && x.to === 'c')).toBeUndefined()
  })
})

describe('loadMergedGraph integrity (red-team)', () => {
  it('rejects a stale overlay whose base hash no longer matches', async () => {
    const { loadMergedGraph } = await import('./tools')
    const ctx = chainWorkspace()
    seedOverlay(ctx, { version: 0, base: 'deadbeef', addedNodes: [], addedEdges: [], editedEdges: [], removedRefs: [] })
    expect(() => loadMergedGraph(ctx)).toThrow(/stale overlay/)
  })

  it('rejects a merged graph made invalid by the overlay (dangling ref)', async () => {
    const { loadMergedGraph } = await import('./tools')
    const { hashValue } = await import('@uigraph/core')
    const ctx = chainWorkspace()
    const base = getGraph(ctx)
    seedOverlay(ctx, {
      version: 0,
      base: hashValue({ version: base.version, meta: base.meta, nodes: base.nodes, edges: base.edges }),
      addedNodes: [],
      addedEdges: [{ id: 'm1', from: 'a', to: 'ghost', event: 'navigate', guard: null, effect: 'navigate', modality: 'may', source: 'manual', confidence: 0.5 }],
      editedEdges: [],
      removedRefs: [],
    })
    expect(() => loadMergedGraph(ctx)).toThrow(/invalid/)
  })
})

describe('getProposals', () => {
  it('returns empty when no proposals exist', () => {
    expect(getProposals(chainWorkspace()).total).toBe(0)
  })

  it('serves proposals and applies filters', () => {
    const ctx = chainWorkspace()
    seedProposals(ctx, {
      version: 0,
      base: 'h',
      proposals: [
        proposal('p1', { category: 'keyboard', evidenced: true, confidence: 0.9 }),
        proposal('p2', { category: 'keyboard', evidenced: false, confidence: 0.2 }),
        proposal('p3', { category: 'async-state', screen: 'b', evidenced: true, confidence: 0.7 }),
      ],
    })
    expect(getProposals(ctx).total).toBe(3)
    expect(getProposals(ctx, { category: 'keyboard' }).total).toBe(2)
    expect(getProposals(ctx, { evidencedOnly: true }).total).toBe(2)
    expect(getProposals(ctx, { screen: 'b' }).proposals.map((p) => p.id)).toEqual(['p3'])
    expect(getProposals(ctx, { minConfidence: 0.5 }).total).toBe(2)
    expect(getProposals(ctx, { category: 'keyboard' }).byCategory).toEqual({ keyboard: 2 })
  })
})

describe('getGrounding', () => {
  it('digests controls + outgoing edges per screen, attributing control edges to the parent', () => {
    const control: GraphNode = {
      id: 'cc_a_btn',
      route: null,
      componentPath: null,
      label: 'go',
      kind: 'control',
      parent: 'a',
      control: { element: 'button', controlType: 'button', events: ['click'], effects: ['state:setX'] },
    }
    const g = graph([node('a'), node('b'), control], [{ ...edge('e_ab', 'cc_a_btn', 'b'), witness: { ...staticWitness, ruleId: 'rr.use-navigate.interprocedural' } }])
    const ctx = newWorkspace(g)
    const grounding = getGrounding(ctx)
    const a = grounding.screens.find((s) => s.screen === 'a')
    expect(grounding.screens.some((s) => s.screen === 'cc_a_btn')).toBe(false)
    expect(a?.controls.map((c) => c.id)).toEqual(['cc_a_btn'])
    expect(a?.knownEdges.find((e) => e.to === 'b')?.interprocedural).toBe(true)
    expect(getGrounding(ctx, { screen: 'a' }).screens).toHaveLength(1)
  })
})

describe('AI tools (F2): proposal graph, describe_screen, coverage, next_to_verify', () => {
  const control: GraphNode = {
    id: 'cc_a_btn', route: null, componentPath: null, label: 'go', kind: 'control', parent: 'a',
    control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|go' }, events: ['click'], effects: [] },
  }
  // a (screen) owns a button; a->b runtime, b->c static may, a->u unknown.
  const ws = (): ToolContext => {
    const u: GraphNode = { id: 'u_a', route: null, componentPath: null, label: 'dynamic', kind: 'unknown' }
    const g = graph(
      [node('a'), node('b'), node('c'), u, control],
      [
        { ...edge('e_ab', 'a', 'b'), source: 'runtime', witness: { source: 'runtime', observationId: 'o1' } },
        { ...edge('e_bc', 'b', 'c'), source: 'static', modality: 'may', guard: 'x' },
        { ...edge('e_au', 'a', 'u_a'), source: 'static', modality: 'unknown' },
      ],
    )
    const ctx = newWorkspace(g)
    seedProposals(ctx, { version: 0, base: 'h', proposals: [proposal('p1', { screen: 'a', to: 'c', event: 'click' })] })
    return ctx
  }

  it('get_proposal_graph serves the stored proposal nodes/edges', () => {
    const pg = getProposalGraph(ws())
    expect(pg.edges.find((e) => e.from === 'a' && e.to === 'c')?.proposalIds).toContain('p1')
  })

  it('describe_screen returns controls + proven + proposed actions for one screen', () => {
    const d = describeScreen(ws(), { screen: 'a' })
    if ('error' in d) throw new Error(d.error)
    expect(d.controls.map((c) => c.id)).toEqual(['cc_a_btn'])
    expect(d.controls[0]?.selector?.value).toBe('button|go')
    expect(d.proposedEdges.some((e) => e.to === 'c')).toBe(true)
  })

  it('get_coverage counts runtime-witnessed vs not', () => {
    const cov = getCoverage(ws())
    expect(cov.verified).toBe(1)
    expect(cov.unverified.map((e) => e.id).sort()).toEqual(['e_au', 'e_bc'])
  })

  it('next_to_verify ranks unknown > may > proposal, skipping runtime', () => {
    const targets = nextToVerifyTool(ws())
    expect(targets[0]?.id).toBe('e_au')
    expect(targets.some((t) => t.kind === 'proposal')).toBe(true)
    expect(targets.some((t) => t.id === 'e_ab')).toBe(false)
  })
})

describe('getGraph', () => {
  it('returns the merged nodes/edges and counts from the base graph', () => {
    const res = getGraph(chainWorkspace())
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
    expect(res.edges.find((e) => e.id === 'e_ca')?.source).toBe('manual')
  })
})

describe('planPathTool', () => {
  it('returns a correct ordered path on a 2-hop graph', () => {
    const res = planPathTool(chainWorkspace(), { from: 'a', to: 'c' })
    expect(res.found).toBe(true)
    expect(res.steps.map((s) => s.edgeId)).toEqual(['e_ab', 'e_bc'])
    expect(res.steps.map((s) => s.fromLabel)).toEqual(['A', 'B'])
    expect(res.steps.map((s) => s.toLabel)).toEqual(['B', 'C'])
  })

  it('returns "no path" when the target is unreachable', () => {
    const res = planPathTool(chainWorkspace(), { from: 'c', to: 'a' })
    expect(res.found).toBe(false)
    expect(res.steps).toEqual([])
  })
})

describe('updateGraph', () => {
  it('addEdge writes a source:manual edge to the overlay and leaves the base unchanged', () => {
    const ctx = chainWorkspace()
    updateGraph(ctx, { op: { kind: 'addEdge', edge: edge('e_ca', 'c', 'a') } })

    const store = openStore(dbPath(ctx))
    const overlay = store.getOverlay()
    const base = store.getBaseGraph()
    store.close()

    expect(overlay?.addedEdges).toHaveLength(1)
    expect(overlay?.addedEdges[0]?.id).toBe('e_ca')
    expect(overlay?.addedEdges[0]?.source).toBe('manual')
    expect(overlay?.addedEdges[0]?.witness).toBeUndefined()
    // base is untouched
    expect(base?.edges.map((e) => e.id).sort()).toEqual(['e_ab', 'e_bc'])
  })

  it('editNode overlays a renamed/re-routed node onto the merged graph; base untouched', () => {
    const ctx = chainWorkspace()
    updateGraph(ctx, { op: { kind: 'editNode', node: { id: 'a', route: '/home', componentPath: null, label: 'Home', kind: 'screen' } } })
    const merged = getGraph(ctx)
    const a = merged.nodes.find((n) => n.id === 'a')
    expect(a?.label).toBe('Home')
    expect(a?.route).toBe('/home')
  })

  it('named scenarios isolate overlay edits per scenario', async () => {
    const { listScenarios, setScenario } = await import('./tools')
    const ctx = chainWorkspace()
    // default scenario: add an edge
    updateGraph(ctx, { op: { kind: 'addEdge', edge: edge('e_def', 'c', 'a') } })
    // switch to a new scenario + add a different edge
    setScenario(ctx, { name: 'feature-x' })
    expect(listScenarios(ctx)).toEqual({ active: 'feature-x', names: ['default', 'feature-x'] })
    updateGraph(ctx, { op: { kind: 'addEdge', edge: edge('e_fx', 'a', 'c') } })
    expect(getGraph(ctx).edges.some((e) => e.id === 'e_fx')).toBe(true)
    expect(getGraph(ctx).edges.some((e) => e.id === 'e_def')).toBe(false)
    // back to default: its edge is there, feature-x's is not
    setScenario(ctx, { name: 'default' })
    expect(getGraph(ctx).edges.some((e) => e.id === 'e_def')).toBe(true)
    expect(getGraph(ctx).edges.some((e) => e.id === 'e_fx')).toBe(false)
  })
})

describe('reportObservation', () => {
  it('records an observation in the store and returns the entry', () => {
    const ctx = chainWorkspace()
    const entry = reportObservation(ctx, { from: 'a', to: 'b', event: 'click', outcome: 'confirmed' })
    expect(entry.from).toBe('a')
    expect(entry.outcome).toBe('confirmed')
    expect(typeof entry.ts).toBe('string')
    expect(typeof entry.id).toBe('string')

    const logged = readObservations(ctx)
    expect(logged).toHaveLength(1)
    const { reconciled: _reconciled, ...stored } = entry
    expect(logged[0]).toEqual(stored)
    expect(Array.isArray(entry.reconciled)).toBe(true)

    reportObservation(ctx, { from: 'b', to: 'c', event: 'submit', outcome: 'refuted' })
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

describe('proposal reconciliation loop', () => {
  // A workspace whose only uncertain transitions are proposals (no may/unknown edges),
  // so the verify worklist == the open proposal set and loopDone is easy to reason about.
  function loopWorkspace(): ToolContext {
    const ctx = newWorkspace(graph([node('a'), node('b')], []))
    seedProposals(ctx, { version: 0, base: 'h', proposals: [proposal('p1', { kind: 'edge', screen: 'a', to: 'b', event: 'click' })] })
    return ctx
  }

  it('report_observation(confirmed, proposalId) archives the proposal AND mints the runtime edge (two derivations, one witness)', () => {
    const ctx = loopWorkspace()
    const res = reportObservation(ctx, { from: 'a', to: 'b', event: 'click', outcome: 'confirmed', proposalId: 'p1' })
    expect(res.reconciled).toEqual([{ id: 'p1', status: 'confirmed' }])
    expect(getProposals(ctx, { status: 'confirmed' }).proposals.map((p) => p.id)).toEqual(['p1'])
    const e = getGraph(ctx).edges.find((x) => x.from === 'a' && x.to === 'b')
    expect(e?.source).toBe('runtime')
  })

  it('report_observation(refuted, proposalId) rejects the proposal and adds NO proven edge (phantom-must check)', () => {
    const ctx = loopWorkspace()
    const res = reportObservation(ctx, { from: 'a', to: 'b', event: 'click', outcome: 'refuted', proposalId: 'p1' })
    expect(res.reconciled).toEqual([{ id: 'p1', status: 'rejected' }])
    expect(getGraph(ctx).edges).toHaveLength(0)
    expect(getProposalGraph(ctx).edges).toHaveLength(0)
  })

  it('withdraw_proposal removes a hallucinated lead from the active graph without touching the proven graph', () => {
    const ctx = loopWorkspace()
    expect(getProposalGraph(ctx).edges).toHaveLength(1)
    const r = withdrawProposal(ctx, { id: 'p1', reason: 'references a control that does not exist' })
    expect(r.status).toBe('rejected')
    expect(getProposalGraph(ctx).edges).toHaveLength(0)
    expect(getGraph(ctx).edges).toHaveLength(0)
    expect(getProposals(ctx, { status: 'rejected' }).proposals[0]?.reason).toContain('does not exist')
  })

  it('mark_unverifiable parks a proposal out of the worklist but keeps it queryable', () => {
    const ctx = loopWorkspace()
    expect(nextToVerifyTool(ctx).some((t) => t.kind === 'proposal')).toBe(true)
    markUnverifiable(ctx, { id: 'p1', reason: 'route behind a feature flag off in dev' })
    expect(nextToVerifyTool(ctx).some((t) => t.kind === 'proposal')).toBe(false)
    expect(getProposals(ctx, { status: 'unverifiable' }).proposals.map((p) => p.id)).toEqual(['p1'])
  })

  it('get_loop_status.loopDone flips true only once worklist is empty AND no proposed remain', () => {
    const ctx = loopWorkspace()
    expect(getLoopStatus(ctx).loopDone).toBe(false)
    reportObservation(ctx, { from: 'a', to: 'b', event: 'click', outcome: 'confirmed', proposalId: 'p1' })
    const s = getLoopStatus(ctx)
    expect(s.loopDone).toBe(true)
    expect(s.resolution.openCount).toBe(0)
    expect(s.worklistSize).toBe(0)
  })

  it('reconcile_proposals re-syncs out-of-band observations and is idempotent', () => {
    const ctx = loopWorkspace()
    // append an observation directly (as the Tier-3 runner would), bypassing report_observation reconcile
    const store = openStore(dbPath(ctx))
    store.appendObservation({ id: 'o1', from: 'a', to: 'b', event: 'click', outcome: 'refuted' })
    store.close()
    expect(reconcileProposalsTool(ctx).changed).toEqual([{ id: 'p1', status: 'rejected' }])
    expect(reconcileProposalsTool(ctx).changed).toEqual([])
  })
})
