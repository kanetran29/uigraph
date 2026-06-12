// Angular Router static extraction (milestone M3). Walks a ts-morph project,
// turns a `Routes` array (path/component/canActivate, incl. nested paths) into
// nodes, and turns each route component's inline `@Component` template
// (routerLink / [routerLink]) plus `Router.navigate` / `Router.navigateByUrl`
// calls into edges. Non-literal targets are over-approximated over the declared
// route set; canActivate guard class names become symbolic guard text. No edge
// is emitted without a static witness.

import { Node, Project, SyntaxKind, ts } from 'ts-morph'
import type { ObjectLiteralExpression, SourceFile } from 'ts-morph'
import { dirname, join, relative } from 'node:path'
import type { ExtractOptions, ExtractResult, GraphEdge, GraphNode, SoundinessNote } from '@uigraph/core'
import { routeToNodeId, edgeId } from './ids'
import { matchLiteral, matchPrefix, type RouteLike } from './matcher'

const ADAPTER_VERSION = '0.1.0'
const DEFAULT_RULESET = 'ng-v0-2026.06'

type TargetInfo =
  | { kind: 'literal'; value: string }
  | { kind: 'template'; staticPrefix: string }
  | { kind: 'dynamic' }

interface RouteInfo {
  fullPath: string
  nodeId: string
  componentName: string | null
  componentFile: SourceFile | undefined
  guards: string[]
}

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

const RESOLVE_EXTS = ['.ts', '.js', '/index.ts', '/index.js']

/** Resolve a relative import specifier to an in-project source file by trying extensions. */
function resolveRelative(sf: SourceFile, specifier: string): SourceFile | undefined {
  if (!specifier.startsWith('.')) return undefined
  const project = sf.getProject()
  const base = join(dirname(sf.getFilePath()), specifier)
  for (const ext of RESOLVE_EXTS) {
    const found = project.getSourceFile(base + ext)
    if (found) return found
  }
  return undefined
}

/** Resolve a component/guard identifier to its backing source file via imports. */
function resolveImportedFile(sf: SourceFile, name: string): SourceFile | undefined {
  for (const imp of sf.getImportDeclarations()) {
    const matches =
      imp.getDefaultImport()?.getText() === name ||
      imp.getNamedImports().some((n) => n.getName() === name || n.getAliasNode()?.getText() === name)
    if (!matches) continue
    return imp.getModuleSpecifierSourceFile() ?? resolveRelative(sf, imp.getModuleSpecifierValue())
  }
  return undefined
}

/** Normalize a declared route path to a leading-slash route ('' -> '/', '**' -> '*'). */
function normalizeRoutePath(own: string): string {
  if (own === '**' || own === '*' || own === '/*') return '*'
  if (own === '') return '/'
  const segs = own.split('/').filter(Boolean)
  return '/' + segs.join('/')
}

/** Read a string-literal property value from a route object literal, or null. */
function stringProp(obj: ObjectLiteralExpression, name: string): string | null {
  const prop = obj.getProperty(name)
  if (!prop || !Node.isPropertyAssignment(prop)) return null
  const init = prop.getInitializer()
  if (!init) return null
  if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) return init.getLiteralValue()
  return null
}

/** Read an identifier property value (e.g. `component: HomeComponent`), or null. */
function identifierProp(obj: ObjectLiteralExpression, name: string): string | null {
  const prop = obj.getProperty(name)
  if (!prop || !Node.isPropertyAssignment(prop)) return null
  const init = prop.getInitializer()
  if (init && Node.isIdentifier(init)) return init.getText()
  return null
}

/** Read the guard class names from a `canActivate: [A, B]` array property. */
function canActivateGuards(obj: ObjectLiteralExpression): string[] {
  const prop = obj.getProperty('canActivate')
  if (!prop || !Node.isPropertyAssignment(prop)) return []
  const init = prop.getInitializer()
  if (!init || !Node.isArrayLiteralExpression(init)) return []
  const names: string[] = []
  for (const el of init.getElements()) {
    if (Node.isIdentifier(el)) names.push(el.getText())
  }
  return names
}

/**
 * Find every object literal that is an element of a declared `Routes` array
 * (`const routes: Routes = [ {...}, ... ]`) across the project. Returns the
 * route object literals paired with the source file declaring them.
 */
function findRouteObjects(project: Project): { obj: ObjectLiteralExpression; sf: SourceFile }[] {
  const out: { obj: ObjectLiteralExpression; sf: SourceFile }[] = []
  for (const sf of project.getSourceFiles()) {
    for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const typeNode = vd.getTypeNode()
      const isRoutesTyped = typeNode?.getText() === 'Routes'
      const init = vd.getInitializer()
      if (!init || !Node.isArrayLiteralExpression(init)) continue
      const looksLikeRoutes = isRoutesTyped || init.getElements().some((e) => Node.isObjectLiteralExpression(e) && e.getProperty('path') !== undefined)
      if (!looksLikeRoutes) continue
      for (const el of init.getElements()) {
        if (Node.isObjectLiteralExpression(el)) out.push({ obj: el, sf })
      }
    }
  }
  return out
}

/** Collect declared routes into route nodes, resolving components and guards. */
function collectRoutes(project: Project): RouteInfo[] {
  const byNodeId = new Map<string, RouteInfo>()
  for (const { obj, sf } of findRouteObjects(project)) {
    const ownPath = stringProp(obj, 'path')
    if (ownPath === null) continue
    const fullPath = normalizeRoutePath(ownPath)
    const nodeId = routeToNodeId(fullPath)
    if (byNodeId.has(nodeId)) continue
    const componentName = identifierProp(obj, 'component')
    const componentFile = componentName ? resolveImportedFile(sf, componentName) : undefined
    byNodeId.set(nodeId, { fullPath, nodeId, componentName, componentFile, guards: canActivateGuards(obj) })
  }
  return [...byNodeId.values()]
}

/** Classify a navigation argument expression as literal / template-prefix / dynamic. */
function classifyTarget(expr: Node | undefined): TargetInfo {
  if (!expr) return { kind: 'dynamic' }
  if (Node.isStringLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isTemplateExpression(expr)) return { kind: 'template', staticPrefix: expr.getHead().getLiteralText() }
  if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === '+') {
    const left = expr.getLeft()
    if (Node.isStringLiteral(left) || Node.isNoSubstitutionTemplateLiteral(left)) {
      return { kind: 'template', staticPrefix: left.getLiteralValue() }
    }
  }
  return { kind: 'dynamic' }
}

/** Read the inline template string from a component's `@Component({ template })` decorator. */
function inlineTemplate(sf: SourceFile): { text: string; start: number } | null {
  for (const cls of sf.getClasses()) {
    for (const dec of cls.getDecorators()) {
      if (dec.getName() !== 'Component') continue
      const arg = dec.getArguments()[0]
      if (!arg || !Node.isObjectLiteralExpression(arg)) continue
      const prop = arg.getProperty('template')
      if (!prop || !Node.isPropertyAssignment(prop)) continue
      const init = prop.getInitializer()
      if (!init) continue
      if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) {
        return { text: init.getLiteralValue(), start: init.getStart() }
      }
    }
  }
  return null
}

interface RawTarget {
  ti: TargetInfo
  event: string
  effect: string
  ruleId: string
  loc: { line: number; col: number }
}

const STATIC_LINK_RE = /(?<!\[)\brouterLink\s*=\s*"([^"]*)"/g
const BOUND_LINK_RE = /\[routerLink\]\s*=\s*"([^"]*)"/g

/** Parse routerLink / [routerLink] attributes out of an inline template string. */
function templateTargets(sf: SourceFile): RawTarget[] {
  const tpl = inlineTemplate(sf)
  if (!tpl) return []
  const out: RawTarget[] = []
  for (const m of tpl.text.matchAll(STATIC_LINK_RE)) {
    const value = m[1] ?? ''
    const lc = sf.getLineAndColumnAtPos(tpl.start)
    out.push({ ti: { kind: 'literal', value }, event: 'click:routerLink', effect: 'navigate', ruleId: 'ng.router-link', loc: { line: lc.line, col: lc.column } })
  }
  for (const m of tpl.text.matchAll(BOUND_LINK_RE)) {
    const expr = m[1] ?? ''
    const lc = sf.getLineAndColumnAtPos(tpl.start)
    out.push({ ti: classifyBoundLink(expr), event: 'click:routerLink', effect: 'navigate', ruleId: 'ng.router-link', loc: { line: lc.line, col: lc.column } })
  }
  return out
}

/** Classify a bound [routerLink] expression's textual value: "'/x/' + id" -> prefix "/x/". */
function classifyBoundLink(expr: string): TargetInfo {
  const trimmed = expr.trim()
  const literalOnly = /^'([^']*)'$/.exec(trimmed) ?? /^"([^"]*)"$/.exec(trimmed)
  if (literalOnly) return { kind: 'literal', value: literalOnly[1] ?? '' }
  const concatPrefix = /^'([^']*)'\s*\+/.exec(trimmed) ?? /^"([^"]*)"\s*\+/.exec(trimmed)
  if (concatPrefix) return { kind: 'template', staticPrefix: concatPrefix[1] ?? '' }
  return { kind: 'dynamic' }
}

/** Parse `this.router.navigate([...])` and `this.router.navigateByUrl(...)` calls. */
function routerCallTargets(sf: SourceFile): RawTarget[] {
  const out: RawTarget[] = []
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (!Node.isPropertyAccessExpression(expr)) continue
    const member = expr.getName()
    if (member !== 'navigate' && member !== 'navigateByUrl') continue
    const lc = sf.getLineAndColumnAtPos(call.getStart())
    const loc = { line: lc.line, col: lc.column }
    if (member === 'navigateByUrl') {
      const arg0 = call.getArguments()[0]
      out.push({ ti: classifyTarget(arg0), event: 'navigate', effect: 'router.navigateByUrl', ruleId: 'ng.navigate-by-url', loc })
    } else {
      const arg0 = call.getArguments()[0]
      const first = arg0 && Node.isArrayLiteralExpression(arg0) ? arg0.getElements()[0] : undefined
      out.push({ ti: classifyTarget(first), event: 'navigate', effect: 'router.navigate', ruleId: 'ng.navigate', loc })
    }
  }
  return out
}

/** Extract a graph from an already-built ts-morph project (testable in memory). */
export function extractGraph(project: Project, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  const routes = collectRoutes(project)
  const routeLikes: RouteLike[] = routes.map((r) => ({ fullPath: r.fullPath, nodeId: r.nodeId }))
  const guardsByNodeId = new Map(routes.map((r) => [r.nodeId, r.guards]))

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
      witness: { source: 'static', file, loc: t.loc, ruleId: t.ruleId },
    })
  }

  for (const route of routes) {
    if (!route.componentFile) {
      soundiness.push({ kind: 'unresolved-component', detail: `route ${route.fullPath} has no resolvable component file` })
      continue
    }
    const file = relative(projectDir, route.componentFile.getFilePath())
    const targets = [...templateTargets(route.componentFile), ...routerCallTargets(route.componentFile)]
    for (const t of targets) {
      if (t.ti.kind === 'literal') {
        const target = matchLiteral(t.ti.value, routeLikes)
        if (!target) {
          soundiness.push({ kind: 'unresolved-target', file, loc: t.loc, detail: `literal target "${t.ti.value}" matches no declared route` })
          continue
        }
        const targetGuards = guardsByNodeId.get(target.nodeId) ?? []
        const guarded = targetGuards.length > 0
        const guardText = guarded ? targetGuards.join(',') : null
        pushEdge(route.nodeId, target.nodeId, t, guarded ? 'may' : 'must', guarded ? 0.6 : 1, guardText, file)
      } else if (t.ti.kind === 'template') {
        const cands = matchPrefix(t.ti.staticPrefix, routeLikes)
        soundiness.push({ kind: 'over-approximation', file, loc: t.loc, detail: `non-literal target prefix "${t.ti.staticPrefix}" over-approximated to ${cands.length} route(s)` })
        for (const cand of cands) {
          const candGuards = guardsByNodeId.get(cand.nodeId) ?? []
          const guardText = candGuards.length > 0 ? candGuards.join(',') : null
          pushEdge(route.nodeId, cand.nodeId, t, 'may', 0.5, guardText, file)
        }
      } else {
        soundiness.push({ kind: 'dynamic-target', file, loc: t.loc, detail: `fully dynamic navigation target (event ${t.event})` })
      }
    }
  }

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
