import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { validateGraph, edgesFrom, expandAnchoredEdges } from '@ui-graph/core'
import { extractGraph } from './extract'
import { SHELL_NODE_ID } from './attribute'

function inMemory(files: Record<string, string>): Project {
  const p = new Project({ useInMemoryFileSystem: true })
  for (const [path, content] of Object.entries(files)) p.createSourceFile(path, content)
  return p
}

// A small app: a shell with a header, three routed screens, a card shared by two of
// them, and a parent route whose template (tabs) is rendered on its child screen.
const app = {
  '/app/src/app.component.ts': `
    import { Component } from '@angular/core'
    @Component({ selector: 'app-root', template: \`<app-header></app-header><router-outlet></router-outlet>\` })
    export class AppComponent {}`,
  '/app/src/header.component.ts': `
    import { Component } from '@angular/core'
    @Component({ selector: 'app-header', template: \`<a routerLink="/settings">Settings</a>\` })
    export class HeaderComponent {}`,
  '/app/src/card.component.ts': `
    import { Component } from '@angular/core'
    @Component({ selector: 'app-card', template: \`<a routerLink="/settings">Edit</a>\` })
    export class CardComponent {}`,
  '/app/src/home.component.ts': `
    import { Component } from '@angular/core'
    @Component({ selector: 'app-home', template: \`<app-card></app-card>\` })
    export class HomeComponent {}`,
  '/app/src/feed.component.ts': `
    import { Component } from '@angular/core'
    @Component({ selector: 'app-feed', template: \`<app-card />\` })
    export class FeedComponent {}`,
  '/app/src/settings.component.ts': `
    import { Component } from '@angular/core'
    @Component({ selector: 'app-settings', template: \`<a routerLink="/">Home</a><router-outlet></router-outlet>\` })
    export class SettingsComponent {}`,
  '/app/src/profile.component.ts': `
    import { Component } from '@angular/core'
    @Component({ selector: 'app-profile', template: \`<p>profile</p>\` })
    export class ProfileComponent {}`,
  '/app/src/app.routes.ts': `
    import { Routes } from '@angular/router'
    import { HomeComponent } from './home.component'
    import { FeedComponent } from './feed.component'
    import { SettingsComponent } from './settings.component'
    import { ProfileComponent } from './profile.component'
    export const routes: Routes = [
      { path: '', component: HomeComponent },
      { path: 'feed', component: FeedComponent },
      { path: 'settings', component: SettingsComponent, children: [{ path: 'profile', component: ProfileComponent }] },
    ]`,
}

describe('scope attribution', () => {
  const base = extractGraph(inMemory(app), '/app').graph
  const attr = extractGraph(inMemory(app), '/app', { attribution: true }).graph
  const has = (g: typeof attr, from: string, to: string): boolean => g.edges.some((e) => e.from === from && e.to === to)

  it('leaves the baseline unchanged when the option is off', () => {
    expect(base.nodes.some((n) => n.kind === 'scope')).toBe(false)
    expect(has(base, 'n_root', 'n_settings')).toBe(false)
  })

  it('produces a valid graph', () => {
    expect(validateGraph(attr)).toEqual([])
  })

  it('anchors shell navigation once at the scope node', () => {
    expect(attr.nodes.find((n) => n.id === SHELL_NODE_ID)?.kind).toBe('scope')
    const shell = attr.edges.filter((e) => e.from === SHELL_NODE_ID)
    expect(shell).toHaveLength(1)
    expect(shell[0]?.to).toBe('n_settings')
    expect(shell[0]?.witness?.file).toBe('src/header.component.ts')
  })

  it('attributes a shared component to every screen that renders it', () => {
    expect(has(attr, 'n_root', 'n_settings')).toBe(true)
    expect(has(attr, 'n_feed', 'n_settings')).toBe(true)
    expect(has(attr, 'n_settings_profile', 'n_settings')).toBe(false)
  })

  it('anchors a parent route template at its subtree and expands it to the child screen', () => {
    const anchor = attr.nodes.find((n) => n.id === 'n_scope_subtree__n_settings')
    expect(anchor?.scope).toEqual({ kind: 'subtree', root: 'n_settings', members: ['n_settings', 'n_settings_profile'] })
    expect(has(attr, 'n_scope_subtree__n_settings', 'n_root')).toBe(true)
    expect(edgesFrom(attr, 'n_settings_profile').some((e) => e.to === 'n_root')).toBe(true)
    expect(edgesFrom(attr, 'n_feed').some((e) => e.to === 'n_root')).toBe(false)
  })

  it('expands shell edges to every screen', () => {
    const expanded = expandAnchoredEdges(attr)
    for (const s of ['n_root', 'n_feed', 'n_settings', 'n_settings_profile']) {
      expect(expanded.edges.some((e) => e.from === s && e.to === 'n_settings')).toBe(true)
    }
    expect(expanded.nodes.some((n) => n.kind === 'scope')).toBe(false)
  })

  it('keeps every baseline edge', () => {
    const ids = new Set(attr.edges.map((e) => e.id))
    for (const e of base.edges) expect(ids.has(e.id)).toBe(true)
  })
})

describe('attribution levels', () => {
  /**
   * The (site, screen) pairs a graph asserts, which is what the ablation of Chapter 5 counts.
   * Only screen-anchored edges count. A site the level cannot place is anchored at an origin
   * node instead, and those are not nested across levels by design: the pair vanishes from the
   * origin as soon as a later level finds the component a screen to sit on.
   */
  const pairs = (layers: string): Set<string> => {
    const previous = process.env.UIGRAPH_SCOPE_LAYERS
    process.env.UIGRAPH_SCOPE_LAYERS = layers
    try {
      const g = expandAnchoredEdges(extractGraph(inMemory(app), '/app', { attribution: true }).graph)
      const screens = new Set(g.nodes.filter((n) => n.kind === 'screen').map((n) => n.id))
      const out = new Set<string>()
      for (const e of g.edges) {
        if (!screens.has(e.from)) continue
        for (const w of [e.witness, ...(e.mergedWitnesses ?? [])]) {
          if (!w || w.source !== 'static' || !w.file) continue
          out.add(`${w.file}:${w.loc?.line ?? '?'}|${e.from}`)
        }
      }
      return out
    } finally {
      if (previous === undefined) delete process.env.UIGRAPH_SCOPE_LAYERS
      else process.env.UIGRAPH_SCOPE_LAYERS = previous
    }
  }

  // The ablation compares the levels with one another, so a level that is not contained in the
  // next makes every comparison drawn from it meaningless.
  it('are nested, each level within the next', () => {
    const levels = ['owned', 'nesting', 'outlet', 'full'].map((l) => ({ l, p: pairs(l) }))
    for (let i = 1; i < levels.length; i += 1) {
      const escaped = [...levels[i - 1]!.p].filter((x) => !levels[i]!.p.has(x))
      expect({ level: levels[i - 1]!.l, escaped }).toEqual({ level: levels[i - 1]!.l, escaped: [] })
    }
  })

  it('places strictly more at each level than the one below', () => {
    const sizes = ['owned', 'nesting', 'outlet', 'full'].map((l) => pairs(l).size)
    expect(sizes[0]!).toBeLessThan(sizes[3]!)
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]!)
  })

  // An unset or unknown value must be the shipped analysis, since every published figure is
  // measured with the variable unset.
  it('treats an unset or unknown value as the full analysis', () => {
    expect(pairs('full')).toEqual(pairs('not-a-level'))
  })
})
