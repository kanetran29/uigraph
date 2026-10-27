import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { validateGraph } from '@ui-graph/core'
import { extractGraph } from './extract'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

const C = (tpl: string, extra = '') =>
  `import { Component } from '@angular/core'\n@Component({ standalone: true, template: '${tpl}' })\nexport class X { ${extra} }`

/**
 * Cases a red-team panel reproduced against this adapter. Each one made the graph claim a
 * destination the source does not have, which is the one thing a must edge may never do.
 */
describe('adapter regressions — a wrong destination is worse than none', () => {
  it('does not take a builder call apart by its first string argument', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [\n  { path: 'clients/:id/settings', component: A },\n  { path: 'settings/profile', component: A },\n]`,
        '/urls.ts': `export const urls = { build: (id: string, tail: string) => '/clients/' + id + '/' + tail }`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { urls } from './urls'\n@Component({ standalone: true, template: '<p>a</p>' })\nexport class A { go(id: string) { this.router.navigate(urls.build(id, 'settings')) } router: any }`,
      }),
      '/',
    )
    const wrong = graph.edges.filter((e) => e.to === 'n_settings_profile' && e.modality === 'must')
    expect(wrong).toHaveLength(0)
  })

  it('does not follow a field that is assigned again after its initializer', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: '', component: A }, { path: 'home', component: A }, { path: 'away', component: A }]`,
        '/table.ts': `export const table = { home: { routerLink: ['/home'] } }`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { table } from './table'\n@Component({ standalone: true, template: '<a [routerLink]="dest">go</a>' })\nexport class A { dest = table.home.routerLink; ngOnInit() { this.dest = ['/away'] } }`,
      }),
      '/',
    )
    expect(graph.edges.filter((e) => e.modality === 'must' && e.to === 'n_home')).toHaveLength(0)
  })

  it('does not read createEffect out of a comment', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'admin', component: A }]`,
        '/a.component.ts': C('<p>a</p>'),
        '/thing.service.ts': `// TODO: move this to createEffect( ... ) one day\nexport class ThingService { constructor(private router: any) {} go() { this.router.navigate(['/admin']) } }`,
      }),
      '/',
      { attribution: true },
    )
    expect(graph.edges.filter((e) => e.from === 'n_scope_shell')).toHaveLength(0)
  })

  it('keeps a localized route segment free of its metadata block', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: $localize\`:Section: the about page@@route.about:about\`, component: A }]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/about'])
    expect(validateGraph(graph)).toEqual([])
  })

  it('reads a children array built by a spread', () => {
    const { graph } = extractGraph(
      inMemory({
        '/admin.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const adminRoutes: Routes = [{ path: 'users', component: A }]`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { adminRoutes } from './admin.routes'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'admin', component: A, children: [...adminRoutes] }]`,
        '/a.component.ts': C('<a routerLink="/admin/users">u</a>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/admin', '/admin/users'])
  })

  it('resolves a link to the root through a wildcard redirect', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [\n  { path: 'home', component: A },\n  { path: '**', redirectTo: 'home', pathMatch: 'full' },\n]`,
        '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, template: \`<a [routerLink]="['/']">root</a>\` })\nexport class X {}`,
      }),
      '/',
    )
    expect(graph.edges.some((e) => e.to === 'n_home')).toBe(true)
  })
})
