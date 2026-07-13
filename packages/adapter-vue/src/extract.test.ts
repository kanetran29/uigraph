import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { validateGraph } from '@ui-graph/core'
import { buildProject, buildProjectFromSources, extractGraph } from './extract'
import type { ExtractOptions } from '@ui-graph/core'

/** Extract from an in-memory file map (the Vue analogue of the Angular inMemory helper). */
function build(files: Record<string, string>, opts: ExtractOptions = {}) {
  return extractGraph(buildProjectFromSources(files), '/', opts)
}

const ROUTER = (routes: string, imports = '') => `import { createRouter, createWebHistory } from 'vue-router'\n${imports}\nexport const router = createRouter({ history: createWebHistory(), routes: ${routes} })`

describe('extractGraph — sample-vue-app golden (F-vue-adapter)', () => {
  const dir = fileURLToPath(new URL('../../../examples/sample-vue-app', import.meta.url))
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
