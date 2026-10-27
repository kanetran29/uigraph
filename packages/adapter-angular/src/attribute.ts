// Scope attribution for the Angular adapter.
//
// A navigation site in a component that no route renders directly (a header, a
// card, a button) belongs to no single screen. Its scope is the set of screens on
// which that component is rendered. This pass computes it from two relations:
//
//   component nesting   A -> B when A's template instantiates B's element selector,
//                       resolved through A's imports when a selector is ambiguous
//   router outlets      a route component's template is rendered on its own screen
//                       and on every descendant screen (they render in its outlet);
//                       a layout component that holds the root <router-outlet> and
//                       is not itself routed is the application shell, rendered on
//                       every screen
//
// The scope lattice is  bottom < screen(r) < subtree(r) < top. Components reached
// from the shell get top and are anchored once at a `scope` node; everything else
// gets the explicit set of screens that render it. The result is a fixpoint over the
// nesting graph, computed here by reachability since nesting alone has no other
// transfer function. Services (scope = join of callers) are not handled in this
// version and are reported as a soundiness note.

import type { SourceFile } from 'ts-morph'
import type { SoundinessNote } from '@ui-graph/core'
import { inlineTemplate } from './templates'
import type { RouteInfo } from './routes'

export const SHELL_NODE_ID = 'n_scope_shell'

export interface ComponentInfo {
  sf: SourceFile
  file: string
  className: string | null
  selectors: string[]
  template: string | null
}

export interface ScopeResult {
  /** Components that are not route components, with the screens they render on. */
  screensOf: Map<string, Set<string>>
  /** Components rendered in the application shell (scope top). */
  shell: Set<string>
  /**
   * Shell components found only indirectly: an unreferenced, unrouted component whose
   * subtree holds the outlet. They are most likely mounted by a route the extractor
   * cannot see (e.g. a helper that wraps routes), so their real scope may be smaller
   * than top. Their edges are capped at may.
   */
  indirectShell: Set<string>
  /** Extra screens on which a route component's own template is rendered (its descendants). */
  descendantsOfRouteComponent: Map<string, Set<string>>
  components: Map<string, ComponentInfo>
  notes: SoundinessNote[]
  /** subtree(r) for every route node id: r and all its descendants. */
  subtreeOf: Map<string, Set<string>>
}

/** The route whose subtree is exactly `screens`, if there is one (an anchor), else null. */
export function subtreeAnchor(screens: Set<string>, subtreeOf: Map<string, Set<string>>): string | null {
  if (screens.size < 2) return null
  for (const s of screens) {
    const sub = subtreeOf.get(s)
    if (sub && sub.size === screens.size && [...screens].every((x) => sub.has(x))) return s
  }
  return null
}

function componentDecoratorArg(sf: SourceFile): { className: string | null; selectorText: string | null } | null {
  for (const cls of sf.getClasses()) {
    for (const dec of cls.getDecorators()) {
      if (dec.getName() !== 'Component') continue
      const arg = dec.getArguments()[0]
      const text = arg?.getText() ?? ''
      const sel = /selector\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1] ?? null
      return { className: cls.getName() ?? null, selectorText: sel }
    }
  }
  return null
}

/** Element selectors only: `app-header`, or each element part of `a-x, a-y`. Attribute selectors are not matched. */
function elementSelectors(selectorText: string | null): string[] {
  if (!selectorText) return []
  return selectorText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-zA-Z][\w-]*$/.test(s))
}

/** Every @Component in the project, with its element selectors and template text. */
export function collectComponents(sfs: SourceFile[]): Map<string, ComponentInfo> {
  const out = new Map<string, ComponentInfo>()
  for (const sf of sfs) {
    const dec = componentDecoratorArg(sf)
    if (!dec) continue
    const tpl = inlineTemplate(sf)
    out.set(sf.getFilePath(), { sf, file: sf.getFilePath(), className: dec.className, selectors: elementSelectors(dec.selectorText), template: tpl?.text ?? null })
  }
  return out
}

/** Files a source file imports, resolved inside the project. */
function importedFiles(sf: SourceFile): Set<string> {
  const out = new Set<string>()
  for (const imp of sf.getImportDeclarations()) {
    const t = imp.getModuleSpecifierSourceFile()
    if (t) out.add(t.getFilePath())
  }
  return out
}

/** Nesting graph: component file -> component files its template instantiates. */
export function nestingGraph(components: Map<string, ComponentInfo>, notes: SoundinessNote[]): Map<string, Set<string>> {
  const bySelector = new Map<string, ComponentInfo[]>()
  for (const c of components.values()) for (const s of c.selectors) {
    const list = bySelector.get(s) ?? []
    list.push(c)
    bySelector.set(s, list)
  }
  const graph = new Map<string, Set<string>>()
  for (const a of components.values()) {
    const kids = new Set<string>()
    graph.set(a.file, kids)
    if (!a.template) continue
    const tags = new Set([...a.template.matchAll(/<([a-zA-Z][\w-]*)/g)].map((m) => m[1] as string))
    let imports: Set<string> | null = null
    for (const tag of tags) {
      const cands = bySelector.get(tag)
      if (!cands) continue
      let chosen = cands
      if (cands.length > 1) {
        imports ??= importedFiles(a.sf)
        const narrowed = cands.filter((c) => imports!.has(c.file))
        if (narrowed.length > 0) chosen = narrowed
        else notes.push({ kind: 'ambiguous-selector', file: a.file, detail: `<${tag}> matches ${cands.length} components and none is imported directly; joined over all` })
      }
      for (const c of chosen) if (c.file !== a.file) kids.add(c.file)
    }
  }
  return graph
}

function reach(graph: Map<string, Set<string>>, start: string): Set<string> {
  const seen = new Set([start])
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()!
    for (const nx of graph.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx) }
  }
  return seen
}

/** Compute scopes for every non-route component and descendant screens for route components. */
export function attributeScopes(sfs: SourceFile[], routes: RouteInfo[]): ScopeResult {
  const notes: SoundinessNote[] = []
  // Test hosts and stories declare components too; they are not part of the application.
  const appFiles = sfs.filter((sf) => !/\.(spec|test|stories|cy|e2e)\.ts$/.test(sf.getFilePath()) && !/\/(testing|__tests__|e2e)\//.test(sf.getFilePath()))
  const components = collectComponents(appFiles)
  const nesting = nestingGraph(components, notes)

  // Route tree: children per node id, and the screens each route component renders on.
  const children = new Map<string, string[]>()
  for (const r of routes) if (r.parentNodeId) {
    const l = children.get(r.parentNodeId) ?? []
    l.push(r.nodeId)
    children.set(r.parentNodeId, l)
  }
  const subtree = (id: string): Set<string> => {
    const out = new Set<string>([id])
    const stack = [id]
    while (stack.length) for (const c of children.get(stack.pop()!) ?? []) if (!out.has(c)) { out.add(c); stack.push(c) }
    return out
  }
  const routeComponentScreens = new Map<string, Set<string>>() // component file -> screens it renders on (incl. descendants)
  const ownScreens = new Map<string, Set<string>>()
  for (const r of routes) {
    if (!r.componentFile) continue
    const f = r.componentFile.getFilePath()
    const all = routeComponentScreens.get(f) ?? new Set<string>()
    for (const s of subtree(r.nodeId)) all.add(s)
    routeComponentScreens.set(f, all)
    const own = ownScreens.get(f) ?? new Set<string>()
    own.add(r.nodeId)
    ownScreens.set(f, own)
  }
  const descendantsOfRouteComponent = new Map<string, Set<string>>()
  for (const [f, all] of routeComponentScreens) {
    const extra = new Set([...all].filter((s) => !ownScreens.get(f)!.has(s)))
    if (extra.size) descendantsOfRouteComponent.set(f, extra)
  }

  // Screens on which each component is rendered, by reachability from route components.
  const screensOf = new Map<string, Set<string>>()
  for (const [f, screens] of routeComponentScreens) {
    for (const c of reach(nesting, f)) {
      if (c === f || routeComponentScreens.has(c)) continue
      const set = screensOf.get(c) ?? new Set<string>()
      for (const s of screens) set.add(s)
      screensOf.set(c, set)
    }
  }

  // Shell: non-routed components that hold a <router-outlet> and are not rendered
  // inside any routed component; everything they reach (except routed components) is top.
  const shell = new Set<string>()
  for (const c of components.values()) {
    if (routeComponentScreens.has(c.file) || screensOf.has(c.file)) continue
    if (!c.template || !/<router-outlet(?![\w-])(?![^>]*\bname\s*=)/.test(c.template)) continue
    for (const x of reach(nesting, c.file)) if (!routeComponentScreens.has(x)) shell.add(x)
  }
  // Indirect shells: components nobody references and no route renders, whose subtree
  // contains a component with the primary outlet.
  const referenced = new Set<string>()
  for (const kids of nesting.values()) for (const k of kids) referenced.add(k)
  const hasOutlet = (f: string): boolean => /<router-outlet(?![\w-])(?![^>]*\bname\s*=)/.test(components.get(f)?.template ?? '')
  const indirectShell = new Set<string>()
  for (const c of components.values()) {
    if (referenced.has(c.file) || routeComponentScreens.has(c.file) || screensOf.has(c.file) || shell.has(c.file)) continue
    const r = reach(nesting, c.file)
    if (![...r].some((x) => x !== c.file && hasOutlet(x))) continue
    for (const x of r) if (!routeComponentScreens.has(x) && !shell.has(x)) indirectShell.add(x)
  }
  for (const x of [...shell, ...indirectShell]) screensOf.delete(x) // top absorbs any screen set (join)

  const subtreeOf = new Map<string, Set<string>>()
  for (const r of routes) subtreeOf.set(r.nodeId, subtree(r.nodeId))
  return { screensOf, shell, indirectShell, descendantsOfRouteComponent, components, notes, subtreeOf }
}
