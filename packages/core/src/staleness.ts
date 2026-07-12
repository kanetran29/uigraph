// Staleness & dangling-ref detection (red-team Tier-1 #1). On load/merge the
// store must SURFACE staleness rather than silently trust its sidecars: an
// observation, overlay edit, or proposal that points at a node id no longer in
// the base, or a proposals/overlay sidecar authored against a different base
// hash, is stale. `validateRefs` is a PURE report — it mints nothing and throws
// nothing; callers (serve/coverage) decide whether to drop, flag, or refuse. The
// fold (applyObservations) and merge already DROP refs to ghost nodes; this
// module is the visibility layer that explains what was (or would be) dropped.

import type { Overlay, UiGraph } from './ir'
import type { Proposal, Proposals } from './proposals'
import type { Observation } from './runtime'
import { hashValue } from './hash'

/** A single dangling/stale finding: what kind of element, its id, and why. */
export interface StalenessIssue {
  code:
    | 'OBSERVATION_DANGLING'
    | 'OBSERVATION_STALE_BASE'
    | 'OVERLAY_EDGE_DANGLING'
    | 'OVERLAY_EDITED_NODE_DANGLING'
    | 'OVERLAY_REMOVED_DANGLING'
    | 'OVERLAY_STALE_HASH'
    | 'PROPOSAL_DANGLING'
    | 'PROPOSAL_STALE_HASH'
  message: string
  id?: string
}

/**
 * A staleness summary for the current base + its sidecars. `ok` is true when
 * nothing is stale. `droppedObservationIds` are observations whose from/to is a
 * ghost node — the fold already refuses to mint an edge for them, so this is the
 * audit trail of what was dropped. The hash-mismatch flags warn that a whole
 * sidecar was authored against a different base.
 */
export interface StalenessReport {
  ok: boolean
  baseHash: string
  issues: StalenessIssue[]
  droppedObservationIds: string[]
  overlayStaleHash: boolean
  proposalsStaleHash: boolean
}

/** Inputs to validateRefs; every sidecar is optional (null/undefined = absent). */
export interface ValidateRefsInput {
  base: UiGraph
  overlay?: Overlay | null
  proposals?: Proposals | null
  observations?: Observation[]
}

/**
 * Report all dangling refs and stale-hash sidecars against the CURRENT base.
 * Pure: no mutation, no throw. Detects (a) observations whose from/to is not a
 * current base node (these never fold into an edge — they are dropped), (b)
 * overlay added/edited edges, edited nodes, and removedRefs pointing at ghost
 * ids, (c) overlay/proposals sidecars whose recorded base hash != the current
 * base hash, and (d) proposals whose screen/from/to is a ghost id. Overlay
 * `addedNodes` define new ids, so an overlay edge/edit may legitimately point at
 * them; they are treated as valid targets alongside base nodes.
 */
export function validateRefs(input: ValidateRefsInput): StalenessReport {
  const { base, overlay, proposals } = input
  const observations = input.observations ?? []
  const baseHash = hashValue(base)
  const issues: StalenessIssue[] = []

  const baseIds = new Set(base.nodes.map((n) => n.id))
  const overlayIds = new Set<string>(baseIds)
  for (const n of overlay?.addedNodes ?? []) overlayIds.add(n.id)

  const droppedObservationIds: string[] = []
  for (const o of observations) {
    const missing = !baseIds.has(o.from) ? o.from : !baseIds.has(o.to) ? o.to : undefined
    if (missing !== undefined) {
      droppedObservationIds.push(o.id)
      issues.push({ code: 'OBSERVATION_DANGLING', message: `observation "${o.id}" references unknown node "${missing}" — dropped, no edge minted`, id: o.id })
      continue
    }
    if (o.base !== undefined && o.base !== baseHash) {
      issues.push({ code: 'OBSERVATION_STALE_BASE', message: `observation "${o.id}" was recorded against base ${o.base}, not the current ${baseHash} — its edge folds as witnessStale and needs re-verification`, id: o.id })
    }
  }

  let overlayStaleHash = false
  if (overlay != null) {
    if (overlay.base && overlay.base !== baseHash) {
      overlayStaleHash = true
      issues.push({ code: 'OVERLAY_STALE_HASH', message: `overlay was authored against base ${overlay.base}, but the current base hashes to ${baseHash}` })
    }
    for (const e of [...overlay.addedEdges, ...overlay.editedEdges]) {
      const missing = !overlayIds.has(e.from) ? e.from : !overlayIds.has(e.to) ? e.to : undefined
      if (missing !== undefined) issues.push({ code: 'OVERLAY_EDGE_DANGLING', message: `overlay edge "${e.id}" references unknown node "${missing}"`, id: e.id })
    }
    for (const n of overlay.editedNodes ?? []) {
      if (!baseIds.has(n.id)) issues.push({ code: 'OVERLAY_EDITED_NODE_DANGLING', message: `overlay edits unknown base node "${n.id}"`, id: n.id })
    }
    for (const ref of overlay.removedRefs) {
      if (!baseIds.has(ref)) issues.push({ code: 'OVERLAY_REMOVED_DANGLING', message: `overlay removes unknown base ref "${ref}"`, id: ref })
    }
  }

  let proposalsStaleHash = false
  if (proposals != null) {
    if (proposals.base && proposals.base !== baseHash) {
      proposalsStaleHash = true
      issues.push({ code: 'PROPOSAL_STALE_HASH', message: `proposals were authored against base ${proposals.base}, but the current base hashes to ${baseHash}` })
    }
    for (const p of proposals.proposals) {
      const missing = proposalDanglingRef(p, baseIds)
      if (missing !== undefined) issues.push({ code: 'PROPOSAL_DANGLING', message: `proposal "${p.id}" references unknown node "${missing}"`, id: p.id })
    }
  }

  return { ok: issues.length === 0, baseHash, issues, droppedObservationIds, overlayStaleHash, proposalsStaleHash }
}

/**
 * The first ghost node id a proposal references, or undefined when all its node
 * refs resolve. `screen` is always a node ref; `from`/`to` are checked when
 * present. The synthetic `<modal>` target is a materialize-time placeholder, not
 * a base id, so it is not treated as dangling.
 */
function proposalDanglingRef(p: Proposal, baseIds: Set<string>): string | undefined {
  if (!baseIds.has(p.screen)) return p.screen
  if (p.from !== undefined && !baseIds.has(p.from)) return p.from
  if (p.to !== undefined && p.to !== '<modal>' && !baseIds.has(p.to)) return p.to
  return undefined
}
