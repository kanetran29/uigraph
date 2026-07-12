// Route discovery for react-router JSX: join nested <Route> paths into full IR paths,
// derive an edge's rule id from its event/effect, and collect route nodes across the
// project — plain <Route> declarations plus custom route-wrapper usages that forward a
// call-site path to an inner <Route>.

import type { Node, Project, SourceFile } from 'ts-morph'
import type { RouteInfo } from './types'
import { allJsxElements, ancestorRoutePaths, inlineElementTag, jsxTag, stringAttr } from './jsx'
import { callSiteComponentFile, isRouteWrapperComponent, resolveExportedComponent } from './resolve'
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
