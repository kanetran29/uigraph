// Tier-3 runtime fold (dossier §5.1-5.2). A confirmed runtime observation is a
// deterministic witness, so it enters the graph as a real edge — this is the
// "the observation enters the graph, not the guess" half of the golden invariant.
// A refuted observation never produces an edge. The fold is pure: same
// observation log -> same runtime edges (G = fold(reduce_fn, static ++ obs_log)).
//
// Proof discipline (red-team fixes): observations match edges by the full
// (from, to, event) triple — never by pair alone — so a witness can only attach
// to the transition it actually observed; upgrading a guarded edge preserves its
// guard and modality (one confirmed run proves existence, not unconditionality);
// and an observation recorded against a different base graph still folds (history
// survives a re-map) but flags the edge `witnessStale` so coverage and the verify
// worklist demand a re-confirmation instead of trusting an outdated witness.

import type { GraphEdge, UiGraph } from './ir'
import { fnv1a } from './hash'

/**
 * Structured proof attached to a confirmed observation. `url-change` records a
 * real navigation the driver watched happen (start → landed); `url-assert`
 * records that the browser's URL equalled the expected route after the drive;
 * `dialog` records an asserted visible dialog; `screenshot` points at a captured
 * artifact on disk (existence is checked by the recording layer, not here — the
 * core stays pure/browser-safe); `request` records a real network call the
 * driver watched fire (method+url+status) — proof for an `api:*` effect edge
 * that no URL change or dialog would otherwise witness (e.g. an effect-only
 * self-loop); `dom-delta` records a watched attribute of the clicked control
 * changing across the interaction (before → after) — proof for a same-screen
 * state:* self-loop (accordion/tab/expander) that no URL, dialog, or request
 * could otherwise witness.
 */
export type Evidence =
  | { kind: 'url-change'; startUrl: string; landedUrl: string }
  | { kind: 'url-assert'; url: string }
  | { kind: 'dialog'; detail?: string }
  | { kind: 'screenshot'; path: string }
  | { kind: 'request'; method: string; url: string; status: number }
  | { kind: 'dom-delta'; locator: string; attr: string; before: string; after: string }

/** Who produced an observation: the shipped Playwright runner or an agent driving via MCP. */
export type ObservationReporter = 'runner' | 'agent'

/** One runtime observation of attempting a transition (e.g. via Playwright). */
export interface Observation {
  id: string
  from: string
  to: string
  event: string
  effect?: string
  outcome: 'confirmed' | 'refuted'
  proposalId?: string
  screenshot?: string
  ts?: string
  evidence?: Evidence
  reportedBy?: ObservationReporter
  base?: string
}

/**
 * Validate an evidence payload's internal semantics (pure — no filesystem
 * access; the MCP layer additionally checks that a screenshot path exists).
 * Returns null when the evidence is acceptable proof, or a human-readable
 * problem. A url-change must actually change the URL; url-assert/screenshot
 * must carry non-empty values; a dom-delta must show an actual attribute change
 * (a no-change delta proves nothing).
 */
export function validateEvidence(evidence: Evidence): string | null {
  switch (evidence.kind) {
    case 'url-change':
      if (evidence.startUrl === '' || evidence.landedUrl === '') return 'url-change evidence needs non-empty startUrl and landedUrl'
      if (evidence.startUrl === evidence.landedUrl) return 'url-change evidence must show an actual change (startUrl equals landedUrl)'
      return null
    case 'url-assert':
      return evidence.url === '' ? 'url-assert evidence needs a non-empty url' : null
    case 'dialog':
      return null
    case 'screenshot':
      return evidence.path === '' ? 'screenshot evidence needs a non-empty path' : null
    case 'request':
      if (evidence.method === '' || evidence.url === '') return 'request evidence needs a non-empty method and url'
      if (evidence.status < 200 || evidence.status >= 400) return `request evidence status ${evidence.status} is not a successful/redirect response (2xx/3xx)`
      return null
    case 'dom-delta':
      if (evidence.locator === '' || evidence.attr === '') return 'dom-delta evidence needs a non-empty locator and attr'
      if (evidence.before === evidence.after) return 'dom-delta evidence must show an actual change (before equals after)'
      return null
  }
}

/**
 * Stable id for the runtime edge produced by a confirmed transition. Uses a
 * readable sanitized event token PLUS the full (non-truncated) FNV-1a of the
 * canonical event, so two distinct events on the same from→to pair can never
 * collide into one id — a collision here would silently merge separate
 * transitions during dedup. The full hash disambiguates events that sanitize to
 * the same token (e.g. `a b` vs `a_b`).
 */
export function runtimeEdgeId(from: string, to: string, event: string): string {
  return `r_${from}__${to}__${sanitizeEvent(event)}_${fnv1a(event)}`
}

/** Map an event string to a readable id token (non-`[A-Za-z0-9_-]` → `_`). */
function sanitizeEvent(event: string): string {
  return event.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** The runtime Witness for one observation (id + optional screenshot artifact). */
function witnessOf(o: Observation): GraphEdge['witness'] {
  return { source: 'runtime', observationId: o.id, ...(o.screenshot ? { screenshot: o.screenshot } : {}) }
}

/** True when an observation was recorded against a different base graph than `baseHash`. */
function isStale(o: Observation, baseHash: string | undefined): boolean {
  return o.base !== undefined && baseHash !== undefined && o.base !== baseHash
}

/**
 * The witnessed edges implied by a set of observations: one `must` edge per
 * distinct confirmed (from,to,event), sourced `runtime` with the observation id as
 * its witness. Refuted observations are ignored.
 */
export function confirmedEdges(observations: Observation[]): GraphEdge[] {
  const seen = new Set<string>()
  const edges: GraphEdge[] = []
  for (const o of observations) {
    if (o.outcome !== 'confirmed') continue
    const id = runtimeEdgeId(o.from, o.to, o.event)
    if (seen.has(id)) continue
    seen.add(id)
    edges.push({
      id,
      from: o.from,
      to: o.to,
      event: o.event,
      guard: null,
      effect: o.effect ?? 'navigate',
      modality: 'must',
      source: 'runtime',
      confidence: 1,
      witness: witnessOf(o),
    })
  }
  return edges
}

/** Options for applyObservations: the current base graph hash, used to flag stale witnesses. */
export interface ApplyObservationsOptions {
  baseHash?: string
}

/**
 * Fold confirmed observations into a graph. A confirmation matching an EXISTING
 * edge by the full (from, to, event) triple UPGRADES that edge in place to a
 * witnessed runtime edge — keeping its stable id and, when the edge is guarded,
 * its guard AND modality (a single confirmed run proves the transition can
 * happen, not that it always does); an unguarded edge upgrades to `must`. A
 * confirmation with no (from,to,event) match appends a fresh runtime edge. Every
 * confirmed observation is folded (no first-per-pair shortcut); duplicates of
 * the same triple apply once. An observation recorded against a different base
 * hash still folds but marks the edge `witnessStale` so it re-enters the verify
 * worklist. Refuted observations never produce an edge, and observations
 * referencing unknown nodes are skipped. Returns a new graph; the input is not
 * mutated.
 *
 * Falsification: a `may` edge whose triple has >= 2 refuted observations on the
 * CURRENT base and ZERO confirmed observations (any base) is a DISPROVEN
 * hypothesis — it gets `refuted: true` (kept in the graph, never deleted, so
 * the hypothesis and its history stay auditable). Refutations recorded against
 * an OLD base hash never count toward the threshold: the app may have changed
 * since, so only current-base refutations demote (an unstamped refute predates
 * base stamping and counts, mirroring how unstamped confirms are treated as
 * fresh). Any confirmation — even a stale-base one — clears/blocks the flag
 * (confirm beats refute). A `must` edge is NEVER demoted: a refuted must-static
 * proof means extraction and runtime disagree, a fire alarm handled by the
 * runner's refutedProven path, not a quiet demotion.
 */
export function applyObservations(graph: UiGraph, observations: Observation[], opts: ApplyObservationsOptions = {}): UiGraph {
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const edges = graph.edges.slice()
  const idxByTriple = new Map<string, number>()
  edges.forEach((e, i) => {
    const triple = `${e.from}->${e.to}::${e.event}`
    if (!idxByTriple.has(triple)) idxByTriple.set(triple, i)
  })

  let changed = false
  const seen = new Set<string>()
  // Newest observation per triple wins: the log is append-only (oldest first), so
  // iterating it forward let an old stale-base confirmation shadow a fresh
  // re-confirmation of the same transition — the edge stayed witnessStale forever
  // no matter how many times it was re-driven. Walk newest-first instead.
  for (const o of [...observations].reverse()) {
    if (o.outcome !== 'confirmed' || !nodeIds.has(o.from) || !nodeIds.has(o.to)) continue
    const triple = `${o.from}->${o.to}::${o.event}`
    if (seen.has(triple)) continue
    seen.add(triple)
    const stale = isStale(o, opts.baseHash)
    const idx = idxByTriple.get(triple)
    const cur = idx !== undefined ? edges[idx] : undefined
    if (idx !== undefined && cur !== undefined) {
      edges[idx] = {
        ...cur,
        modality: cur.guard === null ? 'must' : cur.modality,
        source: 'runtime',
        confidence: 1,
        witness: witnessOf(o),
        ...(stale ? { witnessStale: true } : {}),
      }
    } else {
      edges.push({
        id: runtimeEdgeId(o.from, o.to, o.event),
        from: o.from,
        to: o.to,
        event: o.event,
        guard: null,
        effect: o.effect ?? 'navigate',
        modality: 'must',
        source: 'runtime',
        confidence: 1,
        witness: witnessOf(o),
        ...(stale ? { witnessStale: true } : {}),
      })
      idxByTriple.set(triple, edges.length - 1)
    }
    changed = true
  }

  // Falsification pass (see doc comment): tally current-base refutes and any-base
  // confirms per triple, then flag/clear `refuted` on non-runtime may-edges.
  const refuteCounts = new Map<string, number>()
  const confirmedTriples = new Set<string>()
  for (const o of observations) {
    const triple = `${o.from}->${o.to}::${o.event}`
    if (o.outcome === 'confirmed') confirmedTriples.add(triple)
    else if (!isStale(o, opts.baseHash)) refuteCounts.set(triple, (refuteCounts.get(triple) ?? 0) + 1)
  }
  edges.forEach((e, i) => {
    const triple = `${e.from}->${e.to}::${e.event}`
    const disproven = e.modality === 'may' && e.source !== 'runtime' && (refuteCounts.get(triple) ?? 0) >= 2 && !confirmedTriples.has(triple)
    if (disproven && e.refuted !== true) {
      edges[i] = { ...e, refuted: true }
      changed = true
    } else if (!disproven && e.refuted === true) {
      const { refuted: _refuted, ...rest } = e
      edges[i] = rest
      changed = true
    }
  })

  return changed ? { ...graph, edges } : graph
}
