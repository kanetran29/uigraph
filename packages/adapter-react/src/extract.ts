// React Router static extraction (features F2.2–F2.6). Walks a ts-morph project,
// turns <Route> declarations into nodes and Link/NavLink/Navigate/Redirect +
// useNavigate/useHistory navigations into edges, over-approximating non-literal
// targets over the declared route set and capturing guards as symbolic text.
// Supports react-router v5 and v6. No edge is emitted without a static witness.

import { Node, Project, SyntaxKind, ts } from 'ts-morph'
import type { JsxAttribute, SourceFile } from 'ts-morph'
import { dirname, join, relative } from 'node:path'
import type { ControlInput, ControlSelector, ExtractOptions, ExtractResult, GraphEdge, GraphNode, Modality, SoundinessNote } from '@uigraph/core'
import { routeToNodeId, edgeId, controlNodeId } from './ids'
import { matchLiteralAll, matchPrefix, type RouteLike } from './matcher'

const ADAPTER_VERSION = '0.1.0'
const DEFAULT_RULESET = 'rr-v5v6-2026.06'

type TargetInfo =
  | { kind: 'literal'; value: string }
  | { kind: 'template'; staticPrefix: string }
  | { kind: 'enum'; values: string[] }
  | { kind: 'dynamic'; expr?: string }

interface RouteInfo {
  fullPath: string
  nodeId: string
  componentName: string | null
  componentFile: SourceFile | undefined
}

/**
 * A pre-discovered route fed to extractGraphFromRoutes: the IR route path, its content-
 * addressed node id, an optional component name (for label disambiguation), and the
 * resolved page/component SourceFile. Adapters that don't use <Route> JSX (e.g. next)
 * build these from their own route source.
 */
export type RouteSeed = RouteInfo

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
function classifyTarget(expr: Node | undefined, sf?: SourceFile): TargetInfo {
  if (!expr) return { kind: 'dynamic' }
  if (Node.isStringLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isTemplateExpression(expr)) return { kind: 'template', staticPrefix: expr.getHead().getLiteralText() }
  // A computed lookup into a const route-map, e.g. push(subviewPaths[sv]) — over-
  // approximate to the map's literal string values (the real possible destinations).
  if (sf && (Node.isElementAccessExpression(expr) || Node.isPropertyAccessExpression(expr))) {
    const obj = expr.getExpression()
    if (Node.isIdentifier(obj)) {
      const values = resolveConstStringValues(obj.getText(), sf)
      if (values.length > 0) return { kind: 'enum', values }
    }
  }
  return { kind: 'dynamic', expr: expr.getText() }
}

/** The literal string values of a module-level `const X = {…}` / `const X = […]`, for const route-maps. */
function resolveConstStringValues(name: string, sf: SourceFile): string[] {
  const init = sf.getVariableDeclaration(name)?.getInitializer()
  const out: string[] = []
  if (init && Node.isObjectLiteralExpression(init)) {
    for (const p of init.getProperties()) {
      if (!Node.isPropertyAssignment(p)) continue
      const v = p.getInitializer()
      if (v && (Node.isStringLiteral(v) || Node.isNoSubstitutionTemplateLiteral(v))) out.push(v.getLiteralValue())
    }
  } else if (init && Node.isArrayLiteralExpression(init)) {
    for (const e of init.getElements()) if (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e)) out.push(e.getLiteralValue())
  }
  return out
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

/**
 * The set of source files that make up a route's screen: the route component plus
 * the same-project child components it renders in JSX, breadth-first to maxDepth.
 * refapp-style SPAs render most real navigation one or more component-hops below
 * the route (a button in a nested <LandingPage>), so a route component scanned
 * alone misses them. Bounded by maxDepth + a visited set; node_modules + framework
 * wrappers are skipped. Returns each file with its descent depth (0 = the route
 * component itself); callers cap depth>0 navigations to `may` since a child's
 * render is not statically guaranteed.
 */
function screenSourceFiles(root: SourceFile, maxDepth: number): Map<SourceFile, number> {
  const out = new Map<SourceFile, number>()
  out.set(root, 0)
  let frontier = [root]
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: SourceFile[] = []
    for (const sf of frontier) {
      const tags = new Set<string>()
      for (const el of allJsxElements(sf)) {
        const tag = jsxTag(el).split('.')[0] ?? ''
        if (!/^[A-Z]/.test(tag)) continue
        if (/(Provider|Consumer|Context|Route|Routes|Switch|Router|Fragment|Suspense|ErrorBoundary)$/.test(tag)) continue
        tags.add(tag)
      }
      for (const tag of tags) {
        const child = resolveComponentFile(sf, tag)
        if (!child || out.has(child) || child.getFilePath().includes('node_modules')) continue
        out.set(child, depth + 1)
        next.push(child)
      }
    }
    frontier = next
  }
  return out
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

function navIdentifiers(sf: SourceFile): { navSet: Set<string>; histSet: Set<string>; routerSet: Set<string>; redirectNames: Set<string> } {
  const navSet = new Set<string>()
  const histSet = new Set<string>()
  const routerSet = new Set<string>()
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer()
    if (!init || !Node.isCallExpression(init)) continue
    const callee = init.getExpression()
    if (!Node.isIdentifier(callee)) continue
    const name = vd.getNameNode().getText()
    if (callee.getText() === 'useNavigate') navSet.add(name)
    if (callee.getText() === 'useHistory') histSet.add(name)
    // Next.js: const router = useRouter() — push/replace, from next/navigation OR next/router.
    if (callee.getText() === 'useRouter') routerSet.add(name)
  }
  // Next.js: redirect / permanentRedirect imported from next/navigation (gated on the import
  // so a user's local `redirect` is never mistaken for a navigation).
  const redirectNames = new Set<string>()
  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== 'next/navigation') continue
    for (const ni of imp.getNamedImports()) {
      if (ni.getNameNode().getText() === 'redirect' || ni.getNameNode().getText() === 'permanentRedirect') {
        redirectNames.add(ni.getAliasNode()?.getText() ?? ni.getNameNode().getText())
      }
    }
  }
  return { navSet, histSet, routerSet, redirectNames }
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
    // react-router <Link to>; next/link <Link href> when there is no `to` (react Links
    // always carry `to`, so this href fallback never changes react output).
    out.push({ ti: classifyToAttr(findAttr(el, 'to') ?? findAttr(el, 'href')), event, effect, node: el, guard: getGuard(el) })
  }

  const { navSet, histSet, routerSet, redirectNames } = navIdentifiers(sf)
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    let effect: string | null = null
    if (Node.isIdentifier(expr) && navSet.has(expr.getText())) {
      effect = 'navigate'
    } else if (Node.isIdentifier(expr) && redirectNames.has(expr.getText())) {
      effect = 'redirect'
    } else if (Node.isPropertyAccessExpression(expr)) {
      const obj = expr.getExpression()
      const member = expr.getName()
      if (Node.isIdentifier(obj) && histSet.has(obj.getText()) && (member === 'push' || member === 'replace')) {
        effect = `history.${member}`
      } else if (Node.isIdentifier(obj) && routerSet.has(obj.getText()) && (member === 'push' || member === 'replace')) {
        effect = `router.${member}`
      }
    }
    if (effect === null) continue
    out.push({ ti: classifyTarget(call.getArguments()[0], sf), event: 'navigate', effect, node: call, guard: getGuard(call) ?? extraConditionGuard(call) })
  }
  return out
}

function ruleIdFor(event: string, effect: string): string {
  if (effect.startsWith('router.')) return 'next.use-router-push'
  // next redirect() is a call (event 'navigate'); react <Navigate>/<Redirect> is JSX (event 'redirect').
  if (effect === 'redirect' && event === 'navigate') return 'next.redirect'
  if (event === 'click:Link') return 'rr.link-to'
  if (event === 'redirect') return 'rr.redirect'
  if (effect.startsWith('history.')) return 'rr.use-history-push'
  return 'rr.use-navigate'
}

interface ControlInfo {
  element: string
  controlType: string
  name?: string
  selector: ControlSelector
  input?: ControlInput
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

/** Humanize an i18n key / camel / kebab / BEM token into a readable name ("building.offMarket.couldSell" -> "Could sell"). */
function humanize(raw: string): string | undefined {
  const last = raw.split('.').pop() ?? raw
  const s = last.replace(/[-_]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().toLowerCase()
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : undefined
}

/**
 * The i18n key from a `{t('key')}` / `{t("key", …)}` hook call used as the element's
 * LABEL — searched only in the element's JSX CHILDREN (text position), never its
 * attributes, so a `t()` inside an onClick/error handler can't be mistaken for the label.
 * refapp labels most controls this way (the hook form), distinct from `<Trans i18nKey>`.
 */
function i18nCallKey(el: Node): string | undefined {
  if (!Node.isJsxElement(el)) return undefined
  for (const child of el.getJsxChildren()) {
    for (const call of child.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression().getText()
      if (callee !== 't' && !callee.endsWith('.t')) continue
      const arg = call.getArguments()[0]
      if (arg && Node.isStringLiteral(arg)) {
        const key = arg.getLiteralText()
        if (key.length > 0) return key
      }
    }
  }
  return undefined
}

/** The i18n key from an attribute whose value is a `{t('key')}` call (e.g. `placeholder={t('…')}`). */
function attrCallKey(el: Node, name: string): string | undefined {
  const init = findAttr(el, name)?.getInitializer()
  if (!init || !Node.isJsxExpression(init)) return undefined
  const expr = init.getExpression()
  if (!expr) return undefined
  for (const call of [expr, ...expr.getDescendants()]) {
    if (!Node.isCallExpression(call)) continue
    const callee = call.getExpression().getText()
    if (callee !== 't' && !callee.endsWith('.t')) continue
    const arg = call.getArguments()[0]
    if (arg && Node.isStringLiteral(arg)) {
      const key = arg.getLiteralText()
      if (key.length > 0) return key
    }
  }
  return undefined
}

/**
 * A human label from a control attribute (placeholder / aria-label) that is either a
 * string literal OR a `{t('key')}` expression — refapp labels its inputs this way, which
 * the text/icon/className inference cannot see. For an i18n key a trailing
 * "Placeholder"/"Label" token is dropped so `emailPlaceholder` reads "Email".
 */
function attrLabel(el: Node, name: string): string | undefined {
  const lit = stringAttr(el, name)
  if (lit != null && lit.length > 0) return lit
  const key = attrCallKey(el, name)
  if (key == null) return undefined
  const cleaned = key.replace(/(placeholder|label)$/i, '')
  return humanize(cleaned.length > 0 ? cleaned : key)
}

/**
 * Derive a control's name from STATIC signals when it has no visible text/aria —
 * refapp-style apps label via `<Trans i18nKey="…">`, a `{t('key')}` hook call, an icon
 * component (`<SellIcon/>`), or a BEM className modifier (`--could-sell`). The name is in
 * the source, just not as literal text; reading it deterministically beats leaving the
 * control unnamed (and upgrades its selector from structural to role+name).
 */
function inferredName(el: Node): string | undefined {
  const kids = [el, ...el.getDescendantsOfKind(SyntaxKind.JsxElement), ...el.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]
  for (const d of kids) {
    const key = stringAttr(d, 'i18nKey')
    if (key != null && key.length > 0) return humanize(key)
  }
  // The actual label text via the i18n hook — more accurate than the icon/className
  // fallbacks below, which on refapp's design-system buttons leak the variant ("Danger").
  const callKey = i18nCallKey(el)
  if (callKey != null) return humanize(callKey)
  for (const d of kids) {
    const t = jsxTag(d)
    const m = /^([A-Z][A-Za-z0-9]*?)(Icon|Svg)$/.exec(t)
    if (m && m[1]) return humanize(m[1])
  }
  const cls = stringAttr(el, 'className')
  if (cls != null) {
    const mod = cls.split(/\s+/).map((c) => (c.includes('--') ? c.slice(c.lastIndexOf('--') + 2) : null)).find((x): x is string => x != null && /[a-z]/i.test(x))
    if (mod) return humanize(mod)
  }
  return undefined
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

/** The ARIA role a control exposes, from an explicit role attr or its tag/type. */
function ariaRole(el: Node, tag: string, controlType: string): string | undefined {
  const explicit = stringAttr(el, 'role')
  if (explicit) return explicit
  if (tag.toLowerCase() === 'a') return 'link'
  switch (controlType) {
    case 'button':
      return 'button'
    case 'checkbox':
      return (stringAttr(el, 'type') ?? '').toLowerCase() === 'radio' ? 'radio' : 'checkbox'
    case 'richtext':
      return 'textbox'
    case 'select':
      return 'combobox'
    case 'form':
      return 'form'
    case 'input':
      return (stringAttr(el, 'type') ?? 'text').toLowerCase() === 'search' ? 'searchbox' : 'textbox'
    default:
      return undefined
  }
}

/**
 * The stable locator for a control, in precedence order: a data-testid, an ARIA
 * role + accessible name, a label (id/name attr), visible text, or a structural
 * tag fallback. `nth` (assigned later, per screen) disambiguates identical
 * selectors. This is the basis for the control's id and a real automation handle.
 */
function controlSelector(el: Node, tag: string, controlType: string, text: string | undefined): ControlSelector {
  const testid = stringAttr(el, 'data-testid') ?? stringAttr(el, 'data-test-id')
  if (testid != null) return { strategy: 'testid', value: testid }
  const role = ariaRole(el, tag, controlType)
  const accName = stringAttr(el, 'aria-label') ?? stringAttr(el, 'name') ?? stringAttr(el, 'placeholder') ?? text ?? stringAttr(el, 'id')
  if (role != null && accName != null) return { strategy: 'role-name', value: `${role}|${accName}` }
  const label = stringAttr(el, 'id') ?? stringAttr(el, 'name')
  if (label != null) return { strategy: 'label', value: label }
  if (text != null) return { strategy: 'text', value: text }
  return { strategy: 'structural', value: tag.toLowerCase() }
}

/**
 * Input constraints for a field control (input/textarea/select): its HTML type,
 * whether it is required, and any validation pattern — so codegen can produce a
 * type-appropriate fill value and probe validation. Undefined for non-field controls.
 */
function inputConstraints(el: Node, controlType: string): ControlInput | undefined {
  if (controlType !== 'input' && controlType !== 'checkbox' && controlType !== 'richtext' && controlType !== 'select') return undefined
  const type = stringAttr(el, 'type') ?? undefined
  const pattern = stringAttr(el, 'pattern') ?? undefined
  const required = findAttr(el, 'required') !== undefined
  if (type === undefined && pattern === undefined && !required) return undefined
  return { ...(type !== undefined ? { type } : {}), ...(required ? { required: true } : {}), ...(pattern !== undefined ? { pattern } : {}) }
}

/**
 * Classify an interactive JSX element as a control, or null if it is not one. A
 * control is a native form element (button/input/textarea/select/form),
 * contentEditable, or ANY lowercase DOM element carrying an `on*` handler (so a
 * `<div onMouseEnter>` or `<li onKeyDown>` counts too). Carries a stable selector.
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
  // refapp inputs (and icon buttons) carry their label in placeholder / aria-label / title
  // (the tooltip), often as a {t('key')} expression — the authoritative name when there is
  // no visible text, so it slots ahead of the weaker i18n-key/icon/className inference.
  const attrName = attrLabel(el, 'placeholder') ?? attrLabel(el, 'aria-label') ?? attrLabel(el, 'title')
  const inferred = textLabel ?? attrName ?? inferredName(el)
  const name = stringAttr(el, 'name') ?? stringAttr(el, 'id') ?? inferred
  const selector = controlSelector(el, tag, controlType, inferred)
  const input = inputConstraints(el, controlType)
  return { element: tag, controlType, selector, ...(input ? { input } : {}), ...(name ? { name } : {}) }
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

/**
 * The modal STATE VARIABLE a setter opens — setShowCouldSellModal(true) ->
 * 'showCouldSellModal' — or null. The variable name links the opening control to
 * the specific modal it shows (gated by `{showX && <Modal/>}` / `isOpen={showX}`).
 */
function detectModalOpen(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null
  const expr = call.getExpression()
  if (!Node.isIdentifier(expr)) return null
  const name = expr.getText()
  // setShow…/setOpen…/setVisible… OR any setter naming a Modal/Dialog/Drawer/etc.
  // (e.g. setLoginModalVisible) — covers both `setShowX(true)` and `setXModalVisible(true)`.
  if (!/^set(Show|Open|Visible)/i.test(name) && !/(Modal|Dialog|Drawer|Popover|Sheet)/i.test(name)) return null
  const arg = call.getArguments()[0]
  if (!arg || arg.getText() !== 'true') return null
  const v = name.slice(3)
  return v.length > 0 ? v.charAt(0).toLowerCase() + v.slice(1) : 'modal'
}

/**
 * The *Visible state var gating an overlay sub-view's render — the first identifier
 * ending in `Visible` among the guards of an enclosing `{ … && <Component/>}` conjunction
 * (e.g. `profileViewVisible && isLoggedIn && <ProfileView/>`). Unlike modalGateVar (a
 * single `{ident && …}`), this walks a multi-`&&` guard. Restricting to a `*Visible`
 * suffix targets the overlay-view convention without firing on ordinary conditional renders.
 */
function gatedOverlayVar(el: Node): string | null {
  let cur: Node | undefined = el.getParent()
  const guards: string[] = []
  for (let i = 0; i < 6 && cur; i++) {
    if (Node.isParenthesizedExpression(cur)) {
      cur = cur.getParent()
      continue
    }
    if (Node.isBinaryExpression(cur) && cur.getOperatorToken().getText() === '&&') {
      const left = cur.getLeft()
      for (const id of [left, ...left.getDescendants()]) if (Node.isIdentifier(id)) guards.push(id.getText())
      cur = cur.getParent()
      continue
    }
    // The element must reach the `&&` guard through paren wrappers only; crossing a JSX
    // element/fragment means it is merely NESTED inside a gated wrapper, not itself the
    // gated render — promoting it would re-home an unrelated control.
    if (Node.isJsxElement(cur) || Node.isJsxFragment(cur) || Node.isJsxExpression(cur)) break
    cur = cur.getParent()
  }
  return guards.find((g) => /visible$/i.test(g)) ?? null
}

/** The state variable gating a modal element's render: an isOpen/open/visible/show prop bound to {ident}, or an enclosing `{ident && <Modal/>}`. */
function modalGateVar(el: Node): string | null {
  for (const name of ['isOpen', 'open', 'visible', 'show', 'isVisible', 'active', 'isActive', 'opened']) {
    const init = findAttr(el, name)?.getInitializer()
    if (init && Node.isJsxExpression(init)) {
      const inner = init.getExpression()
      if (inner && Node.isIdentifier(inner)) return inner.getText()
    }
  }
  let cur: Node | undefined = el.getParent()
  for (let i = 0; i < 4 && cur; i++) {
    if (Node.isBinaryExpression(cur) && cur.getOperatorToken().getText() === '&&') {
      const left = cur.getLeft()
      if (Node.isIdentifier(left)) return left.getText()
    }
    cur = cur.getParent()
  }
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
    const modalVar = detectModalOpen(call)
    if (modalVar) {
      out.effects.add(`open:modal:${modalVar}`)
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
/** The declared route that is the longest strict path-prefix parent of fullPath, or null. */
function parentRouteOf(fullPath: string, routes: RouteLike[]): RouteLike | null {
  let best: RouteLike | null = null
  for (const r of routes) {
    if (r.fullPath === fullPath || r.fullPath === '/') continue
    if (fullPath.startsWith(r.fullPath + '/') && (!best || r.fullPath.length > best.fullPath.length)) best = r
  }
  return best
}

export function extractGraph(project: Project, projectDir: string, opts: ExtractOptions = {}): ExtractResult {
  return extractGraphFromRoutes(project, projectDir, collectRoutes(project), opts)
}

/**
 * The route-source-agnostic engine: assemble the full graph (route nodes + nav edges +
 * controls + modals/overlays + shared-nav attribution) from PRE-DISCOVERED route seeds.
 * The react adapter feeds it collectRoutes(<Route> JSX); the next adapter feeds it routes
 * discovered from the filesystem (app/ + pages/). `adapterName` stamps graph.meta.adapter.
 */
export function extractGraphFromRoutes(
  project: Project,
  projectDir: string,
  routes: RouteSeed[],
  opts: ExtractOptions = {},
  adapterName = '@uigraph/adapter-react',
): ExtractResult {
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
    for (const [cf, depth] of screenSourceFiles(route.componentFile, 2)) {
      const file = relative(projectDir, cf.getFilePath())
      // A navigation in a descended child component (depth>0) is real, but the
      // child's render is not statically guaranteed — cap it to `may`, never must.
      const descended = depth > 0
      for (const t of collectTargets(cf)) {
        const sf = t.node.getSourceFile()
        const lc = sf.getLineAndColumnAtPos(t.node.getStart())
        const loc = { line: lc.line, col: lc.column }
        if (t.ti.kind === 'literal') {
          const { exact, candidates } = matchLiteralAll(t.ti.value, routeLikes)
          if (exact) {
            const guarded = t.guard !== null || descended
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
        } else if (t.ti.kind === 'enum') {
          soundiness.push({ kind: 'over-approximation', file, loc, detail: `const route-map target over-approximated to ${t.ti.values.length} value(s)` })
          for (const val of t.ti.values) {
            const { exact } = matchLiteralAll(val, routeLikes)
            if (exact) pushEdge(route.nodeId, exact.nodeId, { ...t, ti: { kind: 'literal', value: val } }, 'may', 0.5, file, loc)
          }
        } else {
          soundiness.push({ kind: 'dynamic-target', file, loc, detail: `fully dynamic navigation target (event ${t.event})` })
          pushDynamicEdge(route.nodeId, t, file, loc)
        }
      }
    }
  }

  if (opts.controls) {
    let midx = 0
    let vidx = 0
    for (const route of routes) {
      if (!route.componentFile) continue
      if (!isRepresentative(route)) continue

      // Gather controls + modals across the screen's whole render tree (route
      // component + descended child components), then assign nth per identical
      // selector ACROSS the screen so control ids stay stable AND unique.
      const modalIds: string[] = []
      const modalIdByTag = new Map<string, string>()
      // Map each modal's gating state-var (showX) to its node, so a control that
      // sets that var (setShowX(true)) links to the SPECIFIC modal, not just the first.
      const modalByVar = new Map<string, string>()
      // Imported modal component files to descend into for their OWN inner controls,
      // keyed by modal node id. A modal defined INLINE (resolves to the same file, or
      // is a local function) is not recorded here — its controls are already swept by
      // the screen pass and stay screen-parented, so their content-addressed ids don't
      // shift (re-parenting them would orphan bound proposals/observations).
      const modalDescend = new Map<string, SourceFile>()
      const modalFilePaths = new Set<string>()

      type ControlItem = { el: Node; meta: ControlInfo; cf: SourceFile; navInfo: ReturnType<typeof navIdentifiers>; file: string; descended: boolean }

      // Emit a set of controls under one owner (a screen or a modal). nth is scoped
      // PER OWNER so a modal <button>Cancel</button> never perturbs a screen
      // <button>Cancel</button>'s nth (hence id). forceMay caps every navigation to
      // `may` (a modal's contents are conditionally rendered, never guaranteed to
      // mount). linkModals wires open:modal effects to the screen's modals — done only
      // for screen-level controls, since nested-modal targets aren't modelled in v1.
      const emitControls = (ownerId: string, items: ControlItem[], forceMay: boolean, linkModals: boolean): void => {
        const nthBySig = new Map<string, number>()
        for (const { meta } of items) {
          const sig = `${meta.selector.strategy}|${meta.selector.value}`
          const nth = nthBySig.get(sig) ?? 0
          nthBySig.set(sig, nth + 1)
          if (nth > 0) meta.selector.nth = nth
        }
        for (const { el, meta, cf, navInfo, file, descended } of items) {
          const isDescended = descended || forceMay
          const cId = controlNodeId(ownerId, meta.selector)
          const inter = collectInteractions(el, cf, navInfo)
          // The state-var is needed only for edge targeting; normalize the stored
          // effect to the stable 'open:modal' so the IR doesn't leak variable names.
          const nodeEffects = [...new Set(inter.effects.map((e) => (e.startsWith('open:modal') ? 'open:modal' : e)))]
          const lc = cf.getLineAndColumnAtPos(el.getStart())
          const loc = { line: lc.line, col: lc.column }
          for (const nav of inter.navs) {
            const ctxGuard = nav.ctx === 'success' ? 'onSuccess' : nav.ctx === 'error' ? 'onError' : null
            const guard = nav.guard ?? ctxGuard
            // A control in a descended child / a modal is real but not guaranteed to render here -> cap to may.
            const modality: 'must' | 'may' = guard !== null || isDescended ? 'may' : 'must'
            const confidence = isDescended ? 0.5 : nav.ctx === 'error' ? 0.5 : nav.ctx === 'success' ? 0.7 : guard !== null ? 0.6 : 1
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

          // Link each modal-opening effect to the SPECIFIC modal it shows (matched by the
          // state var setShowX -> showX -> the modal gated by showX). The precise gate-var
          // match is deterministic and allowed for ANY control — including one nested inside
          // another overlay (refapp opens its login modal from controls deep in the buy/sell
          // flow). The sole-modal FALLBACK is a guess, so only screen-level controls
          // (linkModals) may use it — a nested control could mislink across unrelated overlays.
          for (const eff of inter.effects) {
            if (!eff.startsWith('open:modal')) continue
            const v = eff.slice('open:modal:'.length)
            const modalTarget = modalByVar.get(v) ?? (linkModals && modalIds.length === 1 ? modalIds[0] : undefined)
            // A control never "opens" the overlay it already lives in.
            if (modalTarget === undefined || modalTarget === ownerId) continue
            const ev = inter.events[0] ?? 'click'
            pushEdge(cId, modalTarget, { ti: { kind: 'dynamic' }, event: ev, effect: 'open:modal', node: el, guard: null }, isDescended ? 'may' : 'must', isDescended ? 0.5 : 1, file, loc)
          }

          nodes.push({
            id: cId,
            route: null,
            componentPath: file,
            label: meta.name ?? meta.element,
            kind: 'control',
            parent: ownerId,
            control: {
              element: meta.element,
              controlType: meta.controlType,
              selector: meta.selector,
              loc,
              ...(meta.input ? { input: meta.input } : {}),
              ...(meta.name ? { name: meta.name } : {}),
              ...(inter.events.length > 0 ? { events: inter.events } : {}),
              ...(nodeEffects.length > 0 ? { effects: nodeEffects } : {}),
            },
          })
        }
      }

      // Gather controls from a file set (route tree or modal tree), capturing each
      // control's element + descent depth so the emitter can cap deep controls to may.
      const gatherControls = (files: Map<SourceFile, number>, skip?: Set<string>): ControlItem[] => {
        const out: ControlItem[] = []
        for (const [cf, depth] of files) {
          if (skip?.has(cf.getFilePath())) continue
          const file = relative(projectDir, cf.getFilePath())
          const navInfo = navIdentifiers(cf)
          if (depth === 0 && detectDynamicWidget(cf)) {
            soundiness.push({ kind: 'dynamic-widget', file, detail: 'interactive map/canvas widget: gestures (zoom/pan/drag) are runtime-only and not statically modelable' })
          }
          for (const el of allJsxElements(cf)) {
            const meta = controlMetaFor(el)
            if (meta) out.push({ el, meta, cf, navInfo, file, descended: depth > 0 })
          }
        }
        return out
      }

      // Shallower for controls: depth 1 catches direct-child buttons (a landing page's
      // could-sell/could-buy) without pulling every control from deep shared components.
      const screenFiles = screenSourceFiles(route.componentFile, 1)

      // Pass 1: detect modals + resolve each imported modal's own component file.
      for (const [cf] of screenFiles) {
        const file = relative(projectDir, cf.getFilePath())
        for (const el of allJsxElements(cf)) {
          const tag = jsxTag(el)
          if (!/(Modal|Dialog|Drawer|Sheet|Popover)$/.test(tag)) continue
          let mId = modalIdByTag.get(tag)
          if (mId === undefined) {
            mId = `m_${route.nodeId}_${midx++}`
            modalIdByTag.set(tag, mId)
            modalIds.push(mId)
            nodes.push({ id: mId, route: null, componentPath: file, label: stringAttr(el, 'title') ?? tag, kind: 'modal' })
            const base = tag.split('.')[0] ?? tag
            const mFile = resolveComponentFile(cf, base)
            if (mFile && mFile.getFilePath() !== cf.getFilePath()) {
              modalDescend.set(mId, mFile)
              modalFilePaths.add(mFile.getFilePath())
            }
          }
          // Every render of the modal (even same tag, e.g. couldSell + couldBuy) may
          // carry a distinct gating var -> all map to the one deduped modal node.
          const gate = modalGateVar(el)
          if (gate !== null) modalByVar.set(gate, mId)
        }
      }

      // Pass 1b: detect state-gated overlay sub-views — a capitalized IMPORTED component
      // gated by a *Visible state var (e.g. {profileViewVisible && <ProfileView/>}). These
      // are overlay surfaces just like modals, but tagged by convention not suffix. Kept
      // entirely separate from the modal pass — a distinct `mv_` id namespace + counter so
      // adding a view never perturbs an existing modal's positional `m_<route>_<midx>` id,
      // and they are NOT added to modalIds (they are not opened via a setShow* fallback).
      const viewIdByTag = new Map<string, string>()
      for (const [cf] of screenFiles) {
        const file = relative(projectDir, cf.getFilePath())
        for (const el of allJsxElements(cf)) {
          const tag = jsxTag(el)
          const base = tag.split('.')[0] ?? tag
          if (/(Modal|Dialog|Drawer|Sheet|Popover)$/.test(tag)) continue
          if (!/^[A-Z]/.test(base) || gatedOverlayVar(el) === null) continue
          const vFile = resolveComponentFile(cf, base)
          if (!vFile || vFile.getFilePath() === cf.getFilePath()) continue
          if (modalFilePaths.has(vFile.getFilePath()) || viewIdByTag.has(tag)) continue
          const vId = `mv_${route.nodeId}_${vidx++}`
          viewIdByTag.set(tag, vId)
          nodes.push({ id: vId, route: null, componentPath: file, label: tag, kind: 'modal' })
          modalDescend.set(vId, vFile)
          modalFilePaths.add(vFile.getFilePath())
        }
      }

      // Pass 2: screen controls — skipping files owned by a descended overlay (their
      // controls belong to the overlay node, emitted in pass 3).
      emitControls(route.nodeId, gatherControls(screenFiles, modalFilePaths), false, true)

      // Pass 3: per imported overlay, descend its own component tree (depth 1 reaches an
      // overlay that delegates to a child, e.g. SignupLoginModal -> LoginOrSignup) and
      // emit its controls under the overlay node, every nav capped to may. Each descent
      // skips the OTHER overlays' root files so a nested overlay's controls are emitted
      // once (under that nested overlay's own pass), never double-counted.
      const overlayRoots = new Set([...modalDescend.values()].map((f) => f.getFilePath()))
      for (const [mId, mFile] of modalDescend) {
        const skip = new Set([...overlayRoots].filter((p) => p !== mFile.getFilePath()))
        emitControls(mId, gatherControls(screenSourceFiles(mFile, 1), skip), true, false)
      }
    }
  }

  // Shared/context navigations: a nav in a NON-route file (context/hook) to a nested
  // sub-route is attributed to that route's declared parent as `may`, witnessed by the
  // call — e.g. a profile context's push(subviewPaths[sv]) / push('/profile/x')
  // connects /profile -> /profile/sell-listings, which no route component renders.
  const routeFilePaths = new Set<string>(routes.flatMap((r) => (r.componentFile ? [String(r.componentFile.getFilePath())] : [])))
  for (const sf of project.getSourceFiles()) {
    if (routeFilePaths.has(String(sf.getFilePath()))) continue
    for (const t of collectTargets(sf)) {
      const lc = sf.getLineAndColumnAtPos(t.node.getStart())
      const loc = { line: lc.line, col: lc.column }
      const file = relative(projectDir, sf.getFilePath())
      // Resolve the call's target(s) to declared routes: literal/enum -> exact match;
      // template (`/profile/price-estimations/${id}`) -> prefix candidates.
      const hits: RouteLike[] = []
      if (t.ti.kind === 'literal') {
        const { exact } = matchLiteralAll(t.ti.value, routeLikes)
        if (exact) hits.push(exact)
      } else if (t.ti.kind === 'enum') {
        for (const v of t.ti.values) {
          const { exact } = matchLiteralAll(v, routeLikes)
          if (exact) hits.push(exact)
        }
      } else if (t.ti.kind === 'template') {
        hits.push(...matchPrefix(t.ti.staticPrefix, routeLikes))
      }
      for (const hit of hits) {
        const parent = parentRouteOf(hit.fullPath, routeLikes)
        if (!parent) continue
        pushEdge(parent.nodeId, hit.nodeId, { ...t, ti: { kind: 'literal', value: hit.fullPath }, ruleId: 'rr.shared-nav' }, 'may', 0.5, file, loc)
      }
    }
  }

  const graph = {
    version: 0 as const,
    meta: {
      adapter: adapterName,
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
