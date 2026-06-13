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

function normalizeTarget(target: string): string {
  return target.split('?')[0]?.split('#')[0] ?? target
}

/**
 * Resolve a literal target into an exact match (the only result safe to assert as
 * a `must`-edge) and the set of parameterized patterns it could also match.
 * Ambiguity (no exact, or several `:param` candidates) must NOT become a single
 * `must`-edge — the caller fans it out to `may`-edges over the candidates.
 */
export function matchLiteralAll(target: string, routes: RouteLike[]): { exact: RouteLike | null; candidates: RouteLike[] } {
  const norm = normalizeTarget(target)
  const exact = routes.find((r) => r.fullPath === norm) ?? null
  const candidates = routes.filter((r) => r.fullPath !== norm && patternMatches(norm, r.fullPath))
  return { exact, candidates }
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
