import { describe, it, expect } from 'vitest'
import { nextRoutePath, classifyAppRoute } from './routes'

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

describe('classifyAppRoute — intercepting routes', () => {
  it('(.) intercepts a sibling segment as a modal at the same level', () => {
    const c = classifyAppRoute('app/feed/(.)photo/[id]/page.tsx')
    expect(c).toEqual({ path: '/feed/photo/:id', kind: 'modal', nodeId: 'n_feed_photo_id__intercept' })
  })
  it('(..) intercepts one level up', () => {
    const c = classifyAppRoute('app/feed/grid/(..)photo/page.tsx')
    expect(c?.path).toBe('/feed/photo')
    expect(c?.kind).toBe('modal')
  })
  it('(...) intercepts from the app root', () => {
    const c = classifyAppRoute('app/dashboard/settings/(...)login/page.tsx')
    expect(c?.path).toBe('/login')
    expect(c?.kind).toBe('modal')
  })
  it('gives the modal a distinct id so it does not collide with the real route at the same URL', () => {
    const real = classifyAppRoute('app/photo/[id]/page.tsx')
    const modal = classifyAppRoute('app/feed/(..)photo/[id]/page.tsx')
    expect(modal?.path).toBe(real?.path)
    expect(modal?.path).toBe('/photo/:id')
    expect(modal?.nodeId).not.toBe(real?.nodeId)
  })
})

describe('classifyAppRoute — parallel routes (@slot)', () => {
  it('emits a slot node with an id encoding parentPath + slot, URL strips the slot', () => {
    const c = classifyAppRoute('app/dashboard/@team/page.tsx')
    expect(c).toEqual({ path: '/dashboard', kind: 'route', nodeId: 'n_dashboard__slot_team' })
  })
  it('keeps the inner route path while still distinguishing slots', () => {
    const members = classifyAppRoute('app/@analytics/views/page.tsx')
    expect(members?.path).toBe('/views')
    expect(members?.nodeId).toBe('n_root__slot_analytics_views')
  })
  it('two pages in the same slot get distinct ids (no collision)', () => {
    const a = classifyAppRoute('app/dashboard/@team/members/page.tsx')
    const b = classifyAppRoute('app/dashboard/@team/settings/page.tsx')
    expect(a?.nodeId).not.toBe(b?.nodeId)
  })
  it('classifies a slot default.tsx (parallel-route fallback) too', () => {
    const c = classifyAppRoute('app/dashboard/@team/default.tsx')
    expect(c?.kind).toBe('route')
    expect(c?.nodeId).toBe('n_dashboard__slot_team')
  })
})

describe('classifyAppRoute — basic + groups still work', () => {
  it('plain page is a screen', () => {
    expect(classifyAppRoute('app/about/page.tsx')).toEqual({ path: '/about', kind: 'screen' })
  })
  it('route group is stripped, screen kind', () => {
    expect(classifyAppRoute('app/(marketing)/pricing/page.tsx')).toEqual({ path: '/pricing', kind: 'screen' })
  })
})
