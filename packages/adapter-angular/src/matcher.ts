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
 * How many leading segments of `ownerPath` a relative target keeps as they are, matrix parameters
 * included: all but those its leading `..` climb out of. An absolute target keeps none, and so
 * does one fired from a node with no path of its own.
 */
export function keptSegments(target: string, ownerPath: string | undefined): number {
  if (!ownerPath || target.startsWith('/') || target === '*') return 0
  let kept = segments(ownerPath).length
  for (const seg of segments(target)) {
    if (seg === '.') continue
    if (seg !== '..') break
    kept -= 1
  }
  return Math.max(0, kept)
}

/**
 * Whether a route pattern can match an address, segment by segment, where a parameter on either
 * side matches anything. With `prefix` the address may go on past the pattern, as it does for a
 * route with children or a redirect with `pathMatch: 'prefix'`; a trailing catch-all matches
 * whatever is left. With `every` the address is itself a pattern and the question is whether the
 * route matches every address it stands for, so a parameter in it is matched only by a parameter:
 * a literal there matches one value of it.
 */
export function overlaps(address: string, pattern: string, prefix: boolean, every = false): boolean {
  const a = segments(address)
  const p = segments(pattern)
  const wild = p[p.length - 1] === '*'
  const fixed = wild ? p.slice(0, -1) : p
  if (a.length < fixed.length || (!prefix && !wild && a.length > fixed.length)) return false
  return fixed.every((seg, i) => seg === a[i] || seg.startsWith(':') || (!every && a[i]!.startsWith(':')))
}

/**
 * Where a redirect declared at pattern `at` sends an address the pattern consumes whole, as
 * Angular applies `redirectTo`: each `:name` segment of `to` takes the segment the pattern binds
 * to that name. Null when segments are left over, whose fate turns on whether `to` was written
 * relative, which the full path does not keep, and when `to` names a parameter the pattern does
 * not bind, which Angular rejects.
 */
export function redirectAddress(address: string, at: string, to: string): string | null {
  const a = segments(address)
  const p = segments(at)
  if (a.length !== p.length || p.includes('*')) return null
  const bound = new Map(p.flatMap((seg, i) => (seg.startsWith(':') ? [[seg, a[i]!] as const] : [])))
  const out = to.split('/').map((seg) => (seg.startsWith(':') ? bound.get(seg) : seg))
  return out.includes(undefined) ? null : out.join('/')
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
