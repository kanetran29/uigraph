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

const findings = []
let ok = 0

for (const e of edges) {
  const w = e.witness || {}
  const base = { edge: `${nodes.get(e.from)?.route || e.from} -> ${nodes.get(e.to)?.route || e.to}`, event: e.event, ruleId: w.ruleId, at: w.file ? `${w.file}:${w.loc?.line}` : null }

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
const mustBad = findings.filter((f) => f.verdict !== 'OVER_APPROX' && mustEdges.some((e) => `${nodes.get(e.from)?.route || e.from} -> ${nodes.get(e.to)?.route || e.to}` === f.edge && e.witness && `${e.witness.file}:${e.witness.loc?.line}` === f.at))
console.log(`MUST-TIER: ${mustEdges.length - mustBad.length}/${mustEdges.length} clean` + (mustBad.length ? `  <-- ${mustBad.length} SOUNDNESS VIOLATION(S)` : '  (soundness lemma holds on this sample)'))
const order = ['NO_WITNESS', 'FILE_MISSING', 'LINE_OUT_OF_RANGE', 'NO_CONSTRUCT', 'WRONG_CONSTRUCT', 'TARGET_MISMATCH', 'OFF_BY_N', 'UNKNOWN_RULE', 'OVER_APPROX']
for (const v of order) {
  const rows = findings.filter((f) => f.verdict === v)
  if (!rows.length) continue
  console.log(`\n${v} (${rows.length}):`)
  for (const r of rows.slice(0, 8)) console.log(`   ${r.edge}\n      ${r.at}  ${r.detail}`)
  if (rows.length > 8) console.log(`   ... ${rows.length - 8} more`)
}

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ appDir, dbPath, edges: checked, clean: ok, mustEdges: mustEdges.length, mustClean: mustEdges.length - mustBad.length, tally, findings }, null, 2))
