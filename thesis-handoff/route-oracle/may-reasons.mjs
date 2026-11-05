#!/usr/bin/env node
// Why the constructs on the may tier are on it.
//
// The extractor, run with UIGRAPH_MAY_REASONS=1, writes on every may witness the conditions that
// held it at may (`reasons`, sorted, without repeats). This reads those graphs and counts
// CONSTRUCTS, a construct being a witness location (file:line:col) in one application, the
// primary witness and every merged witness of each edge counted alike. A construct is may-only
// when it witnesses at least one may edge and no must edge; its reasons are the union of the
// reasons on its may witnesses, and it has a sole reason when every one of those witnesses
// carries exactly that one reason.
//
// Every reason belongs to one family, below. A reason this file does not know FAILS the run, so a
// reason the extractor gains later cannot be counted under the wrong family without notice.
// Each family is either the application's own semantics (async, branch, template, guard), the
// extractor's uncertainty (reader, attribution, target), or same screen, which is neither.
//   async        the navigation runs in a callback, after an await, or is superseded by a later one
//   branch       it runs under a branch, in a loop or a catch clause, after an early exit, or in a
//                member whose every caller in the class is itself conditional
//   template     it sits under a template condition: a control-flow block, a structural
//                directive, an ng-template, an ICU case, a lazy container; the handler that runs
//                it is bound under one; the outlet above it, or the component's place, is
//   guard        a guard or resolver runs on the navigation, or the handler that fires it is
//                itself conditional (`flag && go()`)
//   reader       the extractor did not read the code: a template whose braces or elements it could
//                not balance, a binding that is more than a bare call (`a(); go()`), a call from
//                another class or a module-level function it does not follow
//   attribution  the extractor is unsure which screens the site belongs to: a scope it capped, or
//                no outlet or resolvable component it could find above (the safe side)
//   target       the extractor is unsure where the navigation lands: an over-approximated
//                template target, a target with holes, a relative one it could not resolve or
//                whose base it could not read, a catch-all, an ambiguous address, an auxiliary outlet
//   sameScreen   the navigation goes to the screen it fires from, or from a screen a redirect hides
//
// Where the extractor once used one string for two causes, it now names them apart at the source
// (conditions.ts memberCondition, attribute.ts outletHiddenReason, extract.ts), and the mapping
// follows the cause: 'handler bound under a template condition' is template; 'all callers
// conditional' is branch; 'handler not read' and 'callers not followed' are reader;
// 'outlet under a template condition' and 'mounted under a template condition' are template;
// 'no outlet or component found' and 'attribution scope uncertain' are attribution.
//
// The splits of the census, over may-only constructs (same-screen reasons count as neither side):
//   MayAppAny        at least one reason in async, branch, template or guard
//   MayToolUncertain at least one reason in reader, attribution or target
//   MayBoth          both of the above
//   MayToolOnly      a reason in reader, attribution or target and none in async, branch,
//                    template or guard: held at may by the extractor's uncertainty alone
//                    (= MayToolUncertain - MayBoth)
//   MayAppSemantics  every reason in async, branch, template or guard: held by the application
//   MayNeither       no tool reason, and at least one same-screen reason (on the corpus every one
//                    also has an application reason)
// MayToolUncertain says the extractor was unsure about the construct, not that the tool alone
// held it at may: most such constructs also hold an application reason (MayBoth).
//
// Usage: node may-reasons.mjs --db realworld=<path> ... --tex <file> [--out <dir>]
//          [--corpus realworld=<path> ... [--unset <path>]]
// With --corpus, each flagged graph must equal the corpus graph once its reasons are deleted, and
// the run fails, writing no macros, when one does not; the comparison is written to equivalence.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import { extractorStamp } from './provenance.mjs'

export const FAMILIES = {
  async: ['in a callback', 'after await', 'superseded by a later navigation'],
  branch: ['under a branch', 'in a loop', 'in a catch clause', 'after early exit', 'all callers conditional'],
  template: ['control-flow block', 'structural directive', 'ng-template', 'ICU case', 'lazy container', 'handler bound under a template condition', 'outlet under a template condition', 'mounted under a template condition'],
  guard: ['guard', 'resolver', 'handler condition'],
  reader: ['unreadable template', 'handler not read', 'callers not followed', 'in a helper function'],
  attribution: ['attribution scope uncertain', 'no outlet or component found'],
  target: ['over-approximated target', 'target has holes', 'relative target not resolved', 'relative base unknown', 'catch-all', 'ambiguous address', 'auxiliary outlet'],
  sameScreen: ['same screen', 'hidden by redirect'],
}
const APP_FAMILIES = ['async', 'branch', 'template', 'guard']
const TOOL_FAMILIES = ['reader', 'attribution', 'target']
const FAMILY_OF = new Map(Object.entries(FAMILIES).flatMap(([f, rs]) => rs.map((r) => [r, f])))
export const APPS = { realworld: 'Realworld', alfresco: 'Alfresco', ghostfolio: 'Ghostfolio', k8sdash: 'Kdash', bitwarden: 'Bitwarden', mifos: 'Mifos' }
const MACRO_FAMILY = { async: 'Async', branch: 'Branch', template: 'Template', guard: 'Guard', reader: 'Reader', attribution: 'Attribution', target: 'Target', sameScreen: 'SameScreen' }

/** The family of one reason; throws on a reason this file does not know, so nothing is miscounted silently. */
function familyOf(reason, where) {
  const f = FAMILY_OF.get(reason)
  if (f === undefined) throw new Error(`unknown may reason "${reason}" at ${where}: add it to a family in may-reasons.mjs`)
  return f
}

/**
 * Count the may-only constructs of one application's graph and the families of their reasons.
 * Returns the construct total, per-family `any` and `sole` counts, the app/tool/neither split
 * and the appAny, toolOnly and both counts (see the header for what each counts).
 * Throws if a may witness carries no reasons (the graph was not extracted with the flag).
 */
export function countApp(name, graph) {
  const sites = new Map()
  for (const e of graph.edges) {
    for (const w of [e.witness, ...(e.mergedWitnesses ?? [])]) {
      if (!w || w.source !== 'static') continue
      // A witness of an edge into a dynamic-target sink is neither may nor must; it counts nowhere.
      if (w.modality === 'unknown') continue
      const key = `${w.file}:${w.loc?.line}:${w.loc?.col}`
      const s = sites.get(key) ?? { must: false, may: [] }
      sites.set(key, s)
      if ((w.modality ?? 'must') === 'must') { s.must = true; continue }
      if (!Array.isArray(w.reasons) || w.reasons.length === 0) throw new Error(`${name}: may witness at ${key} has no reasons; extract with UIGRAPH_MAY_REASONS=1`)
      s.may.push({ key, reasons: w.reasons })
    }
  }
  const any = Object.fromEntries(Object.keys(FAMILIES).map((f) => [f, 0]))
  const sole = { ...any }
  let total = 0, app = 0, tool = 0, neither = 0, appAny = 0, toolOnly = 0, both = 0
  for (const [key, s] of sites) {
    if (s.must || s.may.length === 0) continue
    total++
    const reasons = new Set(s.may.flatMap((m) => m.reasons))
    const fams = new Set([...reasons].map((r) => familyOf(r, `${name} ${key}`)))
    for (const f of fams) any[f]++
    if (reasons.size === 1 && s.may.every((m) => m.reasons.length === 1)) sole[familyOf([...reasons][0], key)]++
    const hasApp = APP_FAMILIES.some((f) => fams.has(f))
    const hasTool = TOOL_FAMILIES.some((f) => fams.has(f))
    if (hasApp) appAny++
    if (hasApp && hasTool) both++
    if (hasTool && !hasApp) toolOnly++
    if (hasTool) tool++
    else if ([...fams].every((f) => APP_FAMILIES.includes(f))) app++
    else neither++
  }
  return { total, any, sole, app, tool, neither, appAny, toolOnly, both }
}

/**
 * Count every application and add the totals. Refuses (throws) when the numbers disagree: a
 * family's sole count above its any count, the sole counts summing past the total, or the
 * app/tool/neither split not summing to the total.
 */
export function census(graphs) {
  const perApp = {}
  for (const [name, g] of Object.entries(graphs)) {
    if (!(name in APPS)) throw new Error(`unknown application "${name}"`)
    perApp[name] = countApp(name, g)
  }
  const sum = (pick) => Object.values(perApp).reduce((a, r) => a + pick(r), 0)
  const totals = {
    total: sum((r) => r.total), app: sum((r) => r.app), tool: sum((r) => r.tool), neither: sum((r) => r.neither),
    appAny: sum((r) => r.appAny), toolOnly: sum((r) => r.toolOnly), both: sum((r) => r.both),
    any: Object.fromEntries(Object.keys(FAMILIES).map((f) => [f, sum((r) => r.any[f])])),
    sole: Object.fromEntries(Object.keys(FAMILIES).map((f) => [f, sum((r) => r.sole[f])])),
  }
  for (const [name, r] of Object.entries({ ...perApp, total: totals })) {
    for (const f of Object.keys(FAMILIES)) if (r.any[f] < r.sole[f]) throw new Error(`${name}: family ${f} has more sole (${r.sole[f]}) than any (${r.any[f]})`)
    const soleSum = Object.values(r.sole).reduce((a, b) => a + b, 0)
    if (soleSum > r.total) throw new Error(`${name}: sole counts sum to ${soleSum}, above the ${r.total} constructs`)
    if (r.app + r.tool + r.neither !== r.total) throw new Error(`${name}: application ${r.app} + tool ${r.tool} + neither ${r.neither} is not ${r.total}`)
    if (r.toolOnly + r.both !== r.tool) throw new Error(`${name}: tool-only ${r.toolOnly} + both ${r.both} is not tool ${r.tool}`)
    if (r.app > r.appAny || r.appAny > r.total) throw new Error(`${name}: application ${r.app}, application-any ${r.appAny} and ${r.total} constructs disagree`)
  }
  return { perApp, totals }
}

/** The LaTeX macros for a census: totals, per-application totals, per-family any/sole, the app/tool split, and the table. */
export function macros({ perApp, totals }) {
  const out = [`\\newcommand{\\MayOnlyConstructs}{${totals.total}}`]
  for (const [name, r] of Object.entries(perApp)) out.push(`\\newcommand{\\MayOnlyConstructs${APPS[name]}}{${r.total}}`)
  for (const f of Object.keys(FAMILIES)) {
    out.push(`\\newcommand{\\MayFam${MACRO_FAMILY[f]}Any}{${totals.any[f]}}`, `\\newcommand{\\MayFam${MACRO_FAMILY[f]}Sole}{${totals.sole[f]}}`)
  }
  out.push(`\\newcommand{\\MayAppSemantics}{${totals.app}}`, `\\newcommand{\\MayToolUncertain}{${totals.tool}}`, `\\newcommand{\\MayNeither}{${totals.neither}}`,
    `\\newcommand{\\MayToolOnly}{${totals.toolOnly}}`, `\\newcommand{\\MayAppAny}{${totals.appAny}}`, `\\newcommand{\\MayBoth}{${totals.both}}`)
  const names = Object.keys(perApp)
  const rows = Object.keys(FAMILIES).map((f) => `${f === 'sameScreen' ? 'same screen' : f} & ${totals.any[f]} & ${totals.sole[f]} & ${names.map((n) => perApp[n].any[f]).join(' & ')} \\\\`)
  out.push('\\newcommand{\\TabMayReasons}{%', `\\begin{tabular}{@{}lrr${'r'.repeat(names.length)}@{}}`, '\\toprule',
    ` & & & \\multicolumn{${names.length}}{c@{}}{Any, by application} \\\\`, `\\cmidrule(l){4-${3 + names.length}}`,
    `Family & Any & Sole & ${names.map((n) => APPS[n].toLowerCase()).join(' & ')} \\\\`, '\\midrule', ...rows, '\\bottomrule', '\\end{tabular}}')
  return out
}

/**
 * Whether a graph extracted with the flag is the graph extracted without it: the flagged graph with
 * every `reasons` key deleted, against the graph of the corpus database, parsed and deep-equal and
 * as re-serialised text. Also counts the may witnesses and those left without reasons, so a graph
 * that was not extracted with the flag is seen here as well as in the census.
 */
export function equivalence(flagged, corpus) {
  const stripped = JSON.parse(JSON.stringify(flagged, (k, v) => (k === 'reasons' ? undefined : v)))
  const witnesses = flagged.edges.flatMap((e) => [e.witness, ...(e.mergedWitnesses ?? [])]).filter((w) => w && w.modality === 'may')
  return {
    identical: isDeepStrictEqual(stripped, corpus),
    textIdentical: JSON.stringify(stripped) === JSON.stringify(corpus),
    mayWitnesses: witnesses.length,
    mayWithoutReasons: witnesses.filter((w) => !Array.isArray(w.reasons) || w.reasons.length === 0).length,
  }
}

/** The text of the graph document of a database, as stored. */
function readGraphText(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const row = db.prepare("select json from docs where key='graph'").get()
  db.close()
  if (!row) throw new Error(`${dbPath} has no graph document`)
  return row.json
}

/** Read the graph document of a database written by `uigraph map`. */
function readGraph(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const row = db.prepare("select json from docs where key='graph'").get()
  db.close()
  if (!row) throw new Error(`${dbPath} has no graph document`)
  return JSON.parse(row.json)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const dbs = argv.flatMap((a, i) => (a === '--db' ? [argv[i + 1]] : []))
  const flag = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : undefined }
  const tex = flag('--tex'), outDir = flag('--out') ?? path.join(import.meta.dirname, 'results-may-reasons')
  if (dbs.length === 0 || !tex) { console.error('usage: node may-reasons.mjs --db <app>=<path> ... --tex <file> [--out <dir>] [--corpus <app>=<path> ... [--unset <path>]]'); process.exit(2) }
  try {
    const graphs = Object.fromEntries(dbs.map((d) => { const [name, p] = [d.slice(0, d.indexOf('=')), d.slice(d.indexOf('=') + 1)]; return [name, readGraph(p)] }))
    const corpus = Object.fromEntries(argv.flatMap((a, i) => (a === '--corpus' ? [[argv[i + 1].slice(0, argv[i + 1].indexOf('=')), argv[i + 1].slice(argv[i + 1].indexOf('=') + 1)]] : [])))
    if (Object.keys(corpus).length > 0) {
      const apps = Object.fromEntries(Object.keys(graphs).map((n) => {
        if (!corpus[n]) throw new Error(`no --corpus database for ${n}`)
        return [n, equivalence(graphs[n], readGraph(corpus[n]))]
      }))
      const unset = flag('--unset')
      const unsetIdentical = unset ? readGraphText(unset) === readGraphText(corpus.realworld) : undefined
      mkdirSync(outDir, { recursive: true })
      writeFileSync(path.join(outDir, 'equivalence.json'), JSON.stringify({
        comparison: 'graph doc of flagged DB with every reasons key deleted vs graph doc of corpus DB, deep-equal and text-equal',
        apps, ...(unset ? { unsetRealworldGraphByteIdentical: unsetIdentical } : {}),
      }, null, 2) + '\n')
      const bad = Object.entries(apps).filter(([, r]) => !r.identical || !r.textIdentical || r.mayWithoutReasons > 0).map(([n]) => n)
      if (bad.length > 0 || unsetIdentical === false) throw new Error(`the flagged graph differs from the corpus graph (or a may witness has no reasons) for: ${[...bad, ...(unsetIdentical === false ? ['realworld unset'] : [])].join(', ')}`)
    }
    const result = census(graphs)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(path.join(outDir, 'may-reasons.json'), JSON.stringify(result, null, 2) + '\n')
    writeFileSync(tex, ['% Generated by may-reasons.mjs. Do not edit by hand.', extractorStamp(), ...macros(result)].join('\n') + '\n')
    console.log(JSON.stringify(result.totals))
  } catch (e) {
    console.error(`may-reasons: ${e.message}`)
    process.exit(1)
  }
}
