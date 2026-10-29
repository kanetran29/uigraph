/**
 * Compares three readings of one application's screen set: the extractor's
 * graph, the static oracle's declared routes, and the probe's reading of the
 * framework's own live configuration. The third is the only one that is not a
 * re-implementation of Angular, so a cell where the first two agree and the
 * third does not is a blind spot the corpus could not otherwise expose.
 *
 * Usage: node compare-probe.mjs --probe <f> --oracle <f> --db <f> --out <f>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/** Reads the flags this script takes into a plain object. */
function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    out[key] = next && !next.startsWith('--') ? next : true
  }
  return out
}

/**
 * Normalises an address so the three readings can be compared as strings. The
 * extractor writes Angular's catch-all as a single star and the framework holds
 * the two the router actually declares, so both are brought to one spelling.
 */
function norm(p) {
  if (typeof p !== 'string') return null
  const s = `/${p}`.replace(/\/+/g, '/').replace(/\/$/, '')
  if (s === '') return '/'
  return s.replace(/\/\*$/, '/**')
}

/**
 * The addresses the framework mounts a component at. A route that only
 * redirects places no screen, and one on a named outlet is not reached at the
 * primary address, so neither counts.
 */
function probeScreens(routes) {
  const out = new Map()
  for (const r of routes) {
    if (r.redirectTo) continue
    if (r.outlet && r.outlet !== 'primary') continue
    // Angular standardises a route that has children and an outlet by giving it an empty outlet
    // component of its own. That component renders nothing of the application, so an address whose
    // only component is that one places no screen.
    if (r.component === 'ɵEmptyOutletComponent') continue
    // A route whose address comes from a UrlMatcher, and anything beneath it, has no address this
    // probe can read. Filing it under its parent would claim the parent answers a URL it does not.
    if (r.underMatcher) continue
    if (!r.component && !r.hasLoadComponent) continue
    const p = norm(r.fullPath)
    if (!out.has(p)) out.set(p, r)
  }
  return out
}

/** Routes whose address is decided by a UrlMatcher, which neither reader can resolve to a string. */
function matcherRoutes(routes) {
  return routes.filter((r) => r.hasMatcher).length
}

/**
 * Splits the probe's screens into the leaves a user navigates to and the shells
 * that only wrap children, since the extractor mints a node for the first kind
 * and treats the second as scope.
 */
function splitShells(screens, routes) {
  const parents = new Set()
  for (const r of routes) {
    if (r.hasChildren || r.hasLoadChildren) parents.add(norm(r.fullPath))
  }
  const leaves = new Map()
  const shells = new Map()
  for (const [p, r] of screens) {
    if ((r.hasChildren || r.hasLoadChildren) && parents.has(p)) shells.set(p, r)
    else leaves.set(p, r)
  }
  return { leaves, shells }
}

/** The screen addresses the extractor's graph holds, read out of its database. */
function extractorScreens(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const row = db.prepare('select json from docs where key = ?').get('graph')
  const graph = JSON.parse(row.json)
  const out = new Map()
  for (const n of graph.nodes) {
    if (n.kind !== 'screen') continue
    const p = norm(n.route)
    if (p) out.set(p, n)
  }
  return out
}

/**
 * What the extractor said about its own route set, taken from the same database. The comparison
 * reports it beside the probe's finding so that "the framework mounts a screen the extractor does
 * not have" can be read against "the extractor said it could not read part of the route set":
 * a miss under a declared blind spot is the tool behaving as it claims, and one without a
 * declaration is the tool asserting a completeness it does not have.
 */
function declaredIncomplete(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const row = db.prepare('select json from docs where key = ?').get('soundiness')
  if (!row) return { declares: false, details: [] }
  const notes = JSON.parse(row.json)
  const list = Array.isArray(notes) ? notes : (notes.notes ?? [])
  const details = list.filter((n) => n.kind === 'incomplete-route-set').map((n) => n.detail)
  return { declares: details.length > 0, details }
}

/** The screen addresses the static oracle declares. */
function oracleScreens(oracle) {
  const out = new Map()
  for (const r of oracle.routes || []) {
    if (r.kind !== 'SCREEN') continue
    const p = norm(r.path)
    if (p) out.set(p, r)
  }
  return out
}

/** Members of a that b does not hold, in order. */
function minus(a, b) {
  return [...a.keys()].filter((k) => !b.has(k))
}

const a = args(process.argv.slice(2))
if (!a.probe || !a.oracle || !a.db) {
  console.error('usage: node compare-probe.mjs --probe <f> --oracle <f> --db <f> [--out <f>]')
  process.exit(2)
}

const probe = JSON.parse(readFileSync(a.probe, 'utf8'))
if (!probe.ok) {
  console.error(`probe did not run: ${probe.reason}`)
  process.exit(1)
}
const oracle = JSON.parse(readFileSync(a.oracle, 'utf8'))

const framework = probeScreens(probe.routes)
const { leaves, shells } = splitShells(framework, probe.routes)
const extractor = extractorScreens(a.db)
const declared = oracleScreens(oracle)

const report = {
  slug: probe.slug,
  counts: {
    probeRoutes: probe.routes.length,
    frameworkScreens: framework.size,
    frameworkLeaves: leaves.size,
    frameworkShells: shells.size,
    extractorNodes: extractor.size,
    oracleDeclared: declared.size,
  },
  invented: minus(extractor, framework),
  missed: minus(leaves, extractor),
  // A prefix route that carries a layout component but no empty-path child answers no URL of its
  // own, so the extractor is right not to mint a screen there. It is still an address the
  // framework's configuration holds and the extractor's set does not, and reporting the
  // navigable difference without this one would be reporting only the half that flatters.
  missedPrefixOnly: minus(shells, extractor),
  sharedBlindSpot: minus(extractor, framework).filter((p) => declared.has(p)),
  oracleOnly: minus(declared, framework),
  frameworkOnlyVsOracle: minus(leaves, declared),
  lazyFailures: probe.lazyFailures || [],
  routeSet: declaredIncomplete(a.db),
}
report.counts.invented = report.invented.length
report.counts.missed = report.missed.length
report.counts.missedPrefixOnly = report.missedPrefixOnly.length
report.counts.sharedBlindSpot = report.sharedBlindSpot.length
report.counts.matcherRoutes = matcherRoutes(probe.routes)

if (a.out) writeFileSync(a.out, JSON.stringify(report, null, 2))
const c = report.counts
console.log(`${report.slug}: framework=${c.frameworkScreens} (leaf ${c.frameworkLeaves} + shell ${c.frameworkShells}) extractor=${c.extractorNodes} oracle=${c.oracleDeclared}`)
console.log(`  invented (extractor mints, framework does not mount): ${c.invented}`)
console.log(`  missed (framework mounts, extractor has no node):      ${c.missed} (+${c.missedPrefixOnly} prefix-only)`)
console.log(`  matcher routes (address unreadable by any reader):     ${c.matcherRoutes}`)
console.log(`  shared blind spot (extractor AND oracle, not framework): ${c.sharedBlindSpot}`)
console.log(`  extractor declares its route set incomplete:            ${report.routeSet.declares}`)
