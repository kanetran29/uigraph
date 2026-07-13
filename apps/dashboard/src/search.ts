// Pure, browser-safe search/filter predicates for the dashboard — no React, no IO, so
// they are unit-tested directly (mirrors layout.ts). The canvas search only DIMS matches
// (selection always wins); the Coverage/Proposals panels filter their own lists locally.

import type { EdgeCoverage, GraphNode, Proposal, ProposalStatus } from '@ui-graph/core'

/**
 * Whether a node matches a free-text query: case-insensitive trimmed substring over the
 * node's label, route, id, and (for a control) its control name. An empty/whitespace query
 * never matches (so search stays inactive), and a `kind:'unknown'` sink never matches — the
 * canvas hides those, so search must agree on the hidden set.
 */
export function matchesNode(node: GraphNode, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return false
  if (node.kind === 'unknown') return false
  const hay = [node.label, node.route ?? '', node.id, node.control?.name ?? ''].join(' ').toLowerCase()
  return hay.includes(q)
}

/** The ids of every node matching the query; an empty Set for an empty query. */
export function searchMatchIds(nodes: readonly GraphNode[], query: string): Set<string> {
  const out = new Set<string>()
  if (query.trim().length === 0) return out
  for (const n of nodes) if (matchesNode(n, query)) out.add(n.id)
  return out
}

/** Filter state for the Proposals panel; an empty status/category set means "all". */
export interface ProposalFilter {
  statuses: ReadonlySet<ProposalStatus>
  categories: ReadonlySet<string>
  evidenced: 'all' | 'evidenced' | 'speculative'
}

/** Whether a proposal passes the panel filter (empty sets pass through). */
export function matchProposal(p: Proposal, f: ProposalFilter): boolean {
  if (f.statuses.size > 0 && !f.statuses.has(p.status)) return false
  if (f.categories.size > 0 && !f.categories.has(p.category)) return false
  if (f.evidenced === 'evidenced' && !p.evidenced) return false
  if (f.evidenced === 'speculative' && p.evidenced) return false
  return true
}

/** Filter state for the Coverage edge lists; an empty set on any axis means "all". */
export interface CoverageFilter {
  statuses: ReadonlySet<EdgeCoverage['status']>
  modalities: ReadonlySet<string>
  sources: ReadonlySet<string>
}

/** Whether a coverage edge row passes the panel filter (empty sets pass through). */
export function matchCoverageRow(row: EdgeCoverage, f: CoverageFilter): boolean {
  if (f.statuses.size > 0 && !f.statuses.has(row.status)) return false
  if (f.modalities.size > 0 && !f.modalities.has(row.modality)) return false
  if (f.sources.size > 0 && !f.sources.has(row.source)) return false
  return true
}
