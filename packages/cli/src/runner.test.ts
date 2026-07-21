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
import { drivePlan, makePlaywrightDriver, mapPool, runVerify, runVerifyUntilDone } from './runner'
import type { VerifyResult } from './runner'

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
// A canned network response the fake page's waitForResponse resolves with when it
// matches the driver's predicate — 'never' means no matching response ever arrives
// (the real driver's waitForResponse would time out; here it just rejects so the
// driver's own `.catch(() => null)` sees a miss without the test waiting 5s).
type FakeResponse = { method: string; url: string; status: number } | 'never'

// Modal gating: `dialogsAfterClick` makes the dialog count 1 once any click landed
// (the opener opened the modal); `lockedName` names a getByRole control whose click
// throws until then — an inner-modal control is a locator miss while the dialog is
// closed, so a plan that skips the opener prefix reads as undrivable, like reality.
// `clickUrls` maps click ordinal -> URL the page moves to on that click (unset
// ordinals leave the URL alone), for capture-mode prefix/trigger discrimination.
// `selectorCounts` maps a page.locator() selector -> count as a function of clicks
// so far, so the evidence-ladder rungs (config modal selector / overlay heuristic)
// can rise independently of the role=dialog count; unmapped selectors count 0.
// `dialogCounts` maps clicks-so-far -> role=dialog count (overrides dialogs/
// dialogsAfterClick), so a close flow can express rise-then-drop: 0 before the
// opener click, 1 after it, 0 again after the closer click.
function fakePage(opts: { startUrl: string; landUrl?: string; dialogs?: number; dialogsAfterClick?: boolean; dialogCounts?: (clicks: number) => number; lockedName?: string; clickError?: boolean; response?: FakeResponse; clickUrls?: (string | undefined)[]; selectorCounts?: Record<string, (clicks: number) => number> }): {
  page: Parameters<typeof drivePlan>[0]
  clicks: number
  fills: number
  evaluates: number
} {
  const rec = { clicks: 0, fills: 0, evaluates: 0, current: opts.startUrl }
  const ctrl = {
    click: async () => {
      if (opts.clickError === true) throw new Error('locator not found')
      const u = opts.clickUrls?.[rec.clicks]
      rec.clicks++
      if (u !== undefined) rec.current = u
      else if (opts.clickUrls === undefined && opts.landUrl !== undefined) rec.current = opts.landUrl
    },
    fill: async () => {
      rec.fills++
      if (opts.landUrl !== undefined) rec.current = opts.landUrl
    },
    count: async () => (opts.dialogCounts !== undefined ? opts.dialogCounts(rec.clicks) : opts.dialogsAfterClick === true && rec.clicks > 0 ? 1 : (opts.dialogs ?? 0)),
    filter: () => ctrl,
    evaluate: async () => {
      rec.evaluates++
      if (opts.landUrl !== undefined) rec.current = opts.landUrl
    },
  }
  const locked = {
    ...ctrl,
    click: async () => {
      if (rec.clicks === 0) throw new Error('locator not found (modal closed)')
      await ctrl.click()
    },
  }
  const page = {
    goto: async (url: string) => {
      rec.current = url
      return undefined
    },
    url: () => rec.current,
    getByRole: (_role: string, byOpts?: { name?: string }) => {
      const base = opts.lockedName !== undefined && byOpts?.name === opts.lockedName ? locked : ctrl
      return { ...base, getByRole: page.getByRole }
    },
    getByTestId: (_v: string) => ctrl,
    getByLabel: (_v: string) => ctrl,
    getByText: (_v: string) => ctrl,
    locator: (v: string) => {
      const fn = opts.selectorCounts?.[v]
      const base = fn !== undefined ? { ...ctrl, count: async () => fn(rec.clicks) } : ctrl
      return { ...base, filter: () => base, getByRole: page.getByRole }
    },
    waitForLoadState: async () => {},
    waitForURL: async () => {},
    waitForResponse: async (predicate: (r: { url: () => string; status: () => number; request: () => { method: () => string } }) => boolean) => {
      if (opts.response === undefined || opts.response === 'never') throw new Error('no matching response arrived')
      const canned = opts.response
      const r = { url: () => canned.url, status: () => canned.status, request: () => ({ method: () => canned.method }) }
      if (!predicate(r)) throw new Error('response did not match the predicate')
      return r
    },
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

  // The api-effect self-loop shape (a2720f6): a control click whose ONLY effect is a
  // network call back to its own parent screen. A same-path plan carries no URL
  // evidence, so a request assertion is the ONLY thing that can make it drivable —
  // carved exactly there, per the request-evidence task.
  const selfLoopPlanWithRequest = (): SpecPlan => {
    const control: GraphNode = {
      id: 'cc_save', route: null, componentPath: null, label: 'Save', kind: 'control', parent: 'n_a',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Save' } },
    }
    const gg = graph([node('n_a', { route: '/a' }), control], [edge('e', 'cc_save', 'n_a', { event: 'click', effect: 'api:POST /api/orders' })])
    return buildSpecPlan(gg, planPath(gg, 'cc_save', 'n_a')!, { baseUrl: 'http://app' })
  }

  it('confirms a same-path effect self-loop when its request assertion fires with an acceptable status', async () => {
    const plan = selfLoopPlanWithRequest()
    const f = fakePage({ startUrl: 'http://app/a', response: { method: 'POST', url: 'http://app/api/orders', status: 201 } })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(f.clicks).toBeGreaterThan(0)
    expect(res.confirmed).toBe(true)
    expect(res.undrivable).toBeUndefined()
    expect(res.evidence).toEqual({ kind: 'request', method: 'POST', url: 'http://app/api/orders', status: 201 })
  })

  it('does NOT confirm a same-path effect self-loop when no matching request ever arrives (real disagreement, not undrivable)', async () => {
    const plan = selfLoopPlanWithRequest()
    const f = fakePage({ startUrl: 'http://app/a', response: 'never' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBeUndefined()
  })

  it('does NOT confirm a same-path effect self-loop when the matching request comes back with an error status', async () => {
    const plan = selfLoopPlanWithRequest()
    const f = fakePage({ startUrl: 'http://app/a', response: { method: 'POST', url: 'http://app/api/orders', status: 500 } })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBeUndefined()
  })

  // Regression: armRequestWait used to match via `res.url().includes(path)` — a raw
  // substring test. An unrelated request whose URL merely CONTAINS the expected path
  // (e.g. a different, longer endpoint sharing the same prefix) must NOT satisfy it;
  // only an exact pathname match may.
  it('does NOT confirm via an unrelated request whose URL merely contains the expected path as a substring', async () => {
    const plan = selfLoopPlanWithRequest()
    const f = fakePage({ startUrl: 'http://app/a', response: { method: 'POST', url: 'http://app/api/orders/history', status: 200 } })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBeUndefined()
  })
})

// Regression: lastUrlAssertion/expectDialog/requestEvidence used to be plan-wide
// mutable state, not per-leg. A multi-leg plan whose FINAL leg is a same-path
// assert with no request evidence of its own must not ride on an EARLIER, unrelated
// leg's request proof — drivePlan is exported and general-purpose even though today's
// callers (planPath between an edge's own endpoints) only ever produce single-leg
// plans, so this shape is latent, not yet reachable, but must judge soundly if reached.
describe('drivePlan: per-leg evidence scoping (multi-leg plans)', () => {
  it('does NOT let an earlier leg\'s request evidence justify a later same-path leg with none of its own', async () => {
    const plan: SpecPlan = {
      title: 't',
      baseUrl: 'http://app',
      startUrl: '/a',
      preconditions: [],
      legs: [
        {
          from: 'cc_step1',
          to: 'n_mid',
          event: 'click',
          description: 'leg1: an unrelated earlier request-backed leg',
          action: { kind: 'click', locator: 'page.getByRole("button", { name: "Step1" })' },
          assertions: [{ kind: 'request', value: 'POST /api/step1' }],
        },
        {
          from: 'cc_save',
          to: 'n_a',
          event: 'click',
          description: 'leg2: the same-path leg actually being judged — no request assertion of its own',
          action: { kind: 'click', locator: 'page.getByRole("button", { name: "Save" })' },
          assertions: [{ kind: 'url', value: '/a' }],
        },
      ],
    }
    const f = fakePage({ startUrl: 'http://app/a', response: { method: 'POST', url: 'http://app/api/step1', status: 200 } })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBe(true)
  })
})

/** Seed a temp workspace with the given base graph and return its dir. */
async function seedDir(prefix: string, gg: UiGraph): Promise<string> {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { openStore } = await import('@ui-graph/core/node')
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const store = openStore(join(dir, 'uigraph.db'))
  store.setBaseGraph(gg)
  store.close()
  return dir
}

/** Read back a temp workspace's parked-edge sidecar. */
async function readParked(dir: string) {
  const { openStore } = await import('@ui-graph/core/node')
  const { join } = await import('node:path')
  const store = openStore(join(dir, 'uigraph.db'))
  const parked = store.getParkedEdges()
  store.close()
  return parked
}

describe('runVerify: proof-gate rejections are not counted as confirmed', () => {
  it('rejected confirmation → confirmed 0, rejected 1, outcome "rejected", nothing persisted', async () => {
    const { join } = await import('node:path')
    const { openStore } = await import('@ui-graph/core/node')
    const gg = graph(
      [node('n_a', { route: '/a' }), node('n_b', { route: '/b' })],
      [edge('e', 'n_a', 'n_b', { event: 'click', modality: 'may' })],
    )
    const dir = await seedDir('uigraph-verify-', gg)
    // driver claims confirmed but with invalid url-change evidence (start === landed)
    const driver = async (): Promise<{ confirmed: boolean; evidence: { kind: 'url-change'; startUrl: string; landedUrl: string } }> => ({
      confirmed: true,
      evidence: { kind: 'url-change', startUrl: 'http://app/x', landedUrl: 'http://app/x' },
    })
    const summary = await runVerify({ dir, appUrl: 'http://app', limit: 5, driver })
    expect(summary.confirmed).toBe(0)
    expect(summary.rejected).toBe(1)
    expect(summary.outcomes).toEqual({ e: 'rejected' })
    const check = openStore(join(dir, 'uigraph.db'))
    expect(check.getObservations().length).toBe(0)
    check.close()
  })
})

// Diagnosable round-cap parks: runVerify must report each processed target's outcome
// (confirmed / refuted / undrivable) so runVerifyUntilDone can park an exhausted
// target with a reason that carries the diagnosis — "never drivable" and "driven but
// refuted" are very different failures for a human to triage.
describe('runVerify: per-target outcomes', () => {
  // distinct witness locs so pattern-dedup keeps every edge as its own representative
  const w = (line: number): Witness => ({ ...staticWitness, loc: { line, col: 1 } })


  const threeWayGraph = (): UiGraph =>
    graph(
      [node('n_a', { route: '/a' }), node('n_b', { route: '/b' }), node('n_c', { route: '/c' }), node('n_d', { route: '/d' })],
      [
        edge('e_ab', 'n_a', 'n_b', { modality: 'may', witness: w(1) }),
        edge('e_ac', 'n_a', 'n_c', { modality: 'may', witness: w(2) }),
        edge('e_ad', 'n_a', 'n_d', { modality: 'may', witness: w(3) }),
      ],
    )

  it('populates outcomes for confirmed, refuted, and undrivable targets', async () => {
    const dir = await seedDir('uigraph-outcomes-', threeWayGraph())
    const driver = async (plan: Parameters<typeof drivePlan>[1]): Promise<VerifyResult> => {
      const s = JSON.stringify(plan)
      if (s.includes('/b')) return { confirmed: true, evidence: { kind: 'url-change', startUrl: 'http://app/a', landedUrl: 'http://app/b' } }
      if (s.includes('/d')) return { confirmed: false, undrivable: true }
      return { confirmed: false }
    }
    const summary = await runVerify({ dir, appUrl: 'http://app', driver })
    expect(summary.outcomes).toEqual({ e_ab: 'confirmed', e_ac: 'refuted', e_ad: 'undrivable' })
  })

  const oneEdgeGraph = (): UiGraph =>
    graph(
      [node('n_a', { route: '/a' }), node('n_b', { route: '/b' })],
      [edge('e_ab', 'n_a', 'n_b', { modality: 'may', witness: w(1) })],
    )

  it('runVerifyUntilDone parks with the undrivable-flavored reason when every attempt is undrivable', async () => {
    const dir = await seedDir('uigraph-park-undrivable-', oneEdgeGraph())
    const s = await runVerifyUntilDone({ dir, appUrl: 'http://app', maxRounds: 4, parkTries: 2, driver: async () => ({ confirmed: false, undrivable: true }) })
    expect(s.parkedEdges).toBe(1)
    const parked = await readParked(dir)
    expect(parked[0]?.edgeId).toBe('e_ab')
    expect(parked[0]?.reason).toBe('autonomous: undrivable after 2 attempts — no drivable control/plan reached it')
  })

  it('runVerifyUntilDone parks with the unstable-flavored reason when every attempt is refuted', async () => {
    const dir = await seedDir('uigraph-park-unstable-', oneEdgeGraph())
    const s = await runVerifyUntilDone({ dir, appUrl: 'http://app', maxRounds: 4, parkTries: 2, driver: async () => ({ confirmed: false }) })
    expect(s.parkedEdges).toBe(1)
    const parked = await readParked(dir)
    expect(parked[0]?.edgeId).toBe('e_ab')
    expect(parked[0]?.reason).toBe('autonomous: unstable after 2 attempts — driven but refuted (did not land)')
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

// A target whose FROM is a control inside a modal (route null) used to plan a single
// step clicking a locator inside a CLOSED modal — always a miss, always undrivable.
// runVerify now plans via planForTarget, which prefixes the steps that DRIVE the
// modal open (click the opener from the anchored parent screen), so the inner
// control's transition becomes confirmable end-to-end.
describe('runVerify: modal-inner-control target (planForTarget wiring)', () => {
  /** screen /a → opener control → modal → inner control → screen /b; only the inner edge is uncertain (may). */
  const modalGraph = (): UiGraph => {
    const opener: GraphNode = {
      id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 'n_a',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
    }
    const inner: GraphNode = {
      id: 'c_in', route: null, componentPath: null, label: 'Go', kind: 'control', parent: 'm_1',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Go' } },
    }
    return graph(
      [node('n_a', { route: '/a' }), { id: 'm_1', route: null, componentPath: null, label: 'Dialog', kind: 'modal' }, node('n_b', { route: '/b' }), opener, inner],
      [
        edge('e_open', 'c_open', 'm_1', { event: 'click', effect: null }),
        edge('e_in', 'c_in', 'n_b', { event: 'click', modality: 'may' }),
      ],
    )
  }

  it('confirms the inner edge by driving the opener prefix first, and persists the observation', async () => {
    const { join } = await import('node:path')
    const { openStore } = await import('@ui-graph/core/node')
    const dir = await seedDir('uigraph-modal-', modalGraph())
    const f = fakePage({ startUrl: 'http://app/a', landUrl: 'http://app/b', dialogsAfterClick: true, lockedName: 'Go' })
    const driver = async (plan: SpecPlan, appUrl: string, o?: Parameters<typeof drivePlan>[3]): Promise<VerifyResult> => drivePlan(f.page, plan, appUrl, o)
    const summary = await runVerify({ dir, appUrl: 'http://app', driver })
    expect(summary.outcomes).toEqual({ e_in: 'confirmed' })
    // opener + inner: the prefix actually drove the modal open
    expect(f.clicks).toBe(2)
    const check = openStore(join(dir, 'uigraph.db'))
    const obs = check.getObservations()
    check.close()
    expect(obs.length).toBe(1)
  })

  it('reports undrivable, NOT refuted, when the opener locator always throws (absent-control rule holds through the prefix)', async () => {
    const dir = await seedDir('uigraph-modal-undrivable-', modalGraph())
    const f = fakePage({ startUrl: 'http://app/a', landUrl: 'http://app/b', dialogsAfterClick: true, lockedName: 'Go', clickError: true })
    const driver = async (plan: SpecPlan, appUrl: string, o?: Parameters<typeof drivePlan>[3]): Promise<VerifyResult> => drivePlan(f.page, plan, appUrl, o)
    const summary = await runVerify({ dir, appUrl: 'http://app', driver })
    expect(summary.outcomes).toEqual({ e_in: 'undrivable' })
    expect(summary.refuted).toBe(0)
  })
})

// Soundness fixes from the modal-drive review: dialog proof must be a DELTA (a
// pre-existing dialog like a cookie banner must not confirm an opener), a prefix
// leg's request-assert failure is undrivable (the target was never attempted),
// and capture mode re-anchors after the prefix so its URL side-effects never
// count as the dynamic nav.
describe('drivePlan: modal-drive soundness', () => {
  const modalPlanGraph = (openerEffect: string | null = null): UiGraph => {
    const opener: GraphNode = {
      id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 'n_a',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
    }
    const inner: GraphNode = {
      id: 'c_in', route: null, componentPath: null, label: 'Go', kind: 'control', parent: 'm_1',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Go' } },
    }
    return graph(
      [node('n_a', { route: '/a' }), { id: 'm_1', route: null, componentPath: null, label: 'Dialog', kind: 'modal' }, node('n_b', { route: '/b' }), opener, inner],
      [
        edge('e_open', 'c_open', 'm_1', { event: 'click', effect: openerEffect }),
        edge('e_in', 'c_in', 'n_b', { event: 'click', modality: 'may' }),
      ],
    )
  }

  it('does NOT confirm a modal-open edge when a dialog pre-existed and the click opens nothing', async () => {
    const gg = modalPlanGraph()
    const { planForTarget } = await import('@ui-graph/core')
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_open', 'm_1')!, { baseUrl: 'http://app' })
    const f = fakePage({ startUrl: 'http://app/a', dialogs: 1 })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
  })

  it('confirms a modal-open edge when the click raises the dialog count', async () => {
    const gg = modalPlanGraph()
    const { planForTarget } = await import('@ui-graph/core')
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_open', 'm_1')!, { baseUrl: 'http://app' })
    const f = fakePage({ startUrl: 'http://app/a', dialogsAfterClick: true })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(true)
  })

  it('a request-assert miss on a PREFIX leg is undrivable, never a refutation of the target', async () => {
    const gg = modalPlanGraph('api:GET /items')
    const { planForTarget } = await import('@ui-graph/core')
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_in', 'n_b')!, { baseUrl: 'http://app' })
    const f = fakePage({ startUrl: 'http://app/a', landUrl: 'http://app/b', dialogsAfterClick: true, response: 'never' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.undrivable).toBe(true)
  })

  it('capture mode re-anchors after the prefix: an opener URL side-effect never counts as the dynamic nav', async () => {
    const opener: GraphNode = {
      id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 'n_a',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
    }
    const inner: GraphNode = {
      id: 'c_in', route: null, componentPath: null, label: 'Go', kind: 'control', parent: 'm_1',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Go' } },
    }
    const gg = graph(
      [node('n_a', { route: '/a' }), { id: 'm_1', route: null, componentPath: null, label: 'Dialog', kind: 'modal' }, { id: 'u_dyn', route: null, componentPath: null, label: 'dyn', kind: 'unknown' }, opener, inner],
      [
        edge('e_open', 'c_open', 'm_1', { event: 'click', effect: null }),
        edge('e_dyn', 'c_in', 'u_dyn', { event: 'click', modality: 'may' }),
      ],
    )
    const { planForTarget } = await import('@ui-graph/core')
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_in', 'u_dyn')!, { baseUrl: 'http://app' })
    // opener click moves to ?modal=1; the trigger click moves nowhere
    const f = fakePage({ startUrl: 'http://app/a', clickUrls: ['http://app/a?modal=1'] })
    const res = await drivePlan(f.page, plan, 'http://app', { capture: true })
    expect(res.confirmed).toBe(false)
  })
})

// The 3-rung evidence ladder for dialog-asserted legs. Real apps render modals as
// bare divs with NO role=dialog (verified on a real host app: the modal visibly
// opens, the role count stays flat) — rung 1 alone falsely REFUTES a transition
// that happened. Rung 2: the app owner DECLARED what a modal is (modalSelector) —
// a count delta on it is deterministic, auditable proof. Rung 3: a generic
// modal/overlay class heuristic rising means SOMETHING modal-like appeared that we
// cannot witness deterministically — undrivable with an a11y-gap diagnosis, never
// a refutation. Rung 4: nothing rose — honest refutation.
describe('drivePlan: dialog evidence ladder', () => {
  const HEURISTIC = '[class*="modal" i], [class*="overlay" i]'

  /** screen /a with an opener control whose click claims to open modal m_1 (a dialog-asserted leg). */
  const openerPlan = async (): Promise<SpecPlan> => {
    const opener: GraphNode = {
      id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 'n_a',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
    }
    const gg = graph(
      [node('n_a', { route: '/a' }), { id: 'm_1', route: null, componentPath: null, label: 'Dialog', kind: 'modal' }, opener],
      [edge('e_open', 'c_open', 'm_1', { event: 'click', effect: null })],
    )
    const { planForTarget } = await import('@ui-graph/core')
    return buildSpecPlan(gg, planForTarget(gg, 'c_open', 'm_1')!, { baseUrl: 'http://app' })
  }

  it('rung 2: confirms via the configured modalSelector when role=dialog stays flat, evidence names the selector', async () => {
    const plan = await openerPlan()
    const f = fakePage({ startUrl: 'http://app/a', selectorCounts: { '.signup-login-modal-overlay': (clicks) => (clicks > 0 ? 1 : 0) } })
    const res = await drivePlan(f.page, plan, 'http://app', { modalSelector: '.signup-login-modal-overlay' })
    expect(f.clicks).toBeGreaterThan(0)
    expect(res.confirmed).toBe(true)
    expect(res.evidence).toEqual({ kind: 'dialog', detail: 'config modal selector .signup-login-modal-overlay raised the modal count' })
  })

  it('rung 3: heuristic overlay rise with no config and flat role=dialog is undrivable with the a11y-gap diagnosis', async () => {
    const plan = await openerPlan()
    const f = fakePage({ startUrl: 'http://app/a', selectorCounts: { [HEURISTIC]: (clicks) => (clicks > 0 ? 1 : 0) } })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBe(true)
    expect(res.undrivableReason).toContain('role="dialog"')
    expect(res.undrivableReason).toContain('modalSelector')
  })

  it('rung 4: nothing rises → honest refutation (confirmed false, undrivable undefined)', async () => {
    const plan = await openerPlan()
    const f = fakePage({ startUrl: 'http://app/a' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBeUndefined()
    expect(res.undrivableReason).toBeUndefined()
  })
})

// A rung-3 diagnosis must survive the fold: runVerify collects it into
// summary.diagnoses, runVerifyUntilDone carries it into the autonomous park
// reason so the human triaging the parked list sees the app-side fix.
describe('runVerifyUntilDone: rung-3 diagnosis reaches the park reason', () => {
  it('an always-rung-3 driver parks with the a11y-gap diagnosis appended', async () => {
    const w = (line: number): Witness => ({ ...staticWitness, loc: { line, col: 1 } })
    const gg = graph(
      [node('n_a', { route: '/a' }), node('n_b', { route: '/b' })],
      [edge('e_ab', 'n_a', 'n_b', { modality: 'may', witness: w(1) })],
    )
    const dir = await seedDir('uigraph-park-a11y-', gg)
    const reason = 'a modal-like element appeared but exposes no role=dialog — cannot witness deterministically (app a11y gap: add role="dialog"/aria-modal, or declare modalSelector in the workspace config)'
    const s = await runVerifyUntilDone({ dir, appUrl: 'http://app', maxRounds: 4, parkTries: 2, driver: async () => ({ confirmed: false, undrivable: true, undrivableReason: reason }) })
    expect(s.parkedEdges).toBe(1)
    const parked = await readParked(dir)
    expect(parked[0]?.edgeId).toBe('e_ab')
    expect(parked[0]?.reason).toContain('autonomous: undrivable after 2 attempts')
    expect(parked[0]?.reason).toContain('app a11y gap')
  })
})

// Review hardening of the evidence ladder: a DECLARED selector that stays flat is
// affirmative refutation (the heuristic must not mask it), and an invalid declared
// selector fails loud as undrivable instead of mass-false-refuting.
describe('drivePlan: evidence-ladder hardening', () => {
  const openModalGraph = (): UiGraph => {
    const opener: GraphNode = {
      id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 'n_a',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
    }
    return graph(
      [node('n_a', { route: '/a' }), { id: 'm_1', route: null, componentPath: null, label: 'Dialog', kind: 'modal' }, opener],
      [edge('e_open', 'c_open', 'm_1', { event: 'click', effect: null })],
    )
  }

  it('a declared selector that stays flat REFUTES even when an unrelated overlay rises', async () => {
    const gg = openModalGraph()
    const { planForTarget } = await import('@ui-graph/core')
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_open', 'm_1')!, { baseUrl: 'http://app' })
    const f = fakePage({
      startUrl: 'http://app/a',
      selectorCounts: {
        '.declared-modal': () => 0,
        '[class*="modal" i], [class*="overlay" i]': (clicks) => (clicks > 0 ? 1 : 0),
      },
    })
    const res = await drivePlan(f.page, plan, 'http://app', { modalSelector: '.declared-modal' })
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBeUndefined()
  })

  it('an invalid declared selector is undrivable with a loud reason, never a refutation', async () => {
    const gg = openModalGraph()
    const { planForTarget } = await import('@ui-graph/core')
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_open', 'm_1')!, { baseUrl: 'http://app' })
    const f = fakePage({
      startUrl: 'http://app/a',
      selectorCounts: { '[bad': () => { throw new Error('SyntaxError: not a valid selector') } },
    })
    const res = await drivePlan(f.page, plan, 'http://app', { modalSelector: '[bad' })
    expect(res.undrivable).toBe(true)
    expect(res.undrivableReason).toContain('not a valid CSS selector')
  })
})

// Dialog-CLOSE delta evidence: a modal-inner control that CLOSES its modal
// navigates back to the host screen the modal opened from — same-path, so URL
// evidence is impossible and the same-path guard used to make the whole
// modal-close edge class permanently undrivable. The deterministic proof that
// DOES exist: the visible modal count DROPS across the click. The ladder mirrors
// (inverted) the open ladder: role=dialog drop confirms, declared-modalSelector
// drop confirms, nothing-open-to-close is undrivable (the opener prefix failed
// silently), open-but-never-dropped is an honest refutation.
describe('drivePlan: dialog-close delta evidence', () => {
  /** host /a → opener control → modal (parent n_a) → closer control → host /a; only the close edge is uncertain (may). */
  const closeGraph = (): UiGraph => {
    const opener: GraphNode = {
      id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 'n_a',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
    }
    const closer: GraphNode = {
      id: 'c_close', route: null, componentPath: null, label: 'Go back', kind: 'control', parent: 'm_1',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Go back' } },
    }
    return graph(
      [node('n_a', { route: '/a' }), { id: 'm_1', route: null, componentPath: null, label: 'LoginModal', kind: 'modal', parent: 'n_a' }, opener, closer],
      [edge('e_open', 'c_open', 'm_1', { event: 'click', effect: null }), edge('e_close', 'c_close', 'n_a', { event: 'click', modality: 'may' })],
    )
  }

  const closePlan = async (modalSelector?: string): Promise<SpecPlan> => {
    const gg = closeGraph()
    const { planForTarget } = await import('@ui-graph/core')
    return buildSpecPlan(gg, planForTarget(gg, 'c_close', 'n_a')!, { baseUrl: 'http://app', ...(modalSelector !== undefined ? { modalSelector } : {}) })
  }

  it('(a) e2e via runVerify: role-based close confirms — the count rises on the opener click and drops on the close click', async () => {
    const { join } = await import('node:path')
    const { openStore } = await import('@ui-graph/core/node')
    const dir = await seedDir('uigraph-close-', closeGraph())
    const f = fakePage({ startUrl: 'http://app/a', dialogCounts: (clicks) => (clicks === 1 ? 1 : 0), lockedName: 'Go back' })
    const driver = async (plan: SpecPlan, appUrl: string, o?: Parameters<typeof drivePlan>[3]): Promise<VerifyResult> => drivePlan(f.page, plan, appUrl, o)
    const summary = await runVerify({ dir, appUrl: 'http://app', driver })
    expect(summary.outcomes).toEqual({ e_close: 'confirmed' })
    // opener + closer: the prefix actually drove the modal open before the close
    expect(f.clicks).toBe(2)
    const check = openStore(join(dir, 'uigraph.db'))
    const obs = check.getObservations()
    check.close()
    expect(obs.length).toBe(1)
  })

  it('role rung: the role=dialog count dropping below its pre-click baseline confirms with the close evidence', async () => {
    const plan = await closePlan()
    const f = fakePage({ startUrl: 'http://app/a', dialogCounts: (clicks) => (clicks === 1 ? 1 : 0) })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(true)
    expect(res.evidence).toEqual({ kind: 'dialog', detail: 'dialog count dropped after drive (modal closed)' })
  })

  it('(b) declared-selector close confirms when role=dialog is always 0 and the selector count rises then drops', async () => {
    const plan = await closePlan('.app-modal')
    const f = fakePage({ startUrl: 'http://app/a', selectorCounts: { '.app-modal': (clicks) => (clicks === 1 ? 1 : 0) } })
    const res = await drivePlan(f.page, plan, 'http://app', { modalSelector: '.app-modal' })
    expect(res.confirmed).toBe(true)
    expect(res.evidence).toEqual({ kind: 'dialog', detail: 'config modal selector .app-modal dropped the modal count (modal closed)' })
  })

  it('(c) nothing was open before the close click → undrivable with the opener-precondition reason', async () => {
    const plan = await closePlan('.app-modal')
    const f = fakePage({ startUrl: 'http://app/a', selectorCounts: { '.app-modal': () => 0 } })
    const res = await drivePlan(f.page, plan, 'http://app', { modalSelector: '.app-modal' })
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBe(true)
    expect(res.undrivableReason).toBe('modal was not open before the close interaction — opener prefix did not deliver the precondition')
  })

  it('no role=dialog and no declared selector → nothing can witness the drop: undrivable with the a11y-gap diagnosis', async () => {
    const plan = await closePlan()
    const f = fakePage({ startUrl: 'http://app/a' })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBe(true)
    expect(res.undrivableReason).toContain('modalSelector')
  })

  it('(d) modal open but the count never drops → honest refutation (the close did not fire)', async () => {
    const plan = await closePlan()
    const f = fakePage({ startUrl: 'http://app/a', dialogCounts: (clicks) => (clicks >= 1 ? 1 : 0) })
    const res = await drivePlan(f.page, plan, 'http://app')
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBeUndefined()
    expect(res.undrivableReason).toBeUndefined()
  })
})

// Review round-2 hardening: with a DECLARED selector the role=dialog count is an
// unrelated dialog by definition (consent banner) — its drop must never confirm a
// close; and an honest close refutation must survive the probe fallback.
describe('drivePlan: close ladder hardening', () => {
  const closeGraph = (): UiGraph => {
    const opener: GraphNode = {
      id: 'c_open', route: null, componentPath: null, label: 'Open', kind: 'control', parent: 'n_a',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Open' } },
    }
    const closer: GraphNode = {
      id: 'c_close', route: null, componentPath: null, label: 'Back', kind: 'control', parent: 'm_1',
      control: { element: 'button', controlType: 'button', selector: { strategy: 'role-name', value: 'button|Back' } },
    }
    return graph(
      [node('n_a', { route: '/a' }), { id: 'm_1', route: null, componentPath: null, label: 'Dialog', kind: 'modal', parent: 'n_a' }, opener, closer],
      [edge('e_open', 'c_open', 'm_1', { event: 'click', effect: null }), edge('e_close', 'c_close', 'n_a', { event: 'click', modality: 'may' })],
    )
  }

  it('a role=dialog drop (banner dismissal) must NOT confirm a close when the declared selector stays flat', async () => {
    const gg = closeGraph()
    const { planForTarget } = await import('@ui-graph/core')
    const plan = buildSpecPlan(gg, planForTarget(gg, 'c_close', 'n_a')!, { baseUrl: 'http://app', modalSelector: '.app-modal' })
    const f = fakePage({
      startUrl: 'http://app/a',
      dialogCounts: (clicks) => (clicks >= 2 ? 0 : 1),
      selectorCounts: { '.app-modal': (clicks) => (clicks >= 1 ? 1 : 0) },
    })
    const res = await drivePlan(f.page, plan, 'http://app', { modalSelector: '.app-modal' })
    expect(res.confirmed).toBe(false)
    expect(res.undrivable).toBeUndefined()
  })

  it('an honest close refutation is NOT laundered to undrivable by the probe fallback', async () => {
    const gg = closeGraph()
    const dir = await seedDir('uigraph-close-refute-', gg)
    const f = fakePage({
      startUrl: 'http://app/a',
      dialogCounts: (clicks) => (clicks >= 1 ? 1 : 0),
    })
    const driver = async (plan: SpecPlan, appUrl: string, o?: Parameters<typeof drivePlan>[3]): Promise<VerifyResult> => drivePlan(f.page, plan, appUrl, o)
    const summary = await runVerify({ dir, appUrl: 'http://app', driver })
    expect(summary.outcomes['e_close']).toBe('refuted')
  })
})
