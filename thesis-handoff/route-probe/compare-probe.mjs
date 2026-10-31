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
import { norm, routeBuckets } from './buckets.mjs'

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

/** Routes whose address is decided by a UrlMatcher, which neither reader can resolve to a string. */
function matcherRoutes(routes) {
  return routes.filter((r) => r.hasMatcher).length
}

/**
 * Splits the probe's screens into the leaves a user navigates to and the shells
 * that only wrap children, since the extractor mints a node for the first kind
 * and treats the second as scope.
 */
function splitShells(screens) {
  const leaves = new Map()
  const shells = new Map()
  for (const [p, r] of screens) {
    // `probeScreens` has already preferred a leaf wherever one sits at the address, so a route
    // left here with children is one no empty-path child answers for: the prefix carries a layout
    // and the URL itself reaches nothing.
    if (r.hasChildren || r.hasLoadChildren) shells.set(p, r)
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

/**
 * The addresses at which some route redirects, which for a prefix is how the framework answers the
 * prefix's own URL: an empty-path descendant shares the prefix's address, and when that descendant
 * carries a redirectTo, navigating to the prefix reaches a screen further down. Navigating the
 * built mifos application confirmed the two cases apart -- /remittances is recognised and
 * redirected to /remittances/process, while /collections answers with the shell and no screen of
 * its own -- so the one prefix-only column has to be read as two different phenomena.
 */
function redirectingAddresses(routes) {
  const out = new Set()
  for (const r of routes) {
    if (!r.redirectTo) continue
    if (r.outlet && r.outlet !== 'primary') continue
    if (r.underMatcher) continue
    out.add(norm(r.fullPath))
  }
  return out
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
// The licence downstream reads an empty lazyFailures as proof that no subtree was left
// unexpanded, so a probe file that simply lacks the field must not be read as one that declared
// nothing: that is the absence of evidence standing in for evidence of absence.
if (!Array.isArray(probe.lazyFailures)) {
  console.error(`${a.probe}: a probe that ran must carry a lazyFailures array`)
  process.exit(1)
}
const oracle = JSON.parse(readFileSync(a.oracle, 'utf8'))

const framework = routeBuckets(probe.routes).screens
const { leaves, shells } = splitShells(framework)
const extractor = extractorScreens(a.db)
const declared = oracleScreens(oracle)

const prefixOnly = minus(shells, extractor)
const redirecting = redirectingAddresses(probe.routes)

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
  // Every address the framework answers with a screen, so a later reader does not have to derive
  // the set a second time and risk deriving it differently.
  frameworkAddresses: [...framework.keys()],
  invented: minus(extractor, framework),
  missed: minus(leaves, extractor),
  // A prefix route that carries a layout component but mounts no screen of its own is one the
  // extractor is right to mint nothing at. It is still an address the framework's configuration
  // holds and the extractor's set does not, and reporting the navigable difference without this
  // one would be reporting only the half that flatters. The two sublists say which kind each is:
  // one answers its URL by redirecting into the subtree, the other answers it with the shell
  // alone. Their counts sum to this list's, so a reader of either number is reading the same set.
  missedPrefixOnly: prefixOnly,
  missedPrefixRedirect: prefixOnly.filter((p) => redirecting.has(p)),
  missedPrefixUnanswered: prefixOnly.filter((p) => !redirecting.has(p)),
  sharedBlindSpot: minus(extractor, framework).filter((p) => declared.has(p)),
  oracleOnly: minus(declared, framework),
  frameworkOnlyVsOracle: minus(leaves, declared),
  lazyFailures: probe.lazyFailures,
  routeSet: declaredIncomplete(a.db),
}
report.counts.invented = report.invented.length
report.counts.missed = report.missed.length
report.counts.missedPrefixOnly = report.missedPrefixOnly.length
report.counts.missedPrefixRedirect = report.missedPrefixRedirect.length
report.counts.missedPrefixUnanswered = report.missedPrefixUnanswered.length
report.counts.sharedBlindSpot = report.sharedBlindSpot.length
report.counts.matcherRoutes = matcherRoutes(probe.routes)

if (a.out) writeFileSync(a.out, JSON.stringify(report, null, 2))
const c = report.counts
console.log(`${report.slug}: framework=${c.frameworkScreens} (leaf ${c.frameworkLeaves} + shell ${c.frameworkShells}) extractor=${c.extractorNodes} oracle=${c.oracleDeclared}`)
console.log(`  invented (extractor mints, framework does not mount): ${c.invented}`)
console.log(`  missed (framework mounts, extractor has no node):      ${c.missed} (+${c.missedPrefixOnly} prefix-only: ${c.missedPrefixRedirect} redirect, ${c.missedPrefixUnanswered} unanswered)`)
console.log(`  matcher routes (address unreadable by any reader):     ${c.matcherRoutes}`)
console.log(`  shared blind spot (extractor AND oracle, not framework): ${c.sharedBlindSpot}`)
console.log(`  extractor declares its route set incomplete:            ${report.routeSet.declares}`)
