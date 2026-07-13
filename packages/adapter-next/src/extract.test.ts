import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { validateGraph } from '@ui-graph/core'
import { extractNextGraph } from './index'

const dir = fileURLToPath(new URL('../../../examples/sample-next-app', import.meta.url))

describe('extractNext — sample-next-app golden', () => {
  const { graph, soundiness } = extractNextGraph(dir)
  const hasEdge = (from: string, to: string, modality: string): boolean =>
    graph.edges.some((e) => e.from === from && e.to === to && e.modality === modality)

  it('satisfies the core invariants', () => {
    expect(validateGraph(graph)).toEqual([])
  })

  it('discovers app/ + pages/ routes (groups stripped, dynamic/catch-all normalized, specials excluded)', () => {
    expect(new Set(graph.nodes.filter((n) => n.kind === 'screen').map((n) => n.id))).toEqual(
      new Set(['n_root', 'n_about', 'n_blog', 'n_blog_slug', 'n_pricing', 'n_shop_wildcard', 'n_dashboard', 'n_login', 'n_legacy', 'n_users_id']),
    )
  })

  it('stamps the next adapter in meta', () => {
    expect(graph.meta.adapter).toBe('@ui-graph/adapter-next')
  })

  it('emits a literal <Link href> as a must edge (next.link-href)', () => {
    expect(hasEdge('n_root', 'n_about', 'must')).toBe(true)
    expect(hasEdge('n_root', 'n_dashboard', 'must')).toBe(true)
    expect(hasEdge('n_about', 'n_root', 'must')).toBe(true)
    const e = graph.edges.find((x) => x.from === 'n_root' && x.to === 'n_about')
    expect(e?.witness?.ruleId).toBe('rr.link-to')
  })

  it('emits useRouter().push(literal) as a must edge', () => {
    expect(hasEdge('n_root', 'n_login', 'must')).toBe(true)
    const e = graph.edges.find((x) => x.from === 'n_root' && x.to === 'n_login')
    expect(e?.witness?.ruleId).toBe('next.use-router-push')
  })

  it('emits a guarded redirect() from next/navigation as a may edge (next.redirect)', () => {
    expect(hasEdge('n_login', 'n_root', 'may')).toBe(true)
    const e = graph.edges.find((x) => x.from === 'n_login' && x.to === 'n_root')
    expect(e?.witness?.ruleId).toBe('next.redirect')
    expect(e?.effect).toBe('redirect')
    expect(e?.guard).toContain('done')
  })

  it('over-approximates a template <Link href> to a may edge', () => {
    expect(hasEdge('n_blog', 'n_blog_slug', 'may')).toBe(true)
    expect(soundiness.some((s) => s.kind === 'over-approximation')).toBe(true)
  })

  it('reports the app-vs-pages route collision on n_root', () => {
    expect(soundiness.some((s) => s.kind === 'route-collision')).toBe(true)
  })

  it('layout.tsx and _app/api are not route nodes', () => {
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(ids.has('n_layout')).toBe(false)
  })

  it('extracts controls when opts.controls is set', () => {
    const { graph: g } = extractNextGraph(dir, { controls: true })
    const controls = g.nodes.filter((n) => n.kind === 'control')
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.some((c) => c.control?.controlType === 'input')).toBe(true)
    expect(validateGraph(g)).toEqual([])
  })
})
