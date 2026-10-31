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
