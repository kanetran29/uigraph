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
import type { Node } from 'ts-morph'
import { relative } from 'node:path'
import type { ExtractOptions, ExtractResult, GraphEdge, GraphNode, SoundinessNote } from '@uigraph/core'
import { edgeId, controlNodeId } from './ids'
import { matchLiteral, matchPrefix, type RouteLike } from './matcher'
import { analyzeInputBindings } from './inputs'
import { collectRoutes } from './routes'
import { templateTargets, routerCallTargets, methodNavTargets, type RawTarget } from './nav'
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

  const nodes: GraphNode[] = routes.map((r) => ({
    id: r.nodeId,
    route: r.fullPath,
    componentPath: r.componentFile ? relative(projectDir, r.componentFile.getFilePath()) : null,
    label: r.componentName ?? r.fullPath,
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

  for (const route of routes) {
    if (!route.componentFile) {
      soundiness.push({ kind: 'unresolved-component', detail: `route ${route.fullPath} has no resolvable component file` })
      continue
    }
    const file = relative(projectDir, route.componentFile.getFilePath())
    const targets = [...templateTargets(route.componentFile, projectDir), ...routerCallTargets(route.componentFile)]
    for (const t of targets) {
      if (t.ti.kind === 'literal') {
        const target = matchLiteral(t.ti.value, routeLikes)
        if (!target) {
          soundiness.push({ kind: 'unresolved-target', file, loc: t.loc, detail: `literal target "${t.ti.value}" matches no declared route` })
          continue
        }
        const gate = gateFromGuards(guardsByNodeId.get(target.nodeId) ?? [])
        noteGuards(gate, pathByNodeId.get(target.nodeId) ?? target.nodeId, soundiness, seenAsyncGuards)
        const guardText = gate.guarded ? gate.guardTexts.join(',') : null
        pushEdge(route.nodeId, target.nodeId, t, gate.guarded ? 'may' : 'must', gate.guarded ? gate.confidence : 1, guardText, file)
      } else if (t.ti.kind === 'template') {
        const cands = matchPrefix(t.ti.staticPrefix, routeLikes)
        soundiness.push({ kind: 'over-approximation', file, loc: t.loc, detail: `non-literal target prefix "${t.ti.staticPrefix}" over-approximated to ${cands.length} route(s)` })
        for (const cand of cands) {
          const gate = gateFromGuards(guardsByNodeId.get(cand.nodeId) ?? [])
          noteGuards(gate, pathByNodeId.get(cand.nodeId) ?? cand.nodeId, soundiness, seenAsyncGuards)
          const guardText = gate.guarded ? gate.guardTexts.join(',') : null
          pushEdge(route.nodeId, cand.nodeId, t, 'may', gate.guarded ? Math.min(gate.confidence, 0.5) : 0.5, guardText, file)
        }
      } else {
        soundiness.push({ kind: 'dynamic-target', file, loc: t.loc, detail: `fully dynamic navigation target (event ${t.event})` })
      }
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

      for (const c of controls) {
        const cId = controlNodeId(route.nodeId, c.selector)
        const lc = sf.getLineAndColumnAtPos(inlineTemplate(sf)?.start ?? 0)
        const navEffects = new Set<string>()
        for (const handler of c.handlers) {
          const methodName = /([a-zA-Z_$][\w$]*)\s*\(/.exec(handler)?.[1]
          if (methodName === undefined) continue
          for (const nav of methodNavTargets(sf, methodName)) {
            const t: RawTarget = { ti: nav.ti, event: nav.event, effect: nav.effect, ruleId: nav.ruleId, loc: { line: lc.line, col: lc.column } }
            if (nav.ti.kind === 'literal') {
              const target = matchLiteral(nav.ti.value, routeLikes)
              if (!target) {
                soundiness.push({ kind: 'unresolved-target', file, loc: t.loc, detail: `control nav target "${nav.ti.value}" matches no declared route` })
                continue
              }
              const gate = gateFromGuards(guardsByNodeId.get(target.nodeId) ?? [])
              noteGuards(gate, pathByNodeId.get(target.nodeId) ?? target.nodeId, soundiness, seenAsyncGuards)
              const guards = [nav.guard, ...gate.guardTexts].filter((g): g is string => g != null)
              const guarded = guards.length > 0
              const confidence = gate.guarded ? gate.confidence : nav.guard != null ? 0.6 : 1
              pushEdge(cId, target.nodeId, t, guarded ? 'may' : 'must', confidence, guarded ? guards.join(',') : null, file)
              navEffects.add('navigate')
            } else if (nav.ti.kind === 'template') {
              for (const cand of matchPrefix(nav.ti.staticPrefix, routeLikes)) {
                const gate = gateFromGuards(guardsByNodeId.get(cand.nodeId) ?? [])
                noteGuards(gate, pathByNodeId.get(cand.nodeId) ?? cand.nodeId, soundiness, seenAsyncGuards)
                const guards = [nav.guard, ...gate.guardTexts].filter((g): g is string => g != null)
                pushEdge(cId, cand.nodeId, t, 'may', gate.guarded ? Math.min(gate.confidence, 0.5) : 0.5, guards.length > 0 ? guards.join(',') : null, file)
                navEffects.add('navigate')
              }
            } else {
              soundiness.push({ kind: 'dynamic-target', file, loc: t.loc, detail: `control handler ${methodName}() navigates to a fully dynamic target` })
            }
          }
        }

        const name = c.text ?? c.attrs.get('aria-label') ?? c.attrs.get('placeholder') ?? c.attrs.get('name')
        nodes.push({
          id: cId,
          route: null,
          componentPath: file,
          label: name ?? c.controlType,
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
      adapter: '@uigraph/adapter-angular',
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
