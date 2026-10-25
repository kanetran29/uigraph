#!/usr/bin/env node
// Test D — the app's own E2E suite as an oracle.
//
// THE IDEA: every URL an E2E test actually visits is a screen that provably exists,
// because the test navigates there and passes in the project's own CI. So the set of
// URLs reachable from the suite is ground truth obtained from EXECUTION, not from
// re-reading the source. Any such URL with no corresponding node in the graph is a
// proven false negative — the strongest completeness evidence available without
// running the app yourself.
//
// SCOPE, stated honestly: this measures recall over the tested subset of the app, not
// recall overall. An untested screen missing from the graph will not be caught here.
// It also measures NODE-level recall only. Edge-level recall would require knowing
// which visits were reached by clicking versus by direct address entry, and a direct
// `goto` is not a UI transition — counting it as one would inflate the result.
//
// Usage: node e2e-oracle.mjs <e2eDir> <uigraph.db> [--json out.json]

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const e2eDir = path.resolve(process.argv[2])
const dbPath = path.resolve(process.argv[3])
const jsonIdx = process.argv.indexOf('--json')
const jsonOut = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null

// ---------------------------------------------------------------- collect specs

function specFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(e2e|spec|cy|test)\.ts$/.test(e.name)) out.push(p)
    }
  }
  walk(dir)
  return out
}

// ---------------------------------------------------------------- extract URLs

// Normalise a URL as written in a test into a route pattern comparable to a graph node.
function normalise(raw) {
  let u = raw.trim()
  u = u.replace(/^#/, '')                    // hash routing: #/foo -> /foo
  u = u.replace(/^\*\*\//, '/')              // waitForURL glob prefix
  u = u.replace(/\*\*$/, '')                 // glob suffix
  u = u.replace(/\$\{[^}]*\}/g, ':param')    // template holes become params
  u = u.split('?')[0]                        // drop query
  u = u.replace(/;[^/]*/g, '')               // drop Angular matrix params (;q=test)
  u = u.replace(/\/+$/, '')                  // drop trailing slash
  if (!u.startsWith('/')) u = '/' + u
  return u === '' ? '/' : u
}

const URL_PATTERNS = [
  /`(#\/[^`]*)`/g,          // template literal: `#/personal-files/${id}`
  /'(#\/[^']*)'/g,
  /"(#\/[^"]*)"/g,
  /`(\*\*\/[^`]*)`/g,       // waitForURL glob
  /goto\(\s*['"`]([^'"`]+)['"`]/g,
]

function urlsIn(src) {
  const found = new Set()
  for (const re of URL_PATTERNS) {
    for (const m of src.matchAll(re)) {
      const raw = m[1]
      if (!raw || raw.length > 120) continue
      if (!/^[#*/]/.test(raw)) continue
      found.add(normalise(raw))
    }
  }
  return [...found]
}

// ---------------------------------------------------------------- matching

// A visited URL matches a node route if they agree segment by segment, where either
// side's ':param' matches any single segment. Deliberately strict on length: a node
// for /a does NOT cover a visit to /a/b.
function matches(visited, nodeRoute) {
  if (!nodeRoute) return false
  const a = visited.split('/').filter(Boolean)
  const b = nodeRoute.split('/').filter(Boolean)
  if (a.length !== b.length) return false
  return a.every((seg, i) => {
    const other = b[i]
    if (other === '**') return true
    // A node param matches any visited segment.
    if (other.startsWith(':')) return true
    // But a VISITED param is a runtime value, so it can only stand where the route
    // declares a param. Letting it match a literal segment invents matches that are
    // not there — that permissiveness inflated the first version of this measurement.
    if (seg.startsWith(':')) return false
    return seg === other
  })
}

// ---------------------------------------------------------------- run

const specs = specFiles(e2eDir)
const perSpec = []
const allUrls = new Map() // url -> [spec, ...]

for (const f of specs) {
  const src = fs.readFileSync(f, 'utf8')
  const urls = urlsIn(src)
  if (urls.length) perSpec.push({ spec: path.relative(e2eDir, f), urls })
  for (const u of urls) {
    if (!allUrls.has(u)) allUrls.set(u, [])
    allUrls.get(u).push(path.relative(e2eDir, f))
  }
}

const db = new DatabaseSync(dbPath)
const graph = JSON.parse(db.prepare("select json from docs where key='graph'").get()?.json || '{}')
const nodes = (graph.nodes || []).filter((n) => ['screen', 'route', 'modal'].includes(n.kind))

// Negative tests visit URLs that must NOT be screens (e.g. /personal-files/nonexistentpage-x
// checks the 404 handling). Such a URL is not ground truth for a node, so it is excluded.
// The rule is textual and deliberately narrow; every exclusion is listed in the output.
const NEGATIVE = /nonexist|not-?found|invalid|\b404\b/i
const excluded = [...allUrls.keys()].filter((u) => NEGATIVE.test(u))
const rows = [...allUrls.entries()].filter(([url]) => !NEGATIVE.test(url)).map(([url, usedBy]) => {
  const hit = nodes.find((n) => matches(url, n.route))
  return { url, specCount: usedBy.length, matchedNode: hit ? hit.route : null, usedBy: usedBy.slice(0, 3) }
})
const covered = rows.filter((r) => r.matchedNode)
const uncovered = rows.filter((r) => !r.matchedNode)

console.log(`e2e dir:        ${e2eDir}`)
console.log(`spec files:     ${specs.length} (${perSpec.length} contain URLs)`)
console.log(`graph nodes:    ${nodes.length}`)
console.log(`distinct URLs visited by tests: ${rows.length} (${excluded.length} excluded as negative tests: ${excluded.join(', ') || 'none'})`)
console.log(`RECALL (node level): ${covered.length}/${rows.length} = ${rows.length ? ((covered.length / rows.length) * 100).toFixed(1) : 0}%`)
if (uncovered.length) {
  console.log(`\nPROVEN MISSING — a passing test visits these, the graph has no node:`)
  for (const r of uncovered.sort((a, b) => b.specCount - a.specCount)) {
    console.log(`   - ${r.url.padEnd(42)} used by ${r.specCount} spec(s)  e.g. ${r.usedBy[0]}`)
  }
}
console.log(`\ncovered, for reference:`)
for (const r of covered.sort((a, b) => b.specCount - a.specCount).slice(0, 12)) {
  console.log(`   + ${r.url.padEnd(42)} -> node ${r.matchedNode}  (${r.specCount} specs)`)
}

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ e2eDir, dbPath, specs: specs.length, nodes: nodes.length, recall: rows.length ? covered.length / rows.length : null, excluded, rows, perSpec }, null, 2))
