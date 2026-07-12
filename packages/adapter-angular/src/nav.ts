// Navigation extraction for the Angular adapter: classify a nav argument as
// literal / template-prefix / dynamic, parse routerLink / [routerLink] out of a
// component template, parse `Router.navigate` / `navigateByUrl` calls, and trace a
// component method's navigations together with the enclosing if/ternary/&& guard
// (and loop/branch/early-return conditions that demote a nav to `may`).

import { Node, SyntaxKind } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { relative } from 'node:path'
import { inlineTemplate, type ComponentTemplate } from './templates'

export type TargetInfo =
  | { kind: 'literal'; value: string }
  | { kind: 'template'; staticPrefix: string }
  | { kind: 'dynamic' }

/** Classify a navigation argument expression as literal / template-prefix / dynamic. */
export function classifyTarget(expr: Node | undefined): TargetInfo {
  if (!expr) return { kind: 'dynamic' }
  if (Node.isStringLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isTemplateExpression(expr)) return { kind: 'template', staticPrefix: expr.getHead().getLiteralText() }
  if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === '+') {
    const left = expr.getLeft()
    if (Node.isStringLiteral(left) || Node.isNoSubstitutionTemplateLiteral(left)) {
      return { kind: 'template', staticPrefix: left.getLiteralValue() }
    }
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
    out.push({ ti: { kind: 'literal', value: m[1] ?? '' }, event: 'click:routerLink', effect: 'navigate', ruleId: 'ng.router-link', loc: locAt(m.index), file })
  }
  for (const m of tpl.text.matchAll(BOUND_LINK_RE)) {
    out.push({ ti: classifyBoundLink(m[1] ?? ''), event: 'click:routerLink', effect: 'navigate', ruleId: 'ng.router-link', loc: locAt(m.index), file })
  }
  return out
}

/** Witness loc for a position inside a template: a line within an external html file, or the .ts offset for inline templates. */
function templateLoc(sf: SourceFile, tpl: ComponentTemplate, index: number): { line: number; col: number } {
  if (tpl.externalFile) {
    const line = tpl.text.slice(0, index).split('\n').length
    return { line, col: 1 }
  }
  const lc = sf.getLineAndColumnAtPos(tpl.start)
  return { line: lc.line, col: lc.column }
}

/**
 * Classify a bound [routerLink] expression's textual value. Handles bare string
 * literals ("'/x'" -> literal), string concatenation ("'/x/' + id" -> prefix
 * "/x/"), and array forms ("['/tag', tag]" -> prefix "/tag/"; "['/about']" ->
 * literal "/about"). Anything else over-approximates to dynamic.
 */
function classifyBoundLink(expr: string): TargetInfo {
  const trimmed = expr.trim()
  const literalOnly = /^'([^']*)'$/.exec(trimmed) ?? /^"([^"]*)"$/.exec(trimmed)
  if (literalOnly) return { kind: 'literal', value: literalOnly[1] ?? '' }
  const concatPrefix = /^'([^']*)'\s*\+/.exec(trimmed) ?? /^"([^"]*)"\s*\+/.exec(trimmed)
  if (concatPrefix) return { kind: 'template', staticPrefix: concatPrefix[1] ?? '' }
  if (trimmed.startsWith('[')) return classifyLinkArray(trimmed)
  return { kind: 'dynamic' }
}

/**
 * Classify an array commands expression `['/seg', ...]`. A single static element
 * is a literal; a leading static element followed by more elements is a template
 * whose prefix is the static segments joined with trailing slash. A non-literal
 * first element is dynamic.
 */
function classifyLinkArray(arr: string): TargetInfo {
  const inner = arr.slice(1, arr.lastIndexOf(']'))
  const parts = splitTopLevel(inner)
  if (parts.length === 0) return { kind: 'dynamic' }
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
      const first = arg0 && Node.isArrayLiteralExpression(arg0) ? arg0.getElements()[0] : undefined
      out.push({ ti: classifyTarget(first), event: 'navigate', effect: 'router.navigate', ruleId: 'ng.navigate', loc })
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
