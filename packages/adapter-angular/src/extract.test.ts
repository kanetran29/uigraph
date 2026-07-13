import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { Project } from 'ts-morph'
import { validateGraph } from '@ui-graph/core'
import { buildProject, extractGraph } from './extract'
import { routeToNodeId as routeId } from './ids'

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

describe('extractGraph — control extraction parity (F-angular-controls)', () => {
  const dir = fileURLToPath(new URL('../../../examples/sample-angular-app', import.meta.url))

  it('keeps the route graph identical (all screens) without opts.controls', () => {
    const { graph } = extractGraph(buildProject(dir), dir)
    expect(graph.nodes.every((n) => n.kind === 'screen')).toBe(true)
    expect(graph.nodes).toHaveLength(8)
    expect(graph.edges).toHaveLength(11)
  })

  describe('golden sample-angular-app with opts.controls', () => {
    const { graph } = extractGraph(buildProject(dir), dir, { controls: true })
    const controls = graph.nodes.filter((n) => n.kind === 'control')
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const ctrlEdge = (parent: string, to: string) =>
      graph.edges.find((e) => e.to === to && byId.get(e.from)?.kind === 'control' && byId.get(e.from)?.parent === parent)

    it('still satisfies the core invariants', () => {
      expect(validateGraph(graph)).toEqual([])
    })

    it('emits control nodes whose parent is always a real node', () => {
      expect(controls.length).toBeGreaterThan(0)
      for (const c of controls) {
        expect(c.parent).toBeDefined()
        expect(byId.has(c.parent as string)).toBe(true)
        expect(c.control?.selector?.value).toBeTruthy()
      }
    })

    it("wires CheckoutComponent's button to n_root as a must-edge", () => {
      const e = ctrlEdge('n_checkout', 'n_root')
      expect(e?.modality).toBe('must')
      expect(e?.witness?.ruleId).toMatch(/^ng\.control\./)
    })

    it('wires guarded control navigations as may-edges with AuthGuard', () => {
      for (const [parent, to] of [
        ['n_login', 'n_dashboard'],
        ['n_dashboard_settings', 'n_dashboard'],
        ['n_products_id', 'n_checkout'],
      ] as const) {
        const e = ctrlEdge(parent, to)
        expect(e?.modality).toBe('may')
        expect(e?.guard).toContain('AuthGuard')
      }
    })

    it('exposes the email input constraints and the form/submit control', () => {
      const loginControls = controls.filter((c) => c.parent === 'n_login')
      const email = loginControls.find((c) => c.control?.controlType === 'input')
      expect(email?.control?.input).toMatchObject({ type: 'email', required: true })
      const form = loginControls.find((c) => c.control?.controlType === 'form')
      expect(form?.control?.events).toContain('submit')
    })

    it('prefers a data-testid selector when present', () => {
      const submit = controls.find((c) => c.control?.selector?.strategy === 'testid')
      expect(submit?.control?.selector?.value).toBe('login-submit')
    })
  })
})

describe('extractGraph — modern Angular routing (lazy + nested + array links)', () => {
  it('ng-lazy-load-component: resolves loadComponent and emits edges from its (external) template', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nexport const routes: Routes = [\n  { path: '', loadComponent: () => import('./home.component') },\n  { path: 'about', loadComponent: () => import('./about.component') },\n]`,
        '/home.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, templateUrl: './home.component.html' })\nexport default class HomeComponent {}`,
        '/home.component.html': `<a routerLink="/about">about</a>`,
        '/about.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>about</p>' })\nexport default class AboutComponent {}`,
      }),
      '/',
    )
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(['n_root', 'n_about']))
    expect(graph.nodes.find((n) => n.id === 'n_root')?.componentPath).toBe('home.component.ts')
    const e = graph.edges.find((x) => x.from === 'n_root' && x.to === 'n_about')
    expect(e?.modality).toBe('must')
    expect(e?.witness?.file).toBe('home.component.html')
  })

  it('ng-lazy-load-children: follows loadChildren and prefixes nested paths', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nexport const routes: Routes = [\n  { path: 'profile', loadChildren: () => import('./profile.routes') },\n]`,
        '/profile.routes.ts': `import type { Routes } from '@angular/router'\nimport { ProfileComponent } from './profile.component'\nconst routes: Routes = [\n  { path: ':username', component: ProfileComponent, children: [\n    { path: 'favorites', loadComponent: () => import('./favorites.component') },\n  ] },\n]\nexport default routes`,
        '/profile.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>profile</p>' })\nexport class ProfileComponent {}`,
        '/favorites.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>favs</p>' })\nexport default class FavoritesComponent {}`,
      }),
      '/',
    )
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(ids.has(routeId('/profile/:username'))).toBe(true)
    expect(ids.has(routeId('/profile/:username/favorites'))).toBe(true)
    expect(graph.nodes.find((n) => n.route === '/profile/:username/favorites')?.componentPath).toBe('favorites.component.ts')
  })

  it('scans a loadChildren module only under its parent prefix (no root-level dup)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nexport const routes: Routes = [{ path: 'profile', loadChildren: () => import('./profile.routes') }]`,
        '/profile.routes.ts': `import type { Routes } from '@angular/router'\nimport { P } from './p.component'\nconst routes: Routes = [{ path: ':username', component: P }]\nexport default routes`,
        '/p.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>p</p>' })\nexport class P {}`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/profile', '/profile/:username'])
    expect(graph.nodes.some((n) => n.route === '/:username')).toBe(false)
  })

  it('ng-array-routerlink: array [routerLink] with a static prefix over-approximates (no dynamic drop)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: '', component: A }, { path: 'tag/:tag', component: B }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a [routerLink]="[\\'/tag\\', tag]">t</a>' })\nexport class A { tag = 'x' }`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    const e = graph.edges.find((x) => x.to === routeId('/tag/:tag'))
    expect(e?.modality).toBe('may')
  })

  it('ng-array-routerlink: a fully static single-element array is a literal must-edge', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: '', component: A }, { path: 'about', component: B }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a [routerLink]="[\\'/about\\']">a</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(graph.edges.find((x) => x.to === 'n_about')?.modality).toBe('must')
  })

  it('inline children are nested under the parent path', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { E } from './e.component'\nexport const routes: Routes = [\n  { path: 'editor', children: [\n    { path: '', component: E },\n    { path: ':slug', component: E },\n  ] },\n]`,
        '/e.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>e</p>' })\nexport class E {}`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/editor', '/editor/:slug'])
  })
})

describe('control units (F-angular-controls)', () => {
  function controlsOf(template: string, klassBody = '') {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ standalone: true, template: \`${template}\` })\nexport class A { constructor(private router: Router){} ${klassBody} }`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
      { controls: true },
    )
    const controls = graph.nodes.filter((n) => n.kind === 'control' && n.parent === 'n_a')
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const navTo = (to: string) => graph.edges.find((e) => e.to === to && byId.get(e.from)?.kind === 'control')
    return { controls, navTo, soundiness }
  }

  it('selector precedence: testid > role-name > label > text > structural', () => {
    expect(controlsOf('<button data-testid="x" (click)="g()">Save</button>').controls[0]?.control?.selector).toMatchObject({ strategy: 'testid', value: 'x' })
    expect(controlsOf('<button (click)="g()">Save</button>').controls[0]?.control?.selector).toMatchObject({ strategy: 'role-name', value: 'button|Save' })
    expect(controlsOf('<input formControlName="email" (input)="g()" />').controls[0]?.control?.selector).toMatchObject({ strategy: 'label', value: 'email' })
    expect(controlsOf('<div (mouseenter)="g()"></div>').controls[0]?.control?.selector).toMatchObject({ strategy: 'structural', value: 'div' })
  })

  it('nth disambiguates two identical controls into two distinct ids', () => {
    const { controls } = controlsOf('<input name="plan" type="radio" /><input name="plan" type="radio" />')
    expect(controls).toHaveLength(2)
    expect(new Set(controls.map((c) => c.id)).size).toBe(2)
  })

  it('traces a (click) handler to a method that navigates (must when unguarded)', () => {
    const { navTo } = controlsOf('<button (click)="go()">go</button>', 'go(){ this.router.navigate(["/b"]) }')
    expect(navTo('n_b')?.modality).toBe('must')
  })

  it('demotes a conditional navigation to may with the condition as guard', () => {
    const { navTo } = controlsOf('<button (click)="go()">go</button>', 'x = true; go(){ if (this.x) this.router.navigate(["/b"]) }')
    expect(navTo('n_b')?.modality).toBe('may')
    expect(navTo('n_b')?.guard).toContain('x')
  })

  it('demotes an early-returned navigation to may (no phantom must)', () => {
    const { navTo } = controlsOf('<button (click)="go()">go</button>', 'ok = false; go(){ if (!this.ok) return; this.router.navigate(["/b"]) }')
    expect(navTo('n_b')?.modality).toBe('may')
  })

  it('demotes a navigation inside forEach to may (iteration, not must)', () => {
    const { navTo } = controlsOf('<button (click)="go()">go</button>', 'items = [1]; go(){ this.items.forEach(() => this.router.navigate(["/b"])) }')
    expect(navTo('n_b')?.modality).toBe('may')
  })

  it('traces navigateByUrl handlers and emits no edge for non-navigating methods', () => {
    expect(controlsOf('<button (click)="go()">go</button>', 'go(){ this.router.navigateByUrl("/b") }').navTo('n_b')?.modality).toBe('must')
    expect(controlsOf('<button (click)="noop()">x</button>', 'noop(){ console.log("hi") }').navTo('n_b')).toBeUndefined()
  })

  it('captures multiple events and input constraints', () => {
    const { controls } = controlsOf('<input type="email" required (input)="g()" (blur)="h()" />')
    expect(controls[0]?.control?.events).toEqual(expect.arrayContaining(['input', 'blur']))
    expect(controls[0]?.control?.input).toMatchObject({ type: 'email', required: true })
  })

  it('classifies a (submit) form as a form control', () => {
    const { controls } = controlsOf('<form (submit)="g()"><button>ok</button></form>')
    const form = controls.find((c) => c.control?.controlType === 'form')
    expect(form?.control?.events).toContain('submit')
  })
})

describe('extractGraph — functional route guards (CanActivateFn)', () => {
  const edgeTo = (graph: { edges: { to: string }[] }, to: string) => graph.edges.find((e) => (e as { to: string }).to === to) as
    | { modality: string; guard: string | null; confidence: number }
    | undefined

  it('captures a NAMED functional guard by its function name and demotes the edge to may', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { inject } from '@angular/core'\nimport { A } from './a.component'\nimport { B } from './b.component'\nconst requireAuth = () => inject(Object).ok === true\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [requireAuth] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    const e = edgeTo(graph, 'n_b')
    expect(e?.modality).toBe('may')
    expect(e?.guard).toBe('requireAuth')
    expect(e?.confidence).toBe(0.6)
  })

  it('captures an INLINE arrow guard by a stable body hash (fn#…), deterministic across runs', () => {
    const build = () =>
      extractGraph(
        inMemory({
          '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { inject } from '@angular/core'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [() => inject(Object).loggedIn] }]`,
          '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
          '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
        }),
        '/',
      )
    const g1 = build().graph
    const g2 = build().graph
    const e1 = edgeTo(g1, 'n_b')
    expect(e1?.modality).toBe('may')
    expect(e1?.guard).toMatch(/^fn#[0-9a-f]{8}$/)
    expect(edgeTo(g2, 'n_b')?.guard).toBe(e1?.guard)
  })

  it('lowers confidence to ~0.5 and emits an async-guard soundiness note for an Observable-returning guard', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { inject } from '@angular/core'\nimport { map } from 'rxjs/operators'\nimport { A } from './a.component'\nimport { B } from './b.component'\nconst requireAuth = () => inject(Object).isAuthenticated.pipe(map((x: boolean) => x))\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [requireAuth] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    const e = edgeTo(graph, 'n_b')
    expect(e?.modality).toBe('may')
    expect(e?.guard).toBe('requireAuth')
    expect(e?.confidence).toBe(0.5)
    const note = soundiness.find((s) => s.kind === 'async-guard')
    expect(note?.detail).toContain('requireAuth')
    expect(note?.detail).toContain('Observable')
  })

  it('emits a single async-guard note even when several edges enter the same guarded route', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { inject } from '@angular/core'\nimport { A } from './a.component'\nimport { C } from './c.component'\nimport { B } from './b.component'\nconst requireAuth = () => inject(Object).x.pipe()\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'c', component: C }, { path: 'b', component: B, canActivate: [requireAuth] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/c.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class C {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(soundiness.filter((s) => s.kind === 'async-guard')).toHaveLength(1)
  })

  it('a literal-true functional guard does NOT gate: the edge stays must / unguarded', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [() => true] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    const e = edgeTo(graph, 'n_b')
    expect(e?.modality).toBe('must')
    expect(e?.guard).toBeNull()
    expect(e?.confidence).toBe(1)
  })

  it('still treats an imported guard CLASS reference as a class gate (may, 0.6, name as text)', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { AuthGuard } from './auth.guard'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [AuthGuard] }]`,
        '/auth.guard.ts': `export class AuthGuard {}`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    const e = edgeTo(graph, 'n_b')
    expect(e?.modality).toBe('may')
    expect(e?.guard).toBe('AuthGuard')
    expect(e?.confidence).toBe(0.6)
  })
})

describe('extractGraph — signal-based route guards (Angular 17+)', () => {
  const edgeTo = (graph: { edges: { to: string }[] }, to: string) => graph.edges.find((e) => (e as { to: string }).to === to) as
    | { modality: string; guard: string | null; confidence: number }
    | undefined

  it('keeps a signal-reading guard SYNCHRONOUS (conf 0.6, not async) and emits a signal-guard note', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { inject } from '@angular/core'\nimport { A } from './a.component'\nimport { B } from './b.component'\nconst requireAuth = () => inject(Object).isAuthed.asReadonly()\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [requireAuth] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    const e = edgeTo(graph, 'n_b')
    expect(e?.modality).toBe('may')
    expect(e?.guard).toBe('requireAuth')
    expect(e?.confidence).toBe(0.6)
    expect(soundiness.some((s) => s.kind === 'async-guard')).toBe(false)
    const note = soundiness.find((s) => s.kind === 'signal-guard')
    expect(note?.detail).toContain('requireAuth')
    expect(note?.detail).toContain('signal')
  })

  it('detects a Signal<boolean>-typed field read as a signal guard', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { inject } from '@angular/core'\nimport { A } from './a.component'\nimport { B } from './b.component'\nconst requireAuth = () => { const s: Signal<boolean> = inject(Object).flag; return s() }\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [requireAuth] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(edgeTo(graph, 'n_b')?.confidence).toBe(0.6)
    expect(soundiness.some((s) => s.kind === 'signal-guard')).toBe(true)
  })

  it('an Observable wrapper around a signal read still classifies as async (not signal)', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { inject } from '@angular/core'\nimport { toObservable } from '@angular/core/rxjs-interop'\nimport { A } from './a.component'\nimport { B } from './b.component'\nconst requireAuth = () => toObservable(inject(Object).flag).pipe()\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'b', component: B, canActivate: [requireAuth] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(edgeTo(graph, 'n_b')?.confidence).toBe(0.5)
    expect(soundiness.some((s) => s.kind === 'async-guard')).toBe(true)
    expect(soundiness.some((s) => s.kind === 'signal-guard')).toBe(false)
  })

  it('emits a single signal-guard note even when several edges enter the same guarded route', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { inject } from '@angular/core'\nimport { A } from './a.component'\nimport { C } from './c.component'\nimport { B } from './b.component'\nconst requireAuth = () => inject(Object).flag.asReadonly()\nexport const routes: Routes = [{ path: 'a', component: A }, { path: 'c', component: C }, { path: 'b', component: B, canActivate: [requireAuth] }]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class A {}`,
        '/c.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/b">go</a>' })\nexport class C {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(soundiness.filter((s) => s.kind === 'signal-guard')).toHaveLength(1)
  })
})

describe('extractGraph — withComponentInputBinding + route-input binding (Angular 16+)', () => {
  const notes = (s: { kind: string; detail: string }[]) => s.filter((n) => n.kind === 'route-input-binding')

  it('binds a :param to a same-named signal input() when withComponentInputBinding() is enabled', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/main.ts': `import { provideRouter, withComponentInputBinding } from '@angular/router'\nimport { routes } from './app.routes'\nbootstrapApplication(App, { providers: [provideRouter(routes, withComponentInputBinding())] })`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Item } from './item.component'\nexport const routes: Routes = [{ path: 'items/:id', component: Item }]`,
        '/item.component.ts': `import { Component, input } from '@angular/core'\n@Component({ standalone: true, template: '<p>item</p>' })\nexport class Item { id = input<string>() }`,
      }),
      '/',
    )
    const n = notes(soundiness)
    expect(n).toHaveLength(1)
    expect(n[0]?.detail).toContain('id')
    expect(n[0]?.detail).toContain('/items/:id')
    expect(n[0]?.detail).toContain('signal input')
  })

  it('binds a :param to a same-named @Input() decorator field', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/main.ts': `import { provideRouter, withComponentInputBinding } from '@angular/router'\nimport { routes } from './app.routes'\nprovideRouter(routes, withComponentInputBinding())`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Profile } from './profile.component'\nexport const routes: Routes = [{ path: 'u/:username', component: Profile }]`,
        '/profile.component.ts': `import { Component, Input } from '@angular/core'\n@Component({ standalone: true, template: '<p>p</p>' })\nexport class Profile { @Input() username = '' }`,
      }),
      '/',
    )
    const n = notes(soundiness)
    expect(n).toHaveLength(1)
    expect(n[0]?.detail).toContain('username')
  })

  it('resolves an @Input("alias") to the alias name, not the field name', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/main.ts': `import { provideRouter, withComponentInputBinding } from '@angular/router'\nimport { routes } from './app.routes'\nprovideRouter(routes, withComponentInputBinding())`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Item } from './item.component'\nexport const routes: Routes = [{ path: 'x/:id', component: Item }]`,
        '/item.component.ts': `import { Component, Input } from '@angular/core'\n@Component({ standalone: true, template: '<p>i</p>' })\nexport class Item { @Input('id') itemId = '' }`,
      }),
      '/',
    )
    const n = notes(soundiness)
    expect(n).toHaveLength(1)
    expect(n[0]?.detail).toContain('id')
  })

  it('binds a static data: { key } entry to a same-named input', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/main.ts': `import { provideRouter, withComponentInputBinding } from '@angular/router'\nimport { routes } from './app.routes'\nprovideRouter(routes, withComponentInputBinding())`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Page } from './page.component'\nexport const routes: Routes = [{ path: 'p', component: Page, data: { mode: 'edit' } }]`,
        '/page.component.ts': `import { Component, input } from '@angular/core'\n@Component({ standalone: true, template: '<p>p</p>' })\nexport class Page { mode = input.required<string>() }`,
      }),
      '/',
    )
    const n = notes(soundiness)
    expect(n.some((x) => x.detail.includes('mode') && x.detail.includes('data'))).toBe(true)
  })

  it('emits NOTHING when withComponentInputBinding() is absent (no binding witness)', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/main.ts': `import { provideRouter } from '@angular/router'\nimport { routes } from './app.routes'\nprovideRouter(routes)`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Item } from './item.component'\nexport const routes: Routes = [{ path: 'items/:id', component: Item }]`,
        '/item.component.ts': `import { Component, input } from '@angular/core'\n@Component({ standalone: true, template: '<p>item</p>' })\nexport class Item { id = input<string>() }`,
      }),
      '/',
    )
    expect(notes(soundiness)).toHaveLength(0)
  })

  it('emits NOTHING when no component input name matches the route param (no witness)', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/main.ts': `import { provideRouter, withComponentInputBinding } from '@angular/router'\nimport { routes } from './app.routes'\nprovideRouter(routes, withComponentInputBinding())`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Item } from './item.component'\nexport const routes: Routes = [{ path: 'items/:id', component: Item }]`,
        '/item.component.ts': `import { Component, input } from '@angular/core'\n@Component({ standalone: true, template: '<p>item</p>' })\nexport class Item { name = input<string>() }`,
      }),
      '/',
    )
    expect(notes(soundiness)).toHaveLength(0)
  })

  it('is deterministic: same input yields the same notes across runs', () => {
    const files = {
      '/main.ts': `import { provideRouter, withComponentInputBinding } from '@angular/router'\nimport { routes } from './app.routes'\nprovideRouter(routes, withComponentInputBinding())`,
      '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Item } from './item.component'\nexport const routes: Routes = [{ path: 'items/:id', component: Item }]`,
      '/item.component.ts': `import { Component, input } from '@angular/core'\n@Component({ standalone: true, template: '<p>item</p>' })\nexport class Item { id = input<string>() }`,
    }
    const a = notes(extractGraph(inMemory(files), '/').soundiness)
    const b = notes(extractGraph(inMemory(files), '/').soundiness)
    expect(a).toEqual(b)
  })
})
