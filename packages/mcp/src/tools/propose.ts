// The Tier-2 write path: the `propose` tool lets an agent submit batched,
// quarantined hypotheses about app behavior (the long tail the deterministic
// extractor cannot enumerate). Proposals NEVER enter the base graph — they live
// in the proposals table, bound to the current base hash, and become real edges
// only when a Tier-3 observation with proof confirms them. The agent's job here
// is recall: propose as many plausible nodes/edges as the code and UX suggest;
// the verify loop sorts truth from guess.

import type { Proposal, ProposalKind } from '@uigraph/core'
import { emptyProposals, hashValue } from '@uigraph/core'
import { loadMergedGraph, withStore, type ToolContext } from './context'

/** One proposal as submitted by the agent — everything but the server-minted id/source/status. */
export interface ProposalInput {
  kind: ProposalKind
  category: string
  screen: string
  title: string
  rationale: string
  confidence: number
  evidenced?: boolean
  event?: string
  control?: string
  from?: string
  to?: string
  guard?: string
  effect?: string
}

/** Arguments for propose: a batch of Tier-2 proposal inputs. */
export interface ProposeArgs {
  proposals: ProposalInput[]
}

/** Why one submitted proposal was rejected (by its index in the batch). */
export interface ProposeRejection {
  index: number
  title: string
  reason: string
}

/** propose result: minted ids for accepted proposals + per-item rejections with reasons. */
export interface ProposeResult {
  accepted: { id: string; title: string }[]
  rejected: ProposeRejection[]
  totalStored: number
}

const KINDS = new Set<ProposalKind>(['edge', 'node', 'interaction'])

/**
 * Validate one proposal input against the merged graph. Returns a rejection
 * reason or null. `screen` (and `from`/`to` when present) must resolve to a real
 * node — `<modal>` is the allowed synthetic target; an edge-kind proposal needs a
 * non-empty event (an event-less transition is not a drivable lead).
 */
function inputProblem(p: ProposalInput, nodeIds: Set<string>): string | null {
  if (!KINDS.has(p.kind)) return `invalid kind "${String(p.kind)}"`
  for (const k of ['category', 'screen', 'title', 'rationale'] as const) {
    if (typeof p[k] !== 'string' || p[k] === '') return `${k} must be a non-empty string`
  }
  if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) return 'confidence must be a number in [0,1]'
  if (!nodeIds.has(p.screen)) return `screen "${p.screen}" is not a node in the graph — use get_graph to see valid node ids`
  if (p.from !== undefined && !nodeIds.has(p.from)) return `from "${p.from}" is not a node in the graph`
  if (p.to !== undefined && p.to !== '<modal>' && !nodeIds.has(p.to)) return `to "${p.to}" is not a node in the graph (use "<modal>" for the screen's modal)`
  if (p.kind === 'edge' && (p.event === undefined || p.event === '')) return 'an edge proposal needs a non-empty event (what a user does to trigger it)'
  return null
}

/**
 * Store a batch of Tier-2 proposals: validate each input against the merged
 * graph, mint deterministic ids, and append the accepted ones to the proposals
 * table bound to the CURRENT base hash (the proposal graph is rebuilt so new
 * leads appear on the verify worklist immediately). Duplicates of an already-
 * stored proposal (same content hash) are rejected, not double-counted.
 * Quarantine holds: source:'proposal', status:'proposed', never a graph edge.
 */
export function propose(ctx: ToolContext, args: ProposeArgs): ProposeResult {
  const merged = loadMergedGraph(ctx)
  const nodeIds = new Set(merged.nodes.map((n) => n.id))
  const accepted: { id: string; title: string }[] = []
  const rejected: ProposeRejection[] = []

  const totalStored = withStore(ctx, (store) => {
    const base = store.getBaseGraph()
    const baseHash = base !== null ? hashValue(base) : ''
    const existing = store.getProposals()?.proposals ?? []
    const known = new Set(existing.map((p) => p.id))
    const toStore: Proposal[] = []

    for (const [index, input] of (args.proposals ?? []).entries()) {
      const problem = inputProblem(input, nodeIds)
      if (problem !== null) {
        rejected.push({ index, title: input.title ?? '(untitled)', reason: problem })
        continue
      }
      const id = `p_${hashValue({ kind: input.kind, screen: input.screen, title: input.title, event: input.event ?? null, to: input.to ?? null }).slice(0, 10)}`
      if (known.has(id)) {
        rejected.push({ index, title: input.title, reason: `duplicate of already-stored proposal ${id}` })
        continue
      }
      known.add(id)
      toStore.push({
        id,
        kind: input.kind,
        category: input.category,
        screen: input.screen,
        title: input.title,
        rationale: input.rationale,
        confidence: input.confidence,
        evidenced: input.evidenced ?? false,
        source: 'proposal',
        status: 'proposed',
        ...(input.event !== undefined ? { event: input.event } : {}),
        ...(input.control !== undefined ? { control: input.control } : {}),
        ...(input.from !== undefined ? { from: input.from } : {}),
        ...(input.to !== undefined ? { to: input.to } : {}),
        ...(input.guard !== undefined ? { guard: input.guard } : {}),
        ...(input.effect !== undefined ? { effect: input.effect } : {}),
      })
      accepted.push({ id, title: input.title })
    }

    if (toStore.length > 0) {
      store.setProposals({ ...emptyProposals(baseHash), proposals: [...existing, ...toStore] })
    }
    return existing.length + toStore.length
  })

  return { accepted, rejected, totalStored }
}
