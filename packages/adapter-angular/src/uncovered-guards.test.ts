// Tests for the guard rules the demotion-rule sweep found no test for: deleting each of them
// left the suite green. Every case pins one rule; the comment names the mutant it kills.
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
const edgeOf = (graph: ReturnType<typeof extractGraph>['graph'], from: string, to: string) =>
  graph.edges.find((e) => e.from === routeId(from) && e.to === routeId(to))
const guardsOn = (guard: string | null | undefined) => (guard ?? '').split(',').filter((g) => g !== '')

describe('an outlet the target opens by matching an empty path', () => {
  /** Routes where /c opens an empty-path route on the `side` outlet that declares `side`. */
  const opening = (side: string, link = '/c') => extractGraph(inMemory({
    '/app/guards.ts': `export const gate = () => true\nexport class R { resolve() { return 1 } }`,
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { gate, R } from './guards'
import { H } from './h.component'
import { A } from './a.component'
import { Pop } from './pop.component'
export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'c', children: [{ path: '', component: H }, { path: 'x', component: H }, { path: '', outlet: 'side', component: Pop, ${side} }] },
]`,
    '/app/h.component.ts': page('H'),
    '/app/pop.component.ts': page('Pop'),
    '/app/a.component.ts': page('A', `<a routerLink="${link}">l</a>`),
  }), '/app').graph

  it('runs its canMatch', () => {
    // 140: opening canMatch dropped
    expect(guardsOn(edgeOf(opening('canMatch: [gate]'), '/a', '/c')?.guard)).toContain('gate')
  })
  it('runs its canActivateChild', () => {
    // 142: opening canActivateChild dropped
    expect(guardsOn(edgeOf(opening('canActivateChild: [gate]'), '/a', '/c')?.guard)).toContain('gate')
  })
  it('runs its canLoad', () => {
    // 143: opening canLoad dropped
    expect(guardsOn(edgeOf(opening('canLoad: [gate]'), '/a', '/c')?.guard)).toContain('gate')
  })
  it('awaits its resolver', () => {
    // 144: opening resolver dropped
    const e = edgeOf(opening('resolve: { r: R }'), '/a', '/c')
    expect(e?.modality).toBe('may')
    expect(guardsOn(e?.guard)).toEqual([])
  })
  it('opens it for an address below the mount as well', () => {
    // 138: opening at the exact mount only
    expect(guardsOn(edgeOf(opening('canActivate: [gate]', '/c/x'), '/a', '/c/x')?.guard)).toContain('gate')
  })

  it('does not count a route on an outlet that only a path of its own opens', () => {
    // 136: opening by any route under the mount
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const gate = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { gate } from './guards'
import { H } from './h.component'
import { A } from './a.component'
import { Pop } from './pop.component'
export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'b', component: H },
  { path: 'compose', outlet: 'popup', component: Pop, canActivate: [gate] },
]`,
      '/app/h.component.ts': page('H'),
      '/app/pop.component.ts': page('Pop'),
      '/app/a.component.ts': page('A', '<a routerLink="/b">b</a>'),
    }), '/app')
    const e = edgeOf(graph, '/a', '/b')
    expect(e?.modality).toBe('must')
    expect(guardsOn(e?.guard)).toEqual([])
  })
})

describe('the routes the router tries on the way', () => {
  /** /x/z is reached after the router tries a first `x`, which declares `first`. */
  const tried = (first: string, opts = {}, root = '') => inMemory({
    '/app/guards.ts': `export const beta = () => true`,
    '/app/x.routes.ts': `import type { Routes } from '@angular/router'\nimport { Y } from './y.component'\nexport const routes: Routes = [{ path: 'y', component: Y }]`,
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { beta } from './guards'
import { H } from './h.component'
import { Z } from './z.component'
export const routes: Routes = [
  { path: 'home', component: H },
  { path: 'x', ${first}, loadChildren: () => import('./x.routes').then((m) => m.routes) },
  { path: 'x', children: [{ path: 'z', component: Z }] },
]`,
    '/app/h.component.ts': page('H', '<a routerLink="/x/z">z</a>'),
    '/app/y.component.ts': page('Y'),
    '/app/z.component.ts': page('Z'),
    ...(root ? { '/app/root.component.ts': root } : {}),
    ...opts,
  })

  it('runs the canLoad of a route tried off the target chain', () => {
    // 117: tried routes run canMatch only; 122: canLoad alone records no guarded level
    const { graph } = extractGraph(tried('canLoad: [beta]'), '/app')
    expect(guardsOn(edgeOf(graph, '/home', '/x/z')?.guard)).toContain('beta')
  })

  it('does not run again the canLoad of a route on the chain the navigation keeps', () => {
    // 116: tried routes on the chain not filtered
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const ld = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { ld } from './guards'
import { P } from './p.component'
import { A } from './a.component'
export const routes: Routes = [
  { path: 'p', component: P, canLoad: [ld], runGuardsAndResolvers: 'pathParamsChange', children: [{ path: 'a', component: A }, { path: 'b', component: P }] },
]`,
      '/app/p.component.ts': page('P'),
      '/app/a.component.ts': page('A', '<a routerLink="/p/b">b</a>'),
    }), '/app')
    const e = edgeOf(graph, '/p/a', '/p/b')
    expect(e?.modality).toBe('must')
    expect(guardsOn(e?.guard)).toEqual([])
  })

  it('names them on a shell link held at may for a reason every screen shares', () => {
    // 119: tried not passed to the conservative verdict
    const root = `import { Component } from '@angular/core'\n@Component({ selector: 'x-root', standalone: true, template: '@if (on) { <a routerLink="/x/z">z</a> }<router-outlet></router-outlet>' })\nexport class Root { on = true }`
    const { graph } = extractGraph(tried('canMatch: [beta]', {}, root), '/app', { attribution: true })
    const fromShell = graph.edges.filter((e) => e.to === routeId('/x/z') && e.witness?.file === 'root.component.ts')
    expect(fromShell.length).toBeGreaterThan(0)
    for (const e of fromShell) expect(guardsOn(e.guard)).toContain('beta')
  })

  it('names them on a control in controls mode', () => {
    // 121: tried not passed in controls mode
    const { graph } = extractGraph(tried('canMatch: [beta]'), '/app', { controls: true })
    const controls = new Set(graph.nodes.filter((n) => n.kind === 'control').map((n) => n.id))
    const e = graph.edges.find((x) => controls.has(x.from) && x.to === routeId('/x/z'))
    expect(e).toBeDefined()
    expect(guardsOn(e?.guard)).toContain('beta')
  })
})

describe('the identity of a route a wrapper returns', () => {
  /** Each call of a wrapper builds a new route object, which the router does not keep across calls. */
  const wrapper = (body: string) => extractGraph(inMemory({
    '/app/guards.ts': `export const auth = () => true\nexport const g = () => true`,
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { auth, g } from './guards'
import { Shell } from './shell.component'
import { A } from './a.component'
import { B } from './b.component'
${body}`,
    '/app/shell.component.ts': page('Shell'),
    '/app/a.component.ts': page('A', '<a routerLink="/b">b</a><a routerLink="/p/b">pb</a>'),
    '/app/b.component.ts': page('B'),
  }), '/app').graph

  it('enters the route of a second spread call again, and runs its canActivate', () => {
    // 100: wrapper identity, spread call
    const graph = wrapper(`function withShell(children: Routes): any { return { path: '', component: Shell, canActivate: [auth], children } }
export const routes: Routes = [...withShell([{ path: 'a', component: A }]), ...withShell([{ path: 'b', component: B }])]`)
    const e = edgeOf(graph, '/a', '/b')
    expect(e?.modality).toBe('may')
    expect(guardsOn(e?.guard)).toContain('auth')
  })

  it('tries the route of each children call, and runs each one\'s canMatch', () => {
    // 101: wrapper identity, children call; the router tries the first `p`, runs `g`, finds no
    // `b` below it, and runs `g` again on the second
    const graph = wrapper(`function withG(children: Routes): any { return { path: '', component: Shell, canMatch: [g], children } }
export const routes: Routes = [{ path: 'p', children: withG([{ path: 'a', component: A }]) }, { path: 'p', children: withG([{ path: 'b', component: B }]) }]`)
    expect(guardsOn(edgeOf(graph, '/p/a', '/p/b')?.guard).filter((x) => x === 'g')).toHaveLength(2)
  })
})
