// Route discovery for react-router JSX: join nested <Route> paths into full IR paths,
// derive an edge's rule id from its event/effect, and collect route nodes across the
// project — plain <Route> declarations plus custom route-wrapper usages that forward a
// call-site path to an inner <Route>.

import { Node, SyntaxKind } from 'ts-morph'
import type { ArrayLiteralExpression, ObjectLiteralExpression, Project, SourceFile } from 'ts-morph'
import type { SoundinessNote } from '@uigraph/core'
import type { RouteInfo } from './types'
import { allJsxElements, ancestorRoutePaths, inlineElementTag, inlineExprInfo, isJsxEl, jsxRootsOf, jsxTag, stringAttr } from './jsx'
import { callSiteComponentFile, dynamicImportTarget, isRouteWrapperComponent, resolveComponentFile, resolveExportedComponent, resolveLazyComponentFile, usesChildrenProp } from './resolve'
import { routeToNodeId } from './ids'

/** Join an element's ancestor <Route> paths with its own path into a full absolute route path. */
function joinPath(ancestors: string[], own: string): string {
  if (own === '*' || own === '/*') return '*'
  if (own.startsWith('/')) return own === '/' ? '/' : own.replace(/\/+$/, '') || '/'
  const segs = [...ancestors, own].join('/').split('/').filter(Boolean)
  return '/' + segs.join('/')
}

/** The ruleset id identifying which navigation rule produced an edge, from its event/effect. */
export function ruleIdFor(event: string, effect: string): string {
  if (effect.startsWith('router.')) return 'next.use-router-push'
  // next redirect() is a call (event 'navigate'); react <Navigate>/<Redirect> is JSX (event 'redirect').
  if (effect === 'redirect' && event === 'navigate') return 'next.redirect'
  if (event === 'click:Link') return 'rr.link-to'
  if (event === 'redirect') return 'rr.redirect'
  if (effect.startsWith('history.')) return 'rr.use-history-push'
  return 'rr.use-navigate'
}

/**
 * Collect route nodes across the project: literal <Route> declarations PLUS custom
 * route-wrapper usages (a capitalized component carrying a `path` whose definition
 * forwards it to an inner <Route>). Wrapper usages contribute the same RouteInfo as a
 * plain <Route> — call-site path + call-site component file — so downstream extraction
 * (controls, navs, labels) is identical for both.
 */
export function collectRoutes(project: Project): RouteInfo[] {
  const byNodeId = new Map<string, RouteInfo>()
  const wrapperCache = new Map<string, boolean>()
  const isWrapperUsage = (sf: SourceFile, el: Node): boolean => {
    const tag = jsxTag(el)
    if (!/^[A-Z]/.test(tag) || tag === 'Route') return false
    const fn = resolveExportedComponent(sf, tag)
    if (!fn) return false
    const key = fn.getSourceFile().getFilePath() + '#' + tag
    let res = wrapperCache.get(key)
    if (res === undefined) {
      res = isRouteWrapperComponent(fn)
      wrapperCache.set(key, res)
    }
    return res
  }
  for (const sf of project.getSourceFiles()) {
    for (const el of allJsxElements(sf)) {
      const isPlainRoute = jsxTag(el) === 'Route'
      if (!isPlainRoute && !isWrapperUsage(sf, el)) continue
      const ownPath = stringAttr(el, 'path')
      if (ownPath === null) continue
      const fullPath = joinPath(ancestorRoutePaths(el), ownPath)
      const nodeId = routeToNodeId(fullPath)
      if (byNodeId.has(nodeId)) continue
      const { name: componentName, file: componentFile } = callSiteComponentFile(sf, el)
      const inlineInfo = componentFile ? null : inlineElementTag(el)
      let inlineElement: RouteInfo['inlineElement']
      if (inlineInfo) {
        const lc = sf.getLineAndColumnAtPos(el.getStart())
        inlineElement = { file: sf.getFilePath(), loc: { line: lc.line, col: lc.column }, tag: inlineInfo.tag, exprNode: inlineInfo.exprNode, roots: inlineInfo.roots }
      }
      byNodeId.set(nodeId, { fullPath, nodeId, componentName, componentFile, inlineElement })
    }
  }
  return [...byNodeId.values()]
}

/** The react-router data-router factory names (the only mode react-router v7 supports). */
const DATA_ROUTER_FACTORY = /^create(Browser|Hash|Memory)Router$/

/** Framework pass-through wrappers whose single JSX child is the real route content. */
const PASSTHROUGH_WRAPPER = /(Fragment|Suspense|StrictMode|ErrorBoundary)$/

/** Data-router discovery result: the route seeds plus honest notes for every dynamic piece skipped. */
export interface DataRouteCollection {
  routes: RouteInfo[]
  /** Notes carry ABSOLUTE file paths; the caller relativizes against projectDir. */
  soundiness: SoundinessNote[]
}

/**
 * Collect route nodes from react-router DATA-ROUTER object config —
 * `createBrowserRouter([...])` (and the hash/memory variants) route tables, the
 * recommended mode since RR 6.4 and the only mode in v7. Walks the route-object
 * array recursively: relative child paths join under the parent, an `index: true`
 * child resolves to the parent path, a leading-slash child is absolute, a pathless
 * layout entry contributes no node but its children are walked. Children are walked
 * BEFORE the parent's own node is emitted, so an index child claims the parent path
 * — the index element is the content actually rendered there — and the layout
 * element only owns the path when no index child exists. Every dynamic piece
 * (spread/variable/call route entries, non-literal paths, unanalyzable elements)
 * yields a soundiness note, never a guess. `createRoutesFromElements(<Route>…)`
 * needs nothing here: its JSX <Route> elements are already collected by
 * `collectRoutes`'s project-wide JSX walk.
 */
export function collectDataRoutes(project: Project): DataRouteCollection {
  const byNodeId = new Map<string, RouteInfo>()
  const soundiness: SoundinessNote[] = []

  /** Record an honest note for a dynamic/unanalyzable piece of route config. */
  const note = (sf: SourceFile, node: Node, detail: string): void => {
    const lc = sf.getLineAndColumnAtPos(node.getStart())
    soundiness.push({ kind: 'dynamic-route-config', file: sf.getFilePath(), loc: { line: lc.line, col: lc.column }, detail })
  }

  /** The initializer of an object literal's named property assignment, or undefined. */
  const propInit = (obj: ObjectLiteralExpression, name: string): Node | undefined => {
    const p = obj.getProperty(name)
    return p !== undefined && Node.isPropertyAssignment(p) ? p.getInitializer() : undefined
  }

  /**
   * Resolve a data route's rendered element expression to the RouteInfo component
   * fields. Handles: a component reference (`<Home/>`, incl. a local React.lazy
   * const), a `<Navigate/>`/`<Redirect/>` redirect (emitted as an inline subtree so
   * the inline walker produces the redirect edge), inline lowercase markup, and
   * children-forwarding wrappers (`<Protected><Account/></Protected>`) unwrapped to
   * the wrapped child with the wrapper file kept for its own redirect scan.
   */
  const resolveElementExpr = (sf: SourceFile, init: Node, fullPath: string): Partial<RouteInfo> => {
    const asInline = (tag: string, exprNode: Node, roots: Node[]): Partial<RouteInfo> => {
      const lc = sf.getLineAndColumnAtPos(exprNode.getStart())
      return { inlineElement: { file: sf.getFilePath(), loc: { line: lc.line, col: lc.column }, tag, exprNode, roots } }
    }
    const inline = inlineExprInfo(init)
    if (inline) return asInline(inline.tag, inline.exprNode, inline.roots)
    const roots = jsxRootsOf(init)
    if (roots.length !== 1) {
      note(sf, init, `route ${fullPath} element is not a statically analyzable JSX element (${init.getKindName()})`)
      return {}
    }
    let el = roots[0] as Node
    let wrapperFile: SourceFile | undefined
    for (;;) {
      const tag = jsxTag(el)
      if (tag === 'Navigate' || tag === 'Redirect') return asInline(tag, init, [el])
      if (!Node.isJsxElement(el)) break
      const kids = el.getJsxChildren().filter((c) => isJsxEl(c) && /^[A-Z]/.test(jsxTag(c)))
      if (kids.length !== 1) break
      if (PASSTHROUGH_WRAPPER.test(tag)) {
        el = kids[0] as Node
        continue
      }
      const fn = resolveExportedComponent(sf, tag.split('.')[0] ?? tag)
      if (fn && (isRouteWrapperComponent(fn) || usesChildrenProp(fn))) {
        if (fn.getSourceFile().getFilePath() !== sf.getFilePath()) wrapperFile = fn.getSourceFile()
        el = kids[0] as Node
        continue
      }
      break
    }
    const name = jsxTag(el)
    if (!/^[A-Z]/.test(name)) return asInline(name, init, [el])
    const base = name.split('.')[0] ?? name
    const componentFile = resolveComponentFile(sf, base) ?? resolveLazyComponentFile(sf, base)
    return { componentName: name, componentFile, ...(wrapperFile !== undefined ? { wrapperFile } : {}) }
  }

  /** Resolve a route object's component fields from `element:`, `Component:`, or `lazy:`. */
  const resolveRouteObject = (sf: SourceFile, obj: ObjectLiteralExpression, fullPath: string): Partial<RouteInfo> => {
    const element = propInit(obj, 'element')
    if (element !== undefined) return resolveElementExpr(sf, element, fullPath)
    const component = propInit(obj, 'Component')
    if (component !== undefined && Node.isIdentifier(component)) {
      const name = component.getText()
      return { componentName: name, componentFile: resolveComponentFile(sf, name) ?? resolveLazyComponentFile(sf, name) }
    }
    const lazy = propInit(obj, 'lazy')
    if (lazy !== undefined) {
      const file = dynamicImportTarget(sf, lazy)
      if (file) return { componentName: null, componentFile: file }
      note(sf, lazy, `route ${fullPath} has a \`lazy\` that is not a direct () => import('…'); its component is not statically resolvable`)
    }
    return {}
  }

  /** Walk one route object: children first (so an index child claims a layout parent's path), then the route's own node. */
  const walkRouteObject = (sf: SourceFile, obj: ObjectLiteralExpression, ancestors: string[]): void => {
    const pathProp = obj.getProperty('path')
    let ownPath: string | null = null
    if (pathProp !== undefined) {
      const init = Node.isPropertyAssignment(pathProp) ? pathProp.getInitializer() : undefined
      if (init !== undefined && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
        ownPath = init.getLiteralValue()
      } else {
        note(sf, pathProp, 'route `path` is not a string literal; this route subtree is not statically extractable')
        return
      }
    }
    const isIndex = propInit(obj, 'index')?.getKind() === SyntaxKind.TrueKeyword
    const children = propInit(obj, 'children')
    if (children !== undefined) {
      if (Node.isArrayLiteralExpression(children)) walkRouteArray(sf, children, ownPath !== null ? [...ancestors, ownPath] : ancestors)
      else note(sf, children, 'route `children` is not a static array literal; nested routes not statically extractable')
    }
    if (ownPath === null && !isIndex) return
    const fullPath = joinPath(ancestors, ownPath ?? '')
    const nodeId = routeToNodeId(fullPath)
    if (byNodeId.has(nodeId)) return
    const resolved = resolveRouteObject(sf, obj, fullPath)
    byNodeId.set(nodeId, { fullPath, nodeId, componentName: null, componentFile: undefined, ...resolved })
  }

  /** Walk a route-object array literal, noting (never guessing) any non-object entry. */
  const walkRouteArray = (sf: SourceFile, arr: ArrayLiteralExpression, ancestors: string[]): void => {
    for (const el of arr.getElements()) {
      if (Node.isObjectLiteralExpression(el)) walkRouteObject(sf, el, ancestors)
      else note(sf, el, `non-literal route entry (${el.getKindName()}) in data-router config; its routes are not statically extractable`)
    }
  }

  for (const sf of project.getSourceFiles()) {
    if (sf.getFilePath().includes('node_modules')) continue
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression()
      if (!Node.isIdentifier(callee) || !DATA_ROUTER_FACTORY.test(callee.getText())) continue
      const arg = call.getArguments()[0]
      if (arg === undefined) continue
      if (Node.isArrayLiteralExpression(arg)) {
        walkRouteArray(sf, arg, [])
      } else if (Node.isCallExpression(arg) && Node.isIdentifier(arg.getExpression()) && arg.getExpression().getText() === 'createRoutesFromElements') {
        continue
      } else {
        note(sf, arg, `${callee.getText()}(…) argument is not a static route array (${arg.getKindName()}); routes not statically extractable`)
      }
    }
  }
  return { routes: [...byNodeId.values()], soundiness }
}
