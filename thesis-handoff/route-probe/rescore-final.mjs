/**
 * Re-scores the rendered-interface (scope) check against the final graph without re-running the
 * browser. scope-check.mjs read each screen's rendered links once (results/<slug>.scope.json,
 * harness 1.3.0) against a graph whose extractor commit was not recorded; the observations it kept
 * (address, where the router landed, the links read, the opaque count) do not depend on the graph.
 * This recomputes the predicted side from the final graph with scope-check.mjs's own rules and
 * writes results-final/<slug>.scope.json in the same shape, stamped as a re-score.
 *
 * Usage: pnpm exec tsx rescore-final.mjs --slug <s> --db <final uigraph.db> [--before results] [--out results-final]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** scope-check.mjs's address normaliser. */
export function norm(p) {
  if (typeof p !== 'string') return null
  const s = `/${p}`.replace(/\/+/g, '/').replace(/[?#].*$/, '').replace(/\/$/, '')
  return s === '' ? '/' : s
}
const segs = (p) => norm(p).split('/').filter(Boolean)

/** scope-check.mjs's pattern match: a hole answers any one segment, a wildcard nothing. */
export function matchesPattern(concrete, pattern) {
  if (pattern === '*' || pattern === '/*') return false
  const c = segs(concrete)
  const t = segs(pattern)
  if (c.length !== t.length) return false
  return t.every((s, i) => s.startsWith(':') || s === c[i])
}

/**
 * One stored row re-scored: the observation fields are kept, every predicted field is recomputed
 * from `clicks` (the click edges the final graph has leaving the screen) exactly as scope-check.mjs
 * computes them.
 */
export function rescoreRow(row, clicks, routeOf) {
  if (row.error) return row
  const routesOf = (es) => [...new Set(es.map((e) => routeOf(e.to)).filter((r) => typeof r === 'string'))]
  const predicted = routesOf(clicks)
  const approximated = routesOf(clicks.filter((e) => e.confidence !== undefined && e.confidence < 1))
  const definite = predicted.filter((p) => !approximated.includes(p))
  const observed = row.observed
  const confirmed = observed.filter((o) => predicted.some((p) => matchesPattern(o, p) || norm(p) === o))
  const unpredicted = observed.filter((o) => !confirmed.includes(o))
  const notRendered = (p) => !observed.some((o) => matchesPattern(o, p) || norm(p) === o)
  const asPattern = (o) => predicted.find((q) => matchesPattern(o, q) || norm(q) === o) ?? o
  const patterns = [...new Set(observed.map(asPattern))]
  return {
    address: row.address, landed: row.landed, stayed: row.stayed, predicted, observed, confirmed, unpredicted,
    unrendered: predicted.filter(notRendered), definite, approximated, overAttributed: definite.filter(notRendered),
    patterns, patternsConfirmed: patterns.filter((q) => predicted.includes(q)),
    patternsUnpredicted: patterns.filter((q) => !predicted.includes(q)), opaque: row.opaque,
  }
}

/** The report fields scope-check.mjs derives from its rows. */
export function summarise(rows) {
  const usable = rows.filter((r) => !r.error && r.stayed)
  const tot = (k) => usable.reduce((a, r) => a + r[k].length, 0)
  return {
    visited: rows.length, usable: usable.length,
    redirectedAway: rows.filter((r) => !r.error && !r.stayed).length, errors: rows.filter((r) => r.error).length,
    pairs: tot('patterns'), pairsConfirmed: tot('patternsConfirmed'), pairsUnpredicted: tot('patternsUnpredicted'),
    observedLinks: tot('observed'), confirmed: tot('confirmed'), unpredicted: tot('unpredicted'), unrendered: tot('unrendered'),
    predictedDefinite: tot('definite'), predictedApprox: tot('approximated'), overAttributed: tot('overAttributed'),
    opaqueLinks: usable.reduce((a, r) => a + (r.opaque || 0), 0),
  }
}

/** Reads the stored observations and the final graph, re-scores every row and writes the result. */
async function main() {
  const a = { before: 'results', out: 'results-final' }
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
  const { DatabaseSync } = await import('node:sqlite')
  const { edgesFrom } = await import('@ui-graph/core')
  const before = JSON.parse(readFileSync(join(a.before, `${a.slug}.scope.json`), 'utf8'))
  const db = new DatabaseSync(a.db, { readOnly: true })
  const graph = JSON.parse(db.prepare("select json from docs where key = 'graph'").get().json)
  const screens = graph.nodes.filter((n) => n.kind === 'screen' && typeof n.route === 'string' && n.route.startsWith('/'))
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const rows = before.rows.map((r) => {
    const node = screens.find((n) => n.route === r.address)
    const clicks = node ? edgesFrom(graph, node.id).filter((e) => String(e.event || '').startsWith('click')) : []
    return rescoreRow(r, clicks, (id) => byId.get(id)?.route)
  })
  const report = {
    scopeHarness: before.scopeHarness, rescore: { graph: 'final (packages/ as at a9d29df)', observationsFrom: `${a.before}/${a.slug}.scope.json` },
    slug: a.slug, dist: before.dist, dbPath: a.db, screensInGraph: screens.length, ...summarise(rows), rows,
  }
  writeFileSync(join(a.out, `${a.slug}.scope.json`), JSON.stringify(report, null, 2))
  console.log(`${a.slug}: screens ${before.screensInGraph} -> ${screens.length}, pairs ${before.pairs}, confirmed ${before.pairsConfirmed} -> ${report.pairsConfirmed}, unpredicted ${before.pairsUnpredicted} -> ${report.pairsUnpredicted}, exact ${before.predictedDefinite} -> ${report.predictedDefinite}, over-attributed ${before.overAttributed} -> ${report.overAttributed}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
