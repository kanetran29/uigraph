import { describe, it, expect, afterEach } from 'vitest'
import { Project } from 'ts-morph'
import { extractGraph } from './extract'
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
