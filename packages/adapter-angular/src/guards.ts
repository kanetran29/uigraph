// Angular route-guard analysis for `canActivate`. Handles three shapes a guard
// element can take: a class reference (`canActivate: [AuthGuard]`), a named
// functional guard (`canActivate: [requireAuth]` where `requireAuth` is a
// `CanActivateFn`/arrow const), and an inline arrow guard
// (`canActivate: [() => inject(X).isAuthenticated.pipe(...)]`). Each guard is
// reduced to stable symbolic text plus a confidence + modality signal. The guard
// id prefers the function NAME (stable across edits and source moves); only when
// a guard is anonymous does it fall back to a hash of the return-expression text
// (NOT the source position) so the same body yields the same id.

import { Node } from 'ts-morph'
import type { Expression, SourceFile } from 'ts-morph'
import { fnv1a } from '@uigraph/core'

/**
 * One analyzed `canActivate` guard. `text` is the symbolic guard string put on
 * the edge. `async` flags an Observable/Promise-returning guard (the body cannot
 * be evaluated statically, so confidence drops and a soundiness note is owed).
 * `literalBoolean` is set only when the guard body is a literal `true`/`false`,
 * in which case the gate is statically decided and modality need not be demoted.
 */
export interface GuardInfo {
  text: string
  kind: 'class' | 'functional'
  async: boolean
  literalBoolean?: boolean
}

const FN_HASH_LEN = 8

/**
 * Resolve a same-file `const name = ...` declaration's initializer for an
 * identifier used in `canActivate`, so a named functional guard
 * (`const requireAuth = () => ...`) can be inspected. Returns null when the
 * identifier has no local variable initializer (e.g. an imported guard class).
 */
function localInitializer(sf: SourceFile, name: string): Expression | undefined {
  for (const vd of sf.getVariableDeclarations()) {
    if (vd.getName() !== name) continue
    return vd.getInitializer()
  }
  return undefined
}

/**
 * Whether an expression is (or directly returns) a function — an arrow function
 * or function expression. Used to tell a functional guard const apart from a
 * guard class reference.
 */
function asFunction(expr: Expression | undefined): Node | undefined {
  if (!expr) return undefined
  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) return expr
  return undefined
}

const ASYNC_BODY_RE = /\.pipe\s*\(|\.subscribe\s*\(|\bObservable\b|\bPromise\b|\basync\b|\.then\s*\(|\btoPromise\s*\(|\bfirstValueFrom\b|\blastValueFrom\b/

/**
 * Classify a guard function's body: detect Observable/Promise-returning guards
 * (async, low-confidence) and literal-boolean guards (statically decided). The
 * async check is textual over the body so it covers `.pipe(...)` chains, explicit
 * `Observable`/`Promise` annotations, and `async`/`.then(...)` forms without a
 * full type-resolution pass.
 */
function classifyBody(fn: Node): { async: boolean; literalBoolean?: boolean } {
  const bodyText = fn.getText()
  const async = ASYNC_BODY_RE.test(bodyText)
  let literalBoolean: boolean | undefined
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody()
    if (Node.isTrueLiteral(body)) literalBoolean = true
    else if (Node.isFalseLiteral(body)) literalBoolean = false
  }
  return { async, ...(literalBoolean !== undefined ? { literalBoolean } : {}) }
}

/**
 * Stable text for an anonymous functional guard: a short hash of the
 * return-expression text (the arrow body, or the function's text), so the same
 * guard body always yields the same id regardless of where it appears.
 */
function anonymousGuardText(fn: Node): string {
  let basis = fn.getText()
  if (Node.isArrowFunction(fn)) basis = fn.getBody().getText()
  return `fn#${fnv1a(basis.replace(/\s+/g, ' ').trim()).slice(0, FN_HASH_LEN)}`
}

/**
 * Analyze one `canActivate` array element. An inline arrow/function expression is
 * a functional guard named by its body hash; a bare identifier resolves to either
 * a local functional-guard const (named by the identifier, body inspected) or, if
 * it has no local function initializer, a guard class reference (named by the
 * identifier, treated as a class gate). Returns null for shapes we cannot name.
 */
function analyzeElement(sf: SourceFile, el: Node): GuardInfo | null {
  const inlineFn = asFunction(Node.isExpression(el) ? el : undefined)
  if (inlineFn) {
    const { async, literalBoolean } = classifyBody(inlineFn)
    return { text: anonymousGuardText(inlineFn), kind: 'functional', async, ...(literalBoolean !== undefined ? { literalBoolean } : {}) }
  }
  if (Node.isIdentifier(el)) {
    const name = el.getText()
    const init = localInitializer(sf, name)
    const fn = asFunction(init)
    if (fn) {
      const { async, literalBoolean } = classifyBody(fn)
      return { text: name, kind: 'functional', async, ...(literalBoolean !== undefined ? { literalBoolean } : {}) }
    }
    return { text: name, kind: 'class', async: false }
  }
  return null
}

/**
 * Analyze a route object's `canActivate: [...]` array into per-guard descriptors.
 * Each element is classified independently (class / named-functional /
 * inline-functional); unrecognizable elements are skipped. The route's source
 * file is needed to resolve named functional-guard consts.
 */
export function analyzeCanActivate(sf: SourceFile, arrayLiteralEls: Node[]): GuardInfo[] {
  const out: GuardInfo[] = []
  for (const el of arrayLiteralEls) {
    const info = analyzeElement(sf, el)
    if (info) out.push(info)
  }
  return out
}
