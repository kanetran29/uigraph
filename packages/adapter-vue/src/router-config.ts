// Turning a Vue Router configuration — `createRouter({ routes })`, `new VueRouter`
// or an exported `routes` array — into flat, path-joined route records with
// resolved `.vue` components and per-route `beforeEnter` guards.

import { Node, SyntaxKind } from 'ts-morph'
import type { ObjectLiteralExpression, Project, SourceFile } from 'ts-morph'
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
export function collectRoutes(vp: VueProject): RouteInfo[] {
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
