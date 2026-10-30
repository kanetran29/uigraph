// Navigation extraction for the Angular adapter: classify a nav argument as
// literal / template-prefix / dynamic, parse routerLink / [routerLink] out of a
// component template, parse `Router.navigate` / `navigateByUrl` calls, and trace a
// component method's navigations together with the enclosing if/ternary/&& guard
// (and loop/branch/early-return conditions that demote a nav to `may`).

import { Node, SyntaxKind } from 'ts-morph'
import { constantString, constantStringArray, constantForName, builderReturn, classPropertyInitializer } from './resolve'
import type { SourceFile } from 'ts-morph'
import { relative } from 'node:path'
import { inlineTemplate, type ComponentTemplate } from './templates'

export type TargetInfo =
  | { kind: 'literal'; value: string; holes?: boolean }
  | { kind: 'template'; staticPrefix: string }
  | { kind: 'dynamic' }
  // `navigate([], { queryParams })` with no commands stays on the route it is already on, so
  // it is not a transition between screens. Classifying it as dynamic drew an edge into the
  // unknown sink for all 28 such sites in the corpus, which reported a navigation that
  // changes no screen as a transition to a screen only the run time knows.
  | { kind: 'same-screen' }
  // A commands array carrying an `outlets:` object addresses a secondary outlet, which the
  // model admits no screens for (Section on the node set). It is not a transition between
  // primary screens either way, but it was only recognised as one when its first element was
  // a literal: where the array began with a spread or a variable the target read as dynamic
  // and drew an unknown-sink edge, so the same construct left the denominator or did not
  // depending on how its author wrote the first element.
  | { kind: 'aux-outlet' }

/**
 * Classify a navigation argument expression as literal / template-prefix / dynamic. A call is
 * followed one hop into the method it names, because a component that builds its links
 * (`getLogsHref()` -> `this.state.href('log', name)`) still fixes the leading segment; what the
 * run time supplies is only the tail, which is what the prefix tier is for. `depth` bounds that
 * descent, so a helper calling a helper does not walk the program.
 */
export function classifyTarget(expr: Node | undefined, depth = 0): TargetInfo {
  if (!expr) return { kind: 'dynamic' }
  if (depth < 2 && Node.isCallExpression(expr)) {
    const callee = expr.getExpression()
    const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : null
    const ret = name ? methodReturnExpression(expr.getSourceFile(), name) : undefined
    if (ret) {
      const ti = classifyTarget(ret, depth + 1)
      if (ti.kind !== 'dynamic') return ti
    }
    // A lookup table built in a computed — `accessDialogRouterLinks().get(id)` — puts every
    // value in through one `.set(key, value)`, so the destination is in that value, not in
    // the lookup. Follow the container to where it is filled.
    if (name === 'get' && Node.isPropertyAccessExpression(callee)) {
      const owner = callee.getExpression()
      const ownerName = Node.isCallExpression(owner)
        ? owner.getExpression().getText().replace(/^this\./, '')
        : Node.isPropertyAccessExpression(owner)
          ? owner.getName()
          : Node.isIdentifier(owner)
            ? owner.getText()
            : null
      const container = ownerName ? classPropertyInitializer(expr.getSourceFile(), ownerName) : undefined
      const value = container ? mapSetValue(container) : undefined
      if (value) {
        const ti = classifyTarget(value, depth + 1)
        if (ti.kind !== 'dynamic') return ti
      }
    }
    // A builder on a shared route table writes the destination out as a function of its
    // parameter; read its return array as the pattern it is.
    const built = builderReturn(callee)
    if (built && Node.isArrayLiteralExpression(built)) {
      const ti = classifyCommandParts(built.getElements().map((el) => el.getText()), built.getSourceFile())
      if (ti.kind !== 'dynamic') return ti
    }
    // A path builder of the shape `href(state, ...) { return `/${state}/...` }` fixes its
    // leading segment to one of its own parameters, so the prefix follows from binding that
    // parameter to the argument at the call site. Guessing it from the first string argument
    // instead — an earlier version of this function did — invents a prefix from an argument
    // that may mean anything, and a red-team panel reproduced a wrong edge from exactly that.
    const bound = boundLeadingSegment(expr)
    if (bound !== null) return { kind: 'template', staticPrefix: '/' + bound.replace(/^\/+/, '') + '/' }
    return { kind: 'dynamic' }
  }
  if (Node.isTemplateExpression(expr) && expr.getHead().getLiteralText() === '' ) {
    // `` `/${stateName}` `` fixes nothing by itself; its first span may still be a constant.
    const first = expr.getTemplateSpans()[0]?.getExpression()
    const lit = first ? constantString(first) : null
    if (lit !== null && lit !== '') return { kind: 'template', staticPrefix: '/' + lit.replace(/^\/+/, '') + '/' }
  }
  if (Node.isStringLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isTemplateExpression(expr)) return { kind: 'template', staticPrefix: expr.getHead().getLiteralText() }
  if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === '+') {
    const left = expr.getLeft()
    if (Node.isStringLiteral(left) || Node.isNoSubstitutionTemplateLiteral(left)) {
      return { kind: 'template', staticPrefix: left.getLiteralValue() }
    }
  }
  // `navigate(publicRoutes.demo.routerLink)` or `navigate(this.cancelRoute)` names the
  // destination instead of writing it. Follow the chain, then the name in the component's own
  // scope; a value assigned at run time resolves to nothing and stays dynamic, as it should.
  const direct = constantStringArray(expr)
  if (direct && direct.length > 0) return { kind: 'literal', value: joinCommands(direct) }
  const directStr = constantString(expr)
  if (directStr !== null) return { kind: 'literal', value: directStr }
  if (Node.isIdentifier(expr) || Node.isPropertyAccessExpression(expr)) {
    const r = constantForName(expr.getSourceFile(), expr.getText())
    if (Array.isArray(r) && r.length > 0) return { kind: 'literal', value: joinCommands(r) }
    if (typeof r === 'string') return { kind: 'literal', value: r }
  }
  return { kind: 'dynamic' }
}

export interface RawTarget {
  ti: TargetInfo
  event: string
  effect: string
  ruleId: string
  loc: { line: number; col: number }
  file?: string
  /**
   * Whether a target without a leading slash is resolved against the screen it fires from.
   * A template `routerLink` always is. `router.navigate([...])` is only when the call passes
   * `relativeTo`; without it Angular resolves from the root, and `navigateByUrl` takes a URL,
   * so both are absolute.
   */
  relative?: boolean
}

const STATIC_LINK_RE = /(?<!\[)\brouterLink\s*=\s*"([^"]*)"/g
const BOUND_LINK_RE = /\[routerLink\]\s*=\s*"([^"]*)"/g

/**
 * Parse routerLink / [routerLink] attributes out of a component's template
 * (inline or external). Each target's witness loc is its line within the
 * template text; for an external template the witness file is the html path.
 */
export function templateTargets(sf: SourceFile, projectDir: string): RawTarget[] {
  const tpl = inlineTemplate(sf)
  if (!tpl) return []
  const out: RawTarget[] = []
  const locAt = (index: number): { line: number; col: number } => templateLoc(sf, tpl, index)
  const file = tpl.externalFile ? relative(projectDir, tpl.externalFile) : undefined
  for (const m of tpl.text.matchAll(STATIC_LINK_RE)) {
    out.push({ ti: { kind: 'literal', value: m[1] ?? '' }, event: 'click:routerLink', effect: 'navigate', ruleId: 'ng.router-link', loc: locAt(m.index), file, relative: true })
  }
  for (const m of tpl.text.matchAll(BOUND_LINK_RE)) {
    out.push({ ti: classifyBoundLink(m[1] ?? '', sf), event: 'click:routerLink', effect: 'navigate', ruleId: 'ng.router-link', loc: locAt(m.index), file, relative: true })
  }
  return out
}

/** Witness loc for a position inside a template: a line within an external html file, or the .ts offset for inline templates. */
export function templateLoc(sf: SourceFile, tpl: ComponentTemplate, index: number): { line: number; col: number } {
  if (tpl.externalFile) {
    const line = tpl.text.slice(0, index).split('\n').length
    return { line, col: 1 }
  }
  // An inline template is a string literal in the .ts file, so a match inside it is at the
  // literal's start plus the match offset (+1 for the opening backtick). Reporting the
  // decorator's own line instead put every link in a long inline template on one line, where
  // nothing could tell them apart or check them against the source.
  const lc = sf.getLineAndColumnAtPos(tpl.start + 1 + index)
  return { line: lc.line, col: lc.column }
}

/**
 * The navigation target declared by a control's own `routerLink` / `[routerLink]`
 * attribute, or null when the element carries neither. A static `routerLink="/x"`
 * is a literal; a bound `[routerLink]` goes through classifyBoundLink. This is how
 * control-mode extraction anchors a template link to the element that fires it
 * (parity with the React adapter's <Link>), so the runtime driver has a selector
 * to click instead of a screen-level edge it cannot drive.
 */
export function linkAttrTarget(attrs: Map<string, string>): TargetInfo | null {
  const literal = attrs.get('routerLink')
  if (literal !== undefined) return { kind: 'literal', value: literal }
  const bound = attrs.get('[routerLink]')
  if (bound !== undefined) return classifyBoundLink(bound)
  return null
}

/**
 * Classify a bound [routerLink] expression's textual value. Handles bare string
 * literals ("'/x'" -> literal), string concatenation ("'/x/' + id" -> prefix
 * "/x/"), and array forms ("['/tag', tag]" -> prefix "/tag/"; "['/about']" ->
 * literal "/about"). Anything else over-approximates to dynamic.
 */
function classifyBoundLink(expr: string, sf?: SourceFile): TargetInfo {
  const trimmed = expr.trim()
  const literalOnly = /^'([^']*)'$/.exec(trimmed) ?? /^"([^"]*)"$/.exec(trimmed)
  if (literalOnly) return { kind: 'literal', value: literalOnly[1] ?? '' }
  const concatPrefix = /^'([^']*)'\s*\+/.exec(trimmed) ?? /^"([^"]*)"\s*\+/.exec(trimmed)
  if (concatPrefix) return { kind: 'template', staticPrefix: concatPrefix[1] ?? '' }
  if (trimmed.startsWith('[')) return classifyLinkArray(trimmed, sf)
  // `[routerLink]="routerLinkBlog"` binds to a field of the component, which commonly holds
  // the link from a shared route table (`publicRoutes.blog.routerLink`). Follow the field to
  // that constant rather than calling the whole site dynamic.
  // `[routerLink]="getLogsHref()"` names a builder on the component; read it the same way.
  const call = sf ? /^(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/.exec(trimmed) : null
  if (call) {
    const ret = methodReturnExpression(sf!, call[1] ?? '')
    if (ret) {
      const ti = classifyTarget(ret, 1)
      if (ti.kind !== 'dynamic') return ti
    }
  }
  if (sf && /^(this\.)?[A-Za-z_$][\w$.]*$/.test(trimmed)) {
    const r = constantForName(sf, trimmed)
    if (Array.isArray(r) && r.length > 0) return { kind: 'literal', value: joinCommands(r) }
    if (typeof r === 'string') return { kind: 'literal', value: r }
  }
  return { kind: 'dynamic' }
}


/**
 * Join resolved command segments as Angular joins a commands array. The leading form is kept:
 * `['/blog']` stays absolute and `['./general']` stays relative, so relative resolution against
 * the firing screen still has something to work with.
 */
function joinCommands(segs: string[]): string {
  return segs.join('/').replace(/\/+/g, '/')
}

/**
 * Classify a commands array from its already-separated parts, resolving any part that is a
 * name rather than a literal. All parts static is a literal; a static head followed by a part
 * that is not is a prefix; nothing static is dynamic.
 */
function classifyCommandParts(parts: string[], sf: SourceFile | undefined): TargetInfo {
  if (parts.length === 0) return { kind: 'same-screen' }
  if (parts.some((p) => /^\{[\s\S]*\boutlets\s*:/.test(p.trim()))) return { kind: 'aux-outlet' }
  const segs: string[] = []
  let holes = 0
  let known = 0
  for (const p of parts) {
    const lit = /^'([^']*)'$/.exec(p) ?? /^"([^"]*)"$/.exec(p)
    if (lit) {
      segs.push(lit[1] ?? '')
      known++
      continue
    }
    const resolved = sf && /^(this\.)?[A-Za-z_$][\w$.]*$/.test(p) ? constantForName(sf, p) : null
    if (resolved === null) {
      // A commands array is a PATTERN, not a prefix: `['view', row.id, 'edit']` fixes the
      // segments around the hole as firmly as the ones before it, and a declared route is a
      // pattern too, so the two match segment by segment. Standing the hole in as `:param`
      // keeps what comes after it instead of throwing the tail away.
      segs.push(':param')
      holes++
      continue
    }
    if (Array.isArray(resolved)) { segs.push(...resolved); known += resolved.length }
    else { segs.push(resolved); known++ }
  }
  if (known === 0) return { kind: 'dynamic' }
  const path = joinCommands(segs)
  if (holes === 0) return { kind: 'literal', value: path }
  // A trailing hole says nothing about what follows, so it stays a prefix; a hole in the
  // middle leaves a pattern a single declared route can satisfy.
  if (segs[segs.length - 1] === ':param') {
    const head = joinCommands(segs.slice(0, segs.length - holes))
    return { kind: 'template', staticPrefix: head.endsWith('/') ? head : head + '/' }
  }
  // The pattern pins the screen only if one declared route satisfies it, and the matcher does
  // not check that it is the only one, so the edge is offered at may rather than must.
  return { kind: 'literal', value: path, holes: true }
}

/**
 * Classify an array commands expression `['/seg', ...]`. A single static element
 * is a literal; a leading static element followed by more elements is a template
 * whose prefix is the static segments joined with trailing slash. A non-literal
 * first element is dynamic.
 */
function classifyLinkArray(arr: string, sf?: SourceFile): TargetInfo {
  const inner = arr.slice(1, arr.lastIndexOf(']'))
  const parts = splitTopLevel(inner)
  if (sf) return classifyCommandParts(parts, sf)
  if (parts.length === 0) return { kind: 'same-screen' }
  if (parts.some((p) => /^\{[\s\S]*\boutlets\s*:/.test(p.trim()))) return { kind: 'aux-outlet' }
  const lits: string[] = []
  for (const p of parts) {
    const lit = /^'([^']*)'$/.exec(p) ?? /^"([^"]*)"$/.exec(p)
    if (!lit) break
    lits.push(lit[1] ?? '')
  }
  if (lits.length === 0) return { kind: 'dynamic' }
  const staticPath = lits.join('/').replace(/\/+/g, '/')
  if (lits.length === parts.length) return { kind: 'literal', value: staticPath }
  return { kind: 'template', staticPrefix: staticPath.endsWith('/') ? staticPath : staticPath + '/' }
}

/** Split a comma-separated expression list at top level (ignoring commas inside quotes/brackets). */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (const ch of s) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === ']' || ch === ')' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      const t = cur.trim()
      if (t.length > 0) out.push(t)
      cur = ''
      continue
    }
    cur += ch
  }
  const t = cur.trim()
  if (t.length > 0) out.push(t)
  return out
}

/** Parse `this.router.navigate([...])` and `this.router.navigateByUrl(...)` calls. */
export function routerCallTargets(sf: SourceFile): RawTarget[] {
  const out: RawTarget[] = []
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    if (!Node.isPropertyAccessExpression(expr)) continue
    const member = expr.getName()
    if (member !== 'navigate' && member !== 'navigateByUrl') continue
    const lc = sf.getLineAndColumnAtPos(call.getStart())
    const loc = { line: lc.line, col: lc.column }
    if (member === 'navigateByUrl') {
      const arg0 = call.getArguments()[0]
      out.push({ ti: classifyTarget(arg0), event: 'navigate', effect: 'router.navigateByUrl', ruleId: 'ng.navigate-by-url', loc })
    } else {
      const arg0 = call.getArguments()[0]
      // `navigate(x)` takes a commands array. Written out, every element counts, not only the
      // first: `['/clients', id]` is a prefix, not the literal `/clients`.
      const relative = /\brelativeTo\s*:/.test(call.getArguments()[1]?.getText() ?? '')
      const ti =
        arg0 && Node.isArrayLiteralExpression(arg0)
          ? classifyCommandParts(arg0.getElements().map((e) => e.getText()), sf)
          : classifyTarget(arg0)
      out.push({ ti, event: 'navigate', effect: 'router.navigate', ruleId: 'ng.navigate', loc, relative })
    }
  }
  return out
}

/** Nearest enclosing if/ternary/&& condition as symbolic text, or null. */
function getGuard(node: Node): string | null {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) return null
    if (Node.isIfStatement(parent)) {
      const cond = parent.getExpression().getText()
      const then = parent.getThenStatement()
      if (then && node.getStart() >= then.getStart() && node.getEnd() <= then.getEnd()) return cond
      const els = parent.getElseStatement()
      if (els && node.getStart() >= els.getStart() && node.getEnd() <= els.getEnd()) return `!(${cond})`
    } else if (Node.isConditionalExpression(parent)) {
      if (within(parent.getWhenTrue(), node)) return parent.getCondition().getText()
      if (within(parent.getWhenFalse(), node)) return `!(${parent.getCondition().getText()})`
    } else if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getText() === '&&') {
      if (within(parent.getRight(), node)) return parent.getLeft().getText()
    }
    cur = parent
  }
}

/** Whether `node` lies within `container`'s source span. */
function within(container: Node, node: Node): boolean {
  return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd()
}

/** A loop/switch/catch/iteration/early-return context that demotes a nav to may, or null. */
function extraConditionGuard(node: Node): string | null {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) break
    if (Node.isForStatement(parent) || Node.isForOfStatement(parent) || Node.isForInStatement(parent) || Node.isWhileStatement(parent) || Node.isCaseClause(parent) || Node.isCatchClause(parent)) return 'loop/branch'
    if ((Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) && Node.isCallExpression(parent)) {
      const callee = parent.getExpression()
      if (Node.isPropertyAccessExpression(callee) && /^(map|forEach|filter|reduce|find|some|every|flatMap)$/.test(callee.getName())) return 'iteration'
    }
    cur = parent
  }
  // a preceding early-return/throw in the same block
  const block = node.getFirstAncestorByKind(SyntaxKind.Block)
  if (block) {
    for (const stmt of block.getStatements()) {
      if (stmt.getEnd() > node.getStart()) break
      if (Node.isIfStatement(stmt) && /return|throw/.test(stmt.getThenStatement()?.getText() ?? '')) return 'early-return'
    }
  }
  return null
}

/** Navigations a component method performs: trace `methodName` to its class method, collect router.navigate/navigateByUrl with guards. */
export function methodNavTargets(sf: SourceFile, methodName: string): { ti: TargetInfo; event: string; effect: string; ruleId: string; loc: { line: number; col: number }; guard: string | null }[] {
  const out: { ti: TargetInfo; event: string; effect: string; ruleId: string; loc: { line: number; col: number }; guard: string | null }[] = []
  for (const cls of sf.getClasses()) {
    const method = cls.getMethod(methodName)
    if (!method) continue
    for (const call of method.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression()
      if (!Node.isPropertyAccessExpression(expr)) continue
      const member = expr.getName()
      if (member !== 'navigate' && member !== 'navigateByUrl') continue
      const lc = sf.getLineAndColumnAtPos(call.getStart())
      const loc = { line: lc.line, col: lc.column }
      const guard = getGuard(call) ?? extraConditionGuard(call)
      if (member === 'navigateByUrl') {
        out.push({ ti: classifyTarget(call.getArguments()[0]), event: 'click', effect: 'router.navigateByUrl', ruleId: 'ng.control.navigate-by-url', loc, guard })
      } else {
        const arg0 = call.getArguments()[0]
        const first = arg0 && Node.isArrayLiteralExpression(arg0) ? arg0.getElements()[0] : undefined
        out.push({ ti: classifyTarget(first), event: 'click', effect: 'router.navigate', ruleId: 'ng.control.navigate', loc, guard })
      }
    }
    return out
  }
  return out
}

/** The expression a method of a class in `sf` returns, when it returns exactly one thing. */
function methodReturnExpression(sf: SourceFile, name: string): Node | undefined {
  for (const cls of sf.getClasses()) {
    const m = cls.getMethod(name)
    if (!m) continue
    const returns = m.getDescendantsOfKind(SyntaxKind.ReturnStatement)
    if (returns.length !== 1) return undefined
    return returns[0]?.getExpression()
  }
  return undefined
}

/** The value expression of the single `.set(key, value)` inside a container's initializer. */
function mapSetValue(container: Node): Node | undefined {
  const sets = container.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => /\.set$/.test(c.getExpression().getText()))
  if (sets.length !== 1) return undefined
  const args = sets[0]?.getArguments() ?? []
  return args[args.length - 1]
}

/**
 * The leading path segment a builder call fixes, when the builder returns a template literal
 * that opens with one of its parameters and the call passes a constant for it. Returns null
 * whenever any link in that chain is missing, which is most of the time and is the point.
 */
function boundLeadingSegment(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null
  const callee = call.getExpression()
  const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : Node.isIdentifier(callee) ? callee.getText() : null
  if (!name) return null
  const decl = call.getSourceFile().getProject().getSourceFiles()
    .flatMap((f) => f.getClasses())
    .flatMap((c) => {
      const m = c.getMethod(name)
      return m ? [m] : []
    })[0]
  if (!decl) return null
  const returns = decl.getDescendantsOfKind(SyntaxKind.ReturnStatement)
  if (returns.length !== 1) return null
  const body = returns[0]?.getExpression()
  if (!body || !Node.isTemplateExpression(body)) return null
  if (body.getHead().getLiteralText() !== '/') return null
  const first = body.getTemplateSpans()[0]?.getExpression()
  if (!first || !Node.isIdentifier(first)) return null
  const idx = decl.getParameters().findIndex((p) => p.getName() === first.getText())
  if (idx < 0) return null
  return constantString(call.getArguments()[idx])
}
