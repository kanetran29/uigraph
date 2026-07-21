import { describe, it, expect } from 'vitest'
import { buildSpecPlan, renderPlaywrightSpec, locatorFor, isInteractionTriggeredEvent, isDirectNavEdge } from './codegen'
import { planForTarget, planPath } from './algorithms'
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

// A modal is a modal by its node KIND, not by its edge's effect string: a plain
// click edge into a modal node used to assert nothing (only effect 'open:modal'
// triggered the dialog assertion), so the driver reported it undrivable via the
// asserted-nothing guard. The node-kind fallback must assert the dialog.
describe('buildSpecPlan: dialog assertion from the target node kind', () => {
  const opener: GraphNode = {
    id: 'cc_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 'n_a',
    control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
  }
  const modal: GraphNode = { id: 'm_1', route: null, componentPath: null, label: 'Dialog', kind: 'modal' }

  it('asserts the dialog for a click edge into a modal node whose effect is NOT open:modal', () => {
    const gg = graph([node('n_a', { route: '/a' }), opener, modal], [edge('e', 'cc_open', 'm_1', { event: 'click', effect: null })])
    const plan = buildSpecPlan(gg, planPath(gg, 'cc_open', 'm_1')!, {})
    expect(plan.legs[0]!.assertions).toEqual([{ kind: 'dialog', value: 'Dialog' }])
  })

  it('does not double-assert when the effect IS open:modal', () => {
    const gg = graph([node('n_a', { route: '/a' }), opener, modal], [edge('e', 'cc_open', 'm_1', { event: 'click', effect: 'open:modal' })])
    const plan = buildSpecPlan(gg, planPath(gg, 'cc_open', 'm_1')!, {})
    expect(plan.legs[0]!.assertions.filter((a) => a.kind === 'dialog')).toEqual([{ kind: 'dialog', value: 'Dialog' }])
  })
})

// Regression: an effect self-loop edge's `effect` field may join several
// api:/state:/error: kinds with ', ' (extract.ts's rr.effect-self-loop). The
// request assertion built from it must parse each kind on its own — a naive
// slice(4) on the whole joined string bleeds the next token into the path.
describe('buildSpecPlan: request assertion from an effect self-loop edge', () => {
  const selfLoopControl: GraphNode = {
    id: 'cc_save', route: null, componentPath: null, label: 'Save', kind: 'control', parent: 'n_a',
    control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Save' } },
  }

  it('emits a clean request assertion for a single api effect', () => {
    const gg = graph([node('n_a', { route: '/a' }), selfLoopControl], [edge('e', 'cc_save', 'n_a', { event: 'click', effect: 'api:POST /api/orders' })])
    const plan = buildSpecPlan(gg, planPath(gg, 'cc_save', 'n_a')!, {})
    expect(plan.legs[0]!.assertions.filter((a) => a.kind === 'request')).toEqual([{ kind: 'request', value: 'POST /api/orders' }])
  })

  it('emits ONLY the api token\'s request assertion when joined with a state effect — no comma bleed', () => {
    const gg = graph([node('n_a', { route: '/a' }), selfLoopControl], [edge('e', 'cc_save', 'n_a', { event: 'click', effect: 'api:POST /api/orders, state:setCart' })])
    const plan = buildSpecPlan(gg, planPath(gg, 'cc_save', 'n_a')!, {})
    expect(plan.legs[0]!.assertions.filter((a) => a.kind === 'request')).toEqual([{ kind: 'request', value: 'POST /api/orders' }])
  })

  it('emits ONLY the api token even when it is NOT the first joined kind', () => {
    const gg = graph([node('n_a', { route: '/a' }), selfLoopControl], [edge('e', 'cc_save', 'n_a', { event: 'click', effect: 'state:setLoading, api:POST /api/orders' })])
    const plan = buildSpecPlan(gg, planPath(gg, 'cc_save', 'n_a')!, {})
    expect(plan.legs[0]!.assertions.filter((a) => a.kind === 'request')).toEqual([{ kind: 'request', value: 'POST /api/orders' }])
  })

  it('emits NO request assertion when the URL could not be statically resolved (literalOf\'s "?")', () => {
    const gg = graph([node('n_a', { route: '/a' }), selfLoopControl], [edge('e', 'cc_save', 'n_a', { event: 'click', effect: 'api:POST ?' })])
    const plan = buildSpecPlan(gg, planPath(gg, 'cc_save', 'n_a')!, {})
    expect(plan.legs[0]!.assertions.filter((a) => a.kind === 'request')).toEqual([])
  })
})

// A modal-inner control that CLOSES its modal returns to the screen the modal
// opened from — the same-path shape where URL evidence is impossible (anchor URL
// equals asserted URL). The deterministic proof is the modal count DROPPING, so
// such a leg must assert 'dialog-close' and never the open 'dialog' assertion.
describe('buildSpecPlan: dialog-close assertion for a modal-close leg', () => {
  const opener: GraphNode = {
    id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 'n_host',
    control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
  }
  const closer: GraphNode = {
    id: 'c_close', route: null, componentPath: null, label: 'Go back', kind: 'control', parent: 'm0',
    control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Go back' } },
  }

  it('emits dialog-close (and NOT dialog) when the to node is the modal\'s host screen via modal.parent', () => {
    const modal: GraphNode = { id: 'm0', route: null, componentPath: null, label: 'LoginModal', kind: 'modal', parent: 'n_host' }
    const gg = graph(
      [node('n_host', { route: '/' }), modal, opener, closer],
      [edge('e1', 'c_open', 'm0', { event: 'click' }), edge('e2', 'c_close', 'n_host', { event: 'click' })],
    )
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_close', 'n_host')!, {})
    const leg = plan.legs.find((l) => l.from === 'c_close')!
    expect(leg.assertions.filter((a) => a.kind === 'dialog-close')).toEqual([{ kind: 'dialog-close', value: 'LoginModal' }])
    expect(leg.assertions.find((a) => a.kind === 'dialog')).toBeUndefined()
  })

  it('falls back to the route match when the modal has no parent but carries the host route', () => {
    const modal: GraphNode = { id: 'm0', route: '/', componentPath: null, label: 'LoginModal', kind: 'modal' }
    const gg = graph(
      [node('n_host', { route: '/' }), modal, opener, closer],
      [edge('e1', 'c_open', 'm0', { event: 'click' }), edge('e2', 'c_close', 'n_host', { event: 'click' })],
    )
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_close', 'n_host')!, {})
    const leg = plan.legs.find((l) => l.from === 'c_close')!
    expect(leg.assertions.filter((a) => a.kind === 'dialog-close')).toEqual([{ kind: 'dialog-close', value: 'LoginModal' }])
  })

  it('keeps current behavior for an inner control leg to a DIFFERENT screen (url assert, no dialog-close)', () => {
    const modal: GraphNode = { id: 'm0', route: null, componentPath: null, label: 'LoginModal', kind: 'modal', parent: 'n_host' }
    const gg = graph(
      [node('n_host', { route: '/' }), node('n_other', { route: '/other' }), modal, opener, closer],
      [edge('e1', 'c_open', 'm0', { event: 'click' }), edge('e2', 'c_close', 'n_other', { event: 'click' })],
    )
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_close', 'n_other')!, {})
    const leg = plan.legs.find((l) => l.from === 'c_close')!
    expect(leg.assertions.find((a) => a.kind === 'dialog-close')).toBeUndefined()
    expect(leg.assertions.find((a) => a.kind === 'url')?.value).toBe('/other')
  })
})

describe('buildSpecPlan — modal-inner locators are dialog-scoped', () => {
  it('scopes a modal-parented control leg inside getByRole(dialog)', () => {
    const opener: GraphNode = {
      id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 's',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
    }
    const inner: GraphNode = {
      id: 'c_in', route: null, componentPath: null, label: 'Go', kind: 'control', parent: 'm0',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Go' } },
    }
    const g = graph(
      [node('s', { route: '/' }), { id: 'm0', route: null, componentPath: null, label: 'Dialog', kind: 'modal' }, node('t', { route: '/t' }), opener, inner],
      [edge('e1', 'c_open', 'm0', { event: 'click' }), edge('e2', 'c_in', 't', { event: 'click' })],
    )
    const plan = buildSpecPlan(g, planForTarget(g, 'c_in', 't')!, { baseUrl: 'http://app' })
    const innerLeg = plan.legs.find((l) => l.from === 'c_in')!
    expect(innerLeg.action.kind).toBe('click')
    expect((innerLeg.action as { locator?: string }).locator).toBe(`page.getByRole('dialog').getByRole("button", { name: "Go" })`)
    const openerLeg = plan.legs.find((l) => l.from === 'c_open')!
    expect((openerLeg.action as { locator?: string }).locator).toBe(`page.getByRole("button", { name: "Open" })`)
  })

  it('scopes by the declared modalSelector instead when configured (role-less modal apps)', () => {
    const opener: GraphNode = {
      id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 's',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
    }
    const inner: GraphNode = {
      id: 'c_in', route: null, componentPath: null, label: 'Go', kind: 'control', parent: 'm0',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Go' } },
    }
    const g = graph(
      [node('s', { route: '/' }), { id: 'm0', route: null, componentPath: null, label: 'Dialog', kind: 'modal' }, node('t', { route: '/t' }), opener, inner],
      [edge('e1', 'c_open', 'm0', { event: 'click' }), edge('e2', 'c_in', 't', { event: 'click' })],
    )
    const plan = buildSpecPlan(g, planForTarget(g, 'c_in', 't')!, { baseUrl: 'http://app', modalSelector: '.app-modal' })
    const innerLeg = plan.legs.find((l) => l.from === 'c_in')!
    expect((innerLeg.action as { locator?: string }).locator).toBe(`page.locator(".app-modal").getByRole("button", { name: "Go" })`)
  })
})
