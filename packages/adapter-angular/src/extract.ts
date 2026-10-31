// Angular Router static extraction (milestone M3). Walks a ts-morph project,
// turns a `Routes` array (path/component/canActivate, incl. nested paths) into
// nodes, and turns each route component's inline `@Component` template
// (routerLink / [routerLink]) plus `Router.navigate` / `Router.navigateByUrl`
// calls into edges. Non-literal targets are over-approximated over the declared
// route set; canActivate guards (class refs, named functional guards, and inline
// arrow guards) become symbolic guard text via ./guards, with
// Observable/Promise-returning guards lowered in confidence + a soundiness note.
// No edge is emitted without a static witness.

import { Node, Project, SyntaxKind, ts } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { relative, join, dirname } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import type { ExtractOptions, ExtractResult, GraphEdge, GraphNode, SoundinessNote } from '@ui-graph/core'
import { edgeId, controlNodeId } from './ids'
import { matchLiteral, matchPrefix, primaryPath, resolveRelativeTarget, type RouteLike } from './matcher'
import { analyzeInputBindings } from './inputs'
import { templateCondition } from './conditions'
import { collectRoutes, type UnreadableRoutes } from './routes'
import { resolveImportedFile, isInsideDir } from './resolve'
import { attributeScopes, subtreeAnchor, SHELL_NODE_ID } from './attribute'
import { templateTargets, routerCallTargets, methodNavTargets, templateLoc, linkAttrTarget, type RawTarget } from './nav'
import { parseControls } from './controls'
import { inlineTemplate } from './templates'
import { gateFromGuards, noteGuards } from './gates'

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
 * `wildcardScreen` below is looked up by the full path `*`. `joinRoutePath` folds `**`, `*` and
 * `/*` into `*` only at the ROOT; inside a feature module the same segment becomes
 * `<parent>/*`, because it catches only that module's unmatched URLs. So the one route whose
 * full path is `*` is the application's own catch-all WHENEVER every table was walked under its
 * prefix. A feature table the walk could not reach, and that the root scan therefore read at
 * `/`, puts its own `**` here instead: that is the project-root reading Chapter 5 reports, and
 * it is why the catch-all census is caveated for an application whose route set is a lower
 * bound rather than trusted outright. A catch-all that only redirects is no screen and is absent from this list; it lives
 * in `redirects` instead, under the same full path.
 */
export function extractGraph(project: Project, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  const redirects = new Map<string, string>()
  const unreadable: UnreadableRoutes = { paths: new Set(), subtrees: new Set(), unplaced: new Set(), spreads: new Set(), calls: new Set(), outlets: new Set() }
  const routes = collectRoutes(project, redirects, unreadable, projectDir)
  const unreadableText = describeUnreadable(unreadable)
  const routeLikes: RouteLike[] = routes.map((r) => ({ fullPath: r.fullPath, nodeId: r.nodeId }))
  const wildcardScreen = routeLikes.find((r) => r.fullPath === '*') ?? null
  const guardsByNodeId = new Map(routes.map((r) => [r.nodeId, r.guards]))
  const pathByNodeId = new Map(routes.map((r) => [r.nodeId, r.fullPath]))
  const redirectOfNode = new Map(routes.flatMap((r) => (r.redirectsTo !== undefined ? [[r.nodeId, r.redirectsTo] as const] : [])))
  const componentByNodeId = new Map(routes.map((r) => [r.nodeId, r.componentFile ? relative(projectDir, r.componentFile.getFilePath()) : null]))
  // The screens a scope anchor stands for, filled as anchors are minted.
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
    if ((e.witness?.file === w.file && e.witness?.loc?.line === w.loc.line) || e.mergedWitnesses?.some((m) => m.file === w.file && m.loc?.line === w.loc.line)) return
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
   * scope the pass is not certain of. A literal no route declares is routed to the application's
   * catch-all (a `**` redirect target or a `**` screen) at may, never must. Every note cites
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
        // An auxiliary outlet the adapter does not model; the primary path is what it reaches.
        const primary = primaryPath(t.ti.value)
        if (primary === null) continue
        const value = resolveRelativeTarget(primary, base)
        // A relative target resolves against the route of the component that holds the site, and
        // the emitting node's path is that route only when the node is the component's own route.
        const baseUnknown = !primary.startsWith('/') && (t.baseUnknown === true || (t.relative === true && componentByNodeId.get(from) !== file))
        let target = matchLiteral(value, routeLikes)
        // A link to a redirect reaches what the redirect forwards to; follow it one step. So does a
        // link to a screen whose own address an empty-path child redirects.
        const forwarded = target ? redirectOfNode.get(target.nodeId) : undefined
        if (target && forwarded !== undefined && pathByNodeId.get(target.nodeId) === value.split(/[?#]/)[0]) target = matchLiteral(forwarded, routeLikes)
        else if (!target && redirects.has(value)) target = matchLiteral(redirects.get(value)!, routeLikes)
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
          const wildcardRedirect = redirects.get('*')
          target = wildcardRedirect !== undefined ? matchLiteral(wildcardRedirect, routeLikes) : wildcardScreen
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
            const answer = wildcardRedirect !== undefined ? `redirects it to ${wildcardRedirect}` : 'answers it with its own catch-all screen'
            soundiness.push({ kind: 'wildcard-redirect', file: t.file ?? file, loc: t.loc, detail: `literal target "${value}" matches no declared route and the wildcard route ${answer}${caveat}` })
          }
        }
        if (!target) {
          if (note) soundiness.push({ kind: 'unresolved-target', file: t.file ?? file, loc: t.loc, detail: `literal target "${value}" matches no declared route${baseUnknown ? ', resolved against a base the reader could not fix' : ''}` })
          continue
        }
        const gate = gateFromGuards(guardsByNodeId.get(target.nodeId) ?? [])
        noteGuards(gate, pathByNodeId.get(target.nodeId) ?? target.nodeId, soundiness, seenAsyncGuards)
        const guardText = gate.guarded ? gate.guardTexts.join(',') : null
        // A navigation to the address its source already displays is ignored by Angular's
        // default router, or runs only when a parameter or the query differs, so it does not
        // occur on every execution. The shell stands for every screen, the target among them.
        const selfLoop = target.nodeId === from || from === SHELL_NODE_ID || anchorMembers.get(from)?.has(target.nodeId) === true
        const uncertain = gate.guarded || capMay || viaWildcard || baseUnknown || selfLoop || t.conditional === true || (t.ti.kind === 'literal' && t.ti.holes === true)
        pushEdge(from, target.nodeId, t, uncertain ? 'may' : 'must', gate.guarded ? gate.confidence : uncertain ? 0.5 : 1, guardText, file)
      } else if (t.ti.kind === 'template') {
        const prefix = resolveRelativeTarget(t.ti.staticPrefix, t.relative ? pathByNodeId.get(from) : '/')
        const cands = matchPrefix(prefix, routeLikes)
        if (note) soundiness.push({ kind: 'over-approximation', file: t.file ?? file, loc: t.loc, detail: `non-literal target prefix "${prefix}" over-approximated to ${cands.length} route(s)` })
        for (const cand of cands) {
          const gate = gateFromGuards(guardsByNodeId.get(cand.nodeId) ?? [])
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
    emitTargets(route.nodeId, targets, file, true)
  }

  if (opts.attribution) {
    // A measurement switch, not a product option: the thesis ablates the attribution into
    // its mechanisms and needs each one extracted on the same corpus. Unset, or set to
    // anything else, means the full analysis, which is the only configuration shipped.
    const layers = process.env.UIGRAPH_SCOPE_LAYERS
    const scopes = attributeScopes(project.getSourceFiles(), routes, projectDir,
      layers === 'owned' || layers === 'nesting' || layers === 'rooted' || layers === 'outlet' ? layers : 'full')
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
    for (const [f, screens] of scopes.screensOf) {
      const c = scopes.components.get(f)
      if (!c) continue
      const ts = targetsOf(c.sf)
      if (ts.length === 0) continue
      emitOver(screens, ts, relative(projectDir, f))
    }
    // The application shell: anchored once at a scope node, expanded on query.
    let shellEdges = 0
    for (const f of [...scopes.shell].sort()) {
      const c = scopes.components.get(f)
      if (!c) continue
      const before = edges.length
      emitTargets(SHELL_NODE_ID, targetsOf(c.sf), relative(projectDir, f), true)
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
    // behalf of whatever injects it, so its scope is the join over those callers. The join is
    // taken per class rather than per method, so it can be wider than the real scope and the
    // edges are capped at may. A service nothing injects has no scope at all and is reported.
    for (const sf of project.getSourceFiles()) {
      const f = sf.getFilePath()
      if (scopes.components.has(f) || /\.(spec|test|stories)\.ts$/.test(f)) continue
      const ts = routerCallTargets(sf)
      if (ts.length === 0) continue
      const file = relative(projectDir, f)
      // An NgRx effect is registered with the store for the lifetime of the application, so it
      // can fire on any screen: its scope is top, the same place the shell sits.
      // From the syntax tree, not the text: a `createEffect(` inside a comment is not an effect.
      const isEffect = sf.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => /(^|\.)createEffect$/.test(c.getExpression().getText()))
      if (scopes.standIns && isEffect && isInsideDir(f, projectDir)) {
        const before = edges.length
        emitTargets(SHELL_NODE_ID, ts, file, true, true)
        shellEdges += edges.length - before
        continue
      }
      if (scopes.serviceShell.has(f)) {
        const before = edges.length
        emitTargets(SHELL_NODE_ID, ts, file, true, true)
        shellEdges += edges.length - before
        continue
      }
      const screens = new Set([...(scopes.serviceScreens.get(f) ?? []),
        ...(scopes.standIns ? guardScreens.get(f) ?? [] : [])])
      if (screens.size === 0) {
        // An effect that reaches here is unplaced, not known to be unused.
        const where = !isEffect ? 'a class nothing in the application injects; its scope is empty'
          : isInsideDir(f, projectDir) ? 'an NgRx effect; the shell stand-in for dispatch applies only at the full attribution level, so its scope could not be placed'
          : 'an NgRx effect outside the application directory; whether the application registers it is not read, so its scope could not be placed'
        soundiness.push({ kind: 'unattributed-non-component', file, detail: `${ts.length} navigation call(s) in ${where}` })
        continue
      }
      for (const s of [...screens].sort()) emitTargets(s, ts, file, false, true)
    }
    if (shellEdges > 0) nodes.push({ id: SHELL_NODE_ID, route: null, componentPath: null, label: 'application shell (every screen)', kind: 'scope', scope: { kind: 'top' } })

    // An edge needs both ends. The `u_<screen>` sink supplies a destination the run time owns;
    // this supplies a SOURCE the analysis could not place. A component that no route renders
    // and that nothing reaches from a routed component has no screen set, so until now its
    // navigation left no trace at all — even when its destination was perfectly readable.
    // Anchoring it at an unplaced origin keeps the destination, says plainly that the source
    // is unknown, and holds the edges at may.
    const placed = new Set<string>([...scopes.screensOf.keys(), ...scopes.shell, ...scopes.indirectShell, ...routes.flatMap((r) => (r.componentFile ? [r.componentFile.getFilePath()] : []))])
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
         * edge per matching route, a dynamic target is a soundiness note. `guard` is a
         * handler-level condition joined with the route gate; `what` names the source
         * in notes. A note cites `t.file` when set, because `t.loc` is then a line in that
         * external template and not in the component's `.ts`.
         */
        const wireControlNav = (t: RawTarget, guard: string | null, what: string): void => {
          if (t.ti.kind === 'literal') {
            const primary = primaryPath(t.ti.value)
            if (primary === null) return
            const target = matchLiteral(primary, routeLikes)
            if (!target) {
              soundiness.push({ kind: 'unresolved-target', file: t.file ?? file, loc: t.loc, detail: `${what} target "${t.ti.value}" matches no declared route` })
              return
            }
            const gate = gateFromGuards(guardsByNodeId.get(target.nodeId) ?? [])
            noteGuards(gate, pathByNodeId.get(target.nodeId) ?? target.nodeId, soundiness, seenAsyncGuards)
            const guards = [guard, ...gate.guardTexts].filter((g): g is string => g != null)
            const guarded = guards.length > 0
            // This mode resolves no relative target, so one without a leading slash is matched as
            // written and never trusted; the other demotions are the screen-level ones.
            const uncertain = guarded || t.conditional === true || !primary.startsWith('/') || target.nodeId === route.nodeId || t.ti.holes === true
            const confidence = gate.guarded ? gate.confidence : guard != null ? 0.6 : uncertain ? 0.5 : 1
            pushEdge(cId, target.nodeId, t, uncertain ? 'may' : 'must', confidence, guarded ? guards.join(',') : null, file)
            navEffects.add('navigate')
          } else if (t.ti.kind === 'template') {
            for (const cand of matchPrefix(t.ti.staticPrefix, routeLikes)) {
              const gate = gateFromGuards(guardsByNodeId.get(cand.nodeId) ?? [])
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
          for (const nav of methodNavTargets(sf, methodName)) {
            wireControlNav({ ti: nav.ti, event: nav.event, effect: nav.effect, ruleId: nav.ruleId, loc, file: tplFile, conditional: controlConditional || nav.conditional }, nav.guard, `control handler ${methodName}()`)
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

  const graph = {
    version: 0 as const,
    meta: {
      adapter: '@ui-graph/adapter-angular',
      adapterVersion: ADAPTER_VERSION,
      rulesetVersion: opts.rulesetVersion ?? DEFAULT_RULESET,
      ...(opts.commit ? { commit: opts.commit } : {}),
    },
    nodes,
    edges,
  }
  return { graph, soundiness }
}

export { ADAPTER_VERSION, DEFAULT_RULESET }
