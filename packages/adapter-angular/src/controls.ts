// Control extraction for the Angular adapter (parity with React): parse a
// component's inline template HTML for interactive elements (button/input/select/
// form/…), classify each control's type/role/events/handlers, derive a stable
// selector (testid -> role+name -> label -> text -> structural) and any input
// constraints. Nav wiring from a control's handler lives in extract.ts.

import type { SourceFile } from 'ts-morph'
import type { ControlInput, ControlSelector } from '@uigraph/core'
import { inlineTemplate } from './templates'

/** A control parsed out of an Angular template. */
export interface NgControl {
  tag: string
  controlType: string
  attrs: Map<string, string>
  text: string | undefined
  events: string[]
  handlers: string[]
  selector: ControlSelector
  input: ControlInput | undefined
}

/** Parse an HTML open-tag attribute string into a name→value map (Angular bindings kept verbatim). */
function parseAttrs(attrStr: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /([@([]?[\w:-]+[)\]]?)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrStr)) !== null) {
    if (m[1] === undefined || m[1].length === 0) continue
    out.set(m[1], m[2] ?? m[3] ?? '')
  }
  return out
}

/** Classify a tag+attrs as a control type, or null when not interactive. */
function ngControlType(tag: string, attrs: Map<string, string>): string | null {
  const lower = tag.toLowerCase()
  if (lower === 'button') return 'button'
  if (lower === 'input') {
    const t = (attrs.get('type') ?? 'text').toLowerCase()
    if (t === 'checkbox' || t === 'radio') return 'checkbox'
    if (t === 'submit' || t === 'button') return 'button'
    if (t === 'file') return 'file'
    return 'input'
  }
  if (lower === 'textarea') return 'richtext'
  if (lower === 'select') return 'select'
  if (lower === 'form') return 'form'
  for (const k of attrs.keys()) if (/^\([a-zA-Z]+\)$/.test(k)) return 'element'
  return null
}

/** The DOM event names from Angular `(event)` bindings on the element. */
function ngEvents(attrs: Map<string, string>): string[] {
  const out: string[] = []
  for (const k of attrs.keys()) {
    const m = /^\(([a-zA-Z]+)\)$/.exec(k)
    if (m && m[1] !== undefined) out.push(m[1])
  }
  return out
}

/** The handler EXPRESSIONS bound to click/submit/keydown-ish events (for nav tracing). */
function ngHandlers(attrs: Map<string, string>): string[] {
  const out: string[] = []
  for (const [k, v] of attrs) if (/^\((click|submit|keydown|keyup|keypress|change)\)$/.test(k) && v.length > 0) out.push(v)
  return out
}

/** The ARIA role a control exposes, from an explicit role attr or its tag/type. */
function ngRole(tag: string, attrs: Map<string, string>, controlType: string): string | undefined {
  const explicit = attrs.get('role')
  if (explicit !== undefined) return explicit
  if (tag.toLowerCase() === 'a') return 'link'
  switch (controlType) {
    case 'button':
      return 'button'
    case 'checkbox':
      return (attrs.get('type') ?? '').toLowerCase() === 'radio' ? 'radio' : 'checkbox'
    case 'richtext':
      return 'textbox'
    case 'select':
      return 'combobox'
    case 'form':
      return 'form'
    case 'input':
      return (attrs.get('type') ?? 'text').toLowerCase() === 'search' ? 'searchbox' : 'textbox'
    default:
      return undefined
  }
}

/** Stable selector: data-testid -> role+name -> formControlName/id/name -> text -> structural. */
function ngSelector(tag: string, attrs: Map<string, string>, controlType: string, text: string | undefined): ControlSelector {
  const testid = attrs.get('data-testid') ?? attrs.get('data-test-id')
  if (testid !== undefined) return { strategy: 'testid', value: testid }
  const role = ngRole(tag, attrs, controlType)
  const accName = attrs.get('aria-label') ?? attrs.get('placeholder') ?? (text !== undefined && text.length > 0 ? text : undefined) ?? attrs.get('name')
  if (role !== undefined && accName !== undefined) return { strategy: 'role-name', value: `${role}|${accName}` }
  const label = attrs.get('formControlName') ?? attrs.get('id') ?? attrs.get('name')
  if (label !== undefined) return { strategy: 'label', value: label }
  if (text !== undefined && text.length > 0) return { strategy: 'text', value: text }
  return { strategy: 'structural', value: tag.toLowerCase() }
}

/** Input constraints (type/required/pattern) for a field control. */
function ngInput(attrs: Map<string, string>, controlType: string): ControlInput | undefined {
  if (!['input', 'checkbox', 'richtext', 'select'].includes(controlType)) return undefined
  const type = attrs.get('type')
  const pattern = attrs.get('pattern')
  const required = attrs.has('required')
  if (type === undefined && pattern === undefined && !required) return undefined
  return { ...(type !== undefined ? { type } : {}), ...(required ? { required: true } : {}), ...(pattern !== undefined ? { pattern } : {}) }
}

/** Parse interactive controls out of a component's inline template HTML. */
export function parseControls(sf: SourceFile): NgControl[] {
  const tpl = inlineTemplate(sf)
  if (!tpl) return []
  const html = tpl.text
  const out: NgControl[] = []
  const OPEN = /<([a-zA-Z][\w-]*)((?:[^<>]|"[^"]*")*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = OPEN.exec(html)) !== null) {
    const tag = m[1] ?? ''
    const attrs = parseAttrs(m[2] ?? '')
    const controlType = ngControlType(tag, attrs)
    if (controlType === null) continue
    let text: string | undefined
    if (m[3] !== '/' && tag.toLowerCase() !== 'input') {
      const close = html.indexOf(`</${tag}`, OPEN.lastIndex)
      if (close !== -1) {
        const inner = html.slice(OPEN.lastIndex, close).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        if (inner.length > 0) text = inner
      }
    }
    out.push({ tag, controlType, attrs, text, events: ngEvents(attrs), handlers: ngHandlers(attrs), selector: ngSelector(tag, attrs, controlType, text), input: ngInput(attrs, controlType) })
  }
  return out
}
