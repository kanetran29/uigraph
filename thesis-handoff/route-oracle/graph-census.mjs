#!/usr/bin/env node
// What the published graphs are actually made of: how many nodes are screens and how many are
// not, and how the edges divide between the three modalities.
//
// Chapter 3 defines the graph over a node set of screens and an edge relation on S x Sigma x G
// x M x S, and then says the pinned extractor emits no unknown-modality edge. Neither holds of
// the graphs the corpus produces: the extractor also emits an unplaced-origin node for a
// navigation site it cannot place under any screen, and a dynamic-target node for a
// destination only the run time knows. This census is what the model section cites so that the
// node set and the edge relation are stated over what is there.
//
// Usage: node graph-census.mjs --corpus <dir> [--out <dir>] [--tex <file>]
//
// The census is written as a result file as well as a table, so the figures the thesis quotes
// come from a recorded measurement rather than from a database that is not committed.
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d }
const corpus = flag('--corpus')
if (!corpus) {
  console.error('usage: node graph-census.mjs --corpus <dir> [--out <dir>] [--tex <file>]')
  process.exit(2)
}

/** Where each application's database sits under the corpus, as the other harnesses have it. */
const APPS = {
  realworld: '.',
  alfresco: 'projects/aca-content',
  ghostfolio: 'apps/client',
  k8sdash: 'modules/web',
  bitwarden: 'apps/web',
  mifos: '.',
}
const NAME = { k8sdash: 'k8s dashboard' }

const MODALITIES = ['must', 'may', 'unknown']

/**
 * The node and edge composition of one graph. Nodes are counted by the kind the extractor
 * records; edges by modality, and separately by whether their endpoints are screens, since the
 * model's edge relation is stated over screens and the anchor expansion stands for a set of
 * them.
 */
function censusOf(dbPath) {
  const db = new DatabaseSync(dbPath)
  const row = db.prepare("select json from docs where key='graph'").get()
  const g = JSON.parse(row?.json || '{}')
  const nodes = g.nodes || []
  const edges = g.edges || []
  const kind = new Map(nodes.map((n) => [n.id, n.kind]))
  const count = (pred) => nodes.filter(pred).length
  const byModality = {}
  for (const m of MODALITIES) byModality[m] = edges.filter((e) => e.modality === m).length
  const other = edges.filter((e) => !MODALITIES.includes(e.modality)).length
  if (other) throw new Error(`${dbPath}: ${other} edges carry a modality that is none of ${MODALITIES.join(', ')}`)
  return {
    nodes: nodes.length,
    screens: count((n) => n.kind === 'screen'),
    scopes: count((n) => n.kind === 'scope'),
    nonScreens: count((n) => n.kind !== 'screen' && n.kind !== 'scope'),
    edges: edges.length,
    ...byModality,
    sourceNotScreen: edges.filter((e) => !['screen', 'scope'].includes(kind.get(e.from))).length,
    targetNotScreen: edges.filter((e) => kind.get(e.to) !== 'screen').length,
    maySourceNotScreen: edges.filter((e) => e.modality === 'may' &&
      !['screen', 'scope'].includes(kind.get(e.from))).length,
    modalityDrift: edges.filter((e) => (e.modality === 'unknown') !== (kind.get(e.to) !== 'screen')).length,
  }
}

/** Refuses rather than emitting a part that does not account for its whole. */
function expectSum(total, parts) {
  const sum = parts.reduce((a, [, v]) => a + v, 0)
  if (sum !== total[1]) {
    throw new Error(`${total[0]} is ${total[1]} but ${parts.map(([k, v]) => `${k} (${v})`).join(' + ')} = ${sum}`)
  }
}

const rows = []
for (const [slug, sub] of Object.entries(APPS)) {
  const db = path.join(corpus, slug, sub, 'uigraph.db')
  if (!existsSync(db)) throw new Error(`no graph for ${slug} at ${db}; the census must cover the whole corpus or none of it`)
  const c = censusOf(db)
  expectSum([`${slug} nodes`, c.nodes], [['screens', c.screens], ['scope anchors', c.scopes], ['other kinds', c.nonScreens]])
  expectSum([`${slug} edges`, c.edges], MODALITIES.map((m) => [m, c[m]]))
  // The chapter says the third modality is exactly what carries a destination only the run
  // time knows. That is an invariant of the output, so it is enforced rather than described:
  // an unknown edge that reaches a screen, or a named target reached at unknown, would mean
  // the modality no longer means what the model says.
  if (c.modalityDrift) {
    throw new Error(`${slug}: ${c.modalityDrift} edges where carrying the unknown modality and reaching a node that is not a screen do not coincide`)
  }
  rows.push({ slug, ...c })
}

const all = {}
for (const k of Object.keys(rows[0]).filter((k) => k !== 'slug')) {
  all[k] = rows.reduce((a, r) => a + r[k], 0)
}
expectSum(['corpus nodes', all.nodes], [['screens', all.screens], ['scope anchors', all.scopes], ['other kinds', all.nonScreens]])
expectSum(['corpus edges', all.edges], MODALITIES.map((m) => [m, all[m]]))

const outDir = flag('--out')
if (outDir) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, 'census.json'), JSON.stringify({ apps: rows, all }, null, 2))
}

const tex = flag('--tex')
if (tex) {
  let out = '% Generated by graph-census.mjs from the corpus graphs. Do not edit by hand.\n\n'
  out += '\\newcommand{\\TabCensus}{%\n\\begin{tabular}{@{}lrrrrrr@{}}\n\\toprule\n'
  out += ' & \\multicolumn{3}{c}{nodes} & \\multicolumn{3}{c@{}}{edges} \\\\\n\\cmidrule(lr){2-4}\\cmidrule(l){5-7}\n'
  out += 'Application & screens & anchors & other & must & may & unknown \\\\\n\\midrule\n'
  for (const r of rows) {
    out += `${NAME[r.slug] || r.slug} & ${r.screens} & ${r.scopes} & ${r.nonScreens} & ${r.must} & ${r.may} & ${r.unknown} \\\\\n`
  }
  out += `\\midrule\nAll & ${all.screens} & ${all.scopes} & ${all.nonScreens} & ${all.must} & ${all.may} & ${all.unknown} \\\\\n`
  out += '\\bottomrule\n\\end{tabular}}\n'
  const pc = (n, d) => `${((n / d) * 100).toFixed(1)}\\,\\%`
  for (const [k, v] of [
    ['CensusNodes', all.nodes], ['CensusScreens', all.screens], ['CensusAnchors', all.scopes],
    ['CensusOtherNodes', all.nonScreens], ['CensusEdges', all.edges],
    ['CensusMust', all.must], ['CensusMay', all.may], ['CensusUnknown', all.unknown],
    ['CensusSourceNotScreen', all.sourceNotScreen], ['CensusTargetNotScreen', all.targetNotScreen],
    ['CensusMaySourceNotScreen', all.maySourceNotScreen],
    ['CensusUnknownApps', rows.filter((r) => r.unknown > 0).length],
    ['CensusApps', rows.length],
  ]) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} is ${v}, which is not a count`)
    out += `\\newcommand{\\${k}}{${v}}\n`
  }
  out += `\\newcommand{\\CensusOtherNodeShare}{${pc(all.nonScreens, all.nodes)}}\n`
  out += `\\newcommand{\\CensusUnknownShare}{${pc(all.unknown, all.edges)}}\n`
  writeFileSync(tex, out)
  console.error(`wrote ${tex}`)
}

console.error(`corpus: ${all.nodes} nodes (${all.screens} screens, ${all.scopes} anchors, ${all.nonScreens} other), ` +
  `${all.edges} edges (${all.must} must, ${all.may} may, ${all.unknown} unknown in ${rows.filter((r) => r.unknown > 0).length} applications)`)
