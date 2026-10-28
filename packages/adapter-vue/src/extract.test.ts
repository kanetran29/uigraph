import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { validateGraph } from '@ui-graph/core'
import { buildProject, buildProjectFromSources, extractGraph } from './extract'
import type { ExtractOptions, SoundinessNote } from '@ui-graph/core'

/** Extract from an in-memory file map (the Vue analogue of the Angular inMemory helper). */
function build(files: Record<string, string>, opts: ExtractOptions = {}) {
  return extractGraph(buildProjectFromSources(files), '/', opts)
}

const ROUTER = (routes: string, imports = '') => `import { createRouter, createWebHistory } from 'vue-router'\n${imports}\nexport const router = createRouter({ history: createWebHistory(), routes: ${routes} })`

describe('extractGraph — sample-vue-app golden (F-vue-adapter)', () => {
  // Snapshotted from examples/sample-vue-app (src/** + package.json) so this golden
  // stays pinned to a known graph shape — examples/sample-vue-app is free to evolve.
  const dir = fileURLToPath(new URL('../test-fixtures/sample-vue-app', import.meta.url))
  const { graph } = extractGraph(buildProject(dir), dir)

  it('satisfies the core invariants', () => {
    expect(validateGraph(graph)).toEqual([])
  })

  it('extracts exactly the declared route nodes', () => {
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(
      new Set(['n_root', 'n_login', 'n_dashboard', 'n_dashboard_settings', 'n_products', 'n_products_id', 'n_checkout', 'n_wildcard']),
    )
    expect(graph.nodes.every((n) => n.kind === 'screen')).toBe(true)
  })

  it('extracts the expected edge count and modality split', () => {
    expect(graph.edges).toHaveLength(10)
    expect(graph.edges.filter((e) => e.modality === 'must')).toHaveLength(6)
    expect(graph.edges.filter((e) => e.modality === 'may')).toHaveLength(4)
  })

  const hasEdge = (from: string, to: string, modality: string) => graph.edges.some((e) => e.from === from && e.to === to && e.modality === modality)
  const findEdge = (from: string, to: string) => graph.edges.find((e) => e.from === from && e.to === to)

  it('emits router-links and router.push into unguarded routes as must-edges', () => {
    expect(hasEdge('n_root', 'n_login', 'must')).toBe(true)
    expect(hasEdge('n_root', 'n_products', 'must')).toBe(true)
    expect(hasEdge('n_dashboard', 'n_products', 'must')).toBe(true)
    expect(hasEdge('n_dashboard', 'n_dashboard_settings', 'must')).toBe(true)
    expect(hasEdge('n_checkout', 'n_root', 'must')).toBe(true)
    expect(hasEdge('n_wildcard', 'n_root', 'must')).toBe(true)
  })

  it('demotes navigations into beforeEnter-guarded routes to may-edges', () => {
    for (const [from, to] of [
      ['n_login', 'n_dashboard'],
      ['n_dashboard_settings', 'n_dashboard'],
      ['n_products_id', 'n_checkout'],
    ] as const) {
      expect(hasEdge(from, to, 'may')).toBe(true)
      expect(findEdge(from, to)?.guard).toContain('authGuard')
    }
  })

  it('over-approximates a v-for :to template literal to a may-edge', () => {
    expect(hasEdge('n_products', 'n_products_id', 'may')).toBe(true)
  })

  it('emits every edge with a static witness + vue ruleId', () => {
    for (const e of graph.edges) {
      expect(e.source).toBe('static')
      expect(e.witness?.ruleId).toMatch(/^vue\./)
    }
  })
})

describe('routes (F-vue-adapter)', () => {
  it('resolves eager + lazy components and nested children with joined paths', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(
        `[{ path: '/', component: Home }, { path: '/dash', component: () => import('./Dash.vue'), children: [{ path: 'kids', component: Kids }] }]`,
        `import Home from './Home.vue'\nimport Kids from './Kids.vue'`,
      ),
      '/src/Home.vue': `<template><p>h</p></template>`,
      '/src/Dash.vue': `<template><p>d</p></template>`,
      '/src/Kids.vue': `<template><p>k</p></template>`,
    })
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_root', 'n_dash', 'n_dash_kids']))
  })

  it('maps a Vue catch-all route to n_wildcard', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(`[{ path: '/:pathMatch(*)*', component: NF }]`, `import NF from './NF.vue'`),
      '/src/NF.vue': `<template><p>x</p></template>`,
    })
    expect(graph.nodes.map((n) => n.id)).toContain('n_wildcard')
  })

  // A relative catch-all inside a parent is that parent's own screen (/admin/*), not the application's root catch-all.
  it('keeps a relative catch-all under a parent route apart from the root catch-all', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(
        `[{ path: '/admin', component: Admin, children: [{ path: ':pathMatch(.*)*', component: AdminMissing }] }, { path: '/:pathMatch(.*)*', component: NF }]`,
        `import Admin from './Admin.vue'\nimport AdminMissing from './AdminMissing.vue'\nimport NF from './NF.vue'`,
      ),
      '/src/Admin.vue': `<template><p>a</p></template>`,
      '/src/AdminMissing.vue': `<template><p>m</p></template>`,
      '/src/NF.vue': `<template><p>x</p></template>`,
    })
    const nested = graph.nodes.find((n) => n.id === 'n_admin_wildcard')
    const root = graph.nodes.find((n) => n.id === 'n_wildcard')
    expect(nested?.route).toBe('/admin/*')
    expect(nested?.componentPath).toBe('src/AdminMissing.vue')
    expect(root?.route).toBe('*')
    expect(root?.componentPath).toBe('src/NF.vue')
  })

  it('folds an absolute catch-all child to the root catch-all, since Vue Router treats it as a root path', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(
        `[{ path: '/admin', component: Admin, children: [{ path: '/:pathMatch(.*)*', component: NF }] }]`,
        `import Admin from './Admin.vue'\nimport NF from './NF.vue'`,
      ),
      '/src/Admin.vue': `<template><p>a</p></template>`,
      '/src/NF.vue': `<template><p>x</p></template>`,
    })
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_admin', 'n_wildcard']))
  })

  it('keeps the prefix before a named catch-all param, so /docs/:rest(.*) is not the root catch-all', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(
        `[{ path: '/docs/:rest(.*)', component: Docs }, { path: '/:pathMatch(.*)*', component: NF }]`,
        `import Docs from './Docs.vue'\nimport NF from './NF.vue'`,
      ),
      '/src/Docs.vue': `<template><p>d</p></template>`,
      '/src/NF.vue': `<template><p>x</p></template>`,
    })
    expect(graph.nodes.find((n) => n.id === 'n_docs_wildcard')?.route).toBe('/docs/*')
    expect(graph.nodes.find((n) => n.id === 'n_wildcard')?.route).toBe('*')
  })

  it('does not flag a redirect-only nested catch-all as an unresolved component', () => {
    const { graph, soundiness } = build({
      '/src/router.ts': ROUTER(
        `[{ path: '/admin', component: Admin, children: [{ path: ':pathMatch(.*)*', redirect: '/admin' }] }]`,
        `import Admin from './Admin.vue'`,
      ),
      '/src/Admin.vue': `<template><p>a</p></template>`,
    })
    expect(graph.nodes.some((n) => n.id === 'n_admin_wildcard')).toBe(true)
    expect(soundiness.filter((s) => s.kind === 'unresolved-component')).toEqual([])
  })

  it('does not flag a redirect-only root catch-all as an unresolved component', () => {
    const { soundiness } = build({
      '/src/router.ts': ROUTER(`[{ path: '/', component: Home }, { path: '/:pathMatch(.*)*', redirect: '/' }]`, `import Home from './Home.vue'`),
      '/src/Home.vue': `<template><p>h</p></template>`,
    })
    expect(soundiness.filter((s) => s.kind === 'unresolved-component')).toEqual([])
  })

  it('declares a redirect-only route as an unmodeled redirect instead of asserting it is a terminal screen', () => {
    const { graph, soundiness } = build({
      '/src/router.ts': ROUTER(`[{ path: '/old', redirect: '/new' }, { path: '/new', component: New }]`, `import New from './New.vue'`),
      '/src/New.vue': `<template><p>n</p></template>`,
    })
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_old', 'n_new']))
    expect(graph.edges).toEqual([])
    expect(soundiness.filter((s) => s.kind === 'unmodeled-redirect').map((s) => s.detail)).toEqual([
      'route /old forwards via `redirect`; the forwarding navigation is not an edge',
    ])
    expect(soundiness.filter((s) => s.kind === 'unresolved-component')).toEqual([])
  })

  // A redirecting record with no children is forwarded before anything renders, so it has no screen, no controls and no outgoing edges.
  it('treats a record declaring both redirect and component as a declared redirect, not a rendered screen', () => {
    const { graph, soundiness } = build(
      {
        '/src/router.ts': ROUTER(`[{ path: '/old', redirect: '/new', component: Old }, { path: '/new', component: New }]`, `import Old from './Old.vue'\nimport New from './New.vue'`),
        '/src/Old.vue': `<template><div><router-link to="/new">go</router-link><button @click="go">Go</button></div></template>\n<script setup>\nimport { useRouter } from 'vue-router'\nconst router = useRouter()\nfunction go(){ router.push('/new') }\n</script>`,
        '/src/New.vue': `<template><p>n</p></template>`,
      },
      { controls: true },
    )
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_old', 'n_new']))
    expect(graph.nodes.find((n) => n.id === 'n_old')?.componentPath).toBeNull()
    expect(graph.edges).toEqual([])
    expect(soundiness.filter((s) => s.kind === 'unmodeled-redirect').map((s) => s.detail)).toEqual([
      'route /old forwards via `redirect`; the forwarding navigation is not an edge',
    ])
  })

  // A redirect fires only when its record is the last match, so a redirecting parent with children still lays out the child it matched.
  it.each([
    ['nested layout', `[{ path: '/admin', component: Layout, redirect: '/admin/users', children: [{ path: 'users', component: Child }] }, { path: '/login', component: Login }]`, 'n_admin', '/admin/users', 'n_admin_users'],
    ['root layout', `[{ path: '/', component: Layout, redirect: '/dashboard', children: [{ path: 'dashboard', component: Child }] }, { path: '/login', component: Login }]`, 'n_root', '/dashboard', 'n_dashboard'],
  ])('keeps the component of a redirecting %s and still declares the redirect', (_, routes, layoutId, link, childId) => {
    const { graph, soundiness } = build(
      {
        '/src/router.ts': ROUTER(routes, `import Layout from './Layout.vue'\nimport Child from './Child.vue'\nimport Login from './Login.vue'`),
        '/src/Layout.vue': `<template><div><router-link to="${link}">go</router-link><button @click="out">Logout</button></div></template>\n<script setup>\nimport { useRouter } from 'vue-router'\nconst router = useRouter()\nfunction out(){ router.push('/login') }\n</script>`,
        '/src/Child.vue': `<template><p>c</p></template>`,
        '/src/Login.vue': `<template><p>l</p></template>`,
      },
      { controls: true },
    )
    const control = graph.nodes.find((n) => n.kind === 'control')
    expect(graph.nodes.find((n) => n.id === layoutId)?.componentPath).toBe('src/Layout.vue')
    expect(control?.label).toBe('Logout')
    expect(new Set(graph.edges.map((e) => `${e.from === control?.id ? 'control' : e.from}->${e.to}:${e.modality}`))).toEqual(
      new Set([`${layoutId}->${childId}:must`, `${layoutId}->n_login:must`, 'control->n_login:must']),
    )
    expect(soundiness.map((s) => s.detail)).toEqual([`route ${layoutId === 'n_root' ? '/' : '/admin'} forwards via \`redirect\`; the forwarding navigation is not an edge`])
  })

  // The layout of a redirecting parent really renders, so when its component cannot be resolved that blind spot is declared beside the redirect.
  it('flags a redirecting parent whose layout component cannot be resolved', () => {
    const { soundiness } = build({
      '/src/router.ts': ROUTER(
        `[{ path: '/admin', component: () => import('./' + name + '.vue'), redirect: '/admin/users', children: [{ path: 'users', component: Users }] }]`,
        `import Users from './Users.vue'\nconst name = 'x'`,
      ),
      '/src/Users.vue': `<template><p>u</p></template>`,
    })
    expect(soundiness.map((s) => s.detail)).toEqual([
      'route /admin forwards via `redirect`; the forwarding navigation is not an edge',
      'route /admin has no resolvable .vue component',
    ])
  })

  // A catch-all that is not a redirect has a screen, so an unresolvable component is a declared blind spot, nested or root.
  it.each([
    ['nested', `[{ path: '/admin', component: Admin, children: [{ path: ':pathMatch(.*)*', component: () => import('./' + name + '.vue') }] }]`, '/admin/*'],
    ['root', `[{ path: '/', component: Admin }, { path: '/:pathMatch(.*)*', component: () => import('./' + name + '.vue') }]`, '*'],
  ])('flags a %s catch-all whose component cannot be resolved', (_, routes, path) => {
    const { soundiness } = build({
      '/src/router.ts': ROUTER(routes, `import Admin from './Admin.vue'\nconst name = 'x'`),
      '/src/Admin.vue': `<template><p>a</p></template>`,
    })
    expect(soundiness.filter((s) => s.kind === 'unresolved-component').map((s) => s.detail)).toEqual([`route ${path} has no resolvable .vue component`])
  })
})

// A tool may lose an edge but never silently: whatever the route collector cannot read it either recovers or declares as a note.
describe('route records the collector reads only in part (F-vue-adapter)', () => {
  const page = (body = '<p>x</p>') => `<template>${body}</template>`
  const details = (soundiness: SoundinessNote[], kind: string) => soundiness.filter((s) => s.kind === kind).map((s) => s.detail)
  const edgeSet = (graph: { edges: { from: string; to: string; modality: string }[] }) => new Set(graph.edges.map((e) => `${e.from}->${e.to}:${e.modality}`))
  const layoutImports = `import Layout from './Layout.vue'\nimport Users from './Users.vue'`

  // The subtree under a `children` that is not an in-place array literal is walked when it resolves to one, and declared when it does not.
  it.each([
    ['a same-file const', `children: kids`, 'kids'],
    ['a shorthand property', `children`, 'children'],
  ])('recovers the subtree of a `children` given as %s', (_, prop, decl) => {
    const { graph, soundiness } = build({
      '/src/router.ts': ROUTER(`[{ path: '/admin', component: Layout, ${prop} }]`, `${layoutImports}\nconst ${decl} = [{ path: 'users', component: Users }]`),
      '/src/Layout.vue': page(),
      '/src/Users.vue': page('<router-link to="/admin">back</router-link>'),
    })
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_admin', 'n_admin_users']))
    expect(edgeSet(graph)).toEqual(new Set(['n_admin_users->n_admin:must']))
    expect(details(soundiness, 'unresolved-route')).toEqual([])
  })

  it.each([
    ['a call', `children: loadKids()`, 'loadKids()'],
    ['an imported array', `children: kids`, 'kids'],
  ])('declares a `children` given as %s that it cannot resolve, instead of dropping the subtree silently', (_, prop, text) => {
    const { graph, soundiness } = build({
      '/src/router.ts': ROUTER(`[{ path: '/admin', component: Layout, ${prop} }]`, `import Layout from './Layout.vue'\nimport { kids } from './kids'\ndeclare function loadKids(): never[]`),
      '/src/kids.ts': `export const kids = []`,
      '/src/Layout.vue': page(),
    })
    expect(graph.nodes.map((n) => n.id)).toEqual(['n_admin'])
    expect(details(soundiness, 'unresolved-route')).toEqual([`children of route /admin ("${text}") could not be resolved to an array of route records — its routes are skipped`])
    expect(soundiness.find((s) => s.kind === 'unresolved-route')?.file).toBe('src/router.ts')
  })

  // A record that folds onto an address an earlier record holds is dropped; its component is never scanned, so the loss is declared.
  it.each([
    [
      'a default child folding onto its parent',
      `[{ path: '/admin', component: Layout, children: [{ path: '', component: Idx }] }, { path: '/reports', component: Reports }]`,
      ['n_admin', 'n_reports'],
      'route record "" resolves to /admin, which an earlier record already claims — this record\'s own component, guards and redirect are dropped (its children are still read); where both records name the same component the address still renders it, so the drop is of the record and not necessarily of a screen',
    ],
    [
      'two catch-alls folding to the root catch-all',
      `[{ path: '/admin', component: Layout }, { path: '/:pathMatch(.*)*', component: Idx }, { path: '*', component: Reports }]`,
      ['n_admin', 'n_wildcard'],
      'route record "*" resolves to *, which an earlier record already claims — this record\'s own component, guards and redirect are dropped (its children are still read); where both records name the same component the address still renders it, so the drop is of the record and not necessarily of a screen',
    ],
  ])('declares the record dropped onto an already-claimed address: %s', (_, routes, nodeIds, detail) => {
    const { graph, soundiness } = build({
      '/src/router.ts': ROUTER(routes, `import Layout from './Layout.vue'\nimport Idx from './Idx.vue'\nimport Reports from './Reports.vue'`),
      '/src/Layout.vue': page(),
      '/src/Idx.vue': page('<router-link to="/reports">r</router-link>'),
      '/src/Reports.vue': page(),
    })
    expect(graph.nodes.map((n) => n.id)).toEqual(nodeIds)
    expect(details(soundiness, 'route-address-collision')).toEqual([detail])
  })

  // The same record reached through two arrays drops nothing, so declaring it would be a false blind spot.
  it('does not declare a collision when the same record is reached twice', () => {
    const { graph, soundiness } = build({
      '/src/router.ts': `import { createRouter, createWebHistory } from 'vue-router'
import Shared from './Shared.vue'
const shared = { path: '/shared', component: Shared }
export const more = [shared]
export const router = createRouter({ history: createWebHistory(), routes: [shared] })`,
      '/src/Shared.vue': page(),
    })
    expect(graph.nodes.map((n) => n.id)).toEqual(['n_shared'])
    expect(details(soundiness, 'route-address-collision')).toEqual([])
    expect(details(soundiness, 'runtime-registered-routes')).toHaveLength(1)
  })

  // `getProperty` cannot see through a spread, so a record built with one is only partly read, and the reader is told.
  it.each([
    ['a redirect', `[{ path: '/old', ...common, component: Old }, { path: '/new', component: New }]`, `const common = { redirect: '/new' }`, '...common'],
    ['the path', `[{ ...base, component: Old }, { path: '/new', component: New }]`, `const base = { path: '/old' }`, '...base'],
  ])('declares a route record that takes %s from a spread', (_, routes, pre, spread) => {
    const { soundiness } = build({
      '/src/router.ts': ROUTER(routes, `import Old from './Old.vue'\nimport New from './New.vue'\n${pre}`),
      '/src/Old.vue': page(),
      '/src/New.vue': page(),
    })
    expect(details(soundiness, 'unresolved-route')).toEqual([`route record spreads "${spread}" — whatever path, component, redirect or children it supplies is not read`])
  })

  // Resolving `children` through an identifier makes a self-containing record reachable (legal with `var`), so the walk must stop and say so rather than overflow the stack.
  it('declares a record that contains itself through its children instead of recursing without end', () => {
    const { graph, soundiness } = build({
      '/src/router.ts': ROUTER(`[{ path: '/a', component: A, children: kids }]`, `import A from './A.vue'\nvar kids = [{ path: 'x', component: A, children: kids }]`),
      '/src/A.vue': page(),
    })
    expect(graph.nodes.map((n) => n.id)).toEqual(['n_a', 'n_a_x'])
    expect(details(soundiness, 'unresolved-route')).toEqual(['route record "x" contains itself through its children — the cycle is not followed'])
  })

  // `children: []` is a property, so the component is kept: addRoute(parentName, child) can fill it at run time and the layout would render around that child.
  it('keeps the component of a redirecting record whose `children` is an empty array', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(`[{ path: '/old', component: Old, redirect: '/new', children: [] }, { path: '/new', component: New }]`, `import Old from './Old.vue'\nimport New from './New.vue'`),
      '/src/Old.vue': page('<router-link to="/new">n</router-link>'),
      '/src/New.vue': page(),
    })
    expect(graph.nodes.find((n) => n.id === 'n_old')?.componentPath).toBe('src/Old.vue')
    expect(edgeSet(graph)).toEqual(new Set(['n_old->n_new:must']))
  })

  // A `path` the walk cannot read is a dropped route and a hole in the declared set, so it is
  // declared: without the note the tool reports a working link as a dead link on its own blind spot.
  it('declares a record whose path is not a string literal, and does not call the link into it dead', () => {
    const { graph, soundiness } = build({
      '/src/router.ts': ROUTER(`[{ path: ADMIN, component: Layout }, { path: '/ok', component: New }]`, `import Layout from './Layout.vue'\nimport New from './New.vue'\nconst ADMIN = '/admin'`),
      '/src/Layout.vue': page(),
      '/src/New.vue': page('<router-link to="/admin">admin</router-link>'),
    })
    expect(graph.nodes.map((n) => n.id)).toEqual(['n_ok'])
    expect(details(soundiness, 'unresolved-route')).toEqual(['route record path "ADMIN" is not a string literal — the record and any children are skipped'])
  })

  it('does not declare a path note for a route object that has no path at all', () => {
    const { soundiness } = build({
      '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { ...mixin }]`, `import A from './A.vue'\nconst mixin = { component: A }`),
      '/src/A.vue': page(),
    })
    expect(details(soundiness, 'unresolved-route').filter((d) => /is not a string literal/.test(d))).toEqual([])
  })
})

describe('runtime-registered route arrays (F-vue-adapter, addRoutes)', () => {
  const CONSTANT_ROUTER = (extra: string) => `import { createRouter, createWebHistory } from 'vue-router'
export const constantRoutes = [{ path: '/', component: () => import('./Home.vue') }]
${extra}
export const router = createRouter({ history: createWebHistory(), routes: constantRoutes })`

  it('collects an exported route array not passed to the constructor, with nested children paths, and flags it', () => {
    const { graph, soundiness } = build({
      '/src/router.ts': CONSTANT_ROUTER(
        `export const asyncRoutes = [{ path: '/admin', component: () => import('./Admin.vue'), children: [{ path: 'users', component: () => import('./Users.vue') }] }]`,
      ),
      '/src/Home.vue': `<template><p>h</p></template>`,
      '/src/Admin.vue': `<template><p>a</p></template>`,
      '/src/Users.vue': `<template><p>u</p></template>`,
    })
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_root', 'n_admin', 'n_admin_users']))
    const notes = soundiness.filter((s) => s.kind === 'runtime-registered-routes')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.detail).toContain('asyncRoutes')
    expect(notes[0]?.detail).toContain('2 route record(s)')
    expect(notes[0]?.file).toBe('src/router.ts')
  })

  it('dedupes runtime-registered routes against constructor routes by full path', () => {
    const { graph } = build({
      '/src/router.ts': CONSTANT_ROUTER(`export const asyncRoutes = [{ path: '/', component: () => import('./Other.vue') }]`),
      '/src/Home.vue': `<template><p>h</p></template>`,
      '/src/Other.vue': `<template><p>o</p></template>`,
    })
    const roots = graph.nodes.filter((n) => n.id === 'n_root')
    expect(roots).toHaveLength(1)
    expect(roots[0]?.componentPath).toBe('src/Home.vue')
  })

  it('follows an identifier element to a route module file via its default export', () => {
    const { graph } = build({
      '/src/router/index.js': `import Router from 'vue-router'
import chartsRouter from './modules/charts'
export const constantRoutes = [{ path: '/', component: () => import('../Home.vue') }]
export const asyncRoutes = [chartsRouter]
const router = new Router({ routes: constantRoutes })
export default router`,
      '/src/router/modules/charts.js': `const chartsRouter = { path: '/charts', component: () => import('../../Charts.vue'), children: [{ path: 'line', component: () => import('../../Line.vue') }] }
export default chartsRouter`,
      '/src/Home.vue': `<template><p>h</p></template>`,
      '/src/Charts.vue': `<template><p>c</p></template>`,
      '/src/Line.vue': `<template><p>l</p></template>`,
    })
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_root', 'n_charts', 'n_charts_line']))
    expect(graph.nodes.find((n) => n.id === 'n_charts_line')?.componentPath).toBe('src/Line.vue')
  })

  it('flags an addRoutes() argument it cannot statically resolve — never silent', () => {
    const { graph, soundiness } = build({
      '/src/router.ts': CONSTANT_ROUTER(''),
      '/src/permission.ts': `import { router } from './router'
export async function setup(store: { dispatch(a: string): Promise<unknown[]> }) {
  const accessRoutes = await store.dispatch('permission/generateRoutes')
  router.addRoutes(accessRoutes)
}`,
      '/src/Home.vue': `<template><p>h</p></template>`,
    })
    expect(graph.nodes.map((n) => n.id)).toEqual(['n_root'])
    const notes = soundiness.filter((s) => s.kind === 'runtime-registered-routes')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.detail).toContain('accessRoutes')
    expect(notes[0]?.file).toBe('src/permission.ts')
  })

  it('does not flag the addRoutes() of an already-collected exported array', () => {
    const { soundiness } = build({
      '/src/router.ts': CONSTANT_ROUTER(`export const asyncRoutes = [{ path: '/a', component: () => import('./Home.vue') }]`),
      '/src/permission.ts': `import { router, asyncRoutes } from './router'\nrouter.addRoutes(asyncRoutes)`,
      '/src/Home.vue': `<template><p>h</p></template>`,
    })
    expect(soundiness.filter((s) => s.kind === 'runtime-registered-routes')).toHaveLength(1)
  })
})

describe('navigation edges (F-vue-adapter)', () => {
  const two = (aTemplate: string, aScript = '') => ({
    '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
    '/src/A.vue': `<template>${aTemplate}</template>\n<script setup>import { useRouter } from 'vue-router'\nconst router = useRouter()\n${aScript}</script>`,
    '/src/B.vue': `<template><p>b</p></template>`,
  })

  it('treats a <router-link to> into an unguarded route as a must-edge', () => {
    const { graph } = build(two('<router-link to="/b">go</router-link>'))
    expect(graph.edges.find((e) => e.to === 'n_b')?.modality).toBe('must')
  })

  it('over-approximates a :to template literal to a may-edge over the prefix', () => {
    const { graph, soundiness } = build({
      '/src/router.ts': ROUTER(`[{ path: '/products', component: A }, { path: '/products/:id', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
      '/src/A.vue': '<template><router-link :to="`/products/${id}`">go</router-link></template>\n<script setup>const id = 1</script>',
      '/src/B.vue': `<template><p>b</p></template>`,
    })
    expect(graph.edges.find((e) => e.to === 'n_products_id')?.modality).toBe('may')
    expect(soundiness.some((s) => s.kind === 'over-approximation')).toBe(true)
  })

  it('resolves a :to="{ name }" object via the route name map', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', name: 'beta', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
      '/src/A.vue': `<template><router-link :to="{ name: 'beta' }">go</router-link></template>`,
      '/src/B.vue': `<template><p>b</p></template>`,
    })
    expect(graph.edges.some((e) => e.to === 'n_b')).toBe(true)
  })

  it('treats router.push into a guarded route as a may-edge with guard text', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', component: B, beforeEnter: authGuard }]`, `import A from './A.vue'\nimport B from './B.vue'\nimport { authGuard } from './auth'`),
      '/src/auth.ts': `export const authGuard = () => {}`,
      '/src/A.vue': `<template><button @click="go">go</button></template>\n<script setup>import { useRouter } from 'vue-router'\nconst router = useRouter()\nfunction go(){ router.push('/b') }</script>`,
      '/src/B.vue': `<template><p>b</p></template>`,
    })
    const e = graph.edges.find((x) => x.to === 'n_b')
    expect(e?.modality).toBe('may')
    expect(e?.guard).toContain('authGuard')
  })

  it('handles Options-API this.$router.push', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
      '/src/A.vue': `<template><button @click="go">go</button></template>\n<script>export default { methods: { go(){ this.$router.push('/b') } } }</script>`,
      '/src/B.vue': `<template><p>b</p></template>`,
    })
    expect(graph.edges.find((e) => e.to === 'n_b')?.modality).toBe('must')
  })

  it('does not mistake Array.push for navigation', () => {
    const { graph } = build(two('<button @click="go">go</button>', `const items = []\nfunction go(){ items.push('/b') }`))
    expect(graph.edges.some((e) => e.to === 'n_b')).toBe(false)
  })

  it('records a fully dynamic push as a dynamic-target note (no edge)', () => {
    const { graph, soundiness } = build(two('<button @click="go">go</button>', `function go(){ router.push(location.hash) }`))
    expect(graph.edges.some((e) => e.to === 'n_b')).toBe(false)
    expect(soundiness.some((s) => s.kind === 'dynamic-target')).toBe(true)
  })

  it('resolves a string-const push target (enum-resolvable, rule E.1)', () => {
    const { graph } = build(two('<button @click="go">go</button>', `const dest = '/b'\nfunction go(){ router.push(dest) }`))
    expect(graph.edges.find((e) => e.to === 'n_b')?.modality).toBe('must')
  })
})

describe('control extraction (F-vue-adapter)', () => {
  const withControls = (template: string, script = '') =>
    build(
      {
        '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
        '/src/A.vue': `<template>${template}</template>\n<script setup>import { useRouter } from 'vue-router'\nconst router = useRouter()\n${script}</script>`,
        '/src/B.vue': `<template><p>b</p></template>`,
      },
      { controls: true },
    )

  const controlsOf = (template: string, script = '') => {
    const { graph } = withControls(template, script)
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const controls = graph.nodes.filter((n) => n.kind === 'control' && n.parent === 'n_a')
    const navTo = (to: string) => graph.edges.find((e) => e.to === to && byId.get(e.from)?.kind === 'control')
    return { controls, navTo, graph }
  }

  it('keeps the route graph all-screen without opts.controls', () => {
    const { graph } = withControls('<button @click="go">x</button>')
    // build() above passed controls:true; assert the no-controls variant separately
    const plain = build({
      '/src/router.ts': ROUTER(`[{ path: '/a', component: A }]`, `import A from './A.vue'`),
      '/src/A.vue': `<template><button @click="go">x</button></template>\n<script setup>function go(){}</script>`,
    })
    expect(plain.graph.nodes.every((n) => n.kind === 'screen')).toBe(true)
    expect(graph.nodes.some((n) => n.kind === 'control')).toBe(true)
  })

  it('selector precedence: testid > role-name > id/name > text > structural', () => {
    expect(controlsOf('<button data-testid="x" @click="go">Save</button>').controls[0]?.control?.selector).toMatchObject({ strategy: 'testid', value: 'x' })
    expect(controlsOf('<button @click="go">Save</button>').controls[0]?.control?.selector).toMatchObject({ strategy: 'role-name', value: 'button|Save' })
    expect(controlsOf('<input id="email" @input="go" />').controls[0]?.control?.selector).toMatchObject({ strategy: 'label', value: 'email' })
    expect(controlsOf('<div @mouseenter="go"></div>').controls[0]?.control?.selector).toMatchObject({ strategy: 'structural', value: 'div' })
  })

  it('nth disambiguates two identical controls into distinct ids', () => {
    const { controls } = controlsOf('<input name="plan" type="radio" /><input name="plan" type="radio" />')
    expect(controls).toHaveLength(2)
    expect(new Set(controls.map((c) => c.id)).size).toBe(2)
  })

  it('traces an @click handler method to a router.push (must when unguarded)', () => {
    expect(controlsOf('<button @click="go">go</button>', `function go(){ router.push('/b') }`).navTo('n_b')?.modality).toBe('must')
  })

  it('traces an inline @click router.push', () => {
    expect(controlsOf(`<button @click="router.push('/b')">go</button>`).navTo('n_b')?.modality).toBe('must')
  })

  it('demotes a conditional handler navigation to may', () => {
    const e = controlsOf('<button @click="go">go</button>', `const ok = true\nfunction go(){ if (ok) router.push('/b') }`).navTo('n_b')
    expect(e?.modality).toBe('may')
    expect(e?.guard).toContain('ok')
  })

  it('captures input constraints and a (submit) form control', () => {
    const { controls } = controlsOf('<form @submit="go"><input type="email" required @input="go" /></form>')
    const input = controls.find((c) => c.control?.controlType === 'input')
    expect(input?.control?.input).toMatchObject({ type: 'email', required: true })
    const form = controls.find((c) => c.control?.controlType === 'form')
    expect(form?.control?.events).toContain('submit')
  })
})
