// Angular Router static extraction (milestone M3). Walks a ts-morph project,
// turns a `Routes` array (path/component/canActivate, incl. nested paths) into
// nodes, and turns each route component's inline `@Component` template
// (routerLink / [routerLink]) plus `Router.navigate` / `Router.navigateByUrl`
// calls into edges. Non-literal targets are over-approximated over the declared
// route set; canActivate guards (class refs, named functional guards, and inline
// arrow guards) become symbolic guard text via ./guards, with
// Observable/Promise-returning guards lowered in confidence + a soundiness note.
// No edge is emitted without a static witness.

import { Node, Project, ts } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { relative, join, dirname } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import type { ExtractOptions, ExtractResult, GraphEdge, GraphNode, SoundinessNote } from '@ui-graph/core'
import { edgeId, controlNodeId } from './ids'
import { keptSegments, matchAll, matchLiteral, matchPrefix, overlaps, redirectAddress, resolveRelativeTarget, urlPath, type RouteLike } from './matcher'
import { analyzeInputBindings } from './inputs'
import { isBareCall, templateCondition } from './conditions'
import { collectRoutes, type Redirect, type RouteLevel, type UnreadableRoutes } from './routes'
import { resolveImportedFile, isInsideDir } from './resolve'
import { attributeScopes, isEffectFile, subtreeAnchor, SHELL_NODE_ID } from './attribute'
import { templateTargets, routerCallTargets, methodNavTargets, templateLoc, linkAttrTarget, type RawTarget } from './nav'
import { parseControls } from './controls'
import { inlineTemplate } from './templates'
import { gateFromGuards, noteGuards } from './gates'
import type { GuardInfo } from './guards'

const ADAPTER_VERSION = '0.1.0'
const DEFAULT_RULESET = 'ng-v0-2026.06'

/** Build a ts-morph project from a project directory, scanning src first. */
export function buildProject(projectDir: string): Project {
  const ws = workspaceTsPaths(projectDir)
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      ...(ws ? { baseUrl: ws.baseUrl, paths: ws.paths } : {}),
    },
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    useInMemoryFileSystem: false,
  })
  project.addSourceFilesAtPaths([`${projectDir}/src/**/*.{ts,js}`, `!${projectDir}/**/node_modules/**`])
  if (project.getSourceFiles().length === 0) {
    project.addSourceFilesAtPaths([`${projectDir}/**/*.{ts,js}`, `!${projectDir}/**/node_modules/**`])
  }
  for (const dir of ws?.dirs ?? []) {
    project.addSourceFilesAtPaths([`${dir}/**/*.{ts,js}`, `!${dir}/**/node_modules/**`])
  }
  return project
}

/**
 * Remove `//` and block comments from tsconfig text while leaving string literals untouched.
 * A regex strip cannot tell a comment opener from the same characters inside a quoted string,
 * and a `paths` key such as `"@scope/pkg/*"` contains `/*`: the strip read it as a block
 * comment and swallowed everything up to the next `*` + `/`, the JSON stopped parsing, and the
 * workspace silently lost its baseUrl and every alias.
 */
function stripJsonComments(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '"') {
      let end = i + 1
      // A backslash escapes the next character, so an escaped quote does not end the string.
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      out += text.slice(i, end + 1)
      i = end
    } else if (c === '/' && text[i + 1] === '/') {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? text.length : close + 1
    } else {
      out += c
    }
  }
  return out
}

/**
 * The workspace's tsconfig `paths` aliases, with the directory they are resolved against.
 * In an Nx-style monorepo the app imports shared code — including, in some apps, the table
 * its route paths are declared in — through an alias such as `@scope/common/*`, and those
 * files live outside the app directory. Without the alias the checker cannot follow the
 * import, so every route that names a constant is dropped and the app extracts no screens.
 * `dirs` lists the directories to add to the project: an alias that names a file contributes
 * the directory holding it, because a lazy route behind `@scope/feature` lives in that
 * directory's other files, not in the one file the alias points at.
 */
function workspaceTsPaths(projectDir: string): { baseUrl: string; paths: Record<string, string[]>; dirs: string[] } | null {
  let dir = projectDir
  for (let up = 0; up < 5; up++) {
    for (const name of ['tsconfig.base.json', 'tsconfig.json']) {
      const file = join(dir, name)
      if (!existsSync(file)) continue
      let opts: { baseUrl?: string; paths?: Record<string, string[]> } | undefined
      try {
        // tsconfig is JSON with comments and trailing commas; a tolerant strip is enough here.
        const text = stripJsonComments(readFileSync(file, 'utf8')).replace(/,(\s*[}\]])/g, '$1')
        opts = (JSON.parse(text) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }).compilerOptions
      } catch {
        continue
      }
      const paths = opts?.paths
      if (!opts?.baseUrl && (!paths || Object.keys(paths).length === 0)) continue
      // TypeScript resolves `paths` targets against baseUrl, and baseUrl against the config's
      // own directory; a non-relative import such as `resource/cluster/module` is resolved
      // against baseUrl alone.
      const baseUrl = join(dir, opts?.baseUrl ?? '.')
      const dirs = new Set<string>()
      for (const targets of Object.values(paths ?? {})) {
        for (const t of targets) {
          const resolved = join(baseUrl, t.split('*')[0] ?? '')
          if (resolved.includes('node_modules') || !existsSync(resolved)) continue
          // A non-star alias names a file (`.../src/public-api.ts`), and the caller globs
          // `<dir>/**/*.ts`, which matches nothing under a file path; take its directory.
          const root = statSync(resolved).isDirectory() ? resolved : dirname(resolved)
          if (!projectDir.startsWith(root)) dirs.add(root)
        }
      }
      return { baseUrl, paths: paths ?? {}, dirs: [...dirs] }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Say what the route walk could not read, e.g. "2 declared path(s) and 1 lazy subtree(s) could
 * not be read", or null when it read everything. The losses are named apart because they are
 * different things: an unreadable path is one route missing, a lazy subtree is every route the
 * dropped `loadChildren` would have mounted, and a file that a lazy or spread site claims, that no
 * walk places under a prefix, and that the root scan would have minted routes from (a lazy
 * module's file beside its elected routing module, or one whose claiming site the walk never
 * reaches) holds routes that are neither walked nor rescanned, so it is unknown whether the
 * application mounts them. The phrase "could
 * not be read" is kept for all of them because a downstream census keys on it.
 */
function describeUnreadable(u: UnreadableRoutes): string | null {
  const parts: string[] = []
  if (u.paths.size > 0) parts.push(`${u.paths.size} declared path(s)`)
  if (u.subtrees.size > 0) parts.push(`${u.subtrees.size} lazy subtree(s)`)
  if (u.spreads.size > 0) parts.push(`${u.spreads.size} spread route source(s)`)
  if (u.calls.size > 0) parts.push(`${u.calls.size} route source(s) built by a call`)
  if (u.outlets.size > 0) parts.push(`${u.outlets.size} route(s) whose outlet`)
  if (u.unplaced.size > 0) parts.push(`${u.unplaced.size} claimed route file(s) placed under no prefix`)
  return parts.length === 0 ? null : `${parts.join(' and ')} could not be read`
}

/** Order of certainty among the modalities an edge can carry. */
const MODALITY_RANK: Record<GraphEdge['modality'], number> = { unknown: 0, may: 1, must: 2 }

/**
 * Extract a graph from an already-built ts-morph project (testable in memory). Route collection
 * stops at `projectDir`; scope attribution does not, because a shared library the application
 * renders lives outside it too and its navigations belong to the screens that render it. What
 * attribution refuses outside `projectDir` is only the election of a shell, so a sibling
 * application a tsconfig alias reaches cannot be taken for this one's root. That holds for every
 * way a shell is elected: a component with a `<router-outlet>`, a service the shell injects, and
 * an NgRx effect, which is registered for the whole application and so sits at the shell. An
 * effect outside `projectDir` is therefore not attributed to the shell. Whether this application
 * registers it is not read (a workspace library's effect is registered from inside the
 * application through `provideEffects([...])`), so it is reported as unattributed with a note
 * that says the tool could not place it, and never as a class nothing in the application injects.
 *
 * The catch-all an unmatched address goes to (`catchAllFor` below) is looked up by full path.
 * `joinRoutePath` folds `**`, `*` and `/*` into `*` only at the ROOT; inside a feature module the
 * same segment becomes `<parent>/*`, because it catches only the unmatched URLs under that
 * parent, which therefore go to it rather than to the root one. So the one route whose
 * full path is `*` is the application's own catch-all WHENEVER every table was walked under its
 * prefix. A feature table the walk could not reach, and that the root scan therefore read at
 * `/`, puts its own `**` here instead: that is the project-root reading Chapter 5 reports, and
 * it is why the catch-all census is caveated for an application whose route set is a lower
 * bound rather than trusted outright. A catch-all that only redirects is no screen and is absent from this list; it lives
 * in `redirects` instead, under the same full path.
 */
export function extractGraph(project: Project, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  const redirects = new Map<string, Redirect>()
  const unreadable: UnreadableRoutes = { paths: new Set(), subtrees: new Set(), unplaced: new Set(), spreads: new Set(), calls: new Set(), outlets: new Set() }
  const guarded: RouteLevel[] = []
  const roots = new Set<Node>()
  const routes = collectRoutes(project, redirects, unreadable, projectDir, guarded, roots)
  // A route on an outlet the reader could not fix may be on the primary one, so every guarded level counts as tried where its path matches.
  const auxLevels = guarded.filter((l) => l.aux !== undefined)
  const unreadableText = describeUnreadable(unreadable)
  const routeLikes: RouteLike[] = routes.map((r) => ({ fullPath: r.fullPath, nodeId: r.nodeId }))
  const levelsByNodeId = new Map(routes.map((r) => [r.nodeId, r.levels]))
  const pathByNodeId = new Map(routes.map((r) => [r.nodeId, r.fullPath]))
  /**
   * The guards Angular runs for a navigation from `from` to `to`, and whether it awaits a
   * resolver. The routes the two screens share, by route object, are reused unless their
   * parameters can change or runGuardsAndResolvers asks otherwise, and a reused route's
   * canActivate and resolvers do not run again. Under the default mode a matrix parameter changes
   * too, on any segment the route or one above it consumes, unless the navigation keeps that
   * segment: `preserved` is how many leading segments of the source's address it keeps. canMatch
   * runs on every route the address is matched through, and with canLoad on every route in
   * `tried`, the routes the router tries on the way whether or not it ends under them;
   * canActivate, canLoad and resolvers on every route the navigation enters; the canActivateChild
   * of every route above the one it enters; canDeactivate on every route it leaves. A route on a
   * named outlet is not on either chain. One the source could have open is matched again on every
   * navigation that keeps it, as a command does, so its canMatch is counted with its canDeactivate;
   * where it asks to run always, or sits under a route whose parameters the navigation may change,
   * its canActivate, the canActivateChild above it and its resolvers are counted too. One the
   * target opens by matching an empty path has all of its guards and resolvers counted. A source
   * that is not a screen of its own shares nothing, the safe side.
   */
  const runningGuards = (from: string | undefined, to: string, preserved = 0, tried: RouteLevel[] = []): { guards: GuardInfo[]; resolves: boolean } => {
    const t = levelsByNodeId.get(to) ?? []
    const s = from !== undefined ? levelsByNodeId.get(from) : undefined
    let k = 0
    let consumed = 0
    while (s && k < t.length && k < s.length) {
      const l = t[k]!
      consumed += l.consumes
      if (l.obj !== s[k]!.obj || l.params || l.always || (l.matrix && consumed > preserved)) break
      k += 1
    }
    const entered = t.slice(k)
    const offChain = [...new Map(tried.filter((l) => !t.some((x) => x.obj === l.obj)).map((l) => [l.obj, l])).values()]
    const fromPath = from !== undefined ? pathByNodeId.get(from) : undefined
    const toPath = pathByNodeId.get(to)
    const closing = fromPath === undefined ? [] : auxLevels.filter((l) => overlaps(fromPath, l.aux!, true))
    const rerun = closing.filter((l) => l.always || l.aux !== '/')
    const opening = toPath === undefined ? [] : auxLevels.filter((l) => l.path === l.aux && overlaps(toPath, l.aux, true))
    return {
      guards: [...t.flatMap((l) => l.canMatch), ...entered.flatMap((l) => [...l.canActivate, ...l.canLoad]),
        ...(entered.length > 0 ? t.slice(0, -1).flatMap((l) => l.canActivateChild) : []), ...(s ? s.slice(k).flatMap((l) => l.canDeactivate) : []),
        ...offChain.flatMap((l) => [...l.canMatch, ...l.canLoad]), ...closing.flatMap((l) => [...l.canDeactivate, ...l.canMatch]),
        ...rerun.flatMap((l) => l.canActivate), ...(rerun.length > 0 ? closing.flatMap((l) => l.canActivateChild) : []),
        ...opening.flatMap((l) => [...l.canMatch, ...l.canActivate, ...l.canActivateChild, ...l.canLoad])],
      resolves: entered.some((l) => l.resolve) || opening.some((l) => l.resolve) || rerun.some((l) => l.resolve),
    }
  }
  const redirectOfNode = new Map(routes.flatMap((r) => (r.redirectsTo !== undefined ? [[r.nodeId, r.redirectsTo] as const] : [])))
  const componentByNodeId = new Map(routes.map((r) => [r.nodeId, r.componentFile ? relative(projectDir, r.componentFile.getFilePath()) : null]))
  /**
   * Whether the router meets the branch of chain `a` before that of chain `b`: the two part at
   * sibling routes of one table and `a`'s is declared first, so it answers every address it
   * matches before `b`'s is tried. Anywhere else the order is not read, the safe side.
   */
  const before = (a: RouteLevel[], b: RouteLevel[]): boolean => {
    const k = a.findIndex((l, i) => l.obj !== b[i]?.obj)
    const x = a[k]?.obj
    const y = b[k]?.obj
    return x !== undefined && y !== undefined && x.getParent() === y.getParent() && Node.isArrayLiteralExpression(x.getParent()) && x.getStart() < y.getStart()
  }
  /**
   * Whether chains `a` and `b` start in two tables the root scan walked apart, which the
   * application registers apart. The router joins such tables in the order their `ROUTES`
   * providers are registered, an imported module's before the importer's own, and the walk does
   * not read that order, so a catch-all in one is ASSUMED to come after every route of the others:
   * the order Angular's guidance asks for, and the one the corpus keeps (bitwarden imports its
   * WildcardRoutingModule last, k8sdash its feature module before the module that calls forRoot).
   * A table spread into another is not one registered apart, and its order is not read either.
   * Each catch-all dismissed on this assumption is named in the application's `route-order` note.
   */
  const apart = (a: RouteLevel[], b: RouteLevel[]): boolean => {
    const x = a[0]?.obj.getParent()
    const y = b[0]?.obj.getParent()
    return x !== undefined && y !== undefined && x !== y && roots.has(x) && roots.has(y)
  }
  // The catch-alls dismissed only on the assumption `apart` states, by full path, for the application's note.
  const assumedOrder = new Map<string, RouteLevel[]>()
  /**
   * Whether the router meets chain `first` before the route at full path `at` with chain `levels`.
   * A catch-all dismissed only on the assumption `apart` states is recorded in `assumedOrder`, so
   * the application's soundiness notes say that its edges rest on that assumption.
   */
  const metFirst = (first: RouteLevel[] | undefined, at: string, levels: RouteLevel[]): boolean => {
    if (first === undefined) return false
    if (before(first, levels)) return true
    if (!at.endsWith('*') || !apart(first, levels)) return false
    assumedOrder.set(at, levels)
    return true
  }
  /**
   * The redirects the router could meet at an address before chain `first`, the screen or redirect
   * that answers it: one declared at it, at a parameter pattern that matches it, or with
   * `pathMatch: 'prefix'` at a shorter one, a catch-all among them, since Angular tries `**` in
   * declaration order like any route. With `every` the address is a screen's own pattern and only a
   * redirect that answers every address it stands for counts.
   */
  const redirectsAt = (path: string, first: RouteLevel[] | undefined, every = false): [string, Redirect][] =>
    [...redirects].filter(([at, r]) => overlaps(path, at, r.prefix, every) && !metFirst(first, at, r.levels))
  const catchAllScreens = routes.filter((r) => r.fullPath.endsWith('*'))
  /** The catch-all screens the router could meet at an address before chain `first`, on the terms of `redirectsAt`. */
  const catchAllsAt = (path: string, first: RouteLevel[] | undefined, every = false) =>
    catchAllScreens.filter((c) => c.levels !== first && overlaps(path, c.fullPath, true, every) && !metFirst(first, c.fullPath, c.levels))
  /**
   * The catch-all that answers an address no screen and no other redirect answers: the deepest `**`
   * whose parent path matches it, since the router enters that parent before it reaches a catch-all
   * above it, and at one depth a redirect before a screen. A guard on that parent, or a catch-all
   * declared before it, can make the router meet another, which is not read; the edge drawn to it
   * is held at may.
   */
  const catchAllFor = (path: string): { at: string; redirect?: Redirect; screen?: RouteLike } | undefined =>
    [...[...redirects].filter(([at]) => at.endsWith('*')).map(([at, redirect]) => ({ at, redirect })), ...catchAllScreens.map((screen) => ({ at: screen.fullPath, screen }))]
      .filter((c) => overlaps(path, c.at, true))
      .sort((x, y) => y.at.split('/').length - x.at.split('/').length)[0]
  /**
   * Whether chain `a` stays in the table that holds the last route of chain `l`, the one the router
   * matches an address in again after that route's relative redirect, with redirects off at that
   * level (@angular/router 18.2.14 router.mjs:3922-3925, :3896-3899): it shares every route above
   * that one, whose children, or the joined root tables, are that table. With `deeper` it must go
   * on below a route of that table, because a redirect in the table itself is skipped there, while
   * one in a child table is applied (:3967).
   */
  const within = (l: RouteLevel[], a: RouteLevel[], deeper: boolean): boolean => {
    const d = l.length - 1
    return d >= 0 && a.length > d + (deeper ? 1 : 0) && a.slice(0, d).every((x, i) => x.obj === l[i]!.obj)
  }
  /**
   * Where a navigation to `value` lands once every redirect on the way is followed: a redirect
   * route at that address, or, where no screen and no redirect is declared at it, the one redirect
   * at a pattern or shorter prefix that answers it, its parameters filled in, or an empty-path child
   * that redirects the screen matched there. The walk stops at a fixed point or after ten hops.
   * `ambiguous` says that more than one declared route, or a route and a redirect or catch-all,
   * could answer an address on the way, so which one Angular meets first decides it, and so does a
   * redirect the reader cannot follow. `unread` says the walk stopped with no screen at such a
   * redirect, at one Angular rejects because it names a parameter its own route does not bind, or
   * after a relative redirect at an address that its own table does not answer but by a redirect
   * there, which Angular skips: the address is declared, but where it lands is not read. A redirect
   * met after an absolute one makes the landing ambiguous: Angular 18 matches the new address from
   * the root with redirects on (router.mjs:3579, :3797-3799), but before 18 the router applied no
   * redirect after an absolute one, and which version the application runs is not read. `redirected` says a redirect rewrote the address, and `tried` holds the guarded routes
   * whose path matches some address on the way, which the router may try there. A command is
   * matched as written; a redirect's target is a URL.
   */
  function land(value: string, command: boolean): { target: RouteLike | null; ambiguous: boolean; redirected: boolean; tried: RouteLevel[]; unread: boolean } {
    let current = value
    let asUrl = !command
    let ambiguous = false
    let prev: Redirect | undefined
    const tried: RouteLevel[] = []
    for (let hop = 0; hop < 10; hop += 1) {
      const path = asUrl ? current.split(/[?#]/)[0] ?? current : current
      const target = matchLiteral(path, routeLikes, asUrl)
      const own = target ? redirectOfNode.get(target.nodeId) : undefined
      const exact = redirects.get(path)
      const patterned = target || exact ? [] : redirectsAt(path, undefined).filter(([at]) => !at.endsWith('*'))
      const [at, redirect] = target ? [target.fullPath, own] : exact ? [path, exact] : patterned.length === 1 ? patterned[0]! : [path, undefined]
      const first = target ? levelsByNodeId.get(target.nodeId) : redirect?.levels
      // An empty-path child's redirect is registered at its parent's address as well; it is the
      // same redirect as the screen's own, not a rival to it. Any other redirect there is.
      const rivals = redirectsAt(path, first).filter(([a, r]) => !(target && a === target.fullPath && r.to === own?.to))
      tried.push(...guarded.filter((l) => overlaps(path, l.path, true)))
      if (matchAll(path, routeLikes).length + rivals.length + catchAllsAt(path, first).length > 1) ambiguous = true
      if (prev?.relative && !(first && within(prev.levels, first, !target))) return { target: null, ambiguous: true, redirected: true, tried, unread: true }
      if (prev && !prev.relative && redirect) ambiguous = true
      const next = redirect ? redirect.to && redirectAddress(path, at, redirect.to, redirect.own, redirect.relative) : target || patterned.length < 2 ? undefined : null
      if (next === undefined) return { target, ambiguous, redirected: hop > 0, tried, unread: false }
      // An unread target still hides the screen it redirects; a redirect Angular rejects lands nowhere.
      const kept = redirect?.to === null ? target : null
      if (next === null) return { target: kept, ambiguous: true, redirected: hop > 0, tried, unread: kept === null }
      prev = redirect
      current = next
      asUrl = true
    }
    return { target: null, ambiguous: true, redirected: true, tried, unread: false }
  }
  const routeByNodeId = new Map(routes.map((r) => [r.nodeId, r]))
  /** Whether screen `c` is declared below screen `id`, so Angular renders it inside that screen. */
  const below = (c: (typeof routes)[number], id: string): boolean => {
    for (let p = c.parentNodeId; p !== null; p = routeByNodeId.get(p)?.parentNodeId ?? null) if (p === id) return true
    return false
  }
  /**
   * Whether a screen is never displayed at its own address: an empty-path child of it redirects,
   * or a redirect or catch-all the router may meet first answers every address the screen does. A
   * catch-all screen below the screen does not hide it, since it renders inside it; a redirect
   * below it does, since it replaces it.
   */
  const hidden = (id: string): boolean => {
    const path = pathByNodeId.get(id)
    const first = levelsByNodeId.get(id)
    return redirectOfNode.has(id) || (path !== undefined && redirectsAt(path, first, true).length + catchAllsAt(path, first, true).filter((c) => !below(c, id)).length > 0)
  }
  /**
   * Whether a route component renders only on some executions of the screens above it: the
   * primary outlet of a route component or layout above it sits under a template condition, so
   * the route component is not on the screen however its own template reads.
   */
  const behindHiddenOutlet = (route: (typeof routes)[number]): boolean => {
    const holders = [...route.layouts]
    for (let p = route.parentNodeId ? routeByNodeId.get(route.parentNodeId) : undefined; p; p = p.parentNodeId ? routeByNodeId.get(p.parentNodeId) : undefined) if (p.componentFile) holders.push(p.componentFile)
    return holders.some((sf) => {
      const tpl = inlineTemplate(sf)
      const at = tpl ? tpl.text.search(/<router-outlet(?![\w-])(?![^>]*\bname\s*=)/) : -1
      return tpl !== null && at >= 0 && templateCondition(tpl.text, at + 1) !== null
    })
  }
  // The screens a scope anchor stands for, filled as anchors are minted, and every screen, which the shell stands for.
  const screenIds = new Set(routes.map((r) => r.nodeId))
  const anchorMembers = new Map<string, Set<string>>()

  // A screen is a ROUTE, not a component: one component serving several routes
  // (/login and /register on one AuthComponent) is several states. Label those
  // route-first so the duplicate component name does not read as a duplicate node.
  const routesPerComponent = new Map<string, number>()
  for (const r of routes) if (r.componentName !== null) routesPerComponent.set(r.componentName, (routesPerComponent.get(r.componentName) ?? 0) + 1)
  const nodes: GraphNode[] = routes.map((r) => ({
    id: r.nodeId,
    route: r.fullPath,
    componentPath: r.componentFile ? relative(projectDir, r.componentFile.getFilePath()) : null,
    label: r.componentName === null ? r.fullPath : (routesPerComponent.get(r.componentName) ?? 0) > 1 ? `${r.fullPath} · ${r.componentName}` : r.componentName,
    kind: 'screen',
  }))

  const edges: GraphEdge[] = []
  const soundiness: SoundinessNote[] = []
  // One note per application when the declared route set is incomplete. Any claim of the
  // form "the application declares no route at this path" is void while this note is
  // present, so a consumer can gate on it without parsing another note's prose.
  if (unreadableText) soundiness.push({ kind: 'incomplete-route-set', detail: `${unreadableText}, so the declared route set is a lower bound and no claim that a path is undeclared holds` })
  const edgeById = new Map<string, GraphEdge>()
  const seenAsyncGuards = new Set<string>()

  function pushEdge(from: string, to: string, t: RawTarget, modality: GraphEdge['modality'], confidence: number, guard: string | null, file: string): void {
    const id = edgeId(from, to, t.event, guard)
    const w = { source: 'static' as const, file: t.file ?? file, loc: t.loc, ruleId: t.ruleId, modality }
    const e = edgeById.get(id)
    if (!e) {
      edges.push({ id, from, to, event: t.event, guard, effect: t.effect, modality, source: 'static', confidence, witness: w })
      edgeById.set(id, edges[edges.length - 1]!)
      return
    }
    // Record the extra construct instead of dropping it, so every construct that yields an
    // edge stays traceable.
    // Two links on one line are two constructs; only the same construct reached again is one.
    const same = (m: { file?: string; loc?: { line: number; col: number } } | undefined) => m?.file === w.file && m?.loc?.line === w.loc.line && m?.loc?.col === w.loc.col
    if (same(e.witness) || e.mergedWitnesses?.some(same)) return
    // An edge is as certain as the most certain construct that produces it: one construct that
    // reaches the destination on every execution of its code makes the transition certain,
    // whatever else may also reach it. That construct becomes the edge's witness, and every
    // other construct is listed with the modality it earns on its own, so a construct that
    // reaches the destination only through the catch-all, or only under a condition, is never
    // cited as evidence of certainty.
    if (MODALITY_RANK[modality] > MODALITY_RANK[e.modality] || (modality === e.modality && confidence > e.confidence)) {
      if (e.witness) (e.mergedWitnesses ??= []).push(e.witness)
      e.witness = w
      e.modality = modality
      e.confidence = confidence
    } else {
      ;(e.mergedWitnesses ??= []).push(w)
    }
  }

  /**
   * Emit the edges for one set of navigation targets fired from `from`. `note` records the
   * soundiness note for a site once, so an attributed site that fires from many screens does
   * not report the same approximation once per screen. `capMay` holds the edges at may for a
   * scope the pass is not certain of. A literal no route declares is routed to the catch-all that
   * answers it (`catchAllFor`: a `**` redirect target or a `**` screen, the root's or one under a
   * parent the literal is below) at may, never must. Every note cites
   * the target's own file when it has one: a link parsed out of an external template carries
   * the `.html` path and a line within it, and pairing that line with the component's `.ts` path
   * pointed published dead-link citations at a `.ts` line that holds no link.
   */
  function emitTargets(from: string, targets: RawTarget[], file: string, note: boolean, capMay = false): void {
    for (const t of targets) {
      if (t.ti.kind === 'literal') {
        // Angular resolves a commands array against the current route only when the link is
        // a template one or the call passes `relativeTo`; without that the base is the root.
        // Either way a leading `.` or `..` is resolved — leaving it raw matches nothing.
        const base = t.relative ? pathByNodeId.get(from) : '/'
        // A URL is parsed as navigateByUrl parses it; a command keeps every character but the slash.
        const parsed = t.url ? urlPath(t.ti.value) : { path: t.ti.value, aux: false }
        if (parsed === null) continue
        const value = resolveRelativeTarget(parsed.path, base)
        // A relative target resolves against the route of the component that holds the site, and
        // the emitting node's path is that route only when the node is the component's own route.
        const baseUnknown = !parsed.path.startsWith('/') && (t.baseUnknown === true || (t.relative === true && componentByNodeId.get(from) !== file))
        const landed = land(value, t.url !== true)
        // An address a redirect answers is declared wherever the redirect sends it, so it is not the catch-all's.
        if (!landed.target && landed.unread) {
          if (note) soundiness.push({ kind: 'dynamic-target', file: t.file ?? file, loc: t.loc, detail: `literal target "${value}" is answered by a redirect the reader does not follow, so where it lands is not read` })
          continue
        }
        let target = landed.target
        // A target no route declares is not nowhere: a `**` route catches it. Either it sends
        // it on (`redirectTo`) or it answers it itself with a catch-all screen (`component`,
        // mifos's and alfresco's NotFound page). The destination is real, but the author almost
        // certainly did not mean to go there, so the edge is held at may and the note says what
        // happened. Following only the redirect flavour left every unmatched literal in an
        // application with a component catch-all reported as reaching nothing.
        let viaWildcard = false
        // The wildcard edge is where Angular actually goes, so it is drawn whatever the state
        // of the route set; what the route set changes is the CLAIM. A gate on the unreadable
        // count was wrong twice over: one unreadable path in an unrelated module withheld a
        // sound edge across the whole application, and it never fired for an application whose
        // route set is complete, which is where the claim mattered most. The note carries both
        // facts instead, once per site.
        if (!target) {
          const wild = catchAllFor(value)
          const wildcardRedirect = wild?.redirect?.to
          const sent = wild?.redirect && wildcardRedirect ? redirectAddress(value, wild.at, wildcardRedirect, wild.redirect.own, wild.redirect.relative) : null
          target = !wild ? null : wild.screen ?? (sent === null ? null : matchLiteral(sent, routeLikes))
          viaWildcard = target !== null
          if (viaWildcard && note) {
            const caveat = unreadableText ? `, though ${unreadableText}, so it is not claimed that no such route exists` : ''
            // The note records the SITE, and it is recorded whether or not a distinct edge
            // results: `pushEdge` dedupes on (from, to, event, guard), so a catch-all that
            // lands on a screen the same template already links to merges into that edge and
            // contributes only a witness. The site is still a link to an address the
            // application does not declare, which is what the note is for and what the
            // dead-link census counts -- it counts sites, never edges.
            // The target must stay the first double-quoted string: a generator reads it from here.
            const answer = typeof wildcardRedirect === 'string' ? `redirects it to ${wildcardRedirect}` : 'answers it with its own catch-all screen'
            const assumed = baseUnknown ? ', resolved against a base the reader could not fix' : ''
            const where = wild!.at === '*' ? '' : ` at ${wild!.at}`
            soundiness.push({ kind: 'wildcard-redirect', file: t.file ?? file, loc: t.loc, detail: `literal target "${value}" matches no declared route${assumed} and the wildcard route${where} ${answer}${caveat}` })
          }
        }
        if (!target) {
          if (note) soundiness.push({ kind: 'unresolved-target', file: t.file ?? file, loc: t.loc, detail: `literal target "${value}" matches no declared route${baseUnknown ? ', resolved against a base the reader could not fix' : ''}` })
          continue
        }
        const conservative = gateFromGuards(runningGuards(undefined, target.nodeId, 0, landed.tried).guards)
        // A command resolved against the source's own route keeps the segments it does not climb
        // out of, matrix parameters and all; an absolute one, a URL, and an address a redirect
        // rewrote keep none.
        const preserved = t.relative === true && !baseUnknown && !landed.redirected ? keptSegments(parsed.path, base) : 0
        noteGuards(conservative, pathByNodeId.get(target.nodeId) ?? target.nodeId, soundiness, seenAsyncGuards)
        // The shell and a scope anchor stand for many screens, the destination possibly among them.
        const members = from === SHELL_NODE_ID ? screenIds : anchorMembers.get(from)
        // A URL naming an auxiliary outlet fails whole when that outlet's route does not match,
        // which is not read; an address several declared routes or a redirect can answer goes to
        // whichever Angular meets first, which the matcher does not decide.
        const common = capMay || viaWildcard || baseUnknown || parsed.aux || landed.ambiguous || t.conditional === true || (t.ti.kind === 'literal' && t.ti.holes === true)
        /**
         * The edge as drawn from one screen. A guard that runs on this navigation, or a resolver it
         * awaits, holds it at may; so does a navigation to the address the screen already displays,
         * which the router ignores or follows only when a parameter or the query differs, and a
         * screen that is never displayed at its own address because a redirect answers it.
         */
        const verdict = (src: string | undefined) => {
          const run = runningGuards(src, target.nodeId, preserved, landed.tried)
          const gate = gateFromGuards(run.guards)
          // A measurement switch, not a product option: the thesis counts what would be must if
          // every guard that runs let the navigation through. The guard text stays on the edge.
          const gated = gate.guarded && process.env.UIGRAPH_IGNORE_GUARDS !== '1'
          const may = common || gated || run.resolves || src === target.nodeId || (src !== undefined && hidden(src))
          return { modality: may ? 'may' as const : 'must' as const, confidence: gate.guarded ? gate.confidence : may ? 0.5 : 1, guardText: gate.guarded ? gate.guardTexts.join(',') : null }
        }
        if (members && !common) {
          // Each screen the edge stands for gets its own verdict; the edge stays one anchored edge
          // only when they all agree and the destination is not among them.
          const each = [...members].sort().map((m) => ({ m, v: verdict(m) }))
          const first = each[0]?.v
          if (first && !members.has(target.nodeId) && each.every(({ v }) => v.modality === first.modality && v.guardText === first.guardText)) {
            pushEdge(from, target.nodeId, t, first.modality, first.confidence, first.guardText, file)
          } else {
            for (const { m, v } of each) pushEdge(m, target.nodeId, t, v.modality, v.confidence, v.guardText, file)
          }
          continue
        }
        if (members) {
          // Held at may for a reason every screen shares, so one anchored edge says it for all of them.
          pushEdge(from, target.nodeId, t, 'may', conservative.guarded ? conservative.confidence : 0.5, conservative.guarded ? conservative.guardTexts.join(',') : null, file)
          continue
        }
        const v = verdict(levelsByNodeId.has(from) ? from : undefined)
        pushEdge(from, target.nodeId, t, v.modality, v.confidence, v.guardText, file)
      } else if (t.ti.kind === 'template') {
        const prefix = resolveRelativeTarget(t.ti.staticPrefix, t.relative ? pathByNodeId.get(from) : '/')
        const cands = matchPrefix(prefix, routeLikes)
        if (note) soundiness.push({ kind: 'over-approximation', file: t.file ?? file, loc: t.loc, detail: `non-literal target prefix "${prefix}" over-approximated to ${cands.length} route(s)` })
        for (const cand of cands) {
          const gate = gateFromGuards(runningGuards(undefined, cand.nodeId).guards)
          noteGuards(gate, pathByNodeId.get(cand.nodeId) ?? cand.nodeId, soundiness, seenAsyncGuards)
          const guardText = gate.guarded ? gate.guardTexts.join(',') : null
          pushEdge(from, cand.nodeId, t, 'may', gate.guarded ? Math.min(gate.confidence, 0.5) : 0.5, guardText, file)
        }
      } else if (t.ti.kind === 'same-screen' || t.ti.kind === 'aux-outlet') {
        // `navigate([], { queryParams })` changes the query on the route it is already on, so
        // there is no transition to draw and nothing is lost by not drawing one. No note
        // either: declaring a loss where there is none is the error the other direction.
        continue
      } else {
        // A target only the run time knows — a value from the backend, a history entry — still
        // leaves a screen by an event. Record it as an edge into that screen's unknown sink
        // rather than dropping it: the transition is then accounted for and auditable, the
        // graph does not claim a destination it cannot know, and `verify` has somewhere to
        // start. Core counts a `u_<screen>` sink as frontier, never as a resolved transition.
        pushEdge(from, unknownSink(from), t, 'unknown', 0, null, file)
        if (note) soundiness.push({ kind: 'dynamic-target', file: t.file ?? file, loc: t.loc, detail: `fully dynamic navigation target (event ${t.event})` })
      }
    }
  }

  /** The `u_<screen>` sink that holds the targets only the run time knows, minted on demand. */
  const sinks = new Set<string>()
  function unknownSink(from: string): string {
    const id = `u_${from}`
    if (!sinks.has(id)) {
      sinks.add(id)
      nodes.push({ id, route: null, componentPath: null, label: `dynamic target from ${pathByNodeId.get(from) ?? from}`, kind: 'unknown' })
    }
    return id
  }

  for (const route of routes) {
    if (!route.componentFile) {
      soundiness.push({ kind: 'unresolved-component', detail: `route ${route.fullPath} has no resolvable component file` })
      continue
    }
    const file = relative(projectDir, route.componentFile.getFilePath())
    // In controls mode every template routerLink is anchored to the link control that
    // fires it (below), so the screen-level copy would be an undrivable duplicate.
    const targets = [...(opts.controls ? [] : templateTargets(route.componentFile, projectDir)), ...routerCallTargets(route.componentFile)]
    emitTargets(route.nodeId, behindHiddenOutlet(route) ? targets.map((t) => ({ ...t, conditional: true })) : targets, file, true)
  }

  if (opts.attribution) {
    // A measurement switch, not a product option: the thesis ablates the attribution into
    // its mechanisms and needs each one extracted on the same corpus. Unset, or set to
    // anything else, means the full analysis, which is the only configuration shipped.
    const layers = process.env.UIGRAPH_SCOPE_LAYERS
    const scopes = attributeScopes(project.getSourceFiles(), routes, projectDir,
      layers === 'owned' || layers === 'nesting' || layers === 'rooted' || layers === 'outlet' || layers === 'class' ? layers : 'full')
    soundiness.push(...scopes.notes)
    const targetsOf = (sf: SourceFile): RawTarget[] => [...templateTargets(sf, projectDir), ...routerCallTargets(sf)]
    // Anchors: a set of screens that is exactly subtree(r) gets one scope node, and the
    // edge is stored once there instead of once per screen (expanded on query).
    const anchors = new Map<string, string>()
    const anchorNode = (root: string): string => {
      let id = anchors.get(root)
      if (!id) {
        id = `n_scope_subtree__${root}`
        anchors.set(root, id)
        const members = [root, ...[...scopes.subtreeOf.get(root)!].filter((m) => m !== root).sort()]
        anchorMembers.set(id, new Set(members))
        nodes.push({ id, route: null, componentPath: null, label: `subtree of ${pathByNodeId.get(root) ?? root}`, kind: 'scope', scope: { kind: 'subtree', root, members } })
      }
      return id
    }
    const emitOver = (screens: Set<string>, ts: RawTarget[], file: string): void => {
      const root = subtreeAnchor(screens, scopes.subtreeOf)
      if (root) {
        emitTargets(anchorNode(root), ts, file, false)
        return
      }
      for (const s of [...screens].sort()) emitTargets(s, ts, file, false)
    }
    // A route component's template is also rendered on every descendant screen (its outlet):
    // its scope is subtree(r).
    for (const [f, extra] of scopes.descendantsOfRouteComponent) {
      const sf = project.getSourceFile(f)
      if (!sf) continue
      const own = routes.filter((r) => r.componentFile?.getFilePath() === f).map((r) => r.nodeId)
      emitOver(new Set([...own, ...extra]), targetsOf(sf), relative(projectDir, f))
    }
    // Components rendered inside screens: anchored at a subtree when their screen set is one,
    // otherwise one edge per screen that renders them.
    // On a screen where the component is mounted only under a template condition, every site
    // in it runs only on some executions, however unconditional it is in its own template.
    for (const [f, screens] of scopes.screensOf) {
      const c = scopes.components.get(f)
      if (!c) continue
      const ts = targetsOf(c.sf)
      if (ts.length === 0) continue
      const firm = scopes.firmScreensOf.get(f) ?? new Set<string>()
      const sure = new Set([...screens].filter((x) => firm.has(x)))
      const unsure = new Set([...screens].filter((x) => !firm.has(x)))
      if (sure.size > 0) emitOver(sure, ts, relative(projectDir, f))
      if (unsure.size > 0) emitOver(unsure, ts.map((t) => ({ ...t, conditional: true })), relative(projectDir, f))
    }
    // The application shell: anchored once at a scope node, expanded on query.
    let shellEdges = 0
    for (const f of [...scopes.shell].sort()) {
      const c = scopes.components.get(f)
      if (!c) continue
      const before = edges.length
      const ts = targetsOf(c.sf)
      emitTargets(SHELL_NODE_ID, scopes.firmShell.has(f) ? ts : ts.map((t) => ({ ...t, conditional: true })), relative(projectDir, f), true)
      shellEdges += edges.length - before
    }
    for (const f of [...scopes.indirectShell].sort()) {
      const c = scopes.components.get(f)
      if (!c) continue
      const before = edges.length
      emitTargets(SHELL_NODE_ID, targetsOf(c.sf), relative(projectDir, f), true, true)
      shellEdges += edges.length - before
    }
    if (scopes.indirectShell.size) soundiness.push({ kind: 'indirect-shell', detail: `${scopes.indirectShell.size} component(s) treated as shell without a visible mounting route; their edges are capped at may` })
    // A guard runs on exactly the routes that name it, so its scope is those screens — more
    // precise than the join over injectors, and the route config states it outright.
    const guardScreens = new Map<string, Set<string>>()
    for (const r of routes) {
      for (const name of ['canActivate', 'canActivateChild', 'canMatch', 'canDeactivate']) {
        const prop = r.routeObj.getProperty(name)
        if (!prop || !Node.isPropertyAssignment(prop)) continue
        const init = prop.getInitializer()
        if (!init || !Node.isArrayLiteralExpression(init)) continue
        for (const el of init.getElements()) {
          if (!Node.isIdentifier(el)) continue
          const gf = resolveImportedFile(r.routeObj.getSourceFile(), el.getText())
          if (!gf) continue
          const set = guardScreens.get(gf.getFilePath()) ?? new Set<string>()
          set.add(r.nodeId)
          guardScreens.set(gf.getFilePath(), set)
        }
      }
    }

    // Navigation in a class that is not a component (a service, facade or store) fires on
    // behalf of whatever calls the member that holds it, so its scope is the join over the
    // screens of those callers, which the call graph gives. Where the call graph reaches no
    // caller, the join is taken over every component that injects the class, which can be wider
    // than the real scope. A member a caller the graph cannot see also reaches (a constructor the
    // injector runs, a guard, an interceptor) runs where that caller does, too, and the caller is
    // placed the way an unreached member is: by the join of its own file, which adds nothing for
    // a caller nothing injects and no route names. The calls on the way carry conditions the
    // analysis does not follow, so the edges are capped at may. A class nothing reaches has no
    // scope at all and is reported.
    for (const sf of project.getSourceFiles()) {
      const f = sf.getFilePath()
      if (scopes.components.has(f) || /\.(spec|test|stories)\.ts$/.test(f)) continue
      const ts = routerCallTargets(sf)
      if (ts.length === 0) continue
      const file = relative(projectDir, f)
      // An NgRx effect is registered with the store for the lifetime of the application, so it
      // can fire on any screen: its scope is top, the same place the shell sits.
      const isEffect = isEffectFile(sf)
      if (scopes.standIns && isEffect && isInsideDir(f, projectDir)) {
        const before = edges.length
        emitTargets(SHELL_NODE_ID, ts, file, true, true)
        shellEdges += edges.length - before
        continue
      }
      // The call graph places what it reaches, member by member; the rest falls to the join below.
      // A member some caller the graph cannot see also reaches runs wherever that caller's join says, too.
      // The note of a site is recorded on the first screen it is emitted from, once however many follow.
      const keyOf = (t: RawTarget) => `${f}#${t.member}`
      /** The screens the class join of file `g` gives: the components that inject its classes, and the routes that name it as a guard. */
      const joinOf = (g: string) => [...(scopes.serviceScreens.get(g) ?? []), ...(scopes.standIns ? guardScreens.get(g) ?? [] : [])]
      const joinTop = scopes.serviceShell.has(f)
      const joinScreens = new Set(joinOf(f))
      /** The files of the callers the graph cannot see that reach the member holding `t`. */
      const unseenFrom = (t: RawTarget) => [...(scopes.memberUnseen.get(keyOf(t)) ?? [])]
      /** Whether the call graph gives the member holding `t` at least one screen. */
      const placedAt = (t: RawTarget) => (scopes.memberScreens.get(keyOf(t))?.size ?? 0) > 0
      const atTop = ts.filter((t) => t.member !== undefined && (scopes.memberTop.has(keyOf(t)) || (placedAt(t) && unseenFrom(t).some((g) => scopes.serviceShell.has(g)))))
      const byMember = ts.filter((t) => t.member !== undefined && !atTop.includes(t) && placedAt(t))
      if (atTop.length > 0) {
        const before = edges.length
        emitTargets(SHELL_NODE_ID, atTop, file, true, true)
        shellEdges += edges.length - before
      }
      for (const t of byMember) {
        const own = scopes.memberScreens.get(keyOf(t))!
        const screens = new Set([...own, ...unseenFrom(t).flatMap(joinOf)])
        for (const [i, s] of [...screens].sort().entries()) emitTargets(s, [t], file, i === 0, true)
      }
      const rest = ts.filter((t) => !atTop.includes(t) && !byMember.includes(t))
      if (rest.length === 0) continue
      if (joinTop) {
        const before = edges.length
        emitTargets(SHELL_NODE_ID, rest, file, true, true)
        shellEdges += edges.length - before
        continue
      }
      const screens = joinScreens
      if (screens.size === 0) {
        // An effect that reaches here is unplaced, not known to be unused.
        const where = !isEffect ? 'a class nothing in the application injects; its scope is empty'
          : isInsideDir(f, projectDir) ? 'an NgRx effect; the shell stand-in for dispatch applies only at the full attribution level, so its scope could not be placed'
          : 'an NgRx effect outside the application directory; whether the application registers it is not read, so its scope could not be placed'
        soundiness.push({ kind: 'unattributed-non-component', file, detail: `${rest.length} navigation call(s) in ${where}` })
        continue
      }
      for (const [i, s] of [...screens].sort().entries()) emitTargets(s, rest, file, i === 0, true)
    }
    if (shellEdges > 0 && edges.some((e) => e.from === SHELL_NODE_ID)) nodes.push({ id: SHELL_NODE_ID, route: null, componentPath: null, label: 'application shell (every screen)', kind: 'scope', scope: { kind: 'top' } })

    // An edge needs both ends. The `u_<screen>` sink supplies a destination the run time owns;
    // this supplies a SOURCE the analysis could not place. A component that no route renders
    // and that nothing reaches from a routed component has no screen set, so until now its
    // navigation left no trace at all — even when its destination was perfectly readable.
    // Anchoring it at an unplaced origin keeps the destination, says plainly that the source
    // is unknown, and holds the edges at may.
    const placed = new Set<string>([...scopes.screensOf.keys(), ...scopes.shell, ...scopes.indirectShell, ...routes.flatMap((r) => [...(r.componentFile ? [r.componentFile] : []), ...r.layouts].map((sf) => sf.getFilePath()))])
    for (const [f, c] of scopes.components) {
      if (placed.has(f)) continue
      const ts = targetsOf(c.sf)
      if (ts.length === 0) continue
      const file = relative(projectDir, f)
      const id = `o_${c.className ?? file.replace(/[^\w]/g, '_')}`
      if (!nodes.some((n) => n.id === id)) {
        nodes.push({ id, route: null, componentPath: file, label: `unplaced origin: ${c.className ?? file}`, kind: 'unknown' })
      }
      emitTargets(id, ts, file, true, true)
    }
  }

  if (opts.controls) {
    for (const route of routes) {
      if (!route.componentFile) continue
      const sf = route.componentFile
      const file = relative(projectDir, sf.getFilePath())
      const controls = parseControls(sf)

      // Assign nth per identical selector so each control's id is stable AND unique.
      const nthBySig = new Map<string, number>()
      for (const c of controls) {
        const sig = `${c.selector.strategy}|${c.selector.value}`
        const nth = nthBySig.get(sig) ?? 0
        nthBySig.set(sig, nth + 1)
        if (nth > 0) c.selector.nth = nth
      }

      const tpl = inlineTemplate(sf)
      const tplFile = tpl?.externalFile !== undefined ? relative(projectDir, tpl.externalFile) : undefined
      for (const c of controls) {
        const cId = controlNodeId(route.nodeId, c.selector)
        const loc = tpl ? templateLoc(sf, tpl, c.index) : { line: 1, col: 1 }
        // The offset past `<` so the scan reads the control's own open tag and its directives.
        const controlConditional = tpl ? templateCondition(tpl.text, c.index + 1) !== null : false
        const navEffects = new Set<string>()
        /**
         * Wire one navigation this control fires — from a traced (click) handler or
         * its own routerLink — to the declared route(s): a literal target is must/may
         * per the target's guards, a static-prefix template over-approximates to a may
         * edge per matching route, a dynamic target is a soundiness note, and so is an address
         * only a redirect the reader does not follow answers, which is no dead link. `guard` is a
         * handler-level condition joined with the route gate; `what` names the source
         * in notes. A note cites `t.file` when set, because `t.loc` is then a line in that
         * external template and not in the component's `.ts`.
         */
        const wireControlNav = (t: RawTarget, guard: string | null, what: string): void => {
          if (t.ti.kind === 'literal') {
            const parsed = t.url ? urlPath(t.ti.value) : { path: t.ti.value, aux: false }
            if (parsed === null) return
            const primary = parsed.path
            const landed = land(primary, t.url !== true)
            const target = landed.target
            if (!target) {
              const said = landed.unread ? 'is answered by a redirect the reader does not follow, so where it lands is not read' : 'matches no declared route'
              soundiness.push({ kind: landed.unread ? 'dynamic-target' : 'unresolved-target', file: t.file ?? file, loc: t.loc, detail: `${what} target "${t.ti.value}" ${said}` })
              return
            }
            const run = runningGuards(route.nodeId, target.nodeId, 0, landed.tried)
            const gate = gateFromGuards(run.guards)
            noteGuards(gate, pathByNodeId.get(target.nodeId) ?? target.nodeId, soundiness, seenAsyncGuards)
            const guards = [guard, ...gate.guardTexts].filter((g): g is string => g != null)
            const guarded = guards.length > 0
            // This mode resolves no relative target, so one without a leading slash is matched as
            // written and never trusted; the other demotions are the screen-level ones.
            const uncertain = guarded || t.conditional === true || !primary.startsWith('/') || target.nodeId === route.nodeId || t.ti.holes === true ||
              parsed.aux || landed.ambiguous || run.resolves || hidden(route.nodeId)
            const confidence = gate.guarded ? gate.confidence : guard != null ? 0.6 : uncertain ? 0.5 : 1
            pushEdge(cId, target.nodeId, t, uncertain ? 'may' : 'must', confidence, guarded ? guards.join(',') : null, file)
            navEffects.add('navigate')
          } else if (t.ti.kind === 'template') {
            for (const cand of matchPrefix(t.ti.staticPrefix, routeLikes)) {
              const gate = gateFromGuards(runningGuards(undefined, cand.nodeId).guards)
              noteGuards(gate, pathByNodeId.get(cand.nodeId) ?? cand.nodeId, soundiness, seenAsyncGuards)
              const guards = [guard, ...gate.guardTexts].filter((g): g is string => g != null)
              pushEdge(cId, cand.nodeId, t, 'may', gate.guarded ? Math.min(gate.confidence, 0.5) : 0.5, guards.length > 0 ? guards.join(',') : null, file)
              navEffects.add('navigate')
            }
          } else if (t.ti.kind !== 'same-screen' && t.ti.kind !== 'aux-outlet') {
            soundiness.push({ kind: 'dynamic-target', file: t.file ?? file, loc: t.loc, detail: `${what} navigates to a fully dynamic target` })
          }
        }
        for (const handler of c.handlers) {
          const methodName = /([a-zA-Z_$][\w$]*)\s*\(/.exec(handler)?.[1]
          if (methodName === undefined) continue
          // `(click)="flag && go()"` calls the method only on some clicks.
          const bare = isBareCall(handler)
          for (const nav of methodNavTargets(sf, methodName)) {
            wireControlNav({ ti: nav.ti, event: nav.event, effect: nav.effect, ruleId: nav.ruleId, loc, file: tplFile, url: nav.effect === 'router.navigateByUrl', conditional: controlConditional || !bare || nav.conditional }, nav.guard, `control handler ${methodName}()`)
          }
        }
        const link = linkAttrTarget(c.attrs)
        if (link !== null) wireControlNav({ ti: link, event: 'click', effect: 'navigate', ruleId: 'ng.control.router-link', loc, file: tplFile, conditional: controlConditional }, null, 'control routerLink')

        const name = c.text ?? c.attrs.get('aria-label') ?? c.attrs.get('placeholder') ?? c.attrs.get('name')
        // A nameless generic element is usually a child component with an @Output
        // binding (<app-follow-button (toggle)>): its tag is the only readable handle.
        const fallbackLabel = c.controlType === 'element' ? c.tag.toLowerCase() : c.controlType
        nodes.push({
          id: cId,
          route: null,
          componentPath: file,
          label: name ?? fallbackLabel,
          kind: 'control',
          parent: route.nodeId,
          control: {
            element: c.tag.toLowerCase(),
            controlType: c.controlType,
            selector: c.selector,
            ...(c.input ? { input: c.input } : {}),
            ...(name !== undefined ? { name } : {}),
            ...(c.events.length > 0 ? { events: c.events } : {}),
            ...(navEffects.size > 0 ? { effects: [...navEffects] } : {}),
          },
        })
      }
    }
  }

  const routeObjects = new Map(routes.map((r) => [r.fullPath, r.routeObj as Node]))
  soundiness.push(
    ...analyzeInputBindings(
      project,
      projectDir,
      routes.map((r) => ({ fullPath: r.fullPath, componentFile: r.componentFile })),
      routeObjects,
    ),
  )

  // An anchor whose every edge was drawn per screen stands for nothing in the graph.
  const anchored = new Set(edges.map((e) => e.from))
  const kept = nodes.filter((n) => n.kind !== 'scope' || anchored.has(n.id))
  const graph = {
    version: 0 as const,
    meta: {
      adapter: '@ui-graph/adapter-angular',
      adapterVersion: ADAPTER_VERSION,
      rulesetVersion: opts.rulesetVersion ?? DEFAULT_RULESET,
      ...(opts.commit ? { commit: opts.commit } : {}),
    },
    nodes: kept,
    edges,
  }
  if (assumedOrder.size > 0) {
    const named = [...assumedOrder].map(([at, levels]) => `${at} (${relative(projectDir, levels[levels.length - 1]?.obj.getSourceFile().getFilePath() ?? projectDir)})`)
    soundiness.push({ kind: 'route-order', detail: `the catch-all route(s) at ${named.join(', ')} sit in a route table the application registers apart from its other tables, and are taken to be matched after every route of those, since the order the tables are registered in is not read; any edge such a rival would otherwise hold at may rests on that order` })
  }
  return { graph, soundiness }
}

export { ADAPTER_VERSION, DEFAULT_RULESET }
