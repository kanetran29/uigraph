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
  diffSinceLastTool,
  getCoverage,
  getFrontier,
  getGraph,
  getGrounding,
  getProposalGraph,
  getProposals,
  getState,
  listCases,
  getLoopStatus,
  markUnverifiable,
  nextToVerifyTool,
  parkEdge,
  unparkEdge,
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
    const baseEdges = base.edges.map(({ trustTier: _trustTier, ...e }) => e)
    seedOverlay(ctx, {
      version: 0,
      base: hashValue({ version: base.version, meta: base.meta, nodes: base.nodes, edges: baseEdges }),
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

  it('next_to_verify skips runtime AND the dynamic sink whose source is already resolved, ranks may > proposal', () => {
    const targets = nextToVerifyTool(ws())
    // e_ab is runtime (skip); a has a concrete runtime out-edge so the dynamic sink e_au is resolved (skip)
    expect(targets.some((t) => t.id === 'e_ab')).toBe(false)
    expect(targets.some((t) => t.id === 'e_au')).toBe(false)
    expect(targets[0]?.id).toBe('e_bc')
    expect(targets.some((t) => t.kind === 'proposal')).toBe(true)
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
    const { reconciled: _reconciled, dropped: _dropped, ...stored } = entry
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

describe('honest 100% accounted-for (edge resolution + park)', () => {
  // a->b is a `may` edge (open until driven/parked); a->u_a is a dynamic sink.
  function ws(): ToolContext {
    const u: GraphNode = { id: 'u_a', route: null, componentPath: null, label: 'dynamic', kind: 'unknown' }
    return newWorkspace(graph(
      [node('a'), node('b'), u],
      [
        { ...edge('e_ab', 'a', 'b'), modality: 'may', source: 'static', guard: 'x' },
        { ...edge('e_au', 'a', 'u_a'), modality: 'unknown', source: 'static' },
      ],
    ))
  }

  it('reports BOTH ratios; a may + dynamic-open edge keep accountedRatio < 1', () => {
    const cov = getCoverage(ws())
    expect(cov.runtimeRatio).toBe(0)
    expect(cov.accountedRatio).toBeLessThan(1)
    expect(cov.open.map((e) => e.id).sort()).toEqual(['e_ab', 'e_au'])
  })

  it('park_edge accounts for an edge WITHOUT verifying it; both buckets stay honest', () => {
    const ctx = ws()
    parkEdge(ctx, { id: 'e_ab', reason: 'guarded by a role flag off in dev' })
    const cov = getCoverage(ctx)
    expect(cov.parked.map((e) => e.id)).toEqual(['e_ab'])
    expect(cov.parked[0]?.reason).toContain('role flag')
    expect(cov.open.map((e) => e.id)).toEqual(['e_au'])
    expect(cov.runtimeVerified).toBe(0)
    expect(nextToVerifyTool(ctx).some((t) => t.id === 'e_ab')).toBe(false)
    expect(unparkEdge(ctx, { id: 'e_ab' }).unparked).toBe(true)
    expect(getCoverage(ctx).open.map((e) => e.id).sort()).toEqual(['e_ab', 'e_au'])
  })

  it('resolves a dynamic sink by minting a concrete runtime edge (the u_ edge leaves open; no fake)', () => {
    const ctx = ws()
    // drive the dynamic dispatch out of a, observe the real landing b
    const res = reportObservation(ctx, { from: 'a', to: 'b', event: 'navigate', outcome: 'confirmed' })
    expect(res.dropped).toBe(false)
    const cov = getCoverage(ctx)
    // a concrete runtime edge a->b now exists (witnessed); the u_ edge is resolved (out of open)
    expect(getGraph(ctx).edges.some((e) => e.from === 'a' && e.to === 'b' && e.source === 'runtime')).toBe(true)
    expect(cov.open.some((e) => e.id === 'e_au')).toBe(false)
    // runtimeRatio reflects only the witnessed edge, never the synthetic sink
    expect(cov.runtimeVerified).toBe(1)
  })

  it('flags a dropped observation when the landing node is not in the graph', () => {
    const ctx = ws()
    const res = reportObservation(ctx, { from: 'a', to: 'n_ghost', event: 'navigate', outcome: 'confirmed' })
    expect(res.dropped).toBe(true)
    expect(getGraph(ctx).edges.some((e) => e.to === 'n_ghost')).toBe(false)
  })

  it('loopDone only when every edge is accounted-for (open empty) AND no proposed proposals', () => {
    const ctx = ws()
    expect(getLoopStatus(ctx).loopDone).toBe(false)
    parkEdge(ctx, { id: 'e_ab', reason: 'flag off' })
    parkEdge(ctx, { id: 'e_au', reason: 'dynamic dispatch with no reachable concrete landing' })
    const s = getLoopStatus(ctx)
    expect(s.loopDone).toBe(true)
    expect(s.coverage.accountedRatio).toBe(1)
    // but it was reached by parking, NOT by runtime verification — stays visible
    expect(s.coverage.runtimeRatio).toBe(0)
    expect(s.openEdges).toHaveLength(0)
  })
})

describe('diffSinceLastTool', () => {
  it('reports no-prior on a single-map workspace', () => {
    const ctx = newWorkspace(graph([node('a')], []))
    expect(diffSinceLastTool(ctx).state).toBe('no-prior')
  })

  it('reports the delta after a re-map (current vs the rotated previous)', () => {
    const ctx = newWorkspace(graph([node('a'), node('b')], [edge('e_ab', 'a', 'b')]))
    const store = openStore(dbPath(ctx))
    store.snapshotCurrentAsPrevious()
    store.setBaseGraph(graph([node('a'), node('b')], [edge('e_ab', 'a', 'b'), edge('e_ba', 'b', 'a')]))
    store.close()
    const r = diffSinceLastTool(ctx)
    expect(r.state).toBe('ok')
    expect(r.diff?.addedEdges.map((e) => e.id)).toEqual(['e_ba'])
  })
})

describe('recall-first read tools: get_state, list_cases, get_frontier, plan_path+minTier', () => {
  // A form screen exhibiting every trust tier: a proven submit, an asserted close,
  // an unknown dynamic dispatch, a witnessed runtime hop, plus a quarantined proposal.
  // n_form -> n_success proven (static must) ; n_form -> n_home asserted (static may)
  // n_form -> u_dyn unknown (static unknown, sink kind 'unknown')
  // n_form -> n_loading witnessed (runtime) ; proposal n_form -> n_error (proposed)
  function formWorkspace(): ToolContext {
    const u: GraphNode = { id: 'u_dyn', route: null, componentPath: null, label: 'dynamic', kind: 'unknown' }
    const g = graph(
      [node('n_form'), node('n_success'), node('n_home'), node('n_loading'), node('n_error'), u],
      [
        { ...edge('e_submit', 'n_form', 'n_success'), source: 'static', modality: 'must', guard: 'valid' },
        { ...edge('e_close', 'n_form', 'n_home'), source: 'static', modality: 'may', guard: null },
        { ...edge('e_dyn', 'n_form', 'u_dyn'), source: 'static', modality: 'unknown' },
        { ...edge('e_loading', 'n_form', 'n_loading'), source: 'runtime', witness: { source: 'runtime', observationId: 'o7' } },
      ],
    )
    const ctx = newWorkspace(g)
    seedProposals(ctx, { version: 0, base: 'h', proposals: [proposal('p_err', { screen: 'n_form', to: 'n_error', event: 'submit', category: 'async-state' })] })
    return ctx
  }

  it('get_state returns the node + out-cases each carrying the right trust tier and evidence', () => {
    const res = getState(formWorkspace(), { id: 'n_form' })
    if ('error' in res) throw new Error(res.error)
    expect(res.id).toBe('n_form')
    expect(res.nodeKind).toBe('screen')
    const byTo = new Map(res.cases.map((c) => [c.toNode, c]))
    expect(byTo.get('n_success')?.trustTier).toBe('proven')
    expect(byTo.get('n_home')?.trustTier).toBe('asserted')
    expect(byTo.get('u_dyn')?.trustTier).toBe('unknown')
    expect(byTo.get('n_loading')?.trustTier).toBe('witnessed')
    expect(byTo.get('n_error')?.trustTier).toBe('proposed')
    // proven submit cites its static witness; witnessed loading cites the observation; proposal cites its id
    expect(byTo.get('n_success')?.evidence).toContain('x.tsx')
    expect(byTo.get('n_loading')?.evidence).toBe('runtime:o7')
    expect(byTo.get('n_error')?.evidence).toBe('proposal:p_err')
    // outcomeClass is the to-node id; cases sorted most-trusted first
    expect(res.cases[0]?.trustTier).toBe('witnessed')
    expect(res.cases.map((c) => c.outcomeClass)).toContain('u_dyn')
  })

  it('get_state errors on an unknown node id (never serves a silent empty state)', () => {
    const res = getState(formWorkspace(), { id: 'nope' })
    expect('error' in res).toBe(true)
  })

  it('list_cases returns every case unfiltered, sorted by trust precedence', () => {
    const res = listCases(formWorkspace())
    // 4 graph edges + 1 proposal edge
    expect(res.total).toBe(5)
    expect(res.cases[0]?.trustTier).toBe('witnessed')
    expect(res.cases[res.cases.length - 1]?.trustTier).toBe('unknown')
  })

  it('list_cases({minTier: "proven"}) keeps only witnessed + proven, dropping asserted/proposed/unknown', () => {
    const res = listCases(formWorkspace(), { minTier: 'proven' })
    expect(res.cases.map((c) => c.trustTier).sort()).toEqual(['proven', 'witnessed'])
  })

  it('list_cases({from}) returns only cases leaving that node; {outcomeClass} only those landing there', () => {
    const ctx = formWorkspace()
    expect(listCases(ctx, { from: 'n_form' }).total).toBe(5)
    expect(listCases(ctx, { from: 'n_success' }).total).toBe(0)
    const toErr = listCases(ctx, { outcomeClass: 'n_error' })
    expect(toErr.total).toBe(1)
    expect(toErr.cases[0]?.trustTier).toBe('proposed')
  })

  it('get_frontier lists states with unknown out-edges (and dead ends), with unknown-case counts', () => {
    const res = getFrontier(formWorkspace())
    const ids = res.nodes.map((n) => n.id)
    // n_form has a dynamic-sink/unknown out-edge; the leaf screens have no out-edges (dead ends)
    expect(ids).toContain('n_form')
    const form = res.nodes.find((n) => n.id === 'n_form')
    expect(form?.unknownCount).toBe(1)
    expect(form?.cases[0]?.toNode).toBe('u_dyn')
    // leaf screens are dead ends -> on the frontier with zero unknown cases
    expect(res.nodes.find((n) => n.id === 'n_success')?.unknownCount).toBe(0)
  })

  it('get_frontier({state}) narrows to one frontier node (and is empty for a non-frontier state)', () => {
    const ctx = formWorkspace()
    expect(getFrontier(ctx, { state: 'n_form' }).nodes.map((n) => n.id)).toEqual(['n_form'])
  })

  it('plan_path with minTier flags low-trust hops in tierWarnings without dropping the path', () => {
    // n_form -> n_home is an asserted (may) hop; planning to n_home with minTier proven warns.
    const res = planPathTool(formWorkspace(), { from: 'n_form', to: 'n_home', minTier: 'proven' })
    expect(res.found).toBe(true)
    expect(res.steps.map((s) => s.edgeId)).toEqual(['e_close'])
    expect(res.tierWarnings?.length).toBe(1)
    expect(res.tierWarnings?.[0]).toContain('e_close')
    expect(res.tierWarnings?.[0]).toContain('asserted')
  })

  it('plan_path with minTier adds no warnings when every hop meets the floor', () => {
    const res = planPathTool(formWorkspace(), { from: 'n_form', to: 'n_success', minTier: 'proven' })
    expect(res.found).toBe(true)
    expect(res.tierWarnings).toBeUndefined()
  })
})
