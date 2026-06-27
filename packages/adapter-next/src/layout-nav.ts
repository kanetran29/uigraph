// Next.js App Router layout-and-deep-component navigation. The shared react engine
// (extractGraphFromRoutes) only scans a route's page.tsx + its rendered descendants to a
// shallow depth, so it misses the canonical App Router pattern: shared chrome (Navbar,
// Header → MainNav) lives in layout.tsx files that WRAP every page but are not rendered BY
// any page, and custom link wrappers (CustomLink, a <Button href>) hide the href one
// component hop down. This pass walks the layout chain that applies to each route, descends
// its component tree deeply, recognizes href on next/link <Link>, raw <a>, and any custom
// component, and emits `may` edges to internal routes (a layout renders conditionally per
// route, and a wrapper's anchor output is a heuristic, so neither is asserted as `must`).
// Golden invariant preserved: every edge has a static href witness; external/anchor/dynamic
// hrefs never produce an edge.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { Node, SyntaxKind } from 'ts-morph'
import type { Project, SourceFile } from 'ts-morph'
import type { GraphEdge, Modality } from '@uigraph/core'
import { edgeId, matchLiteralAll, matchPrefix, type RouteSeed } from '@uigraph/adapter-react'

const LAYOUT_RE = /(^|\/)layout\.(tsx|ts|jsx|js)$/
const RESOLVE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
const FRAMEWORK_TAG_RE = /(Provider|Consumer|Context|Suspense|ErrorBoundary|Fragment|Boundary)$/
const MAX_DESCENT = 4

/** A literal/template href classification limited to what yields a sound internal edge. */
type HrefTarget = { kind: 'literal'; value: string } | { kind: 'template'; staticPrefix: string } | null

/** A tsconfig `compilerOptions.paths` alias: a prefix to strip and the absolute base(s) to try. */
interface AliasEntry {
  prefix: string
  bases: string[]
}

/**
 * The tsconfig path aliases for a project (`@/*` -> `./*`, `@/components/*` -> `components/*`).
 * Next apps almost universally import shared chrome via these aliases, so without resolving
 * them the layout/wrapper descent dead-ends at the first aliased import. Reads tsconfig.json
 * once; trailing `/*` is normalized to a plain prefix join. Returns [] when none are declared.
 */
function readAliases(projectDir: string): AliasEntry[] {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const p = join(projectDir, name)
    if (!existsSync(p)) continue
    try {
      const json = JSON.parse(readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '')) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }
      }
      const co = json.compilerOptions ?? {}
      const baseUrl = resolve(projectDir, co.baseUrl ?? '.')
      const paths = co.paths ?? {}
      const out: AliasEntry[] = []
      for (const [pattern, targets] of Object.entries(paths)) {
        const prefix = pattern.endsWith('/*') ? pattern.slice(0, -1) : pattern
        const bases = targets.map((t) => resolve(baseUrl, t.endsWith('/*') ? t.slice(0, -1) : t))
        out.push({ prefix, bases })
      }
      return out
    } catch {
      return []
    }
  }
  return []
}

/** Resolve a relative OR tsconfig-aliased import specifier to an in-project source file. */
function resolveSpecifier(sf: SourceFile, specifier: string, aliases: AliasEntry[]): SourceFile | undefined {
  const project = sf.getProject()
  const tryBase = (base: string): SourceFile | undefined => {
    for (const ext of RESOLVE_EXTS) {
      const found = project.getSourceFile(base + ext)
      if (found) return found
    }
    return undefined
  }
  if (specifier.startsWith('.')) return tryBase(join(dirname(sf.getFilePath()), specifier))
  for (const a of aliases) {
    if (!specifier.startsWith(a.prefix)) continue
    const rest = specifier.slice(a.prefix.length)
    for (const base of a.bases) {
      const found = tryBase(join(base, rest))
      if (found) return found
    }
  }
  return undefined
}

/** Resolve a component identifier used in JSX to its backing in-project source file. */
function resolveComponentFile(sf: SourceFile, name: string, aliases: AliasEntry[]): SourceFile | undefined {
  for (const imp of sf.getImportDeclarations()) {
    const matches =
      imp.getDefaultImport()?.getText() === name ||
      imp.getNamedImports().some((n) => n.getName() === name || n.getAliasNode()?.getText() === name)
    if (!matches) continue
    return imp.getModuleSpecifierSourceFile() ?? resolveSpecifier(sf, imp.getModuleSpecifierValue(), aliases)
  }
  return undefined
}

function isJsxEl(n: Node): boolean {
  return Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n)
}

function jsxTag(el: Node): string {
  if (Node.isJsxElement(el)) return el.getOpeningElement().getTagNameNode().getText()
  if (Node.isJsxSelfClosingElement(el)) return el.getTagNameNode().getText()
  return ''
}

function allJsxElements(sf: SourceFile): Node[] {
  return [...sf.getDescendantsOfKind(SyntaxKind.JsxElement), ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]
}

/** The static value of an element's `href` attribute, classified as literal or template prefix. */
function hrefTarget(el: Node): HrefTarget {
  const attrs = Node.isJsxElement(el) ? el.getOpeningElement().getAttributes() : Node.isJsxSelfClosingElement(el) ? el.getAttributes() : []
  const attr = attrs.find((a) => Node.isJsxAttribute(a) && a.getNameNode().getText() === 'href')
  if (!attr || !Node.isJsxAttribute(attr)) return null
  const init = attr.getInitializer()
  if (!init) return null
  if (Node.isStringLiteral(init)) return { kind: 'literal', value: init.getLiteralValue() }
  if (!Node.isJsxExpression(init)) return null
  const expr = init.getExpression()
  if (!expr) return null
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isTemplateExpression(expr)) return { kind: 'template', staticPrefix: expr.getHead().getLiteralText() }
  return null
}

/** Whether a static href points at an in-app route (an absolute path, not external/anchor/mailto). */
function isInternalHref(value: string): boolean {
  return value.startsWith('/')
}

/**
 * The set of source files that make up a component's render tree: the root plus the
 * same-project child components it renders in JSX, breadth-first to maxDepth. Unlike the
 * shared engine's shallow scan this is used on layouts (whose nav lives several hops down)
 * so it descends deeper; framework wrappers + node_modules are skipped.
 */
function descendComponentTree(root: SourceFile, maxDepth: number, aliases: AliasEntry[]): SourceFile[] {
  const out = new Set<SourceFile>([root])
  let frontier = [root]
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: SourceFile[] = []
    for (const sf of frontier) {
      const tags = new Set<string>()
      for (const el of allJsxElements(sf)) {
        const tag = jsxTag(el).split('.')[0] ?? ''
        if (!/^[A-Z]/.test(tag) || FRAMEWORK_TAG_RE.test(tag)) continue
        tags.add(tag)
      }
      for (const tag of tags) {
        const child = resolveComponentFile(sf, tag, aliases)
        if (!child || out.has(child) || child.getFilePath().includes('node_modules')) continue
        out.add(child)
        next.push(child)
      }
    }
    frontier = next
  }
  return [...out]
}

/**
 * The layout files that wrap a route, nearest-first. In App Router a layout applies to a
 * route when the route's page file sits in the layout's directory or a descendant of it —
 * which transparently covers the root layout, nested layouts, and route-group `(group)`
 * layouts (route groups are ordinary intermediate directories on disk).
 */
function layoutsForRoute(seed: RouteSeed, layouts: SourceFile[]): SourceFile[] {
  if (!seed.componentFile) return []
  const pageDir = dirname(seed.componentFile.getFilePath())
  return layouts
    .filter((l) => {
      const ldir = dirname(l.getFilePath())
      return pageDir === ldir || pageDir.startsWith(ldir + '/')
    })
    .sort((a, b) => b.getFilePath().length - a.getFilePath().length)
}

/**
 * Augment a route graph with navigation declared in the App Router layout chain (and the
 * deep wrapper components either a layout or a page renders). Mutates `edges`, adding only
 * `may` edges that are not already present, each witnessed by a static internal href. Returns
 * the count of edges added (for the caller's logging/soundiness).
 */
export function addLayoutAndWrapperEdges(project: Project, projectDir: string, seeds: RouteSeed[], edges: GraphEdge[]): number {
  const routeLikes = seeds.map((s) => ({ fullPath: s.fullPath, nodeId: s.nodeId }))
  const layouts = project.getSourceFiles().filter((sf) => LAYOUT_RE.test(sf.getFilePath().replace(/\\/g, '/')))
  const aliases = readAliases(projectDir)
  const seen = new Set(edges.map((e) => e.id))
  let added = 0

  // Emit a `may` edge for one resolved internal target, witnessed at the href element.
  const emit = (from: string, to: string, file: string, el: Node): void => {
    const event = 'click:Link'
    const id = edgeId(from, to, event, null)
    if (seen.has(id)) return
    seen.add(id)
    const lc = el.getSourceFile().getLineAndColumnAtPos(el.getStart())
    const modality: Modality = 'may'
    edges.push({
      id,
      from,
      to,
      event,
      guard: null,
      effect: 'navigate',
      modality,
      source: 'static',
      confidence: 0.5,
      witness: { source: 'static', file, loc: { line: lc.line, col: lc.column }, ruleId: 'next.layout-link-href' },
    })
    added++
  }

  // Resolve one element's static href against the declared routes, emitting edges. Custom
  // wrapper components are recognized by simply reading their href prop — they forward it to
  // an anchor — so no component-body resolution is needed for the common case.
  const handleEl = (from: string, file: string, el: Node): void => {
    if (!isJsxEl(el)) return
    const t = hrefTarget(el)
    if (!t) return
    if (t.kind === 'literal') {
      if (!isInternalHref(t.value)) return
      const { exact, candidates } = matchLiteralAll(t.value, routeLikes)
      if (exact) emit(from, exact.nodeId, file, el)
      else for (const c of candidates) emit(from, c.nodeId, file, el)
    } else {
      if (!isInternalHref(t.staticPrefix)) return
      for (const c of matchPrefix(t.staticPrefix, routeLikes)) emit(from, c.nodeId, file, el)
    }
  }

  for (const seed of seeds) {
    if (!seed.componentFile) continue
    // The layout chain plus the page itself, each expanded into its deep component tree so a
    // wrapper-buried <Link href> (CustomLink, NavigationMenuLink, ListItem -> <a href>) is reached.
    const roots = [...layoutsForRoute(seed, layouts), seed.componentFile]
    const treeFiles = new Set<SourceFile>()
    for (const root of roots) for (const f of descendComponentTree(root, MAX_DESCENT, aliases)) treeFiles.add(f)
    for (const cf of treeFiles) {
      const file = relative(projectDir, cf.getFilePath())
      for (const el of allJsxElements(cf)) handleEl(seed.nodeId, file, el)
    }
  }
  return added
}
