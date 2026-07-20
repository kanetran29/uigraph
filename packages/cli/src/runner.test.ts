// Tier-3 goto-fallback soundness tests for the driver's confirmation logic.
// drivePlan is the page-driven core of makePlaywrightDriver, exercised here with a
// fake page so no real browser is needed. The contract under test: a parked leg
// (interaction-triggered/guarded screen→screen nav, no drivable control) must NEVER
// confirm by a bare URL match, while a direct-nav link edge still confirms by URL,
// and capture-mode is unaffected (it drives interactions and observes the landing).

import { describe, it, expect, vi } from 'vitest'
import { buildSpecPlan } from '@ui-graph/core'
import { planPath } from '@ui-graph/core'
import type { GraphEdge, GraphNode, SpecPlan, UiGraph, Witness } from '@ui-graph/core'
import { drivePlan, makePlaywrightDriver, mapPool, runVerify } from './runner'

const staticWitness: Witness = { source: 'static', file: 'x.tsx', loc: { line: 1, col: 1 }, ruleId: 'test' }

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({ id, route: `/${id}`, componentPath: null, label: id, kind: 'screen', ...over })

const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({
  id, from, to, event: 'navigate', guard: null, effect: 'navigate', modality: 'must', source: 'static', confidence: 1, witness: staticWitness, ...over,
})

const graph = (nodes: GraphNode[], edges: GraphEdge[]): UiGraph => ({ version: 0, meta: { adapter: 't', adapterVersion: '0', rulesetVersion: 't' }, nodes, edges })

// A fake Playwright page driven by a mutable current URL: goto sets it; in capture
// mode an interaction (click/fill) advances it to `landUrl` so the driver observes a
// real landing. In assert mode `landUrl` is left undefined and url() reflects the
// last goto, so the URL-assert decision can be exercised without a browser.
function fakePage(opts: { startUrl: string; landUrl?: string; dialogs?: number; clickError?: boolean }): {
  page: Parameters<typeof drivePlan>[0]
  clicks: number
  fills: number
  evaluates: number
} {
  const rec = { clicks: 0, fills: 0, evaluates: 0, current: opts.startUrl }
  const ctrl = {
    click: async () => {
      if (opts.clickError === true) throw new Error('locator not found')
      rec.clicks++
      if (opts.landUrl !== undefined) rec.current = opts.landUrl
    },
    fill: async () => {
      rec.fills++
      if (opts.landUrl !== undefined) rec.current = opts.landUrl
    },
    count: async () => opts.dialogs ?? 0,
    evaluate: async () => {
      rec.evaluates++
      if (opts.landUrl !== undefined) rec.current = opts.landUrl
    },
  }
  const page = {
    goto: async (url: string) => {
      rec.current = url
      return undefined
    },
    url: () => rec.current,
    getByRole: (_role: string) => ctrl,
    getByTestId: (_v: string) => ctrl,
    getByLabel: (_v: string) => ctrl,
    getByText: (_v: string) => ctrl,
    locator: (_v: string) => ctrl,
    waitForLoadState: async () => {},
    waitForURL: async () => {},
  }
  return {
    page: page as unknown as Parameters<typeof drivePlan>[0],
    get clicks() {
      return rec.clicks
    },
    get fills() {
      return rec.fills
    },
    get evaluates() {
      return rec.evaluates
    },
  }
}

describe('drivePlan: goto-fallback soundness (assert mode)', () => {
  it('does NOT confirm a guarded submit edge by URL match (it is parked)', async () => {
    const gg = graph(
      [node('n_form', { route: '/form' }), node('n_done', { route: '/done' })],
      [edge('e', 'n_form', 'n_done', { event: 'submit', guard: 'form.valid', modality: 'may' })],
    )
    const plan = buildSpecPlan(gg, planPath(gg, 'n_form', 'n_done')!, { baseUrl: 'http://app' })
    // Even if the page were sitting on the matching landing URL, the parked leg must not confirm.
    const f = fakePage({ startUrl: 'http://app/done' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
  })

  it('confirms a direct-nav link edge (null guard) by URL assert', async () => {
    const gg = graph(
      [node('n_a', { route: '/a' }), node('n_b', { route: '/b' })],
      [edge('e', 'n_a', 'n_b', { event: 'click:Link', guard: null })],
    )
    const plan = buildSpecPlan(gg, planPath(gg, 'n_a', 'n_b')!, { baseUrl: 'http://app' })
    const f = fakePage({ startUrl: 'http://app/a' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(true)
  })

  it('does NOT confirm a guarded link edge (non-null guard) even on a URL match', async () => {
    const gg = graph(
      [node('n_a', { route: '/a' }), node('n_dash', { route: '/dash' })],
      [edge('e', 'n_a', 'n_dash', { event: 'click:Link', guard: 'isAuth', modality: 'may' })],
    )
    const plan = buildSpecPlan(gg, planPath(gg, 'n_a', 'n_dash')!, { baseUrl: 'http://app' })
    const f = fakePage({ startUrl: 'http://app/dash' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
  })

  it('capture mode is unaffected: drives interactions and confirms by the observed landing', async () => {
    // A control-driven submit leg: capture mode runs the click and observes the landing.
    const submit: GraphNode = {
      id: 'cc_submit', route: null, componentPath: null, label: 'Submit', kind: 'control', parent: 'n_form',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Submit' } },
    }
    const gg = graph(
      [node('n_form', { route: '/form' }), { id: 'u_dyn', route: null, componentPath: null, label: 'dyn', kind: 'unknown' }, submit],
      [edge('e', 'cc_submit', 'u_dyn', { event: 'click', modality: 'may' })],
    )
    const plan = buildSpecPlan(gg, planPath(gg, 'n_form', 'u_dyn')!, { baseUrl: 'http://app' })
    const f = fakePage({ startUrl: 'http://app/form', landUrl: 'http://app/landed' })
    const res = await drivePlan(f.page, plan, 'http://app', { capture: true })
    expect(f.clicks).toBeGreaterThan(0)
    expect(res.landedUrl).toBe('http://app/landed')
    expect(res.confirmed).toBe(true)
  })

  it('drives a form-level "submit" event leg via requestSubmit, not a bounding-box click', async () => {
    // The extractor models a form's onSubmit as a control on the <form> element
    // itself (selector "form"); a blind click on that locator can land on dead
    // space beside the form's fields, so a `submit` event must dispatch via
    // requestSubmit() instead — this is the regression this test guards.
    const formControl: GraphNode = {
      id: 'cc_form', route: null, componentPath: null, label: 'form', kind: 'control', parent: 'n_form',
      control: { element: 'form', controlType: 'form', selector: { strategy: 'structural', value: 'form' } },
    }
    const gg = graph(
      [node('n_form', { route: '/form' }), node('n_done', { route: '/done' }), formControl],
      [edge('e', 'cc_form', 'n_done', { event: 'submit', modality: 'may' })],
    )
    const plan = buildSpecPlan(gg, planPath(gg, 'n_form', 'n_done')!, { baseUrl: 'http://app' })
    const f = fakePage({ startUrl: 'http://app/form', landUrl: 'http://app/done' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(f.evaluates).toBeGreaterThan(0)
    expect(f.clicks).toBe(0)
    expect(res.confirmed).toBe(true)
  })
})

// makePlaywrightDriver must launch ONE browser per run and reuse it across edges
// (a fresh page per edge, closed after), not relaunch Chromium per edge. We mock
// playwright-core with a fake chromium that tallies launches/contexts/pages so the
// reuse contract is provable without a real browser, while still confirming the
// orchestration drives each plan and judges confirm/refute correctly.
const launches = { count: 0 }
const contexts = { count: 0 }
const pages = { open: 0, closed: 0 }

vi.mock('playwright-core', () => {
  const makePage = (): unknown => {
    pages.open++
    let current = ''
    return {
      goto: async (url: string) => {
        current = url
        return undefined
      },
      url: () => current,
      getByRole: () => ({ click: async () => {}, fill: async () => {}, count: async () => 0 }),
      locator: () => ({ click: async () => {}, fill: async () => {}, count: async () => 0 }),
      waitForLoadState: async () => {},
      waitForURL: async () => {},
      close: async () => {
        pages.closed++
      },
    }
  }
  const makeContext = (): unknown => {
    contexts.count++
    return { newPage: async () => makePage() }
  }
  return {
    chromium: {
      launch: async () => {
        launches.count++
        return { newContext: async () => makeContext(), close: async () => {} }
      },
    },
  }
})

describe('makePlaywrightDriver: one browser per run, page per edge', () => {
  it('launches Chromium once across many edges, opens+closes a page each, and judges each plan', async () => {
    launches.count = 0
    contexts.count = 0
    pages.open = 0
    pages.closed = 0

    const gg = graph(
      [node('n_a', { route: '/a' }), node('n_b', { route: '/b' })],
      [edge('e', 'n_a', 'n_b', { event: 'click:Link', guard: null })],
    )
    const plan: SpecPlan = buildSpecPlan(gg, planPath(gg, 'n_a', 'n_b')!, { baseUrl: 'http://app' })

    const owned = makePlaywrightDriver()
    const r1 = await owned.driver(plan, 'http://app')
    const r2 = await owned.driver(plan, 'http://app')
    const r3 = await owned.driver(plan, 'http://app')
    await owned.dispose()

    expect(launches.count).toBe(1)
    expect(contexts.count).toBe(1)
    expect(pages.open).toBe(3)
    expect(pages.closed).toBe(3)
    // The direct-nav link edge confirms by URL assert on every reused page.
    expect([r1.confirmed, r2.confirmed, r3.confirmed]).toEqual([true, true, true])
  })

  it('dispose before any drive is a no-op (no browser launched)', async () => {
    launches.count = 0
    const owned = makePlaywrightDriver()
    await owned.dispose()
    expect(launches.count).toBe(0)
  })

  it('CONCURRENT first-calls (the worker pool) still launch Chromium exactly once', async () => {
    launches.count = 0
    contexts.count = 0
    const gg = graph([node('n_a', { route: '/a' }), node('n_b', { route: '/b' })], [edge('e', 'n_a', 'n_b', { event: 'click:Link', guard: null })])
    const plan: SpecPlan = buildSpecPlan(gg, planPath(gg, 'n_a', 'n_b')!, { baseUrl: 'http://app' })
    const owned = makePlaywrightDriver()
    // fire 8 drives at once BEFORE any has initialized the browser — the memoized init
    // must serialize them onto a single launch, not one per racing first-call.
    await Promise.all(Array.from({ length: 8 }, () => owned.driver(plan, 'http://app')))
    await owned.dispose()
    expect(launches.count).toBe(1)
    expect(contexts.count).toBe(1)
  })
})

describe('mapPool: bounded concurrency, results by input index', () => {
  it('preserves input order even when later items finish first', async () => {
    const order: number[] = []
    const out = await mapPool([30, 5, 20, 1], 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms))
      order.push(i)
      return ms * 10
    })
    // results are index-aligned regardless of completion order
    expect(out).toEqual([300, 50, 200, 10])
    // and completion order is NOT input order (fast items finished first) — proves real concurrency
    expect(order).not.toEqual([0, 1, 2, 3])
  })

  it('never runs more than `concurrency` workers at once', async () => {
    let inFlight = 0
    let peak = 0
    await mapPool(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(3)
  })
})

// Regression tests for the silent-confirmation bug found on a real app (jaakko):
// (1) a probe whose expected route equals the start route can never produce URL
// evidence — the bounce branch must not vacuously confirm; (2) a confirmation the
// proof gate rejects must not be counted in the verify summary (it was counted
// while nothing was persisted).
describe('probe same-path soundness', () => {
  it('does NOT confirm a probe whose expected route equals the start route', async () => {
    const gg = graph(
      [node('n_a', { route: '/a' }), node('n_b', { route: '/b' })],
      [edge('e', 'n_a', 'n_b', { event: 'click', modality: 'may' })],
    )
    const plan = buildSpecPlan(gg, planPath(gg, 'n_a', 'n_b')!, { baseUrl: 'http://app' })
    const probe = { startUrl: '/', expectedRoute: '/', targetLocator: "getByRole('button', { name: 'Open' })", siblingLocators: [] }
    const f = fakePage({ startUrl: 'http://app/' })
    const res = await drivePlan(f.page, plan, 'http://app', { probe })
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBe(true)
  })
})

// Regression: an effect-only self-loop edge (control -> its own parent screen) plans
// to a start URL that already equals the asserted target — the same vulnerable shape
// probePlan already guards against, now reachable via drivePlan's normal (non-probe)
// path too, since feature A mints this edge for every effect-only control.
describe('drivePlan: same-path assert soundness (self-loop edges)', () => {
  const selfLoopPlan = (): SpecPlan => {
    const control: GraphNode = {
      id: 'cc_x', route: null, componentPath: null, label: 'Clear', kind: 'control', parent: 'n_a',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Clear' } },
    }
    const gg = graph([node('n_a', { route: '/a' }), control], [edge('e', 'cc_x', 'n_a', { event: 'click', effect: 'state:setX' })])
    return buildSpecPlan(gg, planPath(gg, 'cc_x', 'n_a')!, { baseUrl: 'http://app' })
  }

  it('does NOT confirm a click that fires but does nothing (the page never had to move)', async () => {
    const plan = selfLoopPlan()
    const f = fakePage({ startUrl: 'http://app/a' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(f.clicks).toBeGreaterThan(0)
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBe(true)
  })

  it('still refutes when the click unexpectedly navigates elsewhere (real static/runtime disagreement)', async () => {
    const plan = selfLoopPlan()
    const f = fakePage({ startUrl: 'http://app/a', landUrl: 'http://app/elsewhere' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBeUndefined()
  })
})

describe('runVerify: proof-gate rejections are not counted as confirmed', () => {
  it('rejected confirmation → confirmed 0, rejected 1, nothing persisted', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { openStore } = await import('@ui-graph/core/node')
    const dir = mkdtempSync(join(tmpdir(), 'uigraph-verify-'))
    const gg = graph(
      [node('n_a', { route: '/a' }), node('n_b', { route: '/b' })],
      [edge('e', 'n_a', 'n_b', { event: 'click', modality: 'may' })],
    )
    const store = openStore(join(dir, 'uigraph.db'))
    store.setBaseGraph(gg)
    store.close()
    // driver claims confirmed but with invalid url-change evidence (start === landed)
    const driver = async (): Promise<{ confirmed: boolean; evidence: { kind: 'url-change'; startUrl: string; landedUrl: string } }> => ({
      confirmed: true,
      evidence: { kind: 'url-change', startUrl: 'http://app/x', landedUrl: 'http://app/x' },
    })
    const summary = await runVerify({ dir, appUrl: 'http://app', limit: 5, driver })
    expect(summary.confirmed).toBe(0)
    expect(summary.rejected).toBe(1)
    const check = openStore(join(dir, 'uigraph.db'))
    expect(check.getObservations().length).toBe(0)
    check.close()
  })
})

// Regression: a locator that cannot be resolved (control not rendered in the
// current app state, e.g. a Sign-in button while authenticated) means the
// interaction was NEVER performed — that is undrivable, not a refutation.
describe('drivePlan: absent control is undrivable, not refuted', () => {
  it('returns undrivable when an interaction leg locator throws', async () => {
    const signIn: GraphNode = {
      id: 'cc_signin', route: null, componentPath: null, label: 'Sign in', kind: 'control', parent: 'n_root',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Sign in' } },
    }
    const gg = graph(
      [node('n_root', { route: '/' }), { id: 'm_login', route: null, componentPath: null, label: 'LoginModal', kind: 'modal' }, signIn],
      [edge('e', 'cc_signin', 'm_login', { event: 'click', modality: 'may', effect: 'open:modal' })],
    )
    const plan = buildSpecPlan(gg, planPath(gg, 'n_root', 'm_login')!, { baseUrl: 'http://app' })
    const f = fakePage({ startUrl: 'http://app/', clickError: true })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBe(true)
  })
})
