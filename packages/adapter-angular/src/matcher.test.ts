import { describe, it, expect } from 'vitest'
import { matchLiteral, matchPrefix, primaryPath, type RouteLike } from './matcher'

const routes: RouteLike[] = [
  { fullPath: '/', nodeId: 'n_root' },
  { fullPath: '/products', nodeId: 'n_products' },
  { fullPath: '/products/:id', nodeId: 'n_products_id' },
  { fullPath: '/checkout', nodeId: 'n_checkout' },
]

describe('matchLiteral', () => {
  it('matches an exact path', () => {
    expect(matchLiteral('/checkout', routes)?.nodeId).toBe('n_checkout')
  })

  it('matches a parameterized pattern for a concrete path', () => {
    expect(matchLiteral('/products/42', routes)?.nodeId).toBe('n_products_id')
  })

  it('ignores query and hash', () => {
    expect(matchLiteral('/checkout?step=1', routes)?.nodeId).toBe('n_checkout')
  })

  it('returns null for an undeclared target', () => {
    expect(matchLiteral('/nope', routes)).toBeNull()
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

describe('primaryPath', () => {
  it('leaves a URL that names no auxiliary outlet unchanged', () => {
    expect(primaryPath('/inbox/42')).toBe('/inbox/42')
    expect(primaryPath('edit')).toBe('edit')
  })
  it('drops the auxiliary groups and keeps the primary path', () => {
    expect(primaryPath('/inbox(popup:compose)')).toBe('/inbox')
    expect(primaryPath('/inbox/(popup:compose//side:help)')).toBe('/inbox/')
    expect(primaryPath('/(popup:compose)')).toBe('/')
  })
  it('gives up on a group that also carries a primary segment', () => {
    expect(primaryPath('/a/(b//popup:c)')).toBeNull()
  })
})
