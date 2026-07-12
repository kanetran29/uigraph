// Effect detection: classify a call as an api/state/modal-open/modal-close effect,
// recognize error setters and success/error branch context, find the state var that
// gates a modal or overlay sub-view, and flag runtime-only map/canvas widgets. These
// feed both the interprocedural handler walk and the modal/overlay passes.

import { Node } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import type { BranchContext } from './types'
import { allJsxElements, findAttr, jsxTag, within } from './jsx'

/** The static literal value of a fetch URL / method argument, or '?' when non-literal. */
function literalOf(node: Node | undefined): string {
  if (!node) return '?'
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue()
  if (Node.isTemplateExpression(node)) return node.getHead().getLiteralText() + '…'
  return '?'
}

/** The HTTP method from a fetch options object literal (`{ method: 'POST' }`), defaulting to GET. */
function methodFromFetchOpts(node: Node | undefined): string {
  if (!node || !Node.isObjectLiteralExpression(node)) return 'GET'
  const prop = node.getProperty('method')
  if (prop && Node.isPropertyAssignment(prop)) {
    const v = prop.getInitializer()
    if (v && (Node.isStringLiteral(v) || Node.isNoSubstitutionTemplateLiteral(v))) return v.getLiteralValue().toUpperCase()
  }
  return 'GET'
}

/** A network call effect like "api:POST /orders", or null. */
export function detectApiEffect(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null
  const expr = call.getExpression()
  if (Node.isIdentifier(expr) && expr.getText() === 'fetch') {
    return `api:${methodFromFetchOpts(call.getArguments()[1])} ${literalOf(call.getArguments()[0])}`
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const m = expr.getName().toLowerCase()
    if (['post', 'get', 'put', 'delete', 'patch'].includes(m) && /axios|api|http|client|request/i.test(expr.getExpression().getText())) {
      return `api:${m.toUpperCase()} ${literalOf(call.getArguments()[0])}`
    }
  }
  return null
}

/** A state-mutation effect like "state:setCart", or null. */
export function detectStateEffect(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null
  const expr = call.getExpression()
  if (Node.isIdentifier(expr)) {
    const n = expr.getText()
    if (/^set[A-Z]/.test(n)) return `state:${n}`
    if (n === 'dispatch') return 'state:dispatch'
  }
  return null
}

/**
 * The modal STATE VARIABLE a setter opens — setShowCouldSellModal(true) ->
 * 'showCouldSellModal' — or null. The variable name links the opening control to
 * the specific modal it shows (gated by `{showX && <Modal/>}` / `isOpen={showX}`).
 */
export function detectModalOpen(call: Node): string | null {
  if (!Node.isCallExpression(call)) return null
  const expr = call.getExpression()
  if (!Node.isIdentifier(expr)) return null
  const name = expr.getText()
  // setShow…/setOpen…/setVisible… OR any setter naming a Modal/Dialog/Drawer/etc.
  // (e.g. setLoginModalVisible) — covers both `setShowX(true)` and `setXModalVisible(true)`.
  if (!/^set(Show|Open|Visible)/i.test(name) && !/(Modal|Dialog|Drawer|Popover|Sheet)/i.test(name)) return null
  const arg = call.getArguments()[0]
  if (!arg || arg.getText() !== 'true') return null
  const v = name.slice(3)
  return v.length > 0 ? v.charAt(0).toLowerCase() + v.slice(1) : 'modal'
}

/**
 * Whether a call closes a modal: a setter (setShow…/setOpen…/setVisible… or any setter
 * naming a Modal/Dialog/Drawer/Popover/Sheet) invoked with the BooleanLiteral `false`.
 * The false check is SEMANTIC (Node.isFalseLiteral on the argument), not textual — a
 * variable that happens to be named `false` or a non-literal falsy expression does not
 * match. Returns true only for a literal-false dismiss.
 */
export function detectModalClose(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false
  const expr = call.getExpression()
  if (!Node.isIdentifier(expr)) return false
  const name = expr.getText()
  if (!/^set(Show|Open|Visible)/i.test(name) && !/(Modal|Dialog|Drawer|Popover|Sheet)/i.test(name)) return false
  const arg = call.getArguments()[0]
  return arg !== undefined && Node.isFalseLiteral(arg)
}

/**
 * The *Visible state var gating an overlay sub-view's render — the first identifier
 * ending in `Visible` among the guards of an enclosing `{ … && <Component/>}` conjunction
 * (e.g. `profileViewVisible && isLoggedIn && <ProfileView/>`). Unlike modalGateVar (a
 * single `{ident && …}`), this walks a multi-`&&` guard. Restricting to a `*Visible`
 * suffix targets the overlay-view convention without firing on ordinary conditional renders.
 */
export function gatedOverlayVar(el: Node): string | null {
  let cur: Node | undefined = el.getParent()
  const guards: string[] = []
  for (let i = 0; i < 6 && cur; i++) {
    if (Node.isParenthesizedExpression(cur)) {
      cur = cur.getParent()
      continue
    }
    if (Node.isBinaryExpression(cur) && cur.getOperatorToken().getText() === '&&') {
      const left = cur.getLeft()
      for (const id of [left, ...left.getDescendants()]) if (Node.isIdentifier(id)) guards.push(id.getText())
      cur = cur.getParent()
      continue
    }
    // The element must reach the `&&` guard through paren wrappers only; crossing a JSX
    // element/fragment means it is merely NESTED inside a gated wrapper, not itself the
    // gated render — promoting it would re-home an unrelated control.
    if (Node.isJsxElement(cur) || Node.isJsxFragment(cur) || Node.isJsxExpression(cur)) break
    cur = cur.getParent()
  }
  return guards.find((g) => /visible$/i.test(g)) ?? null
}

/** The state variable gating a modal element's render: an isOpen/open/visible/show prop bound to {ident}, or an enclosing `{ident && <Modal/>}`. */
export function modalGateVar(el: Node): string | null {
  for (const name of ['isOpen', 'open', 'visible', 'show', 'isVisible', 'active', 'isActive', 'opened']) {
    const init = findAttr(el, name)?.getInitializer()
    if (init && Node.isJsxExpression(init)) {
      const inner = init.getExpression()
      if (inner && Node.isIdentifier(inner)) return inner.getText()
    }
  }
  let cur: Node | undefined = el.getParent()
  for (let i = 0; i < 4 && cur; i++) {
    if (Node.isBinaryExpression(cur) && cur.getOperatorToken().getText() === '&&') {
      const left = cur.getLeft()
      if (Node.isIdentifier(left)) return left.getText()
    }
    cur = cur.getParent()
  }
  return null
}

/**
 * Whether a screen embeds a third-party map/canvas widget whose gestures
 * (zoom/pan/drag) are runtime-only — detected by import specifier or component tag.
 * Such interactions are NOT statically modelable; we record a soundiness note
 * rather than invent transitions.
 */
export function detectDynamicWidget(sf: SourceFile): boolean {
  for (const imp of sf.getImportDeclarations()) {
    if (/mapbox|leaflet|google-?maps|react-map-gl|maplibre|@react-google-maps/i.test(imp.getModuleSpecifierValue())) return true
  }
  for (const el of allJsxElements(sf)) {
    if (/^(Map|MapView|MapContainer|MapGL|GoogleMap|MapboxMap|LeafletMap)$/.test(jsxTag(el))) return true
  }
  return false
}

/** Whether a call writes an error-ish state (setError/setErr or a state set in an error branch). */
export function isErrorSetter(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false
  const expr = call.getExpression()
  return Node.isIdentifier(expr) && /^set(Error|Err|Failure|Failed)/i.test(expr.getText())
}

/**
 * Classify a node as being on the success or error branch of an async flow:
 * inside a catch clause / `.catch()` / error `if`-branch is "error"; inside a try
 * block / `.then()` success arg / ok `if`-branch is "success".
 */
export function branchContextOf(node: Node): BranchContext {
  let cur: Node = node
  for (;;) {
    const parent = cur.getParent()
    if (!parent) return null
    if (Node.isCatchClause(parent)) return 'error'
    if (Node.isTryStatement(parent)) {
      const tryBlock = parent.getTryBlock()
      if (tryBlock && within(tryBlock, node)) return 'success'
    }
    if ((Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) && Node.isCallExpression(parent)) {
      const callee = parent.getExpression()
      if (Node.isPropertyAccessExpression(callee)) {
        const m = callee.getName()
        if (m === 'catch') return 'error'
        if (m === 'then') {
          const args = parent.getArguments()
          if (args[1] === cur) return 'error'
          if (args[0] === cur) return 'success'
        }
      }
    }
    if (Node.isIfStatement(parent)) {
      const cond = parent.getExpression().getText()
      const errCond = /!|error|fail|catch/i.test(cond)
      const then = parent.getThenStatement()
      const els = parent.getElseStatement()
      if (then && within(then, node)) return errCond ? 'error' : 'success'
      if (els && within(els, node)) return errCond ? 'success' : 'error'
    }
    cur = parent
  }
}
