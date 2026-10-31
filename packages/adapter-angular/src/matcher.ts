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
 * Resolve a route-relative navigation target against the path of the screen it fires from,
 * the way Angular resolves a link whose `relativeTo` is the current route. Relative means
 * what Angular means by it: `./general`, `../edit`, and equally a bare `journal-entries/create`
 * — only a leading slash makes a target absolute. An absolute target is returned unchanged,
 * and so is any target fired from a node that has no path of its own: a scope anchor stands
 * for many screens, so there is no single base to resolve against.
 */
export function resolveRelativeTarget(target: string, ownerPath: string | undefined): string {
  if (!ownerPath || target === '' || target.startsWith('/') || target === '*') return target
  const out = segments(ownerPath)
  const rest = segments(target)
  let i = 0
  for (; i < rest.length; i++) {
    if (rest[i] === '.') continue
    if (rest[i] === '..') {
      out.pop()
      continue
    }
    break
  }
  return '/' + [...out, ...rest.slice(i)].join('/')
}

/**
 * The primary path of a URL that names auxiliary outlets, as Angular reads it:
 * `/inbox(popup:compose)` moves the primary outlet to `/inbox` and opens `compose` beside it.
 * A URL that names none comes back unchanged. When a parenthesised group also carries a primary
 * segment, as in `/a/(b//popup:c)`, the primary path is not rebuilt and null is returned.
 */
export function primaryPath(url: string): string | null {
  if (!url.includes('(')) return url
  let readable = true
  const out = url.replace(/\(([^()]*)\)/g, (_m, inner: string) => {
    if (!inner.split('//').every((part) => /^[\w-]+:/.test(part))) readable = false
    return ''
  })
  return readable && !out.includes('(') ? out : null
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
