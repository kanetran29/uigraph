#!/usr/bin/env node
// Before/after comparison for RQ3. Joins two harness runs construct by construct.
//
// Usage: node compare.mjs <before-dir> <after-dir> [--tex out.tex] [--json out.json]
//
// For every construct (identified by file:line) it reads the class in the before run
// and in the after run. "Recovered" means: an attribution class before, converted after.
// "Regressed" means: converted before, not converted after (should be zero). "Demoted" means
// the construct stayed converted but moved from the must class to the may class, which lowers the
// deterministic conversion ratio that RQ1 reports without leaving the converted classes.

import fs from 'node:fs'
import path from 'node:path'
import { conversion } from './report-counts.mjs'

// One line naming the run a generated table came from, so two tables made from different
// runs cannot be read as one measurement.
function provLine(p, note) {
  const e = (p && p.extractor) || {}
  const sha = e.sha ? e.sha.slice(0, 8) : 'unrecorded'
  return '% Extractor ' + sha + (e.source ? ' (' + e.source + ')' : '') +
    ', harness ' + ((p && p.harnessVersion) || 'unrecorded') +
    ((p && p.label) ? ', label ' + p.label : '') + (note ? ', ' + note : '') + '.'
}

const [beforeDir, afterDir] = process.argv.slice(2)
const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null }
const load = (d) => JSON.parse(fs.readFileSync(path.join(d, 'results.json'), 'utf8'))
const B = load(beforeDir), A = load(afterDir)
const raw = (d, slug) => JSON.parse(fs.readFileSync(path.join(d, 'raw', `${slug}.L.json`), 'utf8'))

const conv = (c) => c === 'CONVERTED_MUST' || c === 'CONVERTED_MAY'
const attr = (c) => c === 'ATTRIBUTION_SHARED' || c === 'ATTRIBUTION_SERVICE'
// RQ3 compares two runs of one commit over the same inputs, so the population the two
// columns are ratios OF has to be the same population. The classes that leave the
// denominator are decided by the construct's own text --- a navigation that only changes the
// query, one that targets a named outlet, one that names no destination --- and none of them
// can depend on what the graph did. When they did, a site that attribution gave an edge to
// escaped a bucket the text had put it in, and the after column was a ratio over 24 more
// sites than the before column. The comparison refuses rather than quietly reporting it.
const OUT_OF_SCOPE = ['QUERY_ONLY', 'EXCLUDED_NAMED_OUTLET', 'EXCLUDED_NO_COMMANDS']
for (const b of B.results) {
  const was = new Map(raw(beforeDir, b.slug).rows.map((r) => [r.at, r.cls]))
  const now = new Map(raw(afterDir, b.slug).rows.map((r) => [r.at, r.cls]))
  const moved = [...was].filter(([at, cls]) => OUT_OF_SCOPE.includes(cls) && now.has(at) && now.get(at) !== cls)
  const joined = [...now].filter(([at, cls]) => OUT_OF_SCOPE.includes(cls) && was.has(at) && was.get(at) !== cls)
  if (moved.length || joined.length) {
    const show = [...moved, ...joined].slice(0, 3).map(([at, cls]) => `${at} (${cls})`).join('; ')
    throw new Error(`${b.slug}: ${moved.length + joined.length} construct(s) change their out-of-denominator class between the two runs, so the two columns are ratios over different populations -- ${show}`)
  }
}

const rows = []
for (const b of B.results) {
  const a = A.results.find((x) => x.slug === b.slug)
  const lb = raw(beforeDir, b.slug).rows, la = raw(afterDir, b.slug).rows
  const after = new Map(la.map((r) => [r.at, r.cls]))
  let attrBefore = 0, recoveredMust = 0, recoveredMay = 0, regressed = 0, demoted = 0
  const stillLost = {}
  for (const r of lb) {
    const ac = after.get(r.at)
    if (attr(r.cls)) {
      attrBefore++
      if (ac === 'CONVERTED_MUST') recoveredMust++
      else if (ac === 'CONVERTED_MAY') recoveredMay++
      else stillLost[ac] = (stillLost[ac] || 0) + 1
    }
    if (conv(r.cls) && !conv(ac)) regressed++
    if (r.cls === 'CONVERTED_MUST' && ac === 'CONVERTED_MAY') demoted++
  }
  rows.push({
    slug: b.slug,
    constructs: b.totalConstructs,
    convBefore: conversion(b), convAfter: conversion(a),
    mustBefore: b.testB ? [b.testB.mustClean, b.testB.mustEdges] : null,
    mustAfter: a.testB ? [a.testB.mustClean, a.testB.mustEdges] : null,
    edgesBefore: b.graph?.edges, edgesAfter: a.graph?.edges,
    attrBefore, recoveredMust, recoveredMay, regressed, demoted, stillLost,
  })
}

/**
 * A conversion cell, and the change between two of them in percentage points. Both take
 * percentages from the ledgers' counts (report-counts.mjs), so these tables, to-latex.mjs and the
 * figure round a conversion alike, and a fall of less than the four places results.json keeps is
 * still a fall.
 */
const pct = (v) => (v == null ? '--' : `${v.toFixed(1)}\\%`)
const pp = (a, b) => (a == null || b == null ? '--' : `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(1)}`)
const frac = (x) => (x && x[1] ? `${x[0]}/${x[1]}` : '--')
const NAME = { realworld: 'realworld', alfresco: 'alfresco', ghostfolio: 'ghostfolio', k8sdash: 'k8s dashboard', bitwarden: 'bitwarden', mifos: 'mifos' }

if ((B.provenance?.extractor?.sha) !== (A.provenance?.extractor?.sha)) {
  throw new Error(`the two runs are of different extractors (${B.provenance?.extractor?.sha} and ${A.provenance?.extractor?.sha}); RQ3 requires one commit run twice`)
}
let tex = `% Generated by compare.mjs. Do not edit by hand.\n${provLine(A.provenance, 'attribution off against on, same commit')}\n\\newcommand{\\TabBeforeAfter}{%\n\\begin{tabular}{@{}lrrrrrrrr@{}}\n\\toprule\n`
tex += ` & \\multicolumn{3}{c}{Conversion} & \\multicolumn{2}{c}{Must-tier clean} & \\multicolumn{3}{c}{Attribution losses, recovered} \\\\\n\\cmidrule(lr){2-4}\\cmidrule(lr){5-6}\\cmidrule(lr){7-9}\n`
tex += `Application & Before & After & pp & Before & After & Before & must & may \\\\\n\\midrule\n`
for (const r of rows) tex += `${NAME[r.slug]} & ${pct(r.convBefore)} & ${pct(r.convAfter)} & ${pp(r.convBefore, r.convAfter)} & ${frac(r.mustBefore)} & ${frac(r.mustAfter)} & ${r.attrBefore} & ${r.recoveredMust} & ${r.recoveredMay} \\\\\n`
const sum = (k) => rows.reduce((s, r) => s + r[k], 0)
tex += `\\midrule\nAll & & & & & & ${sum('attrBefore')} & ${sum('recoveredMust')} & ${sum('recoveredMay')} \\\\\n\\bottomrule\n\\end{tabular}}\n`

console.log('app            conv before -> after     must-tier before -> after   attribution: lost  recovered (must/may)  regressed  still lost as')
for (const r of rows) {
  console.log(`${r.slug.padEnd(14)} ${pct(r.convBefore).replace('\\', '').padStart(6)} -> ${pct(r.convAfter).replace('\\', '').padStart(6)}   ${frac(r.mustBefore).padStart(7)} -> ${frac(r.mustAfter).padEnd(9)}      ${String(r.attrBefore).padStart(4)}  ${String(r.recoveredMust).padStart(4)}/${String(r.recoveredMay).padEnd(4)}           ${r.regressed}        ${JSON.stringify(r.stillLost)}`)
}
// held back until every check below has passed; see the single write at the end
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify({ before: B.provenance, after: A.provenance, rows }, null, 2))

// Why the remaining attribution losses stay lost (from diagnose-attribution.mjs output).
const DIAG = [
  ['no scope: component not reached from any route component or shell', 'Owner component not reached from any screen'],
  ['service (not in this version)', 'In a service or guard (not implemented)'],
  ['scoped; target target-missing', 'Scope found, target screen has no node'],
  ['scoped; target dynamic', 'Scope found, target fully dynamic'],
  ['scoped; target resolves', 'Scope found, not explained'],
]
// The one row of the table above that gives no reason: the scope was found and the target
// resolves, and the diagnosis stops there.
const UNEXPLAINED = 'scoped; target resolves'
// A missing diagnosis file used to read as an empty object, so the table printed a column
// of zeros and said that nothing stays lost. Refuse instead: a zero here is a claim.
const diag = B.results.map((b) => {
  const p = path.join(afterDir, 'raw', `${b.slug}.diag.json`)
  if (!fs.existsSync(p)) throw new Error(`${b.slug}: no ${p}; run diagnose-attribution.mjs for every application before this table is written`)
  return JSON.parse(fs.readFileSync(p, 'utf8'))
})
let tex2 = `\\newcommand{\\TabRemaining}{%\n\\begin{tabular}{@{}l${'r'.repeat(B.results.length)}r@{}}\n\\toprule\nReason & ${B.results.map((r) => ({ realworld: 'rw', alfresco: 'alf', ghostfolio: 'gf', k8sdash: 'k8s', bitwarden: 'bw', mifos: 'mif' })[r.slug]).join(' & ')} & Total \\\\\n\\midrule\n`
for (const [k, label] of DIAG) { const v = diag.map((d) => d[k] || 0); tex2 += `${label} & ${v.join(' & ')} & ${v.reduce((a, b) => a + b, 0)} \\\\\n` }
tex2 += `\\bottomrule\n\\end{tabular}}\n`
// held back until every check below has passed; see the single write at the end

// Which baseline class did each construct that attribution converted come out of? The
// loss rules assign a construct to one class, so a conversion out of a node class means
// the classes are not independent and the attribution class is not an upper bound.
const ATTR_CLS = ['ATTRIBUTION_SHARED', 'ATTRIBUTION_SERVICE']
const NODE_CLS = ['LAZY_BOUNDARY', 'CONSTANT_PATH', 'COMPONENT_UNLINKED', 'NODE_MISS', 'CONSTANT_TARGET']
const moves = {}
for (const b of B.results) {
  const lb = raw(beforeDir, b.slug).rows, la = raw(afterDir, b.slug).rows
  const after = new Map(la.map((r) => [r.at, r.cls]))
  for (const r of lb) {
    const ac = after.get(r.at)
    if (!ac || !conv(ac) || conv(r.cls)) continue
    moves[r.cls] ||= { must: 0, may: 0 }
    moves[r.cls][ac === 'CONVERTED_MUST' ? 'must' : 'may']++
  }
}
const group = (c) => (ATTR_CLS.includes(c) ? 'attribution' : NODE_CLS.includes(c) ? 'node' : 'other')
// A conversion out of a class in neither group was printed in no row and counted in no total,
// while a row labelled "All conversions gained" sat beneath it. The third group is now printed.
const OTHER_CLS = Object.keys(moves).filter((c) => group(c) === 'other')
const CLS_LABEL = {
  ATTRIBUTION_SHARED: 'Attribution, shared component', ATTRIBUTION_SERVICE: 'Attribution, service',
  LAZY_BOUNDARY: 'Lazy boundary', CONSTANT_PATH: 'Constant path',
  COMPONENT_UNLINKED: 'Component unlinked', NODE_MISS: 'Node missing', CONSTANT_TARGET: 'Constant target',
  EXCLUDED_NO_COMMANDS: 'Excluded in the baseline: named no destination',
}
let tex3 = `\n\\newcommand{\\TabRecoverySource}{%\n\\begin{tabular}{@{}lrrr@{}}\n\\toprule\nBaseline class of the construct & must & may & total \\\\\n\\midrule\n`
const gt = { attribution: { must: 0, may: 0 }, node: { must: 0, may: 0 }, other: { must: 0, may: 0 } }
for (const g of ['attribution', 'node']) {
  for (const [cls, v] of Object.entries(moves).filter(([c]) => group(c) === g).sort((a, b2) => (b2[1].must + b2[1].may) - (a[1].must + a[1].may))) {
    tex3 += `${CLS_LABEL[cls] || cls} & ${v.must} & ${v.may} & ${v.must + v.may} \\\\\n`
    gt[g].must += v.must; gt[g].may += v.may
  }
  tex3 += `\\addlinespace\n`
}
for (const cls of OTHER_CLS) {
  const v = moves[cls]
  tex3 += `${CLS_LABEL[cls] || cls} & ${v.must} & ${v.may} & ${v.must + v.may} \\\\\n`
  gt.other.must += v.must; gt.other.may += v.may
}
if (OTHER_CLS.length) tex3 += `\\addlinespace\n`
tex3 += `\\midrule\nOut of the attribution classes & ${gt.attribution.must} & ${gt.attribution.may} & ${gt.attribution.must + gt.attribution.may} \\\\\n`
tex3 += `Out of the node classes & ${gt.node.must} & ${gt.node.may} & ${gt.node.must + gt.node.may} \\\\\n`
if (OTHER_CLS.length) tex3 += `Out of the excluded classes & ${gt.other.must} & ${gt.other.may} & ${gt.other.must + gt.other.may} \\\\\n`
{
  const m = gt.attribution.must + gt.node.must + gt.other.must
  const y = gt.attribution.may + gt.node.may + gt.other.may
  const seen = Object.values(moves).reduce((a, v) => a + v.must + v.may, 0)
  if (m + y !== seen) throw new Error(`the recovery table prints ${m + y} conversions and the ledger holds ${seen}; a baseline class has no row`)
  tex3 += `All conversions gained & ${m} & ${y} & ${m + y} \\\\\n`
}
tex3 += `\\bottomrule\n\\end{tabular}}\n`
// held back until every check below has passed; see the single write at the end

// The inline macros for the figures the chapter states in prose, so no RQ3 number is typed
// by hand. The closure is asserted here rather than left to the reader: every construct the
// loss rules assigned to attribution is either recovered or classified in TabRemaining, and a
// generator that cannot show that refuses to write the macros at all. Classified is not
// explained: the row that gives no reason is counted as AttrRemainingUnexplained.
const T = {
  lost: rows.reduce((a, r) => a + r.attrBefore, 0),
  must: rows.reduce((a, r) => a + r.recoveredMust, 0),
  may: rows.reduce((a, r) => a + r.recoveredMay, 0),
  regressed: rows.reduce((a, r) => a + r.regressed, 0),
  remaining: diag.reduce((a, d) => a + DIAG.reduce((b, [k]) => b + (d[k] || 0), 0), 0),
  edgesBefore: rows.reduce((a, r) => a + r.edgesBefore, 0),
  edgesAfter: rows.reduce((a, r) => a + r.edgesAfter, 0),
  mustBefore: rows.reduce((a, r) => a + r.mustBefore[1], 0),
  mustAfter: rows.reduce((a, r) => a + r.mustAfter[1], 0),
  gained: rows.filter((r) => r.convAfter > r.convBefore).length,
  fell: rows.filter((r) => r.convAfter < r.convBefore).length,
  fellWhere: rows.filter((r) => r.convAfter < r.convBefore).map((r) => NAME[r.slug]).join(', ') || 'none',
  demoted: rows.reduce((a, r) => a + r.demoted, 0),
  unexplained: diag.reduce((a, d) => a + (d[UNEXPLAINED] || 0), 0),
}
const recovered = T.must + T.may
if (recovered + T.remaining !== T.lost) {
  throw new Error(`attribution losses do not close: ${recovered} recovered + ${T.remaining} classified != ${T.lost} assigned. One of the two tables is measuring a different population.`)
}
const pc = (n, d) => `${(Math.round((n / d) * 1000) / 10).toFixed(1)}\\,\\%`
let tex4 = '\n% RQ3 inline figures.\n'
for (const [k, v] of [
  ['AttrLost', T.lost], ['AttrRecovered', recovered], ['AttrRecoveredShare', pc(recovered, T.lost)],
  ['AttrRecoveredMust', T.must], ['AttrRecoveredMay', T.may], ['AttrRegressed', T.regressed],
  ['AttrRemaining', T.remaining], ['AttrRemainingUnexplained', T.unexplained], ['AttrEdgesBefore', T.edgesBefore], ['AttrEdgesAfter', T.edgesAfter],
  ['AttrMustBefore', T.mustBefore], ['AttrMustAfter', T.mustAfter], ['AttrAppsGained', T.gained],
  ['AttrAppsFell', T.fell], ['AttrFellWhere', T.fellWhere], ['AttrDemoted', T.demoted],
]) tex4 += `\\newcommand{\\${k}}{${v}}\n`
// held back until every check below has passed; see the single write at the end
console.log(`\nRQ3: ${recovered} of ${T.lost} recovered (${T.must} must, ${T.may} may), ${T.remaining} classified (${T.unexplained} unexplained), ${T.regressed} regressed, ${T.demoted} demoted from must to may (conversion fell on ${T.fell}: ${T.fellWhere}); edges ${T.edgesBefore} -> ${T.edgesAfter}, must ${T.mustBefore} -> ${T.mustAfter}`)
console.log(`conversions gained, by baseline class: ${JSON.stringify(moves)}`)
console.log(`  out of attribution classes: ${gt.attribution.must} must, ${gt.attribution.may} may`)
console.log(`  out of node classes:        ${gt.node.must} must, ${gt.node.may} may`)

// Everything is written in one go, after the closure assertion above. Writing each table as it
// was built meant the refusal fired only once the file had already been replaced by the output
// that failed it, which left no good file on disk and a partial one in its place.
if (arg('--tex')) fs.writeFileSync(arg('--tex'), tex + tex2 + tex3 + tex4)
