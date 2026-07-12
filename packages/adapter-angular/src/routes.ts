// Angular `Routes` config extraction: find top-level Routes-shaped array literals,
// recursively walk them (nested `children`, lazy `loadChildren`/`loadComponent`)
// into RouteInfo records — full path, node id, backing component file, and
// `canActivate` guard descriptors. Files reached via `loadChildren` are scanned
// only under their parent prefix.

import { Node, Project, SyntaxKind } from 'ts-morph'
import type { ArrayLiteralExpression, ObjectLiteralExpression, SourceFile } from 'ts-morph'
import { routeToNodeId } from './ids'
import { analyzeCanActivate, type GuardInfo } from './guards'
import { resolveImportedFile, lazyImportSpecifier, resolveRelative, componentClassName, stringProp, identifierProp } from './resolve'

export interface RouteInfo {
  fullPath: string
  nodeId: string
  componentName: string | null
  componentFile: SourceFile | undefined
  guards: GuardInfo[]
  routeObj: ObjectLiteralExpression
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
export function collectRoutes(project: Project): RouteInfo[] {
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
