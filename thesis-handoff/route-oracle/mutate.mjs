#!/usr/bin/env node
//
// RQ4: is the extracted graph sensitive enough to source changes for change impact
// analysis? Seeds a known delta into the source, re-extracts, and compares the graph
// against the predicted difference.
//
// The version below is recorded as `mutate 1.8.0`. This harness has its own numbering, and the
// round harness run-all.mjs, whose version corpus.json holds, is also at 1.8.0: a bare "1.8.0" in
// the thesis would name two instruments with different semantics.
//
// Harness 1.8.0. Change against 1.7.0: a REMOVE_GUARD mutant is detected only when the guard an
// edge loses is one the removed list names. 1.7.0 passed when any edge lost any guard, so it did
// not test that the guard lost is the one removed. The list is read as the extractor writes it:
// an identifier is its own name and a factory call `f(args)` is `f()`, so a guard factory called
// with arguments is now a name too; 1.7.0 read only bare identifiers and `f()`, and so named
// nothing in bitwarden's `organizationPermissionsGuard(canAccessSettingsTab)`. Where the list
// holds an element the extractor writes from a hash or a position, an inline arrow function or a
// member access, the lost guard cannot be matched by name and any lost guard counts, as under
// 1.7.0. The record keeps every guard change of a mutant: 1.7.0 cut it to four entries, so a
// verdict that rested on a later one could not be audited from the result file. The factory
// names also reach the exclusion rule, which asks whether any baseline edge carries a guard the
// list names; it now differs from 1.7.0's on 12 of bitwarden's 78 candidate lists (6 on the graph
// without attribution). Re-judged offline on the 1.7.0 results at the seed they were sampled
// with, all eleven detections stand and no sampled mutant changes its exclusion.
//
// Harness 1.7.0. Change against 1.6.0: a guard an edge loses is counted, not looked up. The
// extractor writes a guard factory without its arguments, so two guards on one navigation can
// print alike; bitwarden's settings route and its children all carry
// organizationPermissionsGuard(...), and removing the settings route's left the edge with two
// copies of the text instead of three, which 1.6.0 read as no guard lost and scored WRONG.
//
// Harness 1.6.0. Change against 1.5.0: REMOVE_GUARD is judged by the guard the edges lose. The
// extractor now gates an edge only on the guards the navigation runs, so a guard on a route
// that the source and the destination share does not appear on the edge between them; it
// appears on the edges that enter the guarded route from outside it. A mutant is detected when
// some edge loses a guard it carried, and excluded when no baseline edge carries a guard the
// removed list names, since then no edge enters the guarded route from outside and the removal
// cannot be observed. Measured on alfresco without attribution: the guard at
// aca-content.routes.ts:111 left the edges inside its route unchanged, as it should, and was
// scored WRONG under 1.5.0's rule that it must change on every edge entering its screens.
//
// Harness 1.5.0. Change against 1.4.0: REMOVE_GUARD resolves the route it guards by brace
// matching the enclosing object literal and reading the components that route's subtree
// renders, instead of taking the nearest preceding path literal in the source text. The old
// resolution returned a child's path for a route that has children, the empty string for an
// empty-path child, and nothing at all for a route whose path is a constant reference or a
// template literal -- and the exclusion rule, which asks whether any screen the guarded route
// yields is entered by a baseline edge, was keyed on it. An empty literal satisfied the old
// segment test for every absolute path and an absent one skipped the test, so four mutants
// whose guarded screens no edge enters were scored instead of excluded, and reported as
// misses. A guarded route that declares no component at all now excludes too, since it yields
// no screen for a guard to be recorded on. Component names are collected over the whole
// subtree, by class name and by the module a loadComponent imports, and matched against the
// class and file each screen node carries. Brace matching runs over a copy of the source with
// comment and string contents blanked, because one corpus route file ends a line with
// `children: [], // ... work, },` whose comment would otherwise close the enclosing object
// nine hundred characters early -- and a truncated span names fewer components, which is the
// one way this rule can drop a mutant it should have scored. The detection check is likewise
// keyed on the resolved screens rather than on a substring of the path literal; where no
// screen resolves it falls back to any guard change, which the chapter states.
//
// Harness 1.4.0. Change against 1.3.0: CHANGE_NAV_TARGET no longer counts a correct graph
// response as wrong. Its check requires an ADDED edge to the new destination, but attribution
// fans a navigation site over every screen it can be triggered from, and retargeting such a
// site to a destination all of those screens already reach produces edges the graph already
// holds, which deduplicate. The mutant then removes the old edges and adds none. The operator
// now prefers a destination at least one of the site's own screens does not already reach, and
// excludes the mutant where the application offers none, which is the treatment REMOVE_GUARD
// and RENAME_PATH already had. Measured on realworld at quota 1, seed 20261021: the retarget
// mutant went from WRONG to DETECTED, so the sampled destinations differ from 1.3.0 and the
// figures are not directly comparable with the ones 1.3.0 published.
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
import { guardedRoute, lostGuard, namedGuards } from './guard-resolve.mjs'
import { extractorStamp } from './provenance.mjs'

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
const HARNESS_VERSION = 'mutate 1.8.0'

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

/** The baseline edges each source line witnesses, keyed "file:line", merged witnesses included. */
function witnessEdges(g) {
  const idx = new Map()
  const add = (w, e) => {
    if (!w?.file || !w?.loc?.line) return
    const k = `${w.file}:${w.loc.line}`
    if (!idx.has(k)) idx.set(k, [])
    idx.get(k).push(e)
  }
  for (const e of g.edges) { add(e.witness, e); for (const w of e.mergedWitnesses || []) add(w, e) }
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

/**
 * Every mutation the four operators can make in the application's sources, each with the edit
 * to apply, the confound that excludes it when the graph cannot show it, and the check that
 * scores the graph's response. A REMOVE_GUARD mutant is checked against the guards its own
 * removed list names, read by namedGuards.
 */
function discover(routes, screensOfRoute, rnd, alreadyReached) {
  const muts = []
  // The preference is only a preference: falling back to the whole pool keeps one rnd()
  // draw per call either way, so the seeded sample of every other operator is unchanged.
  const otherRoute = (orig, prefer = () => true) => {
    const pool = routes.filter((r) => r !== orig && !r.includes(':'))
    const liked = pool.filter(prefer)
    const from = liked.length ? liked : pool
    return from.length ? from[Math.floor(rnd() * from.length)] : null
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
      // Attribution fans one navigation site over every screen it can be triggered from, so the
      // site draws one edge per screen. Retargeting it to a destination all of those screens
      // already reach replaces each edge with one the graph already holds, which deduplicates:
      // the mutant then removes the old edges and adds none, and a check that requires an added
      // edge calls a correct response wrong. Prefer a destination at least one of the site's own
      // screens does not already reach, and exclude the mutant when the application offers none.
      const fileLine = `${rel}:${lineOf(src, m.index)}`
      const dest = otherRoute(orig, (cand) => !alreadyReached(fileLine, cand))
      if (!dest) continue
      muts.push({
        kind: 'CHANGE_NAV_TARGET', file: f, rel, line: lineOf(src, m.index),
        index: m.index, find: m[0], replace: `${m[1]}${m[2]}${dest}${m[2]}`, subject: `${orig} => ${dest}`,
        predict: `the edge to ${orig} is replaced by an edge to ${dest}`,
        confound: () => alreadyReached(fileLine, dest)
          ? `every screen this site is attributed to already reaches ${dest}, so a correct retarget adds no edge`
          : null,
        check: (d) => d.edgesRemoved.some((e) => e.includes(`-> ${orig} `)) &&
          d.edgesAdded.some((e) => e.includes(`-> ${dest} `)),
      })
    }

    for (const m of src.matchAll(/\bcanActivate:\s*\[[^\]]*\],?/g)) {
      const route = guardedRoute(src, m.index)
      const screens = route ? screensOfRoute(route) : []
      const reached = screens.filter((x) => x.entered).map((x) => x.route)
      // The guards the removed list names, as the extractor writes a named guard on an edge.
      const { names: named, complete } = namedGuards(m[0])
      const carried = named.length > 0 && baseline.edges.some((e) => (e.guard ?? '').split(',').some((g) => named.includes(g)))
      muts.push({
        kind: 'REMOVE_GUARD', file: f, rel, line: lineOf(src, m.index),
        index: m.index, find: m[0], replace: '',
        subject: route && route.own !== null ? `path "${route.own}"` : m[0].slice(0, 40),
        predict: 'an edge that carried the guard loses it',
        // A guard is represented on the edges entering the screens the guarded route yields,
        // so a guard whose route yields no screen, or none that any edge enters, cannot be
        // observed at all. Such a mutant re-detects the edge-coverage gap already counted
        // under RQ1, so it is excluded here. Where the route cannot be resolved the mutant is
        // kept and scored, because dropping it on an unread route would hide a real miss.
        confound: () => {
          if (!route) return null
          if (!route.declaresTarget) return 'the guarded route declares no component and no populated children, so it yields no screen'
          if (!screens.length) return null
          if (!reached.length) return `no baseline edge enters any screen the guarded route yields (${screens.map((x) => x.route).slice(0, 3).join(', ')})`
          return named.length > 0 && !carried ? 'no baseline edge carries the guard, so none enters the guarded route from outside it' : null
        },
        // Strict: some edge must lose a guard it carried, and where the removed list names every
        // guard in it, one of those. A change that only adds one, one on the modality alone, or the
        // loss of a guard the list does not name is WRONG.
        check: (d) => lostGuard(d.guardChanged, complete ? named : null),
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

// The screens a guarded route yields, read off the baseline graph: a screen node carries the
// class that renders it, but not the source location of the route entry that declares it, so
// the classes and module paths a route's subtree names are what its screens are looked up by.
const enteredIds = new Set(baseline.edges.map((e) => e.to))
const screensOfRoute = (route) => baseline.nodes
  .filter((n) => n.kind === 'screen' && n.route &&
    (route.components.some((c) => (n.label || '').includes(c)) ||
     route.modules.some((m) => (n.componentPath || '').endsWith(`${m.replace(/^\.\//, '')}.ts`))))
  .map((n) => ({ route: n.route, entered: enteredIds.has(n.id) }))

// Which screens a navigation site belongs to is read back off the baseline graph: the edges a
// source line witnesses are exactly the edges attribution drew for that site.
const siteEdges = witnessEdges(baseline)
const alreadyReached = (fileLine, dest) => {
  const scopes = [...new Set((siteEdges.get(fileLine) || []).map((e) => e.from))]
  return scopes.length > 0 && scopes.every((from) =>
    baseline.edges.some((e) => e.from === from && baseRouteOf.get(e.to) === dest))
}

const rnd = mulberry32(SEED)
const all = discover(routes, screensOfRoute, rnd, alreadyReached)
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
      guardChanged: d.guardChanged,
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
    harnessVersion: HARNESS_VERSION, extractor: extractorStamp(), repoRoot, appDir, attribution: ATTRIBUTION, seed: SEED, quota: QUOTA,
    baseline: { nodes: baseline.nodes.length, edges: baseline.edges.length, routes: routes.length },
    discovered, sampled, perOperator,
    detectionRate: tN ? tD / tN : null, scored: tN, detected: tD, results,
  }, null, 2))
  console.log(`\nwrote ${jsonOut}`)
}
