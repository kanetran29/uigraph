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

  it('runs a canActivate the navigation enters, and a shared route\'s again where an absolute link drops its matrix parameters', () => {
    expect(edgeOf(graph, '/login', '/app/two')?.modality).toBe('may')
    expect(edgeOf(graph, '/login', '/app/two')?.guard).toContain('auth')
    // From /app;x=1/one the absolute /app/two clears the matrix parameter of `app`, and under the
    // default runGuardsAndResolvers that change runs its canActivate again.
    expect(edgeOf(graph, '/app/one', '/app/two')?.modality).toBe('may')
    expect(edgeOf(graph, '/app/one', '/app/two')?.guard).toContain('auth')
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

describe('a route a wrapper builds', () => {
  it('gives each call of a wrapper its own route object, and shares it within one call', () => {
    // Each call returns a new object, so Angular reuses the shell only within one call and runs
    // the second shell's canActivate on a navigation that crosses between them.
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const auth = () => true`,
      '/app/shell.ts': `import { auth } from './guards'\nclass Shell {}\nexport class Route { static withShell(routes: any) { return { path: '', component: Shell, children: routes, canActivate: [auth] } } }`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { Route } from './shell'
import { H } from './h.component'
import { P } from './p.component'
export const routes: Routes = [Route.withShell([{ path: 'home', component: H }, { path: 'near', component: P }]), Route.withShell([{ path: 'about', component: P }])]`,
      '/app/h.component.ts': page('H', '<a routerLink="/about">a</a><a routerLink="/near">n</a>'),
      '/app/p.component.ts': page('P'),
    }), '/app')
    expect(edgeOf(graph, '/home', '/about')?.modality).toBe('may')
    expect(edgeOf(graph, '/home', '/about')?.guard).toContain('auth')
    expect(edgeOf(graph, '/home', '/near')?.modality).toBe('must')
  })
})

describe('matrix parameters under the default runGuardsAndResolvers', () => {
  it('keeps a shared route a relative link does not climb out of, and runs it again on one that does', () => {
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const auth = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { auth } from './guards'
import { P } from './p.component'
import { A } from './a.component'
import { B } from './b.component'
import { C } from './c.component'
export const routes: Routes = [
  { path: 'app', component: P, canActivate: [auth], children: [{ path: 'one', component: A }, { path: 'three', component: C }, { path: 'two', component: P }] },
  { path: 'path', component: P, canActivate: [auth], runGuardsAndResolvers: 'pathParamsChange', children: [{ path: 'one', component: B }, { path: 'two', component: P }] },
]`,
      '/app/p.component.ts': page('P'),
      '/app/a.component.ts': page('A', '<a routerLink="../two">r</a>'),
      '/app/c.component.ts': page('C', '<a routerLink="../../app/two">c</a>'),
      '/app/b.component.ts': page('B', '<a routerLink="/path/two">p</a>'),
    }), '/app')
    expect(edgeOf(graph, '/app/one', '/app/two')?.modality).toBe('must')
    expect(edgeOf(graph, '/app/three', '/app/two')?.modality).toBe('may')
    expect(edgeOf(graph, '/app/three', '/app/two')?.guard).toContain('auth')
    // 'pathParamsChange' compares the paths alone, so a matrix parameter never runs it again.
    expect(edgeOf(graph, '/path/one', '/path/two')?.modality).toBe('must')
  })
})

describe('redirects the router meets before the screen', () => {
  it('holds an address a prefix or parameter redirect also answers at may, and not one a full-path redirect elsewhere or a later sibling does', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { X } from './x.component'
export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'old', children: [{ path: '', redirectTo: '/a', pathMatch: 'prefix' }, { path: 'x', component: X }] },
  { path: 'item/:id', redirectTo: '/items/:id', pathMatch: 'full' },
  { path: 'item/new', component: X },
  { path: 'items/:id', component: X },
  { path: 'gone', redirectTo: '/a' },
  { path: 'gone/new', component: X },
  { path: 'z', redirectTo: '/a', pathMatch: 'full' },
  { path: 'z/y', component: X },
  { path: 'q/new', component: X },
  { path: 'q/:id', redirectTo: '/a', pathMatch: 'full' },
]`,
      '/app/a.component.ts': page('A', '<a routerLink="/old/x">o</a><a routerLink="/item/new">i</a><a routerLink="/gone/new">g</a><a routerLink="/z/y">z</a><a routerLink="/q/new">q</a>'),
      '/app/x.component.ts': page('X'),
    }), '/app')
    expect(edgeOf(graph, '/a', '/old/x')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/item/new')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/gone/new')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/z/y')?.modality).toBe('must')
    // Declared before the parameter redirect in the same table, /q/new is matched first.
    expect(edgeOf(graph, '/a', '/q/new')?.modality).toBe('must')
  })
})

describe('canMatch on the routes the router tries on the way', () => {
  it('runs the canMatch of an earlier route the address is tried against, and of the branch a redirect passes through', () => {
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const adminOnly = () => true\nexport const beta = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { adminOnly, beta } from './guards'
import { P } from './p.component'
import { A } from './a.component'
export const routes: Routes = [
  { path: '', canMatch: [adminOnly], children: [{ path: 'admin', component: P }] },
  { path: '', children: [{ path: 'a', component: A }, { path: 'b', component: P }] },
  { path: 'beta', canMatch: [beta], children: [{ path: '', pathMatch: 'full', redirectTo: '/new' }] },
  { path: 'new', component: P },
]`,
      '/app/a.component.ts': page('A', '<a routerLink="/b">b</a><a routerLink="/beta">n</a>'),
      '/app/p.component.ts': page('P'),
    }), '/app')
    expect(edgeOf(graph, '/a', '/b')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/b')?.guard).toContain('adminOnly')
    expect(edgeOf(graph, '/a', '/new')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/new')?.guard).toContain('beta')
  })
})

describe('a redirect whose target the reader cannot fix', () => {
  it('never takes the address it answers for one a screen displays', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { P } from './p.component'
export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'p', component: P, children: [{ path: '', pathMatch: 'full', redirectTo: () => 'c' }, { path: 'c', component: A }] },
  { path: 'x', redirectTo: () => '/a', pathMatch: 'full' },
  { path: 'x', component: P },
]`,
      '/app/a.component.ts': page('A', '<a routerLink="/p">p</a><a routerLink="/x">x</a>'),
      '/app/p.component.ts': page('P', '<a routerLink="/a">a</a><router-outlet></router-outlet>'),
    }), '/app')
    expect(edgeOf(graph, '/a', '/p')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/x')?.modality).toBe('may')
    expect(edgeOf(graph, '/p', '/a')?.modality).toBe('may')
  })
})

describe('a title resolver', () => {
  it('awaits a title that is a function or a class, and not one that is a string', () => {
    const { graph } = extractGraph(inMemory({
      '/app/titles.ts': 'export const titleOf = () => fetch(\'/t\').then((r) => r.text())\nexport class TitleResolver { resolve() { return \'x\' } }\nexport const TITLES = { b: $localize`B` }',
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { titleOf, TitleResolver, TITLES } from './titles'
import { A } from './a.component'
import { P } from './p.component'
export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'fn', component: P, title: titleOf },
  { path: 'cls', component: P, title: TitleResolver },
  { path: 'loc', component: P, title: TITLES.b },
  { path: 'lit', component: P, title: 'Lit' },
]`,
      '/app/a.component.ts': page('A', '<a routerLink="/fn">f</a><a routerLink="/cls">c</a><a routerLink="/loc">l</a><a routerLink="/lit">t</a>'),
      '/app/p.component.ts': page('P'),
    }), '/app')
    expect(edgeOf(graph, '/a', '/fn')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/cls')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/loc')?.modality).toBe('must')
    expect(edgeOf(graph, '/a', '/lit')?.modality).toBe('must')
  })
})

describe('routes on a named outlet', () => {
  it('runs the canDeactivate of an outlet the source can have open, and the guards of one an empty path opens', () => {
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const leave = () => true\nexport const gate = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { leave, gate } from './guards'
import { H } from './h.component'
import { A } from './a.component'
import { Pop } from './pop.component'
export const routes: Routes = [
  { path: '', component: H },
  { path: 'a', component: A },
  { path: 'b', component: H },
  { path: 'compose', component: Pop, outlet: 'popup', canDeactivate: [leave] },
  { path: 'c', children: [{ path: '', component: H }, { path: '', outlet: 'side', component: Pop, canActivate: [gate] }] },
]`,
      '/app/h.component.ts': page('H'),
      '/app/pop.component.ts': page('Pop'),
      '/app/a.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ selector: 'x-a', standalone: true, template: '<a routerLink="/">h</a><a routerLink="/c">c</a>' })\nexport class A { constructor(private router: Router) {} go() { this.router.navigateByUrl('/b') } }`,
    }), '/app')
    // From /a(popup:compose), both `/` and a URL close the popup outlet, which runs `leave`.
    expect(edgeOf(graph, '/a', '/')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/')?.guard).toContain('leave')
    expect(edgeOf(graph, '/a', '/b')?.modality).toBe('may')
    // The empty-path `side` route is matched whenever /c is, so its canActivate runs.
    expect(edgeOf(graph, '/a', '/c')?.guard).toContain('gate')
  })
})

describe('the sub-rules of a shared route being kept', () => {
  it('counts the segments the routes above a shared one consume, not only its own', () => {
    // The empty-path route compares x's segment too, so /x;m=1/one -> /x/two runs `auth` though x itself is kept.
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const auth = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { auth } from './guards'
import { P } from './p.component'
import { A } from './a.component'
export const routes: Routes = [
  { path: 'x', runGuardsAndResolvers: 'pathParamsChange', children: [{ path: '', component: P, canActivate: [auth], children: [{ path: 'one', component: A }, { path: 'two', component: P }] }] },
]`,
      '/app/p.component.ts': page('P'),
      '/app/a.component.ts': page('A', '<a routerLink="/x/two">t</a>'),
    }), '/app')
    expect(edgeOf(graph, '/x/one', '/x/two')?.modality).toBe('may')
    expect(edgeOf(graph, '/x/one', '/x/two')?.guard).toContain('auth')
  })

  it('keeps no segment of the source once a redirect rewrote the address', () => {
    // ../c keeps /p;m=1 as it is, but the absolute redirect at /p/c builds /p/b afresh, so p's matrix parameter goes and `auth` runs.
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const auth = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { auth } from './guards'
import { P } from './p.component'
import { A } from './a.component'
export const routes: Routes = [
  { path: 'p', component: P, canActivate: [auth], children: [{ path: 'a', component: A }, { path: 'b', component: P }, { path: 'c', redirectTo: '/p/b', pathMatch: 'full' }] },
]`,
      '/app/p.component.ts': page('P'),
      '/app/a.component.ts': page('A', '<a routerLink="../c">c</a>'),
    }), '/app')
    expect(edgeOf(graph, '/p/a', '/p/b')?.modality).toBe('may')
    expect(edgeOf(graph, '/p/a', '/p/b')?.guard).toContain('auth')
  })

  it('runs the canMatch of a route tried at an address a redirect leads to', () => {
    // /old becomes /new/page, where the router tries the first `new` route, runs `beta`, finds no `page` under it and goes on.
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const beta = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { beta } from './guards'
import { P } from './p.component'
import { A } from './a.component'
export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'old', redirectTo: '/new/page', pathMatch: 'full' },
  { path: 'new', canMatch: [beta], children: [{ path: 'other', component: P }] },
  { path: 'new', children: [{ path: 'page', component: P }] },
]`,
      '/app/p.component.ts': page('P'),
      '/app/a.component.ts': page('A', '<a routerLink="/old">o</a>'),
    }), '/app')
    expect(edgeOf(graph, '/a', '/new/page')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/new/page')?.guard).toContain('beta')
  })

  it('lets a later prefix redirect at the same address answer the longer addresses a full one leaves', () => {
    // /old/x passes the full redirect by, and the prefix one after it sends it to /a, so X is never shown.
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { X } from './x.component'
export const routes: Routes = [
  { path: 'old', redirectTo: '/a', pathMatch: 'full' },
  { path: 'old', redirectTo: '/a' },
  { path: 'old/x', component: X },
  { path: 'a', component: A },
]`,
      '/app/a.component.ts': page('A'),
      '/app/x.component.ts': page('X', '<a routerLink="/a">a</a>'),
    }), '/app')
    expect(edgeOf(graph, '/old/x', '/a')?.modality).toBe('may')
  })
})

describe('a screen a redirect hides', () => {
  it('is hidden only when the redirect answers every address the screen does', () => {
    // /items/new is one instance of /items/:id, and /items/5 still shows P; /q/:id answers every address /q/new does.
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { P } from './p.component'
export const routes: Routes = [
  { path: 'items/new', redirectTo: '/a', pathMatch: 'full' },
  { path: 'items/:id', component: P },
  { path: 'q/:id', redirectTo: '/a', pathMatch: 'full' },
  { path: 'q/new', component: P },
  { path: 'a', component: A },
]`,
      '/app/a.component.ts': page('A'),
      '/app/p.component.ts': page('P', '<a routerLink="/a">a</a>'),
    }), '/app')
    expect(edgeOf(graph, '/items/:id', '/a')?.modality).toBe('must')
    expect(edgeOf(graph, '/q/new', '/a')?.modality).toBe('may')
  })
})

describe('a catch-all in declaration order', () => {
  it('meets a catch-all declared before the screen in the same table, and not one declared after it', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { P } from './p.component'
import { NotFound } from './nf.component'
export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'adm', children: [{ path: '**', redirectTo: '/a' }, { path: 'x', component: P }] },
  { path: 'ok', children: [{ path: 'x', component: P }, { path: '**', redirectTo: '/a' }] },
  { path: 'nf', children: [{ path: '**', component: NotFound }, { path: 'x', component: P }] },
  { path: 'b', component: P },
  { path: '**', redirectTo: '/a' },
  { path: 'old', redirectTo: '/b' },
]`,
      '/app/a.component.ts': page('A', '<a routerLink="/adm/x">x</a><a routerLink="/ok/x">o</a><a routerLink="/nf/x">n</a><a routerLink="/old">b</a>'),
      '/app/p.component.ts': page('P'),
      '/app/nf.component.ts': page('NotFound'),
    }), '/app')
    expect(edgeOf(graph, '/a', '/adm/x')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/ok/x')?.modality).toBe('must')
    expect(edgeOf(graph, '/a', '/nf/x')?.modality).toBe('may')
    // The root catch-all comes before `old`, so /old goes to /a and never to /b.
    expect(edgeOf(graph, '/a', '/b')?.modality).not.toBe('must')
  })

  it('takes a catch-all in a table registered apart to come after the screens of another, an assumption since registration order is not read', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const ROOT: Routes = [{ path: 'a', component: A }, { path: '**', redirectTo: '/a' }]`,
      '/app/feature.routes.ts': `import type { Routes } from '@angular/router'\nimport { P } from './p.component'\nexport const FEATURE: Routes = [{ path: 'b', component: P }]`,
      '/app/a.component.ts': page('A', '<a routerLink="/b">b</a>'),
      '/app/p.component.ts': page('P'),
    }), '/app')
    expect(edgeOf(graph, '/a', '/b')?.modality).toBe('must')
  })
})

describe('an address only a redirect answers', () => {
  it('is not sent down the catch-all branch when the redirect cannot be followed, and is followed when its pattern binds every parameter', () => {
    const { graph, soundiness } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { P } from './p.component'
export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'x', redirectTo: () => '/a', pathMatch: 'full' },
  { path: 'item/:id', redirectTo: '/items/:id', pathMatch: 'full' },
  { path: 'items/:id', component: P },
  { path: 'gone', redirectTo: 'a' },
  { path: 'm/:a', redirectTo: '/a', pathMatch: 'full' },
  { path: ':b/n', redirectTo: '/items/1', pathMatch: 'full' },
  { path: '**', component: P },
]`,
      '/app/a.component.ts': page('A', '<a routerLink="/x">x</a><a routerLink="/item/5">i</a><a routerLink="/gone/deep">g</a><a routerLink="/m/n">m</a>'),
      '/app/p.component.ts': page('P'),
    }), '/app')
    expect(edgeOf(graph, '/a', '*')).toBeUndefined()
    expect(soundiness.filter((n) => n.kind === 'wildcard-redirect' || n.kind === 'unresolved-target')).toEqual([])
    expect(soundiness.filter((n) => n.kind === 'dynamic-target').map((n) => n.detail)).toEqual([
      'literal target "/x" is answered by a redirect the reader does not follow, so where it lands is not read',
      'literal target "/gone/deep" is answered by a redirect the reader does not follow, so where it lands is not read',
      'literal target "/m/n" is answered by a redirect the reader does not follow, so where it lands is not read',
    ])
    expect(edgeOf(graph, '/a', '/items/:id')?.modality).toBe('must')
  })

  it('is not reported as matching no declared route from a control either', () => {
    const { soundiness } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'x', redirectTo: () => '/a', pathMatch: 'full' }]`,
      '/app/a.component.ts': page('A', '<a routerLink="/x">x</a>'),
    }), '/app', { controls: true })
    expect(soundiness.filter((n) => n.kind === 'unresolved-target')).toEqual([])
    expect(soundiness.filter((n) => n.kind === 'dynamic-target').map((n) => n.detail)).toEqual([expect.stringContaining('target "/x" is answered by a redirect the reader does not follow')])
  })
})

describe('a named-outlet route the source has open', () => {
  it('runs its canMatch on every navigation, and its canActivate where it asks to run always', () => {
    // An absolute link keeps the root's other outlets, so /a(popup:compose) -> /b(popup:compose) matches the popup route again.
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const cm = () => true\nexport const ca = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { cm, ca } from './guards'
import { A } from './a.component'
import { P } from './p.component'
export const routes: Routes = [
  { path: 'a', component: A },
  { path: 'b', component: P },
  { path: 'compose', component: P, outlet: 'popup', canMatch: [cm] },
  { path: 'chat', component: P, outlet: 'side', canActivate: [ca], runGuardsAndResolvers: 'always' },
]`,
      '/app/a.component.ts': page('A', '<a routerLink="/b">b</a>'),
      '/app/p.component.ts': page('P'),
    }), '/app')
    expect(edgeOf(graph, '/a', '/b')?.modality).toBe('may')
    expect(edgeOf(graph, '/a', '/b')?.guard).toContain('cm')
    expect(edgeOf(graph, '/a', '/b')?.guard).toContain('ca')
  })
})
