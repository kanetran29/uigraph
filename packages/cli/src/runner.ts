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

import type { Evidence, SpecPlan, UiGraph, VerifyTarget } from '@ui-graph/core'
import { buildSpecPlan, dedupWorklist, DOM_DELTA_WATCHED_ATTRS, fnv1a, locatorFor, nextToVerify, nodeForUrl, patternKey, PATTERN_PARK_REASON_PREFIX, planForTarget } from '@ui-graph/core'
import { openStore } from '@ui-graph/core/node'
import { dbPath, loadMergedGraph, reportObservation, getLoopStatus, updateGraph } from '@ui-graph/mcp'

/** The outcome of attempting one planned transition in a real browser. `landedUrl` is populated only in capture mode (dynamic-sink targets); `evidence` is the structured proof the proof-gated report_observation requires for a confirmation. `undrivable` means the plan had no drivable action (a parked leg) — the transition was NEVER attempted, so it must not be recorded as refuted. `undrivableReason` is the driver's diagnosis of WHY, when it has one (e.g. a modal-like element appeared but exposes no role=dialog) — folded into VerifySummary.diagnoses and appended to autonomous park reasons so the human triaging sees the app-side fix. */
export interface VerifyResult {
  confirmed: boolean
  screenshot?: string
  landedUrl?: string
  evidence?: Evidence
  undrivable?: boolean
  undrivableReason?: string
}

/**
 * An exploratory probe: when the direct plan cannot drive a transition, load the
 * source screen and try to reveal + trigger it — click the target control if it
 * has one (clicking sibling controls first to open modals/disclosures that hide
 * it), or click each sibling watching for the expected landing (state-driven
 * navs whose trigger control the extractor could not link). `domDelta` marks a
 * dom-delta-asserted target (a same-screen state control, often CSS-hidden until
 * a sibling toggle reveals it): the probe judges by an attribute delta on the
 * target control instead of by URL — `expectedRoute` is then the start route,
 * which every click must stay on for an attempt to count.
 */
export interface ProbeSpec {
  startUrl: string
  expectedRoute: string
  targetLocator?: string
  siblingLocators: string[]
  domDelta?: boolean
}

/** Drives one spec plan against the app. In capture mode it does not assert a URL — it drives the nav out of `from` and reports where the browser actually landed. With `probe`, runs the exploratory probe instead of the plan. `modalSelector` is the app owner's declared modal CSS selector (rung 2 of the dialog evidence ladder). */
export type VerifyDriver = (plan: SpecPlan, appUrl: string, opts?: { capture?: boolean; probe?: ProbeSpec; modalSelector?: string; authed?: boolean }) => Promise<VerifyResult>

/** Options for runVerify: workspace dir, the app's base URL, a cap, an optional driver, an optional saved auth session, and the verify-all sweep (drive must-static proofs too). `concurrency` is the parallel-driver pool width (default 8, capped 16); `patternSample` is how many representatives to drive per over-approximation pattern (default 1); `modalSelector` is the workspace-declared CSS selector for apps that render modals without role=dialog (rung 2 of the dialog evidence ladder). */
export interface RunVerifyOptions {
  dir: string
  appUrl: string
  limit?: number
  driver?: VerifyDriver
  storageState?: string
  includeProven?: boolean
  includeRefuted?: boolean
  concurrency?: number
  patternSample?: number
  modalSelector?: string
}

/** How one worklist target ended this pass: confirmed (drove and landed), refuted (drove, did not land), undrivable (no drivable control/plan ever reached it — never attempted), or rejected (drove and landed but the proof gate refused the evidence — nothing persisted). */
export type TargetOutcome = 'confirmed' | 'refuted' | 'undrivable' | 'rejected'

/** What a verification run did. resolvedDynamic/discoveredNodes/parkedDynamic break out the dynamic-sink resolution; refutedProven counts refutations of must-static edges — each one means the extraction and the running app DISAGREE and must be investigated. `outcomes` is the per-target diagnosis (keyed by target id) so the until-done loop can park an exhausted target with a reason that says WHY it never closed; `diagnoses` carries per-target detail (same key): the driver's undrivableReason when it had one, else the fold's own nth-hidden-sibling diagnosis, so the park reason can name the app-side fix. */
export interface VerifySummary {
  attempted: number
  confirmed: number
  refuted: number
  refutedProven: number
  rejected: number
  resolvedDynamic: number
  discoveredNodes: number
  parkedDynamic: number
  patternParked: number
  outcomes: Record<string, TargetOutcome>
  diagnoses: Record<string, string>
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

  const allTargets = nextToVerify(graph, proposalGraph, opts.limit, parkedIds, { includeProven: opts.includeProven === true, includeRefuted: opts.includeRefuted === true })
  // Collapse the over-approximation fan-out: drive one representative per source-nav
  // pattern; the duplicates are never driven (they are parked after the representative
  // is confirmed). This is the big-app speedup — 7000+ may-edges become a few hundred.
  const { representatives, duplicates } = dedupWorklist(graph, allTargets, opts.patternSample ?? 1)

  // When we build the default driver we own its browser and must dispose it after
  // the run; an injected driver brings its own lifecycle, so there is nothing to close.
  const owned = opts.driver === undefined ? makePlaywrightDriver(opts.storageState, opts.modalSelector) : null
  const driver = opts.driver ?? owned!.driver
  const authed = opts.storageState !== undefined
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 16))
  let confirmed = 0
  let refuted = 0
  let refutedProven = 0
  let rejected = 0
  let resolvedDynamic = 0
  let discoveredNodes = 0
  let parkedDynamic = 0
  const outcomes: Record<string, TargetOutcome> = {}
  const diagnoses: Record<string, string> = {}
  // Pattern keys whose representative confirmed (→ its duplicates may be parked) or
  // refuted/undrivable (→ its duplicates stay OPEN, never falsely credited).
  const confirmedKeys = new Map<string, string>()
  const refutedKeys = new Set<string>()

  // Dynamic-sink targets mutate the graph (addNode) and must stay serial; every other
  // target is a pure drive that parallelizes.
  const isDynamic = (t: VerifyTarget): boolean => graph.nodes.find((n) => n.id === t.to)?.kind === 'unknown'
  const simple = representatives.filter((t) => !isDynamic(t))
  const dynamic = representatives.filter(isDynamic)

  try {
    // STAGE 1 — drive the simple targets CONCURRENTLY. Pure: no DB writes, reads only the
    // frozen graph snapshot; results are collected by input index for a deterministic fold.
    const results = await mapPool(simple, concurrency, (t) => attemptSimple(driver, graph, t, opts.appUrl, opts.modalSelector, authed))

    // STAGE 2 — fold the results SERIALLY (the only SQLite writer), in worklist-rank order.
    for (let i = 0; i < simple.length; i++) {
      const t = simple[i]!
      const result = results[i]
      // no plannable path is the same diagnosis as an undrivable plan: nothing ever reached it
      if (result === null || result === undefined) {
        outcomes[t.id] = 'undrivable'
        continue
      }
      // an undrivable plan was never attempted: refuting it would be a false negative
      if (result.undrivable === true) {
        outcomes[t.id] = 'undrivable'
        const diag = result.undrivableReason ?? nthHiddenSiblingDiagnosis(graph, t, outcomes)
        if (diag !== undefined) diagnoses[t.id] = diag
        continue
      }
      const res = reportObservation(ctx, {
        from: t.from,
        to: t.to,
        event: t.event,
        outcome: result.confirmed ? 'confirmed' : 'refuted',
        reportedBy: 'runner',
        ...(t.proposalIds && t.proposalIds.length > 0 ? { proposalId: t.proposalIds[0] } : {}),
        ...(result.evidence ? { evidence: result.evidence } : {}),
        ...(result.screenshot ? { screenshot: result.screenshot } : {}),
      })
      // A proof-gate rejection persisted NOTHING — counting it as confirmed would
      // report progress that has no witness. Surface it as rejected instead.
      if ('error' in res) {
        rejected++
        outcomes[t.id] = 'rejected'
        continue
      }
      const k = patternKey(graph, t)
      if (result.confirmed) {
        confirmed++
        outcomes[t.id] = 'confirmed'
        if (k !== null) confirmedKeys.set(k, `${t.from}->${t.to}`)
      } else {
        refuted++
        outcomes[t.id] = 'refuted'
        if (t.proven === true) refutedProven++
        if (k !== null) refutedKeys.add(k)
      }
    }

    // STAGE 3 — dynamic-sink targets SERIALLY (each may updateGraph + reload, order-sensitive).
    for (const t of dynamic) {
      const steps = planForTarget(graph, t.from, t.to)
      if (steps === null) {
        outcomes[t.id] = 'undrivable'
        continue
      }
      const plan = buildSpecPlan(graph, steps, { baseUrl: opts.appUrl, modalSelector: opts.modalSelector, title: `verify ${t.from} → ${t.to}` })
      // Dynamic-sink target (u_<screen>): CAPTURE the real landing instead of asserting a URL.
      let result: VerifyResult
      try {
        result = await driver(plan, opts.appUrl, { capture: true, modalSelector: opts.modalSelector, authed })
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
        // a parked dynamic sink was never resolved to a real landing — undrivable diagnosis
        outcomes[t.id] = 'undrivable'
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
      const res = reportObservation(ctx, {
        from: t.from,
        to: realNode,
        event: t.event,
        outcome: 'confirmed',
        effect: 'navigate',
        reportedBy: 'runner',
        ...(result.evidence ? { evidence: result.evidence } : {}),
        ...(result.screenshot ? { screenshot: result.screenshot } : {}),
      })
      if ('error' in res) {
        park(`confirmation rejected by the proof gate: ${res.error}`)
        continue
      }
      if (res.dropped) {
        park('observed landing could not be attributed (dropped)')
        continue
      }
      resolvedDynamic++
      confirmed++
      outcomes[t.id] = 'confirmed'
    }
  } finally {
    if (owned !== null) await owned.dispose()
  }

  // STAGE 4 — park the duplicates of every CONFIRMED (and not-also-refuted) pattern, in a
  // single batch write. A duplicate is parked (accounted), never minted as runtime — the
  // reason points at the real runtime-witnessed representative so it stays auditable.
  let patternParked = 0
  const toPark: { edgeId: string; reason: string }[] = []
  for (const [key, dups] of duplicates) {
    if (!confirmedKeys.has(key) || refutedKeys.has(key)) continue
    const rep = confirmedKeys.get(key) as string
    for (const d of dups) {
      toPark.push({ edgeId: d.id, reason: `${PATTERN_PARK_REASON_PREFIX}${key} — representative ${rep} runtime-witnessed; this target not individually driven` })
    }
  }
  if (toPark.length > 0) {
    const s = openStore(dbPath(ctx))
    try {
      patternParked = s.parkEdges(toPark, 'runner')
    } finally {
      s.close()
    }
  }

  return { attempted: representatives.length, confirmed, refuted, refutedProven, rejected, resolvedDynamic, discoveredNodes, parkedDynamic, patternParked, outcomes, diagnoses }
}

/** A bounded-concurrency pool: run `worker` over `items` with at most `concurrency`
 *  in flight, writing each result into its INPUT index so the caller can fold results
 *  in worklist order regardless of which worker finished first. */
async function mapPool<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i] as T, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}

/**
 * Drive ONE non-dynamic target and return its result — no DB access, so it is safe to
 * run concurrently. Plans the path via planForTarget (anchored start: an un-routed from,
 * e.g. a control inside a modal, gets the opener prefix that drives the modal open),
 * drives the plan (with the workspace `modalSelector` for the dialog evidence ladder),
 * and on failure runs the exploratory probe before judging (an undrivable-after-probe
 * result is still undrivable). Returns null when there is no path to plan (nothing to fold).
 */
async function attemptSimple(driver: VerifyDriver, graph: UiGraph, t: VerifyTarget, appUrl: string, modalSelector?: string, authed?: boolean): Promise<VerifyResult | null> {
  const steps = planForTarget(graph, t.from, t.to)
  if (steps === null) return null
  const plan = buildSpecPlan(graph, steps, { baseUrl: appUrl, modalSelector, title: `verify ${t.from} → ${t.to}` })
  let result: VerifyResult
  try {
    result = await driver(plan, appUrl, { modalSelector, authed })
  } catch {
    // A drive that THREW observed nothing — page.goto refused (server down),
    // browser crash, protocol error. Refuting would poison the log with
    // disagreements the app never expressed; the target was never attempted.
    result = { confirmed: false, undrivable: true, undrivableReason: 'drive crashed before observing the app (navigation/browser error) — check the app server' }
  }
  if (!result.confirmed) {
    // A dialog-close target is same-path by construction: the probe's URL evidence
    // cannot apply, and its same-path guard would launder an honest close
    // refutation into undrivable. The drive's own verdict stands. A dom-delta
    // final IS probeable: the probe judges it by attribute delta, not by URL.
    const finalLeg = plan.legs[plan.legs.length - 1]
    if (finalLeg?.assertions.some((as) => as.kind === 'dialog-close')) return result
    const domDelta = finalLeg?.assertions.some((as) => as.kind === 'dom-delta') === true
    const probe = buildProbeSpec(graph, t, domDelta)
    if (probe !== null) {
      let probed: VerifyResult
      try {
        probed = await driver(plan, appUrl, { probe, modalSelector, authed })
      } catch {
        probed = { confirmed: false }
      }
      if (probed.confirmed) result = probed
      // When BOTH are undrivable, keep the one carrying a diagnosis. A drive
      // REFUTATION is a real verdict — the probe may never overwrite it with a
      // shrug (the locator-miss=undrivable rule in drivePlan already covers the
      // absent-control case this override once existed for).
      else if (probed.undrivable === true && result.undrivable === true && result.undrivableReason === undefined && probed.undrivableReason !== undefined) result = probed
    }
  }
  return result
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
  // each target's LAST per-pass diagnosis, so a round-cap park can say WHY it never closed
  const lastOutcome = new Map<string, TargetOutcome>()
  const lastDiagnosis = new Map<string, string>()
  let rounds = 0
  let confirmed = 0
  let parkedEdges = 0
  let parkedProposals = 0

  for (; rounds < maxRounds; rounds++) {
    if (getLoopStatus(ctx).loopDone) break
    const attempted = attemptedThisRound(ctx, opts.limit)
    const pass = await runVerify(opts)
    confirmed += pass.confirmed
    // A later diagnosis-free outcome must CLEAR a stale diagnosis — appending a
    // round-1 a11y hint to a round-2 honest refutation would be self-contradictory.
    for (const [id, o] of Object.entries(pass.outcomes)) {
      lastOutcome.set(id, o)
      const d = pass.diagnoses[id]
      if (d !== undefined) lastDiagnosis.set(id, d)
      else lastDiagnosis.delete(id)
    }
    // bump attempts ONLY for targets this round could actually try (the ranked
    // worklist slice under the limit); park targets that exhausted their tries
    const status = getLoopStatus(ctx)
    const store = openStore(dbPath(ctx))
    try {
      for (const e of status.openEdges) {
        if (!attempted.has(e.id)) continue
        const n = (tries.get(e.id) ?? 0) + 1
        tries.set(e.id, n)
        if (n >= parkTries) {
          store.parkEdge(e.id, capParkReason(lastOutcome.get(e.id), n, lastDiagnosis.get(e.id)), 'runner')
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
        const last = lastOutcome.get(e.id)
        const diag = lastDiagnosis.get(e.id)
        store.parkEdge(e.id, `autonomous: parked at round cap for human review${last !== undefined ? ` — last outcome: ${last}` : ''}${diag !== undefined ? ` — ${diag}` : ''}`, 'runner')
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

/**
 * The auditable reason for a park at the attempt cap, carrying the target's last
 * observed diagnosis: undrivable (nothing ever reached it) reads very differently
 * from refuted (driven but did not land) or rejected (landed but the proof gate
 * refused the evidence) to the human triaging the parked list. Coverage's classify
 * keys pattern parks off PATTERN_PARK_REASON_PREFIX only; the parked CLI groups
 * runner give-ups by the recorded `by` field — nothing parses these strings, they
 * exist for the human. A target never in a processed slice keeps the generic wording.
 * `detail` is the driver's own diagnosis (VerifyResult.undrivableReason, e.g. the
 * dialog ladder's a11y-gap finding) — appended so the park reason names the app-side fix.
 */
function capParkReason(last: TargetOutcome | undefined, n: number, detail?: string): string {
  const base =
    last === 'undrivable' ? `autonomous: undrivable after ${n} attempts — no drivable control/plan reached it`
    : last === 'refuted' ? `autonomous: unstable after ${n} attempts — driven but refuted (did not land)`
    : last === 'rejected' ? `autonomous: proof-rejected after ${n} attempts — driven and landed but the confirmation lacked admissible evidence`
    : `autonomous: unreachable/undrivable after ${n} attempts`
  return detail !== undefined ? `${base} — ${detail}` : base
}

/**
 * Diagnose an undrivable target whose plan-final locator is nth-indexed (the
 * extractor disambiguated duplicate same-name siblings on one screen with
 * `.nth(k)`): the k-th instance exists in the DOM count but is not interactable
 * in the driven app state — typically the mobile-menu twin of a desktop control.
 * When a same-selector sibling on the same screen IS runtime-witnessed for the
 * same target (fresh in the graph, or confirmed earlier in this pass), the
 * diagnosis says so: the transition has a witness, only this rendered instance
 * does not. These siblings come from DISTINCT call sites, so patternKey /
 * dedupWorklist can never fold them — this diagnosis is where their kinship
 * surfaces instead. Returns undefined for nth-free targets (generic wording
 * stands) — and never claims sibling coverage without an actual witness.
 */
function nthHiddenSiblingDiagnosis(graph: UiGraph, t: VerifyTarget, outcomes: Record<string, TargetOutcome>): string | undefined {
  const fromNode = graph.nodes.find((n) => n.id === t.from)
  const sel = fromNode?.control?.selector
  if (fromNode === undefined || sel?.nth === undefined || sel.nth <= 0) return undefined
  const witnessed = graph.edges.find((e) => {
    if (e.to !== t.to || e.from === t.from) return false
    const sib = graph.nodes.find((n) => n.id === e.from)
    const s2 = sib?.control?.selector
    if (sib?.parent !== fromNode.parent || s2 === undefined || s2.strategy !== sel.strategy || s2.value !== sel.value) return false
    return (e.source === 'runtime' && e.witnessStale !== true) || outcomes[e.id] === 'confirmed'
  })
  const head = `nth-indexed sibling instance (.nth(${sel.nth})) not interactable in this app state`
  return witnessed !== undefined
    ? `${head} — pattern covered by its driven sibling ${witnessed.from}->${witnessed.to}`
    : `${head} — no sibling instance runtime-witnessed; needs the app state that renders it`
}

/**
 * Build the exploratory probe for a target, or null when the probe has nothing
 * to work with: the source screen (the control's parent, or the from node
 * itself) must have a concrete loadable route and the target a route to watch
 * for. Sibling locators are the screen's other extracted controls (bounded) —
 * the probe clicks them to reveal modals/disclosures or to fire state-driven
 * navigations the extractor saw but could not link to a control. Siblings whose
 * edges carry a state:* SELF-LOOP effect (a disclosure/reveal toggle, e.g. the
 * "Start exploring" click that expands the hidden map UI) rank AHEAD of
 * positional siblings: on a control-heavy screen the bounded sweep otherwise
 * never reaches the one control that can reveal a hidden target.
 *
 * `domDelta` (the target leg carries a dom-delta assertion — a same-screen state
 * control, often CSS-hidden until a sibling toggle reveals it) changes the
 * requirements: the target's locator is mandatory (it is what gets clicked and
 * watched), the target needs no route (judgment is the attribute delta, so
 * expectedRoute is the start route the URL must stay on), and the sibling list
 * is the same reveal-prioritized ranking.
 */
function buildProbeSpec(graph: UiGraph, t: VerifyTarget, domDelta: boolean): ProbeSpec | null {
  const from = graph.nodes.find((n) => n.id === t.from)
  if (from === undefined) return null
  const screen = from.kind === 'control' && from.parent !== undefined ? graph.nodes.find((n) => n.id === from.parent) : from
  if (screen === undefined || screen.route === null || screen.route.includes(':') || screen.route.includes('*')) return null
  const targetLocator = from.kind === 'control' && from.control?.selector ? locatorFor(from.control.selector) : undefined
  if (domDelta && targetLocator === undefined) return null
  let expectedRoute = screen.route
  if (!domDelta) {
    const to = graph.nodes.find((n) => n.id === t.to)
    if (to === undefined || to.route === null || to.route.includes('*')) return null
    expectedRoute = to.route
  }
  const siblings = graph.nodes.filter((n) => n.kind === 'control' && n.parent === screen.id && n.id !== from.id && n.control?.selector !== undefined)
  // Reveal-ish = a sibling whose click flips screen-level state (a menu/disclosure
  // toggle). Read from BOTH self-loop state edges AND the control's own effects —
  // fan-out narrowing intentionally stopped minting self-loop edges for descended
  // effect-only controls, so the edge signal alone would rank the toggle last and
  // the sibling cap would cut it.
  const revealish = new Set([
    ...graph.edges.filter((e) => e.to === screen.id && e.effect !== null && e.effect.includes('state:')).map((e) => e.from),
    ...siblings.filter((n) => (n.control?.effects ?? []).some((x) => x.startsWith('state:'))).map((n) => n.id),
  ])
  const siblingLocators = [...siblings.filter((n) => revealish.has(n.id)), ...siblings.filter((n) => !revealish.has(n.id))]
    .map((n) => locatorFor(n.control!.selector!))
    .slice(0, 8)
  if (targetLocator === undefined && siblingLocators.length === 0) return null
  return { startUrl: screen.route, expectedRoute, ...(targetLocator !== undefined ? { targetLocator } : {}), siblingLocators, ...(domDelta ? { domDelta: true } : {}) }
}

/**
 * The ids the next verify pass will actually attempt: the same ranked worklist
 * slice runVerify pulls (same ranking function, same limit), so the until-done
 * loop's retry accounting can never claim an attempt for a target the limit
 * excluded.
 */
function attemptedThisRound(ctx: { dir: string }, limit: number | undefined): Set<string> {
  const graph = loadMergedGraph(ctx)
  const store = openStore(dbPath(ctx))
  try {
    const targets = nextToVerify(graph, store.getProposalGraph(), limit, new Set(store.getParkedEdges().map((p) => p.edgeId)))
    return new Set(targets.map((t) => t.id))
  } finally {
    store.close()
  }
}

/** The optional playwright-core module, loaded via a variable specifier so a missing package is a runtime error, not a compile error. */
async function loadPlaywright(): Promise<{ chromium: { launch: (opts?: unknown) => Promise<unknown> } }> {
  const moduleName = 'playwright-core'
  try {
    return (await import(moduleName)) as { chromium: { launch: (opts?: unknown) => Promise<unknown> } }
  } catch {
    throw new Error('Tier-3 runner needs playwright-core: `pnpm add -w playwright-core` (a Chromium is already cached).')
  }
}

/** The slice of the browser API the manual-login flow uses (kept separate from the driver slices). */
export interface LoginBrowser {
  newContext: () => Promise<LoginContext>
  close: () => Promise<void>
}

/** The slice of the context API the manual-login flow uses: open a page, persist the session. */
export interface LoginContext {
  newPage: () => Promise<{ goto: (url: string) => Promise<unknown> }>
  storageState: (opts: { path: string }) => Promise<unknown>
}

/** Options for runLogin: app URL, output path, and injectable browser/prompt so the flow is testable without a real browser. */
export interface RunLoginOptions {
  appUrl: string
  out: string
  launcher?: () => Promise<LoginBrowser>
  waitForUser?: () => Promise<void>
}

/** Block until the user presses Enter on stdin (the "I have finished logging in" signal). */
function waitForEnter(message: string): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write(message)
    process.stdin.resume()
    process.stdin.once('data', () => {
      process.stdin.pause()
      resolve()
    })
  })
}

/**
 * Manual login capture: open a HEADED browser at the app, let the user log in
 * like a human (any auth scheme — password, OAuth, SSO, MFA — works, because a
 * human drives it), then persist the session as a Playwright storageState file
 * for authenticated `uigraph verify --storage-state` runs. The browser always
 * closes, even when saving fails.
 */
export async function runLogin(opts: RunLoginOptions): Promise<void> {
  const launch =
    opts.launcher ??
    (async (): Promise<LoginBrowser> => {
      const { chromium } = await loadPlaywright()
      return (await chromium.launch({ headless: false })) as LoginBrowser
    })
  const wait = opts.waitForUser ?? ((): Promise<void> => waitForEnter('Log in in the opened browser, then press Enter here to save the session… '))
  const browser = await launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(opts.appUrl)
    await wait()
    await context.storageState({ path: opts.out })
  } finally {
    await browser.close()
  }
}

/** Rung-3 heuristic: elements whose class NAMES them a modal/overlay. A delta on this can never confirm (class names are not a11y semantics) — it only distinguishes "something modal-like appeared" (undrivable, app a11y gap) from "nothing happened" (honest refutation). */
const MODAL_HEURISTIC_SELECTOR = '[class*="modal" i], [class*="overlay" i]'

/**
 * Count VISIBLE elements matching a CSS selector. Rungs 2/3 of the dialog ladder
 * must match rung 1's visibility semantics (getByRole excludes hidden elements):
 * a mounted-but-hidden modal (display:none toggle pattern) must neither confirm
 * rung 2 nor trip the rung-3 heuristic — only what the user can see counts.
 */
async function countVisibleModals(page: PwPage, selector: string): Promise<number> {
  return page.locator(selector).filter({ visible: true }).count()
}

/**
 * Poll a modal count until it RISES above `baseline` or the deadline passes.
 * Modal entrances animate/mount asynchronously just like exits — a single
 * synchronous read right after the opener click refutes every animated modal.
 */
async function pollForRise(count: () => Promise<number>, baseline: number, deadlineMs = 2000, stepMs = 100): Promise<boolean> {
  const start = Date.now()
  for (;;) {
    if ((await count()) > baseline) return true
    if (Date.now() - start >= deadlineMs) return false
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

/**
 * Poll a modal count until it drops below `baseline` or the deadline passes.
 * Modals with exit animations unmount 150-300ms after the closing click — judging
 * the count synchronously would refute every animated close. Bounded so a modal
 * that genuinely stays open still refutes within ~2s.
 */
async function pollForDrop(count: () => Promise<number>, baseline: number, deadlineMs = 2000, stepMs = 100): Promise<boolean> {
  const start = Date.now()
  for (;;) {
    if ((await count()) < baseline) return true
    if (Date.now() - start >= deadlineMs) return false
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

/**
 * Read the dom-delta watched attributes of a locator, in DOM_DELTA_WATCHED_ATTRS
 * order, with an absent attribute encoded as '' so snapshots compare as plain
 * strings (and a null→'' "change" can never mint invalid before===after evidence).
 */
async function readWatchedAttrs(loc: PwLocator): Promise<string[]> {
  const out: string[] = []
  for (const attr of DOM_DELTA_WATCHED_ATTRS) out.push((await loc.getAttribute(attr, { timeout: 5000 })) ?? '')
  return out
}

/**
 * Poll the clicked control's watched attrs until ANY differs from the pre-click
 * baseline or the deadline passes (state flips can land a frame or an animation
 * after the click — a synchronous read would miss every animated accordion).
 * Returns the FIRST differing attr (in watched order) with its before/after
 * values, or null when nothing changed within the bound. A read that throws
 * (element detached mid-poll) counts as no delta seen yet, never a crash.
 */
async function pollForAttrDelta(page: PwPage, locator: string, baseline: string[]): Promise<{ attr: string; before: string; after: string } | null> {
  const deadlineMs = 2000
  const stepMs = 100
  const start = Date.now()
  for (;;) {
    let now: string[] | null = null
    try {
      now = await readWatchedAttrs(resolveLocator(page, locator))
    } catch {
      now = null
    }
    if (now !== null) {
      const i = now.findIndex((v, j) => v !== baseline[j])
      if (i !== -1) return { attr: DOM_DELTA_WATCHED_ATTRS[i] as string, before: baseline[i] as string, after: now[i] as string }
    }
    if (Date.now() - start >= deadlineMs) return null
    await new Promise((r) => setTimeout(r, stepMs))
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
 *
 * Same-path assert (the plan's start screen IS the asserted target — an effect-only
 * self-loop, or any edge that returns to the screen it left from): the page never
 * has to move for the assertion to hold, so a broken click that fires without
 * triggering anything looks identical to one that correctly stayed put. Such a
 * match is therefore never confirmed — only undrivable (mirrors probePlan's own
 * same-path guard below) — while an unexpected departure still refutes normally,
 * since that IS real disagreement between the static claim and the running app.
 *
 * Dialog-asserted legs are judged by a 3-rung evidence ladder (first hit wins),
 * because many real apps render modals as bare divs with NO role=dialog and a
 * role-count-only proof falsely refutes a transition that visibly happened:
 *   1. role=dialog count delta > 0 → confirmed (deterministic a11y proof).
 *   2. the workspace-declared `modalSelector` count delta > 0 → confirmed — the
 *      app owner DECLARED what a modal is, so the delta is deterministic and the
 *      evidence detail names the selector for the audit trail.
 *   3. a generic modal/overlay class-heuristic count delta > 0 → NOT confirmed and
 *      NOT refuted: undrivable with an a11y-gap diagnosis (something modal-like
 *      appeared but cannot be witnessed deterministically).
 *   4. nothing rose → honest refutation.
 * All three baselines are snapshotted together, before the asserted leg's action.
 *
 * Dialog-CLOSE-asserted legs (a modal-inner control returning to the modal's host
 * screen — same-path, so URL evidence is impossible) are judged by the INVERTED
 * ladder on the same pre-action baselines: role=dialog count dropped → confirmed;
 * declared modalSelector count dropped → confirmed; both relevant baselines 0 →
 * undrivable (nothing was open to close — the opener prefix failed silently);
 * role baseline 0 with no declared selector → undrivable (a role-less modal's
 * closing cannot be witnessed); open-but-never-dropped → honest refutation. Such
 * a leg is exempt from the same-path undrivable escape: the drop IS the positive
 * evidence the URL cannot provide.
 *
 * DOM-DELTA-asserted legs (same-screen state self-loops — accordions, tab
 * switches, expanders — where neither URL nor dialog evidence exists): snapshot
 * the watched attrs (DOM_DELTA_WATCHED_ATTRS) of the clicked control BEFORE the
 * click, then poll (bounded) for ANY of them to differ. A delta confirms with
 * dom-delta evidence carrying the changed attr and its before/after values; no
 * delta is undrivable with a diagnosis, NEVER a refutation — the click may have
 * changed state the watched set cannot see. Exempt from the asserted-nothing
 * guard and the same-path escape, like dialog-close.
 */
/** The class-only dom-delta diagnosis, shared by the direct drive and the probe: styling churn is never state proof. */
const CLASS_ONLY_DELTA_REASON = 'only the class attribute changed — styling churn is not state proof (app a11y gap: expose aria-expanded/pressed/checked on this control)'

/**
 * Probe a dom-delta target: a same-screen state control (menu item, accordion)
 * that is often CSS-hidden until a sibling toggle (hamburger) reveals it — the
 * direct drive read it as a locator miss. For the direct try and each
 * reveal→retry, snapshot the TARGET control's watched attrs immediately before
 * clicking IT (never before the sibling click — the reveal must not pollute the
 * baseline), click, and poll for a delta. A non-class delta confirms with
 * dom-delta evidence; a class-only delta is undrivable with the a11y diagnosis;
 * no delta moves on to the next sibling; an exhausted sweep is undrivable. The
 * URL must stay on the start path throughout — an attempt where any click
 * navigated away is VOID: never a witness (the polled delta could be another
 * page's element) and never a refutation (a dom-delta judgment cannot refute).
 */
async function probeDomDelta(page: PwPage, spec: ProbeSpec, start: string): Promise<VerifyResult> {
  const target = spec.targetLocator
  if (target === undefined) return { confirmed: false, undrivable: true }
  // 'continue' = this attempt observed nothing; 'void' = a click left the start path.
  const attempt = async (sib?: string): Promise<VerifyResult | 'continue' | 'void'> => {
    await page.goto(start)
    await page.waitForLoadState('networkidle').catch(() => {})
    if (sib !== undefined) {
      await runLocator(page, sib, 'click').catch(() => {})
      // Settle before the baseline read: a reveal that mutates the TARGET's attrs
      // asynchronously (transition-end setState) must land BEFORE the snapshot,
      // or its effect would be attributed to the target click.
      await page.waitForLoadState('networkidle').catch(() => {})
      if (!samePath(page.url(), start)) return 'void'
    }
    let before: string[]
    try {
      before = await readWatchedAttrs(resolveLocator(page, target))
      await runLocator(page, target, 'click')
    } catch {
      // the target is (still) not rendered — it was never interacted with
      return 'continue'
    }
    const delta = await pollForAttrDelta(page, target, before)
    // Settle then RE-check the URL: a click that flips an attr synchronously while
    // a slower navigation is in flight would otherwise mint a false same-screen
    // witness for a control that actually departed.
    await page.waitForLoadState('networkidle').catch(() => {})
    if (!samePath(page.url(), start)) return 'void'
    if (delta === null) return 'continue'
    if (delta.attr === 'class') return { confirmed: false, undrivable: true, undrivableReason: CLASS_ONLY_DELTA_REASON }
    return { confirmed: true, evidence: { kind: 'dom-delta', locator: target, ...delta } }
  }
  const direct = await attempt()
  if (direct !== 'continue' && direct !== 'void') return direct
  for (const sib of spec.siblingLocators) {
    const r = await attempt(sib)
    if (r !== 'continue' && r !== 'void') return r
  }
  return { confirmed: false, undrivable: true }
}

/**
 * Run an exploratory probe on an open page: load the source screen, then (a) try
 * the target control directly, (b) click sibling controls to REVEAL it (modal /
 * disclosure) and retry, or (c) with no target control, click each sibling and
 * watch for the expected landing. Confirmation requires the URL to actually
 * reach the expected route — the evidence is the observed url-change. A
 * `domDelta` spec is judged by probeDomDelta instead: attribute delta on the
 * target control, with the URL required to STAY on the start path.
 */
async function probePlan(page: PwPage, spec: ProbeSpec, appUrl: string): Promise<VerifyResult> {
  const start = appUrl + spec.startUrl
  if (spec.domDelta === true) return probeDomDelta(page, spec, start)
  const expected = appUrl + spec.expectedRoute
  // Same-path target: URL evidence is impossible (any landing "matches" before the
  // interaction even runs), so the probe cannot legitimately confirm — undrivable.
  if (samePath(start, expected)) return { confirmed: false, undrivable: true }

  const landedAfter = async (fn: () => Promise<void>): Promise<string | null> => {
    await page.goto(start)
    await page.waitForLoadState('networkidle').catch(() => {})
    try {
      await fn()
    } catch {
      // the interaction failed — but a redirect-on-load may already have carried
      // us to the expected route (guard bounce), which is itself the transition
      const bounced = page.url()
      return samePath(bounced, expected) ? bounced : null
    }
    await page.waitForURL((u) => samePath(u.toString(), expected), { timeout: 2500 }).catch(() => {})
    const landed = page.url()
    return samePath(landed, expected) ? landed : null
  }

  if (spec.targetLocator !== undefined) {
    const direct = await landedAfter(async () => runLocator(page, spec.targetLocator as string, 'click'))
    if (direct !== null) return { confirmed: true, landedUrl: direct, evidence: { kind: 'url-change', startUrl: start, landedUrl: direct } }
    for (const sib of spec.siblingLocators) {
      // The reveal sibling must never itself deliver the landing: if its click
      // already put us on the expected route, the subsequent target-click throw
      // would let the guard-bounce catch credit the TARGET edge with the
      // SIBLING's navigation — a false witness. Flag and skip instead.
      let sibNavigated = false
      const revealed = await landedAfter(async () => {
        await runLocator(page, sib, 'click').catch(() => {})
        if (samePath(page.url(), expected)) {
          sibNavigated = true
          throw new Error('reveal sibling navigated — target attribution impossible')
        }
        await runLocator(page, spec.targetLocator as string, 'click')
      })
      if (sibNavigated) continue
      if (revealed !== null) return { confirmed: true, landedUrl: revealed, evidence: { kind: 'url-change', startUrl: start, landedUrl: revealed } }
    }
    return { confirmed: false }
  }

  for (const sib of spec.siblingLocators) {
    const landed = await landedAfter(async () => runLocator(page, sib, 'click'))
    if (landed !== null) return { confirmed: true, landedUrl: landed, evidence: { kind: 'url-change', startUrl: start, landedUrl: landed } }
  }
  return { confirmed: false }
}

async function drivePlan(page: PwPage, plan: SpecPlan, appUrl: string, opts?: { capture?: boolean; probe?: ProbeSpec; modalSelector?: string; authed?: boolean }): Promise<VerifyResult> {
  if (opts?.probe !== undefined) return probePlan(page, opts.probe, appUrl)
  const anchorUrl = plan.startUrl.startsWith('http') ? plan.startUrl : appUrl + plan.startUrl
  await page.goto(anchorUrl)
  // Settle before the first interaction (SPA boot, async geolocation/consent UI):
  // clicking into a half-booted app reads as a locator miss and false-undrivables
  // the whole plan. Capture mode already settles; assert mode must too.
  await page.waitForLoadState('networkidle').catch(() => {})

  if (opts?.capture === true) {
    await page.waitForLoadState('networkidle').catch(() => {})
    // Drive the PREFIX legs (modal openers etc.) first, then re-anchor: a prefix
    // URL side-effect (?modal=1, #modal, a route-based modal) must never count as
    // the dynamic nav — H9 anchors the start URL immediately before the trigger.
    const trigger = plan.legs[plan.legs.length - 1]
    if (trigger === undefined) return { confirmed: false, undrivable: true }
    for (const leg of plan.legs.slice(0, -1)) {
      if (leg.action.kind === 'parked') return { confirmed: false, undrivable: true }
      try {
        await runCaptureLegAction(page, leg)
      } catch {
        return { confirmed: false, undrivable: true }
      }
    }
    await page.waitForLoadState('networkidle').catch(() => {})
    const startUrl = page.url()
    if (trigger.action.kind === 'parked') return { confirmed: false, undrivable: true }
    try {
      await runCaptureLegAction(page, trigger)
    } catch {
      return { confirmed: false, undrivable: true }
    }
    // H3: wait long enough to observe a timer/async redirect (>5s); H4: then settle to
    // a stable URL. Moved = a real PATH change — a query/hash delta is modal state,
    // not a navigation.
    await page.waitForURL((u) => !samePath(u.toString(), startUrl), { timeout: 6500 }).catch(() => {})
    let landedUrl = page.url()
    for (let i = 0; i < 5; i++) {
      await page.waitForLoadState('networkidle').catch(() => {})
      const next = page.url()
      if (next === landedUrl) break
      landedUrl = next
    }
    const moved = !samePath(landedUrl, startUrl)
    return { confirmed: moved, landedUrl, ...(moved ? { evidence: { kind: 'url-change', startUrl, landedUrl } as Evidence } : {}) }
  }

  let lastUrlAssertion: string | undefined
  let expectDialog = false
  let expectDialogClose = false
  let expectDomDelta = false
  let domDeltaLocator: string | undefined
  let domDeltaBefore: string[] | undefined
  let dialogBaseline = 0
  let configModalBaseline = 0
  let heuristicBaseline = 0
  let requestEvidence: Evidence | undefined
  // Soundness: a parked leg is an interaction-triggered/guarded screen→screen nav
  // with no drivable control — codegen refuses to emit goto+URL-assert for it, so
  // the driver must NOT witness it; it stays asserted/llm-verified until truly driven.
  for (let i = 0; i < plan.legs.length; i++) {
    const leg = plan.legs[i]!
    const finalLeg = i === plan.legs.length - 1
    const a = leg.action
    // a parked leg means the rest of the plan cannot be legitimately driven —
    // bail before clicking controls on whatever page we happen to be on
    if (a.kind === 'parked') return { confirmed: false, undrivable: true }
    // Soundness: reset per-leg before this leg sets its own — the final judgment
    // must reflect ONLY the last leg driven, never an earlier leg's leftover
    // evidence (a multi-leg plan whose final leg carries no request assertion
    // must not ride on an earlier, unrelated leg's request proof).
    lastUrlAssertion = undefined
    expectDialog = false
    expectDialogClose = false
    expectDomDelta = false
    domDeltaLocator = undefined
    domDeltaBefore = undefined
    requestEvidence = undefined
    // Dialog proof is a DELTA — for open AND close legs alike: snapshot the
    // ladder baselines (role, plus config selector OR heuristic) BEFORE the
    // action so a pre-existing dialog/overlay (cookie/consent banner) can never
    // confirm an opener, and a close leg has the open-count its drop is judged
    // against. Counts are visible-only to match getByRole's semantics. An
    // invalid config selector fails LOUD as undrivable — swallowed, it would
    // mass-false-refute every dialog-asserted target.
    if (leg.assertions.some((as) => as.kind === 'dialog' || as.kind === 'dialog-close')) {
      dialogBaseline = await page.getByRole('dialog').count()
      if (opts?.modalSelector !== undefined) {
        try {
          configModalBaseline = await countVisibleModals(page, opts.modalSelector)
        } catch {
          return { confirmed: false, undrivable: true, undrivableReason: `modalSelector ${opts.modalSelector} is not a valid CSS selector — fix .uigraph/config.json or the --modal-selector flag` }
        }
      } else {
        heuristicBaseline = await countVisibleModals(page, MODAL_HEURISTIC_SELECTOR)
      }
    }
    // DOM-delta proof is a DELTA too: snapshot the watched attrs of the clicked
    // control BEFORE the action so the post-click poll has a baseline. A read that
    // throws means the control is not rendered — the interaction never ran, so the
    // target is undrivable, never refuted (same rule as a locator-miss click).
    if (a.locator !== undefined && leg.assertions.some((as) => as.kind === 'dom-delta')) {
      try {
        domDeltaLocator = a.locator
        domDeltaBefore = await readWatchedAttrs(resolveLocator(page, a.locator))
      } catch {
        return { confirmed: false, undrivable: true }
      }
    }
    // Arm each leg's request wait BEFORE firing its action — a fast response can land
    // before an await on the action returns, so the wait must already be listening.
    const reqAssertions = leg.assertions.filter((as): as is { kind: 'request'; value: string } => as.kind === 'request')
    const requestWaits = reqAssertions.map((as) => armRequestWait(page, as.value))
    if (a.kind === 'goto' && a.url !== undefined) await page.goto(appUrl + a.url)
    else if (a.kind === 'click' || a.kind === 'press' || a.kind === 'fill') {
      if (a.locator === undefined) continue
      // Locator-miss = the control is not rendered in this app state; the
      // interaction never ran, so this target is undrivable — never refuted.
      try {
        if (a.kind === 'click') await runLocator(page, a.locator, leg.event === 'submit' ? 'submit' : 'click')
        else if (a.kind === 'press') await runLocator(page, a.locator, 'press', a.key ?? 'Enter')
        else await runLocator(page, a.locator, 'fill', a.value ?? '')
      } catch {
        return { confirmed: false, undrivable: true }
      }
    }
    if (reqAssertions.length > 0) {
      const responses = await Promise.all(requestWaits)
      // A miss (no matching call) or an error status on the FINAL leg is real
      // disagreement — the action fired but its claimed effect did not soundly
      // happen. On a PREFIX leg it means the plan never delivered the target's
      // precondition: the target edge was never attempted, so undrivable, never
      // a refutation of an untried transition.
      if (responses.some((r) => r === null || r.status < 200 || r.status >= 400)) {
        return finalLeg ? { confirmed: false } : { confirmed: false, undrivable: true }
      }
      const last = responses[responses.length - 1] as { method: string; url: string; status: number }
      requestEvidence = { kind: 'request', ...last }
    }
    for (const as of leg.assertions) {
      if (as.kind === 'url') lastUrlAssertion = appUrl + as.value
      if (as.kind === 'dialog') expectDialog = true
      if (as.kind === 'dialog-close') expectDialogClose = true
      if (as.kind === 'dom-delta') expectDomDelta = true
    }
  }
  // a drive that asserted NOTHING cannot witness anything — never mint an evidence-free confirmation
  if (lastUrlAssertion === undefined && !expectDialog && !expectDialogClose && !expectDomDelta && requestEvidence === undefined) return { confirmed: false, undrivable: true }
  let confirmed = true
  if (lastUrlAssertion !== undefined) {
    // SPA navigations and post-await handlers land asynchronously: wait for the
    // expected URL (bounded) before judging, and compare PATHS — a landing that
    // differs only by query/hash (e.g. /products?sort=price) still satisfies an
    // asserted route of /products. Exact-string compare here caused false refutes.
    const expected = lastUrlAssertion
    await page.waitForURL((u) => samePath(u.toString(), expected), { timeout: 4000 }).catch(() => {})
    confirmed = samePath(page.url(), expected)
    // H5 for the assert path: an unauthenticated bounce to a login/auth route is a
    // guard bounce, not the app disagreeing — refuting it would let a misconfigured
    // anon run falsify (and demote) healthy authed edges.
    if (!confirmed && opts?.authed !== true && /login|signin|sign-in|auth/i.test(page.url())) {
      return { confirmed: false, undrivable: true, undrivableReason: 'landed on an auth route while unauthenticated — guard bounce, needs an authenticated session' }
    }
    // A same-path match is never positive evidence on its own — UNLESS a request
    // assertion already proved the effect fired (the carved exception: same-path
    // plans WITH a request assertion are drivable via the network call, not the
    // URL) or the leg asserts a dialog delta (open OR close — a close leg is
    // same-path BY CONSTRUCTION and the modal-count drop is its positive evidence).
    if (confirmed && samePath(anchorUrl, expected) && !expectDialog && !expectDialogClose && !expectDomDelta && requestEvidence === undefined) return { confirmed: false, undrivable: true }
  }
  let dialogDetail = 'dialog visible after drive'
  if (expectDialog && confirmed) {
    // The 3-rung evidence ladder (see the doc comment above): role delta, then the
    // declared modalSelector delta, then — ONLY when no selector is declared — the
    // heuristic delta (undrivable), else refute.
    if (!(await pollForRise(() => page.getByRole('dialog').count(), dialogBaseline))) {
      if (opts?.modalSelector !== undefined) {
        // A flat declared selector AFTER the bounded wait is AFFIRMATIVE evidence
        // the modal did not appear — refute; the heuristic must never mask it.
        // Mixed apps stay sound: a role=dialog RISE already confirmed above, the
        // declared selector is consulted only when the role count stayed flat.
        if (await pollForRise(() => countVisibleModals(page, opts.modalSelector as string), configModalBaseline)) {
          dialogDetail = `config modal selector ${opts.modalSelector} raised the modal count`
        } else {
          confirmed = false
        }
      } else if ((await countVisibleModals(page, MODAL_HEURISTIC_SELECTOR)) > heuristicBaseline) {
        return { confirmed: false, undrivable: true, undrivableReason: 'a modal-like element appeared but exposes no role=dialog — cannot witness deterministically (app a11y gap: add role="dialog"/aria-modal, or declare modalSelector in the workspace config)' }
      } else {
        confirmed = false
      }
    }
  }
  if (expectDialogClose && confirmed) {
    // The INVERTED ladder (see the doc comment above). When a modalSelector is
    // DECLARED it is the SOLE close witness: the app's modals are role-less by the
    // owner's own declaration, so any role=dialog drop is an unrelated dialog (a
    // consent banner dismissing on interaction) and must never confirm this close.
    // Exit animations unmount modals 150-300ms after the click, so each rung
    // POLLS for the drop (bounded) before falling through to refutation.
    if (opts?.modalSelector !== undefined) {
      const sel = opts.modalSelector
      if (await pollForDrop(() => countVisibleModals(page, sel), configModalBaseline)) {
        dialogDetail = `config modal selector ${sel} dropped the modal count (modal closed)`
      } else if (configModalBaseline === 0) {
        return { confirmed: false, undrivable: true, undrivableReason: 'modal was not open before the close interaction — opener prefix did not deliver the precondition' }
      } else {
        confirmed = false
      }
    } else if (dialogBaseline === 0) {
      return { confirmed: false, undrivable: true, undrivableReason: 'no open modal was witnessable before the close interaction — either the opener prefix failed to open it, or the modal exposes no role=dialog (declare modalSelector in the workspace config to witness role-less closes)' }
    } else if (await pollForDrop(() => page.getByRole('dialog').count(), dialogBaseline)) {
      dialogDetail = 'dialog count dropped after drive (modal closed)'
    } else {
      confirmed = false
    }
  }
  // DOM-delta judgment (same-screen state self-loops): poll (bounded) for ANY
  // watched attribute of the clicked control to differ from its pre-click
  // snapshot. A delta is deterministic proof the click changed the control's own
  // state; no delta is UNDRIVABLE with a diagnosis, NEVER a refutation — the
  // click may well have changed state the watched attribute set cannot see.
  if (expectDomDelta) {
    if (domDeltaLocator === undefined || domDeltaBefore === undefined) return { confirmed: false, undrivable: true }
    const delta = await pollForAttrDelta(page, domDeltaLocator, domDeltaBefore)
    // URL-stay guard: the witnessed state change must have happened ON this
    // screen — an in-flight navigation after a synchronous attr flip would
    // otherwise mint a same-screen witness for a departing control.
    await page.waitForLoadState('networkidle').catch(() => {})
    if (!samePath(page.url(), anchorUrl)) {
      return { confirmed: false, undrivable: true, undrivableReason: 'the control navigated away during the state-click — not a same-screen transition; cannot witness as dom-delta' }
    }
    if (delta === null) {
      return { confirmed: false, undrivable: true, undrivableReason: 'no observable attribute change on the clicked control — state may live elsewhere; cannot witness deterministically' }
    }
    // Only ARIA state attrs are causal proof. `class` flips on hover/focus as a
    // side effect of the click itself (framework styling), so a class-only delta
    // is a diagnosis, never a witness.
    if (delta.attr === 'class') {
      return { confirmed: false, undrivable: true, undrivableReason: CLASS_ONLY_DELTA_REASON }
    }
    return { confirmed: true, evidence: { kind: 'dom-delta', locator: domDeltaLocator, ...delta } }
  }
  if (!confirmed) return { confirmed: false }
  // A close leg's URL match is vacuous (same-path by construction) — its dialog
  // drop is the real proof, so it must never be reported as url-assert evidence.
  const evidence: Evidence =
    requestEvidence ??
    (!expectDialogClose && lastUrlAssertion !== undefined ? { kind: 'url-assert', url: lastUrlAssertion } : { kind: 'dialog', detail: dialogDetail })
  return { confirmed: true, evidence }
}

/**
 * Arm a wait for the network response an `api:*` effect's request assertion names
 * (`"METHOD url"`, codegen's format — already stripped of any unresolvable/joined
 * garbage by `parseApiEffect`). Returns null on any miss/timeout (no matching call
 * arrived) instead of throwing, so the caller can treat a miss as plain disagreement
 * rather than a crashed drive. Matches on exact pathname, never substring: an
 * `.includes()` match would let an unrelated request whose URL merely CONTAINS the
 * expected path (e.g. a query string, or another endpoint sharing a prefix) falsely
 * confirm an edge whose click actually fired nothing.
 */
async function armRequestWait(page: PwPage, value: string): Promise<{ method: string; url: string; status: number } | null> {
  const [method, ...rest] = value.split(' ')
  const path = rest.join(' ')
  // An empty/unresolved path can never be matched to one specific request without
  // risking a false positive on any same-method call — never arm a wait for it.
  if (path.length === 0) return null
  const expected = requestPath(path)
  try {
    const r = await page.waitForResponse((res) => res.request().method() === method && requestPath(res.url()) === expected, { timeout: 5000 })
    return { method: r.request().method(), url: r.url(), status: r.status() }
  } catch {
    return null
  }
}

/** The pathname portion of a request URL (or bare path), query/hash/trailing-slash stripped, for exact request-assertion matching. */
function requestPath(u: string): string {
  try {
    return new URL(u).pathname.replace(/\/$/, '')
  } catch {
    return (u.split('?')[0]?.split('#')[0] ?? u).replace(/\/$/, '')
  }
}

/** True when two URLs share origin+pathname (query string and hash ignored); `:param` segments in the expected path match any concrete segment. Tolerates bare-path inputs. */
function samePath(actual: string, expected: string): boolean {
  const parse = (u: string): string => {
    try {
      const p = new URL(u)
      return p.origin + p.pathname.replace(/\/$/, '')
    } catch {
      return u.split('?')[0]?.split('#')[0]?.replace(/\/$/, '') ?? u
    }
  }
  const a = parse(actual)
  const e = parse(expected)
  if (!e.includes(':')) return a === e
  const stripOrigin = (u: string): string => u.replace(/^https?:\/\/[^/]+/, '')
  const as = stripOrigin(a).split('/').filter((x) => x.length > 0)
  const es = stripOrigin(e).split('/').filter((x) => x.length > 0)
  if (as.length !== es.length) return false
  return es.every((seg, i) => seg.startsWith(':') || seg === as[i])
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
 * must invoke `dispose` after the run to close the shared browser. `modalSelector`
 * is the workspace-declared modal selector, threaded into every drivePlan call for
 * the dialog evidence ladder (per-call opts win when they carry their own).
 */
function makePlaywrightDriver(storageState?: string, modalSelector?: string): OwnedDriver {
  let browser: PwBrowser | null = null
  let context: PwContext | null = null
  // Memoize the launch so N concurrent first-calls (the worker pool) share ONE browser
  // instead of each racing to launch its own on the `context === null` check.
  let ready: Promise<void> | null = null
  const driver: VerifyDriver = async (plan: SpecPlan, appUrl: string, opts?: { capture?: boolean; probe?: ProbeSpec; modalSelector?: string }): Promise<VerifyResult> => {
    ready ??= (async (): Promise<void> => {
      const { chromium } = await loadPlaywright()
      browser = (await chromium.launch()) as PwBrowser
      context = await browser.newContext(storageState !== undefined ? { storageState } : {})
    })()
    await ready
    const page = await (context as PwContext).newPage()
    try {
      return await drivePlan(page, plan, appUrl, { ...opts, modalSelector: opts?.modalSelector ?? modalSelector })
    } finally {
      await page.close()
    }
  }
  const dispose = async (): Promise<void> => {
    if (browser !== null) {
      await browser.close()
      browser = null
      context = null
      ready = null
    }
  }
  return { driver, dispose }
}

export { drivePlan, makePlaywrightDriver, mapPool }

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
  press: (key: string, o?: unknown) => Promise<void>
  count: () => Promise<number>
  filter: (o: { visible: boolean }) => PwLocator
  evaluate: (fn: (el: FormLike) => unknown) => Promise<unknown>
  getAttribute: (name: string, o?: unknown) => Promise<string | null>
}

/** The form-submission slice of a DOM element `evaluate` runs against in-page (no `lib.dom` dependency in this Node package). */
interface FormLike {
  requestSubmit: () => void
}

/** The slice of a Playwright Response the request-evidence wait reads (method+url+status). */
interface PwResponse {
  url: () => string
  status: () => number
  request: () => { method: () => string }
}
interface PwPage {
  goto: (url: string) => Promise<unknown>
  url: () => string
  getByRole: (role: string) => PwLocator
  locator: (selector: string) => PwLocator
  waitForLoadState: (state: string) => Promise<void>
  waitForURL: (predicate: (url: URL) => boolean, opts?: unknown) => Promise<void>
  waitForResponse: (predicate: (r: PwResponse) => boolean, opts?: unknown) => Promise<PwResponse>
  close: () => Promise<void>
}

/**
 * Run one leg's interaction in capture mode: click/press/fill only. Goto legs are
 * skipped (H1 — never goto toward the synthetic sink) and `available` legs are
 * no-ops. Throws on a locator miss so the caller reports undrivable.
 */
async function runCaptureLegAction(page: PwPage, leg: SpecPlan['legs'][number]): Promise<void> {
  const a = leg.action
  if (a.kind === 'click' && a.locator !== undefined) await runLocator(page, a.locator, leg.event === 'submit' ? 'submit' : 'click')
  else if (a.kind === 'press' && a.locator !== undefined) await runLocator(page, a.locator, 'press', a.key ?? 'Enter')
  else if (a.kind === 'fill' && a.locator !== undefined) await runLocator(page, a.locator, 'fill', a.value ?? '')
}

/**
 * Evaluate a `page.getBy…`-style locator snippet against the page, then
 * click/fill/press/submit it. `submit` is distinct from `click`: the extractor
 * models a form's `onSubmit` handler as a control on the `<form>` element itself
 * (selector `"form"`), and a bounding-box click on a block-level form frequently
 * lands on dead space beside its (inline, left-aligned) fields rather than on
 * any element that would actually fire the browser's submit — so a `submit`
 * event is driven via `requestSubmit()`, which dispatches the real submit event
 * React's handler is listening for, the same as clicking the submit button.
 */
async function runLocator(page: PwPage, locator: string, action: 'click' | 'fill' | 'press' | 'submit', value = ''): Promise<void> {
  const loc = resolveLocator(page, locator)
  if (action === 'click') await loc.click({ timeout: 5000 })
  else if (action === 'submit') await loc.evaluate((el) => el.requestSubmit())
  else if (action === 'press') await loc.press(value, { timeout: 5000 })
  else await loc.fill(value, { timeout: 5000 })
}

/** Evaluate a `page.getBy…`-style locator snippet against the page into a live locator (shared by runLocator and the dom-delta attr reads). */
function resolveLocator(page: PwPage, locator: string): PwLocator {
  const expr = locator.replace(/^page\./, '')
  return new Function('page', `return page.${expr}`)(page) as PwLocator
}
