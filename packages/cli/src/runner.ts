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
import { buildSpecPlan, fnv1a, nextToVerify, nodeForUrl, planPath } from '@uigraph/core'
import { openStore } from '@uigraph/core/node'
import { dbPath, loadMergedGraph, reportObservation, getLoopStatus, updateGraph } from '@uigraph/mcp'

/** The outcome of attempting one planned transition in a real browser. `landedUrl` is populated only in capture mode (dynamic-sink targets). */
export interface VerifyResult {
  confirmed: boolean
  screenshot?: string
  landedUrl?: string
}

/** Drives one spec plan against the app. In capture mode it does not assert a URL — it drives the nav out of `from` and reports where the browser actually landed. */
export type VerifyDriver = (plan: SpecPlan, appUrl: string, opts?: { capture?: boolean }) => Promise<VerifyResult>

/** Options for runVerify: workspace dir, the app's base URL, a cap, an optional driver, and an optional saved auth session. */
export interface RunVerifyOptions {
  dir: string
  appUrl: string
  limit?: number
  driver?: VerifyDriver
  storageState?: string
}

/** What a verification run did. resolvedDynamic/discoveredNodes/parkedDynamic break out the dynamic-sink resolution. */
export interface VerifySummary {
  attempted: number
  confirmed: number
  refuted: number
  resolvedDynamic: number
  discoveredNodes: number
  parkedDynamic: number
}

/**
 * Run the Tier-3 loop: for each worklist target, plan a path, drive the app, and
 * record the observation. Confirmed observations become runtime-witnessed edges on
 * the next graph read. Returns a summary.
 */
export async function runVerify(opts: RunVerifyOptions): Promise<VerifySummary> {
  const ctx = { dir: opts.dir }
  let graph = loadMergedGraph(ctx)
  const store = openStore(dbPath(ctx))
  const proposalGraph = store.getProposalGraph()
  const parkedIds = new Set(store.getParkedEdges().map((p) => p.edgeId))
  store.close()

  const targets = nextToVerify(graph, proposalGraph, opts.limit, parkedIds)
  // When we build the default driver we own its browser and must dispose it after
  // the run; an injected driver brings its own lifecycle, so there is nothing to close.
  const owned = opts.driver === undefined ? makePlaywrightDriver(opts.storageState) : null
  const driver = opts.driver ?? owned!.driver
  const authed = opts.storageState !== undefined
  let confirmed = 0
  let refuted = 0
  let resolvedDynamic = 0
  let discoveredNodes = 0
  let parkedDynamic = 0

  try {
  for (const t of targets) {
    const steps = planPath(graph, t.from, t.to)
    if (steps === null) continue
    const plan = buildSpecPlan(graph, steps, { baseUrl: opts.appUrl, title: `verify ${t.from} → ${t.to}` })
    const toKind = graph.nodes.find((n) => n.id === t.to)?.kind

    // Dynamic-sink target (u_<screen>): CAPTURE the real landing instead of asserting a URL.
    if (toKind === 'unknown') {
      let result: VerifyResult
      try {
        result = await driver(plan, opts.appUrl, { capture: true })
      } catch {
        result = { confirmed: false }
      }
      const park = (reason: string): void => {
        const s = openStore(dbPath(ctx))
        try {
          s.parkEdge(t.id, reason, 'runner')
        } finally {
          s.close()
        }
        parkedDynamic++
      }
      if (!result.confirmed || result.landedUrl === undefined) {
        park('dynamic nav did not fire on drive (no URL change) — needs runtime state/precondition')
        continue
      }
      let realNode = nodeForUrl(graph, result.landedUrl, opts.appUrl)
      // H5: an unauthenticated bounce to a login/auth route is NOT the dynamic target.
      if (realNode !== null && !authed && /login|signin|sign-in|auth/i.test(graph.nodes.find((n) => n.id === realNode)?.route ?? '')) {
        park('landed on an auth route while unauthenticated — likely a guard bounce, not the dynamic target')
        continue
      }
      // H8: an undeclared same-origin landing is a real screen the static pass missed — add it honestly, then mint.
      if (realNode === null) {
        const path = result.landedUrl.startsWith(opts.appUrl) ? (result.landedUrl.slice(opts.appUrl.length).split('?')[0]?.split('#')[0] ?? '') : ''
        if (path === '' || /login|signin|sign-in|auth|error|404/i.test(path)) {
          park(`landed on an unattributable/external/auth URL (${result.landedUrl}) — not minting`)
          continue
        }
        const newId = `n_observed_${fnv1a(path).slice(0, 8)}`
        updateGraph(ctx, { op: { kind: 'addNode', node: { id: newId, route: path.startsWith('/') ? path : `/${path}`, componentPath: null, label: `observed ${path}`, kind: 'screen' } } })
        graph = loadMergedGraph(ctx)
        realNode = newId
        discoveredNodes++
      }
      const res = reportObservation(ctx, { from: t.from, to: realNode, event: t.event, outcome: 'confirmed', effect: 'navigate', ...(result.screenshot ? { screenshot: result.screenshot } : {}) })
      if (res.dropped) {
        park('observed landing could not be attributed (dropped)')
        continue
      }
      resolvedDynamic++
      confirmed++
      continue
    }

    // Normal assert-mode target (may edge / proposal).
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
  } finally {
    if (owned !== null) await owned.dispose()
  }

  return { attempted: targets.length, confirmed, refuted, resolvedDynamic, discoveredNodes, parkedDynamic }
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
 * Run the driver's plan against an already-open page and judge the outcome. Split
 * out from makePlaywrightDriver so the soundness-critical confirmation logic can be
 * unit-tested with a fake page (no real browser): a parked leg never confirms, and
 * URL-assert only fires for the legs codegen deemed safe (direct-nav / control-driven).
 *
 * In CAPTURE mode (dynamic-sink targets): do NOT assert a URL and NEVER goto the
 * synthetic sink. Capture the pre-trigger URL, run only the real interaction legs
 * (clicks/fills) as the trigger, then wait for the URL to change (beating
 * page-load/timer redirects) and settle, and report where it landed.
 */
async function drivePlan(page: PwPage, plan: SpecPlan, appUrl: string, opts?: { capture?: boolean }): Promise<VerifyResult> {
  await page.goto(plan.startUrl.startsWith('http') ? plan.startUrl : appUrl + plan.startUrl)

  if (opts?.capture === true) {
    await page.waitForLoadState('networkidle').catch(() => {})
    // H9: anchor the start URL immediately before the trigger, after the screen settled.
    const startUrl = page.url()
    for (const leg of plan.legs) {
      const a = leg.action
      // H1: never goto the synthetic sink; only run real interaction legs as the trigger.
      if (a.kind === 'click' && a.locator !== undefined) await runLocator(page, a.locator, 'click')
      else if (a.kind === 'fill' && a.locator !== undefined) await runLocator(page, a.locator, 'fill', a.value ?? '')
    }
    // H3: wait long enough to observe a timer/async redirect (>5s); H4: then settle to a stable URL.
    await page.waitForURL((u) => u.toString() !== startUrl, { timeout: 6500 }).catch(() => {})
    let landedUrl = page.url()
    for (let i = 0; i < 5; i++) {
      await page.waitForLoadState('networkidle').catch(() => {})
      const next = page.url()
      if (next === landedUrl) break
      landedUrl = next
    }
    return { confirmed: landedUrl !== startUrl, landedUrl }
  }

  let lastUrlAssertion: string | undefined
  let expectDialog = false
  // Soundness: a parked leg is an interaction-triggered/guarded screen→screen nav
  // with no drivable control — codegen refuses to emit goto+URL-assert for it, so
  // the driver must NOT witness it; it stays asserted/llm-verified until truly driven.
  let parked = false
  for (const leg of plan.legs) {
    const a = leg.action
    if (a.kind === 'parked') parked = true
    else if (a.kind === 'goto' && a.url !== undefined) await page.goto(appUrl + a.url)
    else if (a.kind === 'click' && a.locator !== undefined) await runLocator(page, a.locator, 'click')
    else if (a.kind === 'fill' && a.locator !== undefined) await runLocator(page, a.locator, 'fill', a.value ?? '')
    for (const as of leg.assertions) {
      if (as.kind === 'url') lastUrlAssertion = appUrl + as.value
      if (as.kind === 'dialog') expectDialog = true
    }
  }
  if (parked) return { confirmed: false }
  let confirmed = true
  if (lastUrlAssertion !== undefined) confirmed = page.url() === lastUrlAssertion
  if (expectDialog) confirmed = confirmed && (await page.getByRole('dialog').count()) > 0
  return { confirmed }
}

/** A driver paired with the teardown for the browser it owns. dispose is idempotent and a no-op if no browser was ever launched. */
export interface OwnedDriver {
  driver: VerifyDriver
  dispose: () => Promise<void>
}

/**
 * Build the default driver: launch Chromium (playwright-core) ONCE per run and open
 * a single context (optionally hydrated from a saved auth `storageState` so the run
 * is logged in), both reused across every planned edge to avoid a per-edge launch
 * cost. The browser/context are created lazily on the first driver call; each call
 * opens a fresh page, drives the plan via drivePlan, and closes that page. The caller
 * must invoke `dispose` after the run to close the shared browser.
 */
function makePlaywrightDriver(storageState?: string): OwnedDriver {
  let browser: PwBrowser | null = null
  let context: PwContext | null = null
  const driver: VerifyDriver = async (plan: SpecPlan, appUrl: string, opts?: { capture?: boolean }): Promise<VerifyResult> => {
    if (context === null) {
      const { chromium } = await loadPlaywright()
      browser = (await chromium.launch()) as PwBrowser
      context = await browser.newContext(storageState !== undefined ? { storageState } : {})
    }
    const page = await context.newPage()
    try {
      return await drivePlan(page, plan, appUrl, opts)
    } finally {
      await page.close()
    }
  }
  const dispose = async (): Promise<void> => {
    if (browser !== null) {
      await browser.close()
      browser = null
      context = null
    }
  }
  return { driver, dispose }
}

export { drivePlan, makePlaywrightDriver }

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
  waitForLoadState: (state: string) => Promise<void>
  waitForURL: (predicate: (url: URL) => boolean, opts?: unknown) => Promise<void>
  close: () => Promise<void>
}

/** Evaluate a `page.getBy…`-style locator snippet against the page, then click/fill it. */
async function runLocator(page: PwPage, locator: string, action: 'click' | 'fill', value = ''): Promise<void> {
  const expr = locator.replace(/^page\./, '')
  const loc = new Function('page', `return page.${expr}`)(page) as PwLocator
  if (action === 'click') await loc.click({ timeout: 5000 })
  else await loc.fill(value, { timeout: 5000 })
}
