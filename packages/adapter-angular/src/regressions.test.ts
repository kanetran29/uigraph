import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Project } from 'ts-morph'
import { validateGraph } from '@ui-graph/core'
import { buildProject, extractGraph } from './extract'
import { isInsideDir } from './resolve'

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

  it.each([
    ['object destructuring', '({ dest: this.dest } = cfg)'],
    ['array destructuring', '[this.dest] = pair'],
    ['Object.assign', 'Object.assign(this, { dest: [\'/away\'] })'],
  ])('does not follow a field written by %s', (_name, write) => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: '', component: A }, { path: 'home', component: A }, { path: 'away', component: A }]`,
        '/table.ts': `export const table = { home: { routerLink: ['/home'] } }`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { table } from './table'\nconst cfg: any = {}\nconst pair: any = []\n@Component({ standalone: true, template: '<a [routerLink]="dest">go</a>' })\nexport class A { dest = table.home.routerLink; ngOnInit() { ${write} } }`,
      }),
      '/',
    )
    expect(graph.edges.filter((e) => e.modality === 'must' && e.to === 'n_home')).toHaveLength(0)
  })

  it.each([
    ['element access', "this['dest'] = ['/away']"],
    ['Object.assign with an unresolvable source', 'Object.assign(this, cfg.whatever())'],
    ['Object.assign through an alias', 'const asg = Object.assign; asg(this, { dest: [\'/away\'] })'],
    ['Object.assign with a quoted key', "Object.assign(this, { 'dest': ['/away'] })"],
    ['Object.assign with a computed constant key', "Object.assign(this, { ['dest']: ['/away'] })"],
    ['Object.assign with a computed key only run time knows', "Object.assign(this, { [cfg.key]: ['/away'] })"],
    ['Object.assign with a computed template key only run time knows', 'Object.assign(this, { [`des${cfg.tail}`]: [\'/away\'] })'],
    ['a ??= assignment', "this.dest ??= ['/away']"],
    ['a ||= assignment', "this.dest ||= ['/away']"],
    ['a local that holds this', "const self: any = this; self.dest = ['/away']"],
    ['a field that holds this', "(this as any).me = this; (this as any).me.dest = ['/away']"],
    ['a for-of loop variable', "for (this.dest of [['/away']]) { }"],
    ['a for-in loop variable', "for (this.dest in cfg) { }"],
    ['an array spread target', "[...this.dest] = [['/away']]"],
    ['an object rest target', '({ ...this.dest } = cfg)'],
    ['an element access through a reassignable key', "let k = 'other'; k = 'dest'; this[k] = ['/away']"],
  ])('does not follow a field written by %s', (_name, write) => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: '', component: A }, { path: 'home', component: A }, { path: 'away', component: A }]`,
        '/table.ts': `export const table = { home: { routerLink: ['/home'] } }`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { table } from './table'\nconst cfg: any = {}\n@Component({ standalone: true, template: '<a [routerLink]="dest">go</a>' })\nexport class A { dest = table.home.routerLink; ngOnInit() { ${write} } }`,
      }),
      '/',
    )
    expect(graph.edges.filter((e) => e.modality === 'must' && e.to === 'n_home')).toHaveLength(0)
  })

  it('still follows a field nothing writes', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: '', component: A }, { path: 'home', component: A }, { path: 'away', component: A }]`,
        '/table.ts': `export const table = { home: { routerLink: ['/home'] } }`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { table } from './table'\n@Component({ standalone: true, template: '<a [routerLink]="dest">go</a>' })\nexport class A { dest = table.home.routerLink }`,
      }),
      '/',
    )
    expect(graph.edges.filter((e) => e.modality === 'must' && e.to === 'n_home').length).toBeGreaterThan(0)
  })

  it('refuses a localized path it cannot read rather than minting one', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [\n  { path: $localize\`:nav label:about@@v2\`, component: A },\n  { path: 'home', component: A },\n]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    // the message after the block is `about@@v2`, which is no route segment; no node is minted
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
  })

  // The fixture carries ONE backslash into the generated source (`:Section\: about:about`),
  // which is an escaped colon inside the block, so Angular closes the block at the colon
  // before `about` and the message is `about`. It was written with two, which is an escaped
  // BACKSLASH followed by the real closing colon and a message of ` about:about` — a different
  // case, asserted under this case's name, and it passed only while the scan tested the
  // character before a colon instead of walking forward the way Angular does.
  it('keeps an escaped colon inside a localized segment out of the path', () => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: $localize\`:Section\\: about:about\`, component: A }]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/about'])
  })

  it('draws the wildcard edge but says so when the route set has an unreadable path', () => {
    const { graph } = extractGraph(
      inMemory({
        '/routes.ts': `export enum R { Login = 'login' }`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { opaque } from './opaque'\nexport const routes: Routes = [\n  { path: opaque.thing(), component: A },\n  { path: 'home', component: A },\n  { path: '**', redirectTo: 'home' },\n]`,
        '/opaque.ts': `export const opaque = { thing: () => String(Math.random()) }`,
        '/a.component.ts': C('<a routerLink="/login">in</a>'),
      }),
      '/',
    )
    // The edge is where Angular goes, so it is drawn; what the unreadable path changes is the
    // claim, and the note carries it. Gating the EDGE on the count withheld sound edges across
    // a whole application and never fired for an application whose route set was complete.
    expect(graph.edges.filter((e) => e.to === 'n_home')).toHaveLength(1)
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
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: $localize\`:kebab-case@@routes.about:about\`, component: A }]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/about'])
    expect(validateGraph(graph)).toEqual([])
  })

  it('refuses a malformed block rather than reading past it', () => {
    // Angular closes the block at the first unescaped colon, so the message here is
    // ` the about page@@route.about:about`, which is no route segment. An earlier version of
    // this test asserted `/about`, which was this author's misreading of the i18n format
    // rather than Angular's behaviour.
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: $localize\`:Section: the about page@@route.about:about\`, component: A }, { path: 'home', component: A }]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
  })

  /** One backslash, so a fixture reads as the characters the generated file holds and not as a string literal's escapes. */
  const BS = '\\'

  /**
   * Where the metadata block of a `$localize` message ends, taken from Angular's own
   * `findEndOfBlock` (`@angular/localize`, utils/src/messages.ts) and not from the format's
   * prose, which an earlier test in this file misread. That function walks the cooked and the
   * raw text of the template in step: when the raw character is a backslash it skips the raw
   * character after it and tests nothing on that step, otherwise it ends the block at the first
   * cooked colon. The message is the cooked text after that colon.
   *
   * `:meta` + two backslashes + `:about`: the first backslash escapes the second, so the colon
   * after them is a plain one and ends the block; the message is `about`. Asking only whether
   * the character before the colon is a backslash calls this colon escaped and reads on.
   * The same block followed by `:ignored` leaves the message `about:ignored`; a colon makes it
   * no route segment, so the route is refused, where reading on minted `/ignored`.
   * `:Section` + one backslash + `: x:about`: the backslash escapes the colon, which stays in the
   * block; the block ends at the colon after `x` and the message is `about`.
   */
  it.each([
    ['an escaped backslash before the closing colon', `:meta${BS}${BS}:about`, ['/about', '/home']],
    ['an escaped backslash before the closing colon, then a second colon', `:meta${BS}${BS}:about:ignored`, ['/home']],
    ['an escaped colon inside the block', `:Section${BS}: x:about`, ['/about', '/home']],
  ])('ends a localized metadata block where Angular does, with %s', (_name, segment, routes) => {
    const { graph } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: $localize\`${segment}\`, component: A }, { path: 'home', component: A }]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(routes)
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

  it('follows a catch-all screen for a literal no route declares, at may and never at must', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { NotFound } from './not-found.component'\nexport const routes: Routes = [\n  { path: 'home', component: A },\n  { path: '**', component: NotFound },\n]`,
        '/a.component.ts': C('<a routerLink="/nowhere">x</a><a routerLink="/home">h</a>'),
        '/not-found.component.ts': C('<p>404</p>'),
      }),
      '/',
    )
    const toWildcard = graph.edges.filter((e) => e.to === 'n_wildcard')
    expect(toWildcard.map((e) => [e.from, e.modality, e.confidence])).toEqual([['n_home', 'may', 0.5]])
    expect(graph.edges.some((e) => e.from === 'n_home' && e.to === 'n_home' && e.modality === 'must')).toBe(true)
    expect(soundiness.some((n) => n.kind === 'unresolved-target')).toBe(false)
    const notes = soundiness.filter((n) => n.kind === 'wildcard-redirect')
    expect(notes).toHaveLength(1)
    // A downstream generator reads the target out of the first double-quoted string of the detail.
    expect(notes[0]!.detail.match(/"([^"]*)"/)?.[1]).toBe('/nowhere')
    expect(notes[0]!.detail).toMatch(/^literal target "\/nowhere" /)
  })

  it('declares the route set incomplete when a declared path could not be read, and says so in every wildcard note', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\ndeclare const fromElsewhere: string\nexport const routes: Routes = [\n  { path: 'home', component: A },\n  { path: fromElsewhere, component: A },\n  { path: '**', redirectTo: 'home', pathMatch: 'full' },\n]`,
        '/a.component.ts': C('<a routerLink="/nowhere">x</a>'),
      }),
      '/',
    )
    expect(graph.edges.some((e) => e.to === 'n_home')).toBe(true)
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
    const wild = soundiness.filter((n) => n.kind === 'wildcard-redirect')
    expect(wild.length).toBeGreaterThan(0)
    for (const n of wild) expect(n.detail).toMatch(/could not be read/)
  })

  it('leaves the route set complete, and the wildcard notes uncaveated, when every path is readable', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [\n  { path: 'home', component: A },\n  { path: '**', redirectTo: 'home', pathMatch: 'full' },\n]`,
        '/a.component.ts': C('<a routerLink="/nowhere">x</a>'),
      }),
      '/',
    )
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(0)
    const wild = soundiness.filter((n) => n.kind === 'wildcard-redirect')
    expect(wild.length).toBeGreaterThan(0)
    for (const n of wild) expect(n.detail).not.toMatch(/could not be read/)
  })

  it('declares the route set incomplete when a route has a matcher in place of a path, and says so in every wildcard note', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\ndeclare const usersMatcher: any\nexport const routes: Routes = [\n  { path: 'home', component: A },\n  { component: A, matcher: usersMatcher },\n  { path: '**', redirectTo: 'home', pathMatch: 'full' },\n]`,
        '/a.component.ts': C('<a routerLink="/nowhere">x</a>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
    const wild = soundiness.filter((n) => n.kind === 'wildcard-redirect')
    expect(wild.length).toBeGreaterThan(0)
    for (const n of wild) expect(n.detail).toMatch(/could not be read/)
  })

  it.each([
    ['an exact key', { '@scope/feature': ['libs/feature/src/public-api.ts'] }],
    ['a wildcard key', { '@scope/*': ['libs/*/src/public-api.ts'] }],
  ])('mounts a lazy route set behind a tsconfig paths alias with %s under its parent prefix', (_name, paths) => {
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nexport const routes: Routes = [{ path: 'admin', loadChildren: () => import('@scope/feature').then((m) => m.FEATURE_ROUTES) }]`,
      '/libs/feature/src/public-api.ts': `export * from './feature.routes'`,
      '/libs/feature/src/feature.routes.ts': `import type { Routes } from '@angular/router'\nimport { R } from './rules.component'\nexport const FEATURE_ROUTES: Routes = [{ path: 'rules', component: R }]`,
      '/libs/feature/src/rules.component.ts': C('<p>rules</p>'),
    })
    // The same two options `buildProject` reads out of the workspace tsconfig.
    project.compilerOptions.set({ baseUrl: '/', paths })
    const { graph } = extractGraph(project, '/')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/admin/rules'])
  })

  it('reads a tsconfig whose alias key opens a comment, and loads the sources beside a file-valued alias', () => {
    const ws = mkdtempSync(join(tmpdir(), 'uigraph-paths-'))
    /** Write one fixture file under the temp workspace, creating its directory first. */
    const put = (rel: string, text: string): void => {
      mkdirSync(dirname(join(ws, rel)), { recursive: true })
      writeFileSync(join(ws, rel), text)
    }
    try {
      put('tsconfig.base.json', `// workspace aliases\n{\n  "compilerOptions": {\n    "baseUrl": ".",\n    /* the second key holds a slash-star */\n    "paths": {\n      "@w/feature": ["libs/feature/src/public-api.ts"],\n      "@w/shared/*": ["libs/shared/*"], /* closes later */\n    },\n  },\n}\n`)
      put('apps/app/src/app.routes.ts', `import type { Routes } from '@angular/router'\nexport const routes: Routes = [{ path: 'admin', loadChildren: () => import('@w/feature').then((m) => m.FEATURE_ROUTES) }]`)
      put('libs/feature/src/public-api.ts', `export * from './feature.routes'`)
      put('libs/feature/src/feature.routes.ts', `import type { Routes } from '@angular/router'\nimport { R } from './rules.component'\nexport const FEATURE_ROUTES: Routes = [{ path: 'rules', component: R }]`)
      put('libs/feature/src/rules.component.ts', C('<p>rules</p>'))
      const appDir = join(ws, 'apps/app')
      const project = buildProject(appDir)
      expect(Object.keys(project.getCompilerOptions().paths ?? {}).sort()).toEqual(['@w/feature', '@w/shared/*'])
      expect(extractGraph(project, appDir).graph.nodes.map((n) => n.route)).toEqual(['/admin/rules'])
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  it('reads a routing module imported through a baseUrl specifier, so its routes mount under the lazy prefix', () => {
    // mifos's reports.module imports its routing module as 'app/reports/reports-routing.module',
    // which starts with no dot. The owner lookup skipped every such specifier, so the routing
    // module was never recognised as the lazy owner, was walked at the project root, and
    // `/reports/:filter` was minted as `/:filter` -- a screen no route of the application has.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nexport const routes: Routes = [{ path: 'reports', loadChildren: () => import('./reports/reports.module').then((m) => m.ReportsModule) }]`,
      '/app/reports/reports.module.ts': `import { ReportsRoutingModule } from 'app/reports/reports-routing.module'\nexport class ReportsModule { r = ReportsRoutingModule }`,
      '/app/reports/reports-routing.module.ts': `import type { Routes } from '@angular/router'\nimport { R } from './r.component'\nexport const routes: Routes = [{ path: ':filter', component: R }]\nexport class ReportsRoutingModule {}`,
      '/app/reports/r.component.ts': C('<p>r</p>'),
    })
    project.compilerOptions.set({ baseUrl: '/' })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/reports/:filter'])
  })

  it('declares the route set incomplete when a lazy module has no route array it can find', () => {
    // The module the loader names holds no `Routes` array and imports none that does. Whatever
    // it mounts under /lazy is a boundary the extractor cannot read; saying nothing let every
    // link into that subtree read as a link to a route the application does not declare.
    const { soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [\n  { path: 'home', component: A },\n  { path: 'lazy', loadChildren: () => import('./lazy.module').then((m) => m.LazyModule) },\n  { path: '**', redirectTo: 'home' },\n]`,
        '/lazy.module.ts': `export class LazyModule {}`,
        '/a.component.ts': C('<a routerLink="/lazy/thing">x</a>'),
      }),
      '/',
    )
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
    const wild = soundiness.filter((n) => n.kind === 'wildcard-redirect')
    expect(wild.length).toBeGreaterThan(0)
    for (const n of wild) expect(n.detail).toMatch(/could not be read/)
  })

  it('does not guess the lazy owner when two imports both hold a route-shaped array', () => {
    // mifos's reports.module imports SharedModule BEFORE its routing module. A breadcrumb or menu
    // config satisfies "an array with a `path`" as well as a route table does, so taking the first
    // import that holds one minted `/reports/widgets` (an address nothing mounts) and lost the real
    // `/reports/:filter`. With two holders the owner cannot be told, so nothing is minted from
    // either, neither is rescanned from the root, and the route set says it is a lower bound.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'home', component: A }, { path: 'reports', loadChildren: () => import('./reports/reports.module').then((m) => m.ReportsModule) }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/reports/reports.module.ts': `import { SharedModule } from 'app/shared/shared.module'\nimport { ReportsRoutingModule } from 'app/reports/reports-routing.module'\nexport class ReportsModule { s = SharedModule; r = ReportsRoutingModule }`,
      '/app/shared/shared.module.ts': `import type { Routes } from '@angular/router'\nimport { W } from './w.component'\nexport const sharedRoutes: Routes = [{ path: 'widgets', component: W }]\nexport class SharedModule {}`,
      '/app/shared/w.component.ts': C('<p>w</p>'),
      '/app/reports/reports-routing.module.ts': `import type { Routes } from '@angular/router'\nimport { R } from './r.component'\nexport const routes: Routes = [{ path: ':filter', component: R }]\nexport class ReportsRoutingModule {}`,
      '/app/reports/r.component.ts': C('<p>r</p>'),
    })
    project.compilerOptions.set({ baseUrl: '/' })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
  })

  it('does not elect a menu config as the lazy owner when it is the only route-shaped array the module imports', () => {
    // A `path` on an element is the only thing that makes a menu look like a route table; nothing declares it to the router.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'home', component: A }, { path: 'reports', loadChildren: () => import('./reports/reports.module').then((m) => m.ReportsModule) }]`,
      '/app/a.component.ts': C('<a routerLink="/reports/widgets">w</a>'),
      '/app/reports/reports.module.ts': `import { MENU } from 'app/shared/menu.config'\nexport class ReportsModule { m = MENU }`,
      '/app/shared/menu.config.ts': `import { W } from './w.component'\nexport const MENU = [{ path: 'widgets', label: 'Widgets', component: W }, { path: 'charts', label: 'Charts', component: W }]`,
      '/app/shared/w.component.ts': C('<p>w</p>'),
    })
    project.compilerOptions.set({ baseUrl: '/' })
    const { graph, soundiness } = extractGraph(project, '/app')
    // Neither under the lazy prefix (elected) nor at the root (rescanned because nothing claimed the file): the menu mounts nothing.
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(graph.edges.filter((e) => e.modality === 'must')).toEqual([])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
  })

  it('elects the one array the module declares to the router, and leaves a menu beside it unminted', () => {
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'home', component: A }, { path: 'reports', loadChildren: () => import('./reports/reports.module').then((m) => m.ReportsModule) }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/reports/reports.module.ts': `import { MENU } from 'app/shared/menu.config'\nimport { ReportsRoutingModule } from 'app/reports/reports-routing.module'\nexport class ReportsModule { m = MENU; r = ReportsRoutingModule }`,
      '/app/shared/menu.config.ts': `import { W } from './w.component'\nexport const MENU = [{ path: 'widgets', label: 'Widgets', component: W }]`,
      '/app/shared/w.component.ts': C('<p>w</p>'),
      '/app/reports/reports-routing.module.ts': `import type { Routes } from '@angular/router'\nimport { R } from './r.component'\nexport const routes: Routes = [{ path: ':filter', component: R }]\nexport class ReportsRoutingModule {}`,
      '/app/reports/r.component.ts': C('<p>r</p>'),
    })
    project.compilerOptions.set({ baseUrl: '/' })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/home', '/reports/:filter'])
    // The menu is claimed (never minted) but shape cannot say it mounts nothing, so the unplaced file is declared.
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set').map((n) => n.detail)).toEqual(['1 claimed route file(s) placed under no prefix could not be read, so the declared route set is a lower bound and no claim that a path is undeclared holds'])
  })

  it('declares the route set incomplete when a table another module mounts is claimed by a lazy module, so its link is not published as a dead one', () => {
    // admin.module mounts ADMIN_ROUTES eagerly by identifier, so only the root scan's shape test sees that array; the lazy module imports the same file for its labels, which claims it.
    const project = inMemory({
      '/app/app.module.ts': `import { RouterModule } from '@angular/router'\nimport { A } from './a.component'\nimport { AdminModule } from './admin/admin.module'\n@NgModule({ imports: [AdminModule, RouterModule.forRoot([{ path: 'home', component: A }, { path: 'reports', loadChildren: () => import('./reports/reports.module').then((m) => m.M) }])] })\nexport class AppModule {}`,
      '/app/a.component.ts': C('<a routerLink="/admin">admin</a><a routerLink="/reports/list">list</a>'),
      '/app/admin/admin.module.ts': `import { RouterModule } from '@angular/router'\nimport { ADMIN_ROUTES } from './admin.routes'\n@NgModule({ imports: [RouterModule.forChild(ADMIN_ROUTES)] })\nexport class AdminModule {}`,
      '/app/admin/admin.routes.ts': `import { D } from './d.component'\nexport const ADMIN_ROUTES = [{ path: 'admin', component: D, label: 'Admin' }]`,
      '/app/admin/d.component.ts': C('<p>d</p>'),
      '/app/reports/reports.module.ts': `import { ADMIN_ROUTES } from '../admin/admin.routes'\nimport { REPORT_ROUTES } from './reports-routing.module'\nexport class M { labels = ADMIN_ROUTES.map((r) => r.label); r = REPORT_ROUTES }`,
      '/app/reports/reports-routing.module.ts': `import type { Routes } from '@angular/router'\nimport { B } from './b.component'\nexport const REPORT_ROUTES: Routes = [{ path: 'list', component: B }]`,
      '/app/reports/b.component.ts': C('<p>b</p>'),
    })
    project.compilerOptions.set({ baseUrl: '/' })
    const { graph, soundiness } = extractGraph(project, '/app')
    // Not minted at the root, where the claim keeps it out; the loss is declared instead of left silent.
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/home', '/reports/list'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set').map((n) => n.detail)).toEqual(['1 claimed route file(s) placed under no prefix could not be read, so the declared route set is a lower bound and no claim that a path is undeclared holds'])
  })

  it('counts a routing module once when the lazy module both imports and re-exports it', () => {
    const project = inMemory({
      '/app.routes.ts': `import type { Routes } from '@angular/router'\nexport const routes: Routes = [{ path: 'lazy', loadChildren: () => import('./lazy/lazy.module').then((m) => m.LazyModule) }]`,
      '/lazy/lazy.module.ts': `import { LazyRoutingModule } from './lazy-routing.module'\nexport * from './lazy-routing.module'\nexport class LazyModule { r = LazyRoutingModule }`,
      '/lazy/lazy-routing.module.ts': `import type { Routes } from '@angular/router'\nimport { L } from './l.component'\nexport const routes: Routes = [{ path: ':id', component: L }]\nexport class LazyRoutingModule {}`,
      '/lazy/l.component.ts': C('<p>l</p>'),
    })
    expect(extractGraph(project, '/').graph.nodes.map((n) => n.route)).toEqual(['/lazy/:id'])
  })

  it('declares the route set incomplete when a loadChildren names a file that does not exist', () => {
    // The subtree it would mount is dropped whole; with the target unresolved nothing counted it.
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'home', component: A }, { path: 'lazy', loadChildren: () => import('./missing.module').then((m) => m.M) }]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
  })

  it('counts an unreadable route once however many parents spread it, and names each loss for what it is', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { shared } from './shared.routes'\nexport const routes: Routes = [\n  { path: 'x', component: A, children: [...shared] },\n  { path: 'y', component: A, children: [...shared] },\n  { path: '**', redirectTo: 'x' },\n]`,
        '/shared.routes.ts': `import type { Routes } from '@angular/router'\ndeclare const fromElsewhere: string\nexport const shared: Routes = [\n  { path: fromElsewhere, component: null as any },\n  { path: 'k', loadChildren: () => import('./missing.module').then((m) => m.M) },\n  { path: 'e', loadChildren: () => import('./empty.module').then((m) => m.E) },\n]`,
        '/empty.module.ts': `export class E {}`,
        '/a.component.ts': C('<a routerLink="/nowhere">x</a>'),
      }),
      '/',
    )
    const text = '1 declared path(s) and 2 lazy subtree(s) could not be read'
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set').map((n) => n.detail)).toEqual([`${text}, so the declared route set is a lower bound and no claim that a path is undeclared holds`])
    const wild = soundiness.filter((n) => n.kind === 'wildcard-redirect')
    expect(wild.length).toBeGreaterThan(0)
    for (const n of wild) expect(n.detail).toContain(`, though ${text}, so it is not claimed`)
  })

  it('calls a dropped lazy subtree a subtree, never a declared path', () => {
    const { soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'home', component: A }, { path: 'lazy', loadChildren: () => import('./missing.module').then((m) => m.M) }]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    const [note] = soundiness.filter((n) => n.kind === 'incomplete-route-set')
    expect(note!.detail).toMatch(/^1 lazy subtree\(s\) could not be read, /)
    expect(note!.detail).not.toMatch(/declared path/)
  })

  /**
   * A project whose component keeps its template in an external html file, so that a link's
   * `loc` is a line of that file. The routes end in a `**` redirect unless told otherwise.
   */
  const externalTemplate = (html: string, wildcard = true): Project =>
    inMemory({
      '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [\n  { path: 'home', component: A },${wildcard ? "\n  { path: '**', redirectTo: 'home' }," : ''}\n]`,
      '/a.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, templateUrl: './a.component.html' })\nexport class A { dyn = Math.random() > 0.5 ? '/x' : '/y' }`,
      '/a.component.html': html,
    })

  it('cites the html file, not the component, for a soundiness note about an external template link', () => {
    // `t.loc` is a line within the html; paired with the component's `.ts` path it pointed at a
    // line holding no link, and the published dead-link citations inherited that.
    const html = '<p>intro</p>\n<a routerLink="/nowhere">a</a>\n<a [routerLink]="[\'/items\', id]">b</a>\n<a [routerLink]="dyn">c</a>\n<a routerLink="/home">h</a>'
    const { graph, soundiness } = extractGraph(externalTemplate(html), '/')
    const cited = soundiness.filter((n) => ['wildcard-redirect', 'over-approximation', 'dynamic-target'].includes(n.kind)).map((n) => [n.kind, n.file, n.loc?.line])
    expect(cited.sort()).toEqual([
      ['dynamic-target', 'a.component.html', 4],
      ['over-approximation', 'a.component.html', 3],
      ['wildcard-redirect', 'a.component.html', 2],
    ])
    // The edge's own witnesses already named the html file; the notes now agree with them.
    const home = graph.edges.find((e) => e.to === 'n_home')
    expect([home?.witness, ...(home?.mergedWitnesses ?? [])].map((w) => w?.file)).toEqual(['a.component.html', 'a.component.html'])
  })

  it('cites the html file for an unresolved external template link when no wildcard route answers it', () => {
    const { soundiness } = extractGraph(externalTemplate('<p>intro</p>\n<a routerLink="/nowhere">a</a>', false), '/')
    const notes = soundiness.filter((n) => n.kind === 'unresolved-target')
    expect(notes.map((n) => [n.file, n.loc?.line])).toEqual([['a.component.html', 2]])
  })

  it('cites the html file for the notes a control raises about its own routerLink', () => {
    const html = '<p>intro</p>\n<a routerLink="/nowhere">a</a>\n<a [routerLink]="dyn">c</a>'
    const { soundiness } = extractGraph(externalTemplate(html, false), '/', { controls: true })
    const cited = soundiness.filter((n) => n.kind === 'unresolved-target' || n.kind === 'dynamic-target').map((n) => [n.kind, n.file, n.loc?.line])
    expect(cited.sort()).toEqual([
      ['dynamic-target', 'a.component.html', 3],
      ['unresolved-target', 'a.component.html', 2],
    ])
  })

  it('does not take a sibling application for the shell, yet still attributes a shared library the application renders', () => {
    // bitwarden's web app resolves imports through an alias that reaches the browser extension.
    // The extension's root component holds a `<router-outlet>` and no route renders it, so it
    // was taken for the web app's shell and its `navigate(['login'])` became a must edge. The
    // first repair filtered every file outside the app out of attribution, which also threw out
    // `../../libs`: a library component the web app renders through a wrapper lost its edge.
    const ws = {
      '/ws/apps/web/src/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { Wrapper } from './wrapper.component'\nexport const routes: Routes = [{ path: 'login', component: A }, { path: 'lock', component: A }, { path: 'confirm', component: Wrapper }]`,
      '/ws/apps/web/src/a.component.ts': C('<p>a</p>'),
      '/ws/apps/web/src/shell.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'app-shell', template: '<router-outlet></router-outlet>' })\nexport class Shell { router: any; go() { this.router.navigate(['/lock']) } }`,
      '/ws/apps/web/src/wrapper.component.ts': `import { Component } from '@angular/core'\nimport { LibConfirm } from '../../../libs/ui/src/lib-confirm.component'\n@Component({ standalone: true, imports: [LibConfirm], template: '<lib-confirm></lib-confirm>' })\nexport class Wrapper {}`,
      '/ws/libs/ui/src/lib-confirm.component.ts': `import { Component } from '@angular/core'\n@Component({ standalone: true, selector: 'lib-confirm', template: '<p>confirm</p>' })\nexport class LibConfirm { router: any; done() { this.router.navigate(['/login']) } }`,
      '/ws/apps/browser/src/popup/app.component.ts': `import { Component } from '@angular/core'\n@Component({ selector: 'app-root', template: '<router-outlet></router-outlet>' })\nexport class Popup { router: any; go() { this.router.navigate(['/login']) } }`,
      '/ws/apps/browser/src/popup/guard.service.ts': `export class Guard { router: any; go() { this.router.navigate(['/login']) } }`,
      '/ws/apps/browser/src/popup/popup.effects.ts': `import { createEffect } from '@ngrx/effects'\nexport class PopupEffects { router: any; e = createEffect(() => { this.router.navigate(['/login']); return null as any }, { dispatch: false }) }`,
      '/ws/apps/web/src/web.effects.ts': `import { createEffect } from '@ngrx/effects'\nexport class WebEffects { router: any; e = createEffect(() => { this.router.navigate(['/login']); return null as any }, { dispatch: false }) }`,
    }
    const { graph, soundiness } = extractGraph(inMemory(ws), '/ws/apps/web', { attribution: true })
    const witnessedIn = (file: string) => graph.edges.filter((e) => e.witness?.file === file || e.mergedWitnesses?.some((m) => m.file === file))
    // The extension's root is no shell: no must edge, and nothing from the shell node, cites it.
    expect(witnessedIn('../browser/src/popup/app.component.ts').filter((e) => e.modality === 'must' || e.from === 'n_scope_shell')).toHaveLength(0)
    expect(witnessedIn('../browser/src/popup/guard.service.ts')).toHaveLength(0)
    // The sibling's NgRx effect is the one path that bypasses attribution: it is reported as unattributed, never drawn from the shell.
    expect(witnessedIn('../browser/src/popup/popup.effects.ts')).toHaveLength(0)
    expect(soundiness.filter((n) => n.kind === 'unattributed-non-component' && n.file === '../browser/src/popup/popup.effects.ts')).toHaveLength(1)
    // This application's own effect still sits at the shell, so the guard did not switch effects off.
    expect(witnessedIn('src/web.effects.ts').filter((e) => e.from === 'n_scope_shell' && e.to === 'n_login' && e.modality === 'may')).toHaveLength(1)
    // The web app's own shell is still read, so the boundary did not simply switch the pass off.
    expect(graph.edges.filter((e) => e.from === 'n_scope_shell' && e.to === 'n_lock' && e.witness?.file === 'src/shell.component.ts')).toHaveLength(1)
    // The library component the app renders is attributed to the screen that renders it.
    expect(graph.edges.filter((e) => e.from === 'n_confirm' && e.to === 'n_login' && e.modality === 'must' && e.witness?.file === '../../libs/ui/src/lib-confirm.component.ts')).toHaveLength(1)
  })

  it('says an NgRx effect outside the application directory could not be placed, and keeps "nothing injects it" for a plain class', () => {
    // A workspace library's effect is registered from inside the application by provideEffects([...]), which is not read, so "nothing injects it" would be a false claim about the application.
    const { soundiness } = extractGraph(
      inMemory({
        '/ws/apps/web/src/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'home', component: A }]`,
        '/ws/apps/web/src/a.component.ts': C('<p>a</p>'),
        '/ws/apps/web/src/app.config.ts': `import { provideEffects } from '@ngrx/effects'\nimport { RouterEffects } from '../../../libs/store/src/router.effects'\nexport const config = { providers: [provideEffects([RouterEffects])] }`,
        '/ws/libs/store/src/router.effects.ts': `import { createEffect } from '@ngrx/effects'\nexport class RouterEffects { router: any; e = createEffect(() => { this.router.navigate(['/home']); return null as any }, { dispatch: false }) }`,
        '/ws/libs/store/src/helper.ts': `export class Helper { router: any; go() { this.router.navigate(['/home']) } }`,
      }),
      '/ws/apps/web',
      { attribution: true },
    )
    /** The detail of every unattributed-non-component note raised for `file`. */
    const detailsFor = (file: string): (string | undefined)[] => soundiness.filter((n) => n.kind === 'unattributed-non-component' && n.file === file).map((n) => n.detail)
    expect(detailsFor('../../libs/store/src/router.effects.ts')).toEqual(['1 navigation call(s) in an NgRx effect outside the application directory; whether the application registers it is not read, so its scope could not be placed'])
    expect(detailsFor('../../libs/store/src/helper.ts')).toEqual(['1 navigation call(s) in a class nothing in the application injects; its scope is empty'])
  })

  it('narrows the one-argument call it follows to a freeze, so a call that builds an object is not read as its argument', () => {
    // `Object.assign(this, rename({ next: [...] }))` writes `dest`, not `next`. Following any
    // one-argument call read the argument's keys as the written names, left `dest` looking
    // unwritten, and drew a must edge to the stale initializer.
    const src = (write: string): Project =>
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: '', component: A }, { path: 'home', component: A }, { path: 'away', component: A }]`,
        '/table.ts': `export const table = { home: { routerLink: ['/home'] } }`,
        '/a.component.ts': `import { Component } from '@angular/core'\nimport { table } from './table'\nconst rename = (o: any) => ({ dest: o.next })\n@Component({ standalone: true, template: '<a [routerLink]="dest">go</a>' })\nexport class A { dest = table.home.routerLink; ngOnInit() { ${write} } }`,
      })
    const mustHome = (write: string): number => extractGraph(src(write), '/').graph.edges.filter((e) => e.modality === 'must' && e.to === 'n_home').length
    expect(mustHome("Object.assign(this, rename({ next: ['/away'] }))")).toBe(0)
    // A freeze hands its argument back unchanged, so the keys it carries are the keys written.
    expect(mustHome("Object.assign(this, Object.freeze({ dest: ['/away'] }))")).toBe(0)
    expect(mustHome('')).toBeGreaterThan(0)
  })

  it('still reads a route table written Object.freeze({...})', () => {
    const { graph } = extractGraph(
      inMemory({
        '/routes.ts': `export const AuthRoute = Object.freeze({ Login: 'login' })`,
        '/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { AuthRoute } from './routes'\nexport const routes: Routes = [{ path: AuthRoute.Login, component: A }]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/login'])
  })

  it('does not mint a route from a sibling application whose directory name extends the measured one', () => {
    const files = {
      '/ws/apps/web/src/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'home', component: A }]`,
      '/ws/apps/web/src/a.component.ts': C('<p>a</p>'),
      '/ws/apps/web-extension/src/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'popup', component: A }]`,
      '/ws/apps/web-extension/src/a.component.ts': C('<p>a</p>'),
    }
    expect(extractGraph(inMemory(files), '/ws/apps/web').graph.nodes.map((n) => n.route)).toEqual(['/home'])
  })

  it('tests a project boundary on a path boundary and not on a string prefix', () => {
    expect(isInsideDir('/ws/apps/web/src/a.ts', '/ws/apps/web')).toBe(true)
    expect(isInsideDir('/ws/apps/web/src/a.ts', '/ws/apps/web/')).toBe(true)
    expect(isInsideDir('/ws/apps/web-extension/src/a.ts', '/ws/apps/web')).toBe(false)
    expect(isInsideDir('/ws/apps/browser/src/a.ts', '/ws/apps/web')).toBe(false)
    expect(isInsideDir('/a.ts', '/')).toBe(true)
  })

  it('reads a route path written as a template over constant strings, and refuses one with a span it cannot read', () => {
    // bitwarden declares `:vaultId/${MY_ITEMS_ROUTE}` where the constant is a plain exported
    // string; with no branch for a template with substitutions the three routes written that
    // way were unreadable, and its node coverage read as complete while they were missing.
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/consts.ts': `export const MY_ITEMS_ROUTE = 'my-items'\nexport const SHARED = 'shared-folders'`,
        '/opaque.ts': `export const opaque = { thing: () => String(Math.random()) }`,
        '/app.routes.ts': 'import type { Routes } from \'@angular/router\'\nimport { A } from \'./a.component\'\nimport { MY_ITEMS_ROUTE, SHARED } from \'./consts\'\nimport { opaque } from \'./opaque\'\nexport const routes: Routes = [\n  { path: `:vaultId/${MY_ITEMS_ROUTE}`, component: A },\n  { path: `:vaultId/${SHARED}/:collectionId`, component: A },\n  { path: `:vaultId/${opaque.thing()}`, component: A },\n  { path: `plain`, component: A },\n]',
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/:vaultId/my-items', '/:vaultId/shared-folders/:collectionId', '/plain'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
  })

  it.each([
    ['a spec', { '/ws/apps/web/src/harness.spec.ts': `import { RouterModule } from '@angular/router'\nRouterModule.forRoot([{ path: 'x', loadChildren: () => import('./admin/admin.module').then((m) => m.AdminModule) }])` }],
    ['a sibling application outside the measured directory', { '/ws/apps/other/src/other.routes.ts': `import type { Routes } from '@angular/router'\nexport const routes: Routes = [{ path: 'y', loadChildren: () => import('apps/web/src/admin/admin.module').then((m) => m.AdminModule) }]` }],
  ])('does not let %s that names a route table claim it away from the root scan', (_name, claimant) => {
    // admin.module mounts ADMIN_ROUTES eagerly by identifier, so only the root scan sees that array; a lazy site the walk never visits must not remove it.
    const project = inMemory({
      '/ws/apps/web/src/app.module.ts': `import { RouterModule } from '@angular/router'\nimport { A } from './a.component'\nimport { AdminModule } from './admin/admin.module'\n@NgModule({ imports: [AdminModule, RouterModule.forRoot([{ path: 'home', component: A }])] })\nexport class AppModule {}`,
      '/ws/apps/web/src/a.component.ts': C('<a routerLink="/admin">admin</a>'),
      '/ws/apps/web/src/admin/admin.module.ts': `import { RouterModule } from '@angular/router'\nimport { ADMIN_ROUTES } from './admin.routes'\n@NgModule({ imports: [RouterModule.forChild(ADMIN_ROUTES)] })\nexport class AdminModule {}`,
      '/ws/apps/web/src/admin/admin.routes.ts': `import type { Routes } from '@angular/router'\nimport { D } from './d.component'\nexport const ADMIN_ROUTES: Routes = [{ path: 'admin', component: D }]`,
      '/ws/apps/web/src/admin/d.component.ts': C('<p>d</p>'),
      ...claimant,
    })
    project.compilerOptions.set({ baseUrl: '/ws' })
    const { graph, soundiness } = extractGraph(project, '/ws/apps/web')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/admin', '/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set' || n.kind === 'unresolved-target')).toEqual([])
  })

  it('does not let a decorator spread of a list of classes claim the file that declares it away from the root scan', () => {
    // SHARED is a list of classes with no route in it; the file that declares it also holds a table nothing else claims.
    const project = inMemory({
      '/app/app.module.ts': `import { RouterModule } from '@angular/router'\nimport { A } from './a.component'\n@NgModule({ imports: [RouterModule.forRoot([{ path: 'home', component: A }])] })\nexport class AppModule {}`,
      '/app/a.component.ts': `import { Component } from '@angular/core'\nimport { SHARED } from './shared'\n@Component({ standalone: true, imports: [...SHARED], template: '<p>a</p>' })\nexport class A {}`,
      '/app/shared.ts': `import type { Routes } from '@angular/router'\nimport { D } from './d.component'\nexport const SHARED = [D]\nexport const EXTRA_ROUTES: Routes = [{ path: 'extra', component: D }]`,
      '/app/d.component.ts': C('<p>d</p>'),
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/extra', '/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  const ONE_UNPLACED = '1 claimed route file(s) placed under no prefix could not be read, so the declared route set is a lower bound and no claim that a path is undeclared holds'

  const adminApp = {
    '/app/app.module.ts': `import { RouterModule } from '@angular/router'\nimport { A } from './a.component'\nimport { AdminModule } from './admin/admin.module'\n@NgModule({ imports: [AdminModule, RouterModule.forRoot([{ path: 'home', component: A }])] })\nexport class AppModule {}`,
    '/app/a.component.ts': C('<a routerLink="/admin">admin</a>'),
    '/app/admin/admin.module.ts': `import { RouterModule } from '@angular/router'\nimport { ADMIN_ROUTES } from './admin.routes'\n@NgModule({ imports: [RouterModule.forChild(ADMIN_ROUTES)] })\nexport class AdminModule {}`,
    '/app/admin/admin.routes.ts': `import type { Routes } from '@angular/router'\nimport { D } from './d.component'\nexport const ADMIN_ROUTES: Routes = [{ path: 'admin', component: D }]`,
    '/app/admin/d.component.ts': C('<p>d</p>'),
  }

  it.each([
    ['a loadChildren inside an array a function returns', { '/app/factory.ts': `import type { Routes } from '@angular/router'\nexport function makeRoutes(): Routes {\n  return [{ path: 'x', loadChildren: () => import('./admin/admin.module').then((m) => m.AdminModule) }]\n}` }],
    ['a loadChildren in an object no array holds', { '/app/menu.ts': `export const ENTRY = { path: 'x', loadChildren: () => import('./admin/admin.module').then((m) => m.AdminModule) }` }],
    ['a spread of the table inside an array a function returns', { '/app/spreader.ts': `import type { Routes } from '@angular/router'\nimport { ADMIN_ROUTES } from './admin/admin.routes'\nexport function all(): Routes {\n  return [...ADMIN_ROUTES]\n}` }],
  ])('declares the table unplaced when %s claims it and the walk never reaches the site', (_name, claimant) => {
    // The claim keeps ADMIN_ROUTES out of the root scan and no walk places it, so /admin is in no route set and the set says it is a lower bound.
    const project = inMemory({ ...adminApp, ...claimant })
    project.compilerOptions.set({ baseUrl: '/' })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set').map((n) => n.detail)).toEqual([ONE_UNPLACED])
  })

  it('declares a lazy module unplaced when its loadChildren sits in an arrow-returned array that a call spreads', () => {
    // viewRoutes() is a call, which the spread branch does not resolve, so the lazy site inside it is never walked while the pre-pass still claims its target.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { viewRoutes } from './view.routes'\nexport const routes: Routes = [{ path: 'home', component: A, children: [...viewRoutes()] }]`,
      '/app/view.routes.ts': `import type { Routes } from '@angular/router'\nexport const viewRoutes = (): Routes => [{ path: 'view', loadChildren: () => import('./viewer/viewer.routes').then((m) => m.VIEWER) }]`,
      '/app/viewer/viewer.routes.ts': `import type { Routes } from '@angular/router'\nimport { V } from './v.component'\nexport const VIEWER: Routes = [{ path: 'pane', component: V }]`,
      '/app/viewer/v.component.ts': C('<p>v</p>'),
      '/app/a.component.ts': C('<p>a</p>'),
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    // Two losses, not one: the spread itself is a route source the reader cannot bring back to an
    // array, and the lazy file its unwalked site claims is left under no prefix.
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set').map((n) => n.detail)).toEqual([
      `1 spread route source(s) and ${ONE_UNPLACED}`,
    ])
  })

  it('does not count a claimed file the root scan would mint nothing from as a route file the walk missed', () => {
    // plain.module declares no route array, so skipping it from the root scan loses no route and the note, which counts files the root scan would have minted from, has nothing to count.
    const project = inMemory({
      '/app/app.module.ts': `import { RouterModule } from '@angular/router'\nimport { A } from './a.component'\n@NgModule({ imports: [RouterModule.forRoot([{ path: 'home', component: A }])] })\nexport class AppModule {}`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/factory.ts': `import type { Routes } from '@angular/router'\nexport function makeRoutes(): Routes {\n  return [{ path: 'x', loadChildren: () => import('./plain.module').then((m) => m.PlainModule) }]\n}`,
      '/app/plain.module.ts': `export class PlainModule {}`,
    })
    const { soundiness } = extractGraph(project, '/app')
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set' && /claimed route file/.test(n.detail))).toEqual([])
  })

  it.each([
    ['a loadChildren in a root-scanned array', { '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nexport const routes: Routes = [{ path: 'home', component: A }, { path: 'admin-area', loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) }]` }, ['/admin-area/admin', '/home']],
    ['a spread inside a root-scanned route', { '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { A } from './a.component'\nimport { ADMIN_ROUTES } from './admin/admin.routes'\nexport const routes: Routes = [{ path: 'home', component: A, children: [...ADMIN_ROUTES] }]` }, ['/home', '/home/admin']],
  ])('records %s as placed, so a claim the walk follows is not declared', (_name, root, routes) => {
    // The claimed table is walked under a prefix here, which is the one outcome that needs no note.
    const project = inMemory({
      ...root,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/admin/admin.routes.ts': adminApp['/app/admin/admin.routes.ts'],
      '/app/admin/d.component.ts': C('<p>d</p>'),
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(routes)
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  it('does not mint a second unprefixed node when the spread array carries its routes one spread deeper', () => {
    // The walk recurses into whatever array a spread resolves to, so a claim that tests only the
    // array's own shape drops the claim while the walk still mints under the prefix, and the root
    // scan, no longer suppressed, mints the same routes again at the root -- with a must edge from
    // a stale link into one of them, at an address the application does not mount.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { featureRoutes } from './feature'
export const routes: Routes = [{ path: 'admin', component: A, children: [...featureRoutes] }]`,
      '/app/feature.ts': `import { U } from './u.component'
const core = [{ path: 'users', component: U }]
export const featureRoutes = [...core]`,
      '/app/a.component.ts': C('<a routerLink="/users">stale</a>'),
      '/app/u.component.ts': C('<p>u</p>'),
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/admin', '/admin/users'])
    expect(graph.edges.filter((e) => e.modality === 'must')).toEqual([])
  })

  it('does not declare a loss when the only claimant of a spec file is unreachable', () => {
    // The root scan skips specs unconditionally, so no claim caused the absence and nothing was lost.
    const project = inMemory({
      '/app/app.module.ts': `import { RouterModule } from '@angular/router'
import { A } from './a.component'
@NgModule({ imports: [RouterModule.forRoot([{ path: 'home', component: A }])] })
export class AppModule {}`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/factory.ts': `import type { Routes } from '@angular/router'
export function makeRoutes(): Routes {
  return [{ path: 'x', loadChildren: () => import('./demo.spec').then((m) => m.DEMO) }]
}`,
      '/app/demo.spec.ts': `import type { Routes } from '@angular/router'
import { D } from './d.component'
export const DEMO: Routes = [{ path: 'demo', component: D }]`,
      '/app/d.component.ts': C('<p>d</p>'),
    })
    const { soundiness } = extractGraph(project, '/app')
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  it('does not declare a loss when the claimed file holds a route-shaped array the root scan would mint nothing from', () => {
    // A menu config carries `path` with no component, so the root scan would have minted no node
    // from it: a shape test counts it as a lost route table, and the false note voids every
    // dead-link claim the application carries.
    const project = inMemory({
      '/app/app.module.ts': `import { RouterModule } from '@angular/router'
import { A } from './a.component'
@NgModule({ imports: [RouterModule.forRoot([{ path: 'home', component: A }])] })
export class AppModule {}`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/factory.ts': `import type { Routes } from '@angular/router'
export function makeRoutes(): Routes {
  return [{ path: 'x', loadChildren: () => import('./feature/menu').then((m) => m.MENU) }]
}`,
      '/app/feature/menu.ts': `export const MENU = [{ path: 'dashboard', label: 'D' }, { path: 'reports', label: 'R' }]`,
    })
    const { soundiness } = extractGraph(project, '/app')
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  it('reads a route table reached from two parents under both prefixes, not once', () => {
    // The cycle guard holds the arrays on the CURRENT descent. One kept across siblings is a
    // visited set, and a visited set refuses the second parent: it cost mifos a third of its
    // routes in an unreleased build, silently and with no note.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { SHARED } from './shared.routes'
export const routes: Routes = [{ path: 'one', component: A, children: [...SHARED] }, { path: 'two', component: A, children: [...SHARED] }]`,
      '/app/shared.routes.ts': `import type { Routes } from '@angular/router'
import { S } from './s.component'
export const SHARED: Routes = [{ path: 'leaf', component: S }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/s.component.ts': C('<p>s</p>'),
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/one', '/one/leaf', '/two', '/two/leaf'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  it.each([
    ['a lazy hop', {
      '/app/feature-a/a.routes.ts': `import type { Routes } from '@angular/router'
export const A_ROUTES: Routes = [{ path: 'ay', loadChildren: () => import('../feature-b/b.routes').then((m) => m.B_ROUTES) }]`,
      '/app/feature-b/b.routes.ts': `import type { Routes } from '@angular/router'
export const B_ROUTES: Routes = [{ path: 'bee', loadChildren: () => import('../feature-a/a.routes').then((m) => m.A_ROUTES) }]`,
    }],
    ['a spread', {
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { B_ROUTES } from './feature-b/b.routes'
export const routes: Routes = [{ path: 'home', component: A, children: [...B_ROUTES] }]`,
      '/app/feature-a/a.routes.ts': `import { B_ROUTES } from '../feature-b/b.routes'
export const A_ROUTES = [...B_ROUTES]`,
      '/app/feature-b/b.routes.ts': `import { A_ROUTES } from '../feature-a/a.routes'
export const B_ROUTES = [...A_ROUTES]`,
    }],
  ])('does not run out of stack when two route tables reach each other through %s', (_name, files) => {
    // Walking such a pair mounts each table under an ever longer prefix until the stack ends,
    // which is a crash and not a reading of the application.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
export const routes: Routes = [{ path: 'home', component: A }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      ...files,
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
  })

  it('does not declare a loss for a claimed file the root scan would never have visited anyway', () => {
    // The claimed file is outside the measured application, which collectRoutes excludes from the
    // root scan on its own, so the claim removed nothing and the route set is not a lower bound.
    const project = inMemory({
      '/ws/apps/web/src/app.module.ts': `import { RouterModule } from '@angular/router'
import { A } from './a.component'
@NgModule({ imports: [RouterModule.forRoot([{ path: 'home', component: A }])] })
export class AppModule {}`,
      '/ws/apps/web/src/a.component.ts': C('<p>a</p>'),
      '/ws/apps/web/src/factory.ts': `import type { Routes } from '@angular/router'
export function makeRoutes(): Routes {
  return [{ path: 'x', loadChildren: () => import('@lib/other.routes').then((m) => m.OTHER) }]
}`,
      '/ws/lib/other.routes.ts': `import type { Routes } from '@angular/router'
import { D } from './d.component'
export const OTHER: Routes = [{ path: 'other', component: D }]`,
      '/ws/lib/d.component.ts': C('<p>d</p>'),
    })
    project.compilerOptions.set({ baseUrl: '/ws', paths: { '@lib/*': ['lib/*'] } })
    const { graph, soundiness } = extractGraph(project, '/ws/apps/web')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  it('does not declare a loss for a claimed file whose routes the graph already holds', () => {
    // Every address the claimed table declares is already in the graph at the same node id, so
    // the root scan would have minted nothing new and no address is missing from the route set.
    const project = inMemory({
      '/app/app.module.ts': `import { RouterModule } from '@angular/router'
import { A } from './a.component'
@NgModule({ imports: [RouterModule.forRoot([{ path: 'home', component: A }])] })
export class AppModule {}`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/factory.ts': `import type { Routes } from '@angular/router'
export function makeRoutes(): Routes {
  return [{ path: 'x', loadChildren: () => import('./dup.routes').then((m) => m.DUP) }]
}`,
      '/app/dup.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
export const DUP: Routes = [{ path: 'home', component: A }]`,
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  it('does not let a menu one spread deep claim the file that also declares a real table', () => {
    // NAV spreads BASE, whose entries carry `path` and no component, so the walk mints nothing
    // from it. Claiming on the array's SHAPE took menu.ts out of the root scan all the same, and
    // SETTINGS_ROUTES, declared in the same file, went with it.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
export const routes: Routes = [{ path: 'home', component: A }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/tabs.component.ts': `import { Component } from '@angular/core'
import { NAV } from './feature/menu'
@Component({ standalone: true, template: '<p>tabs</p>' })
export class Tabs { readonly tabs = [...NAV] }`,
      '/app/feature/base.ts': `export const BASE = [{ path: 'dashboard', label: 'D' }, { path: 'reports', label: 'R' }]`,
      '/app/feature/menu.ts': `import type { Routes } from '@angular/router'
import { F } from './f.component'
import { BASE } from './base'
export const NAV = [...BASE]
export const SETTINGS_ROUTES: Routes = [{ path: 'settings', component: F }]`,
      '/app/feature/f.component.ts': C('<p>f</p>'),
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/home', '/settings'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  it('claims a spread array that carries only a redirect, so the redirect is not registered at the root', () => {
    // A redirect-only route mints no node and still PLACES a redirect. Refusing the claim gave
    // the file back to the root scan, which registered /settings -> /account at the root, and a
    // stale link to /settings then resolved through it into a must edge the source does not have.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { Admin } from './admin.component'
import { Account } from './account.component'
import { LEGACY } from './legacy'
export const routes: Routes = [{ path: 'admin', component: Admin, children: [...LEGACY] }, { path: 'account', component: Account }]`,
      '/app/legacy.ts': `export const LEGACY = [{ path: 'settings', redirectTo: '/account' }]`,
      '/app/admin.component.ts': C('<a routerLink="/settings">s</a>'),
      '/app/account.component.ts': C('<p>acct</p>'),
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/account', '/admin'])
    expect(graph.edges.filter((e) => e.modality === 'must')).toEqual([])
  })

  it('does not mark a file placed because the walk entered a spread of an array that places nothing', () => {
    // shared.ts holds a menu and a real table. The menu spread let the walk mark the FILE placed,
    // so the table claimed in it lost its declaration while still missing from the route set.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { MENU } from './feature/shared'
export const routes: Routes = [{ path: 'home', component: A, children: [...MENU] }, { path: 'feat', loadChildren: () => import('./feature/feature.module').then((m) => m.FeatureModule) }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/feature/shared.ts': `import { G } from './g.component'
export const MENU = [{ path: 'dashboard', label: 'D' }]
export const SETTINGS = [{ path: 'settings', component: G }]`,
      '/app/feature/feature.module.ts': `import { SETTINGS } from './shared'
import { FeatureRoutingModule } from './feature-routing.module'
export class FeatureModule {}`,
      '/app/feature/feature-routing.module.ts': `import type { Routes } from '@angular/router'
import { G } from './g.component'
export const featureRoutes: Routes = [{ path: 'inner', component: G }]`,
      '/app/feature/g.component.ts': C('<p>g</p>'),
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/feat/inner', '/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
  })

  it('reads a route whose keys are quoted, so the link into it is not published as dead', () => {
    // ts-morph's getProperty compares against getName(), which keeps a quoted key's quotes, so
    // the route was neither minted nor counted unreadable and the route set claimed a
    // completeness it did not have.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { Q } from './q.component'
export const routes: Routes = [{ path: 'home', component: A }, { "path": 'quoted', "component": Q }]`,
      '/app/a.component.ts': C('<a routerLink="/quoted">q</a>'),
      '/app/q.component.ts': C('<p>q</p>'),
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/home', '/quoted'])
    expect(graph.edges.map((e) => `${e.from}->${e.to}:${e.modality}`)).toContain('n_home->n_quoted:must')
  })

  it('declares a claimed file of redirects the walk never placed', () => {
    // The probe compares node ids, and a redirect mints none, so a table of redirects that the
    // claim took out of the root scan and no walk placed would be lost without a word.
    const project = inMemory({
      '/app/app.module.ts': `import { RouterModule } from '@angular/router'
import { A } from './a.component'
@NgModule({ imports: [RouterModule.forRoot([{ path: 'home', component: A }])] })
export class AppModule {}`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/factory.ts': `import type { Routes } from '@angular/router'
export function makeRoutes(): Routes {
  return [{ path: 'x', loadChildren: () => import('./legacy.routes').then((m) => m.LEGACY) }]
}`,
      '/app/legacy.routes.ts': `import type { Routes } from '@angular/router'
export const LEGACY: Routes = [{ path: 'old', redirectTo: '/home' }]`,
    })
    const { soundiness } = extractGraph(project, '/app')
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
  })

  it('declares the subtree when a loadChildren specifier is not a literal', () => {
    // A template specifier yields neither a module nor an identifier target, so the branch that
    // declares an unreadable subtree was skipped and the whole feature left the route set in
    // silence -- including its own catch-all, which the root scan then reads as the
    // application's.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
const which = 'feat'
export const routes: Routes = [{ path: 'home', component: A }, { path: 'feat', loadChildren: () => import('./' + which + '/feat.routes').then((m) => m.FEAT) }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/feat/feat.routes.ts': `import type { Routes } from '@angular/router'
import { I } from './i.component'
export const FEAT: Routes = [{ path: 'inner', component: I }]`,
      '/app/feat/i.component.ts': C('<p>i</p>'),
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
    // The note is the whole of what is gained here. The pre-pass cannot claim the target either,
    // for the same reason, so the root scan still reads the feature table unprefixed and /inner
    // is minted at an address the application does not mount -- the unclaimed-top-level-`Routes`
    // over-approximation Chapter 6 declares, which only a readable specifier would close.
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/home', '/inner'])
  })

  it('does not read a computed route key by its spelling', () => {
    // `{ [path]: 'ghost' }` where `const path = 'redirectTo'` declares a redirect, not an
    // address. Stripping the brackets off the key's text read it as a route and minted a node
    // and a must edge at /ghost, which the application never mounts.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { B } from './b.component'
const path = 'redirectTo'
export const routes: Routes = [{ path: 'home', component: A }, { [path]: 'ghost', component: B }]`,
      '/app/a.component.ts': C('<a routerLink="/ghost">z</a>'),
      '/app/b.component.ts': C('<p>b</p>'),
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(graph.edges.filter((e) => e.modality === 'must')).toEqual([])
  })

  it('reads a computed route key fixed to a string constant', () => {
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { B } from './b.component'
const KEY = 'path'
export const routes: Routes = [{ path: 'home', component: A }, { [KEY]: 'real', component: B }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/b.component.ts': C('<p>b</p>'),
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/home', '/real'])
  })

  it('does not declare a loss for a claimed file whose redirects the graph already registers', () => {
    // The probe counts a redirect the root scan would register, which it must; counting one the
    // graph already has at the same address declares a loss where none happened.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
export const routes: Routes = [{ path: 'home', component: A }, { path: 'old', redirectTo: '/home' }]`,
      '/app/a.component.ts': C('<a routerLink="/old">o</a>'),
      '/app/factory.ts': `import type { Routes } from '@angular/router'
import { LEGACY } from './legacy'
export function makeRoutes(): Routes { return [...LEGACY] }`,
      '/app/legacy.ts': `export const LEGACY = [{ path: 'old', redirectTo: '/home' }]`,
    })
    const { soundiness } = extractGraph(project, '/app')
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  it.each([
    ['an empty children array', `export const MENU = [{ path: 'dashboard', children: [] }]`],
    ['a redirectTo the walk cannot read', `const TARGET = buildTarget()\nexport const MENU = [{ path: 'dashboard', redirectTo: TARGET }]`],
  ])('declares the claimed table when the spread array places nothing despite %s', (_name, menu) => {
    // The array has the shape of routes and places nothing, so marking its file placed on shape
    // hid a real table claimed in the same file.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { MENU } from './feature/shared'
export const routes: Routes = [{ path: 'home', component: A, children: [...MENU] }, { path: 'feat', loadChildren: () => import('./feature/feature.module').then((m) => m.FeatureModule) }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/feature/shared.ts': `import { G } from './g.component'
${menu}
export const SETTINGS = [{ path: 'settings', component: G }]`,
      '/app/feature/feature.module.ts': `import { FeatureRoutingModule } from './feature-routing.module'
import { SETTINGS } from './shared'
export class FeatureModule {}`,
      '/app/feature/feature-routing.module.ts': `import type { Routes } from '@angular/router'
import { G } from './g.component'
export const featureRoutes: Routes = [{ path: 'inner', component: G }]`,
      '/app/feature/g.component.ts': C('<p>g</p>'),
    })
    const { soundiness } = extractGraph(project, '/app')
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
  })

  it('does not let a named-outlet route take the primary address from its sibling', () => {
    // A route on a named outlet is reached as `(aux:path)`, never at the primary address, so it
    // is no element of S. Minting it let it win the address by being declared first, and the
    // graph named Side where the application renders Main -- a wrong component, silently.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { Side } from './side.component'
import { Main } from './main.component'
export const routes: Routes = [{ path: 'home', component: A }, { path: 'detail', children: [{ path: '', component: Side, outlet: 'aux' }, { path: '', component: Main }] }]`,
      '/app/a.component.ts': C('<a routerLink="/detail">d</a>'),
      '/app/side.component.ts': `import { Component } from '@angular/core'
@Component({ standalone: true, template: '<p>side</p>' })
export class Side {}`,
      '/app/main.component.ts': `import { Component } from '@angular/core'
@Component({ standalone: true, template: '<p>main</p>' })
export class Main {}`,
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => `${n.route}=${n.label}`).sort()).toEqual(['/detail=Main', '/home=A'])
  })

  it('does not read a computed key from a binding that is reassigned', () => {
    // `let K = 'path'; K = 'redirectTo'` is not fixed to its initializer. Reading it as one
    // minted a node and a must edge at /ghost, which the application does not mount.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { B } from './b.component'
let K = 'path'
K = 'redirectTo'
export const routes: Routes = [{ path: 'home', component: A }, { [K]: 'ghost', component: B }]`,
      '/app/a.component.ts': C('<a routerLink="/ghost">z</a>'),
      '/app/b.component.ts': C('<p>b</p>'),
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(graph.edges.filter((e) => e.modality === 'must')).toEqual([])
  })

  it.each([
    ['an enum member', `enum E { path = 'path' }`, `[E.path]`],
    ['an identifier chain', `const BASE = 'path'\nconst K = BASE`, `[K]`],
    ['a call', `const mk = () => 'path'`, `[mk()]`],
  ])('declares a record whose key comes from %s', (_name, pre, key) => {
    // Vue declared these and Angular was silent, because its keyUnreadable was exported and
    // never called. A key the reader cannot fix to a string may be a path it cannot see.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { B } from './b.component'
${pre}
export const routes: Routes = [{ path: 'home', component: A }, { ${key}: 'x', component: B }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/b.component.ts': C('<p>b</p>'),
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
  })

  it('declares a record whose path is given by an accessor', () => {
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { B } from './b.component'
export const routes: Routes = [{ path: 'home', component: A }, { get path() { return 'x' }, component: B }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/b.component.ts': C('<p>b</p>'),
    })
    const { soundiness } = extractGraph(project, '/app')
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toHaveLength(1)
  })

  it('reads a computed key written in parentheses, and says nothing about a benign accessor', () => {
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { B } from './b.component'
export const routes: Routes = [{ path: 'home', component: A }, { [('path')]: 'x', component: B, get data() { return {} } }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/b.component.ts': C('<p>b</p>'),
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/home', '/x'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })

  it('does not declare a loss when the spread places an address a sibling already holds', () => {
    // The walk read shared.ts through the spread and placed /admin/users, which the sibling had
    // already taken. Measuring placement as growth of the node map saw nothing, so the file was
    // called unplaced and the route set was declared a lower bound it is not.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { U } from './u.component'
import { SHARED } from './feature/shared'
export const routes: Routes = [{ path: 'admin', component: A, children: [{ path: 'users', component: U }, ...SHARED] }, { path: 'feat', loadChildren: () => import('./feature/feature.module').then((m) => m.FeatureModule) }]`,
      '/app/a.component.ts': C('<p>a</p>'),
      '/app/u.component.ts': C('<p>u</p>'),
      '/app/feature/shared.ts': `import { U } from '../u.component'
export const SHARED = [{ path: 'users', component: U }]`,
      '/app/feature/feature.module.ts': `import { FeatureRoutingModule } from './feature-routing.module'
import { SHARED } from './shared'
export class FeatureModule {}`,
      '/app/feature/feature-routing.module.ts': `import type { Routes } from '@angular/router'
import { U } from '../u.component'
export const featureRoutes: Routes = [{ path: 'inner', component: U }]`,
    })
    const { graph, soundiness } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/admin', '/admin/users', '/feat/inner'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })
})

describe('a lazy module whose routing module is two hops away', () => {
  it('mounts a barrel-named module’s routing module under the lazy prefix', () => {
    // bitwarden's oss-routing names `ReportsModule` through the `./dirt/reports` barrel, and that
    // module imports `ReportsRoutingModule`, which is where the table lives. The owner lookup
    // stopped one hop from the barrel, found no table, and left the routing module to the root
    // scan, which minted `/breach-report` -- an address the application does not mount, under a
    // prefix the running router puts at `/reports/breach-report`.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { ReportsModule } from './reports'
export const routes: Routes = [{ path: 'reports', loadChildren: () => ReportsModule }]`,
      '/app/reports/index.ts': `export * from './reports.module'`,
      '/app/reports/reports.module.ts': `import { ReportsRoutingModule } from './reports-routing.module'
export class ReportsModule { r = ReportsRoutingModule }`,
      '/app/reports/reports-routing.module.ts': `import type { Routes } from '@angular/router'
import { B } from './breach.component'
export const routes: Routes = [{ path: 'breach-report', component: B }]`,
      '/app/reports/breach.component.ts': C('<p>breach</p>'),
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/reports/breach-report'])
  })

  it('mounts a dynamically imported barrel’s routing module under the lazy prefix', () => {
    // The same two hops with the shape bitwarden's organization routing uses: a dynamic import of
    // the barrel, then `.then((m) => m.MembersModule)`.
    const project = inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
export const routes: Routes = [{ path: 'members', loadChildren: () => import('./members').then((m) => m.MembersModule) }]`,
      '/app/members/index.ts': `export * from './members.module'`,
      '/app/members/members.module.ts': `import { MembersRoutingModule } from './members-routing.module'
export class MembersModule { r = MembersRoutingModule }`,
      '/app/members/members-routing.module.ts': `import type { Routes } from '@angular/router'
import { S } from './sponsored.component'
export const routes: Routes = [{ path: 'sponsored-families', component: S }]`,
      '/app/members/sponsored.component.ts': C('<p>sponsored</p>'),
    })
    const { graph } = extractGraph(project, '/app')
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/members/sponsored-families'])
  })
})

describe('a route source built by a call', () => {
  it('declares the route set incomplete when a spread resolves to no array', () => {
    // bitwarden builds its vault route with `...featureFlaggedRoute({ ... })`, which picks between
    // two components by feature flag. The spread was skipped in silence, so the extractor went on
    // to assert a complete route set over a table it had not read, and every dead-link finding the
    // application carried was published without the caveat that earns it.
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
declare function flagged(o: unknown): Routes
export const routes: Routes = [
  { path: 'home', component: A },
  ...flagged({ path: 'vault' }),
]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route)).toEqual(['/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set').map((n) => n.detail)).toEqual([
      '1 spread route source(s) could not be read, so the declared route set is a lower bound and no claim that a path is undeclared holds',
    ])
  })

  it('stays silent when every spread resolves to an array it reads', () => {
    const { graph, soundiness } = extractGraph(
      inMemory({
        '/app.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
import { EXTRA } from './extra.routes'
export const routes: Routes = [{ path: 'home', component: A }, ...EXTRA]`,
        '/extra.routes.ts': `import type { Routes } from '@angular/router'
import { A } from './a.component'
export const EXTRA: Routes = [{ path: 'extra', component: A }]`,
        '/a.component.ts': C('<p>a</p>'),
      }),
      '/',
    )
    expect(graph.nodes.map((n) => n.route).sort()).toEqual(['/extra', '/home'])
    expect(soundiness.filter((n) => n.kind === 'incomplete-route-set')).toEqual([])
  })
})
