#!/usr/bin/env node
//
// Emits the second-round tables and inline macros from the result files of the repeat
// evaluation. Never edit the output by hand.
//   usage: node round2-to-latex.mjs <outDir> [--probe <resultsDir>|none] > ../thesis/generated-round2.tex
// <outDir> holds, per application slug, <slug>.ctrl.{C,L}.json (the extractor as it stood
// before the round) and five files from after it: <slug>.fin.C.json (the route oracle),
// <slug>.fin.L.json (the loss breakdown), <slug>.fin.B.json (the witness check),
// <slug>.fin.why.json (the reason for every construct still unrecovered) and
// <slug>.fin.notes.json (the extractor's own soundiness notes). Two run-all.mjs runs into one
// --out write them: --label ctrl against the pre-round extractor, --label fin against the
// round-two one. The ctrl run is expected to exit non-zero, so the two commands must not be
// chained. The declared-screen denominator move is accounted against the EARLIER oracle's own
// output, which this script reads from the repository's tracked results-before/raw/<slug>.C.json
// beside itself and not from <outDir>: that file's provenance is a fact about the repository and
// not about whatever a scratch directory happens to hold, and a hand-made pre file from a
// mid-round revision of the oracle passed every internal check this script can make while
// publishing a denominator move that was partly the round's own doing. run-all.mjs rejects
// --label pre, and its header entry for that label says which revision the tracked file is.
import fs from 'node:fs'
import path from 'node:path'
import { judgedSites, share } from './report-counts.mjs'
import { frameworkAnswer, norm } from '../route-probe/framework-answer.mjs'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2]
const SLUGS = ['realworld', 'alfresco', 'ghostfolio', 'k8sdash', 'bitwarden', 'mifos']
const NAME = { realworld: 'realworld', alfresco: 'alfresco', ghostfolio: 'ghostfolio', k8sdash: 'k8s dashboard', bitwarden: 'bitwarden', mifos: 'mifos' }
/**
 * What each application is called inside a control-sequence name, which holds letters only. It is
 * written out because no rule over the slug gives `Kdash` for `k8sdash`: a rule that drops the
 * digit gives `ksdash`, one that spells it out gives `KEightsdash`, and the chapters write `Kdash`.
 */
const MACRO_TAG = { realworld: 'Realworld', alfresco: 'Alfresco', ghostfolio: 'Ghostfolio', k8sdash: 'Kdash', bitwarden: 'Bitwarden', mifos: 'Mifos' }
/**
 * Every slug must have a display name and a control-sequence tag, and the tag must be letters
 * only, which is all a control-sequence name can hold. A slug added to SLUGS alone would print
 * `undefined` into three table bodies and into macro names such as `\RoundTwoRoutesundefined`,
 * and a tag with a digit in it (`K8dash`) would emit a `\newcommand` that pdflatex rejects after
 * this script has exited 0, so both are checked before anything is emitted.
 */
for (const s of SLUGS) {
  if (!NAME[s]) throw new Error(`${s} is in SLUGS but NAME has no entry for it`)
  if (!/^[A-Za-z]+$/.test(MACRO_TAG[s] ?? '')) throw new Error(`${s}: MACRO_TAG is ${JSON.stringify(MACRO_TAG[s])}, which is not a control-sequence name (letters only)`)
}
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } }
/**
 * Read a result file by its path relative to THIS script rather than to `<outDir>`, for the one
 * input that is a tracked artefact of the repository and not a product of the run being reported.
 * Absence throws: results-before/raw is committed and complete for every slug, so a missing file
 * means the script was copied out of the repository, not that the application did not move.
 */
const rdHere = (f) => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), f), 'utf8'))
// A published share is a claim about a population, so it has to lie in it. Every refusal in
// this harness until now checked that the parts summed to the whole, and none checked that the
// whole was the right whole: when the witness check began judging every source location an edge
// cites, a site count kept being divided by an edge count and this file published "-69.3 %" of
// edges clean and "119.8 %" over-approximated. Arithmetically impossible figures reached the
// chapter because nothing asked whether a percentage was a percentage.
const pc = (n, d) => {
  if (!d) return '--'
  const v = share(n, d)
  if (!Number.isFinite(v) || v < 0 || v > 100) {
    throw new Error(`${n}/${d} is ${v.toFixed(1)} %, which is not a share of anything: the numerator and the denominator are counting different populations`)
  }
  return v.toFixed(1) + '\\,\\%'
}

const rows = SLUGS.map((s) => ({
  s,
  c0: rd(`${s}.ctrl.C.json`), c1: rd(`${s}.fin.C.json`),
  l0: rd(`${s}.ctrl.L.json`), l1: rd(`${s}.fin.L.json`),
  b1: rd(`${s}.fin.B.json`),
  w: rd(`${s}.fin.why.json`),
  notes: rd(`${s}.fin.notes.json`),
  pre: rdHere(`results-before/raw/${s}.C.json`),
})).filter((r) => r.c1 && r.l1)
/**
 * Every application must have every file this script publishes from. The filter above drops a
 * slug without the C/L pair, which would print every table and total over fewer applications
 * than the thesis names and still exit 0; the rest are read through `rd`, which answers null for
 * a file that is absent or unparsable, so each of them would quietly contribute nothing to a
 * table whose total line still reads over all six. Deleting one application's fin.why.json left
 * the reason table short by eleven sites under a total that still said twenty-four, at exit 0.
 * An input a figure depends on is therefore required by name rather than defaulted away.
 */
const unread = SLUGS.filter((s) => !rows.some((r) => r.s === s))
if (unread.length > 0) throw new Error(`${dir}: <slug>.fin.C.json and <slug>.fin.L.json must both be readable, and at least one is missing or unparsable for ${unread.join(', ')}`)
const REQUIRED = { b1: 'fin.B.json', w: 'fin.why.json', notes: 'fin.notes.json', c0: 'ctrl.C.json', l0: 'ctrl.L.json' }
const absent = rows.flatMap((r) => Object.entries(REQUIRED).filter(([k]) => !r[k]).map(([, f]) => `${r.s}.${f}`))
if (absent.length > 0) throw new Error(`${dir}: every table and macro is published over all six applications, so these inputs must be readable: ${absent.join(', ')}`)

const tot = rows.reduce((a, r) => {
  a.inScope += r.l1.inScope; a.rec += r.l1.recovered; a.lost += r.l1.lost
  a.dyn += r.l1.tally.ACCOUNTED_DYNAMIC || 0; a.unp += r.l1.tally.ACCOUNTED_UNPLACED || 0
  a.raw += r.l1.constructs; a.excl += r.l1.excluded
  a.rec0 += r.l0 ? r.l0.constructs - r.l0.lost : 0; a.raw0 += r.l0 ? r.l0.constructs : 0
  return a
}, { inScope: 0, rec: 0, lost: 0, dyn: 0, unp: 0, raw: 0, excl: 0, rec0: 0, raw0: 0 })

const out = []
out.push('% Generated by round2-to-latex.mjs. Do not edit.')
// The run these figures came from, named in the file so a table cannot be read as
// belonging to an era it does not. The fin oracle output carries the appDir it read.
{
  const finC = path.join(dir, SLUGS[0] + '.fin.C.json')
  const stamp = fs.existsSync(finC) ? fs.statSync(finC).mtime.toISOString().slice(0, 10) : 'unrecorded'
  out.push(`% Round-two inputs from ${path.basename(dir)}, written ${stamp}.`)
}
// The version of the measurement harness these figures were produced by, taken from the
// pinned corpus rather than written into the prose, where it goes stale on the next bump.
out.push(`\\newcommand{\\HarnessVersion}{${JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'corpus.json'), 'utf8')).harnessVersion}}`)

out.push('\\newcommand{\\TabRoundTwoNodes}{%')
out.push('\\begin{tabular}{lrrrr}')
out.push('\\toprule')
out.push('Application & Before & After & Declared & Blind spots \\\\')
out.push('\\midrule')
for (const r of rows) {
  const n = (c) => (c ? `${pc(c.comparison.matched, c.comparison.declaredScreens)} (${c.comparison.matched}/${c.comparison.declaredScreens})` : '--')
  const moved = r.c0 && r.c0.comparison.declaredScreens !== r.c1.comparison.declaredScreens
  const decl = moved ? `${r.c0.comparison.declaredScreens}$\\to$${r.c1.comparison.declaredScreens}` : String(r.c1.comparison.declaredScreens)
  out.push(`${NAME[r.s]} & ${n(r.c0)} & ${n(r.c1)} & ${decl} & ${r.c1.blindSpots.length} \\\\`)
}
out.push('\\bottomrule')
out.push('\\end{tabular}}')

out.push('\\newcommand{\\TabRoundTwoAccounting}{%')
out.push('\\begin{tabular}{lrrrrrr}')
out.push('\\toprule')
out.push('Application & Sites & Excl. & In scope & Recovered & Dynamic & Unplaced \\\\')
out.push('\\midrule')
for (const r of rows) {
  const d = r.l1.tally.ACCOUNTED_DYNAMIC || 0
  const u = r.l1.tally.ACCOUNTED_UNPLACED || 0
  out.push(`${NAME[r.s]} & ${r.l1.constructs} & ${r.l1.excluded} & ${r.l1.inScope} & ${pc(r.l1.recovered, r.l1.inScope)} & ${pc(d, r.l1.inScope)} & ${pc(u, r.l1.inScope)} \\\\`)
}
out.push('\\midrule')
out.push(`All & ${tot.raw} & ${tot.excl} & ${tot.inScope} & ${pc(tot.rec, tot.inScope)} & ${pc(tot.dyn, tot.inScope)} & ${pc(tot.unp, tot.inScope)} \\\\`)
out.push('\\bottomrule')
out.push('\\end{tabular}}')

const PRETTY = {
  'extractor-note:unresolved-target': 'The target was read; no node matches it',
  'unmapped-target': 'A literal target matching no declared route',
  'target-names-no-declared-route': 'The target names no route the application declares',
  'target-under-unreadable-subtree': 'The target is inside a subtree the oracle could not read',
  'relative-target-unresolved': 'A relative target with no base to resolve it against',
  'owner-has-no-node': 'The owning component has neither a node nor a scope',
  'no-witness-though-owner-has-a-node': 'The screen is in the graph; nothing was parsed here',
  'parsed-file-no-note-near-construct': 'The file is parsed, but nothing lands near the site',
  'extractor-note:unattributed-non-component': 'A class the extractor could not place under any screen',
  'owner-file-not-readable': 'The owning file could not be opened here',
  'owner-has-no-node:lazy-blind-spot': 'The owning route is behind a module the oracle could not read',
  'non-component-source-unattributed:plain-class': 'A plain class; whether anything injects it is not established',
  'non-component-source-unattributed:service': 'A service; whether anything injects it is not established',
  'non-component-source-unattributed:directive': 'A directive; whether anything applies it is not established',
  // The slug as it was written before the suffix, so a results directory made before it still prints.
  'non-component-source:plain-class': 'A plain class; whether anything injects it is not established',
  'non-component-source:service': 'A service; whether anything injects it is not established',
  'non-component-source:directive': 'A directive; whether anything applies it is not established',
  'edge-exists-witness-on-another-line': 'The edge exists, witnessed on another line',
  'declared-route-has-no-node': 'The route is declared; the node is missing',
  'name-not-resolved': 'The target names a value no resolver could follow',
  'extractor-note:over-approximation': 'Over-approximated at the site',
  'not-a-navigation': 'The construct carries no commands, so it names no destination',
  'named-outlet': 'Navigates a secondary outlet, which the model does not admit',
}
// Keyed by the published text, not the slug: two slugs mapping to one reason would otherwise
// print it as two identical rows whose total still closes, publishing one finding as two.
const reasons = {}
for (const r of rows) if (r.w) for (const [k, v] of Object.entries(r.w.byReason)) {
  // An unmapped slug used to print itself, so an internal key reached a published table in a
  // row of sentences. A reason with no wording is a reason nobody decided how to report.
  if (!PRETTY[k]) throw new Error(`the reason "${k}" has no published wording, so this table would print its internal key beside ${v} site(s); add it to PRETTY`)
  const t = PRETTY[k]
  reasons[t] = (reasons[t] || 0) + v
}
const reasonsTotal = Object.values(reasons).reduce((a, b) => a + b, 0)
// The rows are the reason files' own tally and \RoundTwoUnexplained is the loss breakdowns', so
// the total line's "none of them without a reason" is a claim ACROSS two result files per
// application: the table now totals its own rows, and the two files are held against each other
// here rather than assumed to agree.
if (reasonsTotal !== tot.lost) throw new Error(`the reason rows account for ${reasonsTotal} sites and the loss breakdowns report ${tot.lost} lost: the reason table would publish a total neither file supports, and \\RoundTwoUnexplained would disagree with the table above it`)
out.push('\\newcommand{\\TabRoundTwoReasons}{%')
out.push('\\begin{tabular}{rl}')
out.push('\\toprule')
out.push('Sites & Reason the site is not a transition \\\\')
out.push('\\midrule')
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
  out.push(`${v} & ${k} \\\\`)
}
out.push('\\midrule')
out.push(`${reasonsTotal} & All, none of them without a reason \\\\`)
out.push('\\bottomrule')
out.push('\\end{tabular}}')

out.push('\\newcommand{\\TabRoundTwoSoundness}{%')
out.push('\\begin{tabular}{lrrrrrr}')
out.push('\\toprule')
out.push('Application & Edges & \\shortstack[r]{Sites\\\\cited} & Judged & \\shortstack[r]{Clean of\\\\judged} & \\shortstack[r]{Must\\\\clean} & \\shortstack[r]{Must\\\\conversion} \\\\')
out.push('\\midrule')
let mE = 0, mC = 0, mConv = 0, rawAll = 0, aS = 0, aC = 0, jS = 0, jC = 0, aE = 0
for (const r of rows) {
  const b = r.b1
  const conv = r.l1.tally.CONVERTED_MUST || 0
  mConv += conv; rawAll += r.l1.inScope
  // The witness check judges every source location an edge cites, so `clean` and the verdict
  // tally count SITES while `edges` counts edges. Mixing the two is what produced a negative
  // share. The must tier stays an edge count, because a finding at any citation condemns its
  // edge; everything judged per site is reported over the site total.
  if (b && b.sites === undefined) throw new Error(`${r.s}: its witness-check file predates the per-site judging and reports no site total, so a share over it cannot be computed`)
  if (b) { mE += b.mustEdges; mC += b.mustClean; aE += b.edges; aS += b.sites; aC += b.clean }
  const cell = b ? (b.mustEdges === 0 ? 'n/a' : `${b.mustClean}/${b.mustEdges}`) : '--'
  // The sites the check reached a verdict on: over-approximated sites and sites, of any modality, whose target it could not read are neither clean nor unclean.
  const judged = b ? judgedSites(b) : 0
  if (b) { jS += judged; jC += b.clean }
  out.push(`${NAME[r.s]} & ${b ? b.edges : '--'} & ${b ? b.sites : '--'} & ${b ? judged : '--'} & ${b ? pc(b.clean, judged) : '--'} & ${cell} & ${pc(conv, r.l1.inScope)} \\\\`)
}
out.push('\\midrule')
out.push(`All & ${aE} & ${aS} & ${jS} & ${pc(jC, jS)} & ${mC}/${mE} & ${pc(mConv, rawAll)} \\\\`)
out.push('\\bottomrule')
out.push('\\end{tabular}}')

const mac = (n, v) => out.push(`\\newcommand{\\${n}}{${v}}`)
mac('RoundTwoInScope', tot.inScope)
mac('RoundTwoRecovered', pc(tot.rec, tot.inScope))
mac('RoundTwoDynamic', pc(tot.dyn, tot.inScope))
mac('RoundTwoUnplaced', pc(tot.unp, tot.inScope))
mac('RoundTwoAccounted', pc(tot.rec + tot.dyn + tot.unp, tot.inScope))
mac('RoundTwoUnexplained', tot.lost)
mac('RoundTwoBefore', pc(tot.rec0, tot.raw0))
mac('RoundTwoExcluded', tot.excl)
// The three reasons a site leaves the denominator, so the sentence that names them is
// counted rather than remembered. There were two when it was written; the third was always
// there and was being counted as a recovered transition instead, which is why the breakdown
// is checked against its own total below rather than trusted to stay complete.
const exclBy = (k) => rows.reduce((a, r) => a + (r.l1.tally[k] ?? 0), 0)
const EXCL_GROUNDS = ['EXCLUDED_NAMED_OUTLET', 'EXCLUDED_NO_COMMANDS', 'QUERY_ONLY']
const groundsTotal = EXCL_GROUNDS.reduce((a, k) => a + exclBy(k), 0)
if (groundsTotal !== tot.excl) {
  throw new Error(`the grounds for leaving the denominator sum to ${groundsTotal} and ${tot.excl} sites left it; a ground has no macro and the sentence naming them would not add up`)
}
mac('RoundTwoExcludedQueryOnly', exclBy('QUERY_ONLY'))
mac('RoundTwoExcludedOutlet', exclBy('EXCLUDED_NAMED_OUTLET'))
mac('RoundTwoExcludedNoCommands', exclBy('EXCLUDED_NO_COMMANDS'))
mac('RoundTwoFullNodes', rows.filter((r) => r.c1.comparison.matched === r.c1.comparison.declaredScreens).length)
mac('RoundTwoMustClean', `${mC}/${mE}`)
// The ratio string above cannot stand where a sentence needs a number: it was substituted
// into "the tier holds ... edges" in four places and the PDF read "45/45 edges".
mac('RoundTwoMustEdges', mE)
mac('RoundTwoMustCleanCount', mC)
mac('RoundTwoMustViolations', mE - mC)
mac('RoundTwoMustConv', pc(mConv, rawAll))
mac('RoundTwoZeroMustApps', rows.filter((r) => r.b1 && r.b1.mustEdges === 0).length)
// The Routes column of the corpus table: the route entries the independent parser reached in the
// fin run, read from the result and not typed, since the figure moves whenever the parser does.
// A blind spot is a place where the parser could not read what the application declares, so an
// application that still has one is printed as a lower bound and one that has none as exact.
for (const r of rows) mac(`RoundTwoRoutes${MACRO_TAG[r.s]}`, `${r.c1.blindSpots.length > 0 ? '$\\geq$' : ''}${r.c1.routes.length}`)
// Which applications those are, and on what grounds, so no sentence has to name them from memory
// after a round moves the set. The reasons are the oracle's own blind-spot strings, deduplicated.
/**
 * Applications whose route set the runtime probe measured against the framework's own route
 * configuration and found to hold every address the framework mounts. Read from the probe's
 * committed comparison files when a directory is given; without one the set is empty and every
 * caveat stands, which is the behaviour this script had before the probe existed.
 */
const probeDir = (() => {
  const i = process.argv.indexOf('--probe')
  // Omitting the flag emptied the census at exit 0, which is the one failure in this script that
  // publishes nothing where a finding belongs and says so in no way a reader would notice. The
  // committed measurement sits beside this script, so that is the default and `--probe none` is
  // the way to ask for the behaviour this script had before the probe existed.
  if (i === -1) return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'route-probe', 'results')
  const next = process.argv[i + 1]
  if (next === 'none') return null
  // `--probe` with nothing after it was read as no probe directory at all, which reinstated every
  // caveat and emptied the census at exit 0 --- the one failure in this script that publishes
  // nothing where a finding belongs and says so in no way a reader would notice.
  if (!next || next.startsWith('--')) throw new Error('--probe needs a directory')
  return next
})()
/**
 * The three readings the licence is bounded by, every one of them required by name. The licence
 * is only as strong as what the probe could read: a subtree it failed to expand and a route
 * whose address no reader can resolve both shrink the set it compared against, and a smaller
 * comparison set can only make the extractor look more complete. compare-probe.mjs writes all
 * three on every run, so a file that carries one of them not at all is not that comparison's
 * output -- and reading an absent field as zero would license a route set nobody checked, which
 * is the one failure in this script that publishes every dead-link finding downstream. The slug
 * is checked for the same reason: a licence read out of another application's comparison is
 * attributed evidence, which is worse than no evidence.
 */
function licenceBounds(slug, cmp) {
  const c = cmp.counts ?? {}
  const miss = []
  if (!Array.isArray(cmp.lazyFailures)) miss.push('lazyFailures')
  for (const k of ['missed', 'matcherRoutes']) if (!Number.isInteger(c[k])) miss.push(`counts.${k}`)
  if (miss.length > 0) throw new Error(`${slug}.cmp.json: the probe licence is bounded by ${miss.join(' and ')}, which this file does not carry; an absent bound read as zero licenses a route set nobody checked`)
  if (cmp.slug !== slug) throw new Error(`${slug}.cmp.json reports on ${JSON.stringify(cmp.slug)}, so it cannot license ${slug}`)
  return { missed: c.missed, matcher: c.matcherRoutes, lazy: cmp.lazyFailures.length }
}
/**
 * The route configuration the framework itself holds, per application, read from the runtime
 * probe's committed output, and the classification of one address against it. This is the
 * per-candidate form of the licence: a link whose target the framework mounts nothing at is a
 * dead link whether or not the application's own route set is complete, and one whose target the
 * framework DOES serve is not a dead link however the extractor read it. The per-application
 * licence asks a harder question than the census needs --- is this whole route set complete ---
 * and loses the census of any application that misses one screen anywhere.
 */
const frameworkRoutes = new Map()
if (probeDir) {
  for (const r of rows) {
    const f = path.join(probeDir, `${r.s}.probe.json`)
    // Required by name. A probe file that is missing, or one whose application did not boot, used
    // to withhold that application's candidates in silence: a run in which one of six failed to
    // start published two of twenty-six findings and moved the rest into "no measurement can
    // decide", at exit 0.
    if (!fs.existsSync(f)) throw new Error(`${r.s}.probe.json is missing from ${probeDir}, so no framework configuration can decide its candidates`)
    const probe = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (!probe.ok) throw new Error(`${r.s}.probe.json reports the application did not boot (${probe.reason ?? 'no reason given'}), so it cannot decide its candidates`)
    // The slug is checked for the same reason the licence checks it: a route configuration read
    // out of another application's measurement is attributed evidence, and the census would then
    // accuse one application against another's route set.
    if (probe.slug !== r.s) throw new Error(`${r.s}.probe.json reports on ${JSON.stringify(probe.slug)}, so it cannot decide ${r.s}'s candidates`)
    if (probe.ok && Array.isArray(probe.routes)) frameworkRoutes.set(r.s, probe.routes)
  }
}

/**
 * What the framework does with a candidate's target, or null when nothing measured it. The four
 * answers are the classifier's own, and it declines to answer for an application that mounts a
 * route through a `UrlMatcher`, because such a route can claim any address.
 */
function frameworkVerdict(slug, target) {
  const routes = frameworkRoutes.get(slug)
  if (!routes || typeof target !== 'string' || !target.startsWith('/')) return null
  const answer = frameworkAnswer(routes, target)
  if (answer !== 'undecided') return answer
  // The configuration declines an address a `UrlMatcher` could claim. A navigation to that
  // address does not: the harness drove ghostfolio to /admin/users and the recogniser placed a
  // component there, while the census was publishing those three sites as sites no measurement
  // could decide --- in the same commit as the measurement that decides them.
  return navigated.get(`${slug} ${norm(target)}`) ?? null
}

/** What a navigation observed at an address, from the answerability measurement. */
const navigated = new Map()
if (probeDir) {
  for (const r of rows) {
    const f = path.join(probeDir, `${r.s}.answer.json`)
    // Skipping a missing file sent every address of that application into the undecided
    // bucket, which turned confirmed extractor defects into "no measurement can decide" and
    // moved four published macros, at exit 0. The sibling generator reading the same files
    // refuses, and so does this one: --probe none is how a caller says there is no probe.
    if (!fs.existsSync(f)) throw new Error(`${f} is missing, so every address of ${r.s} would fall to the undecided bucket and the dead-link figures would be measured over a smaller corpus than they claim; run answerability.mjs, or pass --probe none`)
    const answer = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (answer.slug !== r.s) throw new Error(`${r.s}.answer.json reports on ${JSON.stringify(answer.slug)}`)
    for (const row of answer.results ?? []) {
      const kind = !row.recognized || row.catchAll ? 'catch-all' : row.redirected ? 'redirect' : row.placesComponent ? 'screen' : 'no-screen'
      navigated.set(`${r.s} ${norm(row.target)}`, kind)
    }
  }
}

const confirmedComplete = new Set()
if (probeDir) {
  for (const r of rows) {
    // Required by name, like every other input: a path that does not resolve would otherwise
    // reinstate every caveat and empty the census at exit 0, which is the one failure this
    // script's history says costs the most.
    const b = licenceBounds(r.s, JSON.parse(fs.readFileSync(path.join(probeDir, `${r.s}.cmp.json`), 'utf8')))
    if (b.missed === 0 && b.lazy === 0 && b.matcher === 0) confirmedComplete.add(r.s)
  }
}

/**
 * Does this application support a claim that some path it does not declare is undeclared? Either
 * it declared no part of its route set unread, or the runtime probe compared what it declares
 * against the framework's own configuration and found every address the framework ANSWERS on the
 * primary outlet already in it. The probe's licence does not extend to prefix routes that answer
 * no URL of their own, which it reports separately and which cannot be a navigation target.
 */
function routeSetComplete(r) {
  if (confirmedComplete.has(r.s)) return true
  return !(r.notes ?? []).some((n) => n.kind === 'incomplete-route-set')
}

// The applications whose suppression the licence actually LIFTED: the ones it licensed that had
// also declared a lower bound, so that there was a caveat there to take off. An application the
// probe measured and licensed while it declared nothing is licensed and unchanged, and
// `routeSetComplete` would have answered true for it from its own notes alone. The two counts
// answer different questions and a sentence about applications exempted from the suppression
// needs this one: \RoundTwoProbeLicensed counts measured and licensed, \RoundTwoProbeLifted
// counts exempted, and on this corpus they are three and one.
const probeLifted = rows.filter((x) => confirmedComplete.has(x.s) && (x.notes ?? []).some((n) => n.kind === 'incomplete-route-set'))
mac('RoundTwoProbeLicensed', confirmedComplete.size)
mac('RoundTwoProbeLifted', probeLifted.length)
mac('RoundTwoProbeLicensedCaveated', probeLifted.map((x) => NAME[x.s]).join(', ') || 'none')

const lowerBound = rows.filter((r) => r.c1.blindSpots.length > 0)
mac('RoundTwoLowerBoundApps', lowerBound.length)
mac('RoundTwoLowerBoundWhere', lowerBound.map((r) => NAME[r.s]).join(', ') || 'none')
mac('RoundTwoLowerBoundReasons', [...new Set(lowerBound.flatMap((r) => r.c1.blindSpots.map((b) => b.reason)))].sort().join('; ') || 'none')
// The figures without mifos, which supplies three quarters of the corpus on its own.
const nm = rows.filter((r) => r.s !== 'mifos')
const nmS = nm.reduce((a, r) => a + r.l1.inScope, 0)
const nmR = nm.reduce((a, r) => a + r.l1.recovered, 0)
const nmA = nm.reduce((a, r) => a + r.l1.recovered + (r.l1.tally.ACCOUNTED_DYNAMIC || 0) + (r.l1.tally.ACCOUNTED_UNPLACED || 0), 0)
mac('RoundTwoNoMifosRecovered', pc(nmR, nmS))
mac('RoundTwoNoMifosAccounted', pc(nmA, nmS))
mac('RoundTwoMifosShare', pc(rows.find((r) => r.s === 'mifos').l1.inScope, tot.inScope))
// Why the unexplained sites are unexplained, by the two groups the thesis names.
/**
 * The target a note or reason row is about, as the extractor normalised it, read from the
 * one place both kinds of record spell it the same way: inside double quotes in `detail`.
 */
const targetOf = (rec) => (/"([^"]+)"/.exec(rec.detail ?? '') ?? [])[1] ?? null
/**
 * Is this target a path that names a screen, and so able to be absent from the route set?
 * The application root and a relative target are not: `/` is answered by the wildcard in an
 * application that declares no empty path, and a relative target is unresolved because the
 * analysis had no base to resolve it against, which is the analysis's gap, not a dead link.
 */
const namesAPath = (t) => t !== null && t.startsWith('/') && t !== '/'
/**
 * Which of the three reasons a target names no screen path applies. They were one bucket, and
 * the chapter described it as the relative one, which was true of eight of the nine sites and
 * not of the ninth: a note that quotes no target establishes nothing about the target, and
 * saying the analysis lacked a base to resolve it against claims more than the record holds.
 */
const notAPathKind = (t) => (t === null ? 'no-target' : t === '/' ? 'app-root' : 'relative')

/**
 * Can this application be said not to declare `target`? The question the dead-link claim
 * turns on, asked of the INDEPENDENT oracle's route set rather than of the extractor's notes.
 * The notes say "no node of mine matches", which is a claim about the extractor; a route the
 * application declares as a path prefix, or inside a module the oracle could not open, or at
 * an address with a hole where the first segment should be, satisfies the note and refutes
 * the dead link. Reading the note as the stronger claim is the mistake this whole round is
 * about, so the test is written once and both arms of the census use it.
 */
function undeclaredIn(c, target) {
  if (!namesAPath(target)) return 'not-a-path'
  const t = target.split('/').filter(Boolean)
  // A leading hole names a family of URLs, not an address, so it is evidence about no one of them.
  if (t[0].startsWith(':')) return 'pattern-only'
  const seg = (r) => String(r.path ?? '').split('/').filter(Boolean)
  const covers = (d) => d.length <= t.length && d.every((s, i) => s.startsWith(':') || t[i].startsWith(':') || s === t[i])
  for (const b of c?.blindSpots ?? []) {
    const d = String(b.prefix ?? '').split('/').filter(Boolean)
    if (d.length && covers(d)) return 'under-blind-spot'
  }
  for (const r of c?.routes ?? []) {
    const d = seg(r)
    if (d.length === t.length && d.every((s, i) => s.startsWith(':') || t[i].startsWith(':') || s === t[i])) {
      return r.kind === 'SCREEN' ? 'declared-no-node' : 'declared-not-a-screen'
    }
  }
  return 'undeclared'
}

/**
 * The route that placed `target` in the 'declared-not-a-screen' bucket: the first route in the
 * oracle's list at the same address, by the test `undeclaredIn` applies. `undeclaredIn` files
 * every non-SCREEN kind (PREFIX, REDIRECT, WILDCARD, LAZY_UNRESOLVED) under that one name and
 * does not say which it met, so the kind is read off this route, or the bucket gets named for
 * only one of the things in it.
 */
function placedRoute(c, target) {
  const t = target.split('/').filter(Boolean)
  return (c?.routes ?? []).find((r) => {
    const d = String(r.path ?? '').split('/').filter(Boolean)
    return d.length === t.length && d.every((s, i) => s.startsWith(':') || t[i].startsWith(':') || s === t[i])
  })
}

/**
 * Does the oracle's route set answer the bare URL of a prefix route? `undeclaredIn` files a
 * target under 'declared-not-a-screen' when the first route it matches is a component-less
 * prefix, and such a route can never have a node of its own. Angular matches a prefix only to
 * hand the rest of the URL to its children, so the prefix's own address is answered only when
 * one of them has the empty path, which the oracle records as a second route at the identical
 * full path that is a screen or a redirect. The question is put to the route that placed the
 * site in the bucket and to no other route that merely matches the target: a target hole matches
 * a declared literal (`:savingAccountId` against `gsim-account`), and a pair found that way
 * answers a different address. The address test is the one `undeclaredIn` applies.
 */
function prefixHasEmptyChild(c, target) {
  const placed = placedRoute(c, target)
  return placed?.kind === 'PREFIX' && c.routes.some((r) => r !== placed && /^(SCREEN|REDIRECT)$/.test(r.kind) && r.path === placed.path)
}

/** Does this site sit outside the directory that was measured, as a path that climbs out of it says? */
function outsideMeasuredDir(at) {
  return at.startsWith('../')
}

/**
 * Which base does the link at `at` in `app` resolve against: 'absolute' (the root), 'relative'
 * (the screen it fires from) or 'unknown' (the ledger cannot show which)? The extractor
 * resolves a link against its screen when it is a template link or a `navigate` call that
 * passes `relativeTo` (`nav.ts` sets `relative` from it, `extract.ts` picks the base by it), and
 * keeps no record that it did; the loss ledger keeps the construct's own text, so the answer is
 * read there. Only the ledger's literal evidence is used, and it is the evidence the extractor
 * itself acts on: a first command that is a complete quoted string or plain attribute text,
 * whose leading slash decides it. A slash-led head is 'absolute' for every kind of construct,
 * whatever follows it: a leading slash beats `relativeTo` in Angular and in
 * `resolveRelativeTarget`. Only a template link with a quoted, non-slash head is 'relative'; a
 * `navigate` call with the same head is 'unknown', because whether it passes `relativeTo` is in
 * the call's second argument, which the ledger's one line of the call may not show (a multi-line
 * call is cut at its first bracket).
 * A first command that is a name, a chain, a concatenation or a template string is 'unknown'
 * too, because the extractor resolves a name through constants this script cannot see and calls
 * the link absolute when the constant starts with a slash, so reading the raw text would count
 * it relative whatever the extractor did. The ledger does not tell a plain `routerLink="edit"`
 * from a bound `[routerLink]="edit"` either, so unquoted text that is not slash-led is
 * 'unknown' as well. A dead-link note names the owning component file, a ledger row the file the
 * construct sits in, so a site is looked up under both spellings; one that matches no row or
 * more than one is an error, because classing it by guess would put a figure in the thesis that
 * no result file supports.
 */
function linkBaseOf(app, at) {
  const ledger = rows.find((r) => r.s === app).l1.rows
  const hits = ledger.filter((x) => x.at === at || (x.owner && `${x.owner}:${x.at.replace(/^.*:/, '')}` === at))
  // The ledger covers the measured directory, so a site in a library beside it has no row by
  // construction. That is a reach the script cannot classify, not a lookup that went wrong.
  if (hits.length !== 1 && outsideMeasuredDir(at)) return 'unknown'
  if (hits.length !== 1) throw new Error(`${hits.length} loss-ledger rows at ${app} ${at}: cannot say whether the link is relative`)
  const head = hits[0].target.trim().replace(/^\[\s*/, '').split(',')[0].replace(/\]\s*\)?\s*;?\s*$/, '').trim()
  const lit = /^'([^']*)'$/.exec(head) ?? /^"([^"]*)"$/.exec(head)
  const text = lit ? lit[1] : head
  if (text.startsWith('/')) return 'absolute'
  return hits[0].kind === 'routerLink' && lit && text !== '' ? 'relative' : 'unknown'
}

// The sites whose target was read and could not be placed, split by the claim each group can
// support. The split is read off the reason slug the oracle assigned, never parsed back out
// of its prose: an earlier version re-derived it from `detail` here, the two scripts then
// disagreed about which sites were in which group, and the thesis printed a subtraction that
// did not close. Every member of the group lands in exactly one of the four counters below.
const NO_ROUTE_GROUP = /^(target-names-no-declared-route|unmapped-target|relative-target-unresolved|target-under-unreadable-subtree)$/
let noNode = 0, noRoute = 0, deadFromReasons = 0, relativeUnresolved = 0, underUnreadable = 0, caveatedReasons = 0, outsideDirReasons = 0
const deadSites = []
for (const r of rows) {
  // An application whose own route set the extractor could not read in full cannot support
  // a claim that some path is undeclared, so its sites are counted but never called dead ---
  // unless the runtime oracle has since measured that set against the framework's own
  // configuration and found it to hold every address the framework mounts. The note says the
  // set MIGHT be short; that measurement says it is not, and a measurement outranks a caution.
  const complete = routeSetComplete(r)
  for (const x of r.w?.rows ?? []) {
    if (/declared-route-has-no-node/.test(x.reason)) noNode++
    // `extractor-note:*` is the extractor repeating itself and is deliberately NOT counted.
    else if (NO_ROUTE_GROUP.test(x.reason)) {
      noRoute++
      if (x.reason === 'relative-target-unresolved') relativeUnresolved++
      else if (x.reason === 'target-under-unreadable-subtree') underUnreadable++
      else if (outsideMeasuredDir(x.at ?? '')) outsideDirReasons++
      else if (!complete && frameworkVerdict(r.s, targetOf(x)) !== 'catch-all') caveatedReasons++
      else { deadFromReasons++; deadSites.push({ app: r.s, at: x.at, target: targetOf(x) }) }
    }
  }
}
mac('RoundTwoRelativeUnresolved', relativeUnresolved)
mac('RoundTwoUnderUnreadable', underUnreadable)
// Spelled as a word at zero, so the sentence that lists the four residuals still reads and
// the figure still comes from the result file rather than from the author's memory of it.
mac('RoundTwoNoRouteCaveated', caveatedReasons === 0 ? 'none' : String(caveatedReasons))
mac('RoundTwoTargetNoNode', noNode)
mac('RoundTwoTargetNoRoute', noRoute)
// The shape of the must-tier violations, so the paragraph that describes them one by one
// is read off the witness check rather than typed. `mustBad` is exactly the set the
// soundness lemma is violated on; `findings` also holds the may and unknown tiers.
const mb = rows.flatMap((r) => r.b1?.mustBad ?? [])
mac('RoundTwoMustMismatch', mb.filter((f) => f.verdict === 'TARGET_MISMATCH').length)
mac('RoundTwoMustOffBy', mb.filter((f) => f.verdict === 'OFF_BY_N').length)
mac('RoundTwoMustInTs', mb.filter((f) => /\.ts:\d+$/.test(f.at)).length)
// Spelled as a word when it is zero, so the sentence reads and the claim still comes from
// the result file rather than from the author's memory of it.
const inTpl = mb.filter((f) => /\.html:\d+$/.test(f.at)).length
mac('RoundTwoMustInTemplate', inTpl === 0 ? 'none' : String(inTpl))
// Split by the target the witness RESOLVED to, which is what `detail` holds. The commands array
// as written is not recoverable here: the loss ledger is keyed by file and line and carries
// several constructs for one line, so no lookup recovers which of them this edge came from. The
// earlier two-way split called every mismatch that did not resolve under `..` a bare segment,
// which swept in two that resolve to the application root -- one of them a `navigateByUrl('/')`,
// not a commands array at all -- and the chapter asserted of all of them a property only the
// source shows. Three counters, and a sentence about resolved targets, is what the file supports.
const tm = mb.filter((f) => f.verdict === 'TARGET_MISMATCH')
mac('RoundTwoMustRelUp', tm.filter((f) => /targets \/\.\./.test(f.detail)).length)
mac('RoundTwoMustRelRoot', tm.filter((f) => /targets \/, edge/.test(f.detail)).length)
mac('RoundTwoMustRelBare', tm.filter((f) => !/targets \/\.\./.test(f.detail) && !/targets \/, edge/.test(f.detail)).length)
mac('RoundTwoGraphClean', pc(aC, aS))
mac('RoundTwoJudgedClean', pc(jC, jS))
mac('RoundTwoJudged', jS)
mac('RoundTwoSites', aS)
mac('RoundTwoOverApprox', pc(rows.reduce((a, r) => a + (r.b1?.tally?.OVER_APPROX ?? 0), 0), aS))
// The cited sites, of any modality, whose target the check could not read: out of the judged count above, so named beside it.
mac('RoundTwoUnreadSites', rows.reduce((a, r) => a + (r.b1?.tally?.TARGET_UNREAD ?? 0), 0))
// Sites whose target names no route the application declares, counted from the extractor's
// own notes rather than from the unexplained list, since a wildcard route resolves them.
// Counted as SITES, not as note records. A site attributed to several screens emits the
// note once per screen, so the record count ran ahead of the number of places in the source
// a reader could go and look: 79 records were 76 sites and the thesis called them sites.
let unres = 0
const wildSites = new Map()
for (const r of rows) for (const n of r.notes ?? []) {
  if (n.kind === 'wildcard-redirect') {
    const target = targetOf(n)
    const verdict = undeclaredIn(r.c1, target)
    // A site the extractor caveated because it could not read all of this application's route
    // set is decided, where it can be, by the framework's own configuration instead of by a
    // statement about the whole set: the census asks only whether THIS target is served.
    const caveated = /could not be read/.test(n.detail ?? '') && !confirmedComplete.has(r.s)
    // A site that names no address is in neither arm's question. Asking the framework first put
    // eighteen relative and empty targets into the caveated bucket, which the chapter explains as
    // an application no measurement could reach --- a reason that is false of every one of them.
    const fw = caveated && verdict !== 'not-a-path' && verdict !== 'pattern-only' ? frameworkVerdict(r.s, target) : null
    // A site outside the directory the measurement is scoped to is not published. The route set
    // it would be accused against is the measured application's, and a file that climbs out of
    // that directory belongs to another one: 54 of these are bitwarden's browser extension, whose
    // own router declares the very addresses the census called dead, and which the measured
    // application never loads --- the extension's source enters the program only because the
    // monorepo declares a `paths` alias for it. The measurement establishes neither that the
    // application loads the file nor that the route set compared against is the one the file's
    // own application mounts, and an accusation needs both.
    const bucket = outsideMeasuredDir(`${n.file}`) ? 'outside-measured-dir'
      : verdict === 'not-a-path' ? notAPathKind(target)
      // A leading hole names a family of URLs and no address, so there is nothing to put to the
      // configuration; it belongs in the bucket that says so, on either arm.
      : verdict === 'pattern-only' ? 'pattern-only'
      : caveated
        ? fw === 'catch-all' ? 'dead'
          : fw === 'screen' ? 'framework-mounts-it'
            : fw === 'no-screen' ? 'framework-prefix'
              : fw === 'redirect' ? 'framework-redirects'
                : 'caveated'
        : verdict === 'undeclared' ? 'dead'
          : verdict
    wildSites.set(`${r.s}:${n.file}:${n.loc?.line}:${target ?? ''}`, { bucket, app: r.s, at: `${n.file}:${n.loc?.line}`, target, placedKind: bucket === 'declared-not-a-screen' ? placedRoute(r.c1, target)?.kind : null, emptyChild: bucket === 'declared-not-a-screen' && prefixHasEmptyChild(r.c1, target) })
  } else if (n.kind === 'unresolved-target') unres++
}
const wildOf = (b) => [...wildSites.values()].filter((s) => s.bucket === b)
/** Dead sites reached through the framework's answer rather than through the oracle's route set. */
const deadByFramework = () => [...wildSites.values()].filter((s) => s.bucket === 'dead' && frameworkVerdict(s.app, s.target) === 'catch-all' && !confirmedComplete.has(s.app)).length
const deadFromNotes = wildOf('dead').length
// The three ways a catch-all-answered site is NOT evidence of a dead link, reported rather
// than folded into the residual: the oracle declares the route and the extractor minted no
// node for it, the route is a path prefix and never was a screen, or it sits inside a module
// the oracle could not open.
// A screen with no node is the extractor's defect; a prefix has no component and could never have one, so the two are different claims.
const wildNoNode = wildOf('declared-no-node').length
mac('RoundTwoWildcardNoNode', wildNoNode === 0 ? 'none' : String(wildNoNode))
const notScreen = wildOf('declared-not-a-screen')
// The bucket means "not a screen" and the macros below say "prefix", so a member of any other
// kind stops the run instead of being counted under the wrong name.
const notPrefix = notScreen.filter((s) => s.placedKind !== 'PREFIX')
if (notPrefix.length > 0) {
  throw new Error(`'declared-not-a-screen' holds ${notPrefix.length} site(s) placed by a route that is not a PREFIX: ${notPrefix.map((s) => `${s.app} ${s.at} (${s.placedKind})`).join('; ')}`)
}
const wildPrefix = notScreen.filter((s) => s.placedKind === 'PREFIX')
mac('RoundTwoWildcardPrefix', wildPrefix.length === 0 ? 'none' : String(wildPrefix.length))
mac('RoundTwoWildcardPrefixEmptyChild', wildPrefix.filter((s) => s.emptyChild).length)
mac('RoundTwoWildcardBlind', wildOf('under-blind-spot').length)
mac('RoundTwoWildcardPattern', wildOf('pattern-only').length)
mac('RoundTwoWildcardRelative', wildOf('relative').length)
mac('RoundTwoWildcardAppRoot', wildOf('app-root').length)
mac('RoundTwoWildcardNoTarget', wildOf('no-target').length)
// The buckets the chapter enumerates must account for every site, or the subtraction it prints
// does not close --- which it did not when the out-of-directory bucket was added and the
// enumeration was not. Checked here rather than left to a reader's arithmetic.
const ENUMERATED = ['caveated', 'declared-no-node', 'framework-mounts-it', 'framework-prefix', 'framework-redirects', 'declared-not-a-screen', 'under-blind-spot', 'pattern-only', 'relative', 'app-root', 'no-target', 'outside-measured-dir', 'dead']
const unenumerated = [...wildSites.values()].filter((x) => !ENUMERATED.includes(x.bucket))
if (unenumerated.length > 0) {
  throw new Error(`${unenumerated.length} rescued site(s) are in a bucket the chapter does not enumerate: ${[...new Set(unenumerated.map((x) => x.bucket))].join(', ')}`)
}
mac('RoundTwoWildcardRescued', wildSites.size)
mac('RoundTwoUnresolvedTarget', unres)
// A wildcard note whose detail carries the route-set caveat is NOT a dead-link candidate:
// for those the target was unreadable for the extractor's own reason, so nothing can be
// claimed about whether the application declares such a route.
mac('RoundTwoWildcardCaveated', wildOf('caveated').length)
// The sites the census does not publish because they sit outside the directory measured, and the
// directories they sit in, named from the records rather than from memory.
const outsideSites = [...wildOf('outside-measured-dir'), ...[]]
mac('RoundTwoOutsideDirSites', outsideSites.length + outsideDirReasons)
mac('RoundTwoOutsideDirWhere', [...new Set(outsideSites.map((x) => (/^((?:\.\.\/)+[^/]+)/.exec(x.at) ?? [])[1]).filter(Boolean))].sort().join(', ') || 'none')
mac('RoundTwoOutsideDirApps', new Set(outsideSites.map((x) => x.app)).size)
// The three ways the framework's own configuration answers a caveated site, which is what lets
// such a site be decided at all: it serves a screen there, it matches the address with a route
// that places only chrome, or it sends the visitor somewhere else. A site the framework answers
// with nothing but its catch-all is counted with the census, and one in an application the probe
// never measured, or whose address a `UrlMatcher` could claim, stays caveated.
mac('RoundTwoFrameworkMountsIt', wildOf('framework-mounts-it').length)
mac('RoundTwoFrameworkPrefix', wildOf('framework-prefix').length)
mac('RoundTwoFrameworkRedirects', wildOf('framework-redirects').length)
mac('RoundTwoFrameworkDecided', wildOf('framework-mounts-it').length + wildOf('framework-prefix').length + wildOf('framework-redirects').length + deadByFramework())
// The applications those sites are actually in. The lower-bound list is a different set --- it is
// the independent parser's blind spots, not the extractor's notes minus the probe's licence ---
// and naming one where the other is meant put an application in a sentence that carries none of
// the sites it counts.
mac('RoundTwoWildcardCaveatedApps', new Set(wildOf('caveated').map((s) => s.app)).size)
mac('RoundTwoWildcardCaveatedWhere', [...new Set(wildOf('caveated').map((s) => NAME[s.app]))].sort().join(', ') || 'none')
mac('RoundTwoDeadLinkCandidates', deadFromNotes + deadFromReasons)
mac('RoundTwoDeadLinkWildcarded', deadFromNotes)
// The two arms of the census are two different populations, so each states its own
// residual: the wildcard notes contribute sites a catch-all answers, the reason rows
// contribute sites nothing answers, and only their sum is the candidate list.
mac('RoundTwoDeadLinkUnanswered', deadFromReasons)
// What the surviving list actually is, so the subsection can report its own scale rather
// than leaving a site count to read as a defect count.
const allDead = [...deadSites, ...wildOf('dead')]
mac('RoundTwoDeadLinkUrls', new Set(allDead.map((d) => d.target)).size)
// A candidate is a site and a location is a file:line, and they differ: one
// `[routerLink]="'edit'"` is a single location and three candidates, one per owner screen. So
// the split is emitted in both units, each named for its own, and a sentence must not move from
// one to the other.
const locationOf = (d) => `${d.app}:${d.at}`
const baseAt = new Map(allDead.map((d) => [locationOf(d), linkBaseOf(d.app, d.at)]))
mac('RoundTwoDeadLinkLocations', baseAt.size)
for (const [name, base] of [['Absolute', 'absolute'], ['Relative', 'relative'], ['BaseUnknown', 'unknown']]) {
  mac(`RoundTwoDeadLink${name}`, allDead.filter((d) => baseAt.get(locationOf(d)) === base).length)
  mac(`RoundTwoDeadLink${name}Locations`, [...baseAt.values()].filter((b) => b === base).length)
}
// A site a shared library holds is reported against whichever application loads that library, so
// the count says how much of the surviving list the measured directory does not itself contain.
mac('RoundTwoDeadLinkOutsideDir', new Set(allDead.filter((d) => outsideMeasuredDir(d.at)).map(locationOf)).size)
mac('RoundTwoDeadLinkApps', new Set(allDead.map((d) => d.app)).size)
mac('RoundTwoDeadLinkWhere', [...new Set(allDead.map((d) => NAME[d.app]))].sort().join(', ') || 'none')

// The largest single fan-out in the corpus. Without this the graph-wide precision figure
// reads as a property of the method, when most of it is one call site: a `navigateByUrl`
// whose template literal has an empty static prefix over-approximates to every declared
// route, so one line can outweigh five applications. A figure nobody can attribute is a
// figure nobody can argue with.
const fanout = new Map()
for (const r of rows) for (const f of r.b1?.findings ?? []) {
  if (f.verdict !== 'OVER_APPROX' || !f.at) continue
  const k = `${r.s}\u0000${f.at}`
  fanout.set(k, (fanout.get(k) ?? 0) + 1)
}
const top = [...fanout.entries()].sort((a, b) => b[1] - a[1])[0]
const tex = (s) => String(s).replace(/([_#%&])/g, '\\$1')
mac('RoundTwoEdges', aE)
mac('RoundTwoTopFanoutEdges', top ? top[1] : 0)
mac('RoundTwoTopFanoutShare', top ? pc(top[1], aE) : '--')
mac('RoundTwoTopFanoutApp', top ? NAME[top[0].split('\u0000')[0]] : '--')
mac('RoundTwoTopFanoutSite', top ? `\\texttt{${tex(top[0].split('\u0000')[1].replace(/^.*\//, ''))}}` : '--')
const mifosEdges = rows.find((r) => r.s === 'mifos')?.b1?.edges ?? 0
mac('RoundTwoMifosEdgeShare', pc(mifosEdges, aE))

// The graph nodes the independent oracle matches to no declared screen, and how many of them
// are the extractor's own synthetic catch-all at route `*`. Both are counted so the prose that
// calls every one of them the catch-all is checked by these two figures agreeing, not asserted.
const extraNodes = rows.flatMap((r) => r.c1.comparison.extraNodes ?? [])
mac('RoundTwoExtraNodes', extraNodes.length)
mac('RoundTwoExtraNodesWildcard', extraNodes.filter((n) => n.route === '*').length)

// The dynamic sites of the application whose second column the thesis reads out, and how
// many files they are spread over: the point of the sentence is that they are a habit of the
// codebase rather than one builder to fix, which is a claim about the spread.
const kd = rows.find((r) => r.s === 'k8sdash')?.l1?.rows ?? []
const dynFiles = new Map()
for (const row of kd) if (row.cls === 'ACCOUNTED_DYNAMIC') dynFiles.set(row.owner, (dynFiles.get(row.owner) ?? 0) + 1)
mac('RoundTwoDynamicFiles', dynFiles.size)
mac('RoundTwoDynamicFilesOne', [...dynFiles.values()].filter((n) => n === 1).length)

/**
 * How one application's declared-screen denominator moved between the earlier oracle and this
 * round's. `pre` is the earlier oracle's own tracked output for the application
 * (`results-before/raw/<slug>.C.json`, which run-all.mjs's --label pre entry identifies as
 * index.mjs as it stood before f42b615) and `post` this round's (`<slug>.fin.C.json`); the
 * SCREEN paths of each are diffed, and every path that left is filed by what ALL the files that
 * declared it in `pre` say: `inside` if any of them is inside the application directory, else
 * `storybook` if any is a Storybook fixture, else `outside` (a file name that climbs out of the
 * directory). The weakest claim wins, never the oracle's walk order: a path declared both in a
 * sibling project and inside the application is a screen this application mounts, so calling it
 * "found only in other projects" would mint an attribution the data contradicts, which first-wins
 * did for bitwarden (its split changed with the walk order). The three classes still
 * partition the dropped paths, so `declared - dropped + added = now` holds by construction
 * instead of by a sentence typed into the thesis. `pre` and the control run
 * (`<slug>.ctrl.C.json`) are the same oracle reading the same source: their `routes` arrays are
 * byte-identical on all six applications, and they differ only in the graph each was compared
 * against. So the node table's declared column and this subtraction report ONE change, from the
 * earlier oracle to this one, while that table's before and after columns report a different
 * one, from the earlier extractor to the round-two extractor. One table, two changes, which is
 * why the caption says so and why these figures may not be set beside those as if they were one
 * measurement. `declared` and `now` count distinct SCREEN paths, which is what the
 * oracle's own `declaredScreens` counts, so the caller can hold each against the file's figure.
 */
function denominatorMove(pre, post) {
  const filesOf = new Map()
  for (const r of pre.routes) if (r.kind === 'SCREEN') filesOf.set(r.path, [...(filesOf.get(r.path) ?? []), r.file])
  const now = new Set(post.routes.filter((r) => r.kind === 'SCREEN').map((r) => r.path))
  const classOf = (file) => (/\.stories\.ts$/.test(file) ? 'storybook' : file.startsWith('../') ? 'outside' : 'inside')
  // A path the earlier run recorded as the EXPRESSION it was written as rather than as an
  // address: an unresolved enum member reads `/AuthRoute.Login`, an unresolved template
  // `/${ROUTE}`. Counted apart from the rest of `inside` because the chapter explains those two
  // differently, and saying of all the inside paths what is true of most of them is the kind of
  // sentence this section exists to stop.
  const verbatim = (p) => /[A-Za-z]\.[A-Za-z]/.test(p) || p.includes('${')
  const dropped = { outside: 0, storybook: 0, inside: 0, insideVerbatim: 0 }
  for (const [p, files] of filesOf) {
    if (now.has(p)) continue
    const classes = new Set(files.map(classOf))
    const cls = classes.has('inside') ? 'inside' : classes.has('storybook') ? 'storybook' : 'outside'
    dropped[cls]++
    if (cls === 'inside' && verbatim(p)) dropped.insideVerbatim++
  }
  return { declared: filesOf.size, ...dropped, added: [...now].filter((p) => !filesOf.has(p)).length, now: now.size }
}
// How many applications' declared SETS moved, and how many of those moved while the COUNT stood
// still: the count is the figure the node table prints and the one a reader takes for the
// denominator, and on this corpus it is a bad summary of the set.
const setMoved = []
// Only an application whose declared set moved gets macros: for the others the earlier oracle
// and this one agree, and a row of zeros beside the control run's different count would assert
// that nothing moved where the node table says something did.
for (const r of rows.filter((x) => x.pre)) {
  const m = denominatorMove(r.pre, r.c1)
  // Each file's declaredScreens must equal the distinct SCREEN paths of its own routes, checked before the skip below so an application that did not move is held to it too.
  if (m.declared !== r.pre.comparison.declaredScreens || m.now !== r.c1.comparison.declaredScreens) {
    throw new Error(`${r.s}: results-before/raw/${r.s}.C.json declares ${r.pre.comparison.declaredScreens} screens and lists ${m.declared} distinct SCREEN paths, ${r.s}.fin.C.json declares ${r.c1.comparison.declaredScreens} and lists ${m.now}; the oracle's declaredScreens is that count, so a file where the two differ is not an oracle run's output`)
  }
  // insideVerbatim is a part of inside, not a fourth class, so it is left out of this total.
  if (m.outside + m.storybook + m.inside + m.added === 0) continue
  setMoved.push(m)
  for (const [k, v] of Object.entries(m)) mac(`RoundTwoEarlierOracle${MACRO_TAG[r.s]}${k[0].toUpperCase()}${k.slice(1)}`, v)
}
/**
 * Edges whose only witness lies outside the application directory, totalled and for the
 * application that carries most of them. Both tools read those files, so the two agreeing about
 * such an edge is not independent evidence: the figure is what the independence caveat of
 * Chapter 4 costs on this corpus, which is why it is generated rather than described.
 */
const outside = rows.filter((r) => r.b1).map((r) => ({ s: r.s, n: r.b1.outsideApp ?? 0, m: r.b1.outsideAppMust ?? 0 }))
const worstOutside = outside.reduce((a, b) => (b.n > a.n ? b : a), { s: null, n: -1, m: 0 })
// The largest remaining group, named because it is now the majority of the remainder: a class
// the extractor parsed, found a navigation site in, and could place under no screen. It is the
// extractor's own note, so the reason is its record rather than this harness's inference.
/**
 * The first round's unexplained group, split by whose defect it was. These are the extractor
 * nodes the EARLIER oracle matched to no declared route of any kind. A node whose path is the
 * tail of an address that oracle did declare is the extractor assembling the path without its
 * parent prefix -- its own defect, not a table the parser missed -- and the chapter attributed
 * the whole group to the parser until this was counted.
 */
function firstRoundExtras() {
  let total = 0, truncated = 0, synthetic = 0
  for (const r of rows) {
    const all = new Set(r.pre.routes.map((x) => x.path))
    for (const e of r.pre.comparison.extraNodes ?? []) {
      if (all.has(e.route)) continue
      total++
      if (e.route === '*' || e.route === '/*') synthetic++
      else if ([...all].some((p) => p !== e.route && p.endsWith(e.route))) truncated++
    }
  }
  return { total, truncated, synthetic }
}
const fre = firstRoundExtras()
mac('RoundTwoFirstRoundExtra', fre.total)
mac('RoundTwoFirstRoundTruncated', fre.truncated)
mac('RoundTwoFirstRoundSynthetic', fre.synthetic)
mac('RoundTwoFirstRoundOther', fre.total - fre.truncated - fre.synthetic)

// The sites the control run set aside as a secondary-outlet navigation. Both spellings are
// accepted because the class was renamed to EXCLUDED_NAMED_OUTLET after the control run was
// made, and a filter on one of them reads a stale artifact as empty rather than saying so.
// Generated because the chapter names the figure and the application, and a count typed from
// memory was wrong by two.
const OUTLET_CLS = /^(EXCLUDED_)?NAMED_OUTLET$/
const ctrlOutlet = rows.map((r) => ({ s: r.s, n: (r.l0?.rows ?? []).filter((x) => OUTLET_CLS.test(x.cls)).length })).filter((x) => x.n > 0)
mac('RoundTwoCtrlOutlet', ctrlOutlet.reduce((a, b) => a + b.n, 0))
// How many of those sites the round-two run still carries, at the same file and line. It is all
// of them. The control ledger has no notion of exclusion at all -- its keys are appDir,
// constructs, lost, tally and rows -- so it counted these sites LOST under a class of its own,
// and the round-two ledger, the first to carry an exclusion concept, excludes none of them and
// accounts them under other classes. No comparison of denominators follows from that, because
// the control run has no denominator to compare.
const ctrlOutletStill = rows.reduce((a, r) => {
  const fin = new Set((r.l1?.rows ?? []).map((x) => x.at))
  return a + (r.l0?.rows ?? []).filter((x) => OUTLET_CLS.test(x.cls) && fin.has(x.at)).length
}, 0)
mac('RoundTwoCtrlOutletStill', ctrlOutletStill)
// The must tier per application, so a sentence about how far it grew is counted and not rounded.
for (const r of rows) if (r.b1?.mustEdges) mac(`RoundTwoMustEdges${MACRO_TAG[r.s]}`, r.b1.mustEdges)
mac('RoundTwoCtrlOutletWhere', ctrlOutlet.map((x) => NAME[x.s]).join(' and ') || 'none')
const UNPLACED_TEXT = PRETTY['extractor-note:unattributed-non-component']
mac('RoundTwoUnplacedClass', reasons[UNPLACED_TEXT] ?? 0)
mac('RoundTwoOutsideWitness', outside.reduce((a, b) => a + b.n, 0))
mac('RoundTwoOutsideWitnessMust', outside.reduce((a, b) => a + b.m, 0))
mac('RoundTwoOutsideWitnessApps', outside.filter((o) => o.n > 0).length)
mac('RoundTwoOutsideWitnessWorst', NAME[worstOutside.s] ?? 'none')
mac('RoundTwoOutsideWitnessWorstN', worstOutside.n)
mac('RoundTwoOutsideWitnessWorstMust', worstOutside.m)
mac('RoundTwoSetMoved', setMoved.length)
mac('RoundTwoSetMovedCountSame', setMoved.filter((m) => m.declared === m.now).length)
console.log(out.join('\n'))
