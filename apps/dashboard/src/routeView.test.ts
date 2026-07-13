import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode, UiGraph } from '@ui-graph/core'
import { GROUP_THRESHOLD, groupKey, groupNodeId, isGroupId, levelView, screenGroups } from './routeView'

function node(id: string, route: string | null, kind: GraphNode['kind'] = 'screen', parent?: string): GraphNode {
  return { id, route, componentPath: null, label: route ?? id, kind, ...(parent !== undefined ? { parent } : {}) }
}
function edge(id: string, from: string, to: string, opts: Partial<GraphEdge> = {}): GraphEdge {
  return { id, from, to, event: 'click:Link', guard: null, effect: null, modality: 'may', source: 'static', confidence: 0.6, ...opts }
}
function graphOf(nodes: GraphNode[], edges: GraphEdge[]): UiGraph {
  return { version: 0, meta: { adapter: 't', adapterVersion: '0', rulesetVersion: '0' }, nodes, edges }
}

// A graph big enough to trip the grouping threshold: 3 multi-member route groups + root.
function bigGraph(): UiGraph {
  const nodes: GraphNode[] = [node('n_root', '/')]
  for (const g of ['admin', 'ws', 'system']) for (let i = 0; i < 12; i++) nodes.push(node(`n_${g}_${i}`, `/${g}/p${i}`))
  const edges: GraphEdge[] = [
    // cross-group, runtime-witnessed → must survive as a green super-edge
    edge('e1', 'n_admin_0', 'n_ws_0', { source: 'runtime', modality: 'may' }),
    // another admin→ws (parallel) → aggregates into the same super-edge with a count
    edge('e2', 'n_admin_1', 'n_ws_1'),
    // intra-admin, runtime → dropped as a self-loop but flags the group as witnessed
    edge('e3', 'n_admin_2', 'n_admin_3', { source: 'runtime' }),
    // root → each group
    edge('e4', 'n_root', 'n_admin_0'),
    edge('e5', 'n_root', 'n_ws_0'),
    edge('e6', 'n_root', 'n_system_0'),
  ]
  return graphOf(nodes, edges)
}

describe('groupKey', () => {
  it('folds leading dynamic segments to the first static one', () => {
    expect(groupKey('/admin/x')).toBe('admin')
    expect(groupKey('/:tenantSlug/admin/x')).toBe('admin')
    expect(groupKey('/:tenantSlug/:workspaceSlug/settings')).toBe('settings')
  })
  it('buckets root and all-dynamic routes', () => {
    expect(groupKey('/')).toBe('__root__')
    expect(groupKey(null)).toBe('__root__')
    expect(groupKey('/:tenantSlug/:workspaceSlug')).toBe('__dynamic__')
  })
})

describe('screenGroups', () => {
  it('is order-stable and inherits a modal owner group', () => {
    const g = graphOf(
      [node('n_root', '/'), node('n_admin_0', '/admin/a'), node('m_n_admin_0_0', null, 'modal')],
      [],
    )
    const groups = screenGroups(g)
    expect([...groups.get('admin') ?? []]).toEqual(['n_admin_0', 'm_n_admin_0_0'])
  })
})

describe('levelView', () => {
  it('returns the graph UNCHANGED below the threshold (small-app no-regression)', () => {
    const small = graphOf([node('n_root', '/'), node('n_a', '/a'), node('n_b', '/b')], [edge('e', 'n_a', 'n_b')])
    const view = levelView(small, new Set())
    expect(small.nodes.length).toBeLessThanOrEqual(GROUP_THRESHOLD)
    // identity — byte-for-byte the same graph object
    expect(view.graph).toBe(small)
  })

  it('collapses big groups to super-nodes with counts, root stays real', () => {
    const view = levelView(bigGraph(), new Set())
    const ids = view.graph.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['grp_admin', 'grp_system', 'grp_ws', 'n_root'])
    expect(view.groupCount.get('grp_admin')).toBe(12)
    // no member screen leaks into the collapsed view
    expect(view.graph.nodes.some((n) => n.id.startsWith('n_admin_'))).toBe(false)
  })

  it('aggregates cross-group edges into a counted super-edge and keeps runtime green', () => {
    const view = levelView(bigGraph(), new Set())
    const superEdge = view.graph.edges.find((e) => e.from === 'grp_admin' && e.to === 'grp_ws')
    expect(superEdge).toBeDefined()
    // witnessed wins the source rollup → renders green
    expect(superEdge?.source).toBe('runtime')
    // e1 + e2 bundled into one counted super-edge
    expect(superEdge?.event).toBe('×2')
  })

  it('drops an intra-collapsed-group edge but flags the group as hiding a witness', () => {
    const view = levelView(bigGraph(), new Set())
    // the a2→a3 runtime edge resolves to a self-loop on grp_admin and is not emitted
    expect(view.graph.edges.some((e) => e.from === 'grp_admin' && e.to === 'grp_admin')).toBe(false)
    expect(view.groupHasWitnessed.get('grp_admin')).toBe(true)
  })

  it('reveals member screens + intra-group edges when a group is expanded', () => {
    const view = levelView(bigGraph(), new Set(['admin']))
    expect(view.graph.nodes.some((n) => n.id === 'n_admin_0')).toBe(true)
    expect(view.graph.nodes.some((n) => n.id === 'grp_admin')).toBe(false)
    // the previously-hidden intra-admin edge is now a real edge on the canvas
    expect(view.graph.edges.some((e) => e.from === 'n_admin_2' && e.to === 'n_admin_3')).toBe(true)
    // ws + system stay collapsed
    expect(view.graph.nodes.some((n) => n.id === 'grp_ws')).toBe(true)
  })
})

describe('id helpers', () => {
  it('round-trips a group key through its node id', () => {
    expect(isGroupId(groupNodeId('admin'))).toBe(true)
    expect(isGroupId('n_admin_0')).toBe(false)
  })
})
