// Vue Router static extraction. Splits each `.vue` SFC into template + script,
// turns a `createRouter({ routes: [...] })` array (path/component/name/children/
// beforeEnter, incl. nested paths) into screen nodes, and turns each component's
// <router-link to|:to> and `router.push/replace` calls into edges. With
// opts.controls, the template's interactive elements become control nodes whose
// @event handlers are traced to router.push sinks. Non-literal targets are
// over-approximated over the declared route set; no edge without a static witness.

import { Node, Project, SyntaxKind, ts } from 'ts-morph'
import type { ObjectLiteralExpression, SourceFile } from 'ts-morph'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { ControlInput, ControlSelector, ExtractOptions, ExtractResult, GraphEdge, GraphNode, SoundinessNote } from '@uigraph/core'
import { routeToNodeId, edgeId, controlNodeId } from './ids'
import { matchLiteralAll, matchPrefix, type RouteLike } from './matcher'
import { splitSfc, parseTemplateElements, eventHandlers, stringAttr, boundAttr, type Sfc, type TemplateEl } from './sfc'

const ADAPTER_VERSION = '0.1.0'
const DEFAULT_RULESET = 'vue-v3-2026.06'

type TargetInfo =
  | { kind: 'literal'; value: string }
  | { kind: 'template'; staticPrefix: string }
  | { kind: 'names'; values: string[] }
  | { kind: 'dynamic' }

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

interface RouteInfo {
  fullPath: string
  nodeId: string
  name: string | null
  componentName: string | null
  component: VueComponent | undefined
  guards: string[]
}

interface RawTarget {
  ti: TargetInfo
  event: string
  effect: string
  ruleId: string
  loc: { line: number; col: number }
  guard: string | null
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

/** Whether a path is a readable directory. */
function safeIsDir(p: string): boolean {
  try {
    return readdirSync(p).length >= 0
  } catch {
    return false
  }
}

/** Recursively list .ts/.js/.vue source files, skipping node_modules / dotfiles. */
function walkSources(dir: string): string[] {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkSources(full))
    else if (/\.(ts|js|vue)$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * Resolve a `.vue` import specifier to a registered component. Handles relative
 * specifiers and the common `@/` / `~/` / `~@/` src-root aliases (matched by path
 * suffix against `src/<rest>`), with `.vue` and `/index.vue` candidates.
 */
function resolveVueComponent(fromPath: string, specifier: string, components: VueComponent[]): VueComponent | undefined {
  const alias = /^(@|~@?)\//.exec(specifier)
  if (alias) {
    const rest = specifier.slice(alias[0].length)
    const tails = rest.endsWith('.vue') ? [`src/${rest}`] : [`src/${rest}.vue`, `src/${rest}/index.vue`]
    return components.find((c) => tails.some((t) => c.vuePath.endsWith(`/${t}`) || c.vuePath.endsWith(`\\${t}`)))
  }
  if (!specifier.startsWith('.')) return undefined
  const base = join(dirname(fromPath), specifier)
  const cands = specifier.endsWith('.vue') ? [base] : [`${base}.vue`, `${base}/index.vue`]
  return components.find((c) => cands.includes(c.vuePath))
}

/** Normalize a Vue route path joining a parent: '' inherits, '/x' absolute, 'x' relative, catch-all -> '*'. */
function normalizeRoutePath(parent: string, own: string): string {
  if (/pathMatch|\(\.\*\)|^\*$/.test(own)) return '*'
  if (own === '') return parent === '' ? '/' : parent
  const abs = own.startsWith('/') ? own : `${parent === '/' ? '' : parent}/${own}`
  const segs = abs.split('/').filter(Boolean)
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

/** Resolve a route object's `component` to a registered .vue component (eager ident or lazy import). */
function resolveComponent(obj: ObjectLiteralExpression, routesSf: SourceFile, components: VueComponent[]): { name: string | null; component: VueComponent | undefined } {
  const prop = obj.getProperty('component')
  if (!prop || !Node.isPropertyAssignment(prop)) return { name: null, component: undefined }
  const init = prop.getInitializer()
  if (!init) return { name: null, component: undefined }
  if (Node.isIdentifier(init)) {
    const name = init.getText()
    for (const imp of routesSf.getImportDeclarations()) {
      const matches = imp.getDefaultImport()?.getText() === name || imp.getNamedImports().some((n) => n.getName() === name || n.getAliasNode()?.getText() === name)
      if (matches) return { name, component: resolveVueComponent(routesSf.getFilePath(), imp.getModuleSpecifierValue(), components) }
    }
    // local `const X = () => import('../X.vue')` factory bound to the route component
    const local = routesSf.getVariableDeclaration(name)?.getInitializer()
    const localComp = local ? lazyImportComponent(local, routesSf, components) : undefined
    if (localComp) return { name, component: localComp }
    return { name, component: undefined }
  }
  const inlineComp = lazyImportComponent(init, routesSf, components)
  if (inlineComp) return { name: baseName(lazyImportSpec(init) ?? ''), component: inlineComp }
  return { name: null, component: undefined }
}

/** The `.vue` specifier string of a lazy `() => import('./X.vue')` expression, or null. */
function lazyImportSpec(expr: Node): string | null {
  const dyn = expr.getFirstDescendantByKind(SyntaxKind.CallExpression)
  if (!dyn || dyn.getExpression().getKind() !== SyntaxKind.ImportKeyword) return null
  const arg = dyn.getArguments()[0]
  if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) return arg.getLiteralValue()
  return null
}

/** Resolve a lazy `() => import('./X.vue')` expression to a registered component, or undefined. */
function lazyImportComponent(expr: Node, routesSf: SourceFile, components: VueComponent[]): VueComponent | undefined {
  const spec = lazyImportSpec(expr)
  return spec ? resolveVueComponent(routesSf.getFilePath(), spec, components) : undefined
}

/** The component name from a .vue specifier, e.g. './pages/Home.vue' -> 'Home'. */
function baseName(spec: string): string {
  return spec.replace(/.*\//, '').replace(/\.vue$/, '')
}

/** Whether a router-constructing callee name (createRouter, or `new Router`/`new VueRouter`). */
function isRouterConstructor(call: Node): boolean {
  const callee = Node.isCallExpression(call) ? call.getExpression() : Node.isNewExpression(call) ? call.getExpression() : undefined
  if (!callee) return false
  const text = callee.getText()
  return text === 'createRouter' || /(^|\.)(Vue)?Router$/.test(text)
}

/** Find the route-records array passed to (or referenced by) a router constructor, with its declaring file. */
function findRoutesArray(project: Project): { elements: ObjectLiteralExpression[]; sf: SourceFile } | null {
  for (const sf of project.getSourceFiles()) {
    const calls = [...sf.getDescendantsOfKind(SyntaxKind.CallExpression), ...sf.getDescendantsOfKind(SyntaxKind.NewExpression)]
    for (const call of calls) {
      if (!isRouterConstructor(call)) continue
      const arg = call.getArguments()[0]
      if (!arg || !Node.isObjectLiteralExpression(arg)) continue
      const routesProp = arg.getProperty('routes')
      if (!routesProp || !Node.isPropertyAssignment(routesProp)) continue
      const arr = resolveArray(routesProp.getInitializer(), sf)
      if (arr) return { elements: arr.getElements().filter(Node.isObjectLiteralExpression), sf }
    }
  }
  // fallback: an exported `const routes = [ { path } ... ]`
  for (const sf of project.getSourceFiles()) {
    for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = vd.getInitializer()
      if (!init || !Node.isArrayLiteralExpression(init)) continue
      if (init.getElements().some((e) => Node.isObjectLiteralExpression(e) && e.getProperty('path') !== undefined)) {
        return { elements: init.getElements().filter(Node.isObjectLiteralExpression), sf }
      }
    }
  }
  return null
}

/** Resolve an expression to an array literal, following a single identifier indirection. */
function resolveArray(node: Node | undefined, sf: SourceFile) {
  if (!node) return undefined
  if (Node.isArrayLiteralExpression(node)) return node
  if (Node.isIdentifier(node)) {
    const decl = sf.getVariableDeclaration(node.getText())
    const init = decl?.getInitializer()
    if (init && Node.isArrayLiteralExpression(init)) return init
  }
  return undefined
}

/** Whether a route object declares a per-route guard (beforeEnter). */
function routeGuards(obj: ObjectLiteralExpression): string[] {
  const prop = obj.getProperty('beforeEnter')
  if (!prop) return []
  if (Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer()
    if (init && Node.isIdentifier(init)) return [init.getText()]
  }
  return ['beforeEnter']
}

/** Walk the route-records array (recursing children, joining paths) into flat route nodes. */
function collectRoutes(vp: VueProject): RouteInfo[] {
  const found = findRoutesArray(vp.project)
  if (!found) return []
  const byNodeId = new Map<string, RouteInfo>()
  const visit = (objs: ObjectLiteralExpression[], parent: string): void => {
    for (const obj of objs) {
      const own = stringProp(obj, 'path')
      if (own === null) continue
      const fullPath = normalizeRoutePath(parent, own)
      const nodeId = routeToNodeId(fullPath)
      if (!byNodeId.has(nodeId)) {
        const { name, component } = resolveComponent(obj, found.sf, vp.components)
        byNodeId.set(nodeId, { fullPath, nodeId, name: stringProp(obj, 'name'), componentName: name, component, guards: routeGuards(obj) })
      }
      const childrenProp = obj.getProperty('children')
      if (childrenProp && Node.isPropertyAssignment(childrenProp)) {
        const arr = childrenProp.getInitializer()
        if (arr && Node.isArrayLiteralExpression(arr)) visit(arr.getElements().filter(Node.isObjectLiteralExpression), fullPath)
      }
    }
  }
  visit(found.elements, '')
  return [...byNodeId.values()]
}

// --- target classification (shared by router-link, router.push, control handlers) ---

/** Collect the static string values an expression can take: a literal, or each branch of a ternary. */
function staticNameValues(expr: Node | undefined): string[] {
  if (!expr) return []
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return [expr.getLiteralValue()]
  if (Node.isConditionalExpression(expr)) return [...staticNameValues(expr.getWhenTrue()), ...staticNameValues(expr.getWhenFalse())]
  if (Node.isParenthesizedExpression(expr)) return staticNameValues(expr.getExpression())
  return []
}

/** The `name` initializer of a route object literal, resolved to its static string candidates. */
function routeNameValues(obj: ObjectLiteralExpression): string[] {
  const prop = obj.getProperty('name')
  if (!prop || !Node.isPropertyAssignment(prop)) return []
  return staticNameValues(prop.getInitializer())
}

/** Classify a ts-morph navigation argument as literal / template-prefix / names / dynamic. */
function classifyTarget(expr: Node | undefined, nameToPath: Map<string, string>): TargetInfo {
  if (!expr) return { kind: 'dynamic' }
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isTemplateExpression(expr)) return { kind: 'template', staticPrefix: expr.getHead().getLiteralText() }
  if (Node.isObjectLiteralExpression(expr)) return classifyRouteObject(expr, nameToPath)
  if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === '+') {
    const left = expr.getLeft()
    if (Node.isStringLiteral(left) || Node.isNoSubstitutionTemplateLiteral(left)) return { kind: 'template', staticPrefix: left.getLiteralValue() }
  }
  return { kind: 'dynamic' }
}

/**
 * Classify a `{ name, params, path }` route object. A `name` resolves the target
 * route even when `params` are dynamic (params don't change which route is hit); a
 * ternary `name` fans out to each branch. Falls back to `path` if present.
 */
function classifyRouteObject(obj: ObjectLiteralExpression, nameToPath: Map<string, string>): TargetInfo {
  const names = routeNameValues(obj).filter((n) => nameToPath.has(n))
  if (names.length === 1) return { kind: 'literal', value: nameToPath.get(names[0] as string) as string }
  if (names.length > 1) return { kind: 'names', values: names }
  const path = stringProp(obj, 'path')
  if (path !== null) return { kind: 'literal', value: path }
  return { kind: 'dynamic' }
}

let exprCounter = 0

/** Parse a template-bound JS expression string into a ts-morph Expression node, or undefined. */
function parseExpr(project: Project, text: string): Node | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  try {
    const sf = project.createSourceFile(`__expr_${exprCounter++}.ts`, `const __x = (${trimmed});`)
    const init = sf.getVariableDeclaration('__x')?.getInitializer()
    if (Node.isParenthesizedExpression(init)) return init.getExpression()
    return init
  } catch {
    return undefined
  }
}

/**
 * Classify a template `to`/`:to` (or wrapper `name`) bound expression. The string is
 * parsed to an AST and run through classifyTarget so objects/ternaries behave like
 * script navigations; a bare identifier (e.g. a `computed`) is resolved to its
 * definition body in the component script before classification.
 */
function classifyBoundExpr(expr: string, component: VueComponent, project: Project, nameToPath: Map<string, string>): TargetInfo {
  const node = parseExpr(project, expr)
  if (!node) return { kind: 'dynamic' }
  if (Node.isIdentifier(node)) {
    const resolved = resolveIdentifierExpr(component.scriptSf, node.getText())
    if (resolved) return classifyTarget(resolved, nameToPath)
    return { kind: 'dynamic' }
  }
  return classifyTarget(node, nameToPath)
}

/**
 * Classify a wrapper's bound `:name`. A static string/ternary resolves to its route(s);
 * a dynamic name (e.g. `link.routeName`) over-approximates to every declared named route
 * (may-edges) rather than dropping the navigation.
 */
function classifyBoundName(expr: string, component: VueComponent, nameToPath: Map<string, string>): TargetInfo {
  const values = staticNamesFromString(expr, component).filter((n) => nameToPath.has(n))
  if (values.length === 1) return { kind: 'literal', value: nameToPath.get(values[0] as string) as string }
  if (values.length > 1) return { kind: 'names', values }
  return { kind: 'names', values: [...nameToPath.keys()] }
}

/** Static string candidates a bound `:name` expression can take (literal/ternary, resolving identifiers). */
function staticNamesFromString(expr: string, component: VueComponent): string[] {
  const node = parseExpr(component.scriptSf.getProject(), expr)
  if (!node) return []
  if (Node.isIdentifier(node)) {
    const resolved = resolveIdentifierExpr(component.scriptSf, node.getText())
    return resolved ? staticNameValues(resolved) : []
  }
  return staticNameValues(node)
}

/** Resolve a component-script identifier (const/computed) to the expression it ultimately returns. */
function resolveIdentifierExpr(sf: SourceFile, name: string): Node | undefined {
  const vd = sf.getVariableDeclaration(name)
  const init = vd?.getInitializer()
  if (!init) return undefined
  if (Node.isCallExpression(init) && init.getExpression().getText() === 'computed') {
    const fn = init.getArguments()[0]
    if (fn && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return functionReturnExpr(fn)
    return undefined
  }
  return init
}

/** The single returned expression of an arrow/function body (concise body or sole `return`), or undefined. */
function functionReturnExpr(fn: Node): Node | undefined {
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody()
    if (!Node.isBlock(body)) return Node.isParenthesizedExpression(body) ? body.getExpression() : body
  }
  const returns = fn.getDescendantsOfKind(SyntaxKind.ReturnStatement)
  if (returns.length === 1) {
    const e = returns[0]?.getExpression()
    return e && Node.isParenthesizedExpression(e) ? e.getExpression() : e
  }
  return undefined
}

// --- guard analysis (framework-agnostic; demotes a navigation to may) ---

/** Nearest enclosing if/ternary/&& condition as symbolic text, or null. */
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

/** Whether `node` lies within `container`'s source span. */
function within(container: Node, node: Node): boolean {
  return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd()
}

/** A loop/switch/catch/iteration/early-return context that demotes a nav to may, or null. */
function extraConditionGuard(node: Node): string | null {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) break
    if (Node.isForStatement(parent) || Node.isForOfStatement(parent) || Node.isForInStatement(parent) || Node.isWhileStatement(parent) || Node.isCaseClause(parent) || Node.isCatchClause(parent)) return 'loop/branch'
    if ((Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) && Node.isCallExpression(parent)) {
      const callee = parent.getExpression()
      if (Node.isPropertyAccessExpression(callee) && /^(map|forEach|filter|reduce|find|some|every|flatMap)$/.test(callee.getName())) return 'iteration'
    }
    cur = parent
  }
  const block = node.getFirstAncestorByKind(SyntaxKind.Block)
  if (block) {
    for (const stmt of block.getStatements()) {
      if (stmt.getEnd() > node.getStart()) break
      if (Node.isIfStatement(stmt) && /return|throw/.test(stmt.getThenStatement()?.getText() ?? '')) return 'early-return'
    }
  }
  return null
}

// --- router.push / router.replace detection ---

/** Identifiers bound to a `useRouter()` result in a script (so `router.push` is real navigation, not Array.push). */
function routerVars(sf: SourceFile): Set<string> {
  const out = new Set<string>()
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer()
    if (init && Node.isCallExpression(init) && init.getExpression().getText() === 'useRouter') out.add(vd.getName())
  }
  return out
}

/** Whether a `.push`/`.replace` receiver is a Vue router (useRouter var, useRouter() call, or this.$router). */
function isRouterReceiver(receiver: Node, vars: Set<string>): boolean {
  if (Node.isIdentifier(receiver)) return vars.has(receiver.getText())
  if (Node.isCallExpression(receiver)) return receiver.getExpression().getText() === 'useRouter'
  if (Node.isPropertyAccessExpression(receiver)) return receiver.getName() === '$router'
  return false
}

/** Collect router.push/replace navigations within a scope (whole file or a single method), with guards. */
function navTargetsIn(scope: Node, sf: SourceFile, vars: Set<string>, nameToPath: Map<string, string>): RawTarget[] {
  const out: RawTarget[] = []
  for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (!Node.isPropertyAccessExpression(expr)) continue
    const member = expr.getName()
    if (member !== 'push' && member !== 'replace') continue
    if (!isRouterReceiver(expr.getExpression(), vars)) continue
    const lc = sf.getLineAndColumnAtPos(call.getStart())
    out.push({
      ti: classifyTarget(call.getArguments()[0], nameToPath),
      event: 'navigate',
      effect: `router.${member}`,
      ruleId: `vue.router-${member}`,
      loc: { line: lc.line, col: lc.column },
      guard: getGuard(call) ?? extraConditionGuard(call),
    })
  }
  return out
}

/** Resolve a handler method name to its definition node (script-setup fn/const-arrow or Options-API method). */
function resolveMethodNode(sf: SourceFile, name: string): Node | undefined {
  const fn = sf.getFunction(name)
  if (fn) return fn
  const vd = sf.getVariableDeclaration(name)
  const init = vd?.getInitializer()
  if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init
  for (const m of sf.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    if (m.getName() === name && m.getFirstAncestor((a) => Node.isPropertyAssignment(a) && a.getName() === 'methods')) return m
  }
  return undefined
}

// --- controls (parity with React/Angular) ---

interface VueControl {
  tag: string
  controlType: string
  attrs: Map<string, string>
  text: string | undefined
  events: string[]
  handlers: { event: string; expr: string }[]
  selector: ControlSelector
  input: ControlInput | undefined
}

/** Classify a tag+attrs as a control type, or null when not interactive. */
function vueControlType(el: TemplateEl): string | null {
  const lower = el.tag.toLowerCase()
  if (lower === 'button') return 'button'
  if (lower === 'input') {
    const t = (el.attrs.get('type') ?? 'text').toLowerCase()
    if (t === 'checkbox' || t === 'radio') return 'checkbox'
    if (t === 'submit' || t === 'button') return 'button'
    if (t === 'file') return 'file'
    return 'input'
  }
  if (lower === 'textarea') return 'richtext'
  if (lower === 'select') return 'select'
  if (lower === 'form') return 'form'
  if (el.attrs.has('contenteditable')) return 'richtext'
  if (eventHandlers(el).length > 0) return 'element'
  return null
}

/** The ARIA role a control exposes, from an explicit role attr or its tag/type. */
function vueRole(el: TemplateEl, controlType: string): string | undefined {
  const explicit = el.attrs.get('role')
  if (explicit !== undefined) return explicit
  if (el.tag.toLowerCase() === 'a') return 'link'
  switch (controlType) {
    case 'button':
      return 'button'
    case 'checkbox':
      return (el.attrs.get('type') ?? '').toLowerCase() === 'radio' ? 'radio' : 'checkbox'
    case 'richtext':
      return 'textbox'
    case 'select':
      return 'combobox'
    case 'form':
      return 'form'
    case 'input':
      return (el.attrs.get('type') ?? 'text').toLowerCase() === 'search' ? 'searchbox' : 'textbox'
    default:
      return undefined
  }
}

/** Stable selector: data-testid -> role+name -> id/name -> text -> structural. */
function vueSelector(el: TemplateEl, controlType: string): ControlSelector {
  const testid = el.attrs.get('data-testid') ?? el.attrs.get('data-test-id')
  if (testid !== undefined) return { strategy: 'testid', value: testid }
  const role = vueRole(el, controlType)
  const accName = el.attrs.get('aria-label') ?? el.attrs.get('placeholder') ?? el.text ?? el.attrs.get('name')
  if (role !== undefined && accName !== undefined) return { strategy: 'role-name', value: `${role}|${accName}` }
  const label = el.attrs.get('id') ?? el.attrs.get('name')
  if (label !== undefined) return { strategy: 'label', value: label }
  if (el.text !== undefined) return { strategy: 'text', value: el.text }
  return { strategy: 'structural', value: el.tag.toLowerCase() }
}

/** Input constraints (type/required/pattern) for a field control. */
function vueInput(el: TemplateEl, controlType: string): ControlInput | undefined {
  if (!['input', 'checkbox', 'richtext', 'select'].includes(controlType)) return undefined
  const type = el.attrs.get('type')
  const pattern = el.attrs.get('pattern')
  const required = el.attrs.has('required')
  if (type === undefined && pattern === undefined && !required) return undefined
  return { ...(type !== undefined ? { type } : {}), ...(required ? { required: true } : {}), ...(pattern !== undefined ? { pattern } : {}) }
}

/** Parse interactive controls out of a component's template HTML. */
function parseControls(component: VueComponent): VueControl[] {
  const out: VueControl[] = []
  for (const el of parseTemplateElements(component.sfc.template, component.sfc.templateOffset)) {
    const controlType = vueControlType(el)
    if (controlType === null) continue
    const handlers = eventHandlers(el)
    out.push({
      tag: el.tag,
      controlType,
      attrs: el.attrs,
      text: el.text,
      events: handlers.map((h) => h.event),
      handlers,
      selector: vueSelector(el, controlType),
      input: vueInput(el, controlType),
    })
  }
  return out
}

/** Extract a graph from a built VueProject (testable in memory). */
export function extractGraph(vp: VueProject, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  const routes = collectRoutes(vp)
  const routeLikes: RouteLike[] = routes.map((r) => ({ fullPath: r.fullPath, nodeId: r.nodeId }))
  const guardsByNodeId = new Map(routes.map((r) => [r.nodeId, r.guards]))
  const nameToPath = new Map(routes.filter((r) => r.name).map((r) => [r.name as string, r.fullPath]))

  const nodes: GraphNode[] = routes.map((r) => ({
    id: r.nodeId,
    route: r.fullPath,
    componentPath: r.component ? relative(projectDir, r.component.vuePath) : null,
    label: r.componentName ?? r.name ?? r.fullPath,
    kind: 'screen',
  }))

  const edges: GraphEdge[] = []
  const soundiness: SoundinessNote[] = []
  const seen = new Set<string>()

  function pushEdge(from: string, to: string, t: RawTarget, modality: 'must' | 'may', confidence: number, guard: string | null, file: string): void {
    const id = edgeId(from, to, t.event, guard)
    if (seen.has(id)) return
    seen.add(id)
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
    for (const t of [...templateTargets(route.component, vp.project, nameToPath), ...childTargets(route.component, vp, nameToPath), ...navTargetsIn(sf, sf, vars, nameToPath)]) {
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
          for (const t of handlerNavTargets(h.expr, sf, vars, nameToPath)) {
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
      adapter: '@uigraph/adapter-vue',
      adapterVersion: ADAPTER_VERSION,
      rulesetVersion: opts.rulesetVersion ?? DEFAULT_RULESET,
      ...(opts.commit ? { commit: opts.commit } : {}),
    },
    nodes,
    edges,
  }
  return { graph, soundiness }
}

/** Navigations a control handler expression performs: inline router.push, or a traced method. */
function handlerNavTargets(expr: string, sf: SourceFile, vars: Set<string>, nameToPath: Map<string, string>): RawTarget[] {
  if (/\.(push|replace)\s*\(/.test(expr)) {
    const m = /\.(push|replace)\s*\(\s*(['"`])([^'"`]*)\2/.exec(expr)
    const lc = { line: 1, col: 1 }
    if (m) return [{ ti: { kind: 'literal', value: m[3] ?? '' }, event: 'click', effect: `router.${m[1]}`, ruleId: `vue.router-${m[1]}`, loc: lc, guard: null }]
    return [{ ti: { kind: 'dynamic' }, event: 'click', effect: 'router.push', ruleId: 'vue.router-push', loc: lc, guard: null }]
  }
  const methodName = /([a-zA-Z_$][\w$]*)\s*(?:\(|$)/.exec(expr.trim())?.[1]
  if (methodName === undefined) return []
  const node = resolveMethodNode(sf, methodName)
  if (!node) return []
  return navTargetsIn(node, sf, vars, nameToPath).map((t) => ({ ...t, event: 'click' }))
}

/** Whether a tag is a Vue component (PascalCase or kebab-case multi-word), i.e. a possible router-link wrapper. */
function isComponentTag(tag: string): boolean {
  return /[A-Z]/.test(tag) || tag.includes('-')
}

/** A component's imported child .vue components (default-import specifiers resolved to registered SFCs). */
function childComponents(component: VueComponent, components: VueComponent[]): VueComponent[] {
  const out: VueComponent[] = []
  for (const imp of component.scriptSf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (!imp.getDefaultImport() && imp.getNamedImports().length === 0) continue
    const child = resolveVueComponent(component.vuePath, spec, components)
    if (child && child !== component) out.push(child)
  }
  return out
}

/**
 * Collect navigations declared in a route's transitively-imported child components,
 * attributing them to the parent route. Child navs are invisible to the per-route
 * scan because they live in separate SFCs (e.g. an article page's <ArticleMeta>
 * does the `router.push({ name: 'login' })`). Visited-set bounds cycles; child
 * targets are demoted to may-edges since the child may render conditionally.
 */
function childTargets(component: VueComponent, vp: VueProject, nameToPath: Map<string, string>): RawTarget[] {
  const out: RawTarget[] = []
  const visited = new Set<string>([component.vuePath])
  const walk = (comp: VueComponent): void => {
    for (const child of childComponents(comp, vp.components)) {
      if (visited.has(child.vuePath)) continue
      visited.add(child.vuePath)
      const file = relative(dirname(component.vuePath), child.vuePath)
      const vars = routerVars(child.scriptSf)
      const targets = [...templateTargets(child, vp.project, nameToPath), ...navTargetsIn(child.scriptSf, child.scriptSf, vars, nameToPath)]
      for (const t of targets) out.push({ ...t, effect: `${t.effect} (child ${file})`, guard: t.guard ?? 'child-component' })
      walk(child)
    }
  }
  walk(component)
  return out
}

/**
 * Parse routing navigations out of a component's template. Recognizes <router-link>
 * (`to`/`:to`) and custom wrapper components (e.g. <AppLink>) that forward routing
 * props via `to`/`:to`/`name`/`:name`. A `name` wrapper prop is classified through a
 * synthetic `{ name }` object so it resolves the same way as a router.push object.
 */
function templateTargets(component: VueComponent, project: Project, nameToPath: Map<string, string>): RawTarget[] {
  const out: RawTarget[] = []
  for (const el of parseTemplateElements(component.sfc.template, component.sfc.templateOffset)) {
    const isRouterLink = /^(router-link|routerlink)$/i.test(el.tag)
    const plainTo = stringAttr(el, 'to')
    const boundTo = boundAttr(el, 'to')
    const plainName = stringAttr(el, 'name')
    const boundName = boundAttr(el, 'name')
    const hasRouting = plainTo !== undefined || boundTo !== undefined || plainName !== undefined || boundName !== undefined
    if (!isRouterLink && !(isComponentTag(el.tag) && hasRouting)) continue
    const lc = lineColAt(component.source, el.offset)
    const push = (ti: TargetInfo) => out.push({ ti, event: 'click:router-link', effect: 'navigate', ruleId: 'vue.router-link', loc: lc, guard: null })
    if (plainTo !== undefined) push({ kind: 'literal', value: plainTo })
    else if (boundTo !== undefined) push(classifyBoundExpr(boundTo, component, project, nameToPath))
    else if (plainName !== undefined) push(nameToPath.has(plainName) ? { kind: 'literal', value: nameToPath.get(plainName) as string } : { kind: 'dynamic' })
    else if (boundName !== undefined) push(classifyBoundName(boundName, component, nameToPath))
  }
  return out
}

/** Map an absolute source offset back to a 1-based line/col within the .vue file. */
function lineColAt(source: string, offset: number): { line: number; col: number } {
  let line = 1
  let col = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line += 1
      col = 1
    } else {
      col += 1
    }
  }
  return { line, col }
}

export { ADAPTER_VERSION, DEFAULT_RULESET }
