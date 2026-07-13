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
import { drivePlan, makePlaywrightDriver } from './runner'

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
function fakePage(opts: { startUrl: string; landUrl?: string; dialogs?: number }): {
  page: Parameters<typeof drivePlan>[0]
  clicks: number
  fills: number
} {
  const rec = { clicks: 0, fills: 0, current: opts.startUrl }
  const ctrl = {
    click: async () => {
      rec.clicks++
      if (opts.landUrl !== undefined) rec.current = opts.landUrl
    },
    fill: async () => {
      rec.fills++
      if (opts.landUrl !== undefined) rec.current = opts.landUrl
    },
    count: async () => opts.dialogs ?? 0,
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
})
