#!/usr/bin/env node
// Test B — automated witness verification (edge PRECISION).
//
// The IR spec asserts a golden invariant: no edge enters the base graph without a
// deterministic witness. This checks that the invariant actually holds, mechanically.
// For every static edge it re-opens the witness file at the claimed line and asks three
// questions, in order of severity:
//
//   1. Is there a navigation construct there at all?        -> NO_CONSTRUCT / OFF_BY_N
//   2. Is it the KIND of construct the ruleId claims?       -> MISLABELLED
//   3. Does its target agree with the edge's `to` node?     -> TARGET_MISMATCH
//
// Question 3 is the one that matters most and the one a human audit found broken: an
// edge claimed to reach /profile/:u/favorites while its witness line held a link to
// /profile/:u. The witness pointed at a real construct, just the wrong one.
//
// Unlike an LLM audit this is reproducible and re-runnable, which is what thesis
// evidence has to be.
//
// Usage: node witness-check.mjs <appDir> <uigraph.db> [--window N] [--json out.json]

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const appDir = path.resolve(process.argv[2])
const dbPath = path.resolve(process.argv[3])
const wIdx = process.argv.indexOf('--window')
const WINDOW = wIdx > -1 ? parseInt(process.argv[wIdx + 1], 10) : 3
const jIdx = process.argv.indexOf('--json')
const jsonOut = jIdx > -1 ? process.argv[jIdx + 1] : null
const rIdx = process.argv.indexOf('--routes')
const routesFile = rIdx > -1 ? process.argv[rIdx + 1] : null

const db = new DatabaseSync(dbPath)
const graph = JSON.parse(db.prepare("select json from docs where key='graph'").get()?.json || '{}')
const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]))
const edges = graph.edges || []

// ---------------------------------------------------------------- construct detection

// Each rule says how to recognise its construct on a line, and how to read its target.
const RULES = {
  'ng.router-link': {
    ext: '.html',
    detect: (l) => /\[?routerLink\]?\s*=/.test(l),
    target: (l) => {
      // routerLink="/a/b"  |  [routerLink]="['/a', x]"  |  [routerLink]="['/a', x, 'b']"
      // The leading form is kept: a link without a slash is relative to the screen, and the
      // caller resolves it there. Forcing a slash here read every relative link as absolute.
      const plain = l.match(/routerLink\s*=\s*"([^"]*)"/)
      if (plain) return plain[1]
      const arr = l.match(/\[routerLink\]\s*=\s*"\[([^\]]*)\]"/)
      if (!arr) return null
      const parts = [...arr[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2])
      const dyn = arr[1].split(',').length - parts.length
      const p = parts.join('/').replace(/\/+/g, '/')
      return dyn > 0 ? p + '/:param'.repeat(dyn) : p
    },
  },
  'ng.navigate': {
    ext: '.ts',
    detect: (l) => /[Rr]outer[\w$]*\s*\.\s*navigate(ByUrl)?\s*\(/.test(l) || /\.navigate(ByUrl)?\(\s*\[/.test(l),
    target: (l) => {
      const url = l.match(/navigateByUrl\(\s*['"`]([^'"`]+)/)
      if (url) return url[1].split('?')[0]
      const arr = l.match(/navigate\(\s*\[([^\]]*)\]/)
      if (!arr) return null
      const parts = [...arr[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2])
      const dyn = arr[1].split(',').filter((s) => s.trim()).length - parts.length
      const p = parts.join('/').replace(/\/+/g, '/')
      return dyn > 0 ? p + '/:param'.repeat(dyn) : p
    },
  },
}

RULES['ng.navigate-by-url'] = RULES['ng.navigate']

/** Resolve a route-relative target against the path of the screen the edge fires from. */
function resolveRelative(target, fromRoute) {
  if (!target || !fromRoute || target.startsWith('/') || target === '*') return target
  const out = fromRoute.split('/').filter(Boolean)
  const rest = target.split('/').filter(Boolean)
  let i = 0
  for (; i < rest.length; i++) {
    if (rest[i] === '.') continue
    if (rest[i] === '..') { out.pop(); continue }
    break
  }
  return '/' + [...out, ...rest.slice(i)].join('/')
}

// Route-pattern comparison: a declared param matches any single concrete segment.
function targetAgrees(found, nodeRoute) {
  if (!found || !nodeRoute) return null // not checkable, do not penalise
  const a = found.split('/').filter(Boolean)
  const b = nodeRoute.split('/').filter(Boolean)
  if (a.length !== b.length) return false
  return a.every((seg, i) => b[i].startsWith(':') || seg.startsWith(':') || seg === b[i])
}

// ---------------------------------------------------------------- check

const fileCache = new Map()
function lines(abs) {
  if (!fileCache.has(abs)) {
    try { fileCache.set(abs, fs.readFileSync(abs, 'utf8').split('\n')) }
    catch { fileCache.set(abs, null) }
  }
  return fileCache.get(abs)
}

// An over-approximated edge is one the extractor emitted because it could NOT resolve a
// dynamic target, so it connected the call site to many declared routes. The IR spec is
// explicit that such an edge's witness proves the CALL SITE exists, not that the
// transition fires. Asking "does the witness target match the edge's target" is therefore
// an invalid question for them, and asking it anyway produced a 44.7% "precision" for
// mifos that was pure artefact: 177 of its edges are one fan-out from a single line.
// Fan-out is detected structurally — many edges citing one witness location.
const witnessFanout = new Map()
for (const e of edges) {
  const w = e.witness || {}
  if (!w.file) continue
  const k = `${w.file}:${w.loc?.line}`
  witnessFanout.set(k, (witnessFanout.get(k) || 0) + 1)
}
const FANOUT_THRESHOLD = 3

const decl = routesFile
  ? (() => {
      const r = JSON.parse(fs.readFileSync(routesFile, 'utf8'))
      const segs = (r.routes || []).map((x) => String(x.path ?? '').split('/').filter(Boolean))
      return {
        // The application root is a declared address like any other, and dropping it because
        // it has no segments made every edge into `/` read as a fictitious destination.
        root: segs.some((d) => d.length === 0),
        routes: segs.filter((d) => d.length),
        blind: (r.blindSpots || []).map((b) => String(b.prefix ?? '').split('/').filter(Boolean)).filter((d) => d.length),
      }
    })()
  : null

/**
 * Does the independent route set declare an address at `route`? Compared pattern to pattern,
 * a declared param matching any single segment either way, which is the same comparison
 * `targetAgrees` makes one level down.
 *
 * This exists because the three questions above all take the edge's destination NODE for
 * granted and ask only whether the witness agrees with it. A node minted at an address the
 * application never mounts therefore passes every one of them: mifos's reports module was read
 * at the project root, so the graph held `/:filter` and `/run/:name` instead of
 * `/reports/:filter` and `/reports/run/:name`, and edges pointed at those addresses while this
 * check reported the must tier clean. No count of them is given here because the defect is
 * repaired and the graph that carried it is gone, so the figure cannot be re-measured on demand.
 * The soundness lemma is about the destination, so the destination has to be tested too.
 * The test is off unless `--routes` is given: `destinationsChecked` in the output says which of
 * the two this run was, because a run without it judges the must tier by three questions and not
 * by four, and a reader cannot tell the two apart from the verdicts alone.
 *
 * Two things about the comparison itself. Both sides are patterns, so a param may only answer a
 * param: the looser comparison used when matching a concrete URL against a route would excuse
 * the exact defect this test is for, because `/:filter` would match any one-segment route the
 * application happens to declare. And a route inside a subtree the oracle could not open is not
 * evidence of anything, so a blind spot answers for every address beneath it rather than
 * condemning it.
 */
function declaredHere(route) {
  if (!decl) return null
  const t = route.split('/').filter(Boolean)
  if (!t.length) return decl.root
  const seg = (s, i) => s === t[i] || (s.startsWith(':') && t[i].startsWith(':'))
  const same = (d) => d.length === t.length && d.every(seg)
  const covers = (d) => d.length > 0 && d.length <= t.length && d.every(seg)
  if (decl.blind.some(covers)) return true
  return decl.routes.some(same)
}

const findings = []
let ok = 0
// A witness in a file outside the application directory cannot be checked as this
// application's navigation: a shared component library it renders is legitimate, a sibling
// application reached through a workspace alias is not, and the witness alone does not say
// which. Counted and reported rather than judged.
let outsideApp = 0, outsideAppMust = 0

for (const [i, e] of edges.entries()) {
  const w = e.witness || {}
  // `edgeIndex` is how a finding is matched back to its edge. Matching by the printed endpoints
  // and the witness line instead left a NO_WITNESS finding -- an edge with no witness file at all
  // -- unmatchable, so a must edge that carries no witness was counted clean and the must tier
  // printed "soundness lemma holds" over it. No corpus application has one, so no figure moves.
  const base = { edgeIndex: i, edge: `${nodes.get(e.from)?.route || e.from} -> ${nodes.get(e.to)?.route || e.to}`, event: e.event, ruleId: w.ruleId, at: w.file ? `${w.file}:${w.loc?.line}` : null }

  // Severity order puts this first: an edge whose destination is not an address of this
  // application is wrong however well its witness reads.
  const dest = nodes.get(e.to)?.route
  if (typeof dest === 'string' && dest.startsWith('/') && declaredHere(dest) === false) {
    findings.push({ ...base, verdict: 'NODE_NOT_DECLARED', modality: e.modality, detail: `destination node sits at ${dest}, which the independent route set does not declare` })
    continue
  }
  if (w.file && !path.resolve(appDir, w.file).startsWith(appDir + path.sep)) { outsideApp++; if (e.modality === 'must') outsideAppMust++ }

  if (e.source !== 'manual' && !w.file) { findings.push({ ...base, verdict: 'NO_WITNESS', detail: 'edge is static/runtime but carries no witness file — golden invariant violated' }); continue }
  const abs = path.isAbsolute(w.file) ? w.file : path.join(appDir, w.file)
  const src = lines(abs)
  if (!src) { findings.push({ ...base, verdict: 'FILE_MISSING', detail: `cannot open ${abs}` }); continue }

  const lineNo = w.loc?.line
  if (!lineNo || lineNo < 1 || lineNo > src.length) { findings.push({ ...base, verdict: 'LINE_OUT_OF_RANGE', detail: `line ${lineNo} of ${src.length}` }); continue }

  const rule = RULES[w.ruleId]
  if (!rule) { findings.push({ ...base, verdict: 'UNKNOWN_RULE', detail: `no checker for ruleId ${w.ruleId}` }); continue }

  const claimed = src[lineNo - 1]
  let hitLine = rule.detect(claimed) ? lineNo : null
  let offBy = 0
  if (hitLine === null) {
    for (let d = 1; d <= WINDOW; d++) {
      if (src[lineNo - 1 + d] !== undefined && rule.detect(src[lineNo - 1 + d])) { hitLine = lineNo + d; offBy = d; break }
      if (src[lineNo - 1 - d] !== undefined && rule.detect(src[lineNo - 1 - d])) { hitLine = lineNo - d; offBy = -d; break }
    }
  }
  if (hitLine === null) {
    const anywhere = src.some((l) => rule.detect(l))
    findings.push({ ...base, verdict: 'NO_CONSTRUCT', detail: anywhere ? `no ${w.ruleId} construct within ±${WINDOW} lines (the file does contain one elsewhere)` : `file contains no ${w.ruleId} construct at all` })
    continue
  }

  const foundRaw = rule.target(src[hitLine - 1])
  const toRoute = nodes.get(e.to)?.route
  // A routerLink without a leading slash is relative to the route the template is rendered on,
  // so compare it as Angular resolves it, against the edge's own source screen. Harness 1.4.0;
  // before this the oracle read every bare link as absolute and called 838 correct mifos edges
  // soundness violations.
  // Only a template link is route-relative; `navigate([...])` without `relativeTo` resolves
  // from the root, so a bare target there is absolute.
  const relativeHere = w.ruleId === 'ng.router-link' || src.slice(hitLine - 1, hitLine + 2).some((l) => /relativeTo/.test(l ?? ''))
  const found = !foundRaw ? foundRaw : relativeHere ? resolveRelative(foundRaw, nodes.get(e.from)?.route) : foundRaw.startsWith('/') ? foundRaw : '/' + foundRaw
  const agrees = targetAgrees(found, toRoute)
  const fan = witnessFanout.get(`${w.file}:${w.loc?.line}`) || 1

  // Over-approximated edges: the witness is only claimed to prove the call site.
  if (fan >= FANOUT_THRESHOLD && e.modality !== 'must') {
    findings.push({ ...base, verdict: 'OVER_APPROX', modality: e.modality, confidence: e.confidence, detail: `one of ${fan} edges citing this call site; target agreement is not claimed for over-approximated edges` })
    continue
  }

  if (offBy !== 0 && agrees === false) {
    findings.push({ ...base, verdict: 'WRONG_CONSTRUCT', detail: `witness line holds no construct; nearest (${offBy > 0 ? '+' : ''}${offBy}) targets ${found}, but the edge claims ${toRoute}` })
  } else if (offBy !== 0) {
    findings.push({ ...base, verdict: 'OFF_BY_N', detail: `construct is ${offBy > 0 ? '+' : ''}${offBy} lines from the witness` })
  } else if (agrees === false) {
    findings.push({ ...base, verdict: 'TARGET_MISMATCH', detail: `construct at the witness targets ${found}, edge claims ${toRoute}` })
  } else {
    ok++
  }
}

const tally = {}
for (const f of findings) tally[f.verdict] = (tally[f.verdict] || 0) + 1
const checked = edges.length

console.log(`app:     ${appDir}`)
console.log(`edges:   ${checked}`)
console.log(`CLEAN:   ${ok}/${checked} = ${checked ? ((ok / checked) * 100).toFixed(1) : 0}%`)
console.log(`issues:  ${JSON.stringify(tally)}`)
// The must-tier is what the soundness lemma protects: report it on its own.
const mustEdges = edges.filter((e) => e.modality === 'must')
const mustIndexes = new Set(edges.flatMap((e, i) => (e.modality === 'must' ? [i] : [])))
const mustBad = findings.filter((f) => f.verdict !== 'OVER_APPROX' && mustIndexes.has(f.edgeIndex))
console.log(`MUST-TIER: ${mustEdges.length - mustBad.length}/${mustEdges.length} clean` + (mustBad.length ? `  <-- ${mustBad.length} SOUNDNESS VIOLATION(S)` : '  (soundness lemma holds on this sample)'))
console.log(`witness outside the application directory: ${outsideApp} edge(s), ${outsideAppMust} of them must` + (decl ? '' : '  (pass --routes <C.json> to also test destinations)'))
const order = ['NODE_NOT_DECLARED', 'NO_WITNESS', 'FILE_MISSING', 'LINE_OUT_OF_RANGE', 'NO_CONSTRUCT', 'WRONG_CONSTRUCT', 'TARGET_MISMATCH', 'OFF_BY_N', 'UNKNOWN_RULE', 'OVER_APPROX']
for (const v of order) {
  const rows = findings.filter((f) => f.verdict === v)
  if (!rows.length) continue
  console.log(`\n${v} (${rows.length}):`)
  for (const r of rows.slice(0, 8)) console.log(`   ${r.edge}\n      ${r.at}  ${r.detail}`)
  if (rows.length > 8) console.log(`   ... ${rows.length - 8} more`)
}

// `mustBad` is written out as well as counted: the soundness violations are the findings the
// thesis describes one by one, and a description read off `findings` would include the may
// and unknown tiers the lemma says nothing about.
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ appDir, dbPath, edges: checked, clean: ok, mustEdges: mustEdges.length, mustClean: mustEdges.length - mustBad.length, outsideApp, outsideAppMust, destinationsChecked: Boolean(decl), tally, mustBad, findings }, null, 2))
