import { describe, it, expect } from 'vitest'
import { matchLiteralAll, matchPrefix, type RouteLike } from './matcher'

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
