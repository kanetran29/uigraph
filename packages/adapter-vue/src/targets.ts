// Classifying a navigation-argument AST node into a resolved route target:
// literals, template prefixes, `{ name }` route objects and ternaries, following
// enum-resolvable const/object indirections (rule E.1) and computed/identifier
// bodies. Shared by router-link, router.push and control-handler analysis.

import { Node, SyntaxKind } from 'ts-morph'
import type { ObjectLiteralExpression, Project, SourceFile } from 'ts-morph'
import type { TargetInfo } from './types'
import type { VueComponent } from './extract'

const MAX_DEPTH = 3

/** Read a string-literal property value from a route object literal, or null. */
export function stringProp(obj: ObjectLiteralExpression, name: string): string | null {
  const prop = obj.getProperty(name)
  if (!prop || !Node.isPropertyAssignment(prop)) return null
  const init = prop.getInitializer()
  if (!init) return null
  if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) return init.getLiteralValue()
  return null
}

/** Collect the static string values an expression can take: a literal, or each branch of a ternary. */
export function staticNameValues(expr: Node | undefined): string[] {
  if (!expr) return []
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return [expr.getLiteralValue()]
  if (Node.isConditionalExpression(expr)) return [...staticNameValues(expr.getWhenTrue()), ...staticNameValues(expr.getWhenFalse())]
  if (Node.isParenthesizedExpression(expr)) return staticNameValues(expr.getExpression())
  return []
}

/** An optional enum-resolver mapping an identifier/member node to its static initializer (rule E.1). */
type TargetResolver = (node: Node | undefined) => Node | undefined

/** The `name` initializer of a route object literal, resolved to its static string candidates (resolver applied to enum members). */
function routeNameValues(obj: ObjectLiteralExpression, resolve?: TargetResolver): string[] {
  const prop = obj.getProperty('name')
  if (!prop || !Node.isPropertyAssignment(prop)) return []
  const init = prop.getInitializer()
  return staticNameValues(resolve ? resolve(init) : init)
}

/** Classify a ts-morph navigation argument as literal / template-prefix / names / dynamic. */
function classifyTarget(expr: Node | undefined, nameToPath: Map<string, string>, resolve?: TargetResolver): TargetInfo {
  if (!expr) return { kind: 'dynamic' }
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isTemplateExpression(expr)) return { kind: 'template', staticPrefix: expr.getHead().getLiteralText() }
  if (Node.isObjectLiteralExpression(expr)) return classifyRouteObject(expr, nameToPath, resolve)
  if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === '+') {
    const left = expr.getLeft()
    if (Node.isStringLiteral(left) || Node.isNoSubstitutionTemplateLiteral(left)) return { kind: 'template', staticPrefix: left.getLiteralValue() }
  }
  return { kind: 'dynamic' }
}

/**
 * Classify a `{ name, params, path }` route object. A `name` resolves the target
 * route even when `params` are dynamic (params don't change which route is hit); a
 * ternary `name` fans out to each branch. Falls back to `path` if present. An
 * optional resolver resolves an enum-member name (e.g. `{ name: NAMES.beta }`).
 */
function classifyRouteObject(obj: ObjectLiteralExpression, nameToPath: Map<string, string>, resolve?: TargetResolver): TargetInfo {
  const names = routeNameValues(obj, resolve).filter((n) => nameToPath.has(n))
  if (names.length === 1) return { kind: 'literal', value: nameToPath.get(names[0] as string) as string }
  if (names.length > 1) return { kind: 'names', values: names }
  const path = stringProp(obj, 'path')
  if (path !== null) return { kind: 'literal', value: path }
  return { kind: 'dynamic' }
}

let exprCounter = 0

/** Parse a template-bound JS expression string into a ts-morph Expression node, or undefined. */
export function parseExpr(project: Project, text: string): Node | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  try {
    const sf = project.createSourceFile(`__expr_${exprCounter++}.ts`, `const __x = (${trimmed});`)
    const init = sf.getVariableDeclaration('__x')?.getInitializer()
    if (Node.isParenthesizedExpression(init)) return init.getExpression()
    return init
  } catch {
    return undefined
  }
}

/**
 * Classify a template `to`/`:to` (or wrapper `name`) bound expression. The string is
 * parsed to an AST and run through classifyTarget so objects/ternaries behave like
 * script navigations; a bare identifier (e.g. a `computed`) is resolved to its
 * definition body in the component script before classification.
 */
export function classifyBoundExpr(expr: string, component: VueComponent, project: Project, nameToPath: Map<string, string>): TargetInfo {
  const node = parseExpr(project, expr)
  if (!node) return { kind: 'dynamic' }
  if (Node.isIdentifier(node)) {
    const resolved = resolveIdentifierExpr(component.scriptSf, node.getText())
    if (resolved) return classifyTarget(resolved, nameToPath)
    return { kind: 'dynamic' }
  }
  return classifyTarget(node, nameToPath)
}

/**
 * Classify a wrapper's bound `:name`. A static string/ternary resolves to its route(s).
 * A fully dynamic name (e.g. `link.routeName`) is left dynamic rather than fanned out to
 * every declared named route: a bare `:name` on an arbitrary component is indistinguishable
 * from a generic prop (e.g. `<Tag :name="t">`), so inventing an edge into every named route
 * would violate the no-edge-without-a-static-witness invariant. The real navigation, if any,
 * is recovered by scanning the wrapper's own template/script (see childTargets).
 */
export function classifyBoundName(expr: string, component: VueComponent, nameToPath: Map<string, string>): TargetInfo {
  const values = staticNamesFromString(expr, component).filter((n) => nameToPath.has(n))
  if (values.length === 1) return { kind: 'literal', value: nameToPath.get(values[0] as string) as string }
  if (values.length > 1) return { kind: 'names', values }
  return { kind: 'dynamic' }
}

/** Static string candidates a bound `:name` expression can take (literal/ternary, resolving identifiers). */
function staticNamesFromString(expr: string, component: VueComponent): string[] {
  const node = parseExpr(component.scriptSf.getProject(), expr)
  if (!node) return []
  if (Node.isIdentifier(node)) {
    const resolved = resolveIdentifierExpr(component.scriptSf, node.getText())
    return resolved ? staticNameValues(resolved) : []
  }
  return staticNameValues(node)
}

/**
 * Resolve a navigation-target expression to a static literal/object form for
 * classifyTarget, following enum-resolvable indirections (rule E.1): a bare
 * identifier bound to a string const (`const LOGIN = '/login'`) and a member
 * access into a const object literal (`const PATHS = { login: '/login' }` then
 * `PATHS.login`). Bounded by MAX_DEPTH with a cycle guard so chained consts never
 * recurse unbounded; returns the original node when no static resolution applies.
 */
export function resolveStaticTargetExpr(expr: Node | undefined, sf: SourceFile, depth: number, seen: Set<string>): Node | undefined {
  if (!expr || depth > MAX_DEPTH) return expr
  if (Node.isParenthesizedExpression(expr)) return resolveStaticTargetExpr(expr.getExpression(), sf, depth, seen)
  if (Node.isIdentifier(expr)) {
    const name = expr.getText()
    if (seen.has(name)) return expr
    seen.add(name)
    const init = sf.getVariableDeclaration(name)?.getInitializer()
    if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init) || Node.isObjectLiteralExpression(init) || Node.isConditionalExpression(init)))
      return resolveStaticTargetExpr(init, sf, depth + 1, seen)
    return expr
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const obj = expr.getExpression()
    if (!Node.isIdentifier(obj)) return expr
    const objName = obj.getText()
    if (seen.has(objName)) return expr
    seen.add(objName)
    const init = sf.getVariableDeclaration(objName)?.getInitializer()
    if (init && Node.isObjectLiteralExpression(init)) {
      const member = init.getProperty(expr.getName())
      if (member && Node.isPropertyAssignment(member)) return resolveStaticTargetExpr(member.getInitializer(), sf, depth + 1, seen)
    }
    return expr
  }
  return expr
}

/** Classify a navigation argument, first resolving enum-resolvable identifiers/members against the script (rule E.1). */
export function classifyTargetResolved(expr: Node | undefined, sf: SourceFile, nameToPath: Map<string, string>): TargetInfo {
  const resolve: TargetResolver = (n) => resolveStaticTargetExpr(n, sf, 0, new Set())
  return classifyTarget(resolve(expr), nameToPath, resolve)
}

/** Resolve a component-script identifier (const/computed) to the expression it ultimately returns. */
function resolveIdentifierExpr(sf: SourceFile, name: string): Node | undefined {
  const vd = sf.getVariableDeclaration(name)
  const init = vd?.getInitializer()
  if (!init) return undefined
  if (Node.isCallExpression(init) && init.getExpression().getText() === 'computed') {
    const fn = init.getArguments()[0]
    if (fn && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return functionReturnExpr(fn)
    return undefined
  }
  return init
}

/** The single returned expression of an arrow/function body (concise body or sole `return`), or undefined. */
function functionReturnExpr(fn: Node): Node | undefined {
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody()
    if (!Node.isBlock(body)) return Node.isParenthesizedExpression(body) ? body.getExpression() : body
  }
  const returns = fn.getDescendantsOfKind(SyntaxKind.ReturnStatement)
  if (returns.length === 1) {
    const e = returns[0]?.getExpression()
    return e && Node.isParenthesizedExpression(e) ? e.getExpression() : e
  }
  return undefined
}
