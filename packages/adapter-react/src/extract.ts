// React Router static extraction (features F2.2–F2.6). Walks a ts-morph project,
// turns <Route> declarations into nodes and Link/NavLink/Navigate/Redirect +
// useNavigate/useHistory navigations into edges, over-approximating non-literal
// targets over the declared route set and capturing guards as symbolic text.
// Supports react-router v5 and v6. No edge is emitted without a static witness.

import { Node, Project, SyntaxKind, ts } from 'ts-morph'
import type { JsxAttribute, SourceFile } from 'ts-morph'
import { dirname, join, relative } from 'node:path'
import type { ExtractOptions, ExtractResult, GraphEdge, GraphNode, Modality, SoundinessNote } from '@uigraph/core'
import { routeToNodeId, edgeId } from './ids'
import { matchLiteralAll, matchPrefix, type RouteLike } from './matcher'

const ADAPTER_VERSION = '0.1.0'
const DEFAULT_RULESET = 'rr-v5v6-2026.06'

type TargetInfo =
  | { kind: 'literal'; value: string }
  | { kind: 'template'; staticPrefix: string }
  | { kind: 'dynamic'; expr?: string }

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
  return { kind: 'dynamic', expr: expr.getText() }
}

function classifyToAttr(attr: JsxAttribute | undefined): TargetInfo {
  if (!attr) return { kind: 'dynamic' }
  const init = attr.getInitializer()
  if (!init) return { kind: 'dynamic' }
  if (Node.isStringLiteral(init)) return { kind: 'literal', value: init.getLiteralValue() }
  if (Node.isJsxExpression(init)) return classifyTarget(init.getExpression())
  return { kind: 'dynamic', expr: init.getText() }
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

const ITERATION_METHODS = /^(map|forEach|filter|reduce|find|some|every|flatMap)$/

/**
 * A non-dominance condition that makes a programmatic navigation NOT unconditional
 * (so it must be a `may`-edge, never a proven `must`): an enclosing loop, switch
 * case, catch, or array-iteration callback, or a preceding early-return/throw
 * guard in the same block. Complements getGuard (if/ternary/&&) — together they
 * close the phantom-`must` gap where only nearest-enclosing-syntax was checked.
 */
function extraConditionGuard(node: Node): string | null {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) break
    if (
      Node.isForStatement(parent) ||
      Node.isForOfStatement(parent) ||
      Node.isForInStatement(parent) ||
      Node.isWhileStatement(parent) ||
      Node.isDoStatement(parent)
    ) {
      return 'loop'
    }
    if (Node.isCaseClause(parent) || Node.isDefaultClause(parent)) return 'switch-case'
    if (Node.isCatchClause(parent)) return 'catch'
    if ((Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) && Node.isCallExpression(parent)) {
      const callee = parent.getExpression()
      if (Node.isPropertyAccessExpression(callee) && ITERATION_METHODS.test(callee.getName())) return 'iteration'
      break
    }
    cur = parent
  }
  return earlyReturnGuard(node)
}

/**
 * If a statement earlier in the same block guards exit with `if (cond) return`
 * (or `throw`), a later navigation is reached only when `!(cond)` — so it is
 * conditional. Returns that negated guard, or null.
 */
function earlyReturnGuard(node: Node): string | null {
  const stmt = node.getFirstAncestor((a) => Node.isStatement(a) && Node.isBlock(a.getParent()))
  if (!stmt) return null
  const block = stmt.getParent()
  if (!block || !Node.isBlock(block)) return null
  for (const sibling of block.getStatements()) {
    if (sibling.getStart() >= stmt.getStart()) break
    if (!Node.isIfStatement(sibling) || sibling.getElseStatement()) continue
    const then = sibling.getThenStatement()
    const exits =
      then.getDescendantsOfKind(SyntaxKind.ReturnStatement).length > 0 ||
      then.getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0 ||
      Node.isReturnStatement(then) ||
      Node.isThrowStatement(then)
    if (exits) return `!(${sibling.getExpression().getText()})`
  }
  return null
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
  ruleId?: string
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
    out.push({ ti: classifyTarget(arg0), event: 'navigate', effect, node: call, guard: getGuard(call) ?? extraConditionGuard(call) })
  }
  return out
}

function ruleIdFor(event: string, effect: string): string {
  if (event === 'click:Link') return 'rr.link-to'
  if (event === 'redirect') return 'rr.redirect'
  if (effect.startsWith('history.')) return 'rr.use-history-push'
  return 'rr.use-navigate'
}

interface ControlInfo {
  element: string
  controlType: string
  name?: string
}

type BranchContext = 'success' | 'error' | null

interface NavCall {
  ti: TargetInfo
  guard: string | null
  node: Node
  ctx: BranchContext
  interprocedural?: boolean
}

/** Visible text inside a JSX element (e.g. a button's label), or undefined. */
function getJsxText(el: Node): string | undefined {
  if (!Node.isJsxElement(el)) return undefined
  const txt = el
    .getDescendantsOfKind(SyntaxKind.JsxText)
    .map((t) => t.getText())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return txt.length > 0 ? txt : undefined
}

function inputControlType(el: Node): string {
  const t = (stringAttr(el, 'type') ?? 'text').toLowerCase()
  if (t === 'checkbox' || t === 'radio') return 'checkbox'
  if (t === 'submit' || t === 'button') return 'button'
  if (t === 'file') return 'file'
  return 'input'
}

/** Does an element carry any React `on*` event handler attribute? */
function hasEventHandler(el: Node): boolean {
  return jsxAttrs(el).some((a) => /^on[A-Z]/.test(a.getNameNode().getText()))
}

/**
 * Classify an interactive JSX element as a control, or null if it is not one. A
 * control is a native form element (button/input/textarea/select/form),
 * contentEditable, or ANY lowercase DOM element carrying an `on*` handler (so a
 * `<div onMouseEnter>` or `<li onKeyDown>` counts too).
 */
function controlMetaFor(el: Node): ControlInfo | null {
  const tag = jsxTag(el)
  const lower = tag.toLowerCase()
  let controlType: string | null = null
  if (lower === 'button') controlType = 'button'
  else if (lower === 'input') controlType = inputControlType(el)
  else if (lower === 'textarea') controlType = 'richtext'
  else if (lower === 'select') controlType = 'select'
  else if (lower === 'form') controlType = 'form'
  else if (findAttr(el, 'contentEditable') || findAttr(el, 'contenteditable')) controlType = 'richtext'
  else if (/^[a-z]/.test(tag) && hasEventHandler(el)) controlType = 'element'
  else return null
  const textLabel = controlType === 'button' || controlType === 'element' ? getJsxText(el) : undefined
  const name =
    stringAttr(el, 'name') ?? stringAttr(el, 'id') ?? stringAttr(el, 'placeholder') ?? stringAttr(el, 'aria-label') ?? textLabel
  return { element: tag, controlType, ...(name ? { name } : {}) }
}

/** Find the named function/arrow declared in a file (for indirect event handlers). */
function resolveFunctionNode(sf: SourceFile, name: string): Node | undefined {
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (vd.getNameNode().getText() !== name) continue
    const init = vd.getInitializer()
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init
  }
  for (const fd of sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    if (fd.getName() === name) return fd
  }
  return undefined
}

/** React `onXxx` attribute name → DOM event name (e.g. onMouseEnter -> mouseenter). */
function eventNameOf(attrName: string): string {
  return attrName.slice(2).toLowerCase()
}

/** Resolve a single handler attribute's value to its function node. */
function handlerFnFromAttr(attr: JsxAttribute, sf: SourceFile): Node | undefined {
  const init = attr.getInitializer()
  if (!init || !Node.isJsxExpression(init)) return undefined
  const expr = init.getExpression()
  if (!expr) return undefined
  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) return expr
  if (Node.isIdentifier(expr)) return resolveFunctionNode(sf, expr.getText())
  return undefined
}

interface Interaction {
  event: string
  ti: TargetInfo
  guard: string | null
  node: Node
  ctx: BranchContext
  interprocedural?: boolean
}

/**
 * Collect every event handler on a control: the distinct DOM events it listens
 * to, the navigations each handler performs (tagged with the triggering event),
 * and the non-navigational effects.
 */
function collectInteractions(
  el: Node,
  sf: SourceFile,
  navInfo: { navSet: Set<string>; histSet: Set<string> },
): { events: string[]; navs: Interaction[]; effects: string[] } {
  const events = new Set<string>()
  const navs: Interaction[] = []
  const effects = new Set<string>()
  for (const attr of jsxAttrs(el)) {
    const an = attr.getNameNode().getText()
    if (!/^on[A-Z]/.test(an)) continue
    const ev = eventNameOf(an)
    events.add(ev)
    const fn = handlerFnFromAttr(attr, sf)
    if (!fn) continue
    const a = analyzeHandler(fn, navInfo, sf)
    for (const nc of a.navCalls) navs.push({ event: ev, ti: nc.ti, guard: nc.guard, node: nc.node, ctx: nc.ctx, interprocedural: nc.interprocedural })
    for (const e of a.effects) effects.add(e)
  }
  return { events: [...events], navs, effects: [...effects] }
}

function literalOf(node: Node | undefined): string {
  if (!node) return '?'
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue()
  if (Node.isTemplateExpression(node)) return node.getHead().getLiteralText() + '…'
  return '?'
}

function methodFromFetchOpts(node: Node | undefined): string {
  if (!node || !Node.isObjectLiteralExpression(node)) return 'GET'
  const prop = node.getProperty('method')
  if (prop && Node.isPropertyAssignment(prop)) {
    const v = prop.getInitializer()
    if (v && (Node.isStringLiteral(v) || Node.isNoSubstitutionTemplateLiteral(v))) return v.getLiteralValue().toUpperCase()
  }
  return 'GET'
}

/** A network call effect like "api:POST /orders", or null. */
function detectApiEffect(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null
  const expr = call.getExpression()
  if (Node.isIdentifier(expr) && expr.getText() === 'fetch') {
    return `api:${methodFromFetchOpts(call.getArguments()[1])} ${literalOf(call.getArguments()[0])}`
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const m = expr.getName().toLowerCase()
    if (['post', 'get', 'put', 'delete', 'patch'].includes(m) && /axios|api|http|client|request/i.test(expr.getExpression().getText())) {
      return `api:${m.toUpperCase()} ${literalOf(call.getArguments()[0])}`
    }
  }
  return null
}

/** A state-mutation effect like "state:setCart", or null. */
function detectStateEffect(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null
  const expr = call.getExpression()
  if (Node.isIdentifier(expr)) {
    const n = expr.getText()
    if (/^set[A-Z]/.test(n)) return `state:${n}`
    if (n === 'dispatch') return 'state:dispatch'
  }
  return null
}

/** A modal-opening setter like setShowConfirm(true)/setOpen(true), or null. */
function detectModalOpen(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null
  const expr = call.getExpression()
  if (!Node.isIdentifier(expr)) return null
  if (!/^set(Show|Open|Visible|Modal|Dialog|Drawer|Popover|Sheet)/i.test(expr.getText())) return null
  const arg = call.getArguments()[0]
  if (arg && arg.getText() === 'true') return 'open:modal'
  return null
}

/**
 * Whether a screen embeds a third-party map/canvas widget whose gestures
 * (zoom/pan/drag) are runtime-only — detected by import specifier or component tag.
 * Such interactions are NOT statically modelable; we record a soundiness note
 * rather than invent transitions.
 */
function detectDynamicWidget(sf: SourceFile): boolean {
  for (const imp of sf.getImportDeclarations()) {
    if (/mapbox|leaflet|google-?maps|react-map-gl|maplibre|@react-google-maps/i.test(imp.getModuleSpecifierValue())) return true
  }
  for (const el of allJsxElements(sf)) {
    if (/^(Map|MapView|MapContainer|MapGL|GoogleMap|MapboxMap|LeafletMap)$/.test(jsxTag(el))) return true
  }
  return false
}

/** Whether a call writes an error-ish state (setError/setErr or a state set in an error branch). */
function isErrorSetter(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false
  const expr = call.getExpression()
  return Node.isIdentifier(expr) && /^set(Error|Err|Failure|Failed)/i.test(expr.getText())
}

/**
 * Classify a node as being on the success or error branch of an async flow:
 * inside a catch clause / `.catch()` / error `if`-branch is "error"; inside a try
 * block / `.then()` success arg / ok `if`-branch is "success".
 */
function branchContextOf(node: Node): BranchContext {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) return null
    if (Node.isCatchClause(parent)) return 'error'
    if (Node.isTryStatement(parent)) {
      const tryBlock = parent.getTryBlock()
      if (tryBlock && within(tryBlock, node)) return 'success'
    }
    if ((Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) && Node.isCallExpression(parent)) {
      const callee = parent.getExpression()
      if (Node.isPropertyAccessExpression(callee)) {
        const m = callee.getName()
        if (m === 'catch') return 'error'
        if (m === 'then') {
          const args = parent.getArguments()
          if (args[1] === cur) return 'error'
          if (args[0] === cur) return 'success'
        }
      }
    }
    if (Node.isIfStatement(parent)) {
      const cond = parent.getExpression().getText()
      const errCond = /!|error|fail|catch/i.test(cond)
      const then = parent.getThenStatement()
      const els = parent.getElseStatement()
      if (then && within(then, node)) return errCond ? 'error' : 'success'
      if (els && within(els, node)) return errCond ? 'success' : 'error'
    }
    cur = parent
  }
}

const MAX_CALL_DEPTH = 5

/**
 * A lexical scope for the interprocedural walk: which identifiers resolve to a
 * navigate/history function here (by closure or parameter binding), and what each
 * parameter was bound to, so a route passed as an argument can be resolved to its
 * literal at the sink.
 */
interface Scope {
  navSet: Set<string>
  histSet: Set<string>
  bindings: Map<string, Node>
}

/** Parameter names of a function-like node, or [] when it is not function-like. */
function fnParams(fn: Node): string[] {
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    return fn.getParameters().map((p) => p.getNameNode().getText())
  }
  return []
}

/** Find a project-local function exported as `default` (only direct declarations). */
function resolveDefaultFunction(sf: SourceFile): Node | undefined {
  for (const fd of sf.getFunctions()) {
    if (fd.isDefaultExport()) return fd
  }
  return undefined
}

/** Resolve a named/default import of `name` in `sf` to its function node — relative modules only. */
function resolveImportedFunction(sf: SourceFile, name: string): Node | undefined {
  for (const imp of sf.getImportDeclarations()) {
    if (!imp.getModuleSpecifierValue().startsWith('.')) continue
    for (const ni of imp.getNamedImports()) {
      const alias = ni.getAliasNode()?.getText() ?? ni.getNameNode().getText()
      if (alias !== name) continue
      const target = imp.getModuleSpecifierSourceFile() ?? resolveRelative(sf, imp.getModuleSpecifierValue())
      return target ? resolveFunctionNode(target, ni.getNameNode().getText()) : undefined
    }
    if (imp.getDefaultImport()?.getText() === name) {
      const target = imp.getModuleSpecifierSourceFile() ?? resolveRelative(sf, imp.getModuleSpecifierValue())
      return target ? resolveDefaultFunction(target) : undefined
    }
  }
  return undefined
}

/**
 * Resolve a CallExpression's callee to a user-defined function node inside the
 * project: a locally declared function/arrow, or a named/default import resolved
 * via the relative-module resolver. Returns undefined for library calls
 * (non-relative imports) and unresolved symbols, so the walk never leaves app code.
 */
function resolveCallee(call: Node, sf: SourceFile): Node | undefined {
  if (!Node.isCallExpression(call)) return undefined
  const expr = call.getExpression()
  if (!Node.isIdentifier(expr)) return undefined
  const name = expr.getText()
  return resolveFunctionNode(sf, name) ?? resolveImportedFunction(sf, name)
}

/** Conjoin two symbolic guards; either may be null. Identical guards collapse. */
function combineGuard(a: string | null, b: string | null): string | null {
  if (a !== null && b !== null) return a === b ? a : `${a} && ${b}`
  return a ?? b
}

/**
 * The callee's scope when entered from `call`: the callee file's own nav/history
 * identifiers (closures), plus parameters bound to nav/history arguments, plus a
 * binding of each parameter to its argument node (for literal target resolution).
 */
function deriveScope(callee: Node, call: Node, caller: Scope): Scope {
  const own = navIdentifiers(callee.getSourceFile())
  const navSet = new Set(own.navSet)
  const histSet = new Set(own.histSet)
  const bindings = new Map<string, Node>()
  const args = Node.isCallExpression(call) ? call.getArguments() : []
  fnParams(callee).forEach((pname, i) => {
    const arg = args[i]
    if (!arg) return
    if (Node.isIdentifier(arg)) {
      const an = arg.getText()
      if (caller.navSet.has(an)) navSet.add(pname)
      if (caller.histSet.has(an)) histSet.add(pname)
      bindings.set(pname, caller.bindings.get(an) ?? arg)
    } else {
      bindings.set(pname, arg)
    }
  })
  return { navSet, histSet, bindings }
}

/** Follow parameter bindings (a few hops) so an identifier target resolves to the literal passed in. */
function resolveArgForTarget(arg: Node | undefined, scope: Scope): Node | undefined {
  let cur = arg
  for (let i = 0; i < MAX_CALL_DEPTH && cur && Node.isIdentifier(cur); i++) {
    const next = scope.bindings.get(cur.getText())
    if (!next || next === cur) break
    cur = next
  }
  return cur
}

/**
 * Walk a function body for navigation sinks and effects, recursing into reachable
 * user-defined callees (the call graph). Navs found below the entry function are
 * tagged interprocedural; guards on the call path are conjoined onto each sink. A
 * visited set + depth cap bound cycles and blow-up.
 */
function walkReachable(
  fn: Node,
  sf: SourceFile,
  scope: Scope,
  pathGuard: string | null,
  visited: Set<Node>,
  depth: number,
  out: { navCalls: NavCall[]; effects: Set<string> },
): void {
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    const guard = combineGuard(pathGuard, getGuard(call) ?? extraConditionGuard(call))
    if (Node.isIdentifier(expr) && scope.navSet.has(expr.getText())) {
      out.navCalls.push({ ti: classifyTarget(resolveArgForTarget(call.getArguments()[0], scope)), guard, node: call, ctx: branchContextOf(call), interprocedural: depth > 0 })
      continue
    }
    if (Node.isPropertyAccessExpression(expr)) {
      const obj = expr.getExpression()
      const m = expr.getName()
      if (Node.isIdentifier(obj) && scope.histSet.has(obj.getText()) && (m === 'push' || m === 'replace')) {
        out.navCalls.push({ ti: classifyTarget(resolveArgForTarget(call.getArguments()[0], scope)), guard, node: call, ctx: branchContextOf(call), interprocedural: depth > 0 })
        continue
      }
    }
    const api = detectApiEffect(call)
    if (api) {
      out.effects.add(api)
      continue
    }
    const modal = detectModalOpen(call)
    if (modal) {
      out.effects.add(modal)
      continue
    }
    const st = detectStateEffect(call)
    if (st) {
      const errorBranch = isErrorSetter(call) || branchContextOf(call) === 'error'
      out.effects.add(errorBranch ? st.replace('state:', 'error:') : st)
      continue
    }
    if (depth < MAX_CALL_DEPTH) {
      const callee = resolveCallee(call, sf)
      if (callee && !visited.has(callee)) {
        visited.add(callee)
        walkReachable(callee, callee.getSourceFile(), deriveScope(callee, call, scope), guard, visited, depth + 1, out)
      }
    }
  }
}

/** Analyze a handler for navigations and effects across the reachable call graph. */
function analyzeHandler(fnNode: Node, navInfo: { navSet: Set<string>; histSet: Set<string> }, sf: SourceFile): { navCalls: NavCall[]; effects: string[] } {
  const out = { navCalls: [] as NavCall[], effects: new Set<string>() }
  const scope: Scope = { navSet: new Set(navInfo.navSet), histSet: new Set(navInfo.histSet), bindings: new Map() }
  walkReachable(fnNode, sf, scope, null, new Set<Node>([fnNode]), 0, out)
  return { navCalls: out.navCalls, effects: [...out.effects] }
}

/** Extract a graph from an already-built ts-morph project (testable in memory). */
export function extractGraph(project: Project, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  const routes = collectRoutes(project)
  const routeLikes: RouteLike[] = routes.map((r) => ({ fullPath: r.fullPath, nodeId: r.nodeId }))

  // Disambiguate labels: a component backing exactly one route reads best by its
  // name (Home, Checkout); a component shared across many routes (a map/SPA shell
  // like AppContent rendered by /, /explore, /could-buy…) would label every node
  // identically, so those nodes label by their route instead.
  const nameCount = new Map<string, number>()
  for (const r of routes) if (r.componentName) nameCount.set(r.componentName, (nameCount.get(r.componentName) ?? 0) + 1)
  const labelFor = (r: RouteInfo): string => (r.componentName && (nameCount.get(r.componentName) ?? 0) === 1 ? r.componentName : r.fullPath)

  const nodes: GraphNode[] = routes.map((r) => ({
    id: r.nodeId,
    route: r.fullPath,
    componentPath: r.componentFile ? relative(projectDir, r.componentFile.getFilePath()) : null,
    label: labelFor(r),
    kind: 'screen',
  }))

  // A component file shared by several routes is extracted ONCE, attributed to a
  // representative route node (the first declared), so a map shell rendered by ten
  // routes does not duplicate its controls/modals/navigations ten times.
  const repByFile = new Map<string, string>()
  for (const r of routes) {
    if (!r.componentFile) continue
    const fp = r.componentFile.getFilePath()
    if (!repByFile.has(fp)) repByFile.set(fp, r.nodeId)
  }
  const isRepresentative = (r: RouteInfo): boolean =>
    r.componentFile !== undefined && repByFile.get(r.componentFile.getFilePath()) === r.nodeId

  const edges: GraphEdge[] = []
  const soundiness: SoundinessNote[] = []
  const seen = new Set<string>()
  const unknownSinks = new Set<string>()

  function pushEdge(from: string, to: string, t: RawTarget, modality: Modality, confidence: number, file: string, loc: { line: number; col: number }): void {
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
      witness: { source: 'static', file, loc, ruleId: t.ruleId ?? ruleIdFor(t.event, t.effect) },
    })
  }

  // Surface a fully-dynamic navigation (navigate(redirectUrl), history.push(var))
  // as an `unknown`-modality edge to a per-screen "dynamic ⋯" sink, carrying the
  // symbolic target as the guard. The transition is real (the call is witnessed);
  // only its destination is undecidable — so it is recorded, never silently
  // dropped ("can be wrong but cannot be missed"), and never promoted to must.
  function pushDynamicEdge(from: string, t: RawTarget, file: string, loc: { line: number; col: number }): void {
    const sinkId = `u_${from}`
    if (!unknownSinks.has(sinkId)) {
      unknownSinks.add(sinkId)
      nodes.push({ id: sinkId, route: null, componentPath: null, label: 'dynamic ⋯', kind: 'unknown' })
    }
    const expr = t.ti.kind === 'dynamic' ? t.ti.expr : undefined
    pushEdge(from, sinkId, { ...t, guard: t.guard ?? expr ?? null, ruleId: 'rr.dynamic-target' }, 'unknown', 0.3, file, loc)
  }

  for (const route of routes) {
    if (!route.componentFile) {
      soundiness.push({ kind: 'unresolved-component', detail: `route ${route.fullPath} has no resolvable component file` })
      continue
    }
    if (!isRepresentative(route)) continue
    const file = relative(projectDir, route.componentFile.getFilePath())
    for (const t of collectTargets(route.componentFile)) {
      const sf = t.node.getSourceFile()
      const lc = sf.getLineAndColumnAtPos(t.node.getStart())
      const loc = { line: lc.line, col: lc.column }
      if (t.ti.kind === 'literal') {
        const { exact, candidates } = matchLiteralAll(t.ti.value, routeLikes)
        if (exact) {
          const guarded = t.guard !== null
          pushEdge(route.nodeId, exact.nodeId, t, guarded ? 'may' : 'must', guarded ? 0.6 : 1, file, loc)
        } else if (candidates.length > 0) {
          soundiness.push({ kind: 'ambiguous-target', file, loc, detail: `literal target "${t.ti.value}" matched ${candidates.length} parameterized route(s); emitted as may, never must` })
          for (const cand of candidates) pushEdge(route.nodeId, cand.nodeId, t, 'may', 0.5, file, loc)
        } else {
          soundiness.push({ kind: 'unresolved-target', file, loc, detail: `literal target "${t.ti.value}" matches no declared route` })
        }
      } else if (t.ti.kind === 'template') {
        const cands = matchPrefix(t.ti.staticPrefix, routeLikes)
        soundiness.push({ kind: 'over-approximation', file, loc, detail: `non-literal target prefix "${t.ti.staticPrefix}" over-approximated to ${cands.length} route(s)` })
        for (const cand of cands) pushEdge(route.nodeId, cand.nodeId, t, 'may', 0.5, file, loc)
      } else {
        soundiness.push({ kind: 'dynamic-target', file, loc, detail: `fully dynamic navigation target (event ${t.event})` })
        pushDynamicEdge(route.nodeId, t, file, loc)
      }
    }
  }

  if (opts.controls) {
    let cidx = 0
    let midx = 0
    for (const route of routes) {
      if (!route.componentFile) continue
      if (!isRepresentative(route)) continue
      const sf = route.componentFile
      const file = relative(projectDir, sf.getFilePath())
      const navInfo = navIdentifiers(sf)

      const modalIds: string[] = []
      const seenModalTags = new Set<string>()
      for (const el of allJsxElements(sf)) {
        const tag = jsxTag(el)
        if (!/(Modal|Dialog|Drawer|Sheet|Popover)$/.test(tag) || seenModalTags.has(tag)) continue
        seenModalTags.add(tag)
        const mId = `m_${route.nodeId}_${midx++}`
        modalIds.push(mId)
        nodes.push({ id: mId, route: null, componentPath: file, label: stringAttr(el, 'title') ?? tag, kind: 'modal' })
      }

      if (detectDynamicWidget(sf)) {
        soundiness.push({
          kind: 'dynamic-widget',
          file,
          detail: 'interactive map/canvas widget: gestures (zoom/pan/drag) are runtime-only and not statically modelable',
        })
      }

      for (const el of allJsxElements(sf)) {
        const meta = controlMetaFor(el)
        if (!meta) continue
        const cId = `cc_${route.nodeId}__${meta.controlType}_${cidx++}`
        const inter = collectInteractions(el, sf, navInfo)
        const lc = sf.getLineAndColumnAtPos(el.getStart())
        const loc = { line: lc.line, col: lc.column }
        for (const nav of inter.navs) {
          const ctxGuard = nav.ctx === 'success' ? 'onSuccess' : nav.ctx === 'error' ? 'onError' : null
          const guard = nav.guard ?? ctxGuard
          const modality: 'must' | 'may' = guard !== null ? 'may' : 'must'
          const confidence = nav.ctx === 'error' ? 0.5 : nav.ctx === 'success' ? 0.7 : guard !== null ? 0.6 : 1
          const ruleId = nav.interprocedural ? 'rr.use-navigate.interprocedural' : undefined
          if (nav.ti.kind === 'literal') {
            const { exact, candidates } = matchLiteralAll(nav.ti.value, routeLikes)
            if (exact) {
              pushEdge(cId, exact.nodeId, { ti: nav.ti, event: nav.event, effect: 'navigate', node: nav.node, guard, ruleId }, modality, confidence, file, loc)
            } else {
              for (const cand of candidates)
                pushEdge(cId, cand.nodeId, { ti: nav.ti, event: nav.event, effect: 'navigate', node: nav.node, guard: guard ?? 'ambiguous', ruleId }, 'may', 0.5, file, loc)
            }
          } else if (nav.ti.kind === 'template') {
            for (const cand of matchPrefix(nav.ti.staticPrefix, routeLikes))
              pushEdge(cId, cand.nodeId, { ti: nav.ti, event: nav.event, effect: 'navigate', node: nav.node, guard, ruleId }, 'may', Math.min(confidence, 0.5), file, loc)
          } else {
            pushDynamicEdge(cId, { ti: nav.ti, event: nav.event, effect: 'navigate', node: nav.node, guard, ruleId }, file, loc)
          }
        }

        const modalTarget = modalIds[0]
        if (inter.effects.includes('open:modal') && modalTarget !== undefined) {
          const ev = inter.events[0] ?? 'click'
          pushEdge(cId, modalTarget, { ti: { kind: 'dynamic' }, event: ev, effect: 'open:modal', node: el, guard: null }, 'must', 1, file, loc)
        }

        nodes.push({
          id: cId,
          route: null,
          componentPath: file,
          label: meta.name ?? meta.element,
          kind: 'control',
          parent: route.nodeId,
          control: {
            element: meta.element,
            controlType: meta.controlType,
            ...(meta.name ? { name: meta.name } : {}),
            ...(inter.events.length > 0 ? { events: inter.events } : {}),
            ...(inter.effects.length > 0 ? { effects: inter.effects } : {}),
          },
        })
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
