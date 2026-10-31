import { describe, it, expect } from 'vitest'
import { matchAll, matchLiteral, matchPrefix, urlPath, type RouteLike } from './matcher'

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

describe('urlPath', () => {
  it('leaves a URL that names no auxiliary outlet unchanged, and drops query, fragment and matrix parameters', () => {
    expect(urlPath('/inbox/42')).toEqual({ path: '/inbox/42', aux: false })
    expect(urlPath('/inbox?tab=2#top')).toEqual({ path: '/inbox', aux: false })
    expect(urlPath('/inbox;a=1/42')).toEqual({ path: '/inbox/42', aux: false })
  })
  it('drops the auxiliary groups, keeps the primary path, and says an outlet was named', () => {
    expect(urlPath('/inbox(popup:compose)')).toEqual({ path: '/inbox', aux: true })
    expect(urlPath('/inbox/(popup:compose//side:help)')).toEqual({ path: '/inbox/', aux: true })
  })
  it('gives up on a group that also carries the primary outlet', () => {
    expect(urlPath('/a/(b//popup:c)')).toBeNull()
    expect(urlPath('/(primary:inbox//popup:x)')).toBeNull()
  })
})

describe('matchAll and matchLiteral on a command', () => {
  it('lists every route an address can reach', () => {
    expect(matchAll('/products/new', [...routes, { fullPath: '/products/new', nodeId: 'n_new' }]).map((r) => r.nodeId).sort()).toEqual(['n_new', 'n_products_id'])
    expect(matchAll('/checkout', routes).map((r) => r.nodeId)).toEqual(['n_checkout'])
  })
  it('keeps a query mark in a command as part of the segment, as Angular does', () => {
    expect(matchLiteral('/checkout?x=1', routes, false)).toBeNull()
    expect(matchLiteral('/checkout?x=1', routes)?.nodeId).toBe('n_checkout')
  })
})
