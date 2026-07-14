import { describe, it, expect } from 'vitest'
import { matchLiteralAll, matchPrefix, matchTemplate, parseTemplate, type RouteLike } from './matcher'

const routes: RouteLike[] = [
  { fullPath: '/', nodeId: 'n_root' },
  { fullPath: '/products', nodeId: 'n_products' },
  { fullPath: '/products/:id', nodeId: 'n_products_id' },
  { fullPath: '/checkout', nodeId: 'n_checkout' },
]

describe('matchLiteralAll', () => {
  it('returns an exact match (safe to assert as must)', () => {
    const { exact, candidates } = matchLiteralAll('/checkout', routes)
    expect(exact?.nodeId).toBe('n_checkout')
    expect(candidates).toEqual([])
  })

  it('ignores query and hash for the exact match', () => {
    expect(matchLiteralAll('/checkout?step=1', routes).exact?.nodeId).toBe('n_checkout')
  })

  it('returns no exact but a param candidate for a concrete sub-path (never a single must)', () => {
    const { exact, candidates } = matchLiteralAll('/products/42', routes)
    expect(exact).toBeNull()
    expect(candidates.map((c) => c.nodeId)).toEqual(['n_products_id'])
  })

  it('returns nothing for an undeclared target', () => {
    const { exact, candidates } = matchLiteralAll('/nope', routes)
    expect(exact).toBeNull()
    expect(candidates).toEqual([])
  })

  it('fans out an ambiguous literal to all matching param patterns', () => {
    const ambiguous: RouteLike[] = [
      { fullPath: '/:org/:repo', nodeId: 'n_org_repo' },
      { fullPath: '/settings/:tab', nodeId: 'n_settings_tab' },
    ]
    const { exact, candidates } = matchLiteralAll('/settings/billing', ambiguous)
    expect(exact).toBeNull()
    expect(candidates.map((c) => c.nodeId).sort()).toEqual(['n_org_repo', 'n_settings_tab'])
  })
})

describe('matchPrefix', () => {
  it('over-approximates a static prefix to longer routes', () => {
    expect(matchPrefix('/products/', routes).map((r) => r.nodeId)).toEqual(['n_products_id'])
  })

  it('returns nothing when no route extends the prefix', () => {
    expect(matchPrefix('/orders/', routes)).toEqual([])
  })
})

describe('parseTemplate + matchTemplate (structural over-approximation)', () => {
  const routes: RouteLike[] = [
    { fullPath: '/admin/:tenantSlug', nodeId: 'n_admin_t' },
    { fullPath: '/admin/api-keys', nodeId: 'n_admin_keys' },
    { fullPath: '/admin/notifications', nodeId: 'n_admin_notif' },
    { fullPath: '/admin/:tenantSlug/analytics', nodeId: 'n_admin_an' },
    { fullPath: '/ws/:workspaceId/reviews', nodeId: 'n_ws_reviews' },
    { fullPath: '/ws/:workspaceId/settings', nodeId: 'n_ws_settings' },
    { fullPath: '/ws/:workspaceId', nodeId: 'n_ws' },
    { fullPath: '/tenant/:t/view/*', nodeId: 'n_view' },
  ]

  it('parseTemplate splits head + spans into literal/dynamic segments', () => {
    // `/ws/${id}/reviews` -> head "/ws/", one span with literal "/reviews"
    expect(parseTemplate('/ws/', ['/reviews'])).toEqual({ segs: [{ kind: 'lit', value: 'ws' }, { kind: 'dyn' }, { kind: 'lit', value: 'reviews' }], endsOpen: false })
    // `/admin/${slug}` -> head "/admin/", one span with empty trailing literal
    expect(parseTemplate('/admin/', [''])).toEqual({ segs: [{ kind: 'lit', value: 'admin' }, { kind: 'dyn' }], endsOpen: true })
  })

  it('`/ws/${id}/reviews` resolves to the ONE /ws/:id/reviews route, not the whole /ws subtree', () => {
    const hits = matchTemplate(parseTemplate('/ws/', ['/reviews']), routes).map((r) => r.nodeId)
    expect(hits).toEqual(['n_ws_reviews'])
  })

  it('`/admin/${slug}` matches only the 2-segment /admin routes, not the whole subtree', () => {
    const hits = matchTemplate(parseTemplate('/admin/', ['']), routes).map((r) => r.nodeId).sort()
    // /admin/:tenantSlug, /admin/api-keys, /admin/notifications — NOT /admin/:tenantSlug/analytics
    expect(hits).toEqual(['n_admin_keys', 'n_admin_notif', 'n_admin_t'])
  })

  it('a trailing open interpolation also matches a catch-all route', () => {
    const hits = matchTemplate(parseTemplate('/tenant/', ['/view/']), routes).map((r) => r.nodeId)
    expect(hits).toContain('n_view')
  })

  it('is strictly tighter than matchPrefix for the same template', () => {
    const prefixHits = matchPrefix('/admin/', routes).length
    const tmplHits = matchTemplate(parseTemplate('/admin/', ['']), routes).length
    expect(tmplHits).toBeLessThan(prefixHits)
  })
})
