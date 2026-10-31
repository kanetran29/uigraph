// Whether a navigation runs on every execution of the code that holds it.
//
// Claim 3.1 promises that a must edge corresponds to a navigation that occurs for every input
// on which the enclosing code executes. A guard on the target route is one way a navigation
// can fail to occur; this module reads the others, at the site itself: a template control-flow
// block, a structural directive or an `<ng-template>` around a link, and, around a call, a
// branch, a loop, a catch clause, a function something else has to call, or an await or an
// early exit earlier in the same code. A site found conditional is demoted to may by the caller.
import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression } from 'ts-morph'

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const CONTROL_BLOCK = /@(?:else\s+if|if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b/y
const STRUCTURAL_ATTR = /(?:^|\s)(?:\*[a-zA-Z][\w.-]*|\[ngIf\]|\[ngForOf\])(?=[\s=>/]|$)/

/**
 * The condition the template position `offset` renders under, or null when it renders whenever
 * its template does: a control-flow block, an element that carries a structural directive, or an
 * `<ng-template>`, whose content renders only where and when something instantiates it. A loop body counts, since it runs zero times on an
 * empty list. Any attribute written with a leading asterisk is structural, an application's own
 * directive as much as *ngIf. Interpolations, comments and style sheets are blanked first, and
 * every other brace is matched as plain text, so an ICU message is not taken for a block. A scan
 * that cannot balance its braces or its elements is reported as a condition, so a template the
 * reader cannot follow costs precision rather than soundness.
 */
export function templateCondition(text: string, offset: number): string | null {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  const t = text
    .replace(/\{\{[\s\S]*?\}\}/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_m, a: string, b: string, c: string) => a + blank(b) + c)
  const braces: boolean[] = []
  const elements: { name: string; structural: string | null }[] = []
  let siteStructural: string | null = null
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
        if (t[j] === '{' && j < offset) { braces.push(true); i = j + 1; continue }
      }
    }
    if (t[i] === '{') { braces.push(false); i += 1; continue }
    if (t[i] === '}') {
      if (braces.length === 0) return 'unreadable template'
      braces.pop()
      i += 1
      continue
    }
    if (t[i] === '<') {
      const close = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(t.slice(i, i + 200))
      if (close) {
        const k = elements.map((e) => e.name).lastIndexOf(close[1]!.toLowerCase())
        if (k < 0) return 'unreadable template'
        elements.length = k
        i += close[0].length
        continue
      }
      const open = /^<([a-zA-Z][\w-]*)([^>]*?)(\/?)>/.exec(t.slice(i))
      if (open) {
        const name = open[1]!.toLowerCase()
        const structural = name === 'ng-template' ? 'ng-template' : STRUCTURAL_ATTR.test(open[2] ?? '') ? 'structural directive' : null
        if (i + open[0].length > offset) { siteStructural = structural; break }
        if (!open[3] && !VOID_ELEMENTS.has(name)) elements.push({ name, structural })
        i += open[0].length
        continue
      }
    }
    i += 1
  }
  if (braces.includes(true)) return 'control-flow block'
  return siteStructural ?? elements.find((e) => e.structural !== null)?.structural ?? null
}

/**
 * Whether `x` belongs to the code of `stmt` itself rather than to a function declared inside it,
 * which runs only when called: a return there leaves only that function, and an await there
 * suspends only it. A statement that is itself a function declaration owns nothing.
 */
function ownedBy(x: Node, stmt: Node): boolean {
  for (let a: Node | undefined = x.getParent(); a; a = a.getParent()) {
    if (Node.isFunctionLikeDeclaration(a)) return false
    if (a === stmt) return true
  }
  return false
}

/** How an earlier statement can stop the next one running: an await on a promise that may reject, or a return or throw. */
function interruption(stmt: Node): string | null {
  const owned = (k: SyntaxKind) => stmt.getDescendantsOfKind(k).some((x) => ownedBy(x, stmt))
  if (owned(SyntaxKind.AwaitExpression)) return 'after await'
  if (Node.isReturnStatement(stmt) || Node.isThrowStatement(stmt) || owned(SyntaxKind.ReturnStatement) || owned(SyntaxKind.ThrowStatement)) return 'after early exit'
  return null
}

/**
 * The condition a navigation call runs under, or null when it runs on every execution of the
 * function that holds it. The walk climbs from the call and reports a branch, a loop body, a catch clause, or an earlier
 * statement that can return, throw or await, in any enclosing block. It stops at the handler:
 * a class method, constructor or accessor, a function stored in a class field, or a function
 * declared at the top of a module. Any other function on the way up --- a callback passed to
 * subscribe, tap or setTimeout, a member of an observer object, a function declared inside the
 * handler --- runs only if and when something calls it, so the site is conditional.
 */
export function callCondition(call: CallExpression): string | null {
  let node: Node = call
  for (let parent = node.getParent(); parent; node = parent, parent = node.getParent()) {
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const top = Node.isVariableDeclaration(parent) && Node.isSourceFile(parent.getVariableStatement()?.getParent())
      return Node.isPropertyDeclaration(parent) || top ? null : 'in a callback'
    }
    if (Node.isFunctionDeclaration(node)) return Node.isSourceFile(parent) ? null : 'in a callback'
    if (Node.isMethodDeclaration(node) || Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
      return Node.isObjectLiteralExpression(parent) ? 'in a callback' : null
    }
    if (Node.isConstructorDeclaration(node)) return null
    if (Node.isIfStatement(parent) && parent.getExpression() !== node) return 'under a branch'
    if (Node.isConditionalExpression(parent) && parent.getCondition() !== node) return 'under a branch'
    if (Node.isCaseClause(parent) || Node.isDefaultClause(parent)) return 'under a branch'
    if (Node.isCatchClause(parent)) return 'in a catch clause'
    if (Node.isForStatement(parent) && parent.getInitializer() !== node) return 'in a loop'
    if ((Node.isForOfStatement(parent) || Node.isForInStatement(parent)) && parent.getExpression() !== node) return 'in a loop'
    if (Node.isWhileStatement(parent) && parent.getExpression() !== node) return 'in a loop'
    if (Node.isBinaryExpression(parent) && parent.getRight() === node) {
      const op = parent.getOperatorToken().getKind()
      if (op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken || op === SyntaxKind.QuestionQuestionToken) return 'under a branch'
    }
    if (Node.isBlock(parent) || Node.isSourceFile(parent)) {
      const stmts = parent.getStatements()
      for (const s of stmts.slice(0, stmts.indexOf(node as never))) {
        const why = interruption(s)
        if (why !== null) return why
      }
    }
  }
  return null
}
