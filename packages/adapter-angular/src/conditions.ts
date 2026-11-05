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
const EVENT_BINDING = /(?:\(([\w.:-]+)\)|(?<=\s)on-([\w.:-]+))\s*=\s*"([^"]*)"/g
// Library containers that render their content only once the user opens or selects them.
const LAZY_CONTAINERS = new Set(['mat-menu', 'mat-tab'])
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
        const structural = open.name === 'ng-template' ? 'ng-template' : LAZY_CONTAINERS.has(open.name) ? 'lazy container' : STRUCTURAL_ATTR.test(open.attrs) ? 'structural directive' : null
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
export function openTag(t: string, i: number): { name: string; attrs: string; selfClosing: boolean; end: number } | null {
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
 * hook, the constructor, a member @HostListener registers, and a member the component's
 * template binds to an event as a bare call outside any template condition. Any other member,
 * one another decorator wraps among them, runs only when one of these calls it.
 */
function handlersOf(cls: ClassDeclaration): Set<string> {
  const out = new Set<string>(LIFECYCLE)
  for (const m of cls.getMembers()) {
    if ((Node.isMethodDeclaration(m) || Node.isPropertyDeclaration(m)) && m.getDecorators().some((d) => d.getName() === 'HostListener')) out.add(m.getName())
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
 * How the component's template binds a member to an event when `handlersOf` does not count it a
 * handler: 'conditional' when a bare call to it sits under a template condition, 'unread' when
 * a binding calls it inside a longer expression (`flag && go()`, `a(); go()`), null when no
 * binding names it. A conditional binding wins, since it is the application's own condition.
 */
function bindingOf(cls: ClassDeclaration, name: string): 'conditional' | 'unread' | null {
  const tpl = inlineTemplate(cls.getSourceFile())
  const calls = new RegExp(`(?<![\\w$.])(?:this\\.)?${name.replace(/\$/g, '\\$')}\\s*\\(`)
  let found: 'conditional' | 'unread' | null = null
  for (const b of tpl?.text.matchAll(EVENT_BINDING) ?? []) {
    const expr = b[3] ?? ''
    if (!calls.test(expr)) continue
    if (isBareCall(expr) && templateCondition(tpl!.text, b.index) !== null) return 'conditional'
    if (!isBareCall(expr)) found = 'unread'
  }
  return found
}

/**
 * The condition a member of a class runs under: null when it is a handler, or when some caller
 * in the same class calls it unconditionally from a handler; otherwise the reason it may not
 * run, which names the cause. 'handler bound under a template condition' is the application's
 * own condition; 'all callers conditional' is its control flow (a cycle of calls counts, since
 * no caller in it is unconditional); 'handler not read' and 'callers not followed' are limits of
 * the reader, which does not parse a binding that is more than a bare call and does not follow a
 * call from another class. `seen` stops a cycle of calls between members.
 */
function memberCondition(cls: ClassDeclaration, name: string, seen: Set<string>): string | null {
  if (handlersOf(cls).has(name)) return null
  if (seen.has(name)) return 'all callers conditional'
  seen.add(name)
  const callers = cls.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
    const e = c.getExpression()
    return Node.isPropertyAccessExpression(e) && e.getName() === name && e.getExpression().getKind() === SyntaxKind.ThisKeyword
  })
  for (const c of callers) {
    if (callCondition(c, seen) === null) return null
  }
  const bound = bindingOf(cls, name)
  if (bound === 'conditional') return 'handler bound under a template condition'
  if (bound === 'unread') return 'handler not read'
  return callers.length > 0 ? 'all callers conditional' : 'callers not followed'
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

const NAVIGATION = /(^|\.)navigate(ByUrl)?$/

/** The bodies a call can run, where the reader can name them: a member of the same class, or a function or member the checker resolves to the application's source. */
function calleeBodies(call: CallExpression): Node[] {
  const e = call.getExpression()
  let decls: Node[] = []
  if (Node.isPropertyAccessExpression(e) && e.getExpression().getKind() === SyntaxKind.ThisKeyword) {
    const member = call.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getMember(e.getName())
    if (member) decls = [member]
  } else if (Node.isPropertyAccessExpression(e) || Node.isIdentifier(e)) {
    const sym = (Node.isPropertyAccessExpression(e) ? e.getNameNode() : e).getSymbol()
    decls = (sym?.getAliasedSymbol() ?? sym)?.getDeclarations() ?? []
  }
  const out: Node[] = []
  for (const d of decls) {
    if (d.getSourceFile().isDeclarationFile()) continue
    const fn = Node.isPropertyDeclaration(d) || Node.isVariableDeclaration(d) ? d.getInitializer() : d
    const body = fn && (Node.isMethodDeclaration(fn) || Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) ? fn.getBody() : undefined
    if (body) out.push(body)
  }
  return out
}

/**
 * Whether running `node` may start a navigation: a navigation call anywhere in it, a callback
 * included, or a call to a body the reader can name that may. A call it cannot name, into a
 * library for one, is taken not to navigate, which Section 6.3 of the thesis declares.
 */
function mayNavigate(node: Node, seen: Set<Node>): boolean {
  const calls = Node.isCallExpression(node) ? [node, ...node.getDescendantsOfKind(SyntaxKind.CallExpression)] : node.getDescendantsOfKind(SyntaxKind.CallExpression)
  for (const c of calls) {
    if (NAVIGATION.test(c.getExpression().getText())) return true
    for (const body of calleeBodies(c)) {
      if (seen.has(body)) continue
      seen.add(body)
      if (mayNavigate(body, seen)) return true
    }
  }
  return false
}

/** The order in which Angular calls a component's constructor and lifecycle hooks when it creates it. */
const CREATION_ORDER = ['constructor', 'ngOnChanges', 'ngOnInit', 'ngDoCheck', 'ngAfterContentInit', 'ngAfterContentChecked', 'ngAfterViewInit', 'ngAfterViewChecked']

/** Whether code `node` evaluates after its child `child` may start a navigation: the rest of the expression they belong to. */
function laterInExpression(node: Node, child: Node, seen: Set<Node>): boolean {
  const after = (list: Node[]) => list.slice(list.indexOf(child) + 1).some((n) => mayNavigate(n, seen))
  if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    const args = node.getArguments()
    // A callee runs after its arguments, so its body is code that follows each of them.
    if (args.includes(child as never)) return after(args) || (Node.isCallExpression(node) && calleeBodies(node).some((b) => mayNavigate(b, seen)))
    return false
  }
  if (Node.isBinaryExpression(node)) return node.getLeft() === child && mayNavigate(node.getRight(), seen)
  if (Node.isConditionalExpression(node)) return node.getCondition() === child && (mayNavigate(node.getWhenTrue(), seen) || mayNavigate(node.getWhenFalse(), seen))
  if (Node.isArrayLiteralExpression(node)) return after(node.getElements())
  if (Node.isObjectLiteralExpression(node)) return after(node.getProperties())
  if (Node.isTemplateExpression(node)) return after(node.getTemplateSpans())
  return false
}

/**
 * Whether code that runs once the function holding a navigation returns may start another: what
 * each caller in the class does after calling it, and, for a constructor or lifecycle hook, the
 * hooks Angular calls after it as it creates the component. `seen` stops a cycle of calls.
 */
function laterAfterReturn(fn: Node, seen: Set<Node>): boolean {
  if (seen.has(fn)) return false
  seen.add(fn)
  const holder = Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) ? fn.getParent() : fn
  const cls = holder?.getParentIfKind(SyntaxKind.ClassDeclaration)
  if (!holder || !cls) return false
  const name = Node.isConstructorDeclaration(holder) ? 'constructor' : Node.isMethodDeclaration(holder) || Node.isPropertyDeclaration(holder) ? holder.getName() : undefined
  if (name === undefined) return false
  const step = CREATION_ORDER.indexOf(name)
  if (step >= 0) {
    for (const later of CREATION_ORDER.slice(step + 1)) {
      const body = cls.getMember(later)
      if (body && mayNavigate(body, seen)) return true
    }
  }
  const callers = cls.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
    const e = c.getExpression()
    return Node.isPropertyAccessExpression(e) && e.getName() === name && e.getExpression().getKind() === SyntaxKind.ThisKeyword
  })
  return callers.some((c) => supersededAt(c, seen))
}

/**
 * Whether code that runs after `call`, before the event that triggered it has been handled, may
 * start a navigation: the rest of the expression and the statement that hold it, the statements
 * after it in its block and in every block around it up to its function, a finally block around
 * it, and then whatever runs once that function returns (`laterAfterReturn`). A navigation started
 * there begins before the one `call` makes can finish, and the router cancels the first. A
 * navigation call that is awaited has finished before anything after it in its function runs, but
 * not before its function's callers go on, since an async function returns at its first await; a
 * call to anything else is not taken to cover the navigations it makes, which it may not return.
 */
function supersededAt(call: CallExpression, seen = new Set<Node>()): boolean {
  const navigates = NAVIGATION.test(call.getExpression().getText())
  let awaited = false
  let node: Node = call
  for (let parent = node.getParent(); parent; node = parent, parent = node.getParent()) {
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      // A callback runs when something calls it; only a class member's callers are followed.
      return Node.isPropertyDeclaration(parent) ? laterAfterReturn(node, seen) : false
    }
    if (Node.isFunctionLikeDeclaration(node)) return laterAfterReturn(node, seen)
    if (navigates && node === call && Node.isAwaitExpression(parent)) awaited = true
    if (awaited) continue
    if (laterInExpression(parent, node, seen)) return true
    if (Node.isBlock(parent) || Node.isSourceFile(parent) || Node.isCaseClause(parent) || Node.isDefaultClause(parent)) {
      const stmts = parent.getStatements()
      if (stmts.slice(stmts.indexOf(node as never) + 1).some((s) => mayNavigate(s, seen))) return true
    }
    if (Node.isTryStatement(parent) && parent.getFinallyBlock() !== node) {
      const fin = parent.getFinallyBlock()
      if (fin && mayNavigate(fin, seen)) return true
    }
  }
  return false
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
 * the top of a module is a helper too: whoever calls it, the reader does not follow the call.
 * A navigation that code after it may follow with another, before its function returns, is
 * superseded: the router cancels the first when the second starts (see `supersededAt`).
 */
export function callCondition(call: CallExpression, seen = new Set<string>()): string | null {
  if (/\?\./.test(call.getExpression().getText())) return 'under a branch'
  if (supersededAt(call)) return 'superseded by a later navigation'
  let node: Node = call
  for (let parent = node.getParent(); parent; node = parent, parent = node.getParent()) {
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      if (Node.isVariableDeclaration(parent) && Node.isSourceFile(parent.getVariableStatement()?.getParent())) return 'in a helper function'
      const cls = Node.isPropertyDeclaration(parent) ? parent.getParentIfKind(SyntaxKind.ClassDeclaration) : undefined
      return cls && Node.isPropertyDeclaration(parent) ? memberCondition(cls, parent.getName(), seen) : 'in a callback'
    }
    if (Node.isFunctionDeclaration(node)) return Node.isSourceFile(parent) ? 'in a helper function' : 'in a callback'
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
