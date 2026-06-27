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
import type { ArrayLiteralExpression, ObjectLiteralExpression, SourceFile } from 'ts-morph'
import { dirname, join, relative } from 'node:path'
import type { ControlInput, ControlSelector, ExtractOptions, ExtractResult, GraphEdge, GraphNode, SoundinessNote } from '@uigraph/core'
import { routeToNodeId, edgeId, controlNodeId } from './ids'
import { matchLiteral, matchPrefix, type RouteLike } from './matcher'
import { analyzeCanActivate, type GuardInfo } from './guards'
import { analyzeInputBindings } from './inputs'

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
  guards: GuardInfo[]
  routeObj: ObjectLiteralExpression
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

/**
 * Extract the import specifier string from a lazy loader arrow function such as
 * `() => import('./x.component')`, returning `'./x.component'`, or null when the
 * initializer is not a recognizable dynamic-import loader.
 */
function lazyImportSpecifier(prop: ObjectLiteralExpression, name: string): string | null {
  const p = prop.getProperty(name)
  if (!p || !Node.isPropertyAssignment(p)) return null
  const init = p.getInitializer()
  if (!init || !Node.isArrowFunction(init)) return null
  for (const call of init.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue
    const arg = call.getArguments()[0]
    if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) return arg.getLiteralValue()
  }
  return null
}

/** Pick the @Component-decorated class name of a source file (default export or first), or null. */
function componentClassName(sf: SourceFile): string | null {
  for (const cls of sf.getClasses()) {
    if (cls.getDecorators().some((d) => d.getName() === 'Component')) return cls.getName() ?? null
  }
  return null
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

/**
 * Analyze a `canActivate: [A, B]` array into structured guard descriptors.
 * Covers class-reference guards, named functional guards (`[requireAuth]`), and
 * inline arrow guards (`[() => inject(X)...]`); the route's source file is needed
 * to resolve named functional-guard consts.
 */
function canActivateGuards(sf: SourceFile, obj: ObjectLiteralExpression): GuardInfo[] {
  const prop = obj.getProperty('canActivate')
  if (!prop || !Node.isPropertyAssignment(prop)) return []
  const init = prop.getInitializer()
  if (!init || !Node.isArrayLiteralExpression(init)) return []
  return analyzeCanActivate(sf, init.getElements())
}

/** Join a parent route path with an own segment, normalizing to a leading-slash route. */
function joinRoutePath(parent: string, own: string): string {
  if (own === '**' || own === '*' || own === '/*') return '*'
  const parentSegs = parent === '/' ? [] : segments(parent)
  const ownSegs = own.split('/').filter(Boolean)
  const all = [...parentSegs, ...ownSegs]
  return all.length === 0 ? '/' : '/' + all.join('/')
}

/** Split a route path into non-empty segments. */
function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0)
}

/**
 * Find every top-level `Routes`-shaped array literal in a source file
 * (`const routes: Routes = [...]`, including a `default routes` export). Returns
 * the array literals so the caller can recurse into their route objects.
 */
function findRouteArrays(sf: SourceFile): ArrayLiteralExpression[] {
  const out: ArrayLiteralExpression[] = []
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const isRoutesTyped = vd.getTypeNode()?.getText() === 'Routes'
    const init = vd.getInitializer()
    if (!init || !Node.isArrayLiteralExpression(init)) continue
    const looksLikeRoutes = isRoutesTyped || init.getElements().some((e) => Node.isObjectLiteralExpression(e) && e.getProperty('path') !== undefined)
    if (looksLikeRoutes) out.push(init)
  }
  return out
}

/**
 * Recursively walk a route array literal, emitting one RouteInfo per route
 * object that declares a `path`. Inline `children` are visited with the parent
 * path prefixed; `loadChildren: () => import('./x.routes')` is followed into the
 * imported module's route array; `component` and `loadComponent` both resolve to
 * a backing component file. Deduplicates by node id (first declaration wins).
 */
function walkRouteArray(arr: ArrayLiteralExpression, sf: SourceFile, parentPath: string, out: Map<string, RouteInfo>, loadedChildFiles: Set<string>): void {
  for (const el of arr.getElements()) {
    if (!Node.isObjectLiteralExpression(el)) continue
    const ownPath = stringProp(el, 'path')
    if (ownPath === null) continue
    const fullPath = joinRoutePath(parentPath, ownPath)
    const componentName = identifierProp(el, 'component')
    let componentFile = componentName ? resolveImportedFile(sf, componentName) : undefined
    let resolvedName = componentName
    if (!componentFile) {
      const spec = lazyImportSpecifier(el, 'loadComponent')
      if (spec) {
        componentFile = resolveRelative(sf, spec)
        if (componentFile) resolvedName = componentClassName(componentFile)
      }
    }
    const nodeId = routeToNodeId(fullPath)
    if (!out.has(nodeId)) {
      out.set(nodeId, { fullPath, nodeId, componentName: resolvedName, componentFile, guards: canActivateGuards(sf, el), routeObj: el })
    }
    const childrenProp = el.getProperty('children')
    if (childrenProp && Node.isPropertyAssignment(childrenProp)) {
      const childInit = childrenProp.getInitializer()
      if (childInit && Node.isArrayLiteralExpression(childInit)) walkRouteArray(childInit, sf, fullPath, out, loadedChildFiles)
    }
    const childSpec = lazyImportSpecifier(el, 'loadChildren')
    if (childSpec) {
      const childModule = resolveRelative(sf, childSpec)
      if (childModule) {
        loadedChildFiles.add(childModule.getFilePath())
        for (const childArr of findRouteArrays(childModule)) walkRouteArray(childArr, childModule, fullPath, out, loadedChildFiles)
      }
    }
  }
}

/**
 * Collect declared routes (including nested + lazy) into route nodes. Files
 * reached via `loadChildren` are scanned only under their parent prefix, never
 * again at the root, so a child route array contributes a single correct path.
 */
function collectRoutes(project: Project): RouteInfo[] {
  const byNodeId = new Map<string, RouteInfo>()
  const loadedChildFiles = collectLoadChildrenTargets(project)
  for (const sf of project.getSourceFiles()) {
    if (loadedChildFiles.has(sf.getFilePath())) continue
    for (const arr of findRouteArrays(sf)) walkRouteArray(arr, sf, '/', byNodeId, loadedChildFiles)
  }
  return [...byNodeId.values()]
}

/** Pre-pass: resolve every `loadChildren` import target across the project so those modules are scanned only under their parent prefix. */
function collectLoadChildrenTargets(project: Project): Set<string> {
  const targets = new Set<string>()
  for (const sf of project.getSourceFiles()) {
    for (const obj of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const spec = lazyImportSpecifier(obj, 'loadChildren')
      if (!spec) continue
      const mod = resolveRelative(sf, spec)
      if (mod) targets.add(mod.getFilePath())
    }
  }
  return targets
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

/** A component's template text, with the witness position: an offset into `sf`, or an external HTML file path. */
interface ComponentTemplate {
  text: string
  start: number
  externalFile?: string
}

/**
 * Read a component's template, from an inline `@Component({ template })` string
 * or, failing that, an external `templateUrl: './x.html'` sibling resolved
 * relative to the component file. Inline templates carry their `.ts` offset;
 * external ones carry the html file path so witnesses point at the real source.
 */
function inlineTemplate(sf: SourceFile): ComponentTemplate | null {
  for (const cls of sf.getClasses()) {
    for (const dec of cls.getDecorators()) {
      if (dec.getName() !== 'Component') continue
      const arg = dec.getArguments()[0]
      if (!arg || !Node.isObjectLiteralExpression(arg)) continue
      const inline = stringProp(arg, 'template')
      if (inline !== null) {
        const prop = arg.getProperty('template')
        const init = Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined
        return { text: inline, start: init ? init.getStart() : arg.getStart() }
      }
      const url = stringProp(arg, 'templateUrl')
      if (url !== null) {
        const html = readExternalTemplate(sf, url)
        if (html !== null) return { text: html, start: 0, externalFile: resolveTemplatePath(sf, url) }
      }
    }
  }
  return null
}

/** Resolve a templateUrl relative to the component file into an absolute path. */
function resolveTemplatePath(sf: SourceFile, url: string): string {
  return join(dirname(sf.getFilePath()), url)
}

/**
 * Read an external HTML template's contents, preferring a source file already
 * registered at that path (covers in-memory projects) and falling back to the
 * project filesystem (covers on-disk projects). Returns null when unavailable.
 */
function readExternalTemplate(sf: SourceFile, url: string): string | null {
  const path = resolveTemplatePath(sf, url)
  const project = sf.getProject()
  const registered = project.getSourceFile(path)
  if (registered) return registered.getFullText()
  const fs = project.getFileSystem()
  try {
    if (!fs.fileExistsSync(path)) return null
    return fs.readFileSync(path)
  } catch {
    return null
  }
}

interface RawTarget {
  ti: TargetInfo
  event: string
  effect: string
  ruleId: string
  loc: { line: number; col: number }
  file?: string
}

const STATIC_LINK_RE = /(?<!\[)\brouterLink\s*=\s*"([^"]*)"/g
const BOUND_LINK_RE = /\[routerLink\]\s*=\s*"([^"]*)"/g

/**
 * Parse routerLink / [routerLink] attributes out of a component's template
 * (inline or external). Each target's witness loc is its line within the
 * template text; for an external template the witness file is the html path.
 */
function templateTargets(sf: SourceFile, projectDir: string): RawTarget[] {
  const tpl = inlineTemplate(sf)
  if (!tpl) return []
  const out: RawTarget[] = []
  const locAt = (index: number): { line: number; col: number } => templateLoc(sf, tpl, index)
  const file = tpl.externalFile ? relative(projectDir, tpl.externalFile) : undefined
  for (const m of tpl.text.matchAll(STATIC_LINK_RE)) {
    out.push({ ti: { kind: 'literal', value: m[1] ?? '' }, event: 'click:routerLink', effect: 'navigate', ruleId: 'ng.router-link', loc: locAt(m.index), file })
  }
  for (const m of tpl.text.matchAll(BOUND_LINK_RE)) {
    out.push({ ti: classifyBoundLink(m[1] ?? ''), event: 'click:routerLink', effect: 'navigate', ruleId: 'ng.router-link', loc: locAt(m.index), file })
  }
  return out
}

/** Witness loc for a position inside a template: a line within an external html file, or the .ts offset for inline templates. */
function templateLoc(sf: SourceFile, tpl: ComponentTemplate, index: number): { line: number; col: number } {
  if (tpl.externalFile) {
    const line = tpl.text.slice(0, index).split('\n').length
    return { line, col: 1 }
  }
  const lc = sf.getLineAndColumnAtPos(tpl.start)
  return { line: lc.line, col: lc.column }
}

/**
 * Classify a bound [routerLink] expression's textual value. Handles bare string
 * literals ("'/x'" -> literal), string concatenation ("'/x/' + id" -> prefix
 * "/x/"), and array forms ("['/tag', tag]" -> prefix "/tag/"; "['/about']" ->
 * literal "/about"). Anything else over-approximates to dynamic.
 */
function classifyBoundLink(expr: string): TargetInfo {
  const trimmed = expr.trim()
  const literalOnly = /^'([^']*)'$/.exec(trimmed) ?? /^"([^"]*)"$/.exec(trimmed)
  if (literalOnly) return { kind: 'literal', value: literalOnly[1] ?? '' }
  const concatPrefix = /^'([^']*)'\s*\+/.exec(trimmed) ?? /^"([^"]*)"\s*\+/.exec(trimmed)
  if (concatPrefix) return { kind: 'template', staticPrefix: concatPrefix[1] ?? '' }
  if (trimmed.startsWith('[')) return classifyLinkArray(trimmed)
  return { kind: 'dynamic' }
}

/**
 * Classify an array commands expression `['/seg', ...]`. A single static element
 * is a literal; a leading static element followed by more elements is a template
 * whose prefix is the static segments joined with trailing slash. A non-literal
 * first element is dynamic.
 */
function classifyLinkArray(arr: string): TargetInfo {
  const inner = arr.slice(1, arr.lastIndexOf(']'))
  const parts = splitTopLevel(inner)
  if (parts.length === 0) return { kind: 'dynamic' }
  const lits: string[] = []
  for (const p of parts) {
    const lit = /^'([^']*)'$/.exec(p) ?? /^"([^"]*)"$/.exec(p)
    if (!lit) break
    lits.push(lit[1] ?? '')
  }
  if (lits.length === 0) return { kind: 'dynamic' }
  const staticPath = lits.join('/').replace(/\/+/g, '/')
  if (lits.length === parts.length) return { kind: 'literal', value: staticPath }
  return { kind: 'template', staticPrefix: staticPath.endsWith('/') ? staticPath : staticPath + '/' }
}

/** Split a comma-separated expression list at top level (ignoring commas inside quotes/brackets). */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (const ch of s) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === ']' || ch === ')' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      const t = cur.trim()
      if (t.length > 0) out.push(t)
      cur = ''
      continue
    }
    cur += ch
  }
  const t = cur.trim()
  if (t.length > 0) out.push(t)
  return out
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

// --- Controls (parity with React): parse the inline template HTML for interactive
// elements, give each a stable selector, and wire control->nav edges when a
// (click)/(submit) handler calls a component method that navigates. ---

/** A control parsed out of an Angular template. */
interface NgControl {
  tag: string
  controlType: string
  attrs: Map<string, string>
  text: string | undefined
  events: string[]
  handlers: string[]
  selector: ControlSelector
  input: ControlInput | undefined
}

/** Parse an HTML open-tag attribute string into a name→value map (Angular bindings kept verbatim). */
function parseAttrs(attrStr: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /([@([]?[\w:-]+[)\]]?)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrStr)) !== null) {
    if (m[1] === undefined || m[1].length === 0) continue
    out.set(m[1], m[2] ?? m[3] ?? '')
  }
  return out
}

/** Classify a tag+attrs as a control type, or null when not interactive. */
function ngControlType(tag: string, attrs: Map<string, string>): string | null {
  const lower = tag.toLowerCase()
  if (lower === 'button') return 'button'
  if (lower === 'input') {
    const t = (attrs.get('type') ?? 'text').toLowerCase()
    if (t === 'checkbox' || t === 'radio') return 'checkbox'
    if (t === 'submit' || t === 'button') return 'button'
    if (t === 'file') return 'file'
    return 'input'
  }
  if (lower === 'textarea') return 'richtext'
  if (lower === 'select') return 'select'
  if (lower === 'form') return 'form'
  for (const k of attrs.keys()) if (/^\([a-zA-Z]+\)$/.test(k)) return 'element'
  return null
}

/** The DOM event names from Angular `(event)` bindings on the element. */
function ngEvents(attrs: Map<string, string>): string[] {
  const out: string[] = []
  for (const k of attrs.keys()) {
    const m = /^\(([a-zA-Z]+)\)$/.exec(k)
    if (m && m[1] !== undefined) out.push(m[1])
  }
  return out
}

/** The handler EXPRESSIONS bound to click/submit/keydown-ish events (for nav tracing). */
function ngHandlers(attrs: Map<string, string>): string[] {
  const out: string[] = []
  for (const [k, v] of attrs) if (/^\((click|submit|keydown|keyup|keypress|change)\)$/.test(k) && v.length > 0) out.push(v)
  return out
}

/** The ARIA role a control exposes, from an explicit role attr or its tag/type. */
function ngRole(tag: string, attrs: Map<string, string>, controlType: string): string | undefined {
  const explicit = attrs.get('role')
  if (explicit !== undefined) return explicit
  if (tag.toLowerCase() === 'a') return 'link'
  switch (controlType) {
    case 'button':
      return 'button'
    case 'checkbox':
      return (attrs.get('type') ?? '').toLowerCase() === 'radio' ? 'radio' : 'checkbox'
    case 'richtext':
      return 'textbox'
    case 'select':
      return 'combobox'
    case 'form':
      return 'form'
    case 'input':
      return (attrs.get('type') ?? 'text').toLowerCase() === 'search' ? 'searchbox' : 'textbox'
    default:
      return undefined
  }
}

/** Stable selector: data-testid -> role+name -> formControlName/id/name -> text -> structural. */
function ngSelector(tag: string, attrs: Map<string, string>, controlType: string, text: string | undefined): ControlSelector {
  const testid = attrs.get('data-testid') ?? attrs.get('data-test-id')
  if (testid !== undefined) return { strategy: 'testid', value: testid }
  const role = ngRole(tag, attrs, controlType)
  const accName = attrs.get('aria-label') ?? attrs.get('placeholder') ?? (text !== undefined && text.length > 0 ? text : undefined) ?? attrs.get('name')
  if (role !== undefined && accName !== undefined) return { strategy: 'role-name', value: `${role}|${accName}` }
  const label = attrs.get('formControlName') ?? attrs.get('id') ?? attrs.get('name')
  if (label !== undefined) return { strategy: 'label', value: label }
  if (text !== undefined && text.length > 0) return { strategy: 'text', value: text }
  return { strategy: 'structural', value: tag.toLowerCase() }
}

/** Input constraints (type/required/pattern) for a field control. */
function ngInput(attrs: Map<string, string>, controlType: string): ControlInput | undefined {
  if (!['input', 'checkbox', 'richtext', 'select'].includes(controlType)) return undefined
  const type = attrs.get('type')
  const pattern = attrs.get('pattern')
  const required = attrs.has('required')
  if (type === undefined && pattern === undefined && !required) return undefined
  return { ...(type !== undefined ? { type } : {}), ...(required ? { required: true } : {}), ...(pattern !== undefined ? { pattern } : {}) }
}

/** Parse interactive controls out of a component's inline template HTML. */
function parseControls(sf: SourceFile): NgControl[] {
  const tpl = inlineTemplate(sf)
  if (!tpl) return []
  const html = tpl.text
  const out: NgControl[] = []
  const OPEN = /<([a-zA-Z][\w-]*)((?:[^<>]|"[^"]*")*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = OPEN.exec(html)) !== null) {
    const tag = m[1] ?? ''
    const attrs = parseAttrs(m[2] ?? '')
    const controlType = ngControlType(tag, attrs)
    if (controlType === null) continue
    let text: string | undefined
    if (m[3] !== '/' && tag.toLowerCase() !== 'input') {
      const close = html.indexOf(`</${tag}`, OPEN.lastIndex)
      if (close !== -1) {
        const inner = html.slice(OPEN.lastIndex, close).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        if (inner.length > 0) text = inner
      }
    }
    out.push({ tag, controlType, attrs, text, events: ngEvents(attrs), handlers: ngHandlers(attrs), selector: ngSelector(tag, attrs, controlType, text), input: ngInput(attrs, controlType) })
  }
  return out
}

/** Nearest enclosing if/ternary/&& condition as symbolic text, or null. */
function getGuard(node: Node): string | null {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) return null
    if (Node.isIfStatement(parent)) {
      const cond = parent.getExpression().getText()
      const then = parent.getThenStatement()
      if (then && node.getStart() >= then.getStart() && node.getEnd() <= then.getEnd()) return cond
      const els = parent.getElseStatement()
      if (els && node.getStart() >= els.getStart() && node.getEnd() <= els.getEnd()) return `!(${cond})`
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
  // a preceding early-return/throw in the same block
  const block = node.getFirstAncestorByKind(SyntaxKind.Block)
  if (block) {
    for (const stmt of block.getStatements()) {
      if (stmt.getEnd() > node.getStart()) break
      if (Node.isIfStatement(stmt) && /return|throw/.test(stmt.getThenStatement()?.getText() ?? '')) return 'early-return'
    }
  }
  return null
}

/** Navigations a component method performs: trace `methodName` to its class method, collect router.navigate/navigateByUrl with guards. */
function methodNavTargets(sf: SourceFile, methodName: string): { ti: TargetInfo; event: string; effect: string; ruleId: string; loc: { line: number; col: number }; guard: string | null }[] {
  const out: { ti: TargetInfo; event: string; effect: string; ruleId: string; loc: { line: number; col: number }; guard: string | null }[] = []
  for (const cls of sf.getClasses()) {
    const method = cls.getMethod(methodName)
    if (!method) continue
    for (const call of method.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression()
      if (!Node.isPropertyAccessExpression(expr)) continue
      const member = expr.getName()
      if (member !== 'navigate' && member !== 'navigateByUrl') continue
      const lc = sf.getLineAndColumnAtPos(call.getStart())
      const loc = { line: lc.line, col: lc.column }
      const guard = getGuard(call) ?? extraConditionGuard(call)
      if (member === 'navigateByUrl') {
        out.push({ ti: classifyTarget(call.getArguments()[0]), event: 'click', effect: 'router.navigateByUrl', ruleId: 'ng.control.navigate-by-url', loc, guard })
      } else {
        const arg0 = call.getArguments()[0]
        const first = arg0 && Node.isArrayLiteralExpression(arg0) ? arg0.getElements()[0] : undefined
        out.push({ ti: classifyTarget(first), event: 'click', effect: 'router.navigate', ruleId: 'ng.control.navigate', loc, guard })
      }
    }
    return out
  }
  return out
}

/** The reachability gate a target route's `canActivate` guards impose on an incoming edge. */
interface Gate {
  guarded: boolean
  guardTexts: string[]
  confidence: number
  asyncGuards: GuardInfo[]
  signalGuards: GuardInfo[]
}

const FUNCTIONAL_GUARD_CONFIDENCE = 0.6
const ASYNC_GUARD_CONFIDENCE = 0.5

/**
 * Reduce a target route's guards to a gate. A guard whose body is the literal
 * `true` does not gate (it always passes), so it is dropped; every other guard
 * gates the edge to `may`. Confidence is the minimum across guards:
 * Observable/Promise-returning guards (whose body cannot be evaluated statically)
 * pull it down to ~0.5, otherwise functional/class guards sit at 0.6. The
 * `asyncGuards` are surfaced so the caller can owe one soundiness note each.
 */
function gateFromGuards(guards: GuardInfo[]): Gate {
  const gating = guards.filter((g) => g.literalBoolean !== true)
  if (gating.length === 0) return { guarded: false, guardTexts: [], confidence: 1, asyncGuards: [], signalGuards: [] }
  const asyncGuards = gating.filter((g) => g.async)
  const signalGuards = gating.filter((g) => g.signal === true)
  const confidence = asyncGuards.length > 0 ? ASYNC_GUARD_CONFIDENCE : FUNCTIONAL_GUARD_CONFIDENCE
  return { guarded: true, guardTexts: gating.map((g) => g.text), confidence, asyncGuards, signalGuards }
}

/**
 * Push one soundiness note per distinct undecidable guard on `routePath`: an
 * `async-guard` note for an Observable/Promise-returning guard (decided at
 * runtime) and a `signal-guard` note for a guard that reads its decision from an
 * Angular signal (resolves synchronously but is reactive, so its value can change
 * between map-time and run-time). Deduped via `seen` (keyed by kind+route+guard)
 * so a guard gating several incoming edges still yields a single note per kind.
 */
function noteGuards(gate: Gate, routePath: string, sink: SoundinessNote[], seen: Set<string>): void {
  for (const g of gate.asyncGuards) {
    const key = `async ${routePath} ${g.text}`
    if (seen.has(key)) continue
    seen.add(key)
    sink.push({ kind: 'async-guard', detail: `guard "${g.text}" on route ${routePath} returns an Observable/Promise; gate decided at runtime` })
  }
  for (const g of gate.signalGuards) {
    const key = `signal ${routePath} ${g.text}`
    if (seen.has(key)) continue
    seen.add(key)
    sink.push({ kind: 'signal-guard', detail: `guard "${g.text}" on route ${routePath} reads an Angular signal; gate resolves synchronously but is reactive (value may change between map-time and run-time)` })
  }
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
