// Navigation-target classification and collection: turn a JSX `to`/`href` attr or a
// programmatic push/replace/navigate/redirect call into a TargetInfo (literal /
// template / enum / dynamic), discover the nav-hook identifiers in a file, and sweep
// a source file (or an inline-route subtree) into the raw targets the engine resolves.

import { Node, SyntaxKind } from 'ts-morph'
import type { JsxAttribute, SourceFile } from 'ts-morph'
import type { RawTarget, TargetInfo } from './types'
import { allJsxElements, findAttr, isJsxEl, jsxTag } from './jsx'
import { extraConditionGuard, getGuard } from './guards'
import { resolveComponentFile } from './resolve'

/** A literal/template/dynamic classification of a navigation target expression. */
export function classifyTarget(expr: Node | undefined, sf?: SourceFile): TargetInfo {
  if (!expr) return { kind: 'dynamic' }
  if (Node.isStringLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isNoSubstitutionTemplateLiteral(expr)) return { kind: 'literal', value: expr.getLiteralValue() }
  if (Node.isTemplateExpression(expr)) return { kind: 'template', staticPrefix: expr.getHead().getLiteralText() }
  // react-router To object form: navigate({ pathname: '/x', search: '…' }) — a
  // literal pathname is as static as a string literal; the other members (search,
  // hash, state) never change the destination route.
  if (Node.isObjectLiteralExpression(expr)) {
    const v = literalPropertyValue(expr, 'pathname')
    if (v !== undefined) return { kind: 'literal', value: v }
  }
  // A lookup into a const route-map, e.g. push(subviewPaths[sv]) or navigate(ROUTES.account):
  // a NAMED property resolves to its exact literal value; a computed key over-approximates
  // to the map's literal string values (the real possible destinations).
  if (sf && (Node.isElementAccessExpression(expr) || Node.isPropertyAccessExpression(expr))) {
    const obj = expr.getExpression()
    if (Node.isIdentifier(obj)) {
      if (Node.isPropertyAccessExpression(expr)) {
        const init = constInitializer(obj.getText(), sf)
        const v = init !== undefined && Node.isObjectLiteralExpression(init) ? literalPropertyValue(init, expr.getName()) : undefined
        if (v !== undefined) return { kind: 'literal', value: v }
      }
      const values = resolveConstStringValues(obj.getText(), sf)
      if (values.length > 0) return { kind: 'enum', values }
    }
  }
  return { kind: 'dynamic', expr: expr.getText() }
}

/** The literal string value of an object literal's named property, or undefined. */
function literalPropertyValue(obj: Node, name: string): string | undefined {
  if (!Node.isObjectLiteralExpression(obj)) return undefined
  const p = obj.getProperty(name)
  if (!p || !Node.isPropertyAssignment(p)) return undefined
  const v = p.getInitializer()
  return v && (Node.isStringLiteral(v) || Node.isNoSubstitutionTemplateLiteral(v)) ? v.getLiteralValue() : undefined
}

/**
 * The initializer of a module-level `const NAME = …`, stripped of `as const` /
 * `satisfies` / parens, following a named/default import to its declaring module
 * when NAME is not declared locally — so an app-wide route-constants module
 * (`import { ROUTES } from './routes'`) still resolves.
 */
function constInitializer(name: string, sf: SourceFile): Node | undefined {
  let decl = sf.getVariableDeclaration(name)
  if (!decl) decl = resolveComponentFile(sf, name)?.getVariableDeclaration(name)
  let init: Node | undefined = decl?.getInitializer()
  while (init !== undefined && (Node.isAsExpression(init) || Node.isSatisfiesExpression(init) || Node.isParenthesizedExpression(init))) init = init.getExpression()
  return init
}

/** The literal string values of a module-level `const X = {…}` / `const X = […]`, for const route-maps. */
function resolveConstStringValues(name: string, sf: SourceFile): string[] {
  const init = constInitializer(name, sf)
  const out: string[] = []
  if (init && Node.isObjectLiteralExpression(init)) {
    for (const p of init.getProperties()) {
      if (!Node.isPropertyAssignment(p)) continue
      const v = p.getInitializer()
      if (v && (Node.isStringLiteral(v) || Node.isNoSubstitutionTemplateLiteral(v))) out.push(v.getLiteralValue())
    }
  } else if (init && Node.isArrayLiteralExpression(init)) {
    for (const e of init.getElements()) if (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e)) out.push(e.getLiteralValue())
  }
  return out
}

/** Classify a JSX `to`/`href` attribute's value into a TargetInfo. */
function classifyToAttr(attr: JsxAttribute | undefined): TargetInfo {
  if (!attr) return { kind: 'dynamic' }
  const init = attr.getInitializer()
  if (!init) return { kind: 'dynamic' }
  if (Node.isStringLiteral(init)) return { kind: 'literal', value: init.getLiteralValue() }
  if (Node.isJsxExpression(init)) return classifyTarget(init.getExpression())
  return { kind: 'dynamic', expr: init.getText() }
}

/** The nav/history/router hook-bound identifiers and next/navigation redirect names declared in a file. */
export function navIdentifiers(sf: SourceFile): { navSet: Set<string>; histSet: Set<string>; routerSet: Set<string>; redirectNames: Set<string> } {
  const navSet = new Set<string>()
  const histSet = new Set<string>()
  const routerSet = new Set<string>()
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer()
    if (!init || !Node.isCallExpression(init)) continue
    const callee = init.getExpression()
    if (!Node.isIdentifier(callee)) continue
    const name = vd.getNameNode().getText()
    if (callee.getText() === 'useNavigate') navSet.add(name)
    if (callee.getText() === 'useHistory') histSet.add(name)
    // Next.js: const router = useRouter() — push/replace, from next/navigation OR next/router.
    if (callee.getText() === 'useRouter') routerSet.add(name)
  }
  // Next.js: redirect / permanentRedirect imported from next/navigation (gated on the import
  // so a user's local `redirect` is never mistaken for a navigation).
  const redirectNames = new Set<string>()
  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== 'next/navigation') continue
    for (const ni of imp.getNamedImports()) {
      if (ni.getNameNode().getText() === 'redirect' || ni.getNameNode().getText() === 'permanentRedirect') {
        redirectNames.add(ni.getAliasNode()?.getText() ?? ni.getNameNode().getText())
      }
    }
  }
  return { navSet, histSet, routerSet, redirectNames }
}

/**
 * Whether an expression is a react-router v5 withRouter-injected history accessor:
 * `this.props.history` or `props.history` (the prop the HOC injects). Used to treat
 * `this.props.history.push/replace(...)` as a navigation even though `history` is not
 * a useHistory()-bound local — the HOC pattern the older real-world apps still use.
 */
function isInjectedHistoryAccess(obj: Node): boolean {
  if (!Node.isPropertyAccessExpression(obj) || obj.getName() !== 'history') return false
  const base = obj.getExpression()
  if (Node.isPropertyAccessExpression(base) && base.getName() === 'props' && base.getExpression().getKind() === SyntaxKind.ThisKeyword) return true
  return Node.isIdentifier(base) && base.getText() === 'props'
}

/**
 * Normalize a react-router v5 <Link to="register"> / <Redirect to="login"> relative
 * literal target to an app-root absolute path ("/register"). react-router resolves
 * such non-slash paths against the rendering location, but in a static single-page
 * route table the declared routes are absolute, so prepending "/" recovers the match
 * the over-approximation would otherwise miss. A literal already starting with "/",
 * an empty string, an external URL, or a hash/query-only target is left untouched;
 * non-literal targets pass through unchanged.
 */
function absolutizeLinkTarget(ti: TargetInfo): TargetInfo {
  if (ti.kind !== 'literal') return ti
  const v = ti.value
  if (v.length === 0 || v.startsWith('/') || v.startsWith('#') || v.startsWith('?') || /^[a-z][a-z0-9+.-]*:/i.test(v)) return ti
  return { kind: 'literal', value: '/' + v }
}

/**
 * Collect navigation targets within a single inline-route element subtree (the
 * `element={<tag>…}` markup). Walks only LITERAL JSX (Link/NavLink/Navigate/Redirect
 * elements and useNavigate/useHistory calls) inside the given roots — it does NOT
 * resolve nor descend into nested capitalized component imports (a <Child/> is opaque
 * here; following it is the component-file scan's job, not the inline walk). Guards on
 * an enclosing ternary/&& are read by the shared getGuard, so a target inside
 * `cond ? <a/> : <Navigate/>` carries that condition. Targets dedupe by node identity
 * across overlapping roots.
 */
export function collectInlineRouteTargets(roots: Node[], sf: SourceFile): RawTarget[] {
  const out: RawTarget[] = []
  const seenNodes = new Set<Node>()
  const elements: Node[] = []
  for (const root of roots) {
    if (isJsxEl(root) && !seenNodes.has(root)) {
      seenNodes.add(root)
      elements.push(root)
    }
    for (const el of [...root.getDescendantsOfKind(SyntaxKind.JsxElement), ...root.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]) {
      if (seenNodes.has(el)) continue
      seenNodes.add(el)
      elements.push(el)
    }
  }
  const { navSet, histSet } = navIdentifiers(sf)
  for (const el of elements) {
    const tag = jsxTag(el)
    let event: string | null = null
    let effect = 'navigate'
    if (tag === 'Link' || tag === 'NavLink') {
      event = 'click:Link'
    } else if (tag === 'Navigate' || tag === 'Redirect') {
      event = 'redirect'
      effect = 'redirect'
    }
    if (event === null) continue
    out.push({ ti: absolutizeLinkTarget(classifyToAttr(findAttr(el, 'to') ?? findAttr(el, 'href'))), event, effect, node: el, guard: getGuard(el) ?? extraConditionGuard(el) })
  }
  const seenCalls = new Set<Node>()
  for (const root of roots) {
    for (const call of root.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (seenCalls.has(call)) continue
      seenCalls.add(call)
      const expr = call.getExpression()
      let effect: string | null = null
      if (Node.isIdentifier(expr) && navSet.has(expr.getText())) {
        effect = 'navigate'
      } else if (Node.isCallExpression(expr) && Node.isIdentifier(expr.getExpression()) && expr.getExpression().getText() === 'useNavigate') {
        // Inline `useNavigate()(target)` with no intermediate binding.
        effect = 'navigate'
      } else if (Node.isPropertyAccessExpression(expr)) {
        const obj = expr.getExpression()
        const member = expr.getName()
        if (Node.isIdentifier(obj) && histSet.has(obj.getText()) && (member === 'push' || member === 'replace')) effect = `history.${member}`
      }
      if (effect === null) continue
      out.push({ ti: classifyTarget(call.getArguments()[0], sf), event: 'navigate', effect, node: call, guard: getGuard(call) ?? extraConditionGuard(call) })
    }
  }
  return out
}

/**
 * True when an expression denotes the browser location object: `window.location`
 * or a bare `location` identifier. Used to catch router-bypassing navigation
 * (`window.location.href = …`, `location.assign/replace(…)`) — a real
 * transition that causes a full page load, emitted with effect
 * `navigate:full-reload` so it is never silently missed.
 */
function isWindowLocation(node: Node): boolean {
  if (Node.isPropertyAccessExpression(node)) return node.getName() === 'location' && Node.isIdentifier(node.getExpression()) && node.getExpression().getText() === 'window'
  return Node.isIdentifier(node) && node.getText() === 'location'
}

/** Sweep a source file for every navigation target: Link/NavLink/Navigate/Redirect JSX plus navigate/history/router/redirect calls, and window.location full-reload navigations. */
export function collectTargets(sf: SourceFile): RawTarget[] {
  const out: RawTarget[] = []
  for (const el of allJsxElements(sf)) {
    const tag = jsxTag(el)
    let event: string | null = null
    let effect = 'navigate'
    if (tag === 'Link' || tag === 'NavLink') {
      event = 'click:Link'
      effect = 'navigate'
    } else if (tag === 'Navigate' || tag === 'Redirect') {
      event = 'redirect'
      effect = 'redirect'
    }
    if (event === null) continue
    // react-router <Link to>; next/link <Link href> when there is no `to` (react Links
    // always carry `to`, so this href fallback never changes react output). The guard
    // combines if/ternary/&&/||/?? (getGuard) with loop/iteration/switch/catch/render-prop/
    // early-return non-dominance (extraConditionGuard) so a <Link> rendered inside e.g.
    // items.map(...) is a may-edge, never a phantom must (its render is not guaranteed).
    out.push({ ti: absolutizeLinkTarget(classifyToAttr(findAttr(el, 'to') ?? findAttr(el, 'href'))), event, effect, node: el, guard: getGuard(el) ?? extraConditionGuard(el) })
  }

  const { navSet, histSet, routerSet, redirectNames } = navIdentifiers(sf)
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression()
    let effect: string | null = null
    if (Node.isIdentifier(expr) && navSet.has(expr.getText())) {
      effect = 'navigate'
    } else if (Node.isIdentifier(expr) && redirectNames.has(expr.getText())) {
      effect = 'redirect'
    } else if (Node.isPropertyAccessExpression(expr)) {
      const obj = expr.getExpression()
      const member = expr.getName()
      if (Node.isIdentifier(obj) && histSet.has(obj.getText()) && (member === 'push' || member === 'replace')) {
        effect = `history.${member}`
      } else if (Node.isIdentifier(obj) && routerSet.has(obj.getText()) && (member === 'push' || member === 'replace')) {
        effect = `router.${member}`
      } else if ((member === 'push' || member === 'replace') && isInjectedHistoryAccess(obj)) {
        // react-router v5 HOC: withRouter injects `history` as a prop, navigated via
        // this.props.history.push/replace inside class-method event handlers.
        effect = `history.${member}`
      } else if ((member === 'assign' || member === 'replace') && isWindowLocation(obj)) {
        effect = 'navigate:full-reload'
      }
    }
    if (effect === null) continue
    out.push({ ti: classifyTarget(call.getArguments()[0], sf), event: 'navigate', effect, node: call, guard: getGuard(call) ?? extraConditionGuard(call) })
  }

  for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue
    const lhs = bin.getLeft()
    const isHrefAssign = Node.isPropertyAccessExpression(lhs) && lhs.getName() === 'href' && isWindowLocation(lhs.getExpression())
    const isLocationAssign = isWindowLocation(lhs)
    if (!isHrefAssign && !isLocationAssign) continue
    out.push({ ti: classifyTarget(bin.getRight(), sf), event: 'navigate', effect: 'navigate:full-reload', node: bin, guard: getGuard(bin) ?? extraConditionGuard(bin) })
  }
  return out
}
