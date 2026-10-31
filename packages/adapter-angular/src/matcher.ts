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
 * The path a URL string reaches in the primary outlet, read the way `navigateByUrl` parses it:
 * the query, the fragment and each segment's matrix parameters are not part of the path, and a
 * parenthesised group addresses an auxiliary outlet (`/inbox(popup:compose)`), which the adapter
 * does not model, so `aux` says the URL named one. A group that also carries the primary outlet,
 * as in `/(primary:inbox//popup:x)`, is not rebuilt, and null is returned. Only a URL is read this
 * way: a `routerLink` string or a `navigate` command is split on slashes alone, and Angular keeps
 * every other character in the segment, so those are matched as written.
 */
export function urlPath(url: string): { path: string; aux: boolean } | null {
  const bare = (url.split('#')[0] ?? '').split('?')[0] ?? ''
  let aux = false
  let readable = true
  const out = bare.replace(/\(([^()]*)\)/g, (_m, inner: string) => {
    aux = true
    if (!inner.split('//').every((part) => /^[\w-]+:/.test(part) && !part.startsWith('primary:'))) readable = false
    return ''
  })
  if (!readable || /[()]/.test(out)) return null
  return { path: out.split('/').map((seg) => seg.split(';')[0]).join('/'), aux }
}

/** Every declared route a target can reach, exact or by a parameter pattern. */
export function matchAll(target: string, routes: RouteLike[]): RouteLike[] {
  return routes.filter((r) => r.fullPath === target || patternMatches(target, r.fullPath))
}

/**
 * Resolve a navigation target to a single declared route. Prefers an exact path match, then a
 * parameterized pattern match. Returns null if no declared route matches (the caller records
 * this as a soundiness gap). A URL drops its query and fragment first; a command is matched as
 * written.
 */
export function matchLiteral(target: string, routes: RouteLike[], asUrl = true): RouteLike | null {
  const norm = asUrl ? target.split('?')[0]?.split('#')[0] ?? target : target
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
