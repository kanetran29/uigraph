// Parsing a component template's interactive elements into control descriptors:
// control type, ARIA role, a stable selector, input constraints and event handlers
// (parity with the React/Angular adapters).

import type { ControlInput, ControlSelector } from '@uigraph/core'
import { eventHandlers, parseTemplateElements, type TemplateEl } from './sfc'
import type { VueComponent } from './extract'

/** An interactive control parsed from a template: tag, type, attrs, text, events/handlers, selector and input constraints. */
export interface VueControl {
  tag: string
  controlType: string
  attrs: Map<string, string>
  text: string | undefined
  events: string[]
  handlers: { event: string; expr: string }[]
  selector: ControlSelector
  input: ControlInput | undefined
}

/** Classify a tag+attrs as a control type, or null when not interactive. */
function vueControlType(el: TemplateEl): string | null {
  const lower = el.tag.toLowerCase()
  if (lower === 'button') return 'button'
  if (lower === 'input') {
    const t = (el.attrs.get('type') ?? 'text').toLowerCase()
    if (t === 'checkbox' || t === 'radio') return 'checkbox'
    if (t === 'submit' || t === 'button') return 'button'
    if (t === 'file') return 'file'
    return 'input'
  }
  if (lower === 'textarea') return 'richtext'
  if (lower === 'select') return 'select'
  if (lower === 'form') return 'form'
  if (el.attrs.has('contenteditable')) return 'richtext'
  if (eventHandlers(el).length > 0) return 'element'
  return null
}

/** The ARIA role a control exposes, from an explicit role attr or its tag/type. */
function vueRole(el: TemplateEl, controlType: string): string | undefined {
  const explicit = el.attrs.get('role')
  if (explicit !== undefined) return explicit
  if (el.tag.toLowerCase() === 'a') return 'link'
  switch (controlType) {
    case 'button':
      return 'button'
    case 'checkbox':
      return (el.attrs.get('type') ?? '').toLowerCase() === 'radio' ? 'radio' : 'checkbox'
    case 'richtext':
      return 'textbox'
    case 'select':
      return 'combobox'
    case 'form':
      return 'form'
    case 'input':
      return (el.attrs.get('type') ?? 'text').toLowerCase() === 'search' ? 'searchbox' : 'textbox'
    default:
      return undefined
  }
}

/** Stable selector: data-testid -> role+name -> id/name -> text -> structural. */
function vueSelector(el: TemplateEl, controlType: string): ControlSelector {
  const testid = el.attrs.get('data-testid') ?? el.attrs.get('data-test-id')
  if (testid !== undefined) return { strategy: 'testid', value: testid }
  const role = vueRole(el, controlType)
  const accName = el.attrs.get('aria-label') ?? el.attrs.get('placeholder') ?? el.text ?? el.attrs.get('name')
  if (role !== undefined && accName !== undefined) return { strategy: 'role-name', value: `${role}|${accName}` }
  const label = el.attrs.get('id') ?? el.attrs.get('name')
  if (label !== undefined) return { strategy: 'label', value: label }
  if (el.text !== undefined) return { strategy: 'text', value: el.text }
  return { strategy: 'structural', value: el.tag.toLowerCase() }
}

/** Input constraints (type/required/pattern) for a field control. */
function vueInput(el: TemplateEl, controlType: string): ControlInput | undefined {
  if (!['input', 'checkbox', 'richtext', 'select'].includes(controlType)) return undefined
  const type = el.attrs.get('type')
  const pattern = el.attrs.get('pattern')
  const required = el.attrs.has('required')
  if (type === undefined && pattern === undefined && !required) return undefined
  return { ...(type !== undefined ? { type } : {}), ...(required ? { required: true } : {}), ...(pattern !== undefined ? { pattern } : {}) }
}

/** Parse interactive controls out of a component's template HTML. */
export function parseControls(component: VueComponent): VueControl[] {
  const out: VueControl[] = []
  for (const el of parseTemplateElements(component.sfc.template, component.sfc.templateOffset)) {
    const controlType = vueControlType(el)
    if (controlType === null) continue
    const handlers = eventHandlers(el)
    out.push({
      tag: el.tag,
      controlType,
      attrs: el.attrs,
      text: el.text,
      events: handlers.map((h) => h.event),
      handlers,
      selector: vueSelector(el, controlType),
      input: vueInput(el, controlType),
    })
  }
  return out
}
