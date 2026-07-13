// Vue Router static extraction. Splits each `.vue` SFC into template + script,
// turns a `createRouter({ routes: [...] })` array (path/component/name/children/
// beforeEnter, incl. nested paths) — plus exported route arrays registered at
// runtime via addRoutes()/addRoute(), flagged with soundiness notes — into
// screen nodes, and turns each component's
// <router-link to|:to> and `router.push/replace` calls into edges. With
// opts.controls, the template's interactive elements become control nodes whose
// @event handlers are traced to router.push sinks. Non-literal targets are
// over-approximated over the declared route set; no edge without a static witness.
//
// This file is the orchestrator: SFC/route/nav/control detail lives in the sibling
// project / router-config / targets / guards / nav / controls / template modules.

import { Project, ts } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { ExtractOptions, ExtractResult, GraphEdge, GraphNode, SoundinessNote } from '@ui-graph/core'
import { edgeId, controlNodeId } from './ids'
import { matchLiteralAll, matchPrefix, type RouteLike } from './matcher'
import { splitSfc, type Sfc } from './sfc'
import type { RawTarget } from './types'
import { safeIsDir, walkSources } from './project'
import { collectRoutes } from './router-config'
import { collectRouterWrappers, routerVars, navTargetsIn, handlerNavTargets, handlerModalCloses } from './nav'
import { parseControls } from './controls'
import { templateTargets, childTargets } from './template'

const ADAPTER_VERSION = '0.1.0'
const DEFAULT_RULESET = 'vue-v3-2026.06'

/** A parsed .vue component: its source path, full source, split SFC, and virtual script source file. */
export interface VueComponent {
  vuePath: string
  source: string
  sfc: Sfc
  scriptSf: SourceFile
}

/** A ts-morph project plus the registered .vue components (ts-morph can't read .vue itself). */
export interface VueProject {
  project: Project
  components: VueComponent[]
}

/** Build a VueProject from an in-memory file map (testable analogue of buildProject). */
export function buildProjectFromSources(files: Record<string, string>): VueProject {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  })
  const components: VueComponent[] = []
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.vue')) {
      const sfc = splitSfc(content)
      const scriptSf = project.createSourceFile(`${path}.script.ts`, sfc.script)
      components.push({ vuePath: path, source: content, sfc, scriptSf })
    } else {
      project.createSourceFile(path, content)
    }
  }
  return { project, components }
}

/** Build a VueProject by scanning a project directory's .ts/.js/.vue sources. */
export function buildProject(projectDir: string): VueProject {
  const files: Record<string, string> = {}
  const abs = resolve(projectDir)
  const roots = [join(abs, 'src'), abs]
  const root = roots.find((r) => safeIsDir(r)) ?? abs
  for (const file of walkSources(root)) {
    try {
      files[file] = readFileSync(file, 'utf8')
    } catch {
      continue
    }
  }
  return buildProjectFromSources(files)
}

/** Extract a graph from a built VueProject (testable in memory). */
export function extractGraph(vp: VueProject, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  const { routes, notes: routeNotes } = collectRoutes(vp)
  const routeLikes: RouteLike[] = routes.map((r) => ({ fullPath: r.fullPath, nodeId: r.nodeId }))
  const guardsByNodeId = new Map(routes.map((r) => [r.nodeId, r.guards]))
  const nameToPath = new Map(routes.filter((r) => r.name).map((r) => [r.name as string, r.fullPath]))
  const wrappers = collectRouterWrappers(vp.project)

  const nodes: GraphNode[] = routes.map((r) => ({
    id: r.nodeId,
    route: r.fullPath,
    componentPath: r.component ? relative(projectDir, r.component.vuePath) : null,
    label: r.componentName ?? r.name ?? r.fullPath,
    kind: 'screen',
  }))

  const edges: GraphEdge[] = []
  const soundiness: SoundinessNote[] = routeNotes.map((n) => (n.file ? { ...n, file: relative(projectDir, n.file) } : n))
  const byBehavior = new Map<string, number>()

  function pushEdge(from: string, to: string, t: RawTarget, modality: 'must' | 'may', confidence: number, guard: string | null, file: string): void {
    const behaviorKey = `${from}|${to}|${t.event}`
    const existingIdx = byBehavior.get(behaviorKey)
    if (existingIdx !== undefined) {
      const existing = edges[existingIdx] as GraphEdge
      const supersedes = (modality === 'must' && existing.modality === 'may') || (modality === existing.modality && confidence > existing.confidence)
      if (supersedes) {
        const id = edgeId(from, to, t.event, guard)
        edges[existingIdx] = { id, from, to, event: t.event, guard, effect: t.effect, modality, source: 'static', confidence, witness: { source: 'static', file, loc: t.loc, ruleId: t.ruleId } }
      }
      return
    }
    const id = edgeId(from, to, t.event, guard)
    byBehavior.set(behaviorKey, edges.length)
    edges.push({ id, from, to, event: t.event, guard, effect: t.effect, modality, source: 'static', confidence, witness: { source: 'static', file, loc: t.loc, ruleId: t.ruleId } })
  }

  function resolveTarget(from: string, t: RawTarget, file: string): void {
    if (t.ti.kind === 'literal') {
      const { exact, candidates } = matchLiteralAll(t.ti.value, routeLikes)
      if (exact) {
        const guards = [t.guard, ...(guardsByNodeId.get(exact.nodeId) ?? [])].filter((g): g is string => g != null)
        pushEdge(from, exact.nodeId, t, guards.length > 0 ? 'may' : 'must', guards.length > 0 ? 0.6 : 1, guards.length > 0 ? guards.join(',') : null, file)
      } else if (candidates.length > 0) {
        soundiness.push({ kind: 'over-approximation', file, loc: t.loc, detail: `literal target "${t.ti.value}" matched ${candidates.length} parameterized route(s)` })
        for (const c of candidates) pushEdge(from, c.nodeId, t, 'may', 0.5, t.guard ?? 'ambiguous', file)
      } else {
        soundiness.push({ kind: 'unresolved-target', file, loc: t.loc, detail: `literal target "${t.ti.value}" matches no declared route` })
      }
    } else if (t.ti.kind === 'names') {
      const ti = t.ti
      const targets = ti.values.map((n) => nameToPath.get(n)).filter((p): p is string => p != null)
      for (const path of targets) {
        const r = routes.find((x) => x.fullPath === path)
        if (!r) continue
        const guards = [t.guard, ...(guardsByNodeId.get(r.nodeId) ?? [])].filter((g): g is string => g != null)
        const multi = targets.length > 1
        pushEdge(from, r.nodeId, t, multi || guards.length > 0 ? 'may' : 'must', multi || guards.length > 0 ? 0.6 : 1, guards.length > 0 ? guards.join(',') : multi ? 'branch' : null, file)
      }
      if (targets.length > 1) soundiness.push({ kind: 'over-approximation', file, loc: t.loc, detail: `branching named target over-approximated to ${targets.length} route(s)` })
    } else if (t.ti.kind === 'template') {
      const cands = matchPrefix(t.ti.staticPrefix, routeLikes)
      soundiness.push({ kind: 'over-approximation', file, loc: t.loc, detail: `non-literal target prefix "${t.ti.staticPrefix}" over-approximated to ${cands.length} route(s)` })
      for (const c of cands) {
        const guards = [t.guard, ...(guardsByNodeId.get(c.nodeId) ?? [])].filter((g): g is string => g != null)
        pushEdge(from, c.nodeId, t, 'may', 0.5, guards.length > 0 ? guards.join(',') : null, file)
      }
    } else {
      soundiness.push({ kind: 'dynamic-target', file, loc: t.loc, detail: `fully dynamic navigation target (event ${t.event})` })
    }
  }

  for (const route of routes) {
    if (!route.component) {
      if (route.fullPath !== '*') soundiness.push({ kind: 'unresolved-component', detail: `route ${route.fullPath} has no resolvable .vue component` })
      continue
    }
    const file = relative(projectDir, route.component.vuePath)
    const sf = route.component.scriptSf
    const vars = routerVars(sf)
    for (const t of [...templateTargets(route.component, vp.project, nameToPath), ...childTargets(route.component, vp, nameToPath, wrappers), ...navTargetsIn(sf, sf, vars, nameToPath, wrappers)]) {
      resolveTarget(route.nodeId, t, file)
    }
  }

  if (opts.controls) {
    for (const route of routes) {
      if (!route.component) continue
      const file = relative(projectDir, route.component.vuePath)
      const sf = route.component.scriptSf
      const vars = routerVars(sf)
      const controls = parseControls(route.component)

      const nthBySig = new Map<string, number>()
      for (const c of controls) {
        const sig = `${c.selector.strategy}|${c.selector.value}`
        const nth = nthBySig.get(sig) ?? 0
        nthBySig.set(sig, nth + 1)
        if (nth > 0) c.selector.nth = nth
      }

      for (const c of controls) {
        const cId = controlNodeId(route.nodeId, c.selector)
        const navEffects = new Set<string>()
        for (const h of c.handlers) {
          for (const m of handlerModalCloses(h.expr, sf)) {
            pushEdge(cId, route.nodeId, m, m.guard ? 'may' : 'must', m.guard ? 0.6 : 1, m.guard, file)
            navEffects.add('close:modal')
          }
          for (const t of handlerNavTargets(h.expr, sf, vars, nameToPath, wrappers)) {
            const before = edges.length
            resolveTarget(cId, t, file)
            if (edges.length > before) navEffects.add('navigate')
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

  const graph = {
    version: 0 as const,
    meta: {
      adapter: '@ui-graph/adapter-vue',
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
