// Turning a Vue Router configuration — `createRouter({ routes })`, `new Router`
// or exported route arrays — into flat, path-joined route records with resolved
// `.vue` components and per-route `beforeEnter` guards. Exported route arrays
// NOT passed to the constructor (vue-element-admin's `asyncRoutes`, registered
// at runtime via `router.addRoutes()`) are collected too and flagged with a
// 'runtime-registered-routes' soundiness note; unresolvable `addRoutes`/`addRoute`
// arguments are flagged with the same kind — never skipped silently.

import { Node, SyntaxKind } from 'ts-morph'
import type { ArrayLiteralExpression, ObjectLiteralExpression, Project, SourceFile } from 'ts-morph'
import type { SoundinessNote } from '@uigraph/core'
import { routeToNodeId } from './ids'
import { resolveVueComponent } from './project'
import { stringProp } from './targets'
import type { VueComponent, VueProject } from './extract'

/** A flattened route record: full path, node id, optional name/component name, resolved component, and any per-route guards. */
export interface RouteInfo {
  fullPath: string
  nodeId: string
  name: string | null
  componentName: string | null
  component: VueComponent | undefined
  guards: string[]
}

/** The collected route table plus the soundiness notes route collection itself produced. */
export interface CollectedRoutes {
  routes: RouteInfo[]
  notes: SoundinessNote[]
}

/** Normalize a Vue route path joining a parent: '' inherits, '/x' absolute, 'x' relative, catch-all -> '*'. */
function normalizeRoutePath(parent: string, own: string): string {
  if (/pathMatch|\(\.\*\)|^\*$/.test(own)) return '*'
  if (own === '') return parent === '' ? '/' : parent
  const abs = own.startsWith('/') ? own : `${parent === '/' ? '' : parent}/${own}`
  const segs = abs.split('/').filter(Boolean)
  return '/' + segs.join('/')
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

/** Find the route-records array passed to (or referenced by) a router constructor, with its declaring file and variable name. */
function findConstructorRoutes(project: Project): { arr: ArrayLiteralExpression; sf: SourceFile; name: string | null } | null {
  for (const sf of project.getSourceFiles()) {
    const calls = [...sf.getDescendantsOfKind(SyntaxKind.CallExpression), ...sf.getDescendantsOfKind(SyntaxKind.NewExpression)]
    for (const call of calls) {
      if (!isRouterConstructor(call)) continue
      const arg = call.getArguments()[0]
      if (!arg || !Node.isObjectLiteralExpression(arg)) continue
      const routesProp = arg.getProperty('routes')
      if (!routesProp || !Node.isPropertyAssignment(routesProp)) continue
      const init = routesProp.getInitializer()
      const arr = resolveArray(init, sf)
      if (arr) return { arr, sf, name: init && Node.isIdentifier(init) ? init.getText() : null }
    }
  }
  return null
}

/** Whether an object literal looks like a Vue route record ({ path } plus component/children/redirect). */
function isRouteRecord(obj: ObjectLiteralExpression): boolean {
  if (!obj.getProperty('path')) return false
  return ['component', 'children', 'redirect'].some((p) => obj.getProperty(p) !== undefined)
}

/** Whether a route-array element is a route record: an object literal, or an identifier resolving to one. */
function isRouteElement(e: Node, sf: SourceFile): boolean {
  if (Node.isObjectLiteralExpression(e)) return isRouteRecord(e)
  if (Node.isIdentifier(e)) {
    const resolved = resolveRouteRecordIdent(e.getText(), sf)
    return resolved !== null && isRouteRecord(resolved.obj)
  }
  return false
}

/** Find every top-level exported const whose initializer is an array of route records, excluding the constructor's array. */
function findExportedRouteArrays(project: Project, exclude: ArrayLiteralExpression | undefined): { name: string; arr: ArrayLiteralExpression; sf: SourceFile }[] {
  const out: { name: string; arr: ArrayLiteralExpression; sf: SourceFile }[] = []
  for (const sf of project.getSourceFiles()) {
    for (const stmt of sf.getVariableStatements()) {
      if (!stmt.isExported()) continue
      for (const vd of stmt.getDeclarations()) {
        const init = vd.getInitializer()
        if (!init || !Node.isArrayLiteralExpression(init) || init === exclude) continue
        if (init.getElements().some((e) => isRouteElement(e, sf))) out.push({ name: vd.getName(), arr: init, sf })
      }
    }
  }
  return out
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

/**
 * Resolve an identifier element of a route array to its object-literal route record,
 * following a same-file const or an imported default/named export (vue-element-admin's
 * `modules/*.js` route files), with the file the record is declared in.
 */
function resolveRouteRecordIdent(name: string, sf: SourceFile): { obj: ObjectLiteralExpression; sf: SourceFile } | null {
  const local = sf.getVariableDeclaration(name)?.getInitializer()
  if (local && Node.isObjectLiteralExpression(local)) return { obj: local, sf }
  for (const imp of sf.getImportDeclarations()) {
    const isDefault = imp.getDefaultImport()?.getText() === name
    const named = imp.getNamedImports().find((n) => (n.getAliasNode() ?? n.getNameNode()).getText() === name)
    if (!isDefault && !named) continue
    const target = imp.getModuleSpecifierSourceFile()
    if (!target) return null
    const expr = named ? target.getVariableDeclaration(named.getName())?.getInitializer() : target.getExportAssignment((e) => !e.isExportEquals())?.getExpression()
    const init = expr && Node.isIdentifier(expr) ? target.getVariableDeclaration(expr.getText())?.getInitializer() : expr
    if (init && Node.isObjectLiteralExpression(init)) return { obj: init, sf: target }
    return null
  }
  return null
}

/** The 1-based line/col of a node, in SoundinessNote loc shape. */
function locOf(node: Node, sf: SourceFile): { line: number; col: number } {
  const lc = sf.getLineAndColumnAtPos(node.getStart())
  return { line: lc.line, col: lc.column }
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

/**
 * Walk every statically reachable route array — the one passed to the router
 * constructor, plus exported route arrays registered at runtime — into flat,
 * deduped route nodes. Runtime-registered arrays and unresolvable
 * `addRoutes`/`addRoute` arguments are reported via soundiness notes.
 */
export function collectRoutes(vp: VueProject): CollectedRoutes {
  const notes: SoundinessNote[] = []
  const byNodeId = new Map<string, RouteInfo>()

  /** Walk one route record (and its children) into the table; returns the count of path-bearing records walked. */
  const visitObj = (obj: ObjectLiteralExpression, parent: string, sf: SourceFile): number => {
    const own = stringProp(obj, 'path')
    if (own === null) return 0
    let count = 1
    const fullPath = normalizeRoutePath(parent, own)
    const nodeId = routeToNodeId(fullPath)
    if (!byNodeId.has(nodeId)) {
      const { name, component } = resolveComponent(obj, sf, vp.components)
      byNodeId.set(nodeId, { fullPath, nodeId, name: stringProp(obj, 'name'), componentName: name, component, guards: routeGuards(obj) })
    }
    const childrenProp = obj.getProperty('children')
    if (childrenProp && Node.isPropertyAssignment(childrenProp)) {
      const arr = childrenProp.getInitializer()
      if (arr && Node.isArrayLiteralExpression(arr)) count += visitElements(arr.getElements(), fullPath, sf)
    }
    return count
  }

  /** Walk route-array elements: object literals directly, identifiers via import resolution; anything else is flagged, never dropped silently. */
  const visitElements = (els: Node[], parent: string, sf: SourceFile): number => {
    let count = 0
    for (const el of els) {
      if (Node.isObjectLiteralExpression(el)) {
        count += visitObj(el, parent, sf)
        continue
      }
      if (Node.isIdentifier(el)) {
        const resolved = resolveRouteRecordIdent(el.getText(), sf)
        if (resolved) {
          count += visitObj(resolved.obj, parent, resolved.sf)
          continue
        }
      }
      notes.push({ kind: 'unresolved-route', file: sf.getFilePath(), loc: locOf(el, sf), detail: `route array element "${el.getText()}" could not be resolved to a route record — its routes are skipped` })
    }
    return count
  }

  const ctor = findConstructorRoutes(vp.project)
  if (ctor) visitElements(ctor.arr.getElements(), '', ctor.sf)

  const exported = findExportedRouteArrays(vp.project, ctor?.arr)
  for (const ex of exported) {
    const count = visitElements(ex.arr.getElements(), '', ex.sf)
    if (ctor) {
      notes.push({
        kind: 'runtime-registered-routes',
        file: ex.sf.getFilePath(),
        loc: locOf(ex.arr, ex.sf),
        detail: `exported route array "${ex.name}" (${count} route record(s)) is not passed to the router constructor — registered at runtime via addRoutes()/addRoute()`,
      })
    }
  }

  // legacy fallback: no constructor and no exported route array — first array with a { path } element
  if (!ctor && exported.length === 0) {
    outer: for (const sf of vp.project.getSourceFiles()) {
      for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        const init = vd.getInitializer()
        if (!init || !Node.isArrayLiteralExpression(init)) continue
        if (init.getElements().some((e) => Node.isObjectLiteralExpression(e) && e.getProperty('path') !== undefined)) {
          visitElements(init.getElements(), '', sf)
          break outer
        }
      }
    }
  }

  const collectedNames = new Set([...(ctor?.name ? [ctor.name] : []), ...exported.map((e) => e.name)])
  scanRuntimeRegistrations(vp.project, collectedNames, visitElements, notes)

  return { routes: [...byNodeId.values()], notes }
}

/**
 * Scan `addRoutes()`/`addRoute()` call sites. Arguments naming an already-collected
 * array are covered; a same-file array resolves and is walked; anything else
 * (spread, function result, store payload) is flagged — never silent.
 */
function scanRuntimeRegistrations(project: Project, collectedNames: Set<string>, visitElements: (els: Node[], parent: string, sf: SourceFile) => number, notes: SoundinessNote[]): void {
  for (const sf of project.getSourceFiles()) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression()
      if (!Node.isPropertyAccessExpression(expr)) continue
      const method = expr.getName()
      if (method !== 'addRoutes' && method !== 'addRoute') continue
      const args = call.getArguments()
      const arg = method === 'addRoutes' ? args[0] : args[args.length - 1]
      if (!arg) continue
      if (Node.isIdentifier(arg) && collectedNames.has(arg.getText())) continue
      const loc = locOf(call, sf)
      const arr = resolveArray(arg, sf)
      if (arr) {
        const count = visitElements(arr.getElements(), '', sf)
        notes.push({ kind: 'runtime-registered-routes', file: sf.getFilePath(), loc, detail: `${method}(${arg.getText()}) registers ${count} route record(s) at runtime` })
      } else if (args.length === 1 && Node.isObjectLiteralExpression(arg)) {
        const count = visitElements([arg], '', sf)
        notes.push({ kind: 'runtime-registered-routes', file: sf.getFilePath(), loc, detail: `${method}({...}) registers ${count} route record(s) at runtime` })
      } else {
        notes.push({ kind: 'runtime-registered-routes', file: sf.getFilePath(), loc, detail: `${method}() argument "${arg.getText()}" could not be statically resolved to a route array — its routes are missing from the graph` })
      }
    }
  }
}
