// E2E codegen: turn a planned path (PlanStep[]) into a runnable Playwright spec.
// Each leg becomes a locator action (from the control's stable selector — F1) plus
// assertions derived from the edge (target route -> toHaveURL, open:modal -> dialog
// visible, api:* -> a request note). Pure + browser-safe (string building only);
// the CLI/MCP supply the planned path. Input values + guards are coarse here and
// refined by the input/guard feature.

import type { ControlMeta, ControlSelector, UiGraph } from './ir'
import type { PlanStep } from './algorithms'

/** A single Playwright action for one leg. */
export interface SpecAction {
  kind: 'click' | 'fill' | 'goto' | 'available'
  locator?: string
  value?: string
  url?: string
}

/** A single assertion to run after a leg's action. */
export interface SpecAssertion {
  kind: 'url' | 'dialog' | 'request'
  value: string
}

/** One step of the spec: the transition, its action, and its assertions. */
export interface SpecLeg {
  from: string
  to: string
  event: string
  description: string
  action: SpecAction
  assertions: SpecAssertion[]
}

/** A framework-agnostic plan the renderer turns into spec source. */
export interface SpecPlan {
  title: string
  baseUrl: string
  startUrl: string
  preconditions: string[]
  legs: SpecLeg[]
}

const q = (s: string): string => JSON.stringify(s)

/** A Playwright locator expression for a control selector (F1). */
export function locatorFor(sel: ControlSelector): string {
  let base: string
  switch (sel.strategy) {
    case 'testid':
      base = `page.getByTestId(${q(sel.value)})`
      break
    case 'role-name': {
      const i = sel.value.indexOf('|')
      const role = i === -1 ? sel.value : sel.value.slice(0, i)
      const name = i === -1 ? '' : sel.value.slice(i + 1)
      base = name ? `page.getByRole(${q(role)}, { name: ${q(name)} })` : `page.getByRole(${q(role)})`
      break
    }
    case 'label':
      base = `page.getByLabel(${q(sel.value)})`
      break
    case 'text':
      base = `page.getByText(${q(sel.value)})`
      break
    default:
      base = `page.locator(${q(sel.value)})`
  }
  return sel.nth !== undefined && sel.nth > 0 ? `${base}.nth(${sel.nth})` : base
}

/** A type-appropriate fill value for a field control, from its input constraints. */
function fillValue(controlType: string, input: ControlMeta['input']): string {
  switch (input?.type) {
    case 'email':
      return 'test@example.com'
    case 'password':
      return 'Passw0rd!'
    case 'number':
    case 'range':
      return '42'
    case 'tel':
      return '0401234567'
    case 'url':
      return 'https://example.com'
    case 'date':
      return '2024-01-01'
    case 'search':
      return 'query'
    case 'color':
      return '#3366ff'
    default:
      return controlType === 'richtext' ? 'sample text' : 'test'
  }
}

/**
 * Build a SpecPlan from a planned path. A leg whose source is a control with a
 * selector becomes a click/fill on that locator; a containment leg
 * (effect:'contains') is a no-op marker (the control is simply available on the
 * screen); any other leg falls back to navigating to the target's literal route.
 * Assertions: a literal target route -> toHaveURL; open:modal -> dialog visible;
 * api:* -> a request note.
 */
export function buildSpecPlan(graph: UiGraph, steps: PlanStep[], opts: { baseUrl?: string; title?: string } = {}): SpecPlan {
  const baseUrl = opts.baseUrl ?? ''
  const start = steps[0]?.from
  const startUrl = start?.route && !start.route.includes(':') ? start.route : '/'

  const legs: SpecLeg[] = steps.map((s) => {
    const fromNode = s.from
    const toNode = s.to
    const e = s.edge
    const description = `${fromNode.label} → ${toNode.label} (${e.event})`

    let action: SpecAction
    if (fromNode.kind === 'control' && fromNode.control?.selector) {
      const locator = locatorFor(fromNode.control.selector)
      const ct = fromNode.control.controlType
      action = ct === 'input' || ct === 'richtext' ? { kind: 'fill', locator, value: fillValue(ct, fromNode.control.input) } : { kind: 'click', locator }
    } else if (e.effect === 'contains') {
      action = { kind: 'available' }
    } else {
      action = { kind: 'goto', url: toNode.route && !toNode.route.includes(':') ? toNode.route : (toNode.route ?? '/') }
    }

    const assertions: SpecAssertion[] = []
    if (toNode.route && !toNode.route.includes(':')) assertions.push({ kind: 'url', value: toNode.route })
    if (e.effect === 'open:modal') assertions.push({ kind: 'dialog', value: toNode.label })
    if (e.effect && e.effect.startsWith('api:')) assertions.push({ kind: 'request', value: e.effect.slice(4) })

    return { from: fromNode.id, to: toNode.id, event: e.event, description, action, assertions }
  })

  // Guard-aware: distinct symbolic guards along the path are the preconditions the
  // test must satisfy first (e.g. isAuthenticated -> log in). Surfaced, never
  // evaluated — the consumer decides how to satisfy them.
  const preconditions = [...new Set(steps.map((s) => s.edge.guard).filter((g): g is string => g !== null && g.length > 0))]
  return { title: opts.title ?? `${start?.label ?? 'start'} to ${steps[steps.length - 1]?.to.label ?? 'target'}`, baseUrl, startUrl, preconditions, legs }
}

/** Render a SpecPlan as a Playwright spec source file. */
export function renderPlaywrightSpec(plan: SpecPlan): string {
  const url = (path: string): string => q(plan.baseUrl + path)
  const lines: string[] = ["import { test, expect } from '@playwright/test'", '', `test(${q(plan.title)}, async ({ page }) => {`]
  if (plan.preconditions.length > 0) {
    lines.push(`  // Preconditions to satisfy first: ${plan.preconditions.join(', ')}`)
  }
  lines.push(`  await page.goto(${url(plan.startUrl)})`)
  for (const leg of plan.legs) {
    lines.push('', `  // ${leg.description}`)
    const a = leg.action
    if (a.kind === 'click' && a.locator) lines.push(`  await ${a.locator}.click()`)
    else if (a.kind === 'fill' && a.locator) lines.push(`  await ${a.locator}.fill(${q(a.value ?? '')})`)
    else if (a.kind === 'goto' && a.url !== undefined) lines.push(`  await page.goto(${url(a.url)})`)
    else if (a.kind === 'available') lines.push(`  // (control available on this screen — no navigation)`)
    for (const as of leg.assertions) {
      if (as.kind === 'url') lines.push(`  await expect(page).toHaveURL(${url(as.value)})`)
      else if (as.kind === 'dialog') lines.push(`  await expect(page.getByRole('dialog')).toBeVisible()`)
      else if (as.kind === 'request') lines.push(`  // expect a ${as.value} request`)
    }
  }
  lines.push('})', '')
  return lines.join('\n')
}
