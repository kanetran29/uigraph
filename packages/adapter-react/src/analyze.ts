// Interprocedural handler analysis: walk an event handler's body and the reachable
// user-defined call graph for navigation sinks and effects, conjoining path guards
// and tracking success/error branch context. Bounds cycles/blow-up with a visited set
// and depth cap, and resolves parameter-passed route arguments back to their literals.

import { Node, SyntaxKind } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import type { NavCall } from './types'
import { extraConditionGuard, getGuard } from './guards'
import { classifyTarget, navIdentifiers } from './targets'
import { branchContextOf, detectApiEffect, detectModalClose, detectModalOpen, detectStateEffect, isErrorSetter } from './effects'
import { fnParams, resolveFunctionNode, resolveImportedFunction } from './resolve'

const MAX_CALL_DEPTH = 5

/**
 * A lexical scope for the interprocedural walk: which identifiers resolve to a
 * navigate/history function here (by closure or parameter binding), and what each
 * parameter was bound to, so a route passed as an argument can be resolved to its
 * literal at the sink.
 */
interface Scope {
  navSet: Set<string>
  histSet: Set<string>
  bindings: Map<string, Node>
}

/**
 * Resolve a CallExpression's callee to a user-defined function node inside the
 * project: a locally declared function/arrow, or a named/default import resolved
 * via the relative-module resolver. Returns undefined for library calls
 * (non-relative imports) and unresolved symbols, so the walk never leaves app code.
 */
function resolveCallee(call: Node, sf: SourceFile): Node | undefined {
  if (!Node.isCallExpression(call)) return undefined
  const expr = call.getExpression()
  if (!Node.isIdentifier(expr)) return undefined
  const name = expr.getText()
  return resolveFunctionNode(sf, name) ?? resolveImportedFunction(sf, name)
}

/** Conjoin two symbolic guards; either may be null. Identical guards collapse. */
function combineGuard(a: string | null, b: string | null): string | null {
  if (a !== null && b !== null) return a === b ? a : `${a} && ${b}`
  return a ?? b
}

/**
 * The callee's scope when entered from `call`: the callee file's own nav/history
 * identifiers (closures), plus parameters bound to nav/history arguments, plus a
 * binding of each parameter to its argument node (for literal target resolution).
 */
function deriveScope(callee: Node, call: Node, caller: Scope): Scope {
  const own = navIdentifiers(callee.getSourceFile())
  const navSet = new Set(own.navSet)
  const histSet = new Set(own.histSet)
  const bindings = new Map<string, Node>()
  const args = Node.isCallExpression(call) ? call.getArguments() : []
  fnParams(callee).forEach((pname, i) => {
    const arg = args[i]
    if (!arg) return
    if (Node.isIdentifier(arg)) {
      const an = arg.getText()
      if (caller.navSet.has(an)) navSet.add(pname)
      if (caller.histSet.has(an)) histSet.add(pname)
      bindings.set(pname, caller.bindings.get(an) ?? arg)
    } else {
      bindings.set(pname, arg)
    }
  })
  return { navSet, histSet, bindings }
}

/** Follow parameter bindings (a few hops) so an identifier target resolves to the literal passed in. */
function resolveArgForTarget(arg: Node | undefined, scope: Scope): Node | undefined {
  let cur = arg
  for (let i = 0; i < MAX_CALL_DEPTH && cur && Node.isIdentifier(cur); i++) {
    const next = scope.bindings.get(cur.getText())
    if (!next || next === cur) break
    cur = next
  }
  return cur
}

/**
 * Walk a function body for navigation sinks and effects, recursing into reachable
 * user-defined callees (the call graph). Navs found below the entry function are
 * tagged interprocedural; guards on the call path are conjoined onto each sink. A
 * visited set + depth cap bound cycles and blow-up.
 */
function walkReachable(
  fn: Node,
  sf: SourceFile,
  scope: Scope,
  pathGuard: string | null,
  visited: Set<Node>,
  depth: number,
  out: { navCalls: NavCall[]; effects: Set<string> },
): void {
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    const guard = combineGuard(pathGuard, getGuard(call) ?? extraConditionGuard(call))
    if (Node.isIdentifier(expr) && scope.navSet.has(expr.getText())) {
      out.navCalls.push({ ti: classifyTarget(resolveArgForTarget(call.getArguments()[0], scope)), guard, node: call, ctx: branchContextOf(call), interprocedural: depth > 0 })
      continue
    }
    if (Node.isPropertyAccessExpression(expr)) {
      const obj = expr.getExpression()
      const m = expr.getName()
      if (Node.isIdentifier(obj) && scope.histSet.has(obj.getText()) && (m === 'push' || m === 'replace')) {
        out.navCalls.push({ ti: classifyTarget(resolveArgForTarget(call.getArguments()[0], scope)), guard, node: call, ctx: branchContextOf(call), interprocedural: depth > 0 })
        continue
      }
    }
    const api = detectApiEffect(call)
    if (api) {
      out.effects.add(api)
      continue
    }
    // Dismiss (setShowModal(false)) is checked BEFORE open/state so the same setter
    // shape is not mis-read as a state-write; a guarded close still records the effect
    // (the close edge it drives carries no guard — closing returns to the same screen).
    if (detectModalClose(call)) {
      out.effects.add('close:modal')
      continue
    }
    const modalVar = detectModalOpen(call)
    if (modalVar) {
      out.effects.add(`open:modal:${modalVar}`)
      continue
    }
    const st = detectStateEffect(call)
    if (st) {
      const errorBranch = isErrorSetter(call) || branchContextOf(call) === 'error'
      out.effects.add(errorBranch ? st.replace('state:', 'error:') : st)
      continue
    }
    if (depth < MAX_CALL_DEPTH) {
      const callee = resolveCallee(call, sf)
      if (callee && !visited.has(callee)) {
        visited.add(callee)
        walkReachable(callee, callee.getSourceFile(), deriveScope(callee, call, scope), guard, visited, depth + 1, out)
      }
    }
  }
}

/** Analyze a handler for navigations and effects across the reachable call graph. */
export function analyzeHandler(fnNode: Node, navInfo: { navSet: Set<string>; histSet: Set<string> }, sf: SourceFile): { navCalls: NavCall[]; effects: string[] } {
  const out = { navCalls: [] as NavCall[], effects: new Set<string>() }
  const scope: Scope = { navSet: new Set(navInfo.navSet), histSet: new Set(navInfo.histSet), bindings: new Map() }
  walkReachable(fnNode, sf, scope, null, new Set<Node>([fnNode]), 0, out)
  return { navCalls: out.navCalls, effects: [...out.effects] }
}
