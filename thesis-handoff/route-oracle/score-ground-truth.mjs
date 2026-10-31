#!/usr/bin/env node
// Scores each attribution level against a hand-built site-screen ground truth.
//
// The runtime scope oracle can refute a scope that is too small but almost never one that is
// too large (Section 5), and the ablation compares the levels only with one another. Neither
// says which level is RIGHT. This does: for one application, the screens each navigation site
// really fires from were read off the sources by hand and recorded in ground-truth/<app>.json,
// and every level is scored against that in both directions.
//
//   missing   a (site, screen) the application has and the level does not: scope too small.
//   excess    a (site, screen) the level has and the application does not: scope too large.
//
// The ground truth is the author's reading and is not independent of the author; it records
// its derivation per site so a reader can check it. Sites the graph holds that the ground
// truth does not mention are reported too, because those are the ground truth's own misses
// and reporting them is the only check this file gets.
//
// Usage: pnpm exec tsx score-ground-truth.mjs --truth <file.json> --db <level>=<path> ... [--tex <file>]
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync } from 'node:fs'
import { scopeMembers } from '@ui-graph/core'
import { extractorStamp } from './provenance.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d }
const truthPath = flag('--truth')
const dbArgs = argv.filter((a, i) => argv[i - 1] === '--db')
if (!truthPath || !dbArgs.length) {
  console.error('usage: pnpm exec tsx score-ground-truth.mjs --truth <file.json> --db <level>=<path> ... [--tex <file>]')
  process.exit(2)
}

const truth = JSON.parse(readFileSync(truthPath, 'utf8'))
const ALL = truth.screens
/** The ground truth records paths relative to the application's source root. */
const key = (site) => `src/app/${site}`
const wanted = new Map()
for (const s of truth.sites) {
  wanted.set(key(s.site), { screens: new Set(s.screens === 'ALL' ? ALL : s.screens), why: s.why })
}
const excludedSites = new Set((truth.excluded ?? []).map((e) => key(e.site)))

/** site -> set of screen routes the graph attributes it to. */
function attribution(dbPath) {
  const g = JSON.parse(new DatabaseSync(dbPath).prepare("select json from docs where key='graph'").get().json)
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const routeOf = (id) => byId.get(id)?.route
  const isScreen = (id) => {
    const n = byId.get(id)
    return n && n.kind === 'screen' && typeof n.route === 'string' && n.route.startsWith('/')
  }
  const out = new Map()
  for (const e of g.edges) {
    const from = byId.get(e.from)
    if (!from) continue
    const srcs = (from.kind === 'scope' ? scopeMembers(g, from) : [e.from]).filter(isScreen)
    if (!srcs.length) continue
    for (const w of [e.witness, ...(e.mergedWitnesses || [])]) {
      if (!w || w.source !== 'static' || !w.file) continue
      const k = `${w.file}:${w.loc?.line ?? '?'}`
      const set = out.get(k) ?? new Set()
      for (const s of srcs) set.add(routeOf(s))
      out.set(k, set)
    }
  }
  return out
}

const levels = []
for (const spec of dbArgs) {
  const i = spec.indexOf('=')
  if (i < 0) throw new Error(`--db wants <level>=<path>, got ${spec}`)
  const level = spec.slice(0, i)
  const got = attribution(spec.slice(i + 1))

  let correct = 0, missing = 0, excess = 0, unplaced = 0
  const worst = []
  for (const [site, { screens }] of wanted) {
    const have = got.get(site) ?? new Set()
    if (!have.size) unplaced += 1
    const c = [...screens].filter((s) => have.has(s)).length
    const m = screens.size - c
    const x = [...have].filter((s) => !screens.has(s)).length
    correct += c; missing += m; excess += x
    if (x || m) worst.push({ site, want: screens.size, got: have.size, missing: m, excess: x })
  }
  // The ground truth's own blind spot: sites the graph places that it never listed.
  const unlisted = [...got.keys()].filter((k) => k.startsWith('src/app/') && !wanted.has(k) && !excludedSites.has(k))

  const claimed = correct + excess
  const real = correct + missing
  const row = {
    level,
    correct,
    missing,
    excess,
    excessSites: worst.filter((w) => w.excess).length,
    missingSites: worst.filter((w) => w.missing).length,
    unplaced,
    precision: claimed ? correct / claimed : 0,
    recall: real ? correct / real : 0,
    unlisted: unlisted.length,
    unlistedExamples: unlisted.slice(0, 5),
    worst: worst.sort((a, b) => (b.excess + b.missing) - (a.excess + a.missing)).slice(0, 6),
  }
  if (row.correct + row.missing !== [...wanted.values()].reduce((a, w) => a + w.screens.size, 0)) {
    throw new Error(`${level}: correct + missing does not account for every ground-truth pair`)
  }
  levels.push(row)
  console.error(`  ${level.padEnd(8)} correct=${String(correct).padStart(3)} missing=${String(missing).padStart(3)} ` +
    `excess=${String(excess).padStart(4)} precision=${(row.precision * 100).toFixed(1)}% recall=${(row.recall * 100).toFixed(1)}% ` +
    `(${unplaced} sites unplaced, ${unlisted.length} not in the ground truth)`)
}

for (const l of levels) {
  if (l.worst.length) {
    console.error(`\n  ${l.level}: worst sites`)
    for (const w of l.worst) console.error(`    ${w.site}  want ${w.want} got ${w.got}  (+${w.excess} / -${w.missing})`)
  }
}

const tex = flag('--tex')
if (tex) {
  const pc = (v) => {
    const n = v * 100
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${n} is not a share`)
    return `${n.toFixed(1)}\\,\\%`
  }
  let out = '% Generated by score-ground-truth.mjs. Do not edit by hand.\n' + extractorStamp() + '\n'
  out += '\\newcommand{\\TabGroundTruth}{%\n\\begin{tabular}{@{}lrrrrr@{}}\n\\toprule\n'
  out += 'Level & Correct & Missing & Excess & Precision & Recall \\\\\n\\midrule\n'
  for (const l of levels) {
    out += `${l.level} & ${l.correct} & ${l.missing} & ${l.excess} & ${pc(l.precision)} & ${pc(l.recall)} \\\\\n`
  }
  out += '\\bottomrule\n\\end{tabular}}\n'
  out += `\\newcommand{\\GTApp}{${truth.app}}\n`
  out += `\\newcommand{\\GTSites}{${wanted.size}}\n`
  out += `\\newcommand{\\GTPairs}{${[...wanted.values()].reduce((a, w) => a + w.screens.size, 0)}}\n`
  for (const l of levels) {
    const cap = l.level[0].toUpperCase() + l.level.slice(1)
    out += `\\newcommand{\\GT${cap}Precision}{${pc(l.precision)}}\n`
    out += `\\newcommand{\\GT${cap}Recall}{${pc(l.recall)}}\n`
    out += `\\newcommand{\\GT${cap}Excess}{${l.excess}}\n`
    out += `\\newcommand{\\GT${cap}Missing}{${l.missing}}\n`
    // How many SCOPES the pairs above are spread over. An excess of nine pairs at one site
    // and at nine sites are different defects, and prose that says "nine scopes" when the
    // count is one site nine screens too wide states the wrong one.
    out += `\\newcommand{\\GT${cap}ExcessSites}{${l.excessSites}}\n`
    out += `\\newcommand{\\GT${cap}MissingSites}{${l.missingSites}}\n`
  }
  const best = levels.reduce((a, l) => (l.precision > a.precision ? l : a))
  out += `\\newcommand{\\GTBestPrecision}{${best.level}}\n`
  writeFileSync(tex, out)
  console.error(`\nwrote ${tex}`)
}
