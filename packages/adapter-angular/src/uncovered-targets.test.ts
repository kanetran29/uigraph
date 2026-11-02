// Tests for the target and route rules the demotion-rule sweep found no test for, and for the
// rule a relative link that climbs above the root needs. The comment names the mutant each kills.
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { extractGraph } from './extract'
import { routeToNodeId as routeId } from './ids'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}
const page = (cls: string, tpl = '<router-outlet></router-outlet>') =>
  `import { Component } from '@angular/core'\n@Component({ selector: 'x-${cls.toLowerCase()}', standalone: true, template: '${tpl}' })\nexport class ${cls} {}`
const edgeOf = (graph: ReturnType<typeof extractGraph>['graph'], from: string, to: string) =>
  graph.edges.find((e) => e.from === routeId(from) && e.to === routeId(to))
const guardsOn = (guard: string | null | undefined) => (guard ?? '').split(',').filter((g) => g !== '')

/** /p carries `auth` under the default runGuardsAndResolvers, so it runs again unless the navigation keeps its segment. */
const underP = (link: string, extra: Record<string, string> = {}, aTemplate = `<a routerLink="${link}">l</a>`) => inMemory({
  '/app/guards.ts': `export const auth = () => true`,
  '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { auth } from './guards'
import { P } from './p.component'
import { A } from './a.component'
export const routes: Routes = [
  { path: 'p', component: P, canActivate: [auth], children: [{ path: 'a', component: A }, { path: 'b', component: P }] },
]`,
  '/app/p.component.ts': page('P'),
  '/app/a.component.ts': page('A', aTemplate),
  ...extra,
})

describe('the segments a relative link keeps', () => {
  it('skips a leading dot before counting the segments it climbs out of', () => {
    // 96: keptSegments, dot segment not skipped. ./../../p/b climbs out of both of /p/a's
    // segments, so p's matrix parameters go and its canActivate runs.
    const { graph } = extractGraph(underP('./../../p/b'), '/app')
    const e = edgeOf(graph, '/p/a', '/p/b')
    expect(e?.modality).toBe('may')
    expect(guardsOn(e?.guard)).toContain('auth')
  })

  it('keeps none, and no fewer than none, when the route it starts from has no segment', () => {
    // 97: keptSegments, negative count not clamped. From the empty-path root Angular resolves the
    // command as absolute, so the shell route stays and its canActivate does not run again.
    const { graph } = extractGraph(inMemory({
      '/app/guards.ts': `export const auth = () => true`,
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { auth } from './guards'
import { Shell } from './shell.component'
import { B } from './b.component'
export const routes: Routes = [{ path: '', component: Shell, canActivate: [auth], children: [{ path: 'b', component: B }] }]`,
      '/app/shell.component.ts': page('Shell', '<a routerLink="../b">b</a><router-outlet></router-outlet>'),
      '/app/b.component.ts': page('B'),
    }), '/app')
    const e = edgeOf(graph, '/', '/b')
    expect(e?.modality).toBe('must')
    expect(guardsOn(e?.guard)).toEqual([])
  })

  it('keeps nothing when the base it would resolve against is only assumed', () => {
    // 92: preserved, baseUnknown check dropped. The link sits in a component A places, so its
    // base is not /p/a's route; nothing is kept and p's canActivate is named.
    const kid = `import { Component } from '@angular/core'\n@Component({ selector: 'x-kid', standalone: true, template: '<a routerLink="../b">b</a>' })\nexport class Kid {}`
    const { graph } = extractGraph(underP('', { '/app/kid.component.ts': kid }, '<x-kid></x-kid>'), '/app', { attribution: true })
    const e = graph.edges.find((x) => x.to === routeId('/p/b') && x.witness?.file === 'kid.component.ts')
    expect(e).toBeDefined()
    expect(e?.modality).toBe('may')
    expect(guardsOn(e?.guard)).toContain('auth')
  })
})

describe('a relative link that climbs above the root', () => {
  it('draws no edge, since Angular rejects it, and says so', () => {
    // From /p/a, three `..` outnumber the route's two segments: Angular throws NG04005.
    const { graph, soundiness } = extractGraph(underP('../../../p/b'), '/app')
    expect(graph.edges.filter((e) => e.from === routeId('/p/a') && e.witness?.file === 'a.component.ts')).toEqual([])
    expect(soundiness.some((n) => n.file === 'a.component.ts' && /above the root/.test(n.detail))).toBe(true)
  })

  it('still draws the edge for as many `..` as the route has segments', () => {
    const { graph } = extractGraph(underP('../../p/b'), '/app')
    expect(edgeOf(graph, '/p/a', '/p/b')).toBeDefined()
  })
})

describe('an empty-path child whose redirect the reader cannot read', () => {
  it('still hides the screen above it', () => {
    // 128: an unreadable target does not hide the screen
    const { graph } = extractGraph(inMemory({
      '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { H } from './h.component'
import { P } from './p.component'
function pick(): string { return '/home' }
export const routes: Routes = [
  { path: 'home', component: H },
  { path: 'p', component: P, children: [{ path: '', redirectTo: pick(), pathMatch: 'full' }, { path: 'x', component: H }] },
]`,
      '/app/h.component.ts': page('H', '<a routerLink="/p">p</a>'),
      '/app/p.component.ts': page('P'),
    }), '/app')
    expect(edgeOf(graph, '/home', '/p')?.modality).not.toBe('must')
  })
})

describe('a route title the router awaits', () => {
  const titled = () => extractGraph(inMemory({
    '/app/app.routes.ts': `import type { Routes } from '@angular/router'
import { H } from './h.component'
import { P } from './p.component'
const TITLE = 'T'
function pick(): string | (() => string) { return 'U' }
export const routes: Routes = [
  { path: 'home', component: H },
  { path: 't', component: P, title: TITLE },
  { path: 'u', component: P, title: pick() },
]`,
    '/app/h.component.ts': page('H', '<a routerLink="/t">t</a><a routerLink="/u">u</a>'),
    '/app/p.component.ts': page('P'),
  }), '/app').graph

  it('is not one when a name the reader follows holds a string', () => {
    // 131: every non-literal title is a resolver
    expect(edgeOf(titled(), '/home', '/t')?.modality).toBe('must')
  })
  it('is one when only some members of its type are strings', () => {
    // 132: one string member makes a union static
    expect(edgeOf(titled(), '/home', '/u')?.modality).toBe('may')
  })
})
