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
