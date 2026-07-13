// E2E codegen: turn a planned path (PlanStep[]) into a runnable Playwright spec.
// Each leg becomes a locator action (from the control's stable selector — F1) plus
// assertions derived from the edge (target route -> toHaveURL, open:modal -> dialog
// visible, api:* -> a request note). Pure + browser-safe (string building only);
// the CLI/MCP supply the planned path. Input values + guards are coarse here and
// refined by the input/guard feature.

import type { ControlMeta, ControlSelector, GraphEdge, UiGraph } from './ir'
import type { PlanStep } from './algorithms'

/**
 * A single Playwright action for one leg. `parked` marks a transition that cannot
 * be soundly confirmed by codegen alone (an interaction-triggered or guarded
 * screen→screen nav with no drivable control): the runner must NOT witness it via a
 * bare goto+URL-assert, so it stays asserted/llm-verified until truly driven.
 */
export interface SpecAction {
  kind: 'click' | 'fill' | 'press' | 'goto' | 'available' | 'parked'
  locator?: string
  value?: string
  url?: string
  key?: string
}

/** A single assertion to run after a leg's action. */
export interface SpecAssertion {
  kind: 'url' | 'dialog' | 'request'
  value: string
}

/**
 * One step of the spec: the transition, its action, and its assertions.
 * `parkedReason` is set only when `action.kind === 'parked'` and explains why the
 * leg is not auto-confirmable, so the runner and a human can audit the gap.
 */
export interface SpecLeg {
  from: string
  to: string
  event: string
  description: string
  action: SpecAction
  assertions: SpecAssertion[]
  parkedReason?: string
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
 * True when an edge's event is interaction-triggered (a user must drive a control:
 * submit/click/change/input/keydown/…) rather than a direct navigation. The event
 * vocabulary is informal today, so this matches by prefix; the one direct-nav use
 * of `click` is the special `click:Link` form, which is excluded. Why: an
 * interaction-triggered transition can never be soundly witnessed by navigating
 * straight to its target route — the triggering interaction must actually fire.
 */
export function isInteractionTriggeredEvent(event: string): boolean {
  if (event === 'navigate' || event === 'click:Link') return false
  return /^(submit|click|change|input|key|press|keydown|keyup|focus|blur|toggle|select)/i.test(event)
}

/**
 * True when an edge is safely confirmable by a bare goto + URL-assert: its event is
 * a direct navigation (navigate / click:Link) AND it carries no guard. A guard
 * means the transition is conditional, so reaching the URL by goto does not prove
 * the guarded edge fired; such edges are NOT direct-nav and must be driven (or left
 * unconfirmed) instead.
 */
export function isDirectNavEdge(edge: GraphEdge): boolean {
  return !isInteractionTriggeredEvent(edge.event) && (edge.guard === null || edge.guard.length === 0)
}

/**
 * Build a SpecPlan from a planned path. A leg whose source is a control with a
 * selector becomes a click/fill on that locator; a containment leg
 * (effect:'contains') is a no-op marker (the control is simply available on the
 * screen); a direct-nav screen→screen leg (navigate/click:Link, null guard) falls
 * back to navigating to the target's literal route; any other screen→screen leg
 * (interaction-triggered or guarded, with no drivable control) is PARKED — it must
 * not be witnessed by a bare goto+URL-assert (the Tier-3 soundness fix).
 * Assertions: a literal target route -> toHaveURL (ONLY for direct-nav legs, so a
 * guarded/interaction edge is never falsely confirmed by URL match); open:modal ->
 * dialog visible; api:* -> a request note.
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

    const directNav = isDirectNavEdge(e)

    let action: SpecAction
    let parkedReason: string | undefined
    if (fromNode.kind === 'control' && fromNode.control?.selector) {
      const locator = locatorFor(fromNode.control.selector)
      const ct = fromNode.control.controlType
      if (e.event.startsWith('key')) {
        action = { kind: 'press', locator, key: 'Enter' }
      } else {
        action = ct === 'input' || ct === 'richtext' ? { kind: 'fill', locator, value: fillValue(ct, fromNode.control.input) } : { kind: 'click', locator }
      }
    } else if (e.effect === 'contains') {
      action = { kind: 'available' }
    } else if (directNav && toNode.route !== null && !toNode.route.includes(':')) {
      action = { kind: 'goto', url: toNode.route }
    } else if (directNav) {
      action = { kind: 'parked' }
      parkedReason = `target route ${toNode.route ?? '(none)'} is parameterized/unknown — a bare goto needs a concrete param value; drive a real in-app link instead`
    } else {
      action = { kind: 'parked' }
      parkedReason = `${e.event}${e.guard ? ` [guard:${e.guard}]` : ''} is interaction-triggered/guarded with no drivable control — cannot be witnessed by goto+URL-assert`
    }

    const assertions: SpecAssertion[] = []
    // Safety: a literal URL assert is sound ONLY for control-driven or direct-nav legs;
    // a bare URL match would falsely witness a guarded/interaction-triggered screen→screen edge.
    if (toNode.route && !toNode.route.includes(':') && action.kind !== 'parked') assertions.push({ kind: 'url', value: toNode.route })
    if (e.effect === 'open:modal') assertions.push({ kind: 'dialog', value: toNode.label })
    if (e.effect && e.effect.startsWith('api:')) assertions.push({ kind: 'request', value: e.effect.slice(4) })

    return { from: fromNode.id, to: toNode.id, event: e.event, description, action, assertions, ...(parkedReason ? { parkedReason } : {}) }
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
    else if (a.kind === 'press' && a.locator) lines.push(`  await ${a.locator}.press(${q(a.key ?? 'Enter')})`)
    else if (a.kind === 'fill' && a.locator) lines.push(`  await ${a.locator}.fill(${q(a.value ?? '')})`)
    else if (a.kind === 'goto' && a.url !== undefined) lines.push(`  await page.goto(${url(a.url)})`)
    else if (a.kind === 'available') lines.push(`  // (control available on this screen — no navigation)`)
    else if (a.kind === 'parked') lines.push(`  /* parked: ${leg.parkedReason ?? 'not auto-confirmable — drive the triggering control or verify manually'} */`)
    for (const as of leg.assertions) {
      if (as.kind === 'url') lines.push(`  await expect(page).toHaveURL(${url(as.value)})`)
      else if (as.kind === 'dialog') lines.push(`  await expect(page.getByRole('dialog')).toBeVisible()`)
      else if (as.kind === 'request') lines.push(`  // expect a ${as.value} request`)
    }
  }
  lines.push('})', '')
  return lines.join('\n')
}
