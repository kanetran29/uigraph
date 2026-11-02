import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { extractGraph } from './extract'
import { routeToNodeId as routeId } from './ids'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}
const routesTo = (paths: string[], home = 'Home') =>
  `import type { Routes } from '@angular/router'\nimport { ${home} } from './home.component'\nimport { T } from './t.component'\nexport const routes: Routes = [{ path: 'home', component: ${home} }, ${paths.map((p) => `{ path: '${p}', component: T }`).join(', ')}]`
const leaf = `import { Component } from '@angular/core'\n@Component({ selector: 'x-t', standalone: true, template: '<p>t</p>' })\nexport class T {}`
const tier = (graph: ReturnType<typeof extractGraph>['graph'], to: string, from = '/home') => graph.edges.find((e) => e.from === routeId(from) && e.to === routeId(to))?.modality

describe('what a template comment hides', () => {
  it('reads no link, binding or placed component inside a comment', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routesTo(['gone', 'a', 'k', 'live']),
      '/app/home.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ selector: 'x-home', standalone: true, template: \`<!-- <a routerLink="/gone">x</a> <button (click)="goA()"></button> <x-kid></x-kid> --><a routerLink="/live">l</a>\` })\nexport class Home { constructor(private router: Router) {}\n  goA() { this.router.navigate(['/a']) } }`,
      '/app/kid.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-kid', standalone: true, template: '<a routerLink="/k">k</a>' })\nexport class Kid {}`,
      '/app/t.component.ts': leaf,
    }), '/app', { attribution: true })
    expect(tier(graph, '/gone')).toBeUndefined()
    expect(tier(graph, '/a')).toBe('may')
    expect(tier(graph, '/k')).not.toBe('must')
    expect(tier(graph, '/live')).toBe('must')
  })
})

describe('which members are handlers', () => {
  it('takes @HostListener for one, and neither another decorator, a data-on attribute nor a module function', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routesTo(['h', 'd', 'e', 'c']),
      '/app/home.component.ts': `import { Component, HostListener } from '@angular/core'\nimport { Router } from '@angular/router'
export function goC(router: Router) { router.navigate(['/c']) }
@Component({ selector: 'x-home', standalone: true, template: '<span data-on-click="goE()"></span>' })
export class Home { flag = true; constructor(private router: Router) {}
  @HostListener('click') goH() { this.router.navigate(['/h']) }
  @Debounce() goD() { this.router.navigate(['/d']) }
  goE() { this.router.navigate(['/e']) }
  maybe() { if (this.flag) { this.goD(); goC(this.router) } } }`,
      '/app/t.component.ts': leaf,
    }), '/app')
    expect(tier(graph, '/h')).toBe('must')
    for (const p of ['/d', '/e', '/c']) expect(tier(graph, p)).toBe('may')
  })
})

describe('commands and calls the router reads otherwise', () => {
  const { graph } = extractGraph(inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { T } from './t.component'\nimport { G } from './g.component'\nexport const routes: Routes = [{ path: 'home', component: Home }, { path: 'd', component: T, children: [{ path: 'x/y', component: T }] }, { path: 'f', component: T }, { path: 'g', component: T }, { path: 'items', component: T, children: [{ path: 'general', component: G, children: [{ path: 'edit', component: T }] }, { path: 'edit', component: T }] }]`,
    '/app/home.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ selector: 'x-home', standalone: true, template: '<b (click)="go()"></b><b (click)="two()"></b><mat-menu><a routerLink="/f">m</a></mat-menu>' })\nexport class Home { constructor(private router: Router) {}\n  go() { this.router.navigate(['/d', 'x/y']) }\n  two() { this.router.navigate(['/f']); this.router.navigate(['/g']) } }`,
    '/app/g.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-g', standalone: true, template: '<a routerLink="edit" [class.on]="n > 0" [relativeTo]="route.parent">e</a>' })\nexport class G { n = 1 }`,
    '/app/t.component.ts': leaf,
  }), '/app')

  it('keeps a later command whole, so a slash in it reaches no nested route', () => {
    expect(tier(graph, '/d/x/y')).toBeUndefined()
  })
  it('holds a navigation a later one in the same block supersedes at may, and keeps the later one', () => {
    expect(graph.edges.find((e) => e.from === routeId('/home') && e.to === routeId('/f') && e.event === 'navigate')?.modality).toBe('may')
    expect(tier(graph, '/g')).toBe('must')
  })
  it('reads a link inside a lazy container as conditional', () => {
    expect(graph.edges.find((e) => e.from === routeId('/home') && e.to === routeId('/f') && e.event === 'click:routerLink')?.modality).toBe('may')
  })
  it('sees a bound relativeTo past a quoted >', () => {
    expect(graph.edges.filter((e) => e.from === routeId('/items/general')).every((e) => e.modality === 'may')).toBe(true)
  })
})

describe('a navigation code after it may cancel', () => {
  const { graph } = extractGraph(inMemory({
    '/app/app.routes.ts': routesTo(['a', 'b', 'c', 'd', 'e', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'o']),
    '/app/nav.service.ts': `import { Injectable } from '@angular/core'\nimport { Router } from '@angular/router'\n@Injectable({ providedIn: 'root' })\nexport class NavService { constructor(private router: Router) {}\n  away() { this.router.navigate(['/f']) } }`,
    '/app/home.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\nimport { NavService } from './nav.service'
export function leave(router: Router) { router.navigate(['/n']) }
@Component({ selector: 'x-home', standalone: true, template: '<b (click)="branch(1)"></b><b (click)="helper()"></b><b (click)="service()"></b><b (click)="nested()"></b><b (click)="fin()"></b><b (click)="moduleFn()"></b><b (click)="quiet()"></b><b (click)="awaited()"></b>' })
export class Home { constructor(private router: Router, private nav: NavService) {}
  branch(x: number) { this.router.navigate(['/a']); if (x) { this.router.navigate(['/b']) } }
  helper() { this.router.navigate(['/c']); this.go() }
  go() { this.router.navigate(['/d']) }
  service() { this.router.navigate(['/e']); this.nav.away() }
  nested() { { this.router.navigate(['/g']) } this.router.navigate(['/h']) }
  fin() { try { this.router.navigate(['/i']) } finally { this.router.navigate(['/j']) } }
  moduleFn() { this.router.navigate(['/o']); leave(this.router) }
  quiet() { this.router.navigate(['/k']); this.log() }
  log() { console.log('k') }
  async awaited() { await this.router.navigate(['/l']); this.router.navigate(['/m']) } }`,
    '/app/t.component.ts': leaf,
  }), '/app')

  it('holds a navigation at may when a later branch of its handler may navigate', () => {
    expect(tier(graph, '/a')).toBe('may')
  })
  it('holds it at may when a later call to a member of the class navigates, and keeps that member\'s navigation', () => {
    expect(tier(graph, '/c')).toBe('may')
    expect(tier(graph, '/d')).toBe('must')
  })
  it('holds it at may when a later call into an injected service navigates', () => {
    expect(tier(graph, '/e')).toBe('may')
  })
  it('holds it at may when a later module-level function of the file navigates', () => {
    expect(tier(graph, '/o')).toBe('may')
  })
  it('looks past the block that holds it, to the statements after every enclosing block', () => {
    expect(tier(graph, '/g')).toBe('may')
    expect(tier(graph, '/h')).toBe('must')
  })
  it('counts a finally block as code that runs after it', () => {
    expect(tier(graph, '/i')).toBe('may')
    expect(tier(graph, '/j')).toBe('must')
  })
  it('keeps a navigation on must when what follows it cannot navigate', () => {
    expect(tier(graph, '/k')).toBe('must')
  })
  it('keeps an awaited navigation on must, since it finishes before the next one starts', () => {
    expect(tier(graph, '/l')).toBe('must')
    expect(tier(graph, '/m')).toBe('may')
  })
})

describe('code that runs after a navigation outside the statements that follow it', () => {
  const { graph } = extractGraph(inMemory({
    '/app/app.routes.ts': routesTo(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n']),
    '/app/home.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'
@Component({ selector: 'x-home', standalone: true, template: '<b (click)="arg()"></b><b (click)="operand()"></b><b (click)="then()"></b><b (click)="go()"></b><b (click)="h()"></b><b (click)="slow()"></b><b (click)="h2()"></b><b (click)="cond()"></b><b (click)="list()"></b>' })
export class Home { constructor(private router: Router) {}
  cond() { return this.router.navigate(['/m']) ? this.leave() : 0 }
  list() { return [this.router.navigate(['/n']), this.leave()] }
  arg() { this.consume(this.router.navigate(['/a'])) }
  consume(p: unknown) { this.router.navigate(['/b']) }
  operand() { this.router.navigate(['/c']) || this.leave() }
  leave() { this.router.navigate(['/d']) }
  then() { this.router.navigate(['/e']).then(() => this.router.navigate(['/f'])) }
  go() { this.router.navigate(['/g']) }
  h() { this.go(); this.router.navigate(['/h']) }
  async slow() { await this.router.navigate(['/i']) }
  h2() { this.slow(); this.router.navigate(['/j']) }
  ngOnInit() { this.router.navigate(['/k']) }
  ngAfterViewInit() { this.router.navigate(['/l']) } }`,
    '/app/t.component.ts': leaf,
  }), '/app')
  const navigate = (to: string) => graph.edges.find((e) => e.from === routeId('/home') && e.to === routeId(to) && e.event === 'navigate')?.modality

  it('counts the body of a call the navigation is an argument of, which runs after it', () => {
    expect(navigate('/a')).toBe('may')
  })
  it('counts the right operand of an expression whose left operand it is', () => {
    expect(navigate('/c')).toBe('may')
  })
  it('counts both branches of a conditional whose condition it is', () => {
    expect(navigate('/m')).toBe('may')
  })
  it('counts the elements of an array literal that follow it', () => {
    expect(navigate('/n')).toBe('may')
  })
  it('does not count a callback the navigation\'s own promise runs once it has finished', () => {
    expect(navigate('/e')).toBe('must')
  })
  it('counts what a caller does after calling the member that holds it, even when the member is a handler too', () => {
    expect(navigate('/g')).toBe('may')
    expect(navigate('/h')).toBe('must')
  })
  it('counts what a caller does after an async member returns, which is before an awaited navigation finishes', () => {
    expect(navigate('/i')).toBe('may')
  })
  it('counts a navigation in a lifecycle hook Angular calls later', () => {
    expect(navigate('/k')).toBe('may')
    expect(navigate('/l')).toBe('must')
  })
})

describe('a route component behind a conditional outlet', () => {
  it('holds its links at may, and keeps those of one behind a plain outlet', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { P } from './p.component'\nimport { Q } from './q.component'\nimport { C } from './c.component'\nimport { T } from './t.component'\nexport const routes: Routes = [{ path: 'p', component: P, children: [{ path: 'c', component: C }] }, { path: 'q', component: Q, children: [{ path: 'c', component: C }] }, { path: 'x', component: T }]`,
      '/app/p.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-p', standalone: true, template: '@if (ready) { <router-outlet></router-outlet> }' })\nexport class P { ready = false }`,
      '/app/q.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-q', standalone: true, template: '<router-outlet></router-outlet>' })\nexport class Q {}`,
      '/app/c.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-c', standalone: true, template: '<a routerLink="/x">x</a>' })\nexport class C {}`,
      '/app/t.component.ts': leaf,
    }), '/app')
    expect(tier(graph, '/x', '/p/c')).toBe('may')
    expect(tier(graph, '/x', '/q/c')).toBe('must')
  })
})

describe('the demotions no other rule happens to cover', () => {
  it('holds a link in a shell no route visibly mounts at may although the link is unconditional', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routesTo(['x']),
      '/app/home.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-home', standalone: true, template: '<p>h</p>' })\nexport class Home {}`,
      '/app/root.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-root', standalone: true, template: '<x-layout></x-layout><a routerLink="/x">x</a>' })\nexport class Root {}`,
      '/app/layout.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-layout', standalone: true, template: '<router-outlet></router-outlet>' })\nexport class Layout {}`,
      '/app/t.component.ts': leaf,
    }), '/app', { attribution: true })
    const fromRoot = graph.edges.filter((e) => e.to === routeId('/x') && e.witness?.file === 'root.component.ts')
    expect(fromRoot.length).toBeGreaterThan(0)
    expect(fromRoot.every((e) => e.modality === 'may')).toBe(true)
  })

  it('reads a component placed by an attribute selector under a condition as conditionally mounted', () => {
    const kid = (cls: string, sel: string, to: string) => `import { Component } from '@angular/core'\n@Component({ selector: '[${sel}]', standalone: true, template: '<a routerLink="${to}">k</a>' })\nexport class ${cls} {}`
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': routesTo(['k', 'f']),
      '/app/home.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-home', standalone: true, template: '@if (flag) { <div x-kid></div> }<div x-firm></div>' })\nexport class Home { flag = true }`,
      '/app/kid.component.ts': kid('Kid', 'x-kid', '/k'),
      '/app/firm.component.ts': kid('Firm', 'x-firm', '/f'),
      '/app/t.component.ts': leaf,
    }), '/app', { attribution: true })
    expect(tier(graph, '/k')).toBe('may')
    expect(tier(graph, '/f')).toBe('must')
  })

  it('holds a commands array with a hole before a constant at may, and keeps a whole one on must', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { T } from './t.component'\nexport const routes: Routes = [{ path: 'home', component: Home }, { path: 'view/:id/edit', component: T }, { path: 'plain', component: T }]`,
      '/app/home.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ selector: 'x-home', standalone: true, template: '<b (click)="go(r)"></b><b (click)="plain()"></b>' })\nexport class Home { r = { id: 1 }; constructor(private router: Router) {}\n  go(row: { id: number }) { this.router.navigate(['/view', row.id, 'edit']) }\n  plain() { this.router.navigate(['/plain']) } }`,
      '/app/t.component.ts': leaf,
    }), '/app')
    expect(tier(graph, '/view/:id/edit')).toBe('may')
    expect(tier(graph, '/plain')).toBe('must')
  })
})

describe('controls mode, link by link', () => {
  it("holds a relative link, a link to the control's own screen, one into a resolver and a commands array with a hole at may, and keeps a plain one on must", () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { T } from './t.component'\nexport class R { resolve() { return null } }\nexport const routes: Routes = [{ path: 'home', component: Home }, { path: 'edit', component: T }, { path: 'data', component: T, resolve: { d: R } }, { path: 'plain', component: T }, { path: 'view/:id/edit', component: T }]`,
      '/app/home.component.ts': `import { Component } from '@angular/core'\nimport { Router } from '@angular/router'\n@Component({ selector: 'x-home', standalone: true, template: '<a data-testid="r" routerLink="edit">r</a><a data-testid="s" routerLink="/home">s</a><a data-testid="d" routerLink="/data">d</a><a data-testid="p" routerLink="/plain">p</a><button data-testid="h" (click)="view(row)">h</button>' })\nexport class Home { row = { id: 1 }; constructor(private router: Router) {}\n  view(r: { id: number }) { this.router.navigate(['/view', r.id, 'edit']) } }`,
      '/app/t.component.ts': leaf,
    }), '/app', { controls: true })
    const tierOf = (id: string) => {
      const c = graph.nodes.find((n) => n.kind === 'control' && n.control?.selector?.value === id)
      return graph.edges.find((e) => e.from === c?.id)?.modality
    }
    expect(tierOf('r')).toBe('may')
    expect(tierOf('s')).toBe('may')
    expect(tierOf('d')).toBe('may')
    expect(tierOf('p')).toBe('must')
    expect(tierOf('h')).toBe('may')
  })

  it('holds every link on a screen a redirect answers at may', () => {
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { T } from './t.component'\nexport const routes: Routes = [{ path: 'home', redirectTo: 'plain' }, { path: 'home', component: Home }, { path: 'plain', component: T }]`,
      '/app/home.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'x-home', standalone: true, template: '<a data-testid="p" routerLink="/plain">p</a>' })\nexport class Home {}`,
      '/app/t.component.ts': leaf,
    }), '/app', { controls: true })
    const c = graph.nodes.find((n) => n.kind === 'control' && n.control?.selector?.value === 'p')
    expect(graph.edges.find((e) => e.from === c?.id)?.modality).toBe('may')
  })
})
