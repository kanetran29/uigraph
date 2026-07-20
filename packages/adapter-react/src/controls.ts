// Control metadata + interaction extraction: classify an interactive JSX element into
// a control (type, name, ARIA role, stable selector, input constraints), inferring its
// label from text / i18n / icon / className signals, and collect the DOM events, guarded
// navigations, and effects of every handler attached to it.

import { Node, SyntaxKind } from 'ts-morph'
import type { JsxAttribute, SourceFile } from 'ts-morph'
import type { ControlInput, ControlSelector } from '@ui-graph/core'
import type { BranchContext, ControlInfo, TargetInfo } from './types'
import { allJsxElements, findAttr, getJsxText, jsxAttrs, jsxTag, stringAttr } from './jsx'
import { resolveFunctionNode } from './resolve'
import { analyzeHandler } from './analyze'

/** A resolved control label plus whether it came from static INFERENCE (an i18n key,
 *  an icon tag/BEM class guess, an <img alt>/<svg><title>) rather than an EXPLICIT
 *  signal the author put directly on the control (name/id attr, visible text, a
 *  literal aria-label/placeholder/title, or an aria-labelledby target's text). Threads
 *  through the naming chain so controlMetaFor can set ControlMeta.nameInferred without
 *  re-deriving provenance from the final string. */
interface Named {
  name: string
  inferred: boolean
}

/** Humanize an i18n key / camel / kebab / BEM token into a readable name ("building.offMarket.couldSell" -> "Could sell"). */
function humanize(raw: string): string | undefined {
  const last = raw.split('.').pop() ?? raw
  const s = last.replace(/[-_]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().toLowerCase()
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : undefined
}

/** Resolve an i18n key to its real translation via `i18nMap`, falling back to
 *  humanize(key) on a miss (no map, or the key isn't in it) — the shared resolution
 *  used by every i18n-key signal in the inference chain (an `i18nKey` attr, a `{t()}`
 *  hook call). Always an INFERRED name: even a resolved real value took a second hop
 *  through the locale file rather than reading directly off the control. */
function resolveKey(key: string, i18nMap?: Map<string, string>): string | undefined {
  const hit = i18nMap?.get(key)
  return hit != null && hit.length > 0 ? hit : humanize(key)
}

/**
 * The i18n key from a `{t('key')}` / `{t("key", …)}` hook call used as the element's
 * LABEL — searched only in the element's JSX CHILDREN (text position), never its
 * attributes, so a `t()` inside an onClick/error handler can't be mistaken for the label.
 * i18n-heavy production apps label most controls this way (the hook form), distinct from `<Trans i18nKey>`.
 */
function i18nCallKey(el: Node): string | undefined {
  if (!Node.isJsxElement(el)) return undefined
  for (const child of el.getJsxChildren()) {
    for (const call of child.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression().getText()
      if (callee !== 't' && !callee.endsWith('.t')) continue
      const arg = call.getArguments()[0]
      if (arg && Node.isStringLiteral(arg)) {
        const key = arg.getLiteralText()
        if (key.length > 0) return key
      }
    }
  }
  return undefined
}

/** The i18n key from an attribute whose value is a `{t('key')}` call (e.g. `placeholder={t('…')}`). */
function attrCallKey(el: Node, name: string): string | undefined {
  const init = findAttr(el, name)?.getInitializer()
  if (!init || !Node.isJsxExpression(init)) return undefined
  const expr = init.getExpression()
  if (!expr) return undefined
  for (const call of [expr, ...expr.getDescendants()]) {
    if (!Node.isCallExpression(call)) continue
    const callee = call.getExpression().getText()
    if (callee !== 't' && !callee.endsWith('.t')) continue
    const arg = call.getArguments()[0]
    if (arg && Node.isStringLiteral(arg)) {
      const key = arg.getLiteralText()
      if (key.length > 0) return key
    }
  }
  return undefined
}

/**
 * A human label from a control attribute (placeholder / aria-label / title) that is
 * either a string literal (EXPLICIT — the author wrote it directly) OR a `{t('key')}`
 * expression (INFERRED — resolved via `i18nMap`, falling back to a humanized key with
 * a trailing "Placeholder"/"Label" token dropped so `emailPlaceholder` reads "Email").
 */
function attrLabel(el: Node, name: string, i18nMap?: Map<string, string>): Named | undefined {
  const lit = stringAttr(el, name)
  if (lit != null && lit.length > 0) return { name: lit, inferred: false }
  const key = attrCallKey(el, name)
  if (key == null) return undefined
  const hit = i18nMap?.get(key)
  if (hit != null && hit.length > 0) return { name: hit, inferred: true }
  const cleaned = key.replace(/(placeholder|label)$/i, '')
  const h = humanize(cleaned.length > 0 ? cleaned : key)
  return h != null ? { name: h, inferred: true } : undefined
}

/** The visible text of the element an `aria-labelledby` id reference points to — an
 *  ARIA-explicit accessible name (same rank as a literal aria-label), just resolved
 *  one hop away rather than sitting on the control's own attribute. */
function ariaLabelledbyText(el: Node): Named | undefined {
  const id = stringAttr(el, 'aria-labelledby')
  if (id == null || id.length === 0) return undefined
  for (const cand of allJsxElements(el.getSourceFile())) {
    if (stringAttr(cand, 'id') !== id) continue
    const txt = getJsxText(cand)
    if (txt != null && txt.length > 0) return { name: txt, inferred: false }
  }
  return undefined
}

/** The text of an SVG `<title>` child — an icon's accessible name authored directly in
 *  markup, same signal strength as an `<img alt>`. */
function svgTitleText(svgEl: Node): string | undefined {
  for (const d of svgEl.getDescendantsOfKind(SyntaxKind.JsxElement)) {
    if (jsxTag(d).toLowerCase() !== 'title') continue
    const txt = getJsxText(d)
    if (txt != null && txt.length > 0) return txt
  }
  return undefined
}

/**
 * Derive a control's name from STATIC signals when it has no visible text/aria —
 * i18n-heavy apps label via `<Trans i18nKey="…">`, a `{t('key')}` hook call, an
 * `<img alt="…">`/`<svg><title>` icon, an icon component (`<SellIcon/>`), or a BEM
 * className modifier (`--could-sell`). The name is in the source, just not as literal
 * text; reading it deterministically beats leaving the control unnamed (and upgrades
 * its selector from structural to role+name). Every branch is an INFERENCE — even a
 * real i18n-resolved value took a hop through the locale file rather than sitting
 * directly on the control.
 */
function inferredName(el: Node, i18nMap?: Map<string, string>): Named | undefined {
  const kids = [el, ...el.getDescendantsOfKind(SyntaxKind.JsxElement), ...el.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)]
  for (const d of kids) {
    const key = stringAttr(d, 'i18nKey')
    if (key == null || key.length === 0) continue
    const v = resolveKey(key, i18nMap)
    if (v != null) return { name: v, inferred: true }
  }
  // The actual label text via the i18n hook — more accurate than the icon/className
  // fallbacks below, which on design-system buttons leak the variant ("Danger").
  const callKey = i18nCallKey(el)
  if (callKey != null) {
    const v = resolveKey(callKey, i18nMap)
    if (v != null) return { name: v, inferred: true }
  }
  for (const d of kids) {
    if (jsxTag(d).toLowerCase() !== 'img') continue
    const alt = stringAttr(d, 'alt')
    if (alt != null && alt.length > 0) return { name: alt, inferred: true }
  }
  for (const d of kids) {
    if (jsxTag(d).toLowerCase() !== 'svg') continue
    const title = svgTitleText(d)
    if (title != null) return { name: title, inferred: true }
  }
  for (const d of kids) {
    const t = jsxTag(d)
    const m = /^([A-Z][A-Za-z0-9]*?)(Icon|Svg)$/.exec(t)
    if (m && m[1]) {
      const h = humanize(m[1])
      if (h != null) return { name: h, inferred: true }
    }
  }
  const cls = stringAttr(el, 'className')
  if (cls != null) {
    const mod = cls.split(/\s+/).map((c) => (c.includes('--') ? c.slice(c.lastIndexOf('--') + 2) : null)).find((x): x is string => x != null && /[a-z]/i.test(x))
    if (mod) {
      const h = humanize(mod)
      if (h != null) return { name: h, inferred: true }
    }
  }
  return undefined
}

/** The control type of an <input> from its `type` attribute (checkbox/radio, button/submit, file, or text input). */
function inputControlType(el: Node): string {
  const t = (stringAttr(el, 'type') ?? 'text').toLowerCase()
  if (t === 'checkbox' || t === 'radio') return 'checkbox'
  if (t === 'submit' || t === 'button') return 'button'
  if (t === 'file') return 'file'
  return 'input'
}

/** Does an element carry any React `on*` event handler attribute? */
function hasEventHandler(el: Node): boolean {
  return jsxAttrs(el).some((a) => /^on[A-Z]/.test(a.getNameNode().getText()))
}

/** The ARIA role a control exposes, from an explicit role attr or its tag/type. */
function ariaRole(el: Node, tag: string, controlType: string): string | undefined {
  const explicit = stringAttr(el, 'role')
  if (explicit) return explicit
  if (tag.toLowerCase() === 'a') return 'link'
  switch (controlType) {
    case 'button':
      return 'button'
    case 'checkbox':
      return (stringAttr(el, 'type') ?? '').toLowerCase() === 'radio' ? 'radio' : 'checkbox'
    case 'richtext':
      return 'textbox'
    case 'select':
      return 'combobox'
    case 'form':
      return 'form'
    case 'input':
      return (stringAttr(el, 'type') ?? 'text').toLowerCase() === 'search' ? 'searchbox' : 'textbox'
    default:
      return undefined
  }
}

/**
 * The stable locator for a control, in precedence order: a data-testid, an ARIA
 * role + accessible name, a label (id/name attr), visible text, or a structural
 * tag fallback. `nth` (assigned later, per screen) disambiguates identical
 * selectors. This is the basis for the control's id and a real automation handle.
 */
function controlSelector(el: Node, tag: string, controlType: string, text: string | undefined): ControlSelector {
  const testid = stringAttr(el, 'data-testid') ?? stringAttr(el, 'data-test-id')
  if (testid != null) return { strategy: 'testid', value: testid }
  const role = ariaRole(el, tag, controlType)
  const accName = stringAttr(el, 'aria-label') ?? stringAttr(el, 'name') ?? stringAttr(el, 'placeholder') ?? text ?? stringAttr(el, 'id')
  if (role != null && accName != null) return { strategy: 'role-name', value: `${role}|${accName}` }
  const label = stringAttr(el, 'id') ?? stringAttr(el, 'name')
  if (label != null) return { strategy: 'label', value: label }
  if (text != null) return { strategy: 'text', value: text }
  return { strategy: 'structural', value: tag.toLowerCase() }
}

/**
 * Input constraints for a field control (input/textarea/select): its HTML type,
 * whether it is required, and any validation pattern — so codegen can produce a
 * type-appropriate fill value and probe validation. Undefined for non-field controls.
 */
function inputConstraints(el: Node, controlType: string): ControlInput | undefined {
  if (controlType !== 'input' && controlType !== 'checkbox' && controlType !== 'richtext' && controlType !== 'select') return undefined
  const type = stringAttr(el, 'type') ?? undefined
  const pattern = stringAttr(el, 'pattern') ?? undefined
  const required = findAttr(el, 'required') !== undefined
  if (type === undefined && pattern === undefined && !required) return undefined
  return { ...(type !== undefined ? { type } : {}), ...(required ? { required: true } : {}), ...(pattern !== undefined ? { pattern } : {}) }
}

/**
 * Classify an interactive JSX element as a control, or null if it is not one. A
 * control is a native form element (button/input/textarea/select/form),
 * contentEditable, or ANY lowercase DOM element carrying an `on*` handler (so a
 * `<div onMouseEnter>` or `<li onKeyDown>` counts too). Carries a stable selector.
 * `i18nMap` (built once per extraction from the app's locale file) resolves t()/i18nKey
 * labels to their real translated text; omit it to fall back to key-humanizing.
 */
export function controlMetaFor(el: Node, i18nMap?: Map<string, string>): ControlInfo | null {
  const tag = jsxTag(el)
  const lower = tag.toLowerCase()
  let controlType: string | null = null
  if (lower === 'button') controlType = 'button'
  else if (lower === 'input') controlType = inputControlType(el)
  else if (lower === 'textarea') controlType = 'richtext'
  else if (lower === 'select') controlType = 'select'
  else if (lower === 'form') controlType = 'form'
  else if (findAttr(el, 'contentEditable') || findAttr(el, 'contenteditable')) controlType = 'richtext'
  else if (/^[a-z]/.test(tag) && hasEventHandler(el)) controlType = 'element'
  else return null
  const textLabel = controlType === 'button' || controlType === 'element' ? getJsxText(el) : undefined
  const textNamed: Named | undefined = textLabel !== undefined ? { name: textLabel, inferred: false } : undefined
  // real-world inputs (and icon buttons) carry their label in placeholder / aria-label / title
  // (the tooltip) or an aria-labelledby reference, often as a {t('key')} expression — the
  // authoritative name when there is no visible text, so it slots ahead of the weaker
  // i18n-key/icon/className inference.
  const attrNamed = attrLabel(el, 'placeholder', i18nMap) ?? attrLabel(el, 'aria-label', i18nMap) ?? attrLabel(el, 'title', i18nMap) ?? ariaLabelledbyText(el)
  const resolved = textNamed ?? attrNamed ?? inferredName(el, i18nMap)
  const explicitName = stringAttr(el, 'name') ?? stringAttr(el, 'id')
  const name = explicitName ?? resolved?.name
  const nameInferred = explicitName === null && resolved?.inferred === true
  const selector = controlSelector(el, tag, controlType, resolved?.name)
  const input = inputConstraints(el, controlType)
  return { element: tag, controlType, selector, ...(input ? { input } : {}), ...(name ? { name } : {}), ...(nameInferred ? { nameInferred: true } : {}) }
}

/** React `onXxx` attribute name → DOM event name (e.g. onMouseEnter -> mouseenter). */
function eventNameOf(attrName: string): string {
  return attrName.slice(2).toLowerCase()
}

/** Resolve a single handler attribute's value to its function node. */
function handlerFnFromAttr(attr: JsxAttribute, sf: SourceFile): Node | undefined {
  const init = attr.getInitializer()
  if (!init || !Node.isJsxExpression(init)) return undefined
  const expr = init.getExpression()
  if (!expr) return undefined
  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) return expr
  if (Node.isIdentifier(expr)) return resolveFunctionNode(sf, expr.getText())
  return undefined
}

interface Interaction {
  event: string
  ti: TargetInfo
  guard: string | null
  node: Node
  ctx: BranchContext
  interprocedural?: boolean
}

/**
 * Collect every event handler on a control: the distinct DOM events it listens
 * to, the navigations each handler performs (tagged with the triggering event),
 * and the non-navigational effects.
 */
export function collectInteractions(
  el: Node,
  sf: SourceFile,
  navInfo: { navSet: Set<string>; histSet: Set<string> },
): { events: string[]; navs: Interaction[]; effects: string[] } {
  const events = new Set<string>()
  const navs: Interaction[] = []
  const effects = new Set<string>()
  for (const attr of jsxAttrs(el)) {
    const an = attr.getNameNode().getText()
    if (!/^on[A-Z]/.test(an)) continue
    const ev = eventNameOf(an)
    events.add(ev)
    const fn = handlerFnFromAttr(attr, sf)
    if (!fn) continue
    const a = analyzeHandler(fn, navInfo, sf)
    for (const nc of a.navCalls) navs.push({ event: ev, ti: nc.ti, guard: nc.guard, node: nc.node, ctx: nc.ctx, interprocedural: nc.interprocedural })
    for (const e of a.effects) effects.add(e)
  }
  return { events: [...events], navs, effects: [...effects] }
}
