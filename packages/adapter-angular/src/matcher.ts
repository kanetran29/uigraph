// Route matching: bound the codomain of a navigation by the declared route set
// (dossier §4.2). A literal target resolves to at most one route (must-edge); a
// non-literal target over-approximates to candidate routes (may-edges).

export interface RouteLike {
  fullPath: string
  nodeId: string
}

function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0)
}

/** Does a concrete path match a route pattern (':' segments are wildcards)? */
function patternMatches(target: string, pattern: string): boolean {
  if (pattern === '*' || pattern === '/*') return false
  const t = segments(target)
  const p = segments(pattern)
  if (t.length !== p.length) return false
  return p.every((seg, i) => seg.startsWith(':') || seg === t[i])
}

/**
 * Resolve a literal navigation target to a single declared route. Prefers an
 * exact path match, then a parameterized pattern match. Returns null if no
 * declared route matches (the caller records this as a soundiness gap).
 */
export function matchLiteral(target: string, routes: RouteLike[]): RouteLike | null {
  const norm = target.split('?')[0]?.split('#')[0] ?? target
  const exact = routes.find((r) => r.fullPath === norm)
  if (exact) return exact
  const byPattern = routes.find((r) => patternMatches(norm, r.fullPath))
  return byPattern ?? null
}

/**
 * Over-approximate a non-literal target by its static prefix: every declared
 * route that extends the prefix with at least one more segment is a candidate
 * (e.g. prefix "/products/" -> "/products/:id"). Returns may-edge candidates.
 */
export function matchPrefix(staticPrefix: string, routes: RouteLike[]): RouteLike[] {
  const pre = segments(staticPrefix)
  return routes.filter((r) => {
    const segs = segments(r.fullPath)
    if (segs.length <= pre.length) return false
    return pre.every((seg, i) => segs[i] === seg)
  })
}
