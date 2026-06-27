import { describe, it, expect } from 'vitest'
import { buildSpecPlan, renderPlaywrightSpec, locatorFor, isInteractionTriggeredEvent, isDirectNavEdge } from './codegen'
import { planPath } from './algorithms'
import { edge, graph, node } from './fixtures'
import type { GraphNode } from './ir'

describe('locatorFor', () => {
  it('maps each selector strategy to a Playwright locator', () => {
    expect(locatorFor({ strategy: 'testid', value: 'save' })).toBe('page.getByTestId("save")')
    expect(locatorFor({ strategy: 'role-name', value: 'button|Save' })).toBe('page.getByRole("button", { name: "Save" })')
    expect(locatorFor({ strategy: 'label', value: 'email' })).toBe('page.getByLabel("email")')
    expect(locatorFor({ strategy: 'role-name', value: 'radio|plan', nth: 1 })).toBe('page.getByRole("radio", { name: "plan" }).nth(1)')
  })
})

describe('buildSpecPlan + renderPlaywrightSpec', () => {
  // Home -> [Review control] -> Dialog (open:modal), like Checkout's confirm dialog.
  const g = () => {
    const review: GraphNode = {
      id: 'cc_review', route: null, componentPath: null, label: 'Review', kind: 'control', parent: 'n_checkout',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Review' } },
    }
    const dialog: GraphNode = { id: 'm0', route: null, componentPath: null, label: 'ConfirmDialog', kind: 'modal' }
    return graph(
      [node('n_home', { route: '/' }), node('n_checkout', { route: '/checkout' }), review, dialog],
      [
        edge('e1', 'n_home', 'n_checkout', { event: 'click:Link' }),
        edge('e2', 'cc_review', 'm0', { event: 'click', effect: 'open:modal' }),
      ],
    )
  }

  it('emits goto+url for screen nav, click for a control, dialog assertion for open:modal', () => {
    const steps = planPath(g(), 'n_home', 'm0')
    expect(steps).not.toBeNull()
    const plan = buildSpecPlan(g(), steps!, { baseUrl: 'http://localhost:3000', title: 'home to dialog' })
    const spec = renderPlaywrightSpec(plan)
    expect(spec).toContain("import { test, expect } from '@playwright/test'")
    expect(spec).toContain('await page.goto("http://localhost:3000/")')
    // screen nav leg asserts the checkout URL
    expect(spec).toContain('await expect(page).toHaveURL("http://localhost:3000/checkout")')
    // control leg clicks the Review button via its selector
    expect(spec).toContain('await page.getByRole("button", { name: "Review" }).click()')
    // open:modal -> dialog visible
    expect(spec).toContain("await expect(page.getByRole('dialog')).toBeVisible()")
  })

  it('fills a field control with a type-appropriate value from input constraints', () => {
    const emailInput: GraphNode = {
      id: 'cc_email', route: null, componentPath: null, label: 'Email', kind: 'control', parent: 'n_form',
      control: { element: 'input', controlType: 'input', selector: { strategy: 'label', value: 'email' }, input: { type: 'email', required: true } },
    }
    const gg = graph([node('n_form', { route: '/form' }), node('n_done', { route: '/done' }), emailInput], [edge('e', 'cc_email', 'n_done', { event: 'change' })])
    const steps = planPath(gg, 'n_form', 'n_done')
    const spec = renderPlaywrightSpec(buildSpecPlan(gg, steps!, {}))
    expect(spec).toContain('await page.getByLabel("email").fill("test@example.com")')
  })

  it('surfaces path guards as preconditions (guard-aware)', () => {
    const gg = graph(
      [node('n_home', { route: '/' }), node('n_dash', { route: '/dash' })],
      [edge('e', 'n_home', 'n_dash', { event: 'navigate', modality: 'may', guard: 'isAuthenticated' })],
    )
    const steps = planPath(gg, 'n_home', 'n_dash')
    const plan = buildSpecPlan(gg, steps!, {})
    expect(plan.preconditions).toEqual(['isAuthenticated'])
    expect(renderPlaywrightSpec(plan)).toContain('// Preconditions to satisfy first: isAuthenticated')
  })
})

describe('goto-fallback soundness: edge trigger classification', () => {
  it('isInteractionTriggeredEvent: submit/click/change are interaction-triggered, navigate/click:Link are not', () => {
    expect(isInteractionTriggeredEvent('submit')).toBe(true)
    expect(isInteractionTriggeredEvent('click')).toBe(true)
    expect(isInteractionTriggeredEvent('click:submit')).toBe(true)
    expect(isInteractionTriggeredEvent('change')).toBe(true)
    expect(isInteractionTriggeredEvent('input')).toBe(true)
    expect(isInteractionTriggeredEvent('navigate')).toBe(false)
    expect(isInteractionTriggeredEvent('click:Link')).toBe(false)
  })

  it('isDirectNavEdge: only a direct-nav event with a null guard is directly confirmable', () => {
    expect(isDirectNavEdge(edge('e', 'a', 'b', { event: 'click:Link', guard: null }))).toBe(true)
    expect(isDirectNavEdge(edge('e', 'a', 'b', { event: 'navigate', guard: null }))).toBe(true)
    // a guard makes even a link edge interaction/conditional — not bare-goto confirmable
    expect(isDirectNavEdge(edge('e', 'a', 'b', { event: 'click:Link', guard: 'isAuth' }))).toBe(false)
    // a submit event is interaction-triggered even with a null guard
    expect(isDirectNavEdge(edge('e', 'a', 'b', { event: 'submit', guard: null }))).toBe(false)
  })
})

describe('goto-fallback soundness: buildSpecPlan', () => {
  // A screen→screen edge whose source node is NOT a control falls into the leg-action fallback.
  it('does NOT emit goto+url-assert for a guarded submit edge (parks it instead)', () => {
    const gg = graph(
      [node('n_form', { route: '/form' }), node('n_done', { route: '/done' })],
      [edge('e', 'n_form', 'n_done', { event: 'submit', guard: 'hasEmail', modality: 'may' })],
    )
    const steps = planPath(gg, 'n_form', 'n_done')
    const plan = buildSpecPlan(gg, steps!, {})
    const leg = plan.legs[0]!
    expect(leg.action.kind).toBe('parked')
    expect(leg.parkedReason).toBeDefined()
    // no url-assert: a bare URL match must not falsely witness a guarded submit
    expect(leg.assertions.find((a) => a.kind === 'url')).toBeUndefined()
    expect(renderPlaywrightSpec(plan)).not.toContain('await page.goto("/done")')
  })

  it('DOES emit goto+url-assert for a direct-nav link edge with null guard (safe)', () => {
    const gg = graph(
      [node('n_a', { route: '/a' }), node('n_b', { route: '/b' })],
      [edge('e', 'n_a', 'n_b', { event: 'click:Link', guard: null })],
    )
    const steps = planPath(gg, 'n_a', 'n_b')
    const plan = buildSpecPlan(gg, steps!, {})
    const leg = plan.legs[0]!
    expect(leg.action.kind).toBe('goto')
    expect(leg.action.url).toBe('/b')
    expect(leg.assertions.find((a) => a.kind === 'url')?.value).toBe('/b')
  })

  it('parks a guarded link edge (non-null guard) rather than confirming by goto', () => {
    const gg = graph(
      [node('n_a', { route: '/a' }), node('n_dash', { route: '/dash' })],
      [edge('e', 'n_a', 'n_dash', { event: 'click:Link', guard: 'isAuth', modality: 'may' })],
    )
    const steps = planPath(gg, 'n_a', 'n_dash')
    const plan = buildSpecPlan(gg, steps!, {})
    expect(plan.legs[0]!.action.kind).toBe('parked')
  })
})
