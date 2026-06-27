// The Tier-2 proposals layer (dossier §5.1): an LLM "critical-thinking" reviewer
// reads the app greedily and proposes the long-tail of interactions the
// deterministic extractor cannot enumerate (read-more/expand, load-more/infinite
// scroll, drag-drop, keyboard shortcuts, optimistic updates, error/empty states…).
//
// Proposals are QUARANTINED: they live in their own sidecar file, carry
// source:'proposal', and NEVER enter the base graph. A proposal becomes a real
// edge only when Tier-3 runtime observation (or a human) confirms it — at which
// point the observation, not the guess, is what enters the graph. A wrong
// proposal therefore degrades planning at worst; it can never mint a phantom
// proven transition.

import type { UiGraph } from './ir'

/**
 * Lifecycle of a proposal as it moves toward (or away from) the proven graph.
 * `proposed` = an open lead on the verification worklist; `confirmed` = a runtime
 * observation witnessed it (archived — the proven edge already exists via the
 * observation fold); `rejected` = disproven/hallucinated (withdrawn); `unverifiable`
 * = plausible but not drivable/reachable, parked out of the worklist for a human.
 * Only `proposed` proposals stay in the active proposal graph + verify worklist.
 */
export type ProposalStatus = 'proposed' | 'confirmed' | 'rejected' | 'unverifiable'

/** What a proposal asserts: a new transition, a new state/node, or an interaction on a control. */
export type ProposalKind = 'edge' | 'node' | 'interaction'

/**
 * A single quarantined hypothesis about app behavior. `category` groups the long
 * tail (e.g. 'disclosure', 'infinite-scroll', 'drag-drop', 'keyboard',
 * 'async-state', 'realtime'); `rationale` records the code/UX signal the reviewer
 * reasoned from; `evidenced` is true when grounded in concrete source (vs. a
 * speculative-but-plausible guess).
 */
export interface Proposal {
  id: string
  kind: ProposalKind
  category: string
  screen: string
  title: string
  event?: string
  control?: string
  from?: string
  to?: string
  guard?: string
  effect?: string
  rationale: string
  evidenced: boolean
  confidence: number
  source: 'proposal'
  status: ProposalStatus
  reason?: string
  screenshot?: string
}

/** The proposals sidecar: a set of quarantined proposals bound to a base graph hash. */
export interface Proposals {
  version: 0
  base: string
  proposals: Proposal[]
}

/** A validation problem found in a proposals sidecar. */
export interface ProposalError {
  code: string
  message: string
  id?: string
}

const STATUSES = new Set<ProposalStatus>(['proposed', 'confirmed', 'rejected', 'unverifiable'])
const KINDS = new Set<ProposalKind>(['edge', 'node', 'interaction'])

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validate a proposals sidecar. Enforces the quarantine: every proposal must be
 * source:'proposal' (never 'static'/'runtime'/'manual'), with a known status/kind,
 * unique id, and confidence in [0,1].
 */
export function validateProposals(value: unknown): ProposalError[] {
  const errs: ProposalError[] = []
  if (!isObject(value)) return [{ code: 'SHAPE', message: 'proposals is not an object' }]
  if (value['version'] !== 0) errs.push({ code: 'SHAPE', message: 'proposals.version must be 0' })
  if (typeof value['base'] !== 'string') errs.push({ code: 'SHAPE', message: 'proposals.base must be a string' })
  if (!Array.isArray(value['proposals'])) return [...errs, { code: 'SHAPE', message: 'proposals.proposals must be an array' }]

  const seen = new Set<string>()
  for (const [i, raw] of value['proposals'].entries()) {
    if (!isObject(raw)) {
      errs.push({ code: 'SHAPE', message: `proposals[${i}] is not an object` })
      continue
    }
    const id = typeof raw['id'] === 'string' ? raw['id'] : undefined
    if (id === undefined) errs.push({ code: 'SHAPE', message: `proposals[${i}].id must be a string` })
    else if (seen.has(id)) errs.push({ code: 'DUP_ID', message: `duplicate proposal id "${id}"`, id })
    else seen.add(id)

    if (raw['source'] !== 'proposal') errs.push({ code: 'NOT_QUARANTINED', message: `proposal "${id ?? i}" must have source:'proposal'`, id })
    if (typeof raw['kind'] !== 'string' || !KINDS.has(raw['kind'] as ProposalKind)) errs.push({ code: 'SHAPE', message: `proposal "${id ?? i}" has invalid kind`, id })
    if (typeof raw['status'] !== 'string' || !STATUSES.has(raw['status'] as ProposalStatus)) errs.push({ code: 'SHAPE', message: `proposal "${id ?? i}" has invalid status`, id })
    if (typeof raw['confidence'] !== 'number' || raw['confidence'] < 0 || raw['confidence'] > 1) errs.push({ code: 'CONFIDENCE_RANGE', message: `proposal "${id ?? i}" confidence out of [0,1]`, id })
    for (const k of ['category', 'screen', 'title', 'rationale']) {
      if (typeof raw[k] !== 'string') errs.push({ code: 'SHAPE', message: `proposal "${id ?? i}".${k} must be a string`, id })
    }
  }
  return errs
}

/** An empty proposals sidecar bound to a base graph hash. */
export function emptyProposals(baseHash: string): Proposals {
  return { version: 0, base: baseHash, proposals: [] }
}

/** A node in the quarantined proposal graph (a real screen, a screen's modal, or a synthesized sub-state). */
export interface ProposalGraphNode {
  id: string
  label: string
  kind: string
}

/** A proposed transition as an edge: source screen → target node, carrying the originating proposal ids. */
export interface ProposalGraphEdge {
  id: string
  from: string
  to: string
  event: string
  guard: string | null
  effect: string | null
  modality: 'may' | 'unknown'
  proposalIds: string[]
}

/** The proposal graph: proposals rendered AS nodes + edges, kept separate from the proven IR. */
export interface ProposalGraph {
  nodes: ProposalGraphNode[]
  edges: ProposalGraphEdge[]
}

/** The sub-state kind a state-changing proposal opens, or null for a pure micro-interaction. */
function proposalStateKind(p: Proposal): string | null {
  const hay = `${p.category} ${p.effect ?? ''} ${p.title} ${p.to ?? ''}`.toLowerCase()
  if (/modal|dialog|drawer|sheet/.test(hay)) return 'modal'
  if (/popover|dropdown|autocomplete|suggest|combobox|tooltip|context.?menu|\bmenu\b/.test(hay)) return 'popover'
  if (/error|fail|invalid|reject/.test(hay)) return 'error'
  if (/empty|no results|no matches/.test(hay)) return 'empty'
  if (/loading|spinner|skeleton|fetching/.test(hay)) return 'loading'
  if (/expand|collapse|accordion|read more|show more|see all|disclos/.test(hay)) return 'expanded'
  if (/toast|success|confirmation|\bsaved\b/.test(hay)) return 'toast'
  return null
}

/**
 * Project proposals into a graph of nodes + edges, kept SEPARATE from the proven
 * IR (proposal edges cannot be GraphEdges — those require a static/manual/runtime
 * witness). Each proposal becomes an edge from its screen to a target: a real
 * screen, that screen's modal, or a synthesized sub-state node (modal/popover/
 * error/empty/loading/expanded/toast). Pure micro-interactions (no distinct target
 * state) are skipped, as are proposals with no event (an event-less transition is
 * not a drivable lead — never emit an event:'' edge). Edges dedupe by from→to,
 * merging the originating proposal ids. This is what gets stored so proposals are
 * queryable as a graph without polluting the proven graph.
 */
export function materializeProposalGraph(graph: UiGraph, proposals: Proposal[]): ProposalGraph {
  const realNodeIds = new Set(graph.nodes.map((n) => n.id))
  const realScreens = new Set(graph.nodes.filter((n) => n.kind !== 'control').map((n) => n.id))
  const modalFor = (screen: string): string | undefined =>
    graph.nodes.find((n) => n.kind === 'modal' && n.id.startsWith(`m_${screen}`))?.id

  const stateNodes = new Map<string, ProposalGraphNode>()
  const edgeByPair = new Map<string, ProposalGraphEdge>()
  // Event-less proposals are screened out below before any `link` call, so
  // `p.event` is a non-empty string here and never produces an event:'' edge.
  const link = (p: Proposal, to: string): void => {
    const pair = `${p.screen}->${to}`
    const existing = edgeByPair.get(pair)
    if (existing) {
      existing.proposalIds.push(p.id)
      return
    }
    edgeByPair.set(pair, {
      id: `pe_${pair}`,
      from: p.screen,
      to,
      event: p.event as string,
      guard: p.guard ?? null,
      effect: p.effect ?? null,
      modality: 'may',
      proposalIds: [p.id],
    })
  }

  for (const p of proposals) {
    if (p.status !== 'proposed') continue
    if (p.event === undefined || p.event === '') continue
    if (!realNodeIds.has(p.screen)) continue
    if (p.to !== undefined && realScreens.has(p.to)) {
      link(p, p.to)
      continue
    }
    if (p.to === '<modal>') {
      const m = modalFor(p.screen)
      if (m !== undefined) {
        link(p, m)
        continue
      }
    }
    const kind = proposalStateKind(p)
    if (kind === null) continue
    const id = `ps_${p.screen}__${kind}`
    if (!stateNodes.has(id)) stateNodes.set(id, { id, label: kind, kind: kind === 'modal' || kind === 'popover' ? 'modal' : 'unknown' })
    link(p, id)
  }

  return { nodes: [...stateNodes.values()], edges: [...edgeByPair.values()] }
}
