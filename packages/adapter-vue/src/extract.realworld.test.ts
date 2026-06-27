import { describe, it, expect } from 'vitest'
import { validateGraph } from '@uigraph/core'
import { buildProjectFromSources, extractGraph } from './extract'
import type { ExtractOptions } from '@uigraph/core'

/** Extract from an in-memory file map. */
function build(files: Record<string, string>, opts: ExtractOptions = {}) {
  return extractGraph(buildProjectFromSources(files), '/', opts)
}

const ROUTER = (routes: string, imports = '') =>
  `import { createRouter, createWebHistory } from 'vue-router'\n${imports}\nexport const router = createRouter({ history: createWebHistory(), routes: ${routes} })`

// vue-router-function-body: routes nested inside a factory function that returns new Router({ routes }).
describe('route factory function bodies (F-vue-adapter)', () => {
  it('extracts routes from `new Router({ routes: [...] })` inside a returning function', () => {
    const { graph } = build({
      '/src/router/index.js': `import Router from 'vue-router'\nimport Home from '../views/Home.vue'\nimport Item from '../views/Item.vue'\nexport function createRouter () {\n  return new Router({\n    mode: 'history',\n    routes: [\n      { path: '/', component: Home },\n      { path: '/item/:id', component: Item },\n    ],\n  })\n}`,
      '/src/views/Home.vue': `<template><router-link to="/item/1">go</router-link></template>`,
      '/src/views/Item.vue': `<template><p>i</p></template>`,
    })
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(ids.has('n_root')).toBe(true)
    expect(ids.has('n_item_id')).toBe(true)
  })
})

// Component resolution: `@/` src-alias imports and lazy-import factory consts.
describe('component resolution (F-vue-adapter)', () => {
  it('resolves an @/ aliased lazy component and scans its template', () => {
    const { graph } = build({
      '/src/router/index.ts': `import { createRouter, createWebHistory } from 'vue-router'\nexport const router = createRouter({ history: createWebHistory(), routes: [{ path: '/', name: 'home', component: () => import('@/views/Home') }, { path: '/b', component: () => import('@/views/B') }] })`,
      '/src/views/Home.vue': `<template><router-link to="/b">go</router-link></template>`,
      '/src/views/B.vue': `<template><p>b</p></template>`,
    })
    expect(graph.nodes.find((n) => n.id === 'n_root')?.componentPath).toContain('Home.vue')
    expect(graph.edges.some((e) => e.from === 'n_root' && e.to === 'n_b')).toBe(true)
  })

  it('resolves a route `component: LocalConst` bound to a lazy-import arrow', () => {
    const { graph } = build({
      '/src/router/index.js': `import Router from 'vue-router'\nconst ItemView = () => import('../views/Item.vue')\nexport function createRouter () {\n  return new Router({ routes: [{ path: '/', component: Home }, { path: '/item/:id', component: ItemView }] })\n}\nimport Home from '../views/Home.vue'`,
      '/src/views/Home.vue': `<template><p>h</p></template>`,
      '/src/views/Item.vue': `<template><p>i</p></template>`,
    })
    expect(graph.nodes.find((n) => n.id === 'n_item_id')?.componentPath).toContain('Item.vue')
  })
})

// vue-parameterized-route-objects-with-non-literals: { name, params:{dynamic} } and { name: ternary }.
describe('parameterized route objects (F-vue-adapter)', () => {
  it('resolves { name, params: { dynamic } } to the named route (may, over-approx for params)', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(
        `[{ path: '/a', component: A }, { path: '/profile/:username', name: 'profile', component: P }]`,
        `import A from './A.vue'\nimport P from './P.vue'`,
      ),
      '/src/A.vue': `<template><button @click="go">go</button></template>\n<script setup>import { useRouter } from 'vue-router'\nconst router = useRouter()\nconst username = 'x'\nfunction go(){ router.push({ name: 'profile', params: { username } }) }</script>`,
      '/src/P.vue': `<template><p>p</p></template>`,
    })
    expect(graph.edges.some((e) => e.to === 'n_profile_username')).toBe(true)
  })

  it('resolves { name: cond ? a : b } to both named routes', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(
        `[{ path: '/a', component: A }, { path: '/login', name: 'login', component: L }, { path: '/register', name: 'register', component: R }]`,
        `import A from './A.vue'\nimport L from './L.vue'\nimport R from './R.vue'`,
      ),
      '/src/A.vue': `<template><button @click="go">go</button></template>\n<script setup>import { useRouter } from 'vue-router'\nconst router = useRouter()\nconst flag = true\nfunction go(){ router.push({ name: flag ? 'login' : 'register' }) }</script>`,
      '/src/L.vue': `<template><p>l</p></template>`,
      '/src/R.vue': `<template><p>r</p></template>`,
    })
    expect(graph.edges.some((e) => e.to === 'n_login')).toBe(true)
    expect(graph.edges.some((e) => e.to === 'n_register')).toBe(true)
  })
})

// vue-computed-property-bindings-in-templates: :to="computedRef" where computed returns { name }.
describe('computed property :to bindings (F-vue-adapter)', () => {
  it('resolves :to="computed" whose body returns { name } to the named route', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(
        `[{ path: '/a', component: A }, { path: '/profile/:username', name: 'profile', component: P }]`,
        `import A from './A.vue'\nimport P from './P.vue'`,
      ),
      '/src/A.vue': `<template><router-link :to="link">x</router-link></template>\n<script setup>import { computed } from 'vue'\nconst username = 'x'\nconst link = computed(() => ({ name: 'profile', params: { username } }))</script>`,
      '/src/P.vue': `<template><p>p</p></template>`,
    })
    expect(graph.edges.some((e) => e.to === 'n_profile_username')).toBe(true)
  })
})

// vue-applink-custom-component-not-recognized + vue-bound-routing-props.
describe('custom router-link wrappers (F-vue-adapter)', () => {
  const appLinkRouter = (aTemplate: string) => ({
    '/src/router.ts': ROUTER(
      `[{ path: '/a', component: A }, { path: '/article/:slug', name: 'article', component: Art }, { path: '/tag/:tag', name: 'tag', component: T }]`,
      `import A from './A.vue'\nimport Art from './Art.vue'\nimport T from './T.vue'`,
    ),
    '/src/components/AppLink.vue': `<template><router-link v-bind="$props"><slot /></router-link></template>\n<script setup>defineProps({ name: String, params: Object })</script>`,
    '/src/A.vue': `<template>${aTemplate}</template>\n<script setup>import AppLink from './components/AppLink.vue'\nconst slug = 'x'</script>`,
    '/src/Art.vue': `<template><p>art</p></template>`,
    '/src/T.vue': `<template><p>t</p></template>`,
  })

  it('recognizes a custom AppLink with name="literal" and emits an edge', () => {
    const { graph } = build(appLinkRouter(`<AppLink name="article" :params="{ slug }">go</AppLink>`))
    expect(graph.edges.some((e) => e.to === 'n_article_slug')).toBe(true)
  })

  it('does not invent edges for a custom AppLink with a fully dynamic :name', () => {
    const { graph, soundiness } = build(appLinkRouter(`<AppLink :name="link.routeName" :params="link.routeParams">go</AppLink>`))
    expect(graph.edges.filter((e) => e.from === 'n_a')).toHaveLength(0)
    expect(soundiness.some((s) => s.kind === 'dynamic-target')).toBe(true)
  })
})

// vue-navigations-in-child-components: navs declared in imported child components attribute to parent route.
describe('child-component navigations (F-vue-adapter)', () => {
  it('attributes a router.push in an imported child to the parent route node', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/login', name: 'login', component: L }]`, `import A from './A.vue'\nimport L from './L.vue'`),
      '/src/A.vue': `<template><Meta :article="article" /></template>\n<script setup>import Meta from './Meta.vue'\nconst article = {}</script>`,
      '/src/Meta.vue': `<template><button @click="fav">fav</button></template>\n<script setup>import { useRouter } from 'vue-router'\nconst router = useRouter()\nfunction fav(){ router.push({ name: 'login' }) }</script>`,
      '/src/L.vue': `<template><p>l</p></template>`,
    })
    expect(graph.edges.some((e) => e.from === 'n_a' && e.to === 'n_login')).toBe(true)
  })

  it('attributes a child <router-link> to the parent route node', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
      '/src/A.vue': `<template><Child /></template>\n<script setup>import Child from './Child.vue'</script>`,
      '/src/Child.vue': `<template><router-link to="/b">go</router-link></template>`,
      '/src/B.vue': `<template><p>b</p></template>`,
    })
    expect(graph.edges.some((e) => e.from === 'n_a' && e.to === 'n_b')).toBe(true)
  })
})

// vue-child-undedup-1 / vue-edge-count-disparity / vue-duplicate-edges-same-event:
// a parent rendering a child that itself <router-link>s must not double-count the nav,
// and a generic `:name` prop on an arbitrary child must not fan out to every named route.
describe('child over-extraction / duplicate dedup (F-vue-adapter)', () => {
  // VTag-style: parent renders <Tag :name="t" /> (generic string prop, NOT a routing
  // name) and Tag.vue internally <router-link :to="{ name: 'tag' }">. The real nav is
  // the child's router-link; the parent's `:name` is not routing.
  const tagRouter = {
    '/src/router.ts': ROUTER(
      `[{ path: '/', name: 'home', component: A }, { path: '/tag/:tag', name: 'tag', component: T }, { path: '/login', name: 'login', component: L }]`,
      `import A from './A.vue'\nimport T from './T.vue'\nimport L from './L.vue'`,
    ),
    '/src/A.vue': `<template><Tag v-for="t in tags" :name="t" :key="t" /></template>\n<script setup>import Tag from './components/Tag.vue'\nconst tags = []</script>`,
    '/src/components/Tag.vue': `<template><router-link :to="link">{{ name }}</router-link></template>\n<script setup>import { computed } from 'vue'\nconst props = defineProps({ name: String })\nconst link = computed(() => ({ name: 'tag', params: { tag: props.name } }))</script>`,
    '/src/T.vue': `<template><p>t</p></template>`,
    '/src/L.vue': `<template><p>l</p></template>`,
  }

  it('does not fan a generic :name prop out to every named route', () => {
    const { graph } = build(tagRouter)
    const targets = graph.edges.filter((e) => e.from === 'n_root').map((e) => e.to)
    expect(targets).not.toContain('n_login')
    expect(targets).toContain('n_tag_tag')
  })

  it('counts a parent->child nav exactly once per (from,to,event)', () => {
    const { graph } = build(tagRouter)
    const tagEdges = graph.edges.filter((e) => e.from === 'n_root' && e.to === 'n_tag_tag' && e.event === 'click:router-link')
    expect(tagEdges).toHaveLength(1)
  })

  it('keeps a real <router-link to="literal"> in a child as a single edge', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
      '/src/A.vue': `<template><Child /></template>\n<script setup>import Child from './Child.vue'</script>`,
      '/src/Child.vue': `<template><router-link to="/b">go</router-link></template>`,
      '/src/B.vue': `<template><p>b</p></template>`,
    })
    const bEdges = graph.edges.filter((e) => e.from === 'n_a' && e.to === 'n_b')
    expect(bEdges).toHaveLength(1)
  })
})

// Golden invariant: dynamic concat / template-string targets never invent edges into a missing route.
describe('soundness on truly-dynamic targets (F-vue-adapter)', () => {
  it('does not invent edges for :to string concat over an empty candidate set', () => {
    const { graph } = build({
      '/src/router.ts': ROUTER(`[{ path: '/', component: A }]`, `import A from './A.vue'`),
      '/src/A.vue': `<template><router-link :to="'/' + type + '/' + (page - 1)">go</router-link></template>\n<script setup>const type = 'top'\nconst page = 2</script>`,
    })
    expect(validateGraph(graph)).toEqual([])
  })
})
