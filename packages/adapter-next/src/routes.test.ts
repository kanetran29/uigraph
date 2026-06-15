import { describe, it, expect } from 'vitest'
import { nextRoutePath } from './routes'

describe('nextRoutePath — App Router', () => {
  it('maps page files to their route path', () => {
    expect(nextRoutePath('app/page.tsx')).toBe('/')
    expect(nextRoutePath('app/dashboard/page.tsx')).toBe('/dashboard')
    expect(nextRoutePath('src/app/about/page.jsx')).toBe('/about')
  })
  it('maps dynamic + catch-all segments', () => {
    expect(nextRoutePath('app/blog/[slug]/page.tsx')).toBe('/blog/:slug')
    expect(nextRoutePath('app/shop/[...categories]/page.tsx')).toBe('/shop/*')
    expect(nextRoutePath('app/docs/[[...path]]/page.tsx')).toBe('/docs/*')
  })
  it('strips route groups and named slots', () => {
    expect(nextRoutePath('app/(marketing)/pricing/page.tsx')).toBe('/pricing')
    expect(nextRoutePath('app/@team/members/page.tsx')).toBe('/members')
  })
  it('is null for non-route app files (layout/loading/error/route handlers)', () => {
    expect(nextRoutePath('app/layout.tsx')).toBeNull()
    expect(nextRoutePath('app/loading.tsx')).toBeNull()
    expect(nextRoutePath('app/error.tsx')).toBeNull()
    expect(nextRoutePath('app/api/hello/route.ts')).toBeNull()
  })
})

describe('nextRoutePath — Pages Router', () => {
  it('maps index + nested + dynamic files', () => {
    expect(nextRoutePath('pages/index.tsx')).toBe('/')
    expect(nextRoutePath('pages/legacy.tsx')).toBe('/legacy')
    expect(nextRoutePath('pages/blog/index.tsx')).toBe('/blog')
    expect(nextRoutePath('pages/users/[id].tsx')).toBe('/users/:id')
    expect(nextRoutePath('pages/shop/[...all].tsx')).toBe('/shop/*')
  })
  it('excludes _app / _document / _error and api', () => {
    expect(nextRoutePath('pages/_app.tsx')).toBeNull()
    expect(nextRoutePath('pages/_document.tsx')).toBeNull()
    expect(nextRoutePath('pages/_error.tsx')).toBeNull()
    expect(nextRoutePath('pages/api/hello.ts')).toBeNull()
  })
})

describe('nextRoutePath — non-routes', () => {
  it('is null for files outside app/ and pages/', () => {
    expect(nextRoutePath('components/Header.tsx')).toBeNull()
    expect(nextRoutePath('lib/utils.ts')).toBeNull()
  })
})
