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

/** Lifecycle of a proposal as it moves toward (or away from) the proven graph. */
export type ProposalStatus = 'proposed' | 'confirmed' | 'rejected'

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

const STATUSES = new Set<ProposalStatus>(['proposed', 'confirmed', 'rejected'])
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
