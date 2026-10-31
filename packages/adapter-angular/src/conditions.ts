// Whether a navigation runs on every execution of the code that holds it.
//
// Claim 3.1 promises that a must edge corresponds to a navigation that occurs for every input
// on which the enclosing code executes. A guard on the target route is one way a navigation
// can fail to occur; this module reads the others, at the site itself: a template control-flow
// block or structural directive around a link, and, around a call, a branch, a callback an
// asynchronous result invokes, or an await a rejection would skip. A site found conditional is
// demoted to may by the caller.
import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const CONTROL_BLOCK = /@(?:else\s+if|if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b/y
const STRUCTURAL_ATTR = /(?:^|\s)(?:\*[a-zA-Z][\w.-]*|\[ngIf\]|\[ngForOf\])(?=[\s=>/]|$)/
const ASYNC_CALLEES = new Set(['subscribe', 'then', 'catch', 'finally'])
const ASYNC_KEYS = new Set(['next', 'error', 'complete'])

/**
 * Whether the template position `offset` lies inside a control-flow block or inside an element
 * that carries a structural directive. A loop body counts, since it runs zero times on an empty
 * list. The template is scanned from its start with one stack of open blocks, closed by the
 * brace that ends each, and one of open elements; interpolations are blanked first so their
 * braces are not taken for blocks. Any attribute written with a leading asterisk is structural,
 * an application's own directive as much as *ngIf. A scan that cannot balance its stacks
 * returns true, so a template the reader cannot follow costs precision rather than soundness.
 */
export function templateConditional(text: string, offset: number): boolean {
  const t = text.replace(/\{\{[\s\S]*?\}\}/g, (m) => ' '.repeat(m.length))
  let blocks = 0
  const elements: { name: string; structural: boolean }[] = []
  let siteStructural = false
  let i = 0
  while (i < offset) {
    if (t[i] === '@') {
      CONTROL_BLOCK.lastIndex = i
      const m = CONTROL_BLOCK.exec(t)
      if (m) {
        let j = i + m[0].length
        while (j < t.length && /\s/.test(t[j]!)) j += 1
        if (t[j] === '(') {
          let depth = 0
          for (; j < t.length; j += 1) {
            if (t[j] === '(') depth += 1
            else if (t[j] === ')' && --depth === 0) { j += 1; break }
          }
        }
        while (j < t.length && /\s/.test(t[j]!)) j += 1
        if (t[j] === '{' && j < offset) { blocks += 1; i = j + 1; continue }
      }
    }
    if (t[i] === '}') {
      if (blocks === 0) return true
      blocks -= 1
      i += 1
      continue
    }
    if (t[i] === '<') {
      const close = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(t.slice(i, i + 200))
      if (close) {
        const k = elements.map((e) => e.name).lastIndexOf(close[1]!.toLowerCase())
        if (k < 0) return true
        elements.length = k
        i += close[0].length
        continue
      }
      const open = /^<([a-zA-Z][\w-]*)([^>]*?)(\/?)>/.exec(t.slice(i))
      if (open) {
        const structural = STRUCTURAL_ATTR.test(open[2] ?? '')
        if (i + open[0].length > offset) { siteStructural = structural; break }
        const name = open[1]!.toLowerCase()
        if (!open[3] && !VOID_ELEMENTS.has(name)) elements.push({ name, structural })
        i += open[0].length
        continue
      }
    }
    i += 1
  }
  return blocks > 0 || siteStructural || elements.some((e) => e.structural)
}

/**
 * Whether a statement can leave the function that holds it before control reaches what follows:
 * a return or a throw in it, unless that return or throw belongs to a function nested inside the
 * statement, such as a callback, which leaves only the callback.
 */
function exitsBefore(stmt: Node): boolean {
  if (Node.isReturnStatement(stmt) || Node.isThrowStatement(stmt)) return true
  const exits = [...stmt.getDescendantsOfKind(SyntaxKind.ReturnStatement), ...stmt.getDescendantsOfKind(SyntaxKind.ThrowStatement)]
  return exits.some((x) => {
    for (let a: Node | undefined = x.getParent(); a && a !== stmt; a = a.getParent()) {
      if (Node.isArrowFunction(a) || Node.isFunctionExpression(a) || Node.isFunctionDeclaration(a) || Node.isMethodDeclaration(a)) return false
    }
    return true
  })
}

/**
 * Whether a navigation call runs only on some executions of the function that holds it. The
 * walk climbs from the call to that function and reports a branch it sits in, an await or an
 * early return or throw earlier in an enclosing block, or a callback passed to subscribe, then,
 * catch or finally -- directly
 * or as the next, error or complete member of an observer object. It continues through such a
 * callback to the function that registered it, and stops at any other function boundary: above
 * that is the event handler itself, and the handler running is what the edge's event means.
 */
export function callConditional(call: CallExpression): boolean {
  let node: Node = call
  for (let parent = node.getParent(); parent; node = parent, parent = node.getParent()) {
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const viaKey = Node.isPropertyAssignment(parent) && ASYNC_KEYS.has(parent.getName())
      const host = viaKey ? parent.getParent()?.getParent() : parent
      const callee = host && Node.isCallExpression(host) ? host.getExpression() : undefined
      if (callee && Node.isPropertyAccessExpression(callee) && ASYNC_CALLEES.has(callee.getName())) return true
      return false
    }
    if (Node.isMethodDeclaration(node) || Node.isFunctionDeclaration(node) || Node.isConstructorDeclaration(node) ||
        Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) return false
    if (Node.isIfStatement(parent) && parent.getExpression() !== node) return true
    if (Node.isConditionalExpression(parent) && parent.getCondition() !== node) return true
    if (Node.isCaseClause(parent) || Node.isDefaultClause(parent)) return true
    if (Node.isBinaryExpression(parent) && parent.getRight() === node) {
      const op = parent.getOperatorToken().getKind()
      if (op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken || op === SyntaxKind.QuestionQuestionToken) return true
    }
    if (Node.isBlock(parent)) {
      const before = parent.getStatements().slice(0, parent.getStatements().indexOf(node as never))
      if (before.some((s) => s.getDescendantsOfKind(SyntaxKind.AwaitExpression).length > 0 || exitsBefore(s))) return true
    }
  }
  return false
}
