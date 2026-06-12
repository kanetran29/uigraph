import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { Project } from 'ts-morph'
import { validateGraph } from '@uigraph/core'
import { buildProject, extractGraph } from './extract'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

describe('extractGraph — sample-angular-app golden (M3)', () => {
  const dir = fileURLToPath(new URL('../../../examples/sample-angular-app', import.meta.url))
  const { graph, soundiness } = extractGraph(buildProject(dir), dir)

  it('produces a graph that satisfies the core invariants', () => {
    expect(validateGraph(graph)).toEqual([])
  })

  it('extracts exactly the declared route nodes', () => {
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(
      new Set(['n_root', 'n_login', 'n_dashboard', 'n_dashboard_settings', 'n_products', 'n_products_id', 'n_checkout', 'n_wildcard']),
    )
  })

  it('extracts the expected edge count and modality split', () => {
    expect(graph.edges).toHaveLength(11)
    expect(graph.edges.filter((e) => e.modality === 'must')).toHaveLength(6)
    expect(graph.edges.filter((e) => e.modality === 'may')).toHaveLength(5)
  })

  const hasEdge = (from: string, to: string, modality: string): boolean =>
    graph.edges.some((e) => e.from === from && e.to === to && e.modality === modality)

  const findEdge = (from: string, to: string) => graph.edges.find((e) => e.from === from && e.to === to)

  it('emits literal navigations into unguarded routes as must-edges', () => {
    expect(hasEdge('n_root', 'n_login', 'must')).toBe(true)
    expect(hasEdge('n_root', 'n_products', 'must')).toBe(true)
    expect(hasEdge('n_dashboard', 'n_products', 'must')).toBe(true)
    expect(hasEdge('n_dashboard', 'n_root', 'must')).toBe(true)
    expect(hasEdge('n_checkout', 'n_root', 'must')).toBe(true)
    expect(hasEdge('n_wildcard', 'n_root', 'must')).toBe(true)
  })

  it('emits navigations into canActivate-guarded routes as may-edges with AuthGuard text', () => {
    for (const [from, to] of [
      ['n_login', 'n_dashboard'],
      ['n_dashboard', 'n_dashboard_settings'],
      ['n_dashboard_settings', 'n_dashboard'],
      ['n_products_id', 'n_checkout'],
    ] as const) {
      expect(hasEdge(from, to, 'may')).toBe(true)
      expect(findEdge(from, to)?.guard).toContain('AuthGuard')
      expect(findEdge(from, to)?.confidence).toBe(0.6)
    }
  })

  it('over-approximates a bound [routerLink] target to a may-edge', () => {
    expect(hasEdge('n_products', 'n_products_id', 'may')).toBe(true)
    expect(findEdge('n_products', 'n_products_id')?.guard).toBeNull()
    expect(soundiness.some((s) => s.kind === 'over-approximation')).toBe(true)
  })

  it('emits exactly the five expected may-edges', () => {
    const may = graph.edges
      .filter((e) => e.modality === 'may')
      .map((e) => `${e.from}->${e.to}`)
      .sort()
    expect(may).toEqual(
      [
        'n_dashboard->n_dashboard_settings',
        'n_dashboard_settings->n_dashboard',
        'n_login->n_dashboard',
        'n_products->n_products_id',
        'n_products_id->n_checkout',
      ].sort(),
    )
  })

  it('emits every edge with a static witness and a ruleId', () => {
    for (const e of graph.edges) {
      expect(e.source).toBe('static')
      expect(e.witness?.source).toBe('static')
      expect(e.witness?.ruleId).toMatch(/^ng\./)
    }
  })
})

describe('extractGraph — in-memory units (M3)', () => {
  it('treats a routerLink into an unguarded route as a must-edge', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(graph.edges.find((x) => x.to === 'n_b')?.modality).toBe('must')
  })

  it('treats a navigate into a canActivate-guarded route as a may-edge with guard text', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [AuthGuard] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ standalone: true, template: '<p>a</p>' })\nexport class A { constructor(private router: Router){} go(){ this.router.navigate(['/b']) } }`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    const e = graph.edges.find((x) => x.to === 'n_b')
    expect(e?.modality).toBe('may')
    expect(e?.guard).toContain('AuthGuard')
  })

  it('over-approximates a bound [routerLink] concat to a may-edge over the prefix', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'products', component: A }, { path: 'products/:id', component: B }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a [routerLink]="\\'/products/\\' + id">go</a>' })\nexport class A { id = '1' }`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(graph.edges.find((x) => x.to === 'n_products_id')?.modality).toBe('may')
    expect(soundiness.some((s) => s.kind === 'over-approximation')).toBe(true)
  })
})
