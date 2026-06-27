import { describe, it, expect } from 'vitest'
import { validateGraph } from '@uigraph/core'
import { buildProjectFromSources, extractGraph } from './extract'
import type { ExtractOptions } from '@uigraph/core'

/** Extract from an in-memory file map (self-contained; no cloned apps). */
function build(files: Record<string, string>, opts: ExtractOptions = {}) {
  return extractGraph(buildProjectFromSources(files), '/', opts)
}

const ROUTER = (routes: string, imports = '') =>
  `import { createRouter, createWebHistory } from 'vue-router'\n${imports}\nexport const router = createRouter({ history: createWebHistory(), routes: ${routes} })`

// Rule E.1 — useRouter()/useRoute() + router.push/replace with literal or
// enum-resolvable targets (const PATHS = {...} / string const), depth-limited.
describe('E.1 enum-resolvable router.push targets (F-vue-adapter)', () => {
  const two = (script: string) => ({
    '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', name: 'beta', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
    '/src/A.vue': `<template><button @click="go">go</button></template>\n<script setup>import { useRouter } from 'vue-router'\nconst router = useRouter()\n${script}</script>`,
    '/src/B.vue': `<template><p>b</p></template>`,
  })

  it('resolves a const-object member (PATHS.b) to its route', () => {
    const { graph } = build(two(`const PATHS = { b: '/b' }\nfunction go(){ router.push(PATHS.b) }`))
    expect(graph.edges.find((e) => e.to === 'n_b')?.modality).toBe('must')
  })

  it('resolves a const-object member used as a name ({ name: NAMES.beta })', () => {
    const { graph } = build(two(`const NAMES = { beta: 'beta' }\nfunction go(){ router.push({ name: NAMES.beta }) }`))
    expect(graph.edges.some((e) => e.to === 'n_b')).toBe(true)
  })

  it('resolves a bare string-const replace target', () => {
    const { graph } = build(two(`const DEST = '/b'\nfunction go(){ router.replace(DEST) }`))
    expect(graph.edges.find((e) => e.to === 'n_b')?.effect).toBe('router.replace')
  })

  it('leaves a runtime-valued member dynamic (no invented edge)', () => {
    const { graph, soundiness } = build(two(`const conf = { dest: location.hash }\nfunction go(){ router.push(conf.dest) }`))
    expect(graph.edges.some((e) => e.to === 'n_b')).toBe(false)
    expect(soundiness.some((s) => s.kind === 'dynamic-target')).toBe(true)
  })

  it('stops at MAX_DEPTH instead of recursing unbounded (deep const chain stays dynamic)', () => {
    const { graph } = build(two(`const a = b\nconst b = c\nconst c = d\nconst d = '/b'\nfunction go(){ router.push(a) }`))
    expect(graph.edges.some((e) => e.to === 'n_b')).toBe(false)
  })

  it('a self-referential const cycle does not loop forever', () => {
    const { graph } = build(two(`const a = a\nfunction go(){ router.push(a) }`))
    expect(graph.edges.some((e) => e.to === 'n_b')).toBe(false)
    expect(validateGraph(graph)).toEqual([])
  })
})

// Project-local navigation wrapper (the realworld `routerPush(name, params)` helper
// in mutoe_vue3-realworld-example-app/src/router.ts -> router.push({ name })).
describe('E.1 router wrapper functions (F-vue-adapter)', () => {
  const withWrapper = (aScript: string) => ({
    '/src/router.ts': `${ROUTER(`[{ path: '/a', component: A }, { path: '/b', name: 'beta', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`)}\nexport function routerPush(name, params){ return params === undefined ? router.push({ name }) : router.push({ name, params }) }`,
    '/src/A.vue': `<template><button @click="go">go</button></template>\n<script setup>import { routerPush } from 'src/router'\n${aScript}</script>`,
    '/src/B.vue': `<template><p>b</p></template>`,
  })

  it('resolves routerPush("beta") through the name-forwarding wrapper', () => {
    const { graph } = build(withWrapper(`function go(){ routerPush('beta') }`))
    const e = graph.edges.find((x) => x.to === 'n_b')
    expect(e?.modality).toBe('must')
    expect(e?.witness?.ruleId).toBe('vue.router-wrapper')
  })

  it('over-approximates a branching wrapper name to both routes', () => {
    const { graph } = build({
      '/src/router.ts': `${ROUTER(`[{ path: '/a', component: A }, { path: '/login', name: 'login', component: L }, { path: '/register', name: 'register', component: R }]`, `import A from './A.vue'\nimport L from './L.vue'\nimport R from './R.vue'`)}\nexport function routerPush(name){ return router.push({ name }) }`,
      '/src/A.vue': `<template><button @click="go">go</button></template>\n<script setup>import { routerPush } from 'src/router'\nconst flag = true\nfunction go(){ routerPush(flag ? 'login' : 'register') }</script>`,
      '/src/L.vue': `<template><p>l</p></template>`,
      '/src/R.vue': `<template><p>r</p></template>`,
    })
    expect(graph.edges.some((e) => e.to === 'n_login')).toBe(true)
    expect(graph.edges.some((e) => e.to === 'n_register')).toBe(true)
  })

  it('leaves a dynamic wrapper name dynamic (no invented edge)', () => {
    const { graph } = build(withWrapper(`function go(name){ routerPush(name) }`))
    expect(graph.edges.some((e) => e.to === 'n_b')).toBe(false)
  })
})

// Rule E.4 — router.push/replace inside event handlers (inline + traced + wrapper).
describe('E.4 router navigations in event handlers (F-vue-adapter)', () => {
  const controlsBuild = (template: string, script = '') =>
    build(
      {
        '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', name: 'beta', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
        '/src/A.vue': `<template>${template}</template>\n<script setup>import { useRouter } from 'vue-router'\nconst router = useRouter()\n${script}</script>`,
        '/src/B.vue': `<template><p>b</p></template>`,
      },
      { controls: true },
    )
  const navFromControl = (g: ReturnType<typeof controlsBuild>['graph'], to: string) => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]))
    return g.edges.find((e) => e.to === to && byId.get(e.from)?.kind === 'control')
  }

  it('traces an inline @click router.push({ name }) object', () => {
    const { graph } = controlsBuild(`<button @click="router.push({ name: 'beta' })">go</button>`)
    expect(navFromControl(graph, 'n_b')?.modality).toBe('must')
  })

  it('traces an inline @click router.push(PATHS.b) const member', () => {
    const { graph } = controlsBuild(`<button @click="router.push(PATHS.b)">go</button>`, `const PATHS = { b: '/b' }`)
    expect(navFromControl(graph, 'n_b')).toBeDefined()
  })

  it('traces a wrapper call directly in @click', () => {
    const { graph } = build(
      {
        '/src/router.ts': `${ROUTER(`[{ path: '/a', component: A }, { path: '/b', name: 'beta', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`)}\nexport function routerPush(name){ return router.push({ name }) }`,
        '/src/A.vue': `<template><button @click="routerPush('beta')">go</button></template>\n<script setup>import { routerPush } from 'src/router'</script>`,
        '/src/B.vue': `<template><p>b</p></template>`,
      },
      { controls: true },
    )
    expect(navFromControl(graph, 'n_b')).toBeDefined()
  })
})

// Modal close + dismiss-then-navigate: a ref/state semantically named like a modal
// set to false emits a close:modal self-edge; a navigation in the same handler is
// preserved (multiple edges allowed), with stable ids.
describe('modal close + dismiss-then-navigate (F-vue-adapter)', () => {
  const modalBuild = (template: string, script: string) =>
    build(
      {
        '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
        '/src/A.vue': `<template>${template}</template>\n<script setup>import { ref } from 'vue'\nimport { useRouter } from 'vue-router'\nconst router = useRouter()\n${script}</script>`,
        '/src/B.vue': `<template><p>b</p></template>`,
      },
      { controls: true },
    )

  it('emits a close:modal self-edge when a modal ref is set to false', () => {
    const { graph } = modalBuild(`<button @click="close">x</button>`, `const showModal = ref(true)\nfunction close(){ showModal.value = false }`)
    const e = graph.edges.find((x) => x.event === 'close:modal')
    expect(e).toBeDefined()
    expect(e?.to).toBe('n_a')
    expect(e?.from).toMatch(/^c_n_a__/)
    expect(e?.witness?.ruleId).toBe('vue.modal-close')
  })

  it('emits BOTH a close:modal and a navigate edge for dismiss-then-navigate', () => {
    const { graph } = modalBuild(`<button @click="confirm">ok</button>`, `const isDialogOpen = ref(true)\nfunction confirm(){ isDialogOpen.value = false\n  router.push('/b') }`)
    const close = graph.edges.find((x) => x.event === 'close:modal')
    const nav = graph.edges.find((x) => x.to === 'n_b' && x.event === 'click')
    expect(close).toBeDefined()
    expect(nav).toBeDefined()
  })

  it('detects a state.modal = false property assignment', () => {
    const { graph } = modalBuild(`<button @click="close">x</button>`, `const state = { modalVisible: true }\nfunction close(){ state.modalVisible = false }`)
    expect(graph.edges.some((e) => e.event === 'close:modal')).toBe(true)
  })

  it('does not fire on a non-modal boolean set to false', () => {
    const { graph } = modalBuild(`<button @click="off">x</button>`, `const loading = ref(true)\nfunction off(){ loading.value = false }`)
    expect(graph.edges.some((e) => e.event === 'close:modal')).toBe(false)
  })

  it('demotes a guarded modal close to a may-edge', () => {
    const { graph } = modalBuild(`<button @click="close">x</button>`, `const showModal = ref(true)\nconst dirty = false\nfunction close(){ if (!dirty) showModal.value = false }`)
    const e = graph.edges.find((x) => x.event === 'close:modal')
    expect(e?.modality).toBe('may')
  })

  it('keeps the close:modal edge id stable and graph valid', () => {
    const { graph } = modalBuild(`<button @click="close">x</button>`, `const showModal = ref(true)\nfunction close(){ showModal.value = false }`)
    expect(validateGraph(graph)).toEqual([])
    const a = build(
      {
        '/src/router.ts': ROUTER(`[{ path: '/a', component: A }, { path: '/b', component: B }]`, `import A from './A.vue'\nimport B from './B.vue'`),
        '/src/A.vue': `<template><button @click="close">x</button></template>\n<script setup>import { ref } from 'vue'\nimport { useRouter } from 'vue-router'\nconst router = useRouter()\nconst showModal = ref(true)\nfunction close(){ showModal.value = false }</script>`,
        '/src/B.vue': `<template><p>b</p></template>`,
      },
      { controls: true },
    ).graph.edges.find((e) => e.event === 'close:modal')?.id
    expect(graph.edges.find((e) => e.event === 'close:modal')?.id).toBe(a)
  })
})
