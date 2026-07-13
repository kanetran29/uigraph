// Low-level JSX/AST primitives shared across the extractor: element predicates,
// tag/attribute readers, descendant collection, containment checks, and the
// route/component/inline-element helpers built on them. No dependency on any
// other extractor module — this is the leaf layer.

import { Node, SyntaxKind } from 'ts-morph'
import type { JsxAttribute, SourceFile } from 'ts-morph'

/** Whether a node is a JSX element (paired or self-closing). */
export function isJsxEl(n: Node): boolean {
  return Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n)
}

/** The tag name text of a JSX element, or '' when not a JSX element. */
export function jsxTag(el: Node): string {
  if (Node.isJsxElement(el)) return el.getOpeningElement().getTagNameNode().getText()
  if (Node.isJsxSelfClosingElement(el)) return el.getTagNameNode().getText()
  return ''
}

/** The plain JsxAttributes (not spreads) of a JSX element. */
export function jsxAttrs(el: Node): JsxAttribute[] {
  const raw = Node.isJsxElement(el) ? el.getOpeningElement().getAttributes() : Node.isJsxSelfClosingElement(el) ? el.getAttributes() : []
  return raw.filter((a): a is JsxAttribute => Node.isJsxAttribute(a))
}

/** The named attribute of a JSX element, or undefined. */
export function findAttr(el: Node, name: string): JsxAttribute | undefined {
  return jsxAttrs(el).find((a) => a.getNameNode().getText() === name)
}

/** Every JSX element (paired + self-closing) in a source file. */
export function allJsxElements(sf: SourceFile): Node[] {
  return [...sf.getDescendantsOfKind(SyntaxKind.JsxElement), ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]
}

/** Whether `node` is positionally contained within `container`. */
export function within(container: Node, node: Node): boolean {
  return node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd()
}

/** The top-level JSX element root(s) of an element expression: the element itself, or the JSX branches of an enclosing ternary/&&. */
export function jsxRootsOf(expr: Node): Node[] {
  if (isJsxEl(expr)) return [expr]
  if (Node.isParenthesizedExpression(expr)) {
    const inner = expr.getExpression()
    return inner ? jsxRootsOf(inner) : []
  }
  if (Node.isConditionalExpression(expr)) return [...jsxRootsOf(expr.getWhenTrue()), ...jsxRootsOf(expr.getWhenFalse())]
  if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getText() === '&&') return jsxRootsOf(expr.getRight())
  return []
}

/** First capitalized (component) JSX tag inside a node, e.g. the body of a `render` prop. */
function firstComponentTag(node: Node): string | null {
  const candidates = [
    ...node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ...node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
  ].sort((a, b) => a.getStart() - b.getStart())
  for (const c of candidates) {
    const tag = c.getTagNameNode().getText()
    if (/^[A-Z]/.test(tag)) return tag
  }
  return null
}

/** The component name a <Route> renders, via element={<X/>}, component={X}, or render={() => <X/>}, or null. */
export function getComponentName(el: Node): string | null {
  const element = findAttr(el, 'element')
  if (element) {
    const init = element.getInitializer()
    if (init && Node.isJsxExpression(init)) {
      const inner = init.getExpression()
      if (inner && isJsxEl(inner)) return jsxTag(inner)
    }
  }
  const component = findAttr(el, 'component')
  if (component) {
    const init = component.getInitializer()
    if (init && Node.isJsxExpression(init)) {
      const inner = init.getExpression()
      if (inner && Node.isIdentifier(inner)) return inner.getText()
    }
  }
  const render = findAttr(el, 'render')
  if (render) {
    const init = render.getInitializer()
    if (init && Node.isJsxExpression(init)) {
      const expr = init.getExpression()
      if (expr) {
        const tag = firstComponentTag(expr)
        if (tag) return tag
      }
    }
  }
  return null
}

/**
 * The inline HTML tag a route renders directly via `element={<tag>…}` (a lowercase
 * tag, not a component reference) — e.g. element={<Navigate to="/x"/>} is a component,
 * but element={<div>…} or element={<main>…} is inline markup with no component file to
 * scan. Returns the tag for the inline-markup case, else null. This is a navigation
 * intent we cannot soundly follow (the rendered subtree is not a scannable screen).
 */
export function inlineElementTag(el: Node): { tag: string; exprNode: Node; roots: Node[] } | null {
  const element = findAttr(el, 'element')
  if (!element) return null
  const init = element.getInitializer()
  if (!init || !Node.isJsxExpression(init)) return null
  const inner = init.getExpression()
  if (!inner) return null
  return inlineExprInfo(inner)
}

/**
 * Classify an element-valued expression as inline markup: the lowercase JSX root(s)
 * it renders. A bare `<div>…` has one; a `cond ? <section/> : <Navigate/>` or
 * `cond && <section/>` has its branch root(s). A single capitalized element (`<X/>`)
 * is a component reference, not inline markup — returns null. Shared by the JSX
 * `element={…}` attr reader and the data-router `element:` property reader.
 */
export function inlineExprInfo(inner: Node): { tag: string; exprNode: Node; roots: Node[] } | null {
  const roots = jsxRootsOf(inner)
  const lowercaseRoot = roots.find((r) => /^[a-z]/.test(jsxTag(r)))
  if (!lowercaseRoot) return null
  return { tag: jsxTag(lowercaseRoot), exprNode: inner, roots }
}

/** The string value of a JSX attribute (literal or a literal inside a JSX expression), or null. */
export function stringAttr(el: Node, name: string): string | null {
  const attr = findAttr(el, name)
  if (!attr) return null
  const init = attr.getInitializer()
  if (!init) return null
  if (Node.isStringLiteral(init)) return init.getLiteralValue()
  if (Node.isJsxExpression(init)) {
    const inner = init.getExpression()
    if (inner && (Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner))) return inner.getLiteralValue()
  }
  return null
}

/** Visible text inside a JSX element (e.g. a button's label), or undefined. */
export function getJsxText(el: Node): string | undefined {
  if (!Node.isJsxElement(el)) return undefined
  const txt = el
    .getDescendantsOfKind(SyntaxKind.JsxText)
    .map((t) => t.getText())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return txt.length > 0 ? txt : undefined
}
