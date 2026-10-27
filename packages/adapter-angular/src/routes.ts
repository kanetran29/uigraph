// Angular `Routes` config extraction: find top-level Routes-shaped array literals,
// recursively walk them (nested `children`, lazy `loadChildren`/`loadComponent`)
// into RouteInfo records — full path, node id, backing component file, and
// `canActivate` guard descriptors. Files reached via `loadChildren` are scanned
// only under their parent prefix.

import { Node, Project, SyntaxKind } from 'ts-morph'
import type { ArrayLiteralExpression, ObjectLiteralExpression, SourceFile } from 'ts-morph'
import { routeToNodeId } from './ids'
import { analyzeCanActivate, type GuardInfo } from './guards'
import { resolveImportedFile, lazyImportSpecifier, resolveRelative, componentClassName, stringProp, identifierProp, objectLiteralOf } from './resolve'

export interface RouteInfo {
  fullPath: string
  nodeId: string
  componentName: string | null
  componentFile: SourceFile | undefined
  guards: GuardInfo[]
  routeObj: ObjectLiteralExpression
  /**
   * Node id of the nearest ANCESTOR THAT IS A SCREEN, or null at the root. A componentless
   * route is a prefix and mints no node, so it is skipped here and its children are attached
   * to the screen above it; otherwise the route tree scope attribution walks would break at
   * every prefix.
   */
  parentNodeId: string | null
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
  // `RouterModule.forChild([...])` / `forRoot([...])` / `provideRouter([...])` take the array
  // inline, with no variable to find it by. A module that registers its routes that way is
  // otherwise invisible, and with it every route the array declares.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!/(RouterModule\.(forRoot|forChild)|provideRouter)$/.test(call.getExpression().getText())) continue
    for (const arg of call.getArguments()) {
      if (Node.isArrayLiteralExpression(arg) && !out.includes(arg)) out.push(arg)
    }
  }
  return out
}

/**
 * Resolve a `loadChildren` target to the file that actually declares its routes.
 * An NgModule loaded lazily normally keeps its route array in a separate
 * `*-routing.module` that it imports rather than in the module file named by the
 * loader, so when the target declares none, follow its relative imports one level
 * and take the first that does. Without this the route array is never reached under
 * its parent prefix and is instead picked up at the project root, which mints every
 * one of its screens at its own relative path.
 */
function lazyRouteOwner(target: SourceFile): { owner: SourceFile; arrays: ArrayLiteralExpression[] } {
  const own = findRouteArrays(target)
  if (own.length) return { owner: target, arrays: own }
  for (const imp of target.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (!spec.startsWith('.')) continue
    const dep = imp.getModuleSpecifierSourceFile() ?? resolveRelative(target, spec)
    if (!dep) continue
    const arrays = findRouteArrays(dep)
    if (arrays.length) return { owner: dep, arrays }
  }
  return { owner: target, arrays: [] }
}

/**
 * Recursively walk a route array literal, emitting one RouteInfo per route
 * object that declares a `path` AND a component (`component` / `loadComponent`).
 * A componentless route (`{ path: 'x', children }`, `{ path: 'x', loadChildren }`,
 * a redirect) renders nothing itself — it only prefixes its children's paths and
 * applies its `canActivate` to their activation — so it is not a screen; minting
 * it would fabricate a state no user can land on and, worse, shadow a `path: ''`
 * child that shares its full path (first declaration wins). An element that is a
 * call rather than an object literal is a route factory such as mifos's
 * `Route.withShell([...])`, which wraps the array it is given in a `path: ''`
 * shell route; its array arguments are walked at the same prefix, so the routes
 * inside are reached, while whatever the factory itself adds is not seen. Inline `children`
 * are visited with the parent path prefixed and the parent's guards inherited;
 * `loadChildren: () => import('./x.routes')` is followed into the imported
 * module's route array. Deduplicates by node id (first declaration wins).
 */
function walkRouteArray(arr: ArrayLiteralExpression, sf: SourceFile, parentPath: string, out: Map<string, RouteInfo>, loadedChildFiles: Set<string>, inheritedGuards: GuardInfo[] = [], parentNodeId: string | null = null): void {
  for (const el of arr.getElements()) {
    if (Node.isCallExpression(el)) {
      for (const arg of el.getArguments()) {
        if (Node.isArrayLiteralExpression(arg)) walkRouteArray(arg, sf, parentPath, out, loadedChildFiles, inheritedGuards, parentNodeId)
      }
      continue
    }
    // An array may name its routes instead of spelling them out (`[ERROR_ROUTE]`).
    const obj = Node.isObjectLiteralExpression(el) ? el : objectLiteralOf(el)
    if (!obj) continue
    const ownPath = stringProp(obj, 'path')
    if (ownPath === null) continue
    const fullPath = joinRoutePath(parentPath, ownPath)
    const guards = [...inheritedGuards, ...canActivateGuards(sf, obj)]
    const componentName = identifierProp(obj, 'component')
    let componentFile = componentName ? resolveImportedFile(sf, componentName) : undefined
    let resolvedName = componentName
    if (!componentFile) {
      const spec = lazyImportSpecifier(obj, 'loadComponent')
      if (spec) {
        componentFile = resolveRelative(sf, spec)
        if (componentFile) resolvedName = componentClassName(componentFile)
      }
    }
    const isScreen = obj.getProperty('component') !== undefined || obj.getProperty('loadComponent') !== undefined
    const nodeId = routeToNodeId(fullPath)
    if (isScreen && !out.has(nodeId)) {
      out.set(nodeId, { fullPath, nodeId, componentName: resolvedName, componentFile, guards, routeObj: obj, parentNodeId: parentNodeId === nodeId ? null : parentNodeId })
    }
    const childParent = isScreen ? nodeId : parentNodeId
    const childrenProp = obj.getProperty('children')
    if (childrenProp && Node.isPropertyAssignment(childrenProp)) {
      const childInit = childrenProp.getInitializer()
      if (childInit && Node.isArrayLiteralExpression(childInit)) walkRouteArray(childInit, sf, fullPath, out, loadedChildFiles, guards, childParent)
    }
    const childSpec = lazyImportSpecifier(obj, 'loadChildren')
    if (childSpec) {
      const childModule = resolveRelative(sf, childSpec)
      if (childModule) {
        const { owner, arrays } = lazyRouteOwner(childModule)
        loadedChildFiles.add(childModule.getFilePath())
        loadedChildFiles.add(owner.getFilePath())
        for (const childArr of arrays) walkRouteArray(childArr, owner, fullPath, out, loadedChildFiles, guards, childParent)
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

/** Pre-pass: resolve every `loadChildren` import target, and the routing module it delegates its route array to, so those files are scanned only under their parent prefix. */
function collectLoadChildrenTargets(project: Project): Set<string> {
  const targets = new Set<string>()
  for (const sf of project.getSourceFiles()) {
    for (const obj of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const spec = lazyImportSpecifier(obj, 'loadChildren')
      if (!spec) continue
      const mod = resolveRelative(sf, spec)
      if (!mod) continue
      targets.add(mod.getFilePath())
      targets.add(lazyRouteOwner(mod).owner.getFilePath())
    }
  }
  return targets
}
