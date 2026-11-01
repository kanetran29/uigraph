import { describe, it, expect, afterEach } from 'vitest'
import { Project } from 'ts-morph'
import { extractGraph } from './extract'
import { memberScopes } from './callgraph'
import { routeToNodeId as routeId } from './ids'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

/** A routed component whose template binds one handler that calls `call` on an injected service. */
const page = (cls: string, svc: string, call: string, tpl = '') =>
  `import { Component } from '@angular/core'\nimport { ${svc} } from './services'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '<b (click)="go()"></b>${tpl}' })\nexport class ${cls} { constructor(private svc: ${svc}) {}\n  go() { this.svc.${call}() } }`
const leaf = (cls: string) => `import { Component } from '@angular/core'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '<p>${cls}</p>' })\nexport class ${cls} {}`
const routes = (pairs: [string, string][]) =>
  `import type { Routes } from '@angular/router'\n${pairs.map(([, c]) => `import { ${c} } from './${c.toLowerCase()}.component'`).join('\n')}\nexport const routes: Routes = [${pairs.map(([p, c]) => `{ path: '${p}', component: ${c} }`).join(', ')}]`

const pairsTo = (graph: ReturnType<typeof extractGraph>['graph'], file: string) =>
  graph.edges.filter((e) => [e.witness, ...(e.mergedWitnesses ?? [])].some((w) => w?.file === file)).map((e) => `${e.from}>${e.to}`).sort()

describe('the member-level call graph', () => {
  afterEach(() => { delete process.env.UIGRAPH_SCOPE_LAYERS })
  const twoMethods = {
    '/app/app.routes.ts': routes([['x', 'X'], ['y', 'Y'], ['a', 'A'], ['b', 'B']]),
    '/app/services.ts': `import { Router } from '@angular/router'\nexport class Nav { constructor(private router: Router) {}\n  goA() { this.router.navigate(['/a']) }\n  goB() { this.router.navigate(['/b']) } }`,
    '/app/x.component.ts': page('X', 'Nav', 'goA'),
    '/app/y.component.ts': page('Y', 'Nav', 'goB'),
    '/app/a.component.ts': leaf('A'), '/app/b.component.ts': leaf('B'),
  }

  it('places each member of a service on the screens of its own callers, with no cross pair', () => {
    const { graph } = extractGraph(inMemory(twoMethods), '/app', { attribution: true })
    expect(pairsTo(graph, 'services.ts')).toEqual([`${routeId('/x')}>${routeId('/a')}`, `${routeId('/y')}>${routeId('/b')}`])
  })

  it('joins over every component that injects the class at the class level, which the call graph narrows', () => {
    process.env.UIGRAPH_SCOPE_LAYERS = 'class'
    const { graph } = extractGraph(inMemory(twoMethods), '/app', { attribution: true })
    expect(pairsTo(graph, 'services.ts')).toHaveLength(4)
  })

  it('follows a service that calls another service, which the class-level join never reached', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routes([['x', 'X'], ['a', 'A']]),
      '/app/services.ts': `import { Router } from '@angular/router'\nexport class Nav { constructor(private router: Router) {}\n  toA() { this.router.navigate(['/a']) } }\nexport class Facade { constructor(private nav: Nav) {}\n  go() { this.nav.toA() } }`,
      '/app/x.component.ts': page('X', 'Facade', 'go'),
      '/app/a.component.ts': leaf('A'),
    }), '/app', { attribution: true })
    expect(pairsTo(graph, 'services.ts')).toEqual([`${routeId('/x')}>${routeId('/a')}`])
  })

  it('resolves a token through a provider binding, and an abstract class through its subclasses', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routes([['x', 'X'], ['y', 'Y'], ['a', 'A'], ['b', 'B']]),
      '/app/services.ts': `import { Router } from '@angular/router'
export abstract class Nav { abstract go(): void }
export class NavA extends Nav { constructor(private router: Router) { super() }\n  go() { this.router.navigate(['/a']) } }
export abstract class Other { abstract go(): void }
export class OtherB extends Other { constructor(private router: Router) { super() }\n  go() { this.router.navigate(['/b']) } }`,
      '/app/x.component.ts': page('X', 'Nav', 'go').replace("@Component({", "@Component({ providers: [{ provide: Nav, useClass: NavA }],"),
      '/app/y.component.ts': page('Y', 'Other', 'go'),
      '/app/a.component.ts': leaf('A'), '/app/b.component.ts': leaf('B'),
    }), '/app', { attribution: true })
    expect(pairsTo(graph, 'services.ts')).toEqual([`${routeId('/x')}>${routeId('/a')}`, `${routeId('/y')}>${routeId('/b')}`])
  })

  it('reads a field initialised with inject(), and does not loop on a cycle of calls', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routes([['x', 'X'], ['a', 'A']]),
      '/app/services.ts': `import { inject } from '@angular/core'\nimport { Router } from '@angular/router'\nexport class Nav { router = inject(Router)\n  ping() { this.pong() }\n  pong() { this.ping(); this.router.navigate(['/a']) } }`,
      '/app/x.component.ts': `import { Component, inject } from '@angular/core'\nimport { Nav } from './services'\n@Component({ selector: 'x-x', standalone: true, template: '<b (click)="go()"></b>' })\nexport class X { nav = inject(Nav)\n  go() { this.nav.ping() } }`,
      '/app/a.component.ts': leaf('A'),
    }), '/app', { attribution: true })
    expect(pairsTo(graph, 'services.ts')).toEqual([`${routeId('/x')}>${routeId('/a')}`])
  })

  it('falls back to the class-level join for a member no caller reaches, and keeps every such edge at may', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routes([['x', 'X'], ['a', 'A']]),
      '/app/services.ts': `import { Router } from '@angular/router'\nexport class Nav { constructor(private router: Router) {}\n  unused() { this.router.navigate(['/a']) } }`,
      '/app/x.component.ts': `import { Component } from '@angular/core'\nimport { Nav } from './services'\n@Component({ selector: 'x-x', standalone: true, template: '<p>x</p>' })\nexport class X { constructor(private nav: Nav) {} }`,
      '/app/a.component.ts': leaf('A'),
    }), '/app', { attribution: true })
    const edges = graph.edges.filter((e) => e.witness?.file === 'services.ts')
    expect(edges.map((e) => `${e.from}>${e.to}`)).toEqual([`${routeId('/x')}>${routeId('/a')}`])
    expect(edges.every((e) => e.modality === 'may')).toBe(true)
  })

  it('places a member the shell calls on every screen', () => {
    const { graph } = extractGraph(inMemory({
      '/app/main.ts': `import { bootstrapApplication } from '@angular/platform-browser'\nimport { App } from './app.component'\nbootstrapApplication(App)`,
      '/app/app.component.ts': `import { Component } from '@angular/core'\nimport { Nav } from './services'\n@Component({ selector: 'app-root', template: '<b (click)="go()"></b><router-outlet></router-outlet>' })\nexport class App { constructor(private svc: Nav) {}\n  go() { this.svc.toA() } }`,
      '/app/app.routes.ts': routes([['x', 'X'], ['a', 'A']]),
      '/app/services.ts': `import { Router } from '@angular/router'\nexport class Nav { constructor(private router: Router) {}\n  toA() { this.router.navigate(['/a']) } }`,
      '/app/x.component.ts': leaf('X'), '/app/a.component.ts': leaf('A'),
    }), '/app', { attribution: true })
    expect(pairsTo(graph, 'services.ts')).toEqual(['n_scope_shell>' + routeId('/a')])
  })
})

/** A router the services below inject; `navigate` is all they call on it. */
const svcHead = `import { Router } from '@angular/router'\n`
/** A component with the given template and body, injecting `deps` as constructor parameters. */
const comp = (cls: string, imports: string, deps: string, body: string, tpl = '<p>x</p>', extra = '') =>
  `import { Component } from '@angular/core'\n${imports}\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '${tpl}'${extra} })\nexport class ${cls} { constructor(${deps}) {}\n${body} }`

describe('a call lands on the declaration its name denotes, not on every class of that name', () => {
  it('resolves this to the caller\'s own class, so a namesake with no such member never reaches a base class', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Tab as SavingsTab } from './savings/tab.component'\nimport { Tab as LoansTab } from './loans/tab.component'\nimport { A } from './a.component'\nimport { B } from './b.component'\nexport const routes: Routes = [{ path: 'savings', component: SavingsTab }, { path: 'loans', component: LoansTab }, { path: 'a', component: A }, { path: 'b', component: B }]`,
      '/app/savings/tab.component.ts': comp('Tab', `import { Router } from '@angular/router'`, 'private router: Router', `  private reload() { this.router.navigate(['/b']) }\n  go() { this.reload() }`, '<b (click)="go()"></b>'),
      '/app/loans/tab.component.ts': comp('Tab', `import { Base } from '../base'`, '', `  go() { this.reload() }`, '<b (click)="go()"></b>').replace('class Tab {', 'class Tab extends Base {').replace('constructor() {}', 'constructor() { super() }'),
      '/app/base.ts': `${svcHead}export class Base { constructor(protected router: Router) {}\n  protected reload() { this.router.navigate(['/a']) } }`,
      '/app/a.component.ts': leaf('A'), '/app/b.component.ts': leaf('B'),
    }), '/app', { attribution: true })
    expect(pairsTo(graph, 'base.ts')).toEqual([`${routeId('/loans')}>${routeId('/a')}`])
  })

  it('resolves a field type through its import, so a service of the same name elsewhere is not a target', () => {
    const svc = (to: string) => `${svcHead}export class Svc { constructor(private router: Router) {}\n  go() { this.router.navigate(['/${to}']) } }`
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routes([['x', 'X'], ['y', 'Y'], ['a', 'A'], ['b', 'B']]),
      '/app/a/svc.ts': svc('a'), '/app/b/svc.ts': svc('b'),
      '/app/x.component.ts': comp('X', `import { Svc } from './a/svc'`, 'private svc: Svc', '  go() { this.svc.go() }', '<b (click)="go()"></b>'),
      '/app/y.component.ts': comp('Y', `import { Svc } from './b/svc'`, 'private svc: Svc', '  go() { this.svc.go() }', '<b (click)="go()"></b>'),
      '/app/a.component.ts': leaf('A'), '/app/b.component.ts': leaf('B'),
    }), '/app', { attribution: true })
    expect(pairsTo(graph, 'a/svc.ts')).toEqual([`${routeId('/x')}>${routeId('/a')}`])
    expect(pairsTo(graph, 'b/svc.ts')).toEqual([`${routeId('/y')}>${routeId('/b')}`])
  })
})

describe('which provider bindings the call graph reads', () => {
  /** Three classes with a `go`, and a component that calls it on the first; `extra` adds the provider files. */
  const project = (extra: Record<string, string>) => inMemory({
    '/app/services.ts': `export class Nav { go() {} }\nexport class NavImpl { go() {} }\nexport class Other { go() {} }`,
    '/app/x.component.ts': `import { Nav } from './services'\nexport class X { constructor(private nav: Nav) {}\n  run() { this.nav.go() } }`,
    ...extra,
  })
  const seeds = new Map([['/app/x.component.ts', new Set(['S'])]])
  /** The `go` members the call graph gives a screen, as `Class.go`. */
  const placed = (p: Project, loaded?: Set<string>) => [...memberScopes(p.getSourceFiles(), seeds, loaded).screens.keys()].filter((k) => k.endsWith('.go')).map((k) => k.replace('/app/services.ts#', '')).sort()

  it('ignores a binding written in a file the application does not load', () => {
    const p = project({ '/sibling/providers.ts': `import { Nav, NavImpl } from '../app/services'\nexport const p = [{ provide: Nav, useClass: NavImpl }]` })
    expect(placed(p, new Set(['/app/services.ts', '/app/x.component.ts']))).toEqual(['Nav.go'])
  })

  it('does not place a sibling application\'s binding on the screens that call the token', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routes([['x', 'X'], ['a', 'A'], ['b', 'B']]),
      '/app/services.ts': `${svcHead}export class Nav { constructor(private router: Router) {}\n  go() { this.router.navigate(['/a']) } }`,
      '/app/x.component.ts': page('X', 'Nav', 'go'),
      '/app/a.component.ts': leaf('A'), '/app/b.component.ts': leaf('B'),
      '/sibling/other.ts': `${svcHead}import { Nav } from '../app/services'\nexport class OtherNav { constructor(private router: Router) {}\n  go() { this.router.navigate(['/b']) } }\nexport const p = [{ provide: Nav, useClass: OtherNav }]`,
    }), '/app', { attribution: true })
    expect(graph.edges.filter((e) => e.to === routeId('/b'))).toEqual([])
    expect(pairsTo(graph, 'services.ts')).toEqual([`${routeId('/x')}>${routeId('/a')}`])
  })

  it('keeps the token\'s own class beside the class it is bound to', () => {
    const p = project({ '/app/providers.ts': `import { Nav, NavImpl } from './services'\nexport const p = [{ provide: Nav, useExisting: NavImpl }]` })
    expect(placed(p)).toEqual(['Nav.go', 'NavImpl.go'])
  })

  it('falls back to the token\'s own class when the bound value is no class', () => {
    const p = project({ '/app/providers.ts': `import { Nav, Other } from './services'\ndeclare const forwardRef: any, cond: boolean\nexport const p = [{ provide: Nav, useClass: forwardRef(() => Other) }, { provide: Nav, useClass: cond ? Other : Other }]` })
    expect(placed(p)).toEqual(['Nav.go'])
  })
})

describe('what the resolution counts count', () => {
  it('counts a call only where it lands on a member an application class declares', () => {
    const p = inMemory({
      '/app/services.ts': `export class Svc { go() {} }`,
      '/app/x.component.ts': `import { Svc } from './services'\nexport class X { constructor(private svc: Svc) {}\n  run() { this.svc.go(); this.svc.inherited(); this.svc.inherited() } }`,
    })
    const { resolved } = memberScopes(p.getSourceFiles(), new Map([['/app/x.component.ts', new Set(['S'])]]))
    expect(resolved).toEqual({ direct: 1, bound: 0, subclass: 0, unresolved: 0 })
  })
})

describe('callers the graph reads beyond a component\'s own calls', () => {
  const auth = `${svcHead}export class AuthService { constructor(private router: Router) {}\n  logout() { this.router.navigate(['/login']) } }`

  it('reads a call a template makes on an injected field, so the shell\'s call puts the member at top', () => {
    const { graph } = extractGraph(inMemory({
      '/app/main.ts': `import { bootstrapApplication } from '@angular/platform-browser'\nimport { App } from './app.component'\nbootstrapApplication(App)`,
      '/app/app.component.ts': comp('App', `import { AuthService } from './services'`, 'public auth: AuthService', '', '<b (click)="auth.logout()"></b><router-outlet></router-outlet>').replace("selector: 'x-app'", "selector: 'app-root'"),
      '/app/app.routes.ts': routes([['settings', 'Settings'], ['login', 'Login']]),
      '/app/services.ts': auth,
      '/app/settings.component.ts': comp('Settings', `import { AuthService } from './services'`, 'private auth: AuthService', '  leave() { this.auth.logout() }', '<b (click)="leave()"></b>'),
      '/app/login.component.ts': leaf('Login'),
    }), '/app', { attribution: true })
    expect(pairsTo(graph, 'services.ts')).toEqual(['n_scope_shell>' + routeId('/login')])
  })

  it('seeds an effect class at top, so a member it calls runs on every screen', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routes([['y', 'Y'], ['a', 'A']]),
      '/app/services.ts': `${svcHead}export class Nav { constructor(private router: Router) {}\n  goA() { this.router.navigate(['/a']) } }`,
      '/app/y.component.ts': page('Y', 'Nav', 'goA'),
      '/app/fx.ts': `import { createEffect } from '@ngrx/effects'\nimport { Nav } from './services'\nexport class Fx { constructor(private nav: Nav) {}\n  e = createEffect(() => { this.nav.goA(); return null as any }, { dispatch: false }) }`,
      '/app/a.component.ts': leaf('A'),
    }), '/app', { attribution: true })
    expect(pairsTo(graph, 'services.ts')).toEqual(['n_scope_shell>' + routeId('/a')])
  })

  describe('a member that something the graph does not follow also calls', () => {
    /** A service with two navigating members, called from two components; `guard` is the file that also calls `goA`. */
    const navigating = (guard: string) => ({
      '/app/app.routes.ts': routes([['x', 'X'], ['y', 'Y'], ['a', 'A'], ['b', 'B']]),
      '/app/services.ts': `${svcHead}export class Nav { constructor(private router: Router) {}\n  goA() { this.router.navigate(['/a']) }\n  goB() { this.router.navigate(['/b']) } }`,
      '/app/x.component.ts': page('X', 'Nav', 'goA'),
      '/app/y.component.ts': page('Y', 'Nav', 'goB'),
      '/app/guard.ts': guard,
      '/app/a.component.ts': leaf('A'), '/app/b.component.ts': leaf('B'),
    })
    it.each([
      ['a guard class', `import { Nav } from './services'\nexport class AuthGuard { constructor(private nav: Nav) {}\n  canActivate() { this.nav.goA(); return true } }`],
      ['a functional guard', `import { inject } from '@angular/core'\nimport { Nav } from './services'\nexport const canGo = () => { inject(Nav).goA(); return true }`],
      ['a functional guard holding it in a local', `import { inject } from '@angular/core'\nimport { Nav } from './services'\nexport const canGo = () => { const nav = inject(Nav); nav.goA(); return true }`],
      ['a helper that is handed it', `import { Nav } from './services'\nexport function run(nav: Nav) { nav.goA() }`],
    ])('takes the union with the class-level join when %s calls it', (_name, guard) => {
      const { graph } = extractGraph(inMemory(navigating(guard)), '/app', { attribution: true })
      expect(pairsTo(graph, 'services.ts')).toEqual([`${routeId('/x')}>${routeId('/a')}`, `${routeId('/y')}>${routeId('/a')}`, `${routeId('/y')}>${routeId('/b')}`])
    })

    it('keeps a member on its own callers when the other injectors only read fields or call other members', () => {
      const { graph } = extractGraph(inMemory({
        '/app/main.ts': `import { bootstrapApplication } from '@angular/platform-browser'\nimport { App } from './app.component'\nbootstrapApplication(App)`,
        '/app/app.component.ts': `import { Component, inject } from '@angular/core'\nimport { Users } from './services'\n@Component({ selector: 'app-root', template: '<router-outlet></router-outlet>' })\nexport class App { users = inject(Users)\n  current = this.users.name }`,
        '/app/app.routes.ts': routes([['settings', 'Settings'], ['login', 'Login']]),
        '/app/services.ts': `${svcHead}export class Users { name = 'n'\n  constructor(private router: Router) {}\n  purge() {}\n  logout() { this.purge(); this.router.navigate(['/login']) } }`,
        '/app/interceptor.ts': `import { inject } from '@angular/core'\nimport { Users } from './services'\nexport const intercept = () => { const users = inject(Users); users.purge() }`,
        '/app/settings.component.ts': comp('Settings', `import { Users } from './services'`, 'private users: Users', '  leave() { this.users.logout() }', '<b (click)="leave()"></b>'),
        '/app/login.component.ts': leaf('Login'),
      }), '/app', { attribution: true })
      expect(pairsTo(graph, 'services.ts')).toEqual([`${routeId('/settings')}>${routeId('/login')}`])
    })
  })
})

describe('a shell elected from a component whose mounting route the walk lost', () => {
  /** Two routes at the empty path, so the walk keeps the first and drops `UserLayout`, which holds an outlet and the nav that calls a bound service. */
  const lost = () => inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { Frontend } from './frontend.component'
import { UserLayout } from './layout.component'
import { Login } from './login.component'
import { Vault } from './vault.component'
import { Premium } from './premium.component'
export const routes: Routes = [{ path: '', component: Frontend, children: [{ path: 'login', component: Login }] }, { path: '', component: UserLayout, children: [{ path: 'vault', component: Vault }] }, { path: 'premium', component: Premium }]`,
    '/app/frontend.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-frontend', standalone: true, template: '<router-outlet></router-outlet>' })\nexport class Frontend {}`,
    '/app/layout.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-layout', standalone: true, template: '<x-nav></x-nav><a routerLink="/premium">p</a><router-outlet></router-outlet>' })\nexport class UserLayout {}`,
    '/app/nav.component.ts': comp('Nav', `import { Prompt } from './prompt'`, 'private prompt: Prompt', '  go() { this.prompt.upgrade() }', '<b (click)="go()"></b>'),
    '/app/vault.component.ts': comp('Vault', `import { Prompt } from './prompt'`, 'private prompt: Prompt', '  go() { this.prompt.upgrade() }', '<b (click)="go()"></b>'),
    '/app/prompt.ts': `export abstract class Prompt { abstract upgrade(): void }`,
    '/app/web-prompt.ts': `${svcHead}import { Prompt } from './prompt'\nexport class WebPrompt extends Prompt { constructor(private router: Router) { super() }\n  upgrade() { this.router.navigate(['/premium']) } }`,
    '/app/providers.ts': `import { Prompt } from './prompt'\nimport { WebPrompt } from './web-prompt'\nexport const p = [{ provide: Prompt, useClass: WebPrompt }]`,
    '/app/login.component.ts': leaf('Login'), '/app/premium.component.ts': leaf('Premium'),
  })

  it('does not put what it calls on every screen', () => {
    const { graph } = extractGraph(lost(), '/app', { attribution: true })
    expect(pairsTo(graph, 'web-prompt.ts')).toEqual([`${routeId('/vault')}>${routeId('/premium')}`])
  })

  it('holds its own links at may and says that no route mounts it', () => {
    const { graph, soundiness } = extractGraph(lost(), '/app', { attribution: true })
    const own = graph.edges.filter((e) => e.witness?.file === 'layout.component.ts' && e.to === routeId('/premium'))
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((e) => e.modality === 'may')).toBe(true)
    expect(soundiness.some((s) => s.kind === 'indirect-shell')).toBe(true)
  })
})

describe('the note of a site placed on several screens', () => {
  it('is recorded once, whether the call graph or the class join places the site', () => {
    const { soundiness } = extractGraph(inMemory({
      '/app/app.routes.ts': routes([['x', 'X'], ['y', 'Y']]),
      '/app/services.ts': `${svcHead}export class Nav { constructor(private router: Router) {}\n  used() { this.router.navigate(['/nowhere']) }\n  unused() { this.router.navigate(['/gone']) } }`,
      '/app/x.component.ts': page('X', 'Nav', 'used'),
      '/app/y.component.ts': page('Y', 'Nav', 'used'),
    }), '/app', { attribution: true })
    const notes = soundiness.filter((s) => s.kind === 'unresolved-target' && s.file === 'services.ts').map((s) => s.detail.match(/"([^"]+)"/)?.[1]).sort()
    expect(notes).toEqual(['/gone', '/nowhere'])
  })
})
