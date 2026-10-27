import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Project } from 'ts-morph'
import { validateGraph } from '@ui-graph/core'
import { buildProject, extractGraph } from './extract'

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
})
