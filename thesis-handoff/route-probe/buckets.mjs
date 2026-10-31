/**
 * The one reading of a probed route the census rests on: which bucket a route entry falls in, and
 * so whether it contributes an address to the mounted set. compare-probe.mjs takes its screen set
 * from here and to-latex.mjs builds the published closure from the same function, so the accounting
 * is tested against the reading the census actually used and not against a second copy of it that
 * could drift from it --- which is the failure this chapter is about.
 */

/**
 * Normalises an address so the readings can be compared as strings. The extractor writes Angular's
 * catch-all as a single star and the framework holds the two the router actually declares, so both
 * are brought to one spelling.
 */
export function norm(p) {
  if (typeof p !== 'string') return null
  const s = `/${p}`.replace(/\/+/g, '/').replace(/\/$/, '')
  if (s === '') return '/'
  return s.replace(/\/\*$/, '/**')
}

/**
 * Every reason a route entry places no screen at an address of its own, in the order they apply.
 * The list is the single place an exclusion may be declared: the counts, the macros and the columns
 * of the closure table are all generated from these names, so an exclusion added to the classifier
 * without being named here cannot be reached, and one named here appears in the published table
 * whether or not anybody remembered to add a column for it.
 */
export const EXCLUSIONS = [
  ['redirect', (r) => typeof r.redirectTo === 'string'],
  ['namedOutlet', (r) => !!r.outlet && r.outlet !== 'primary'],
  // Angular standardises a route that has children and an outlet by giving it an empty outlet
  // component of its own. That component renders nothing of the application, so an address whose
  // only component is that one places no screen.
  ['emptyOutlet', (r) => r.component === 'ɵEmptyOutletComponent'],
  // A route whose address comes from a UrlMatcher, and anything beneath it, has no address the
  // probe can read. Filing it under its parent would claim the parent answers a URL it does not.
  ['underMatcher', (r) => !!r.underMatcher],
  ['componentless', (r) => !r.component && !r.hasLoadComponent],
]

/** The bucket a route is excluded by, or null when it reaches the mounted set. */
function exclusion(route) {
  for (const [name, hit] of EXCLUSIONS) if (hit(route)) return name
  return null
}

/** Does this route place a component of the application, as against the framework's own filler? */
export function placesComponent(route) {
  if (route.component === 'ɵEmptyOutletComponent') return false
  return !!route.component || !!route.hasLoadComponent
}

/**
 * Buckets every route entry exactly once and returns the surviving address map beside the counts.
 * `mounted` is the addresses left, `collapsed` the entries a surviving entry already answers for,
 * and the rest are the exclusions above. `stray` counts an entry that places a component of the
 * application and is excluded for a reason the table does not show as a loss --- a screen dropped
 * silently --- and the caller is expected to refuse a run with any.
 */
export function routeBuckets(routes) {
  const screens = new Map()
  const counts = { mounted: 0, collapsed: 0 }
  for (const [name] of EXCLUSIONS) counts[name] = 0
  let candidates = 0
  let stray = 0
  for (const r of routes) {
    const why = exclusion(r)
    if (why) {
      counts[why] += 1
      // A loss the table shows is `namedOutlet` or `underMatcher`; any other exclusion that drops a
      // component is a screen leaving the census with nothing saying so.
      if (placesComponent(r) && why !== 'namedOutlet' && why !== 'underMatcher') stray += 1
      continue
    }
    candidates += 1
    const p = norm(r.fullPath)
    const kept = screens.get(p)
    // Several routes can sit at one address: a prefix carrying a layout, and an empty-path child of
    // it carrying the screen. Angular answers the URL because of the second. Keeping whichever came
    // first kept the prefix, and the address was then filed as one that answers nothing.
    const isLeaf = !r.hasChildren && !r.hasLoadChildren
    if (!kept || (isLeaf && (kept.hasChildren || kept.hasLoadChildren))) screens.set(p, r)
  }
  counts.mounted = screens.size
  counts.collapsed = candidates - screens.size
  return { screens, counts, stray }
}

/**
 * The screens the census has no address for at all: a route on a named outlet, reached only through
 * an auxiliary URL segment, and one whose address a UrlMatcher decides. These are not addresses the
 * census declines to credit --- they are components the application places that no column of the
 * comparison can name, so they belong in the table beside the exclusions that cost nothing.
 */
export function unaddressableScreens(routes) {
  const out = { namedOutlet: 0, matcher: 0 }
  for (const r of routes) {
    if (!placesComponent(r) || typeof r.redirectTo === 'string') continue
    const why = exclusion(r)
    if (why === 'namedOutlet') out.namedOutlet += 1
    else if (why === 'underMatcher') out.matcher += 1
  }
  return out
}
