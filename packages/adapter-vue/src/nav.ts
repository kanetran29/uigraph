// Detecting real Vue Router navigations in a script: `router.push`/`replace` on a
// useRouter/this.$router receiver, project-local navigation wrappers, and control
// handler expressions traced to navigations or modal-close (`ref=false`) effects.

import { Node, SyntaxKind } from 'ts-morph'
import type { ObjectLiteralExpression, Project, SourceFile } from 'ts-morph'
import type { RawTarget, TargetInfo } from './types'
import { parseExpr, classifyTargetResolved, staticNameValues, resolveStaticTargetExpr } from './targets'
import { getGuard, extraConditionGuard } from './guards'

// --- router.push / router.replace detection ---

/** Identifiers bound to a `useRouter()` result in a script (so `router.push` is real navigation, not Array.push). */
export function routerVars(sf: SourceFile): Set<string> {
  const out = new Set<string>()
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer()
    if (init && Node.isCallExpression(init) && init.getExpression().getText() === 'useRouter') out.add(vd.getName())
  }
  return out
}

/** A project-local navigation wrapper: maps a wrapper fn name to how its first arg targets a route. */
export type RouterWrappers = Map<string, 'name' | 'target'>

/**
 * Whether a function/arrow body is a thin navigation wrapper around router.push/replace
 * that forwards its FIRST parameter to the target (rule E.1, the realworld `routerPush`
 * helper). Returns 'name' when the param is forwarded as `{ name: param }` (so a literal
 * call arg is a route name) or 'target' when forwarded as the bare push argument (so a
 * literal call arg is a path/name handled by classifyTarget), else null.
 */
function wrapperForwardMode(fn: Node): 'name' | 'target' | null {
  const params = Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) ? fn.getParameters() : []
  const first = params[0]?.getName()
  if (first === undefined) return null
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (!Node.isPropertyAccessExpression(expr)) continue
    const member = expr.getName()
    if (member !== 'push' && member !== 'replace') continue
    const arg = call.getArguments()[0]
    if (!arg) continue
    if (Node.isIdentifier(arg) && arg.getText() === first) return 'target'
    if (Node.isObjectLiteralExpression(arg)) {
      if (objectPropForwards(arg, 'name', first)) return 'name'
      if (objectPropForwards(arg, 'path', first)) return 'target'
    }
  }
  return null
}

/** Whether an object literal forwards `param` through property `prop`, as shorthand `{ prop }` or `{ prop: param }`. */
function objectPropForwards(obj: ObjectLiteralExpression, prop: string, param: string): boolean {
  const p = obj.getProperty(prop)
  if (!p) return false
  if (Node.isShorthandPropertyAssignment(p)) return prop === param
  if (Node.isPropertyAssignment(p)) return p.getInitializer()?.getText() === param
  return false
}

/** Scan every project source for navigation-wrapper functions (top-level fn declarations and const-arrows). */
export function collectRouterWrappers(project: Project): RouterWrappers {
  const out: RouterWrappers = new Map()
  for (const sf of project.getSourceFiles()) {
    for (const fn of sf.getFunctions()) {
      const name = fn.getName()
      const mode = wrapperForwardMode(fn)
      if (name && mode) out.set(name, mode)
    }
    for (const vd of sf.getVariableDeclarations()) {
      const init = vd.getInitializer()
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        const mode = wrapperForwardMode(init)
        if (mode) out.set(vd.getName(), mode)
      }
    }
  }
  return out
}

/** Whether a `.push`/`.replace` receiver is a Vue router (useRouter var, useRouter() call, or this.$router). */
function isRouterReceiver(receiver: Node, vars: Set<string>): boolean {
  if (Node.isIdentifier(receiver)) return vars.has(receiver.getText())
  if (Node.isCallExpression(receiver)) return receiver.getExpression().getText() === 'useRouter'
  if (Node.isPropertyAccessExpression(receiver)) return receiver.getName() === '$router'
  return false
}

/** Classify a wrapper call-site first argument: a 'name'-mode wrapper wraps it as `{ name }`, else classify as a target. */
function classifyWrapperArg(arg: Node | undefined, mode: 'name' | 'target', sf: SourceFile, nameToPath: Map<string, string>): TargetInfo {
  if (mode === 'name') {
    const names = staticNameValues(resolveStaticTargetExpr(arg, sf, 0, new Set())).filter((n) => nameToPath.has(n))
    if (names.length === 1) return { kind: 'literal', value: nameToPath.get(names[0] as string) as string }
    if (names.length > 1) return { kind: 'names', values: names }
    return { kind: 'dynamic' }
  }
  return classifyTargetResolved(arg, sf, nameToPath)
}

/** Collect router.push/replace navigations within a scope (whole file or a single method), with guards. */
export function navTargetsIn(scope: Node, sf: SourceFile, vars: Set<string>, nameToPath: Map<string, string>, wrappers: RouterWrappers = new Map()): RawTarget[] {
  const out: RawTarget[] = []
  for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    const guard = getGuard(call) ?? extraConditionGuard(call)
    const lc = sf.getLineAndColumnAtPos(call.getStart())
    if (Node.isIdentifier(expr) && wrappers.has(expr.getText())) {
      const mode = wrappers.get(expr.getText()) as 'name' | 'target'
      out.push({
        ti: classifyWrapperArg(call.getArguments()[0], mode, sf, nameToPath),
        event: 'navigate',
        effect: `${expr.getText()}()`,
        ruleId: 'vue.router-wrapper',
        loc: { line: lc.line, col: lc.column },
        guard,
      })
      continue
    }
    if (!Node.isPropertyAccessExpression(expr)) continue
    const member = expr.getName()
    if (member !== 'push' && member !== 'replace') continue
    if (!isRouterReceiver(expr.getExpression(), vars)) continue
    out.push({
      ti: classifyTargetResolved(call.getArguments()[0], sf, nameToPath),
      event: 'navigate',
      effect: `router.${member}`,
      ruleId: `vue.router-${member}`,
      loc: { line: lc.line, col: lc.column },
      guard,
    })
  }
  return out
}

/** Resolve a handler method name to its definition node (script-setup fn/const-arrow or Options-API method). */
function resolveMethodNode(sf: SourceFile, name: string): Node | undefined {
  const fn = sf.getFunction(name)
  if (fn) return fn
  const vd = sf.getVariableDeclaration(name)
  const init = vd?.getInitializer()
  if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init
  for (const m of sf.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    if (m.getName() === name && m.getFirstAncestor((a) => Node.isPropertyAssignment(a) && a.getName() === 'methods')) return m
  }
  return undefined
}

// --- control handler tracing (navigations + modal-close effects) ---

/** Navigations a control handler expression performs: inline router.push/wrapper, or a traced method. */
export function handlerNavTargets(expr: string, sf: SourceFile, vars: Set<string>, nameToPath: Map<string, string>, wrappers: RouterWrappers): RawTarget[] {
  if (/\.(push|replace)\s*\(/.test(expr)) {
    const node = parseExpr(sf.getProject(), expr)
    const inline = node ? inlineRouterPush(node, sf, vars, nameToPath) : undefined
    if (inline) return [inline]
    const m = /\.(push|replace)\s*\(\s*(['"`])([^'"`]*)\2/.exec(expr)
    const lc = { line: 1, col: 1 }
    if (m) return [{ ti: { kind: 'literal', value: m[3] ?? '' }, event: 'click', effect: `router.${m[1]}`, ruleId: `vue.router-${m[1]}`, loc: lc, guard: null }]
    return [{ ti: { kind: 'dynamic' }, event: 'click', effect: 'router.push', ruleId: 'vue.router-push', loc: lc, guard: null }]
  }
  const methodName = /([a-zA-Z_$][\w$]*)\s*(?:\(|$)/.exec(expr.trim())?.[1]
  if (methodName === undefined) return []
  if (wrappers.has(methodName)) {
    const node = parseExpr(sf.getProject(), expr)
    const arg = Node.isCallExpression(node) ? node.getArguments()[0] : undefined
    const mode = wrappers.get(methodName) as 'name' | 'target'
    return [{ ti: classifyWrapperArg(arg, mode, sf, nameToPath), event: 'click', effect: `${methodName}()`, ruleId: 'vue.router-wrapper', loc: { line: 1, col: 1 }, guard: null }]
  }
  const node = resolveMethodNode(sf, methodName)
  if (!node) return []
  return navTargetsIn(node, sf, vars, nameToPath, wrappers).map((t) => ({ ...t, event: 'click' }))
}

const MODAL_NAME = /modal|dialog|drawer|popup|overlay|sheet|lightbox/i

/** Whether a target name (the ref/state being toggled) is semantically a modal/dialog/overlay. */
function isModalName(name: string): boolean {
  return MODAL_NAME.test(name)
}

/** The modal name set to false by an assignment (`show.value = false`, `state.modal = false`), or null. */
function modalClosedBy(assign: Node): string | null {
  if (!Node.isBinaryExpression(assign) || assign.getOperatorToken().getText() !== '=') return null
  const rhs = assign.getRight()
  if (rhs.getKind() !== SyntaxKind.FalseKeyword) return null
  const lhs = assign.getLeft()
  if (Node.isIdentifier(lhs)) return isModalName(lhs.getText()) ? lhs.getText() : null
  if (Node.isPropertyAccessExpression(lhs)) {
    const prop = lhs.getName()
    const base = lhs.getExpression()
    if (prop === 'value' && Node.isIdentifier(base)) return isModalName(base.getText()) ? base.getText() : null
    return isModalName(prop) ? prop : null
  }
  return null
}

/**
 * Modal-close markers a handler scope performs (rule: a ref/state semantically named
 * like a modal set to false is a dismiss). Returns one RawTarget per close, witnessed
 * at the assignment, so the caller can emit a `close:modal` edge alongside any
 * dismiss-then-navigate router calls in the same handler (multiple edges allowed).
 */
function modalCloseTargets(scope: Node, sf: SourceFile): RawTarget[] {
  const out: RawTarget[] = []
  for (const bin of scope.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const name = modalClosedBy(bin)
    if (name === null) continue
    const lc = sf.getLineAndColumnAtPos(bin.getStart())
    out.push({ ti: { kind: 'dynamic' }, event: 'close:modal', effect: 'close:modal', ruleId: 'vue.modal-close', loc: { line: lc.line, col: lc.column }, guard: getGuard(bin) ?? extraConditionGuard(bin) })
  }
  return out
}

/** Modal-close markers from a control handler expression: inline assignment or a traced method body. */
export function handlerModalCloses(expr: string, sf: SourceFile): RawTarget[] {
  const inline = parseExpr(sf.getProject(), expr)
  if (inline) {
    const direct = modalCloseTargets(inline, sf)
    if (direct.length > 0) return direct
  }
  const methodName = /([a-zA-Z_$][\w$]*)\s*(?:\(|$)/.exec(expr.trim())?.[1]
  if (methodName === undefined) return []
  const node = resolveMethodNode(sf, methodName)
  return node ? modalCloseTargets(node, sf) : []
}

/** Classify a parsed inline `router.push/replace(arg)` call expression, or undefined if it is not a router nav. */
function inlineRouterPush(node: Node, sf: SourceFile, vars: Set<string>, nameToPath: Map<string, string>): RawTarget | undefined {
  if (!Node.isCallExpression(node)) return undefined
  const expr = node.getExpression()
  if (!Node.isPropertyAccessExpression(expr)) return undefined
  const member = expr.getName()
  if (member !== 'push' && member !== 'replace') return undefined
  if (!isRouterReceiver(expr.getExpression(), vars)) return undefined
  return { ti: classifyTargetResolved(node.getArguments()[0], sf, nameToPath), event: 'click', effect: `router.${member}`, ruleId: `vue.router-${member}`, loc: { line: 1, col: 1 }, guard: null }
}
