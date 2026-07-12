// Shared foundation for the @uigraph/mcp tool modules: the ToolContext, the
// workspace SQLite path helpers, the store-lifecycle wrapper, the merged-graph
// loader, and the trust-tier ordering — the bits every tool module leans on. No
// LLM is ever called and no MCP transport is touched, so these stay pure and
// directly unit-testable. Sibling modules (read/planning/mutation/loop/diff)
// import from here; the barrel re-exports only the public names.

import { join } from 'node:path'
import type { Observation, TrustTier, UiGraph } from '@uigraph/core'
import { applyObservations, hashValue, mergeOverlay, validateMerged } from '@uigraph/core'
import { openStore, type Store } from '@uigraph/core/node'

/**
 * Where a server instance is rooted: a workspace directory holding
 * `ui-graph.json` (base), an optional `ui-graph.overlay.json` (manual overlay),
 * and an append-only `observations.log.jsonl`.
 */
export interface ToolContext {
  dir: string
}

/** The SQLite database file that is the workspace's canonical store. */
export const DB_FILE = 'uigraph.db'

/** Absolute path to the workspace SQLite database for a context. */
export function dbPath(ctx: ToolContext): string {
  return join(ctx.dir, DB_FILE)
}

/** Open the workspace store, run `fn`, and always close it. */
export function withStore<T>(ctx: ToolContext, fn: (store: Store) => T): T {
  const store = openStore(dbPath(ctx))
  try {
    return fn(store)
  } finally {
    store.close()
  }
}

/**
 * Load the base graph, apply the manual overlay (if any) and fold in runtime
 * observations, returning the merged UiGraph the agent should see. The stored base
 * is never mutated. Reads from the workspace SQLite database.
 */
export function loadMergedGraph(ctx: ToolContext): UiGraph {
  return withStore(ctx, (store) => {
    const base = store.getBaseGraph()
    if (base === null) throw new Error(`no base graph in ${dbPath(ctx)} — run \`uigraph map\` or \`uigraph migrate\` first`)
    let merged = base
    const overlay = store.getOverlay()
    if (overlay !== null) {
      if (overlay.base && overlay.base !== hashValue(base)) {
        throw new Error(
          `stale overlay: it was authored against base ${overlay.base}, but the current base hashes to ${hashValue(base)} — re-author or discard the overlay`,
        )
      }
      merged = mergeOverlay(base, overlay)
    }
    merged = applyObservations(merged, store.getObservations(), { baseHash: hashValue(base) })
    const errs = validateMerged(merged)
    if (errs.length > 0) throw new Error(`merged graph is invalid:\n  ${errs.map((e) => e.message).join('\n  ')}`)
    return merged
  })
}

/** A recorded observation line (the core Observation plus a server timestamp). */
export type ObservationEntry = Observation

/** Read all recorded observations from the workspace store, in insertion order. */
export function readObservations(ctx: ToolContext): ObservationEntry[] {
  return withStore(ctx, (store) => store.getObservations())
}

/**
 * Trust precedence (most-trusted first), the agent-facing read layer's copy of the
 * tier order. It mirrors core's projection enum and is the basis for `minTier`
 * filtering + tier sorting in the case tools; it is a comparison concern of the
 * consumer, not a re-derivation of the projection logic (which stays in core).
 */
export const TIER_ORDER: TrustTier[] = ['witnessed', 'proven', 'asserted', 'llm-verified', 'proposed', 'unknown']

/** True when `tier` is at least as trusted as `floor` (lower index = more trusted). */
export function tierAtLeast(tier: TrustTier, floor: TrustTier): boolean {
  return TIER_ORDER.indexOf(tier) <= TIER_ORDER.indexOf(floor)
}
