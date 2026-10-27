// Angular Router static extraction (milestone M3). Walks a ts-morph project,
// turns a `Routes` array (path/component/canActivate, incl. nested paths) into
// nodes, and turns each route component's inline `@Component` template
// (routerLink / [routerLink]) plus `Router.navigate` / `Router.navigateByUrl`
// calls into edges. Non-literal targets are over-approximated over the declared
// route set; canActivate guards (class refs, named functional guards, and inline
// arrow guards) become symbolic guard text via ./guards, with
// Observable/Promise-returning guards lowered in confidence + a soundiness note.
// No edge is emitted without a static witness.

import { Project, ts } from 'ts-morph'
import type { Node, SourceFile } from 'ts-morph'
import { relative } from 'node:path'
import type { ExtractOptions, ExtractResult, GraphEdge, GraphNode, SoundinessNote } from '@ui-graph/core'
import { edgeId, controlNodeId } from './ids'
import { matchLiteral, matchPrefix, resolveRelativeTarget, type RouteLike } from './matcher'
import { analyzeInputBindings } from './inputs'
import { collectRoutes } from './routes'
import { attributeScopes, subtreeAnchor, SHELL_NODE_ID } from './attribute'
import { templateTargets, routerCallTargets, methodNavTargets, templateLoc, linkAttrTarget, type RawTarget } from './nav'
import { parseControls } from './controls'
import { inlineTemplate } from './templates'
import { gateFromGuards, noteGuards } from './gates'

const ADAPTER_VERSION = '0.1.0'
const DEFAULT_RULESET = 'ng-v0-2026.06'

/** Build a ts-morph project from a project directory, scanning src first. */
export function buildProject(projectDir: string): Project {
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    useInMemoryFileSystem: false,
  })
  project.addSourceFilesAtPaths([`${projectDir}/src/**/*.{ts,js}`, `!${projectDir}/**/node_modules/**`])
  if (project.getSourceFiles().length === 0) {
    project.addSourceFilesAtPaths([`${projectDir}/**/*.{ts,js}`, `!${projectDir}/**/node_modules/**`])
  }
  return project
}

/** Extract a graph from an already-built ts-morph project (testable in memory). */
export function extractGraph(project: Project, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  const routes = collectRoutes(project)
  const routeLikes: RouteLike[] = routes.map((r) => ({ fullPath: r.fullPath, nodeId: r.nodeId }))
  const guardsByNodeId = new Map(routes.map((r) => [r.nodeId, r.guards]))
  const pathByNodeId = new Map(routes.map((r) => [r.nodeId, r.fullPath]))

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
  const seen = new Set<string>()
  const seenAsyncGuards = new Set<string>()

  function pushEdge(from: string, to: string, t: RawTarget, modality: 'must' | 'may', confidence: number, guard: string | null, file: string): void {
    const id = edgeId(from, to, t.event, guard)
    if (seen.has(id)) return
    seen.add(id)
    edges.push({
      id,
      from,
      to,
      event: t.event,
      guard,
      effect: t.effect,
      modality,
      source: 'static',
      confidence,
      witness: { source: 'static', file: t.file ?? file, loc: t.loc, ruleId: t.ruleId },
    })
  }

  /**
   * Emit the edges for one set of navigation targets fired from `from`. `note` records the
   * soundiness note for a site once, so an attributed site that fires from many screens does
   * not report the same approximation once per screen. `capMay` holds the edges at may for a
   * scope the pass is not certain of.
   */
  function emitTargets(from: string, targets: RawTarget[], file: string, note: boolean, capMay = false): void {
    for (const t of targets) {
      if (t.ti.kind === 'literal') {
        const value = t.relative ? resolveRelativeTarget(t.ti.value, pathByNodeId.get(from)) : t.ti.value
        const target = matchLiteral(value, routeLikes)
        if (!target) {
          if (note) soundiness.push({ kind: 'unresolved-target', file, loc: t.loc, detail: `literal target "${value}" matches no declared route` })
          continue
        }
        const gate = gateFromGuards(guardsByNodeId.get(target.nodeId) ?? [])
        noteGuards(gate, pathByNodeId.get(target.nodeId) ?? target.nodeId, soundiness, seenAsyncGuards)
        const guardText = gate.guarded ? gate.guardTexts.join(',') : null
        pushEdge(from, target.nodeId, t, gate.guarded || capMay ? 'may' : 'must', gate.guarded ? gate.confidence : capMay ? 0.5 : 1, guardText, file)
      } else if (t.ti.kind === 'template') {
        const cands = matchPrefix(t.ti.staticPrefix, routeLikes)
        if (note) soundiness.push({ kind: 'over-approximation', file, loc: t.loc, detail: `non-literal target prefix "${t.ti.staticPrefix}" over-approximated to ${cands.length} route(s)` })
        for (const cand of cands) {
          const gate = gateFromGuards(guardsByNodeId.get(cand.nodeId) ?? [])
          noteGuards(gate, pathByNodeId.get(cand.nodeId) ?? cand.nodeId, soundiness, seenAsyncGuards)
          const guardText = gate.guarded ? gate.guardTexts.join(',') : null
          pushEdge(from, cand.nodeId, t, 'may', gate.guarded ? Math.min(gate.confidence, 0.5) : 0.5, guardText, file)
        }
      } else if (note) {
        soundiness.push({ kind: 'dynamic-target', file, loc: t.loc, detail: `fully dynamic navigation target (event ${t.event})` })
      }
    }
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
    const scopes = attributeScopes(project.getSourceFiles(), routes)
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
    if (shellEdges > 0) nodes.push({ id: SHELL_NODE_ID, route: null, componentPath: null, label: 'application shell (every screen)', kind: 'scope', scope: { kind: 'top' } })
    // Navigation in classes that are not components (services, guards, effects) is
    // not attributed in this version: its scope is the join over its callers.
    for (const sf of project.getSourceFiles()) {
      if (scopes.components.has(sf.getFilePath()) || /\.(spec|test|stories)\.ts$/.test(sf.getFilePath())) continue
      const n = routerCallTargets(sf).length
      if (n > 0) soundiness.push({ kind: 'unattributed-non-component', file: relative(projectDir, sf.getFilePath()), detail: `${n} navigation call(s) outside any component; scope would be the join of the callers' scopes` })
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
        const navEffects = new Set<string>()
        /**
         * Wire one navigation this control fires — from a traced (click) handler or
         * its own routerLink — to the declared route(s): a literal target is must/may
         * per the target's guards, a static-prefix template over-approximates to a may
         * edge per matching route, a dynamic target is a soundiness note. `guard` is a
         * handler-level condition joined with the route gate; `what` names the source
         * in notes.
         */
        const wireControlNav = (t: RawTarget, guard: string | null, what: string): void => {
          if (t.ti.kind === 'literal') {
            const target = matchLiteral(t.ti.value, routeLikes)
            if (!target) {
              soundiness.push({ kind: 'unresolved-target', file, loc: t.loc, detail: `${what} target "${t.ti.value}" matches no declared route` })
              return
            }
            const gate = gateFromGuards(guardsByNodeId.get(target.nodeId) ?? [])
            noteGuards(gate, pathByNodeId.get(target.nodeId) ?? target.nodeId, soundiness, seenAsyncGuards)
            const guards = [guard, ...gate.guardTexts].filter((g): g is string => g != null)
            const guarded = guards.length > 0
            const confidence = gate.guarded ? gate.confidence : guard != null ? 0.6 : 1
            pushEdge(cId, target.nodeId, t, guarded ? 'may' : 'must', confidence, guarded ? guards.join(',') : null, file)
            navEffects.add('navigate')
          } else if (t.ti.kind === 'template') {
            for (const cand of matchPrefix(t.ti.staticPrefix, routeLikes)) {
              const gate = gateFromGuards(guardsByNodeId.get(cand.nodeId) ?? [])
              noteGuards(gate, pathByNodeId.get(cand.nodeId) ?? cand.nodeId, soundiness, seenAsyncGuards)
              const guards = [guard, ...gate.guardTexts].filter((g): g is string => g != null)
              pushEdge(cId, cand.nodeId, t, 'may', gate.guarded ? Math.min(gate.confidence, 0.5) : 0.5, guards.length > 0 ? guards.join(',') : null, file)
              navEffects.add('navigate')
            }
          } else {
            soundiness.push({ kind: 'dynamic-target', file, loc: t.loc, detail: `${what} navigates to a fully dynamic target` })
          }
        }
        for (const handler of c.handlers) {
          const methodName = /([a-zA-Z_$][\w$]*)\s*\(/.exec(handler)?.[1]
          if (methodName === undefined) continue
          for (const nav of methodNavTargets(sf, methodName)) {
            wireControlNav({ ti: nav.ti, event: nav.event, effect: nav.effect, ruleId: nav.ruleId, loc, file: tplFile }, nav.guard, `control handler ${methodName}()`)
          }
        }
        const link = linkAttrTarget(c.attrs)
        if (link !== null) wireControlNav({ ti: link, event: 'click', effect: 'navigate', ruleId: 'ng.control.router-link', loc, file: tplFile }, null, 'control routerLink')

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
