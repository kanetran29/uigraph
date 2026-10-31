// Whether a navigation runs on every execution of the code that holds it.
//
// Claim 3.1 promises that a must edge corresponds to a navigation that occurs for every input
// on which the enclosing code executes. A guard on the target route is one way a navigation
// can fail to occur; this module reads the others, at the site itself: a template control-flow
// block, a structural directive or an `<ng-template>` around a link, and, around a call, a
// branch, a loop, a catch clause, a function something else has to call, or an await or an
// early exit earlier in the same code. A site found conditional is demoted to may by the caller.
import { Node, SyntaxKind } from 'ts-morph'
import type { CallExpression, ClassDeclaration } from 'ts-morph'
import { inlineTemplate } from './templates'

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const CONTROL_BLOCK = /@(?:else\s+if|if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b/y
const STRUCTURAL_ATTR = /(?:^|\s)(?:\*[a-zA-Z][\w.-]*|\[ngIf\]|\[ngForOf\])(?=[\s=>/]|$)/
const ICU_OPEN = /^\{\s*[^{}]*?,\s*(?:plural|select|selectordinal)\s*,/
const EVENT_BINDING = /(?:\(([\w.:-]+)\)|\bon-([\w.:-]+))\s*=\s*"([^"]*)"/g
const LIFECYCLE = new Set(['ngOnInit', 'ngOnChanges', 'ngDoCheck', 'ngAfterContentInit', 'ngAfterContentChecked', 'ngAfterViewInit', 'ngAfterViewChecked', 'ngOnDestroy'])

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
  const braces: ('block' | 'plain' | 'icu')[] = []
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
        if (t[j] === '{' && j < offset) { braces.push('block'); i = j + 1; continue }
      }
    }
    if (t[i] === '{') { braces.push(ICU_OPEN.test(t.slice(i, i + 200)) ? 'icu' : 'plain'); i += 1; continue }
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
      const open = openTag(t, i)
      if (open) {
        const structural = open.name === 'ng-template' ? 'ng-template' : STRUCTURAL_ATTR.test(open.attrs) ? 'structural directive' : null
        if (open.end > offset) { siteStructural = structural; break }
        if (!open.selfClosing && !VOID_ELEMENTS.has(open.name)) elements.push({ name: open.name, structural })
        i = open.end
        continue
      }
    }
    i += 1
  }
  if (braces.includes('block')) return 'control-flow block'
  // Angular builds an ICU case from inert markup and instantiates no directive in it, so a link
  // there never navigates; it renders, if at all, only for the case selected.
  if (braces.includes('icu')) return 'ICU case'
  return siteStructural ?? elements.find((e) => e.structural !== null)?.structural ?? null
}

/**
 * The open tag that starts at `i`, read with its attribute values quoted, so a `>` inside
 * `[class.a]="n > 0"` does not end it. Null when no tag starts there.
 */
function openTag(t: string, i: number): { name: string; attrs: string; selfClosing: boolean; end: number } | null {
  const head = /^<([a-zA-Z][\w-]*)/.exec(t.slice(i, i + 100))
  if (!head) return null
  let quote: string | null = null
  for (let j = i + head[0].length; j < t.length; j += 1) {
    const ch = t[j]!
    if (quote) { if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '>') {
      const attrs = t.slice(i + head[0].length, j)
      return { name: head[1]!.toLowerCase(), attrs, selfClosing: attrs.trimEnd().endsWith('/'), end: j + 1 }
    }
  }
  return null
}

/**
 * Whether a template event binding is a single call and nothing else, `go()` or `this.go(x);`,
 * so the method runs whenever the event fires. A binding that guards the call, chains it or
 * branches around it runs it only on some events.
 */
export function isBareCall(binding: string): boolean {
  const m = /^\s*(?:this\.)?[A-Za-z_$][\w$]*\s*\(/.exec(binding)
  if (!m) return false
  let depth = 0
  let quote: string | null = null
  for (let i = m[0].length - 1; i < binding.length; i += 1) {
    const ch = binding[i]!
    if (quote) { if (ch === quote && binding[i - 1] !== '\\') quote = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '(') depth += 1
    else if (ch === ')' && --depth === 0) return /^\s*;?\s*$/.test(binding.slice(i + 1))
  }
  return false
}

/**
 * The members of a class that run whenever the event that triggers them fires: a lifecycle
 * hook, the constructor, a member a decorator such as @HostListener registers, and a member the
 * component's template binds to an event as a bare call outside any template condition. Any
 * other member runs only when one of these calls it.
 */
function handlersOf(cls: ClassDeclaration): Set<string> {
  const out = new Set<string>(LIFECYCLE)
  for (const m of cls.getMembers()) {
    if ((Node.isMethodDeclaration(m) || Node.isPropertyDeclaration(m)) && m.getDecorators().length > 0) out.add(m.getName())
  }
  const tpl = inlineTemplate(cls.getSourceFile())
  for (const b of tpl?.text.matchAll(EVENT_BINDING) ?? []) {
    const expr = b[3] ?? ''
    if (!isBareCall(expr) || templateCondition(tpl!.text, b.index) !== null) continue
    const name = /^\s*(?:this\.)?([A-Za-z_$][\w$]*)/.exec(expr)?.[1]
    if (name) out.add(name)
  }
  return out
}

/**
 * The condition a member of a class runs under: null when it is a handler, or when some caller
 * in the same class calls it unconditionally from a handler; otherwise the reason it may not
 * run. `seen` stops a cycle of calls between members.
 */
function memberCondition(cls: ClassDeclaration, name: string, seen: Set<string>): string | null {
  if (handlersOf(cls).has(name)) return null
  if (seen.has(name)) return 'in a helper method'
  seen.add(name)
  const callers = cls.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
    const e = c.getExpression()
    return Node.isPropertyAccessExpression(e) && e.getName() === name && e.getExpression().getKind() === SyntaxKind.ThisKeyword
  })
  for (const c of callers) {
    if (callCondition(c, seen) === null) return null
  }
  return 'in a helper method'
}

/** Whether a break or continue in an earlier statement can skip what follows it: one whose target encloses that statement. */
function leavesBlock(x: Node, stmt: Node): boolean {
  const label = Node.isBreakStatement(x) || Node.isContinueStatement(x) ? x.getLabel()?.getText() : undefined
  for (let a: Node | undefined = x.getParent(); a && a !== stmt.getParent(); a = a.getParent()) {
    if (Node.isFunctionLikeDeclaration(a)) return false
    if (label !== undefined && Node.isLabeledStatement(a) && a.getLabel().getText() === label) return false
    if (label === undefined && (Node.isIterationStatement(a) || (Node.isSwitchStatement(a) && Node.isBreakStatement(x)))) return false
  }
  return true
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
  const jumps = [...stmt.getDescendantsOfKind(SyntaxKind.BreakStatement), ...stmt.getDescendantsOfKind(SyntaxKind.ContinueStatement)]
  if (Node.isBreakStatement(stmt) || Node.isContinueStatement(stmt) || jumps.some((x) => leavesBlock(x, stmt))) return 'after early exit'
  return null
}

/**
 * The condition a navigation call runs under, or null when it runs on every execution of the
 * handler that holds it. The walk climbs from the call and reports a branch, a loop body, a catch
 * clause, an optional call, a default parameter value, or an earlier statement that can return,
 * throw, break out or await, in any enclosing block. A function on the way up --- a callback
 * passed to subscribe, tap or setTimeout, a member of an observer object, a function declared
 * inside another --- runs only if and when something calls it. A member of a class is a handler
 * only when the template or the framework calls it directly (see `handlersOf`); any other member
 * runs when a handler calls it, so the walk continues from each call to it in the class and
 * reports a condition unless one of those calls is itself unconditional. A function declared at
 * the top of a module is taken as a handler.
 */
export function callCondition(call: CallExpression, seen = new Set<string>()): string | null {
  if (/\?\./.test(call.getExpression().getText())) return 'under a branch'
  let node: Node = call
  for (let parent = node.getParent(); parent; node = parent, parent = node.getParent()) {
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      if (Node.isVariableDeclaration(parent) && Node.isSourceFile(parent.getVariableStatement()?.getParent())) return null
      const cls = Node.isPropertyDeclaration(parent) ? parent.getParentIfKind(SyntaxKind.ClassDeclaration) : undefined
      return cls && Node.isPropertyDeclaration(parent) ? memberCondition(cls, parent.getName(), seen) : 'in a callback'
    }
    if (Node.isFunctionDeclaration(node)) return Node.isSourceFile(parent) ? null : 'in a callback'
    if (Node.isMethodDeclaration(node) || Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
      if (Node.isObjectLiteralExpression(parent)) return 'in a callback'
      return Node.isClassDeclaration(parent) ? memberCondition(parent, node.getName(), seen) : null
    }
    if (Node.isConstructorDeclaration(node)) return null
    if (Node.isIfStatement(parent) && parent.getExpression() !== node) return 'under a branch'
    if (Node.isConditionalExpression(parent) && parent.getCondition() !== node) return 'under a branch'
    if (Node.isCaseClause(parent) || Node.isDefaultClause(parent)) return 'under a branch'
    if (Node.isCatchClause(parent)) return 'in a catch clause'
    if (Node.isForStatement(parent) && parent.getInitializer() !== node) return 'in a loop'
    if ((Node.isForOfStatement(parent) || Node.isForInStatement(parent)) && parent.getExpression() !== node) return 'in a loop'
    if (Node.isWhileStatement(parent) && parent.getExpression() !== node) return 'in a loop'
    if (Node.isParameterDeclaration(parent) && parent.getInitializer() === node) return 'under a branch'
    if (Node.isCallExpression(parent) && parent.getArguments().includes(node as never) && /\?\./.test(parent.getExpression().getText())) return 'under a branch'
    if (Node.isBinaryExpression(parent) && parent.getRight() === node) {
      const op = parent.getOperatorToken().getKind()
      if ([SyntaxKind.AmpersandAmpersandToken, SyntaxKind.BarBarToken, SyntaxKind.QuestionQuestionToken,
        SyntaxKind.AmpersandAmpersandEqualsToken, SyntaxKind.BarBarEqualsToken, SyntaxKind.QuestionQuestionEqualsToken].includes(op)) return 'under a branch'
    }
    if (Node.isBlock(parent) || Node.isSourceFile(parent) || Node.isCaseClause(parent)) {
      const stmts = parent.getStatements()
      for (const s of stmts.slice(0, stmts.indexOf(node as never))) {
        const why = interruption(s)
        if (why !== null) return why
      }
    }
  }
  return null
}
