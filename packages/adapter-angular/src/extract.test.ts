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

    it('anchors every template routerLink to a link control — no undrivable screen-sourced routerLink edge remains', () => {
      expect(graph.edges.filter((e) => byId.get(e.from)?.kind === 'screen' && e.event === 'click:routerLink')).toHaveLength(0)
      const e = ctrlEdge('n_root', 'n_login')
      expect(e?.modality).toBe('must')
      expect(e?.witness?.ruleId).toBe('ng.control.router-link')
      expect(byId.get(e?.from as string)?.control?.controlType).toBe('link')
    })
  })
})

describe('extractGraph — screen labels (route-first when one component serves several routes)', () => {
  it('labels routes sharing a component route-first, and a single-route component by its name', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Auth } from './auth.component'\nimport { Home } from './home.component'\nexport const routes: Routes = [{ path: '', component: Home }, { path: 'login', component: Auth }, { path: 'register', component: Auth }]`,
        '/auth.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>auth</p>' })\nexport class Auth {}`,
        '/home.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>home</p>' })\nexport class Home {}`,
      }),
      '/',
    )
    const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label
    expect(label('n_login')).toBe('/login · Auth')
    expect(label('n_register')).toBe('/register · Auth')
    expect(label('n_root')).toBe('Home')
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
    // the componentless loadChildren parent is a prefix, not a screen
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/profile/:username'])
    expect(graph.nodes.some((n) => n.route === '/:username')).toBe(false)
  })

  it('follows loadChildren through an NgModule to the routing module it delegates to', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app-routing.module.ts': `import type { Routes } from '@angular/router'\nconst routes: Routes = [{ path: 'clients', loadChildren: () => import('./clients/clients.module').then((m) => m.ClientsModule) }]`,
        '/clients/clients.module.ts': `import { SharedModule } from '../shared/shared.module'\nimport { ClientsRoutingModule } from './clients-routing.module'\nexport class ClientsModule {}`,
        '/shared/shared.module.ts': `export class SharedModule {}`,
        '/clients/clients-routing.module.ts': `import type { Routes } from '@angular/router'\nimport { C } from './c.component'\nconst routes: Routes = [{ path: ':clientId', component: C }]`,
        '/clients/c.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>c</p>' })\nexport class C {}`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/clients/:clientId'])
  })

  it('reads routes from an inline RouterModule.forChild array of named Route constants', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nexport const routes: Routes = [{ path: 'error', loadChildren: () => import('./error/module') }]`,
        '/error/module.ts': `import { ErrorRoutingModule } from './routing'\nexport class ErrorModule {}`,
        '/error/routing.ts': `import { Route, RouterModule, NgModule } from '@angular/router'\nimport { E } from './component'\nconst ERROR_ROUTE: Route = { path: '', component: E }\n@NgModule({ imports: [RouterModule.forChild([ERROR_ROUTE])] })\nexport class ErrorRoutingModule {}`,
        '/error/component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>e</p>' })\nexport class E {}`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/error'])
  })

  it('reads a route path that references a shared constant table', () => {
    const { graph } = extractGraph(
      inMemory({
        '/routes-table.ts': `export const internalRoutes = { account: { path: 'account', subRoutes: { access: { path: 'access' } } } }`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { internalRoutes } from './routes-table'\nimport { A } from './a.component'\nexport const routes: Routes = [\n  { path: internalRoutes.account.path, component: A, children: [\n    { path: internalRoutes.account.subRoutes.access.path, component: A },\n  ] },\n]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>a</p>' })\nexport class A {}`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/account', '/account/access'])
  })

  it('resolves a route-relative routerLink against the screen it fires from', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { V } from './v.component'\nimport { G } from './g.component'\nimport { E } from './e.component'\nexport const routes: Routes = [\n  { path: 'clients/:clientId', component: V, children: [\n    { path: 'general', component: G },\n    { path: 'edit', component: E },\n  ] },\n]`,
        '/v.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a [routerLink]="[\\'./general\\']">g</a><router-outlet></router-outlet>' })\nexport class V {}`,
        '/g.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a [routerLink]="[\\'../edit\\']">e</a>' })\nexport class G {}`,
        '/e.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>e</p>' })\nexport class E {}`,
      }),
      '/',
    )
    const has = (from: string, to: string) => graph.edges.some((e) => e.from === routeId(from) && e.to === routeId(to) && e.modality === 'must')
    expect(has('/clients/:clientId', '/clients/:clientId/general')).toBe(true)
    expect(has('/clients/:clientId/general', '/clients/:clientId/edit')).toBe(true)
  })

  it('walks the array a route factory such as Route.withShell([...]) is given, at the same prefix', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app-routing.module.ts': `import type { Routes } from '@angular/router'\nconst routes: Routes = [{ path: 'clients', loadChildren: () => import('./clients/clients.module').then((m) => m.ClientsModule) }]`,
        '/clients/clients.module.ts': `import { ClientsRoutingModule } from './clients-routing.module'\nexport class ClientsModule {}`,
        '/clients/clients-routing.module.ts': `import type { Routes } from '@angular/router'\nimport { Route } from '../core/route.service'\nimport { C } from './c.component'\nconst routes: Routes = [Route.withShell([{ path: '', component: C, children: [{ path: 'edit', component: C }] }])]`,
        '/core/route.service.ts': `export class Route { static withShell(routes: any) { return { path: '', children: routes } } }`,
        '/clients/c.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>c</p>' })\nexport class C {}`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/clients', '/clients/edit'])
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
    // the `path: ''` child is the screen at /editor — the componentless parent must not shadow it
    expect(graph.nodes.find((n) => n.route === '/editor')?.componentPath).toBe('e.component.ts')
  })

  it('a componentless parent is a prefix, not a screen, and its canActivate gates every child', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { inject } from '@angular/core'\nimport { A } from './a.component'\nimport { B } from './b.component'\nconst requireAuth = () => inject(Object).x.pipe()\nexport const routes: Routes = [\n  { path: 'a', component: A },\n  { path: 'admin', canActivate: [requireAuth], children: [{ path: 'users', component: B }] },\n]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<a routerLink="/admin/users">go</a>' })\nexport class A {}`,
        '/b.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '<p>b</p>' })\nexport class B {}`,
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/a', '/admin/users'])
    const e = graph.edges.find((x) => x.to === routeId('/admin/users'))
    expect(e?.modality).toBe('may')
    expect(e?.guard).toContain('requireAuth')
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
    return { controls, navTo, soundiness, edges: graph.edges }
  }

  it('anchors a static routerLink to a link control with a role-name selector (must, ng.control.router-link, no duplicate)', () => {
    const { controls, navTo, edges } = controlsOf(`<a routerLink="/b">Go to B</a>`)
    const link = controls.find((c) => c.control?.controlType === 'link')
    expect(link?.control?.selector).toEqual({ strategy: 'role-name', value: 'link|Go to B' })
    const e = navTo('n_b')
    expect(e?.from).toBe(link?.id)
    expect(e?.modality).toBe('must')
    expect(e?.witness?.ruleId).toBe('ng.control.router-link')
    expect(edges.filter((x) => x.to === 'n_b')).toHaveLength(1)
  })

  it('anchors a bound single-element array [routerLink] to its link control as a literal must-edge', () => {
    const { controls, navTo } = controlsOf(`<a [routerLink]="['/b']">B</a>`)
    expect(navTo('n_b')?.from).toBe(controls.find((c) => c.control?.controlType === 'link')?.id)
    expect(navTo('n_b')?.modality).toBe('must')
  })

  it('an interpolated link name is not a selector: falls to a structural tag.class locator', () => {
    const { controls } = controlsOf(`<a [routerLink]="['/b']" class="tag-pill tag-default">{{ tag }}</a>`)
    const link = controls.find((c) => c.control?.controlType === 'link')
    expect(link?.control?.selector).toEqual({ strategy: 'structural', value: 'a.tag-pill.tag-default' })
    expect(link?.control?.name).toBeUndefined()
  })

  it('a bound [routerLink] with a dynamic first segment is a link control with a dynamic-target note, no edge', () => {
    const { controls, navTo, soundiness } = controlsOf(`<a [routerLink]="[dest]">X</a>`)
    expect(controls.find((c) => c.control?.controlType === 'link')).toBeDefined()
    expect(navTo('n_b')).toBeUndefined()
    expect(soundiness.some((n) => n.kind === 'dynamic-target' && n.detail.includes('routerLink'))).toBe(true)
  })

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

  it('labels a nameless child-component element by its tag (an @Output binding is not a DOM event)', () => {
    const { controls } = controlsOf(`<app-follow-button [profile]="p" (toggle)="onToggle($event)" />`)
    const c = controls.find((x) => x.control?.controlType === 'element')
    expect(c?.label).toBe('app-follow-button')
    expect(c?.control?.events).toEqual(['toggle'])
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

describe('extractGraph — a conditional navigation site is never must', () => {
  const leaf = (cls: string): string =>
    `import { Component } from '@angular/core'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '' })\nexport class ${cls} {}`
  const targets = 'ABCDEFGH'.split('')
  const project = inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { Home } from './home.component'
${targets.map((c) => `import { ${c} } from './${c.toLowerCase()}.component'`).join('\n')}
export const routes: Routes = [
  { path: 'home', component: Home },
${targets.map((c) => `  { path: '${c.toLowerCase()}', component: ${c} },`).join('\n')}
]`,
    '/app/home.component.ts': `import { Component } from '@angular/core'
import { Router } from '@angular/router'
@Component({ selector: 'x-home', standalone: true, template: \`
<a routerLink="/a">unconditional</a>
<b (click)="goE()"></b><b (click)="goF()"></b><b (click)="goG()"></b><b (click)="goH()"></b>
<a *ngIf="flag" routerLink="/b">ngIf</a>
@if (flag) {
  <a routerLink="/c">at-if</a>
}
@for (x of xs; track x) { <span>{{x}}</span> } @empty {
  <a routerLink="/d">at-empty</a>
}
\` })
export class Home {
  flag = true; xs: number[] = []
  constructor(private router: Router, private svc: any) {}
  goE() { this.router.navigate(['/e']) }
  goF() { if (this.flag) { this.router.navigate(['/f']) } }
  goG() { this.svc.save().subscribe(() => this.router.navigate(['/g'])) }
  async goH() { await this.svc.save(); this.router.navigate(['/h']) }
}`,
    ...Object.fromEntries(targets.map((c) => [`/app/${c.toLowerCase()}.component.ts`, leaf(c)])),
  })

  for (const attribution of [false, true]) {
    const { graph } = extractGraph(project, '/app', { attribution })
    const tier = (to: string): string | undefined => graph.edges.find((e) => e.from === routeId('/home') && e.to === routeId(to))?.modality

    it(`keeps an unconditional link and an unconditional call on must (attribution ${attribution})`, () => {
      expect(tier('/a')).toBe('must')
      expect(tier('/e')).toBe('must')
    })

    it(`demotes a link under *ngIf, @if or @empty to may (attribution ${attribution})`, () => {
      expect(tier('/b')).toBe('may')
      expect(tier('/c')).toBe('may')
      expect(tier('/d')).toBe('may')
    })

    it(`demotes a call under a branch, in a subscribe callback or after an await to may (attribution ${attribution})`, () => {
      expect(tier('/f')).toBe('may')
      expect(tier('/g')).toBe('may')
      expect(tier('/h')).toBe('may')
    })
  }
})

describe('extractGraph — a target whose base or primary path the reader cannot fix is never must', () => {
  const page = (cls: string, tpl = '', body = ''): string =>
    `import { Component } from '@angular/core'\nimport { Router, ActivatedRoute } from '@angular/router'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: \`${tpl}\` })\nexport class ${cls} { opts: any = {}; constructor(private router: Router, private route: ActivatedRoute) {} ${body} }`
  const project = inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { P } from './p.component'
import { G } from './g.component'
import { E } from './e.component'
import { Root } from './root.component'
import { Home } from './home.component'
import { Inbox } from './inbox.component'
import { Slug } from './slug.component'
export const routes: Routes = [
  { path: 'items/:id', component: P, children: [{ path: 'general', component: G }, { path: 'edit', component: E }, { path: 'c', component: E }, { path: 'e', component: E }] },
  { path: 'edit', component: Root },
  { path: 'home', component: Home },
  { path: 'inbox', component: Inbox },
  { path: ':slug', component: Slug },
]`,
    '/app/p.component.ts': page('P', '<a routerLink="./general">g</a><x-tabs></x-tabs><router-outlet></router-outlet>'),
    '/app/tabs.component.ts': page('Tabs', '<a routerLink="edit">e</a>'),
    '/app/g.component.ts': page('G', '<b (click)="a()"></b><b (click)="b()"></b><b (click)="c()"></b><b (click)="d()"></b><b (click)="e()"></b><b (click)="f()"></b>', `
  a() { this.router.navigate(['../edit'], { relativeTo: this.route }) }
  b() { this.router.navigate(['edit']) }
  c() { const relativeTo = this.route; this.router.navigate(['../c'], { relativeTo }) }
  d() { this.router.navigate(['edit'], this.opts) }
  e() { this.router.navigate(['../e'], { relativeTo: this.route.parent }) }
  f() { this.router.navigate(['/items/1'], this.opts) }`),
    '/app/e.component.ts': page('E'),
    '/app/root.component.ts': page('Root'),
    '/app/home.component.ts': page('Home', '<a routerLink="/inbox(popup:compose)">i</a><b (click)="a()"></b><b (click)="b()"></b>', `
  a() { this.router.navigateByUrl('/inbox(popup:compose)') }
  b() { this.router.navigateByUrl('/x/(b//popup:c)') }`),
    '/app/inbox.component.ts': page('Inbox'),
    '/app/slug.component.ts': page('Slug'),
  })

  for (const attribution of [false, true]) {
    const { graph, soundiness } = extractGraph(project, '/app', { attribution })
    const at = (line: number) => graph.edges.filter((e) => [e.witness, ...(e.mergedWitnesses ?? [])].some((w) => w?.file === 'g.component.ts' && w.loc?.line === line))

    it(`keeps a call whose base is the component's own route on must (attribution ${attribution})`, () => {
      expect(graph.edges.find((e) => e.from === routeId('/items/:id/general') && e.to === routeId('/items/:id/edit'))?.modality).toBe('must')
      expect(graph.edges.find((e) => e.from === routeId('/items/:id/general') && e.to === routeId('/items/:id'))?.modality).toBe('must')
      expect(graph.edges.find((e) => e.from === routeId('/items/:id') && e.to === routeId('/items/:id/general'))?.modality).toBe('must')
    })

    it(`demotes a call whose options hide the base (attribution ${attribution})`, () => {
      for (const line of [7, 8, 9]) {
        const own = at(line).flatMap((e) => [e.witness, ...(e.mergedWitnesses ?? [])]).filter((w) => w?.file === 'g.component.ts' && w.loc?.line === line)
        expect(own.length).toBeGreaterThan(0)
        expect(own.every((w) => w?.modality === 'may')).toBe(true)
      }
    })

    it(`reads an outlet group in a link as part of the segment, as Angular does (attribution ${attribution})`, () => {
      const fromHome = graph.edges.filter((e) => e.from === routeId('/home'))
      expect(fromHome.find((e) => e.to === routeId('/:slug'))?.modality).toBe('must')
      expect(fromHome.some((e) => e.to === routeId('/inbox') && e.event === 'click:routerLink')).toBe(false)
    })

    it(`holds a URL that names an auxiliary outlet at may, at its primary path (attribution ${attribution})`, () => {
      const fromHome = graph.edges.filter((e) => e.from === routeId('/home') && e.event === 'navigate')
      expect(fromHome.map((e) => [e.to, e.modality])).toEqual([[routeId('/inbox'), 'may']])
      expect(soundiness.some((n) => /inbox\(popup/.test(n.detail ?? ''))).toBe(false)
    })
  }

  it('never emits must for a relative link in a component rendered under a route it does not own', () => {
    const { graph } = extractGraph(project, '/app', { attribution: true })
    const fromTabs = graph.edges.filter((e) => [e.witness, ...(e.mergedWitnesses ?? [])].some((w) => w?.file === 'tabs.component.ts'))
    expect(fromTabs.length).toBeGreaterThan(0)
    expect(fromTabs.every((e) => e.modality !== 'must')).toBe(true)
  })
})

describe('extractGraph — a navigation to the address its source already displays is never must', () => {
  const page = (cls: string, tpl: string, sel = cls.toLowerCase()): string =>
    `import { Component } from '@angular/core'\n@Component({ selector: 'x-${sel}', standalone: true, template: '${tpl}' })\nexport class ${cls} {}`
  const project = inMemory({
    '/app/main.ts': `import { bootstrapApplication } from '@angular/platform-browser'\nimport { App } from './app.component'\nbootstrapApplication(App)`,
    '/app/app.component.ts': page('App', '<x-header></x-header><router-outlet></router-outlet>', 'root'),
    '/app/header.component.ts': page('Header', '<a routerLink="/">logo</a>'),
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { Other } from './other.component'\nexport const routes: Routes = [{ path: '', component: Home }, { path: 'other', component: Other }]`,
    '/app/home.component.ts': page('Home', '<a routerLink="/">self</a><a routerLink="/other">o</a>'),
    '/app/other.component.ts': page('Other', '<p>o</p>'),
  })

  it('demotes a link from a screen to itself and keeps one to another screen', () => {
    const { graph } = extractGraph(project, '/app')
    expect(graph.edges.find((e) => e.from === routeId('/') && e.to === routeId('/'))?.modality).toBe('may')
    expect(graph.edges.find((e) => e.from === routeId('/') && e.to === routeId('/other'))?.modality).toBe('must')
  })

  it('draws a certain shell link per screen: must from the others, a may self-loop at the destination', () => {
    const { graph } = extractGraph(project, '/app', { attribution: true })
    const logo = graph.edges.filter((e) => e.to === routeId('/') && [e.witness, ...(e.mergedWitnesses ?? [])].some((w) => w?.file === 'header.component.ts'))
    expect(logo.map((e) => [e.from, e.modality]).sort()).toEqual([[routeId('/other'), 'must'], [routeId('/'), 'may']])
    expect(graph.edges.some((e) => e.from === 'n_scope_shell')).toBe(false)
  })

  it('holds the links of a component mounted under a template condition at may on that screen', () => {
    const { graph } = extractGraph(inMemory({
      '/app/main.ts': `import { bootstrapApplication } from '@angular/platform-browser'\nimport { App } from './app.component'\nbootstrapApplication(App)`,
      '/app/app.component.ts': page('App', '@if (flag) { <x-header></x-header> }<router-outlet></router-outlet>', 'root'),
      '/app/header.component.ts': page('Header', '<a routerLink="/other">o</a>'),
      '/app/child.component.ts': page('Child', '<a routerLink="/other">c</a>'),
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { Other } from './other.component'\nexport const routes: Routes = [{ path: '', component: Home }, { path: 'other', component: Other }]`,
      '/app/home.component.ts': page('Home', '<div *ngIf="c"><x-child></x-child></div>'),
      '/app/other.component.ts': page('Other', '<x-child></x-child>'),
    }), '/app', { attribution: true })
    const child = (from: string) => graph.edges.find((e) => e.from === from && e.to === routeId('/other') && [e.witness, ...(e.mergedWitnesses ?? [])].some((w) => w?.file === 'child.component.ts'))
    expect(child(routeId('/'))?.modality).toBe('may')
    expect(graph.edges.filter((e) => [e.witness, ...(e.mergedWitnesses ?? [])].some((w) => w?.file === 'header.component.ts')).every((e) => e.modality !== 'must')).toBe(true)
    expect(graph.edges.some((e) => e.from === routeId('/other') && e.to === routeId('/other'))).toBe(true)
  })
})

describe('extractGraph — controls mode demotes a conditional control or handler', () => {
  const project = inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { Other } from './other.component'\nexport const routes: Routes = [{ path: 'home', component: Home }, { path: 'other', component: Other }]`,
    '/app/home.component.ts': `import { Component } from '@angular/core'
import { Router } from '@angular/router'
@Component({ selector: 'x-home', standalone: true, template: \`<button id="a" (click)="go()">a</button><button id="b" *ngIf="flag" (click)="go()">b</button><button id="c" (click)="later()">c</button>\` })
export class Home {
  flag = true
  constructor(private router: Router, private svc: any) {}
  go() { this.router.navigate(['/other']) }
  later() { this.svc.save().subscribe(() => this.router.navigate(['/other'])) }
}`,
    '/app/other.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-other', standalone: true, template: '<p>o</p>' })\nexport class Other {}`,
  })
  const { graph } = extractGraph(project, '/app', { controls: true })
  const tierOf = (id: string) => {
    const c = graph.nodes.find((n) => n.kind === 'control' && n.control?.selector?.value === `button|${id}`)
    return graph.edges.find((e) => e.from === c?.id && e.to === routeId('/other'))?.modality
  }

  it('keeps an unconditional control whose handler navigates unconditionally on must', () => {
    expect(tierOf('a')).toBe('must')
  })
  it('demotes a control under a structural directive and a handler that navigates in a callback', () => {
    expect(tierOf('b')).toBe('may')
    expect(tierOf('c')).toBe('may')
  })
})

describe('extractGraph — an empty-path child with no component speaks for the screen above it', () => {
  const page = (cls: string, tpl = '<router-outlet></router-outlet>'): string =>
    `import { Component } from '@angular/core'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '${tpl}' })\nexport class ${cls} {}`
  const project = inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { Layout } from './layout.component'
import { Shell } from './shell.component'
import { Vault } from './vault.component'
import { Links } from './links.component'
import { redirectGuard } from './redirect.guard'
export const routes: Routes = [
  { path: '', component: Layout, children: [
    { path: '', pathMatch: 'full', children: [], canActivate: [redirectGuard()] },
    { path: 'links', component: Links },
  ] },
  { path: 'app', component: Shell, children: [
    { path: '', redirectTo: 'vault', pathMatch: 'full' },
    { path: 'vault', component: Vault },
  ] },
]`,
    '/app/redirect.guard.ts': `export function redirectGuard() { return () => true }`,
    '/app/layout.component.ts': page('Layout'),
    '/app/shell.component.ts': page('Shell'),
    '/app/vault.component.ts': page('Vault', '<p>v</p>'),
    '/app/links.component.ts': page('Links', '<a routerLink="/">root</a><a routerLink="/app">app</a><a routerLink="/app/vault">vault</a>'),
  })
  const { graph } = extractGraph(project, '/app')
  const from = graph.edges.filter((e) => e.from === routeId('/links'))

  it('puts the guard of the empty-path child on every edge into the screen above it', () => {
    const e = from.find((x) => x.to === routeId('/'))
    expect(e?.guard).toContain('redirectGuard')
    expect(e?.modality).toBe('may')
  })

  it('does not put that guard on the screen\'s other children', () => {
    expect(graph.edges.every((x) => x.to !== routeId('/links') || !(x.guard ?? '').includes('redirectGuard'))).toBe(true)
  })

  it('sends a link to a screen whose empty-path child redirects on to the redirect\'s destination', () => {
    expect(from.some((x) => x.to === routeId('/app'))).toBe(false)
    const toVault = from.filter((x) => x.to === routeId('/app/vault'))
    expect(toVault.length).toBe(1)
    expect(toVault[0]?.modality).toBe('must')
  })
})

describe('extractGraph — an interpolated routerLink is a computed target', () => {
  it('sends a fully interpolated link to the unknown sink and an interpolated tail to a prefix', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { U } from './u.component'\nexport const routes: Routes = [{ path: 'home', component: Home }, { path: 'users/:id', component: U }, { path: '**', redirectTo: 'home' }]`,
        '/app/home.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-home', standalone: true, template: '<a routerLink="{{ next().route }}">n</a>\\n<a routerLink="/users/{{ id }}">u</a>' })\nexport class Home {}`,
        '/app/u.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-u', standalone: true, template: '<p>u</p>' })\nexport class U {}`,
      }),
      '/app',
    )
    const fromHome = graph.edges.filter((e) => e.from === routeId('/home'))
    expect(fromHome.find((e) => e.to === 'u_' + routeId('/home'))?.modality).toBe('unknown')
    expect(fromHome.find((e) => e.to === routeId('/users/:id'))?.modality).toBe('may')
    expect(fromHome.some((e) => e.to === routeId('/home'))).toBe(false)
  })
})

describe('extractGraph — targets read the way the router reads them', () => {
  const page = (cls: string, tpl = '<router-outlet></router-outlet>', body = ''): string =>
    `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: \`${tpl}\` })\nexport class ${cls} { rest: any = []; constructor(private router: Router) {} ${body} }`
  const project = inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { Home } from './home.component'
import { About } from './about.component'
import { Profile } from './profile.component'
import { Shell } from './shell.component'
import { Dash } from './dash.component'
import { Vault } from './vault.component'
import { Items } from './items.component'
import { Layout } from './layout.component'
import { Inner } from './inner.component'
export const routes: Routes = [
  { path: 'home', component: Home },
  { path: 'about', component: About },
  { path: 'users/:name', component: Profile },
  { path: 'users/me', component: About },
  { path: 'app', component: Shell, children: [{ path: '', component: Dash }, { path: '', redirectTo: 'vault', pathMatch: 'full' }, { path: 'vault', component: Vault }] },
  { path: 'app2', component: Layout, children: [{ path: '', redirectTo: 'vault', pathMatch: 'full' }, { path: 'vault', component: Inner, children: [{ path: '', redirectTo: 'items', pathMatch: 'full' }, { path: 'items', component: Items }] }] },
]`,
    '/app/home.component.ts': page('Home', `<a *ngIf="c" routerLink="/about">a</a><a routerLink="/about">b</a>
<a routerLink="/users/me">m</a>
<a [routerLink]="['/about'].concat(rest)">c</a>
<a routerLink="/app">d</a>
<a routerLink="/app2/">e</a>
<b (click)="go()"></b>`, `go() { this.router.navigateByUrl('/about?tab=2') }`),
    '/app/about.component.ts': page('About', '<p>a</p>'),
    '/app/profile.component.ts': page('Profile', '<p>p</p>'),
    '/app/shell.component.ts': page('Shell'),
    '/app/dash.component.ts': page('Dash', '<p>d</p>'),
    '/app/vault.component.ts': page('Vault', '<p>v</p>'),
    '/app/items.component.ts': page('Items', '<p>i</p>'),
    '/app/layout.component.ts': page('Layout', '<a routerLink="/about">x</a><router-outlet></router-outlet>'),
    '/app/inner.component.ts': page('Inner'),
  })
  const { graph } = extractGraph(project, '/app')
  const from = (path: string) => graph.edges.filter((e) => e.from === routeId(path))
  const edge = (a: string, b: string, event = 'click:routerLink') => from(a).find((e) => e.to === routeId(b) && e.event === event)

  it('takes the most certain of two links on one line and records both', () => {
    const e = edge('/home', '/about')!
    expect(e.modality).toBe('must')
    expect([e.witness, ...(e.mergedWitnesses ?? [])].filter((w) => w?.loc?.line === 3).map((w) => w?.modality).sort()).toEqual(['may', 'must'])
  })

  it('holds an address two declared routes can answer at may, and keeps one only one answers', () => {
    expect(edge('/home', '/users/me')?.modality ?? edge('/home', '/users/:name')?.modality).toBe('may')
    expect(edge('/home', '/about')?.modality).toBe('must')
  })

  it('does not read an array followed by a method call as the array', () => {
    const concat = [...graph.edges].flatMap((e) => [e.witness, ...(e.mergedWitnesses ?? [])].map((w) => ({ e, w }))).filter(({ w }) => w?.file === 'home.component.ts' && w?.loc?.line === 5)
    expect(concat.length).toBeGreaterThan(0)
    expect(concat.every(({ w }) => w?.modality !== 'must')).toBe(true)
  })

  it('does not forward past a redirect that an earlier empty-path child shadows', () => {
    expect(edge('/home', '/app')).toBeDefined()
    expect(edge('/home', '/app/vault')).toBeUndefined()
  })

  it('follows a chain of empty-path redirects, trailing slash and all', () => {
    expect(edge('/home', '/app2/vault/items')?.modality).toBe('must')
    expect(edge('/home', '/app2')).toBeUndefined()
    expect(edge('/home', '/app2/vault')).toBeUndefined()
  })

  it('holds the edges of a screen never shown at its own address at may', () => {
    expect(edge('/app2', '/about')?.modality).toBe('may')
  })

  it('drops the query of a URL but not of a command', () => {
    expect(edge('/home', '/about', 'navigate')?.modality).toBe('must')
  })
})

describe('extractGraph — every guard that can refuse an address gates it', () => {
  const page = (cls: string, tpl = '<router-outlet></router-outlet>'): string =>
    `import { Component } from '@angular/core'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '${tpl}' })\nexport class ${cls} {}`
  const project = inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { Home } from './home.component'
import { P } from './p.component'
import { authGuard, betaGuard, settingsGuard } from './guards'
export const routes: Routes = [
  { path: 'home', component: Home },
  { path: 'admin', component: P, canActivateChild: [authGuard], children: [{ path: 'users', component: P }] },
  { path: 'beta', component: P, canMatch: [betaGuard] },
  { path: 'settings', component: P, children: [{ path: '', component: P, canActivate: [settingsGuard] }] },
  { path: 'open', component: P },
]`,
    '/app/guards.ts': `export const authGuard = () => true\nexport const betaGuard = () => true\nexport const settingsGuard = () => true`,
    '/app/home.component.ts': page('Home', '<a routerLink="/admin/users">a</a><a routerLink="/beta">b</a><a routerLink="/settings">c</a><a routerLink="/open">d</a>'),
    '/app/p.component.ts': page('P'),
  })
  const { graph } = extractGraph(project, '/app')
  const to = (p: string) => graph.edges.find((e) => e.from === routeId('/home') && e.to === routeId(p))

  it('reads canActivateChild on an ancestor, canMatch on the target, and canActivate on an empty-path child with a component', () => {
    expect(to('/admin/users')?.guard).toContain('authGuard')
    expect(to('/beta')?.guard).toContain('betaGuard')
    expect(to('/settings')?.guard).toContain('settingsGuard')
    for (const p of ['/admin/users', '/beta', '/settings']) expect(to(p)?.modality).toBe('may')
  })

  it('leaves an unguarded route on must', () => {
    expect(to('/open')?.modality).toBe('must')
    expect(to('/open')?.guard).toBeNull()
  })
})

describe('extractGraph — a relative base is trusted only when it is the component\'s own route', () => {
  const project = inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { G } from './g.component'\nimport { E } from './e.component'\nexport const routes: Routes = [{ path: 'items/:id', children: [{ path: 'general', component: G, children: [{ path: 'edit', component: E }] }, { path: 'edit', component: E }] }]`,
    '/app/g.component.ts': `import { Component, inject } from '@angular/core'
import { Router, ActivatedRoute } from '@angular/router'
@Component({ selector: 'x-g', standalone: true, template: '<b (click)="a()"></b><b (click)="b()"></b><b (click)="c()"></b><a routerLink="edit" [relativeTo]="route.parent">t</a>' })
export class G {
  private parentRoute = this.route.parent!
  private own = inject(ActivatedRoute)
  constructor(private router: Router, private route: ActivatedRoute) {}
  a() { this.router.navigate(['edit'], { relativeTo: this.parentRoute }) }
  b() { this.router.navigate(['edit'], { relativeTo: this.route }) }
  c() { this.router.navigate(['edit'], { relativeTo: this.own }) }
}`,
    '/app/e.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-e', standalone: true, template: '<p>e</p>' })\nexport class E {}`,
  })
  const { graph } = extractGraph(project, '/app')
  const sites = (line: number) => graph.edges.flatMap((e) => [e.witness, ...(e.mergedWitnesses ?? [])]).filter((w) => w?.file === 'g.component.ts' && w.loc?.line === line)

  it('holds a call relative to an alias of another route, and a link that binds relativeTo, at may', () => {
    expect(sites(8).map((w) => w?.modality)).toEqual(['may'])
    expect(sites(3).map((w) => w?.modality)).toEqual(['may'])
  })

  it('keeps a call relative to the injected route on must', () => {
    expect(sites(9).map((w) => w?.modality)).toEqual(['must'])
    expect(sites(10).map((w) => w?.modality)).toEqual(['must'])
  })
})

describe('extractGraph — a URL naming an auxiliary outlet is never must on its own account', () => {
  it('holds it at may even where only one route answers the primary path', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { Inbox } from './inbox.component'\nexport const routes: Routes = [{ path: 'home', component: Home }, { path: 'inbox', component: Inbox }]`,
      '/app/home.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ selector: 'x-home', standalone: true, template: '<b (click)="a()"></b><b (click)="b()"></b>' })\nexport class Home { constructor(private router: Router) {}\n  a() { this.router.navigateByUrl('/inbox(popup:compose)') }\n  b() { this.router.navigateByUrl('/inbox?tab=1') } }`,
      '/app/inbox.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-inbox', standalone: true, template: '<p>i</p>' })\nexport class Inbox {}`,
    }), '/app')
    const e = graph.edges.find((x) => x.from === routeId('/home') && x.to === routeId('/inbox'))!
    expect(e.modality).toBe('must')
    expect([e.witness, ...(e.mergedWitnesses ?? [])].map((w) => [w?.loc?.line, w?.modality]).sort()).toEqual([[5, 'may'], [6, 'must']])
  })
})

describe('extractGraph — controls mode reads a guarded binding as conditional', () => {
  it('holds a control whose binding guards the call at may, and keeps a bare one on must', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { Other } from './other.component'\nexport const routes: Routes = [{ path: 'home', component: Home }, { path: 'other', component: Other }]`,
      '/app/home.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ selector: 'x-home', standalone: true, template: \`<button id="a" (click)="go()">a</button><button id="b" (click)="flag && go()">b</button>\` })\nexport class Home { flag = true\n  constructor(private router: Router) {}\n  go() { this.router.navigate(['/other']) } }`,
      '/app/other.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-other', standalone: true, template: '<p>o</p>' })\nexport class Other {}`,
    }), '/app', { controls: true })
    const tier = (id: string) => {
      const c = graph.nodes.find((n) => n.kind === 'control' && n.control?.selector?.value === `button|${id}`)
      return graph.edges.find((e) => e.from === c?.id && e.to === routeId('/other'))?.modality
    }
    expect(tier('a')).toBe('must')
    expect(tier('b')).toBe('may')
  })
})

describe('extractGraph — the forms the end-to-end check found unread (mifos)', () => {
  const project = inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { View } from './view.component'
import { General } from './general.component'
import { Personal } from './personal.component'
import { Action } from './action.component'
import { Loan } from './loan.component'
export const routes: Routes = [
  { path: 'clients/:clientId', component: View, children: [
    { path: '', redirectTo: 'general', pathMatch: 'full' },
    { path: 'general', component: General },
    { path: 'personal-data', component: Personal },
    { path: 'actions/:name', component: Action },
  ] },
  { path: 'loans/:loanId', component: Loan, children: [{ path: 'actions/:action', component: Action }] },
]`,
    '/app/view.component.ts': `import { Component } from '@angular/core'
import { Router, ActivatedRoute } from '@angular/router'
@Component({ selector: 'x-view', standalone: true, template: '<a [routerLink]="[\\'./personal-data\\']">p</a><b (click)="act(n)"></b><router-outlet></router-outlet>' })
export class View {
  n = 'x'
  constructor(private router: Router, private route: ActivatedRoute) {}
  act(name: string) { this.router.navigate([\`actions/\${name}\`], { relativeTo: this.route }) }
  abs(id: string, a: string) { this.router.navigate([\`/loans/\${id}/actions/\${a}\`]) }
}`,
    '/app/loan.component.ts': `import { Component } from '@angular/core'
import { Router, ActivatedRoute, NavigationExtras } from '@angular/router'
@Component({ selector: 'x-loan', standalone: true, template: '<b (click)="go(n)"></b><router-outlet></router-outlet>' })
export class Loan {
  n = 'x'
  constructor(private router: Router, private route: ActivatedRoute) {}
  go(actionName: string) {
    const extras: NavigationExtras = { queryParams: { a: 1 }, relativeTo: this.route }
    this.router.navigate(['actions', actionName], extras)
  }
}`,
    '/app/general.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-general', standalone: true, template: '<p>g</p>' })\nexport class General {}`,
    '/app/personal.component.ts': `import { Component } from '@angular/core'
import { Router } from '@angular/router'
@Component({ selector: 'x-personal', standalone: true, template: '<b (click)="wide(n, n, n)"></b>' })
export class Personal {
  n = 'x'
  constructor(private router: Router) {}
  wide(a: string, b: string, c: string) { this.router.navigate([\`/\${a}/\${b}/actions/\${c}\`]) }
}`,
    '/app/action.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-action', standalone: true, template: '<p>a</p>' })\nexport class Action {}`,
  })
  const { graph } = extractGraph(project, '/app', { attribution: true })
  const members = new Map(graph.nodes.map((n) => [n.id, n.scope?.members ?? [n.id]]))
  const has = (from: string, to: string) =>
    graph.edges.some((e) => e.to === routeId(to) && (members.get(e.from) ?? [e.from]).includes(routeId(from)))

  it('reads a template literal inside a commands array as its static text with the interpolation as a parameter', () => {
    expect(has('/clients/:clientId', '/clients/:clientId/actions/:name')).toBe(true)
  })

  it('matches a parameter inside a prefix to any one segment, so it neither hides the routes below nor reaches every route', () => {
    expect(has('/clients/:clientId', '/loans/:loanId/actions/:action')).toBe(true)
    expect(has('/clients/:clientId/personal-data', '/loans/:loanId/actions/:action')).toBe(true)
    expect(has('/clients/:clientId/personal-data', '/clients/:clientId/actions/:name')).toBe(true)
    expect(has('/clients/:clientId/personal-data', '/clients/:clientId/general')).toBe(false)
  })

  it('evaluates relativeTo passed through an options variable', () => {
    expect(has('/loans/:loanId', '/loans/:loanId/actions/:action')).toBe(true)
  })

  it('resolves a relative link against the route of the component that holds it, on every child screen', () => {
    expect(has('/clients/:clientId/general', '/clients/:clientId/personal-data')).toBe(true)
    expect(has('/clients/:clientId/general', '/clients/:clientId/actions/:name')).toBe(true)
  })
})
