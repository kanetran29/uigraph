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

import { Node, SyntaxKind } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import type { SoundinessNote } from '@ui-graph/core'
import { inlineTemplate } from './templates'
import type { RouteInfo } from './routes'
import { declarationsOf, isInsideDir } from './resolve'
import { templateCondition } from './conditions'
import { memberScopes, type MemberKey } from './callgraph'

export const SHELL_NODE_ID = 'n_scope_shell'

export interface ComponentInfo {
  sf: SourceFile
  file: string
  className: string | null
  selectors: string[]
  /** Attribute selectors, for a directive: a template carrying the attribute renders it. */
  attributes: string[]
  template: string | null
}

/**
 * Which attribution mechanisms to apply, for the ablation of Section 5 of the thesis. Each
 * level adds one mechanism to the one before it, so the levels are nested:
 *
 *   owned    a navigation site is attributed to the screen whose routed component's own
 *            file holds it, and to nothing else -- the direct-ownership baseline, which is
 *            what resolving the owning object gives in the Android literature.
 *   nesting  plus component containment: a component reached from a routed component's
 *            template is attributed to that component's screens.
 *   rooted   plus the shell rule, so a component the root renders is attributed to every
 *            screen. Oshima and Kishi (2018) assemble page information from the root
 *            component as well as from the components under it, so this level, and not
 *            `nesting`, is the one that stands for the prior work's reach.
 *   outlet   plus router-outlet descent: a routed component's own template also renders on
 *            every descendant screen, because they render inside its outlet.
 *   full     plus the call graph: a navigation in a class that is not a component is
 *            attributed to the screens of the members that call the member holding it,
 *            transitively, through the declarations the types and provider bindings name, and
 *            where no caller is found, or a caller the graph cannot see also reaches it, to
 *            every component that injects the class as well.
 *
 * `class` sits beside the chain rather than in it: it is `full` with the per-class join of an
 * earlier version in place of the call graph, kept so the two can be compared.
 *
 * `full` is the default and the path it takes is untouched: the levels are applied by
 * withholding results at the end, never by computing them differently.
 */
export type ScopeLayers = 'owned' | 'nesting' | 'rooted' | 'outlet' | 'full' | 'class'

export interface ScopeResult {
  /** Components that are not route components, with the screens they render on. */
  screensOf: Map<string, Set<string>>
  /** Components rendered in the application shell (scope top). */
  shell: Set<string>
  /**
   * Shell components found only indirectly: an unreferenced, unrouted component whose
   * subtree holds the outlet, or an outlet holder that a route names although the route walk
   * dropped that route (it keeps one route per address). They are most likely mounted by a
   * route the extractor cannot see (e.g. a helper that wraps routes), so their real scope may
   * be smaller than top. Their edges are capped at may, and the call graph does not seed an
   * outlet holder of the second kind, nor what it nests, at top.
   */
  indirectShell: Set<string>
  /** Extra screens on which a route component's own template is rendered (its descendants). */
  descendantsOfRouteComponent: Map<string, Set<string>>
  components: Map<string, ComponentInfo>
  /**
   * Non-component files (services, facades, stores) that navigate, with the screens their
   * injectors are rendered on — the join over the callers, taken at class granularity. The
   * join over every injector is at least the real scope and may be larger, so edges from it
   * are capped at may.
   */
  serviceScreens: Map<string, Set<string>>
  /** Services injected somewhere in the application shell: their scope is top. */
  serviceShell: Set<string>
  /**
   * Whether this level stands in for the relations Chapter 3 specifies and the prototype does
   * not implement: an effect at the shell, and a navigation inside a guard attributed to the
   * routes that name it. Both are approximations of the dispatch relation and the call graph,
   * so a level below `full` must not carry them, or the lowest level is not the ownership
   * baseline it is reported as. The service join is withheld by clearing its sets instead.
   */
  standIns: boolean
  notes: SoundinessNote[]
  /** subtree(r) for every route node id: r and all its descendants. */
  subtreeOf: Map<string, Set<string>>
  /**
   * The screens of `screensOf` on which a component is mounted unconditionally: reached from a
   * route component through templates that place each child outside any control-flow block,
   * structural directive or `<ng-template>`. On its other screens it renders only on some
   * executions, so its navigation sites are conditional there.
   */
  firmScreensOf: Map<string, Set<string>>
  /** The shell components mounted unconditionally from the shell's root. */
  firmShell: Set<string>
  /** Screens of each class member the call graph reaches from a component; empty below `full`. */
  memberScreens: Map<MemberKey, Set<string>>
  /** Members the call graph reaches from the shell. */
  memberTop: Set<MemberKey>
  /** Members a caller the call graph cannot see may also reach: their scope is at least `memberScreens` and may be wider. */
  memberUnseen: Set<MemberKey>
  /** How the call graph resolved the calls it followed. */
  memberResolved: { direct: number; bound: number; subclass: number; unresolved: number }
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
      // A directive is rendered by the templates that carry its attribute, exactly as a
      // component is rendered by the templates that carry its element, so it has a scope the
      // same way. Reading only @Component left every navigating directive unplaceable.
      if (dec.getName() !== 'Component' && dec.getName() !== 'Directive') continue
      const arg = dec.getArguments()[0]
      const text = arg?.getText() ?? ''
      const sel = /selector\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1] ?? null
      return { className: cls.getName() ?? null, selectorText: sel }
    }
  }
  return null
}

/** Element selectors: `app-header`, or each element part of `a-x, a-y`. */
function elementSelectors(selectorText: string | null): string[] {
  if (!selectorText) return []
  return selectorText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-zA-Z][\w-]*$/.test(s))
}

/** Attribute selectors: `[acaAction]`, or each attribute part of `[a], [b]`, without the brackets. */
function attributeSelectors(selectorText: string | null): string[] {
  if (!selectorText) return []
  return selectorText
    .split(',')
    .map((s) => s.trim())
    .flatMap((s) => {
      const m = /^\[([a-zA-Z][\w-]*)\]$/.exec(s)
      return m?.[1] ? [m[1]] : []
    })
}

/** Every @Component in the project, with its element selectors and template text. */
export function collectComponents(sfs: SourceFile[]): Map<string, ComponentInfo> {
  const out = new Map<string, ComponentInfo>()
  for (const sf of sfs) {
    const dec = componentDecoratorArg(sf)
    if (!dec) continue
    const tpl = inlineTemplate(sf)
    out.set(sf.getFilePath(), { sf, file: sf.getFilePath(), className: dec.className, selectors: elementSelectors(dec.selectorText), attributes: attributeSelectors(dec.selectorText), template: tpl?.text ?? null })
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

/**
 * Nesting graph: component file -> component files its template instantiates. `firm`, when
 * given, receives the sub-graph of the placements at least one of which sits outside every
 * template condition, read at the child's own tag so a directive on it counts.
 */
export function nestingGraph(components: Map<string, ComponentInfo>, notes: SoundinessNote[], firm?: Map<string, Set<string>>): Map<string, Set<string>> {
  const bySelector = new Map<string, ComponentInfo[]>()
  for (const c of components.values()) for (const s of c.selectors) {
    const list = bySelector.get(s) ?? []
    list.push(c)
    bySelector.set(s, list)
  }
  const byAttribute = new Map<string, ComponentInfo[]>()
  for (const c of components.values()) for (const a of c.attributes) {
    const list = byAttribute.get(a) ?? []
    list.push(c)
    byAttribute.set(a, list)
  }
  const graph = new Map<string, Set<string>>()
  for (const a of components.values()) {
    const kids = new Set<string>()
    const firmKids = new Set<string>()
    graph.set(a.file, kids)
    firm?.set(a.file, firmKids)
    if (!a.template) continue
    const template = a.template
    const tagMatches = [...template.matchAll(/<([a-zA-Z][\w-]*)/g)]
    const tags = new Set(tagMatches.map((m) => m[1] as string))
    const firmTags = new Set(tagMatches.filter((m) => templateCondition(template, m.index + 1) === null).map((m) => m[1] as string))
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
      for (const c of chosen) if (c.file !== a.file) { kids.add(c.file); if (firmTags.has(tag)) firmKids.add(c.file) }
    }
    // A directive is applied as an attribute, so the template that carries the attribute is
    // what renders it. Bound and plain forms both count: `acaAction`, `[acaAction]`.
    if (byAttribute.size > 0) {
      const attrMatches = [...template.matchAll(/[\s[(]([a-zA-Z][\w-]*)[\])]?\s*(?==|\/?>|\s)/g)]
      const attrs = new Set(attrMatches.map((m) => m[1] as string))
      const firmAttrs = new Set(attrMatches.filter((m) => templateCondition(template, m.index) === null).map((m) => m[1] as string))
      for (const attr of attrs) {
        const cands = byAttribute.get(attr)
        if (!cands) continue
        let chosen = cands
        if (cands.length > 1) {
          imports ??= importedFiles(a.sf)
          const narrowed = cands.filter((c) => imports!.has(c.file))
          if (narrowed.length > 0) chosen = narrowed
          else notes.push({ kind: 'ambiguous-selector', file: a.file, detail: `attribute ${attr} matches ${cands.length} directives and none is imported directly; joined over all` })
        }
        for (const c of chosen) if (c.file !== a.file) { kids.add(c.file); if (firmAttrs.has(attr)) firmKids.add(c.file) }
      }
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

/**
 * Whether a file registers an NgRx effect, which the store keeps for the life of the application.
 * Read from the syntax tree, not the text: a `createEffect(` inside a comment is not an effect.
 */
export function isEffectFile(sf: SourceFile): boolean {
  return sf.getFullText().includes('createEffect') && sf.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => /(^|\.)createEffect$/.test(c.getExpression().getText()))
}

/**
 * The files the application loads: those under `projectDir` and every file they import, re-export
 * from or `import()` in turn. A workspace alias brings a sibling application's directory into the
 * project, but a file of it that nothing here imports is never loaded, so what it provides runs nowhere.
 */
function loadedFiles(sfs: SourceFile[], projectDir: string): Set<string> {
  const byPath = new Map(sfs.map((sf) => [sf.getFilePath(), sf]))
  const seen = new Set(sfs.filter((sf) => isInsideDir(sf.getFilePath(), projectDir)).map((sf) => sf.getFilePath()))
  const stack = [...seen]
  while (stack.length) {
    for (const lit of byPath.get(stack.pop()!)?.getImportStringLiterals() ?? []) {
      for (const d of lit.getSymbol()?.getDeclarations() ?? []) {
        if (!Node.isSourceFile(d) || seen.has(d.getFilePath()) || !byPath.has(d.getFilePath())) continue
        seen.add(d.getFilePath())
        stack.push(d.getFilePath())
      }
    }
  }
  return seen
}

/**
 * Component files some route object names in its `component` property, whether or not the route
 * walk kept that route: the walk keeps one route per address, so a second `{ path: '', component }`
 * is dropped and its component looks unrouted.
 */
function routeNamedComponents(sfs: SourceFile[]): Set<string> {
  const out = new Set<string>()
  for (const sf of sfs) for (const p of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (p.getNameNode().getText() !== 'component') continue
    for (const d of declarationsOf(p.getInitializer())) out.add(d.getSourceFile().getFilePath())
  }
  return out
}

/**
 * Compute scopes for every non-route component and descendant screens for route components.
 * `sfs` is every file the project holds, including a shared library a tsconfig alias brings in:
 * a library component the application renders is attributed to the screens that render it. When
 * `projectDir` is given, a component outside it is never ELECTED the application's shell (or an
 * indirect shell) -- an alias can also reach a sibling application whose root component holds a
 * `<router-outlet>`, and taking that for this application's shell attributed its navigations to
 * every screen at confidence 1. Being reached from this application's own shell is unaffected.
 * An outlet holder that a route names but the route walk dropped is mounted by a route nobody can
 * see, so it is an indirect shell and not a firm one. The call graph reads the files the
 * application loads, which `projectDir` fixes when it is given.
 */
export function attributeScopes(sfs: SourceFile[], routes: RouteInfo[], projectDir?: string, layers: ScopeLayers = 'full'): ScopeResult {
  const notes: SoundinessNote[] = []
  /** Whether `file` may be elected this application's shell: any file when `projectDir` is unset, otherwise only one inside it. */
  const mayBeShell = (file: string): boolean => !projectDir || isInsideDir(file, projectDir)
  // Test hosts and stories declare components too; they are not part of the application.
  const appFiles = sfs.filter((sf) => !/\.(spec|test|stories|cy|e2e)\.ts$/.test(sf.getFilePath()) && !/\/(testing|__tests__|e2e)\//.test(sf.getFilePath()))
  const components = collectComponents(appFiles)
  const firmNesting = new Map<string, Set<string>>()
  const nesting = nestingGraph(components, notes, firmNesting)

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
  // Component file -> the screens it renders on, descendants included.
  const routeComponentScreens = new Map<string, Set<string>>()
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
  // Outlet descent is already folded into routeComponentScreens, so a level that excludes
  // descent must descend from the route components' OWN screens instead; taking it out of
  // the returned map afterwards would leave it in every nested component's scope.
  const descentBase = layers === 'outlet' || layers === 'full' || layers === 'class' ? routeComponentScreens : ownScreens
  const screensOf = new Map<string, Set<string>>()
  const firmScreensOf = new Map<string, Set<string>>()
  for (const [graph, into] of [[nesting, screensOf], [firmNesting, firmScreensOf]] as const) {
    for (const [f, screens] of descentBase) {
      for (const c of reach(graph, f)) {
        if (c === f || routeComponentScreens.has(c)) continue
        const set = into.get(c) ?? new Set<string>()
        for (const s of screens) set.add(s)
        into.set(c, set)
      }
    }
  }

  // Shell: non-routed components that hold a <router-outlet> and are not rendered
  // inside any routed component; everything they reach (except routed components) is top.
  const shell = new Set<string>()
  const firmShell = new Set<string>()
  // An outlet holder that a route names but the route walk dropped is mounted by a route nobody
  // can see: rendered on that route's screens, not on every one, so it is no shell.
  const lostShell = new Set<string>()
  let named: Set<string> | undefined
  for (const c of components.values()) {
    if (!mayBeShell(c.file) || routeComponentScreens.has(c.file) || screensOf.has(c.file)) continue
    if (!c.template || !/<router-outlet(?![\w-])(?![^>]*\bname\s*=)/.test(c.template)) continue
    named ??= routeNamedComponents(appFiles)
    if (named.has(c.file)) {
      for (const x of reach(nesting, c.file)) if (!routeComponentScreens.has(x)) lostShell.add(x)
      continue
    }
    for (const x of reach(nesting, c.file)) if (!routeComponentScreens.has(x)) shell.add(x)
    for (const x of reach(firmNesting, c.file)) if (!routeComponentScreens.has(x)) firmShell.add(x)
  }
  for (const x of shell) lostShell.delete(x)
  // Indirect shells: components nobody references and no route renders, whose subtree
  // contains a component with the primary outlet.
  const referenced = new Set<string>()
  for (const kids of nesting.values()) for (const k of kids) referenced.add(k)
  const hasOutlet = (f: string): boolean => /<router-outlet(?![\w-])(?![^>]*\bname\s*=)/.test(components.get(f)?.template ?? '')
  const indirectShell = new Set<string>()
  for (const c of components.values()) {
    if (!mayBeShell(c.file) || referenced.has(c.file) || routeComponentScreens.has(c.file) || screensOf.has(c.file) || shell.has(c.file)) continue
    const r = reach(nesting, c.file)
    if (![...r].some((x) => x !== c.file && hasOutlet(x))) continue
    for (const x of r) if (!routeComponentScreens.has(x) && !shell.has(x)) indirectShell.add(x)
  }
  for (const x of lostShell) indirectShell.add(x)
  // A shell is top, which absorbs any screen set (join).
  for (const x of [...shell, ...indirectShell]) screensOf.delete(x)

  const subtreeOf = new Map<string, Set<string>>()
  for (const r of routes) subtreeOf.set(r.nodeId, subtree(r.nodeId))

  // Services: a class a component injects navigates on that component's behalf, so its scope
  // is the join over everything that injects it. Injection is read off constructor parameter
  // types and `inject(X)` calls, which is how an Angular component names its dependencies.
  const fileOfClass = new Map<string, string>()
  for (const sf of appFiles) {
    if (components.has(sf.getFilePath())) continue
    for (const cls of sf.getClasses()) {
      const name = cls.getName()
      if (name && !fileOfClass.has(name)) fileOfClass.set(name, sf.getFilePath())
    }
  }
  const serviceScreens = new Map<string, Set<string>>()
  const serviceShell = new Set<string>()
  for (const c of components.values()) {
    const callerScreens = shell.has(c.file) || indirectShell.has(c.file) ? null : (routeComponentScreens.get(c.file) ?? screensOf.get(c.file))
    if (callerScreens === undefined) continue
    for (const name of injectedClassNames(c.sf)) {
      const file = fileOfClass.get(name)
      if (!file) continue
      if (callerScreens === null) { serviceShell.add(file); continue }
      const set = serviceScreens.get(file) ?? new Set<string>()
      for (const s of callerScreens) set.add(s)
      serviceScreens.set(file, set)
    }
  }
  // A service injected by the shell is top, which absorbs any screen set (join).
  for (const f of serviceShell) serviceScreens.delete(f)

  // The call graph: every member of a component runs on the component's screens, and a member
  // runs wherever a member that calls it does. A component whose mounting route the walk lost is
  // not seeded at top: it renders on that route's screens, and top would put what it calls on all
  // of them. An effect is registered for the life of the application, so it is seeded at top.
  const seeds = new Map<string, Set<string> | null>()
  for (const c of components.values()) {
    if (lostShell.has(c.file)) continue
    const s = shell.has(c.file) || indirectShell.has(c.file) ? null : (routeComponentScreens.get(c.file) ?? screensOf.get(c.file))
    if (s !== undefined) seeds.set(c.file, s)
  }
  for (const sf of appFiles) if (mayBeShell(sf.getFilePath()) && !components.has(sf.getFilePath()) && isEffectFile(sf)) seeds.set(sf.getFilePath(), null)
  const members = layers === 'full'
    ? memberScopes(appFiles, seeds, projectDir ? loadedFiles(appFiles, projectDir) : undefined)
    : { screens: new Map<MemberKey, Set<string>>(), top: new Set<MemberKey>(), unseen: new Set<MemberKey>(), resolved: { direct: 0, bound: 0, subclass: 0, unresolved: 0 } }

  // The ablation withholds mechanisms rather than disabling them, so every level is a subset
  // of `full` by construction and no level can differ from it for any other reason.
  if (layers !== 'full' && layers !== 'class') {
    serviceScreens.clear()
    serviceShell.clear()
    if (layers === 'owned' || layers === 'nesting') {
      shell.clear()
      indirectShell.clear()
    }
    if (layers !== 'outlet') descendantsOfRouteComponent.clear()
    if (layers === 'owned') screensOf.clear()
  }


  return { screensOf, shell, indirectShell, descendantsOfRouteComponent, components, serviceScreens, serviceShell, notes, subtreeOf,
    standIns: layers === 'full' || layers === 'class', firmScreensOf, firmShell, memberScreens: members.screens, memberTop: members.top, memberUnseen: members.unseen, memberResolved: members.resolved }
}

/** Class names a component declares a dependency on: constructor parameter types and `inject(X)`. */
function injectedClassNames(sf: SourceFile): Set<string> {
  const out = new Set<string>()
  for (const cls of sf.getClasses()) {
    for (const ctor of cls.getConstructors()) {
      for (const p of ctor.getParameters()) {
        const t = p.getTypeNode()?.getText()
        if (t && /^[A-Z][\w$]*$/.test(t)) out.add(t)
      }
    }
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== 'inject') continue
    const arg = call.getArguments()[0]?.getText()
    if (arg && /^[A-Z][\w$]*$/.test(arg)) out.add(arg)
  }
  return out
}
