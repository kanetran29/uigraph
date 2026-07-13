// Project construction and module/component/function resolution: build the ts-morph
// project (with jsconfig/tsconfig baseUrl+paths alias support), resolve relative and
// bare import specifiers to in-project source files, walk a screen's child-component
// tree, resolve JSX tags and identifiers to their function nodes, and recognize
// custom route-wrapper components.

import { Node, Project, SyntaxKind, ts } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { allJsxElements, findAttr, getComponentName, jsxTag } from './jsx'

/**
 * The non-relative import resolution config read from an app's jsconfig/tsconfig:
 * the absolute baseUrl directory and any `paths` alias map (with the absolute base
 * each alias resolves against). Many real react apps import route components by a
 * bare specifier (`import Login from "pages/Login"`) that only resolves through
 * baseUrl/paths — without this the route component never resolves and the screen
 * produces zero edges.
 */
interface AliasConfig {
  baseUrl: string | null
  paths: { prefix: string; targets: string[] }[]
}

const aliasConfigByProject = new WeakMap<Project, AliasConfig>()

/**
 * Read baseUrl + paths from `projectDir`'s jsconfig.json or tsconfig.json (best-effort,
 * tolerant of comments/trailing commas via a light strip). Returns absolute paths so the
 * resolver can join a bare specifier directly. A missing/unreadable config yields an empty
 * config (relative-only resolution, the prior behaviour).
 */
function readAliasConfig(projectDir: string): AliasConfig {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    let raw: string
    try {
      raw = readFileSync(join(projectDir, name), 'utf8')
    } catch {
      continue
    }
    // ts.parseConfigFileTextToJson handles JSONC (comments, trailing commas) correctly —
    // a naive regex strip mis-handles `/*` inside path globs like ["./src/client/*"].
    const { config, error } = ts.parseConfigFileTextToJson(join(projectDir, name), raw)
    if (error || !config) continue
    const parsed = config as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
    const co = parsed.compilerOptions ?? {}
    const baseUrl = co.baseUrl != null ? join(projectDir, co.baseUrl) : null
    const pathsBase = baseUrl ?? projectDir
    const paths: AliasConfig['paths'] = []
    for (const [pattern, targets] of Object.entries(co.paths ?? {})) {
      const prefix = pattern.replace(/\*$/, '')
      paths.push({ prefix, targets: targets.map((t) => join(pathsBase, t.replace(/\*$/, ''))) })
    }
    if (baseUrl != null || paths.length > 0) return { baseUrl, paths }
  }
  return { baseUrl: null, paths: [] }
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
  aliasConfigByProject.set(project, readAliasConfig(projectDir))
  project.addSourceFilesAtPaths([`${projectDir}/src/**/*.{ts,tsx,js,jsx}`, `!${projectDir}/**/node_modules/**`])
  if (project.getSourceFiles().length === 0) {
    project.addSourceFilesAtPaths([`${projectDir}/**/*.{ts,tsx,js,jsx}`, `!${projectDir}/**/node_modules/**`])
  }
  return project
}

const RESOLVE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']

/** Try each candidate absolute base path with the known extensions, returning the first in-project file. */
function tryBases(project: Project, bases: string[]): SourceFile | undefined {
  for (const base of bases) {
    for (const ext of RESOLVE_EXTS) {
      const found = project.getSourceFile(base + ext)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Resolve an import specifier to an in-project source file. A relative ('.'/'./'/'../')
 * specifier resolves against the importer's directory; a bare specifier resolves against
 * the app's jsconfig/tsconfig `paths` aliases first, then its `baseUrl` — so a real app's
 * `import Login from "pages/Login"` (baseUrl: "src") finds src/pages/Login. An absolute
 * specifier is rejected; a bare specifier with no alias config is rejected (a node_modules
 * package, never an in-project screen).
 */
function resolveRelative(sf: SourceFile, specifier: string): SourceFile | undefined {
  const project = sf.getProject()
  if (specifier.startsWith('.')) {
    return tryBases(project, [join(dirname(sf.getFilePath()), specifier)])
  }
  if (isAbsolute(specifier)) return undefined
  const cfg = aliasConfigByProject.get(project)
  if (!cfg) return undefined
  const bases: string[] = []
  for (const { prefix, targets } of cfg.paths) {
    if (!specifier.startsWith(prefix)) continue
    const rest = specifier.slice(prefix.length)
    for (const t of targets) bases.push(join(t, rest))
  }
  if (cfg.baseUrl != null) bases.push(join(cfg.baseUrl, specifier))
  return tryBases(project, bases)
}

/**
 * The source file a direct `() => import('…')` arrow loads, or undefined for any
 * other shape (async bodies, `.then` chains, non-literal specifiers) — used for
 * React.lazy components and data-router route-level `lazy` entries.
 */
export function dynamicImportTarget(sf: SourceFile, fn: Node): SourceFile | undefined {
  if (!Node.isArrowFunction(fn)) return undefined
  const body = fn.getBody()
  if (!Node.isCallExpression(body)) return undefined
  if (body.getExpression().getKind() !== SyntaxKind.ImportKeyword) return undefined
  const arg = body.getArguments()[0]
  if (!arg || !Node.isStringLiteral(arg)) return undefined
  return resolveRelative(sf, arg.getLiteralValue())
}

/**
 * Resolve a `const X = lazy(() => import('./file'))` (also `React.lazy(...)`)
 * declaration in `sf` to the lazily imported source file, so a lazy route
 * component's file is still scanned for navigation. Returns undefined when `name`
 * is not such a declaration or the import is not a direct literal `import()`.
 */
export function resolveLazyComponentFile(sf: SourceFile, name: string): SourceFile | undefined {
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (vd.getNameNode().getText() !== name) continue
    const init = vd.getInitializer()
    if (!init || !Node.isCallExpression(init)) return undefined
    const callee = init.getExpression()
    const isLazy = (Node.isIdentifier(callee) && callee.getText() === 'lazy') || (Node.isPropertyAccessExpression(callee) && callee.getName() === 'lazy')
    if (!isLazy) return undefined
    const arg = init.getArguments()[0]
    return arg ? dynamicImportTarget(sf, arg) : undefined
  }
  return undefined
}

/**
 * Whether a component function receives a `children` prop (destructured parameter
 * or `props.children` read) — the children-forwarding wrapper pattern
 * (`<ProtectedRoute><Account/></ProtectedRoute>`) whose rendered content at a route
 * is the wrapped child, not the wrapper itself.
 */
export function usesChildrenProp(fn: Node): boolean {
  for (const id of fn.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getText() !== 'children') continue
    const p = id.getParent()
    if (Node.isBindingElement(p) || Node.isParameterDeclaration(p)) return true
    if (Node.isPropertyAccessExpression(p) && p.getNameNode() === id) return true
  }
  return false
}

/** Resolve a route's component identifier to its backing source file. */
export function resolveComponentFile(sf: SourceFile, name: string): SourceFile | undefined {
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
 * Real-world SPAs render most real navigation one or more component-hops below
 * the route (a button in a nested <LandingPage>), so a route component scanned
 * alone misses them. Bounded by maxDepth + a visited set; node_modules + framework
 * wrappers are skipped. Returns each file with its descent depth (0 = the route
 * component itself); callers cap depth>0 navigations to `may` since a child's
 * render is not statically guaranteed.
 */
export function screenSourceFiles(root: SourceFile, maxDepth: number): Map<SourceFile, number> {
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

/** Parameter names of a function-like node, or [] when it is not function-like. */
export function fnParams(fn: Node): string[] {
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    return fn.getParameters().map((p) => p.getNameNode().getText())
  }
  return []
}

/** Find the named function/arrow declared in a file (for indirect event handlers). */
export function resolveFunctionNode(sf: SourceFile, name: string): Node | undefined {
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

/** Find a project-local function exported as `default` (only direct declarations). */
function resolveDefaultFunction(sf: SourceFile): Node | undefined {
  for (const fd of sf.getFunctions()) {
    if (fd.isDefaultExport()) return fd
  }
  return undefined
}

/** Resolve a named/default import of `name` in `sf` to its function node — relative or alias modules. */
export function resolveImportedFunction(sf: SourceFile, name: string): Node | undefined {
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (!spec.startsWith('.') && !aliasConfigByProject.get(sf.getProject())) continue
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
 * Resolve a JSX component tag used in `sf` to its function definition: a locally
 * declared function/arrow, else a named/default relative import. Returns undefined
 * for library components and unresolved tags, so the wrapper check never leaves app code.
 */
export function resolveExportedComponent(sf: SourceFile, name: string): Node | undefined {
  return resolveFunctionNode(sf, name) ?? resolveImportedFunction(sf, name)
}

/**
 * Whether a function-component node is a custom ROUTE WRAPPER: its JSX renders an
 * internal <Route> that forwards the caller's props — either via a JSX spread
 * ({...rest}/{...props}) onto the <Route>, or by binding the Route's `path` to one
 * of the component's own parameters/destructured props. Apps like taniarascia/takenote
 * wrap every route in PublicRoute/PrivateRoute that proxy `path`+`component` to an
 * inner <Route>; recognizing them lets a wrapper USAGE count as a real route. The
 * forwarding check keeps it sound — an ordinary component that merely renders some
 * fixed <Route> internally (without forwarding the call-site path) is NOT treated as
 * a wrapper, so its usages don't fabricate routes.
 */
export function isRouteWrapperComponent(fn: Node): boolean {
  const params = new Set(fnParams(fn))
  for (const id of fn.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (Node.isBindingElement(id.getParent()) || Node.isParameterDeclaration(id.getParent())) params.add(id.getText())
  }
  for (const el of [...fn.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement), ...fn.getDescendantsOfKind(SyntaxKind.JsxElement)]) {
    if (jsxTag(el) !== 'Route') continue
    const attrs = Node.isJsxElement(el) ? el.getOpeningElement().getAttributes() : (el as import('ts-morph').JsxSelfClosingElement).getAttributes()
    for (const a of attrs) {
      if (Node.isJsxSpreadAttribute(a)) {
        const e = a.getExpression()
        if (Node.isIdentifier(e) && params.has(e.getText())) return true
      }
    }
    const pathInit = findAttr(el, 'path')?.getInitializer()
    if (pathInit && Node.isJsxExpression(pathInit)) {
      const inner = pathInit.getExpression()
      if (inner && Node.isIdentifier(inner) && params.has(inner.getText())) return true
    }
  }
  return false
}

/**
 * The component identifier passed to a route element at the CALL SITE, via
 * `component={X}` or `element={<X/>}` — reused by both plain <Route> and custom
 * route-wrapper usages. Returns null when no component prop is present.
 */
function callSiteComponentName(el: Node): string | null {
  return getComponentName(el)
}

/** Resolve a route element's call-site component prop to its backing source file. */
export function callSiteComponentFile(sf: SourceFile, el: Node): { name: string | null; file: SourceFile | undefined } {
  const name = callSiteComponentName(el)
  const file = name ? resolveComponentFile(sf, name) : undefined
  return { name, file }
}
