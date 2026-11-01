import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { extractGraph } from './extract'
import { routeToNodeId as routeId } from './ids'

/** A project of in-memory files, keyed by path. */
function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

const routes = `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { T } from './t.component'\nexport const routes: Routes = [{ path: 'home', component: Home }, { path: 'y', component: T }]`
const leaf = `import { Component } from '@angular/core'\n@Component({ selector: 'x-t', standalone: true, template: '<p>t</p>' })\nexport class T {}`
/** A service whose constructor navigates to /y: a navigation that runs on every execution of the class. */
const navigatingCtor = `import { Router } from '@angular/router'\nexport class Svc { constructor(private router: Router) { this.router.navigate(['/y']) } }`
/** The same, but the navigation is in `go`, which the constructor calls, so `go` runs whenever the class is built. */
const navigatingGo = `import { Router } from '@angular/router'\nexport class Svc { constructor(private router: Router) { this.go() }\n  go() { this.router.navigate(['/y']) } }`
/** A component with the given constructor parameters and body, which can inject `Svc`. */
const component = (cls: string, deps: string, body: string, tpl = '<p>x</p>') =>
  `import { Component } from '@angular/core'\nimport { Svc } from './svc'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '${tpl}' })\nexport class ${cls} { constructor(${deps}) {}\n${body} }`
/** The routed `Home` component. */
const home = (deps: string, body: string) => ({ '/app/home.component.ts': component('Home', deps, body) })
/** The root component, which holds the outlet and so is the shell. */
const root = (deps: string, body: string) => ({ '/app/app.component.ts': component('App', deps, body, '<router-outlet></router-outlet>') })

/**
 * Each placement of a service or effect navigation holds the edge at may because the calls on the
 * way to it carry conditions the analysis does not follow. The fixtures are navigations nothing in
 * the code itself conditions, so only that hold keeps them off must.
 */
describe('the may cap on a navigation placed by something other than its own screen', () => {
  const cases: [string, Record<string, string>, string][] = [
    ['an NgRx effect, at the shell', {
      '/app/fx.ts': `import { createEffect } from '@ngrx/effects'\nimport { Router } from '@angular/router'\nexport class Fx { constructor(private router: Router) { this.router.navigate(['/y']) }\n  e = createEffect(() => null as any) }`,
      '/app/home.component.ts': component('Home', '', ''),
    }, 'fx.ts'],
    ['the call graph, at the shell', {
      '/app/svc.ts': navigatingGo, ...root('private svc: Svc', '  ngOnInit() { this.svc.go() }'), '/app/home.component.ts': component('Home', '', ''),
    }, 'svc.ts'],
    ['the call graph, on the screens of the callers', {
      '/app/svc.ts': navigatingGo, ...home('private svc: Svc', '  ngOnInit() { this.svc.go() }'),
    }, 'svc.ts'],
    ['a service the shell injects', {
      '/app/svc.ts': navigatingCtor, ...root('private svc: Svc', ''), '/app/home.component.ts': component('Home', '', ''),
    }, 'svc.ts'],
    ['the join over the components that inject the class', {
      '/app/svc.ts': navigatingCtor, ...home('private svc: Svc', ''),
    }, 'svc.ts'],
    ['an unplaced origin', {
      '/app/orphan.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-orphan', standalone: true, template: '<a routerLink="/y">y</a>' })\nexport class Orphan {}`,
      '/app/home.component.ts': component('Home', '', ''),
    }, 'orphan.component.ts'],
  ]

  it.each(cases)('holds a navigation placed by %s at may', (_name, files, witness) => {
    const { graph } = extractGraph(inMemory({ '/app/app.routes.ts': routes, '/app/t.component.ts': leaf, ...files }), '/app', { attribution: true })
    const edges = graph.edges.filter((e) => e.to === routeId('/y') && [e.witness, ...(e.mergedWitnesses ?? [])].some((w) => w?.file === witness))
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.map((e) => e.modality)).toEqual(edges.map(() => 'may'))
  })
})
