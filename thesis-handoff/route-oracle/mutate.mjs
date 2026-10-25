#!/usr/bin/env node
//
// RQ4: is the extracted graph sensitive enough to source changes for change impact
// analysis? Seeds a known delta into the source, re-extracts, and compares the graph
// against the predicted difference.
//
// Harness 1.3.0. Changes against 1.2.0, all required by the evaluation protocol:
//   - the extractor command is a parameter, not a hard-coded container path
//   - --attribution runs the mutation on the attributed graph
//   - sampling is seeded and stratified, with a fixed quota per operator
//   - CHANGE_NAV_TARGET retargets to another declared route instead of an invented one
//   - coverage-confounded mutants are excluded automatically, not by hand
//   - predictions are checked strictly; detection is reported per operator with n
//
// usage: node mutate.mjs <repoRoot> <appDir> [--attribution] [--quota N] [--seed N]
//                        [--json out.json] [--map-cmd "<cmd>"]
//        env UIGRAPH_MAP overrides --map-cmd.

import { execSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(name)
  return i > -1 ? argv[i + 1] : dflt
}
const repoRoot = path.resolve(argv[0])
const appDir = path.resolve(argv[1])
const ATTRIBUTION = argv.includes('--attribution')
const QUOTA = parseInt(flag('--quota', '8'), 10)
const SEED = parseInt(flag('--seed', '20261021'), 10)
const jsonOut = flag('--json', null)
const MAP_CMD = process.env.UIGRAPH_MAP || flag('--map-cmd', 'uigraph')
const DB = path.join(appDir, 'uigraph-mutate.db')

/** Deterministic PRNG so that a reported sample can be reproduced exactly. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Seeded Fisher-Yates. Returns a new array; the input is not touched. */
function shuffle(arr, rnd) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Runs the extractor over appDir and reads the graph back out of the database. */
function extract(label) {
  const attr = ATTRIBUTION ? '--attribution' : ''
  try {
    execSync(`${MAP_CMD} map ${appDir} --adapter angular --no-register ${attr} --out ${DB}`,
      { stdio: 'pipe', timeout: 900000 })
  } catch (e) {
    return { failed: true, error: String(e.stderr || e.message).slice(0, 300) }
  }
  const db = new DatabaseSync(DB)
  const row = db.prepare("select json from docs where key='graph'").get()
  const g = JSON.parse(row?.json || '{}')
  db.close?.()
  return { nodes: g.nodes || [], edges: g.edges || [], label }
}

const edgeKey = (e) => `${e.from}|${e.to}|${e.event}`
const nodeRoutes = (g) => new Map(g.nodes.map((n) => [n.id, n.route]))
const routeOf = (map, id) => map.get(id) || id

/** Every source location that the baseline graph cites as a witness, as "file:line". */
function witnessIndex(g) {
  const idx = new Set()
  const add = (w) => { if (w?.file && w?.loc?.line) idx.add(`${w.file}:${w.loc.line}`) }
  for (const e of g.edges) { add(e.witness); for (const w of e.mergedWitnesses || []) add(w) }
  return idx
}

/** Routes the baseline graph has a screen node for. */
function declaredRoutes(g) {
  return g.nodes.filter((n) => n.kind === 'screen' && n.route).map((n) => n.route)
}

function delta(base, mut) {
  const bN = new Map(base.nodes.map((n) => [n.id, n]))
  const mN = new Map(mut.nodes.map((n) => [n.id, n]))
  const bE = new Map(base.edges.map((e) => [edgeKey(e), e]))
  const mE = new Map(mut.edges.map((e) => [edgeKey(e), e]))
  const bR = nodeRoutes(base), mR = nodeRoutes(mut)

  const nodesAdded = [...mN.values()].filter((n) => !bN.has(n.id)).map((n) => n.route || n.id)
  const nodesRemoved = [...bN.values()].filter((n) => !mN.has(n.id)).map((n) => n.route || n.id)
  const routeChanged = [...bN.values()]
    .filter((n) => mN.has(n.id) && mN.get(n.id).route !== n.route)
    .map((n) => `${n.route} -> ${mN.get(n.id).route}`)

  const edgesAdded = [...mE.values()].filter((e) => !bE.has(edgeKey(e)))
    .map((e) => `${routeOf(mR, e.from)} -> ${routeOf(mR, e.to)} (${e.event})`)
  const edgesRemoved = [...bE.values()].filter((e) => !mE.has(edgeKey(e)))
    .map((e) => `${routeOf(bR, e.from)} -> ${routeOf(bR, e.to)} (${e.event})`)
  const guardChanged = [...bE.values()]
    .filter((e) => mE.has(edgeKey(e)) &&
      (mE.get(edgeKey(e)).guard !== e.guard || mE.get(edgeKey(e)).modality !== e.modality))
    .map((e) => {
      const m = mE.get(edgeKey(e))
      return `${routeOf(bR, e.from)} -> ${routeOf(bR, e.to)}: guard ${e.guard}->${m.guard}, modality ${e.modality}->${m.modality}`
    })

  const bW = witnessIndex(base), mW = witnessIndex(mut)
  const witnessLinesRemoved = [...bW].filter((w) => !mW.has(w))
  const witnessLinesAdded = [...mW].filter((w) => !bW.has(w))

  const touched = nodesAdded.length + nodesRemoved.length + routeChanged.length +
    edgesAdded.length + edgesRemoved.length + guardChanged.length +
    witnessLinesRemoved.length + witnessLinesAdded.length
  return { nodesAdded, nodesRemoved, routeChanged, edgesAdded, edgesRemoved, guardChanged,
    witnessLinesRemoved, witnessLinesAdded, touched }
}

function tsFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|html)$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name)) out.push(p)
    }
  }
  walk(dir)
  return out
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length

/** The nearest path literal declared before a guard property, i.e. the route it guards. */
function enclosingRoutePath(src, index) {
  const before = src.slice(Math.max(0, index - 400), index)
  const hits = [...before.matchAll(/path:\s*['"]([^'"]*)['"]/g)]
  return hits.length ? hits[hits.length - 1][1] : null
}

function discover(routes, guardedTargets, rnd) {
  const muts = []
  const otherRoute = (orig) => {
    const pool = routes.filter((r) => r !== orig && !r.includes(':'))
    return pool.length ? pool[Math.floor(rnd() * pool.length)] : null
  }

  for (const f of tsFiles(appDir)) {
    const src = fs.readFileSync(f, 'utf8')
    const rel = path.relative(appDir, f)

    for (const m of src.matchAll(/(\bpath:\s*)(['"])([a-zA-Z][\w-]*)\2/g)) {
      const subject = m[3]
      muts.push({
        kind: 'RENAME_PATH', file: f, rel, line: lineOf(src, m.index),
        index: m.index, find: m[0], replace: `${m[1]}${m[2]}${subject}-mutated${m[2]}`, subject,
        predict: `a node route containing "${subject}" becomes "${subject}-mutated"`,
        // The construct is a route declaration, so the graph must already have the node.
        confound: () => routes.some((r) => r.split('/').includes(subject))
          ? null : `no baseline node has a route segment "${subject}"`,
        // The renamed route must show up in the graph. The old node is not required to
        // disappear: the same path segment may be declared in a second routing module,
        // which keeps the original node alive.
        check: (d) => d.routeChanged.some((c) => c.includes(`${subject}-mutated`)) ||
          d.nodesAdded.some((r) => String(r).includes(`${subject}-mutated`)),
      })
    }

    for (const m of src.matchAll(/\s(routerLink)="\/([\w/-]+)"/g)) {
      const target = `/${m[2]}`
      muts.push({
        kind: 'DELETE_ROUTERLINK', file: f, rel, line: lineOf(src, m.index + 1),
        index: m.index, find: m[0], replace: ' data-removed-link="1"', subject: target,
        predict: `the graph stops citing this line, and the edge to ${target} disappears unless another construct also produces it`,
        check: (d) => d.witnessLinesRemoved.includes(`${rel}:${lineOf(src, m.index + 1)}`) ||
          d.edgesRemoved.some((e) => e.includes(`-> ${target} `)),
      })
    }

    for (const m of src.matchAll(/(router\.navigate\(\[\s*)(['"])(\/[\w/-]+)\2/g)) {
      const orig = m[3].replace(/\/$/, '')
      const dest = otherRoute(orig)
      if (!dest) continue
      muts.push({
        kind: 'CHANGE_NAV_TARGET', file: f, rel, line: lineOf(src, m.index),
        index: m.index, find: m[0], replace: `${m[1]}${m[2]}${dest}${m[2]}`, subject: `${orig} => ${dest}`,
        predict: `the edge to ${orig} is replaced by an edge to ${dest}`,
        check: (d) => d.edgesRemoved.some((e) => e.includes(`-> ${orig} `)) &&
          d.edgesAdded.some((e) => e.includes(`-> ${dest} `)),
      })
    }

    for (const m of src.matchAll(/\bcanActivate:\s*\[[^\]]*\],?/g)) {
      const guarded = enclosingRoutePath(src, m.index)
      muts.push({
        kind: 'REMOVE_GUARD', file: f, rel, line: lineOf(src, m.index),
        index: m.index, find: m[0], replace: '', subject: guarded === null ? m[0].slice(0, 40) : `path "${guarded}"`,
        predict: guarded === null
          ? 'the guard text or modality of at least one edge changes'
          : `the guard on edges entering the screen of path "${guarded}" changes`,
        // A guard is represented on the edges entering the guarded screen, so a guard on a
        // screen that no edge reaches cannot be observed at all. Such a mutant re-detects
        // the edge-coverage gap already counted under RQ1, so it is excluded here.
        confound: () => guarded === null
          ? null
          : (guardedTargets.some((t) => t.split('/').includes(guarded))
              ? null
              : `no baseline edge enters a screen with route segment "${guarded}"`),
        // Strict: the guard must change on an edge entering the guarded screen. A change
        // somewhere else counts as WRONG, which is the informative verdict.
        check: (d) => guarded
          ? d.guardChanged.some((c) => c.includes(`/${guarded}`))
          : d.guardChanged.length > 0,
      })
    }
  }
  return muts
}

const gitRestore = () => execSync(`git -C ${repoRoot} checkout -- .`, { stdio: 'pipe' })

console.log(`repo:        ${repoRoot}`)
console.log(`app:         ${appDir}`)
console.log(`attribution: ${ATTRIBUTION ? 'on' : 'off'}`)
console.log(`seed:        ${SEED}   quota per operator: ${QUOTA}`)
gitRestore()
const baseline = extract('baseline')
if (baseline.failed) { console.error('baseline extraction failed:', baseline.error); process.exit(1) }
const wIdx = witnessIndex(baseline)
const routes = declaredRoutes(baseline)
console.log(`baseline:    ${baseline.nodes.length} nodes, ${baseline.edges.length} edges, ` +
  `${routes.length} screen routes, ${wIdx.size} witnessed source lines\n`)

// Routes that at least one baseline edge points at. Guard mutants are only meaningful here.
const baseRouteOf = nodeRoutes(baseline)
const guardedTargets = [...new Set(baseline.edges.map((e) => baseRouteOf.get(e.to)).filter(Boolean))]
console.log(`             ${guardedTargets.length} screens are entered by at least one edge`)

const rnd = mulberry32(SEED)
const all = discover(routes, guardedTargets, rnd)
const discovered = {}
for (const m of all) discovered[m.kind] = (discovered[m.kind] || 0) + 1
console.log(`discovered ${all.length} candidate mutations ${JSON.stringify(discovered)}`)

// Stratified seeded sample: shuffle each operator's pool, then take the quota.
const sampled = {}
const chosen = []
for (const kind of Object.keys(discovered).sort()) {
  const pool = shuffle(all.filter((m) => m.kind === kind), rnd).slice(0, QUOTA)
  sampled[kind] = pool.length
  chosen.push(...pool)
}
console.log(`sampled ${JSON.stringify(sampled)} of ${JSON.stringify(discovered)} (seed ${SEED})`)
for (const k of Object.keys(discovered)) {
  if (sampled[k] < discovered[k]) console.log(`  note: ${k} capped at ${sampled[k]} of ${discovered[k]} candidates`)
}
console.log('')

const results = []
for (const [i, m] of chosen.entries()) {
  // A mutant whose construct produced no baseline edge cannot say anything about
  // sensitivity to change; it only repeats a coverage gap counted under RQ1.
  const confoundReason = m.confound
    ? m.confound()
    : (wIdx.has(`${m.rel}:${m.line}`) ? null : `construct at ${m.rel}:${m.line} is witnessed by no baseline edge`)
  if (confoundReason) {
    results.push({ kind: m.kind, file: m.rel, line: m.line, subject: m.subject, predict: m.predict,
      verdict: 'EXCLUDED', reason: confoundReason })
    console.log(`[excl] ${m.kind.padEnd(20)} ${String(m.subject).slice(0, 34).padEnd(35)} ${confoundReason.slice(0, 60)}`)
    continue
  }

  const src = fs.readFileSync(m.file, 'utf8')
  // Patch at the recorded offset. Replacing by string content would always hit the
  // first identical occurrence, so every mutant on a repeated construct would edit
  // the same site and the operator's results would collapse onto one mutation.
  if (src.slice(m.index, m.index + m.find.length) !== m.find) {
    results.push({ kind: m.kind, file: m.rel, line: m.line, subject: m.subject,
      verdict: 'SKIP', reason: 'construct is no longer at the recorded offset' })
    continue
  }
  fs.writeFileSync(m.file, src.slice(0, m.index) + m.replace + src.slice(m.index + m.find.length))

  const mut = extract(`mut${i}`)
  let verdict, d = null
  if (mut.failed) verdict = 'BROKE'
  else {
    d = delta(baseline, mut)
    if (d.touched === 0) verdict = 'MISSED'
    else verdict = m.check(d) ? 'DETECTED' : 'WRONG'
  }
  gitRestore()

  results.push({
    kind: m.kind, file: m.rel, line: m.line, subject: m.subject, predict: m.predict, verdict,
    touched: d ? d.touched : null,
    delta: d ? {
      witnessLinesRemoved: d.witnessLinesRemoved, witnessLinesAdded: d.witnessLinesAdded,
      nodesAdded: d.nodesAdded, nodesRemoved: d.nodesRemoved, routeChanged: d.routeChanged,
      edgesAdded: d.edgesAdded.slice(0, 4), edgesRemoved: d.edgesRemoved.slice(0, 4),
      guardChanged: d.guardChanged.slice(0, 4),
    } : null,
    error: mut.failed ? mut.error : undefined,
  })
  const mark = { DETECTED: 'ok  ', MISSED: 'MISS', WRONG: 'WRNG', BROKE: 'BRK ' }[verdict]
  console.log(`[${mark}] ${m.kind.padEnd(20)} ${String(m.subject).slice(0, 34).padEnd(35)} ${m.rel.slice(-40)}`)
  if (verdict !== 'DETECTED' && d) {
    console.log(`         predicted: ${m.predict}`)
    console.log(`         actual:    touched ${d.touched} ${JSON.stringify(results[results.length - 1].delta).slice(0, 200)}`)
  }
}

gitRestore()

// Detection rate is over scored mutants only: excluded, broken and skipped ones are
// reported but carry no information about sensitivity.
const SCORED = ['DETECTED', 'MISSED', 'WRONG']
const perOperator = {}
for (const r of results) {
  const o = (perOperator[r.kind] ||= { discovered: discovered[r.kind] || 0, sampled: sampled[r.kind] || 0,
    detected: 0, missed: 0, wrong: 0, excluded: 0, broke: 0, skip: 0 })
  o[{ DETECTED: 'detected', MISSED: 'missed', WRONG: 'wrong', EXCLUDED: 'excluded', BROKE: 'broke', SKIP: 'skip' }[r.verdict]]++
}
console.log('\nper operator:')
let tD = 0, tN = 0
for (const [kind, o] of Object.entries(perOperator)) {
  const n = o.detected + o.missed + o.wrong
  tD += o.detected; tN += n
  const rate = n ? ((o.detected / n) * 100).toFixed(1) + '%' : 'n/a'
  console.log(`  ${kind.padEnd(20)} detected ${o.detected}/${n} = ${rate.padEnd(7)} ` +
    `(excluded ${o.excluded}, broke ${o.broke}, of ${o.discovered} candidates)`)
}
console.log(`  ${'OVERALL'.padEnd(20)} detected ${tD}/${tN} = ${tN ? ((tD / tN) * 100).toFixed(1) : 0}%`)

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({
    harnessVersion: '1.3.0', repoRoot, appDir, attribution: ATTRIBUTION, seed: SEED, quota: QUOTA,
    baseline: { nodes: baseline.nodes.length, edges: baseline.edges.length, routes: routes.length },
    discovered, sampled, perOperator,
    detectionRate: tN ? tD / tN : null, scored: tN, detected: tD, results,
  }, null, 2))
  console.log(`\nwrote ${jsonOut}`)
}
