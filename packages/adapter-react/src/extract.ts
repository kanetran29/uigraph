// React Router static extraction (features F2.2–F2.6). Walks a ts-morph project,
// turns <Route> declarations into nodes and Link/NavLink/Navigate/Redirect +
// useNavigate/useHistory navigations into edges, over-approximating non-literal
// targets over the declared route set and capturing guards as symbolic text.
// Supports react-router v5 and v6. No edge is emitted without a static witness.

import { Node, Project, SyntaxKind, ts } from 'ts-morph'
import type { JsxAttribute, SourceFile } from 'ts-morph'
import { dirname, join, relative } from 'node:path'
import type { ExtractOptions, ExtractResult, GraphEdge, GraphNode, SoundinessNote } from '@uigraph/core'
import { routeToNodeId, edgeId } from './ids'
import { matchLiteral, matchPrefix, type RouteLike } from './matcher'

const ADAPTER_VERSION = '0.1.0'
const DEFAULT_RULESET = 'rr-v5v6-2026.06'

type TargetInfo =
  | { kind: 'literal'; value: string }
  | { kind: 'template'; staticPrefix: string }
  | { kind: 'dynamic' }

interface RouteInfo {
  fullPath: string
  nodeId: string
  componentName: string | null
  componentFile: SourceFile | undefined
}

/** Build a ts-morph project from a project directory, scanning src first. */
export function buildProject(projectDir: string): Project {
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    useInMemoryFileSystem: false,
  })
  project.addSourceFilesAtPaths([`${projectDir}/src/**/*.{ts,tsx,js,jsx}`, `!${projectDir}/**/node_modules/**`])
  if (project.getSourceFiles().length === 0) {
    project.addSourceFilesAtPaths([`${projectDir}/**/*.{ts,tsx,js,jsx}`, `!${projectDir}/**/node_modules/**`])
  }
  return project
}

function isJsxEl(n: Node): boolean {
  return Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n)
}

function jsxTag(el: Node): string {
  if (Node.isJsxElement(el)) return el.getOpeningElement().getTagNameNode().getText()
  if (Node.isJsxSelfClosingElement(el)) return el.getTagNameNode().getText()
  return ''
}

function jsxAttrs(el: Node): JsxAttribute[] {
  const raw = Node.isJsxElement(el) ? el.getOpeningElement().getAttributes() : Node.isJsxSelfClosingElement(el) ? el.getAttributes() : []
  return raw.filter((a): a is JsxAttribute => Node.isJsxAttribute(a))
}

function findAttr(el: Node, name: string): JsxAttribute | undefined {
  return jsxAttrs(el).find((a) => a.getNameNode().getText() === name)
}

function allJsxElements(sf: SourceFile): Node[] {
  return [...sf.getDescendantsOfKind(SyntaxKind.JsxElement), ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]
}

/** A literal/template/dynamic classification of a navigation target expression. */
function classifyTarget(expr: Node | undefined): TargetInfo {
  if (!expr) return { kind: 'dynamic' }
  if (Node.isStringLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isTemplateExpression(expr)) return { kind: 'template', staticPrefix: expr.getHead().getLiteralText() }
  return { kind: 'dynamic' }
}

function classifyToAttr(attr: JsxAttribute | undefined): TargetInfo {
  if (!attr) return { kind: 'dynamic' }
  const init = attr.getInitializer()
  if (!init) return { kind: 'dynamic' }
  if (Node.isStringLiteral(init)) return { kind: 'literal', value: init.getLiteralValue() }
  if (Node.isJsxExpression(init)) return classifyTarget(init.getExpression())
  return { kind: 'dynamic' }
}

function within(container: Node, node: Node): boolean {
  return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd()
}

/** Nearest enclosing guard condition (if / ternary / `&&`) as symbolic text, or null. */
function getGuard(node: Node): string | null {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) return null
    if (Node.isIfStatement(parent)) {
      const cond = parent.getExpression().getText()
      const then = parent.getThenStatement()
      if (then && within(then, node)) return cond
      const els = parent.getElseStatement()
      if (els && within(els, node)) return `!(${cond})`
    } else if (Node.isConditionalExpression(parent)) {
      if (within(parent.getWhenTrue(), node)) return parent.getCondition().getText()
      if (within(parent.getWhenFalse(), node)) return `!(${parent.getCondition().getText()})`
    } else if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getText() === '&&') {
      if (within(parent.getRight(), node)) return parent.getLeft().getText()
    }
    cur = parent
  }
}

function getComponentName(el: Node): string | null {
  const element = findAttr(el, 'element')
  if (element) {
    const init = element.getInitializer()
    if (init && Node.isJsxExpression(init)) {
      const inner = init.getExpression()
      if (inner && isJsxEl(inner)) return jsxTag(inner)
    }
  }
  const component = findAttr(el, 'component')
  if (component) {
    const init = component.getInitializer()
    if (init && Node.isJsxExpression(init)) {
      const inner = init.getExpression()
      if (inner && Node.isIdentifier(inner)) return inner.getText()
    }
  }
  const render = findAttr(el, 'render')
  if (render) {
    const init = render.getInitializer()
    if (init && Node.isJsxExpression(init)) {
      const expr = init.getExpression()
      if (expr) {
        const tag = firstComponentTag(expr)
        if (tag) return tag
      }
    }
  }
  return null
}

/** First capitalized (component) JSX tag inside a node, e.g. the body of a `render` prop. */
function firstComponentTag(node: Node): string | null {
  const candidates = [
    ...node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ...node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
  ].sort((a, b) => a.getStart() - b.getStart())
  for (const c of candidates) {
    const tag = c.getTagNameNode().getText()
    if (/^[A-Z]/.test(tag)) return tag
  }
  return null
}

function ancestorRoutePaths(el: Node): string[] {
  const paths: string[] = []
  let cur = el.getParent()
  while (cur) {
    if (isJsxEl(cur) && jsxTag(cur) === 'Route') {
      const p = stringAttr(cur, 'path')
      if (p !== null) paths.unshift(p)
    }
    cur = cur.getParent()
  }
  return paths
}

function stringAttr(el: Node, name: string): string | null {
  const attr = findAttr(el, name)
  if (!attr) return null
  const init = attr.getInitializer()
  if (!init) return null
  if (Node.isStringLiteral(init)) return init.getLiteralValue()
  if (Node.isJsxExpression(init)) {
    const inner = init.getExpression()
    if (inner && (Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner))) return inner.getLiteralValue()
  }
  return null
}

function joinPath(ancestors: string[], own: string): string {
  if (own === '*' || own === '/*') return '*'
  if (own.startsWith('/')) return own === '/' ? '/' : own.replace(/\/+$/, '') || '/'
  const segs = [...ancestors, own].join('/').split('/').filter(Boolean)
  return '/' + segs.join('/')
}

const RESOLVE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']

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

/** Resolve a route's component identifier to its backing source file. */
function resolveComponentFile(sf: SourceFile, name: string): SourceFile | undefined {
  for (const imp of sf.getImportDeclarations()) {
    const matches =
      imp.getDefaultImport()?.getText() === name ||
      imp.getNamedImports().some((n) => n.getName() === name || n.getAliasNode()?.getText() === name)
    if (!matches) continue
    return imp.getModuleSpecifierSourceFile() ?? resolveRelative(sf, imp.getModuleSpecifierValue())
  }
  return undefined
}

/** Collect <Route> declarations across the project into route nodes. */
function collectRoutes(project: Project): RouteInfo[] {
  const byNodeId = new Map<string, RouteInfo>()
  for (const sf of project.getSourceFiles()) {
    for (const el of allJsxElements(sf)) {
      if (jsxTag(el) !== 'Route') continue
      const ownPath = stringAttr(el, 'path')
      if (ownPath === null) continue
      const fullPath = joinPath(ancestorRoutePaths(el), ownPath)
      const nodeId = routeToNodeId(fullPath)
      if (byNodeId.has(nodeId)) continue
      const componentName = getComponentName(el)
      const componentFile = componentName ? resolveComponentFile(sf, componentName) : undefined
      byNodeId.set(nodeId, { fullPath, nodeId, componentName, componentFile })
    }
  }
  return [...byNodeId.values()]
}

function navIdentifiers(sf: SourceFile): { navSet: Set<string>; histSet: Set<string> } {
  const navSet = new Set<string>()
  const histSet = new Set<string>()
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer()
    if (!init || !Node.isCallExpression(init)) continue
    const callee = init.getExpression()
    if (!Node.isIdentifier(callee)) continue
    const name = vd.getNameNode().getText()
    if (callee.getText() === 'useNavigate') navSet.add(name)
    if (callee.getText() === 'useHistory') histSet.add(name)
  }
  return { navSet, histSet }
}

interface RawTarget {
  ti: TargetInfo
  event: string
  effect: string
  node: Node
  guard: string | null
}

function collectTargets(sf: SourceFile): RawTarget[] {
  const out: RawTarget[] = []
  for (const el of allJsxElements(sf)) {
    const tag = jsxTag(el)
    let event: string | null = null
    let effect = 'navigate'
    if (tag === 'Link' || tag === 'NavLink') {
      event = 'click:Link'
      effect = 'navigate'
    } else if (tag === 'Navigate' || tag === 'Redirect') {
      event = 'redirect'
      effect = 'redirect'
    }
    if (event === null) continue
    out.push({ ti: classifyToAttr(findAttr(el, 'to')), event, effect, node: el, guard: getGuard(el) })
  }

  const { navSet, histSet } = navIdentifiers(sf)
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    let effect: string | null = null
    if (Node.isIdentifier(expr) && navSet.has(expr.getText())) {
      effect = 'navigate'
    } else if (Node.isPropertyAccessExpression(expr)) {
      const obj = expr.getExpression()
      const member = expr.getName()
      if (Node.isIdentifier(obj) && histSet.has(obj.getText()) && (member === 'push' || member === 'replace')) {
        effect = `history.${member}`
      }
    }
    if (effect === null) continue
    const arg0 = call.getArguments()[0]
    out.push({ ti: classifyTarget(arg0), event: 'navigate', effect, node: call, guard: getGuard(call) })
  }
  return out
}

function ruleIdFor(event: string, effect: string): string {
  if (event === 'click:Link') return 'rr.link-to'
  if (event === 'redirect') return 'rr.redirect'
  if (effect.startsWith('history.')) return 'rr.use-history-push'
  return 'rr.use-navigate'
}

/** Extract a graph from an already-built ts-morph project (testable in memory). */
export function extractGraph(project: Project, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  const routes = collectRoutes(project)
  const routeLikes: RouteLike[] = routes.map((r) => ({ fullPath: r.fullPath, nodeId: r.nodeId }))

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

  function pushEdge(from: string, to: string, t: RawTarget, modality: 'must' | 'may', confidence: number, file: string, loc: { line: number; col: number }): void {
    const id = edgeId(from, to, t.event, t.guard)
    if (seen.has(id)) return
    seen.add(id)
    edges.push({
      id,
      from,
      to,
      event: t.event,
      guard: t.guard,
      effect: t.effect,
      modality,
      source: 'static',
      confidence,
      witness: { source: 'static', file, loc, ruleId: ruleIdFor(t.event, t.effect) },
    })
  }

  for (const route of routes) {
    if (!route.componentFile) {
      soundiness.push({ kind: 'unresolved-component', detail: `route ${route.fullPath} has no resolvable component file` })
      continue
    }
    const file = relative(projectDir, route.componentFile.getFilePath())
    for (const t of collectTargets(route.componentFile)) {
      const sf = t.node.getSourceFile()
      const lc = sf.getLineAndColumnAtPos(t.node.getStart())
      const loc = { line: lc.line, col: lc.column }
      if (t.ti.kind === 'literal') {
        const target = matchLiteral(t.ti.value, routeLikes)
        if (!target) {
          soundiness.push({ kind: 'unresolved-target', file, loc, detail: `literal target "${t.ti.value}" matches no declared route` })
          continue
        }
        const guarded = t.guard !== null
        pushEdge(route.nodeId, target.nodeId, t, guarded ? 'may' : 'must', guarded ? 0.6 : 1, file, loc)
      } else if (t.ti.kind === 'template') {
        const cands = matchPrefix(t.ti.staticPrefix, routeLikes)
        soundiness.push({ kind: 'over-approximation', file, loc, detail: `non-literal target prefix "${t.ti.staticPrefix}" over-approximated to ${cands.length} route(s)` })
        for (const cand of cands) pushEdge(route.nodeId, cand.nodeId, t, 'may', 0.5, file, loc)
      } else {
        soundiness.push({ kind: 'dynamic-target', file, loc, detail: `fully dynamic navigation target (event ${t.event})` })
      }
    }
  }

  const graph = {
    version: 0 as const,
    meta: {
      adapter: '@uigraph/adapter-react',
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
