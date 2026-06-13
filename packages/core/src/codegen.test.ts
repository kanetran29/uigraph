import { describe, it, expect } from 'vitest'
import { buildSpecPlan, renderPlaywrightSpec, locatorFor } from './codegen'
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
