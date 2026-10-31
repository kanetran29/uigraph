import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { extractGraph } from './extract'
import { routeToNodeId as routeId } from './ids'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}
const page = (cls: string, tpl = '<router-outlet></router-outlet>') =>
  `import { Component } from '@angular/core'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '${tpl}' })\nexport class ${cls} {}`

/** The edge from one address to another, by route. */
const edgeOf = (graph: ReturnType<typeof extractGraph>['graph'], from: string, to: string) => graph.edges.find((e) => e.from === routeId(from) && e.to === routeId(to))

describe('the guards a navigation runs', () => {
  const project = inMemory({
    '/app/guards.ts': `export const auth = () => true\nexport const leave = () => true\nexport const load = () => true\nexport const GUARDS = [auth]\nexport function makeGuards() { return [auth] }\nexport class R { resolve() { return null } }`,
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { auth, leave, load, GUARDS, makeGuards, R } from './guards'
import { P } from './p.component'
import { L } from './l.component'
import { F } from './f.component'
export const routes: Routes = [
  { path: 'login', component: L },
  { path: 'app', component: P, canActivate: [auth], children: [{ path: 'one', component: L }, { path: 'two', component: P }] },
  { path: 'item/:id', component: P, canActivate: [auth], children: [{ path: 'a', component: L }, { path: 'b', component: P }] },
  { path: 'always', component: P, canActivate: [auth], runGuardsAndResolvers: 'always', children: [{ path: 'a', component: L }, { path: 'b', component: P }] },
  { path: 'form', component: F, canDeactivate: [leave], children: [{ path: 'step', component: P }] },
  { path: 'data', component: P, resolve: { d: R } },
  { path: 'shared', component: P, resolve: { d: R }, children: [{ path: 'a', component: L }, { path: 'b', component: P }] },
  { path: 'lazy', canLoad: [load], children: [{ path: 'x', component: P }] },
  { path: 'named', component: P, canActivate: GUARDS },
  { path: 'called', component: P, canActivate: makeGuards() },
]`,
    '/app/p.component.ts': page('P'),
    '/app/l.component.ts': page('L', '<a routerLink="/app/two">t</a><a routerLink="../b">b</a><a routerLink="/data">d</a><a routerLink="/lazy/x">x</a><a routerLink="/named">n</a><a routerLink="/called">c</a>'),
    '/app/f.component.ts': page('F', '<a routerLink="/login">l</a><a routerLink="step">s</a><router-outlet></router-outlet>'),
  })
  const { graph } = extractGraph(project, '/app')

  it('runs a canActivate the navigation enters, and not one on a route both screens are under', () => {
    expect(edgeOf(graph, '/login', '/app/two')?.modality).toBe('may')
    expect(edgeOf(graph, '/login', '/app/two')?.guard).toContain('auth')
    expect(edgeOf(graph, '/app/one', '/app/two')?.modality).toBe('must')
  })

  it("runs a shared route's canActivate again when its parameters can change or it asks to always run", () => {
    expect(edgeOf(graph, '/item/:id/a', '/item/:id/b')?.modality).toBe('may')
    expect(edgeOf(graph, '/always/a', '/always/b')?.modality).toBe('may')
  })

  it('runs canDeactivate on the route the navigation leaves, and not when it stays under it', () => {
    expect(edgeOf(graph, '/form', '/login')?.modality).toBe('may')
    expect(edgeOf(graph, '/form', '/login')?.guard).toContain('leave')
    expect(edgeOf(graph, '/form', '/form/step')?.modality).toBe('must')
  })

  it('awaits the resolvers of a route the navigation enters, and not those of one it reuses', () => {
    expect(edgeOf(graph, '/login', '/data')?.modality).toBe('may')
    expect(edgeOf(graph, '/shared/a', '/shared/b')?.modality).toBe('must')
  })

  it('runs canLoad on a lazy route the navigation enters', () => {
    expect(edgeOf(graph, '/login', '/lazy/x')?.modality).toBe('may')
  })

  it('reads a guard list given by name, and gates on one it cannot read', () => {
    expect(edgeOf(graph, '/login', '/named')?.guard).toContain('auth')
    expect(edgeOf(graph, '/login', '/called')?.modality).toBe('may')
    expect(edgeOf(graph, '/login', '/called')?.guard).toContain('makeGuards()')
  })
})

describe('screens the router never shows at their own address', () => {
  it('holds the edges of a screen a sibling redirect answers at may, also per screen of an anchor', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { C } from './c.component'\nimport { W } from './w.component'\nexport const routes: Routes = [{ path: '', redirectTo: '/w', pathMatch: 'full' }, { path: '', component: C, children: [{ path: 'w', component: W }, { path: 'v', component: W }] }]`,
      '/app/c.component.ts': page('C', '<a routerLink="/v">v</a><router-outlet></router-outlet>'),
      '/app/w.component.ts': page('W', '<p>w</p>'),
    }), '/app', { attribution: true })
    const toV = graph.edges.filter((e) => e.to === routeId('/v'))
    expect(toV.find((e) => e.from === routeId('/'))?.modality).toBe('may')
    expect(toV.find((e) => e.from === routeId('/w'))?.modality).toBe('must')
  })

  it('follows the first redirect declared at an address, and holds an address a sibling redirect shadows at may', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { H } from './h.component'\nimport { X } from './x.component'\nexport const routes: Routes = [{ path: 'home', component: H }, { path: 'x', component: X }, { path: 'y', component: X }, { path: 'old', redirectTo: '/x' }, { path: 'old', redirectTo: '/y' }, { path: 'a', redirectTo: '/x', pathMatch: 'full' }, { path: 'a', component: X, children: [{ path: '', redirectTo: 'b', pathMatch: 'full' }, { path: 'b', component: X }] }]`,
      '/app/h.component.ts': page('H', '<a routerLink="/old">o</a><a routerLink="/a">a</a>'),
      '/app/x.component.ts': page('X'),
    }), '/app')
    expect(edgeOf(graph, '/home', '/x')?.modality).toBe('must')
    expect(edgeOf(graph, '/home', '/y')).toBeUndefined()
    expect(graph.edges.filter((e) => e.from === routeId('/home') && e.to !== routeId('/x')).every((e) => e.modality === 'may')).toBe(true)
  })
})
