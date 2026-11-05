import { describe, it, expect, afterEach } from 'vitest'
import { Project } from 'ts-morph'
import { extractGraph } from './extract'
import { routeToNodeId as routeId } from './ids'

/** A project of in-memory files, keyed by path. */
function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

const page = (cls: string, tpl = '<p>x</p>', body = '') =>
  `import { Component } from '@angular/core'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '${tpl}' })\nexport class ${cls} {\n${body}\n}`

/**
 * An application whose screens hold one construct of each kind the census tells apart: a
 * navigation under an `if`, one inside a subscribe callback, a template-literal target, a link
 * under `*ngIf`, a link to a guarded route, and an unconditional link that earns must.
 */
const files = {
  '/app/guards.ts': 'export const auth = () => true',
  '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { auth } from './guards'
import { Home } from './home.component'
import { H2 } from './h2.component'
import { H3 } from './h3.component'
import { H4 } from './h4.component'
import { P } from './p.component'
export const routes: Routes = [
  { path: 'home', component: Home },
  { path: 'h2', component: H2 },
  { path: 'h3', component: H3 },
  { path: 'h4', component: H4 },
  { path: 'u', component: P },
  { path: 'n', component: P },
  { path: 'g', component: P, canActivate: [auth] },
  { path: 'a', component: P },
  { path: 'b', component: P },
  { path: 't/:id', component: P },
]`,
  '/app/p.component.ts': page('P'),
  '/app/home.component.ts': page('Home', '<a routerLink="/u">u</a><a *ngIf="x" routerLink="/n">n</a><a routerLink="/g">g</a>'),
  '/app/h2.component.ts': page('H2', '<p>x</p>', `  constructor(private router: Router) {}
  ngOnInit() { if (this.x) { this.router.navigate(['/a']) } }`),
  '/app/h3.component.ts': page('H3', '<p>x</p>', `  constructor(private router: Router, private http: Http) {}
  ngOnInit() { this.http.get('/x').subscribe(() => { this.router.navigate(['/b']) }) }`),
  '/app/h4.component.ts': page('H4', '<p>x</p>', `  constructor(private router: Router) {}
  ngOnInit() { this.router.navigateByUrl(\`/t/\${this.id}\`) }`),
}

const run = (flag: string | undefined) => {
  if (flag === undefined) delete process.env.UIGRAPH_MAY_REASONS
  else process.env.UIGRAPH_MAY_REASONS = flag
  return extractGraph(inMemory(files), '/app').graph
}

/** Every witness of every edge into `path`, the primary one and the merged ones. */
const witnessesTo = (graph: ReturnType<typeof run>, path: string) =>
  graph.edges.filter((e) => e.to === routeId(path)).flatMap((e) => [e.witness, ...(e.mergedWitnesses ?? [])])

afterEach(() => {
  delete process.env.UIGRAPH_MAY_REASONS
})

describe('the may-reason measurement flag', () => {
  it('names the condition that held each may witness at may', () => {
    const g = run('1')
    const reasons = (path: string) => witnessesTo(g, path).map((w) => (w as { reasons?: string[] }).reasons)
    expect(reasons('/a')).toEqual([['under a branch']])
    expect(reasons('/b')).toEqual([['in a callback']])
    expect(reasons('/n')).toEqual([['structural directive']])
    expect(reasons('/g')).toEqual([['guard']])
    expect(reasons('/t/:id')).toEqual([['over-approximated target']])
  })

  it('names the site\'s own condition on a template-literal target, as it does on a literal one', () => {
    const g = run('1')
    const own = witnessesTo(g, '/t/:id').map((w) => (w as { reasons?: string[] }).reasons)
    expect(own).toEqual([['over-approximated target']])
    const under = witnessesTo(extractGraph(inMemory({ ...files, '/app/h4.component.ts': page('H4', '<p>x</p>', '  constructor(private router: Router) {}\n  ngOnInit() { if (this.x) { this.router.navigateByUrl(`/t/${this.id}`) } }') }), '/app').graph, '/t/:id')
    expect(under.map((w) => (w as { reasons?: string[] }).reasons)).toEqual([['over-approximated target', 'under a branch']])
  })

  it('leaves a must witness without reasons', () => {
    const g = run('1')
    const edge = g.edges.find((e) => e.from === routeId('/home') && e.to === routeId('/u'))
    expect(edge?.modality).toBe('must')
    expect(edge?.witness).not.toHaveProperty('reasons')
  })

  it('adds no key when unset, and the graph is the flagged one minus its reasons', () => {
    const plain = run(undefined)
    expect(JSON.stringify(plain)).not.toContain('"reasons"')
    const flagged = run('1')
    expect(JSON.stringify(flagged)).toContain('"reasons"')
    expect(JSON.parse(JSON.stringify(flagged, (k, v) => (k === 'reasons' ? undefined : v)))).toEqual(JSON.parse(JSON.stringify(plain)))
    expect(JSON.stringify(flagged, (k, v) => (k === 'reasons' ? undefined : v))).toBe(JSON.stringify(plain))
  })

  it('ignores any value but 1', () => {
    expect(JSON.stringify(run('0'))).not.toContain('"reasons"')
  })
})

/**
 * Attribution mode, where a component's links are drawn from every screen that mounts it. Each
 * case holds one cause that keeps its witness at may; the reasons must name that cause and no other.
 */
describe('the may-reason measurement flag in attribution mode', () => {
  const comp = (cls: string, sel: string, tpl: string, body = '') =>
    `import { Component } from '@angular/core'\n@Component({ selector: '${sel}', standalone: true, template: '${tpl}' })\nexport class ${cls} {\n${body}\n}`
  const routes = (paths: string[], extra = '') =>
    `import type { Routes } from '@angular/router'\nimport { T } from './t.component'\nimport { Home } from './home.component'\nimport { auth } from './guards'\nexport const routes: Routes = [{ path: 'home', component: Home }, ${paths.map((p) => `{ path: '${p}', component: T }`).join(', ')}${extra}]`
  const leaf = comp('T', 'x-t', '<p>t</p>')
  const guards = 'export const auth = () => true'
  const attribute = (app: Record<string, string>) => {
    process.env.UIGRAPH_MAY_REASONS = '1'
    return extractGraph(inMemory({ '/app/t.component.ts': leaf, '/app/guards.ts': guards, ...app }), '/app', { attribution: true }).graph
  }
  const reasonsTo = (g: ReturnType<typeof attribute>, path: string) =>
    witnessesTo(g, path).map((w) => (w as { reasons?: string[] }).reasons)

  it('names a component mounted under a template condition for that, not for the extractor', () => {
    const g = attribute({
      '/app/app.routes.ts': routes(['k']),
      '/app/home.component.ts': comp('Home', 'x-home', '@if (flag) { <x-kid></x-kid> }'),
      '/app/kid.component.ts': comp('Kid', 'x-kid', '<a routerLink="/k">k</a>'),
    })
    expect(reasonsTo(g, '/k')).toEqual([['mounted under a template condition']])
  })

  it('names an outlet held under a template condition, and keeps no-outlet apart', () => {
    const app = (tpl: string) => ({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { P } from './p.component'\nimport { C } from './c.component'\nimport { T } from './t.component'\nexport const routes: Routes = [{ path: 'p', component: P, children: [{ path: 'c', component: C }] }, { path: 'x', component: T }]`,
      '/app/p.component.ts': comp('P', 'x-p', tpl),
      '/app/c.component.ts': comp('C', 'x-c', '<a routerLink="/x">x</a>'),
    })
    expect(reasonsTo(attribute(app('@if (ready) { <router-outlet></router-outlet> }')), '/x')).toEqual([['outlet under a template condition']])
    expect(reasonsTo(attribute(app('<p>no outlet</p>')), '/x')).toEqual([['no outlet or component found']])
  })

  it('keeps the capped scope of an indirect shell as attribution scope uncertain', () => {
    const g = attribute({
      '/app/app.routes.ts': routes(['x']),
      '/app/home.component.ts': comp('Home', 'x-home', '<p>h</p>'),
      '/app/root.component.ts': comp('Root', 'x-root', '<x-layout></x-layout><a routerLink="/x">x</a>'),
      '/app/layout.component.ts': comp('Layout', 'x-layout', '<router-outlet></router-outlet>'),
    })
    const all = reasonsTo(g, '/x').flat()
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((r) => ['attribution scope uncertain', 'mounted under a template condition'].includes(r!))).toBe(true)
    expect(all).toContain('attribution scope uncertain')
  })

  it('records the guard and the site condition on an anchored edge held at may for a shared reason', () => {
    const g = attribute({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'\nimport { Home } from './home.component'\nimport { T } from './t.component'\nimport { auth } from './guards'\nexport const routes: Routes = [{ path: 'home', component: Home, children: [{ path: 'a', component: T }, { path: 'b', component: T }] }, { path: 'g', component: T, canActivate: [auth] }]`,
      '/app/home.component.ts': comp('Home', 'x-home', '<x-kid></x-kid><router-outlet></router-outlet>'),
      '/app/kid.component.ts': comp('Kid', 'x-kid', '<a *ngIf="flag" routerLink="/g">g</a>'),
    })
    const r = reasonsTo(g, '/g').flat()
    expect(r).toContain('structural directive')
    expect(r).toContain('guard')
  })

  it('keeps each merged witness\'s own reasons', () => {
    const g = attribute({
      '/app/app.routes.ts': routes(['u']),
      '/app/home.component.ts': comp('Home', 'x-home', '<a *ngIf="a" routerLink="/u">1</a>@for (i of xs; track i) { <a routerLink="/u">2</a> }'),
    })
    expect(reasonsTo(g, '/u').map((r) => r?.join(','))).toEqual(['structural directive', 'control-flow block'])
  })

  it('names a link to the screen it sits on, and a template-literal target under a condition', () => {
    const g = attribute({
      '/app/app.routes.ts': routes(['t/:id']),
      '/app/home.component.ts': comp('Home', 'x-home', '<a routerLink="/home">me</a>', '  constructor(private router: Router) {}\n  ngOnInit() { if (this.x) { this.router.navigateByUrl(`/t/${this.id}`) } }'),
    })
    expect(reasonsTo(g, '/home')).toEqual([['same screen']])
    expect(reasonsTo(g, '/t/:id')).toEqual([['over-approximated target', 'under a branch']])
  })
})

describe('the may-reason measurement flag in controls mode', () => {
  it('records a hidden outlet as one reason, not as its characters (re-review N1)', () => {
    process.env.UIGRAPH_MAY_REASONS = '1'
    const ctl = {
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { Parent } from './parent.component'
import { Child } from './child.component'
import { P } from './p.component'
export const routes: Routes = [
  { path: 'parent', component: Parent, children: [{ path: 'child', component: Child }] },
  { path: 'z', component: P },
]`,
      '/app/p.component.ts': page('P'),
      '/app/parent.component.ts': page('Parent', '@if (ready) { <router-outlet></router-outlet> }'),
      '/app/child.component.ts': page('Child', '<button (click)="go()">go</button>', `  constructor(private router: Router) {}
  go() { this.router.navigate(['/z']) }`),
    }
    const g = extractGraph(inMemory(ctl), '/app', { controls: true }).graph
    const reasons = witnessesTo(g, '/z').map((w) => (w as { reasons?: string[] }).reasons ?? [])
    expect(reasons.length).toBeGreaterThan(0)
    for (const r of reasons) for (const x of r) expect(x.length).toBeGreaterThan(1)
  })
})
