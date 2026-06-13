// Tier-3 verification runner. Pulls the next_to_verify worklist (uncertain edges +
// proposed transitions), plans each as a spec, drives the running app to attempt it,
// and reports the outcome via report_observation. A confirmed observation folds into
// the graph as a witnessed runtime edge on the next read — coverage rises. Only
// confirmed observations enter the graph (soundness): the runner mints no edges
// itself; it records what it observed.
//
// The browser DRIVER is injectable so the orchestration is testable without a
// browser; the default driver lazy-loads `playwright-core` (optional dep — install
// it to actually drive) and uses the system/cached Chromium.

import type { SpecPlan } from '@uigraph/core'
import { buildSpecPlan, nextToVerify, planPath } from '@uigraph/core'
import { openStore } from '@uigraph/core/node'
import { dbPath, loadMergedGraph, reportObservation, getLoopStatus } from '@uigraph/mcp'

/** The outcome of attempting one planned transition in a real browser. */
export interface VerifyResult {
  confirmed: boolean
  screenshot?: string
}

/** Drives one spec plan against the app and reports whether the transition happened. */
export type VerifyDriver = (plan: SpecPlan, appUrl: string) => Promise<VerifyResult>

/** Options for runVerify: workspace dir, the app's base URL, a cap, an optional driver, and an optional saved auth session. */
export interface RunVerifyOptions {
  dir: string
  appUrl: string
  limit?: number
  driver?: VerifyDriver
  storageState?: string
}

/** What a verification run did: how many targets it attempted, confirmed, refuted. */
export interface VerifySummary {
  attempted: number
  confirmed: number
  refuted: number
}

/**
 * Run the Tier-3 loop: for each worklist target, plan a path, drive the app, and
 * record the observation. Confirmed observations become runtime-witnessed edges on
 * the next graph read. Returns a summary.
 */
export async function runVerify(opts: RunVerifyOptions): Promise<VerifySummary> {
  const ctx = { dir: opts.dir }
  const graph = loadMergedGraph(ctx)
  const store = openStore(dbPath(ctx))
  const proposalGraph = store.getProposalGraph()
  const parkedIds = new Set(store.getParkedEdges().map((p) => p.edgeId))
  store.close()

  const targets = nextToVerify(graph, proposalGraph, opts.limit, parkedIds)
  const driver = opts.driver ?? makePlaywrightDriver(opts.storageState)
  let confirmed = 0
  let refuted = 0

  for (const t of targets) {
    const steps = planPath(graph, t.from, t.to)
    if (steps === null) continue
    const plan = buildSpecPlan(graph, steps, { baseUrl: opts.appUrl, title: `verify ${t.from} → ${t.to}` })
    let result: VerifyResult
    try {
      result = await driver(plan, opts.appUrl)
    } catch {
      result = { confirmed: false }
    }
    reportObservation(ctx, {
      from: t.from,
      to: t.to,
      event: t.event,
      outcome: result.confirmed ? 'confirmed' : 'refuted',
      ...(t.proposalIds && t.proposalIds.length > 0 ? { proposalId: t.proposalIds[0] } : {}),
      ...(result.screenshot ? { screenshot: result.screenshot } : {}),
    })
    if (result.confirmed) confirmed++
    else refuted++
  }

  return { attempted: targets.length, confirmed, refuted }
}

/** Options for the autonomous until-done loop. */
export interface RunVerifyUntilDoneOptions extends RunVerifyOptions {
  maxRounds?: number
  parkTries?: number
}

/** What the autonomous loop did, with BOTH honest metrics + how it ended. */
export interface UntilDoneSummary {
  rounds: number
  confirmed: number
  parkedEdges: number
  parkedProposals: number
  loopDone: boolean
  exitReason: 'loopDone' | 'max-rounds-parked'
  runtimeRatio: number
  accountedRatio: number
}

/**
 * Drive the verify worklist round after round until the loop is DONE (every edge
 * accounted-for: witnessed or parked, and every proposal resolved). Each round runs
 * one verify pass; any target still open after `parkTries` attempts is PARKED with
 * an auditable autonomous reason (edges via parkEdge, proposals via 'unverifiable')
 * so the open set strictly shrinks and the loop terminates. If the round cap is hit
 * with anything still open, the remainder is parked for human review (exitReason
 * 'max-rounds-parked'). 100%-accounted reached by parking is HONEST: parked is
 * excluded from runtimeRatio and tagged by:'runner', and both ratios are returned.
 */
export async function runVerifyUntilDone(opts: RunVerifyUntilDoneOptions): Promise<UntilDoneSummary> {
  const ctx = { dir: opts.dir }
  const maxRounds = opts.maxRounds ?? 10
  const parkTries = opts.parkTries ?? 2
  const tries = new Map<string, number>()
  let rounds = 0
  let confirmed = 0
  let parkedEdges = 0
  let parkedProposals = 0

  for (; rounds < maxRounds; rounds++) {
    if (getLoopStatus(ctx).loopDone) break
    const pass = await runVerify(opts)
    confirmed += pass.confirmed
    // bump attempts for everything still open; park targets that exhausted their tries
    const status = getLoopStatus(ctx)
    const store = openStore(dbPath(ctx))
    try {
      for (const e of status.openEdges) {
        const n = (tries.get(e.id) ?? 0) + 1
        tries.set(e.id, n)
        if (n >= parkTries) {
          store.parkEdge(e.id, `autonomous: unreachable/undrivable after ${n} attempts`, 'runner')
          parkedEdges++
        }
      }
      for (const p of store.queryProposals({ status: 'proposed' })) {
        const key = `prop:${p.id}`
        const n = (tries.get(key) ?? 0) + 1
        tries.set(key, n)
        if (n >= parkTries) {
          store.setProposalStatus(p.id, 'unverifiable', `autonomous: unverified after ${n} attempts`)
          parkedProposals++
        }
      }
    } finally {
      store.close()
    }
  }

  // Backstop: if the cap was hit with anything still open, park the remainder for a human.
  let exitReason: UntilDoneSummary['exitReason'] = 'loopDone'
  const before = getLoopStatus(ctx)
  if (!before.loopDone) {
    exitReason = 'max-rounds-parked'
    const store = openStore(dbPath(ctx))
    try {
      for (const e of before.openEdges) {
        store.parkEdge(e.id, 'autonomous: parked at round cap for human review', 'runner')
        parkedEdges++
      }
      for (const p of store.queryProposals({ status: 'proposed' })) {
        store.setProposalStatus(p.id, 'unverifiable', 'autonomous: parked at round cap for human review')
        parkedProposals++
      }
    } finally {
      store.close()
    }
  }

  const final = getLoopStatus(ctx)
  return {
    rounds,
    confirmed,
    parkedEdges,
    parkedProposals,
    loopDone: final.loopDone,
    exitReason,
    runtimeRatio: final.coverage.runtimeRatio,
    accountedRatio: final.coverage.accountedRatio,
  }
}

/** The optional playwright-core module, loaded via a variable specifier so a missing package is a runtime error, not a compile error. */
async function loadPlaywright(): Promise<{ chromium: { launch: () => Promise<unknown> } }> {
  const moduleName = 'playwright-core'
  try {
    return (await import(moduleName)) as { chromium: { launch: () => Promise<unknown> } }
  } catch {
    throw new Error('Tier-3 runner needs playwright-core: `pnpm add -w playwright-core` (a Chromium is already cached).')
  }
}

/**
 * Build the default driver: launch Chromium (playwright-core), open a context
 * (optionally hydrated from a saved auth `storageState` so the run is logged in),
 * execute the plan's legs (goto/click/fill via the selector locators), then judge
 * the transition by its final assertion (URL match and/or a visible dialog).
 */
function makePlaywrightDriver(storageState?: string): VerifyDriver {
  return async (plan: SpecPlan, appUrl: string): Promise<VerifyResult> => {
    const { chromium } = await loadPlaywright()
    const browser = (await chromium.launch()) as PwBrowser
    try {
      const context = await browser.newContext(storageState !== undefined ? { storageState } : {})
      const page = await context.newPage()
      await page.goto(plan.startUrl.startsWith('http') ? plan.startUrl : appUrl + plan.startUrl)
      let lastUrlAssertion: string | undefined
      let expectDialog = false
      for (const leg of plan.legs) {
        const a = leg.action
        if (a.kind === 'goto' && a.url !== undefined) await page.goto(appUrl + a.url)
        else if (a.kind === 'click' && a.locator !== undefined) await runLocator(page, a.locator, 'click')
        else if (a.kind === 'fill' && a.locator !== undefined) await runLocator(page, a.locator, 'fill', a.value ?? '')
        for (const as of leg.assertions) {
          if (as.kind === 'url') lastUrlAssertion = appUrl + as.value
          if (as.kind === 'dialog') expectDialog = true
        }
      }
      let confirmed = true
      if (lastUrlAssertion !== undefined) confirmed = page.url() === lastUrlAssertion
      if (expectDialog) confirmed = confirmed && (await page.getByRole('dialog').count()) > 0
      return { confirmed }
    } finally {
      await browser.close()
    }
  }
}

/** The slice of the Playwright Browser/Context API the driver uses (typed loosely; playwright-core is optional). */
interface PwBrowser {
  newContext: (opts?: unknown) => Promise<PwContext>
  close: () => Promise<void>
}
interface PwContext {
  newPage: () => Promise<PwPage>
}

/** The slice of the Playwright Page API the driver uses (typed loosely; playwright-core is optional). */
interface PwLocator {
  click: (o?: unknown) => Promise<void>
  fill: (v: string, o?: unknown) => Promise<void>
  count: () => Promise<number>
}
interface PwPage {
  goto: (url: string) => Promise<unknown>
  url: () => string
  getByRole: (role: string) => PwLocator
}

/** Evaluate a `page.getBy…`-style locator snippet against the page, then click/fill it. */
async function runLocator(page: PwPage, locator: string, action: 'click' | 'fill', value = ''): Promise<void> {
  const expr = locator.replace(/^page\./, '')
  const loc = new Function('page', `return page.${expr}`)(page) as PwLocator
  if (action === 'click') await loc.click({ timeout: 5000 })
  else await loc.fill(value, { timeout: 5000 })
}
