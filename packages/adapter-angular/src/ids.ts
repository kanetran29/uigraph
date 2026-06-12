// Deterministic id schemes for nodes and edges. Pure string functions so the
// same source always yields the same ids (content-addressable graphs).

import { fnv1a } from '@uigraph/core'

/** Map a route pattern to a stable node id, e.g. "/products/:id" -> "n_products_id". */
export function routeToNodeId(fullPath: string): string {
  if (fullPath === '*' || fullPath === '/*') return 'n_wildcard'
  const slug = fullPath
    .replace(/:/g, '')
    .replace(/\*/g, 'wildcard')
    .split('/')
    .filter(Boolean)
    .join('_')
  return 'n_' + (slug.length > 0 ? slug : 'root')
}

/** Deterministic, collision-resistant edge id from endpoints, event, and guard. */
export function edgeId(from: string, to: string, event: string, guard: string | null): string {
  const tag = fnv1a(`${event}|${guard ?? ''}`).slice(0, 6)
  return `e_${from}__${to}__${tag}`
}
