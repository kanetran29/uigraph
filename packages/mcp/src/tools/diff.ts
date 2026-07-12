// Diff / freshness tools for the @uigraph/mcp server: whether the stored graph is
// still current with its source (get_freshness), a structural diff of two graph
// files (diff), and the temporal "since last map" diff for the bound workspace
// (diff_since_last). Pure over a ToolContext, built on core's fingerprint + diff.

import { existsSync } from 'node:fs'
import type { GraphDiff, SinceLastDiff } from '@uigraph/core'
import { diffGraphs, diffSinceLast } from '@uigraph/core'
import { compareFingerprint, fingerprintSources, loadGraph } from '@uigraph/core/node'
import { withStore, type ToolContext } from './context'

/** Whether the stored graph is current with its source: fresh / stale / unknown. */
export interface FreshnessResult {
  state: 'fresh' | 'stale' | 'unknown'
  mappedAt?: string
  projectDir?: string
  changed: string[]
  added: string[]
  removed: string[]
  detail?: string
}

/**
 * Compare the source fingerprint stamped at map time against the source now, so an agent
 * knows whether the graph still reflects the code. 'unknown' when never mapped or the
 * mapped source dir isn't reachable from here (a remote/CI map) — it NEVER reports 'fresh'
 * when it cannot recompute, so an agent treats unknown as could-be-stale. Pure report; the
 * agent (per the freshness kit rule) decides whether to notify the user + re-map.
 */
export function getFreshness(ctx: ToolContext): FreshnessResult {
  const fp = withStore(ctx, (store) => store.getFingerprint())
  if (fp === null) {
    return { state: 'unknown', changed: [], added: [], removed: [], detail: 'no fingerprint — run `uigraph map` first' }
  }
  if (!existsSync(fp.projectDir)) {
    return { state: 'unknown', mappedAt: fp.mappedAt, projectDir: fp.projectDir, changed: [], added: [], removed: [], detail: 'mapped source dir is not on this machine — cannot recompute freshness' }
  }
  const diff = compareFingerprint(fp, fingerprintSources(fp.projectDir))
  return { state: diff.stale ? 'stale' : 'fresh', mappedAt: fp.mappedAt, projectDir: fp.projectDir, changed: diff.changed, added: diff.added, removed: diff.removed }
}

/** Arguments for diff: two graph file paths to compare. */
export interface DiffArgs {
  a: string
  b: string
}

/**
 * Diff two graph files by stable id via core diffGraphs, returning the structured
 * diff (added/removed nodes+edges and per-edge changed-field lists).
 */
export function diffTool(args: DiffArgs): GraphDiff {
  const a = loadGraph(args.a)
  const b = loadGraph(args.b)
  return diffGraphs(a, b)
}

/**
 * The temporal "since last map" diff for the bound workspace — what the latest re-map did to
 * the proven UI graph (current base vs the previous map). Distinct from get_freshness (which
 * compares source files to the map, not two maps). The previous base is rotated INSIDE the db,
 * so unlike diff (two file paths) the agent can call this with no arguments after a re-map.
 */
export function diffSinceLastTool(ctx: ToolContext): SinceLastDiff {
  return withStore(ctx, (store) => diffSinceLast(store.getBaseGraph(), store.getFingerprint()?.mappedAt ?? null, store.getPreviousGraph()))
}
