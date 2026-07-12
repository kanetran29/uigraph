// Guard extraction: turn the syntactic context around a navigation into the
// symbolic condition under which it fires (if/ternary/&&/||/??) plus the
// non-dominance conditions (loops, switch cases, catch, iteration/render-prop
// callbacks, early-return guards) that keep a nav from being an unconditional must.

import { Node, SyntaxKind } from 'ts-morph'
import { within } from './jsx'

/**
 * Nearest enclosing guard condition as symbolic text, or null. Covers if / ternary
 * and every short-circuit operator: `&&` (RHS reached when LHS is truthy -> `lhs`),
 * `||` (RHS reached only when LHS is FALSY -> `!(lhs)`), and `??` (RHS reached only
 * when LHS is nullish -> `!(lhs)`). The `||`/`??` cases close a phantom-`must` gap:
 * `isReady || navigate('/b')` runs the navigation only when `!isReady`, so it must
 * be a `may`-edge with that guard, never an unconditional `must`.
 */
export function getGuard(node: Node): string | null {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) return null
    if (Node.isIfStatement(parent)) {
      const cond = parent.getExpression().getText()
      const then = parent.getThenStatement()
      if (then && within(then, node)) return cond
      const els = parent.getElseStatement()
      if (els && within(els, node)) return `!(${cond})`
    } else if (Node.isConditionalExpression(parent)) {
      if (within(parent.getWhenTrue(), node)) return parent.getCondition().getText()
      if (within(parent.getWhenFalse(), node)) return `!(${parent.getCondition().getText()})`
    } else if (Node.isBinaryExpression(parent)) {
      const op = parent.getOperatorToken().getText()
      if (op === '&&' && within(parent.getRight(), node)) return parent.getLeft().getText()
      if ((op === '||' || op === '??') && within(parent.getRight(), node)) return `!(${parent.getLeft().getText()})`
    }
    cur = parent
  }
}

const ITERATION_METHODS = /^(map|forEach|filter|reduce|find|some|every|flatMap)$/

/**
 * Whether a JSX expression container is the value of an `on*` event-handler attribute
 * (onClick, onSubmit, …). Used to tell a real interaction handler apart from a
 * render-prop callback: a handler's direct navigation is a legitimate `must`, a
 * render-prop's is only `may`.
 */
function isEventHandlerExpression(jsxExpr: Node): boolean {
  const parent = jsxExpr.getParent()
  if (!parent || !Node.isJsxAttribute(parent)) return false
  return /^on[A-Z]/.test(parent.getNameNode().getText())
}

/**
 * A non-dominance condition that makes a programmatic navigation NOT unconditional
 * (so it must be a `may`-edge, never a proven `must`): an enclosing loop, switch
 * case, catch, array-iteration callback, or render-prop callback, or a preceding
 * early-return/throw guard in the same block. Complements getGuard (if/ternary/&&/
 * ||/??) — together they close the phantom-`must` gap where only nearest-enclosing-
 * syntax was checked.
 */
export function extraConditionGuard(node: Node): string | null {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) break
    if (
      Node.isForStatement(parent) ||
      Node.isForOfStatement(parent) ||
      Node.isForInStatement(parent) ||
      Node.isWhileStatement(parent) ||
      Node.isDoStatement(parent)
    ) {
      return 'loop'
    }
    if (Node.isCaseClause(parent) || Node.isDefaultClause(parent)) return 'switch-case'
    if (Node.isCatchClause(parent)) return 'catch'
    if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) {
      if (Node.isCallExpression(parent)) {
        const callee = parent.getExpression()
        if (Node.isPropertyAccessExpression(callee) && ITERATION_METHODS.test(callee.getName())) return 'iteration'
        break
      }
      // A render prop: an inline callback supplied as a NON-event-handler JSX attribute
      // value (render={() => navigate(…)}) or a JSX expression child ({() => <X/>}). Its
      // body runs only when the host component invokes it at render — never guaranteed —
      // so a navigation inside it is conditional, never an unconditional `must`. An `on*`
      // handler (onClick={() => navigate(…)}) is the opposite: a real interaction anchor
      // whose direct nav IS a `must`, so it is deliberately excluded here.
      if (Node.isJsxExpression(parent) && !isEventHandlerExpression(parent)) return 'render-prop'
      break
    }
    cur = parent
  }
  return earlyReturnGuard(node)
}

/**
 * If a statement earlier in the same block guards exit with `if (cond) return`
 * (or `throw`), a later navigation is reached only when `!(cond)` — so it is
 * conditional. Returns that negated guard, or null.
 */
function earlyReturnGuard(node: Node): string | null {
  const stmt = node.getFirstAncestor((a) => Node.isStatement(a) && Node.isBlock(a.getParent()))
  if (!stmt) return null
  const block = stmt.getParent()
  if (!block || !Node.isBlock(block)) return null
  for (const sibling of block.getStatements()) {
    if (sibling.getStart() >= stmt.getStart()) break
    if (!Node.isIfStatement(sibling) || sibling.getElseStatement()) continue
    const then = sibling.getThenStatement()
    const exits =
      then.getDescendantsOfKind(SyntaxKind.ReturnStatement).length > 0 ||
      then.getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0 ||
      Node.isReturnStatement(then) ||
      Node.isThrowStatement(then)
    if (exits) return `!(${sibling.getExpression().getText()})`
  }
  return null
}
