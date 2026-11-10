/**
 * Turns the probe's comparison files into the LaTeX the thesis includes. Every number the chapter
 * states about the dynamic check comes from here, so none of them is typed by hand.
 *
 * A `--before` directory may hold the route oracle's output from before the round the probe
 * opened, as `<slug>.before.C.json`. Those sets are tested against the same framework reading, so
 * the chapter can say how many addresses the static readers agreed on that the application mounts
 * none of, without that number being typed by hand.
 *
 * Usage: node to-latex.mjs --results <dir> [--scope <dir>] [--before <dir>] --out <file>
 * (--scope: where the scope check results are, default --results)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXCLUSIONS, routeBuckets, unaddressableScreens } from './buckets.mjs'
import { frameworkAnswer, matches } from './framework-answer.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const LABEL = {
  realworld: 'realworld',
  alfresco: 'alfresco',
  ghostfolio: 'ghostfolio',
  k8sdash: 'k8s dashboard',
  bitwarden: 'bitwarden',
  mifos: 'mifos',
}

/** Reads the flags this script takes into a plain object. */
function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    out[key] = next && !next.startsWith('--') ? next : true
  }
  return out
}

const a = args(process.argv.slice(2))
const scopeTable = []
if (!a.results || !a.out) {
  console.error('usage: node to-latex.mjs --results <dir> --out <file>')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(join(HERE, 'apps.json'), 'utf8'))
const rows = manifest.apps.map((app) => {
  const cmp = JSON.parse(readFileSync(join(a.results, `${app.slug}.cmp.json`), 'utf8'))
  const probe = JSON.parse(readFileSync(join(a.results, `${app.slug}.probe.json`), 'utf8'))
  // The census's own classifier, re-run here over the probe file: it throws unless every route
  // entry falls in exactly one bucket, so a table whose columns do not account for the route total
  // is never written. The second test is that the bucketing agrees with the comparison file the
  // table's mounted column is taken from, which a stale comparison file would fail.
  const { counts: buckets, stray } = routeBuckets(probe.routes)
  const bucketed = Object.values(buckets).reduce((n, v) => n + v, 0)
  if (bucketed !== probe.routes.length) {
    throw new Error(`${app.slug}: ${bucketed} route entries bucketed of ${probe.routes.length}; the closure table would not account for the route total`)
  }
  if (buckets.mounted !== cmp.counts.frameworkScreens) {
    throw new Error(`${app.slug}: the buckets mount ${buckets.mounted} addresses and ${app.slug}.cmp.json reports ${cmp.counts.frameworkScreens}; re-run compare-probe.mjs`)
  }
  if (stray > 0) {
    throw new Error(`${app.slug}: ${stray} route(s) place a component and are excluded for a reason the table shows as costing nothing; name the loss or the census publishes a screen it dropped in silence`)
  }
  const c0 = cmp.counts
  if (c0.frameworkScreens - c0.extractorNodes + c0.invented !== c0.missed + c0.missedPrefixOnly) {
    throw new Error(`${app.slug}: mounted less nodes is ${c0.frameworkScreens - c0.extractorNodes} and the difference columns hold ${c0.missed + c0.missedPrefixOnly - c0.invented}; the caption's accounting does not hold`)
  }
  return { slug: app.slug, cmp, probe, buckets, loss: unaddressableScreens(probe.routes) }
})

/** Sums one field of the comparison counts across the corpus. */
const total = (pick) => rows.reduce((n, r) => n + pick(r), 0)

/** Normalises an address the way compare-probe.mjs does, so the two sets compare as strings. */
function norm(p) {
  if (typeof p !== 'string') return null
  const s = `/${p}`.replace(/\/+/g, '/').replace(/\/$/, '')
  if (s === '') return '/'
  return s.replace(/\/\*$/, '/**')
}

/**
 * The addresses one earlier oracle run declared as screens that the framework mounts nothing at.
 * Returns null when no such run was supplied for the application. The mounted set is the one
 * compare-probe.mjs already decided and wrote down, rather than a second filter over the probe's
 * routes: deriving it here left out the exclusions that file applies, so an address the framework
 * holds a route for but mounts no screen at counted as mounted.
 */
function beforeNotMounted(slug, cmp) {
  if (!a.before) return null
  let before
  try {
    before = JSON.parse(readFileSync(join(a.before, `${slug}.before.C.json`), 'utf8'))
  } catch {
    return null
  }
  if (!Array.isArray(cmp.frameworkAddresses)) {
    throw new Error(`${slug}.cmp.json has no frameworkAddresses: re-run compare-probe.mjs`)
  }
  const mounted = new Set(cmp.frameworkAddresses)
  const declared = new Set(before.routes.filter((r) => r.kind === 'SCREEN').map((r) => norm(r.path)))
  return [...declared].filter((p) => !mounted.has(p))
}

const lines = []
lines.push('% Generated by to-latex.mjs from the probe results. Do not edit.')
lines.push(`\\newcommand{\\ProbeHarnessVersion}{${manifest.harnessVersion}}`)
lines.push('\\newcommand{\\TabProbe}{%')
// Nine columns do not fit the text block at the default column separation.
lines.push('\\setlength{\\tabcolsep}{4pt}%')
lines.push('\\begin{tabular}{@{}lrrrrrrrc@{}}')
lines.push('\\toprule')
const head = ['Not\\\\mounted', 'Not\\\\minted', 'Prefix\\\\only', 'Matcher\\\\only'].map((h) => `\\shortstack[r]{${h}}`).join(' & ')
lines.push(`Application & Routes & Mounted & Nodes & ${head} & \\shortstack[c]{Declared\\\\incomplete} \\\\`)
lines.push('\\midrule')
for (const r of rows) {
  const c = r.cmp.counts
  const said = r.cmp.routeSet.declares ? 'yes' : 'no'
  lines.push(`${LABEL[r.slug]} & ${r.probe.routes.length} & ${c.frameworkScreens} & ${c.extractorNodes} & ${c.invented} & ${c.missed} & ${c.missedPrefixOnly || 0} & ${r.buckets.underMatcher} & ${said} \\\\`)
}
lines.push('\\midrule')
lines.push(`All & ${total((r) => r.probe.routes.length)} & ${total((r) => r.cmp.counts.frameworkScreens)} & ${total((r) => r.cmp.counts.extractorNodes)} & ${total((r) => r.cmp.counts.invented)} & ${total((r) => r.cmp.counts.missed)} & ${total((r) => r.cmp.counts.missedPrefixOnly || 0)} & ${total((r) => r.buckets.underMatcher)} & \\\\`)
lines.push('\\bottomrule')
lines.push('\\end{tabular}}')

// The closure itself, one row per application: the route total of Table~\ref{tab:probe} split into
// the bucket each entry falls in. The generator throws unless each row sums to the route total, so
// the table cannot be read as an accounting that does not account for everything.
lines.push('\\newcommand{\\TabProbeClosure}{%')
lines.push('\\setlength{\\tabcolsep}{4pt}%')
lines.push(`\\begin{tabular}{@{}lrr${'r'.repeat(EXCLUSIONS.length + 1)}@{}}`)
lines.push('\\toprule')
const CLOSURE_HEAD = { collapsed: 'One\\\\address', componentless: 'No\\\\component', redirect: 'Redirect', namedOutlet: 'Named\\\\outlet', emptyOutlet: 'Empty\\\\outlet', underMatcher: 'Matcher' }
const CLOSURE_COLS = ['collapsed', ...EXCLUSIONS.map(([name]) => name)]
for (const name of CLOSURE_COLS) {
  if (!CLOSURE_HEAD[name]) throw new Error(`the classifier excludes routes as ${name} and the closure table has no column for it`)
}
const closureHead = CLOSURE_COLS.map((name) => `\\shortstack[r]{${CLOSURE_HEAD[name]}}`).join(' & ')
lines.push(`Application & Routes & Mounted & ${closureHead} \\\\`)
lines.push('\\midrule')
for (const r of rows) {
  const cells = CLOSURE_COLS.map((name) => r.buckets[name]).join(' & ')
  lines.push(`${LABEL[r.slug]} & ${r.probe.routes.length} & ${r.buckets.mounted} & ${cells} \\\\`)
}
lines.push('\\midrule')
const closureAll = CLOSURE_COLS.map((name) => total((r) => r.buckets[name])).join(' & ')
lines.push(`All & ${total((r) => r.probe.routes.length)} & ${total((r) => r.buckets.mounted)} & ${closureAll} \\\\`)
lines.push('\\bottomrule')
lines.push('\\end{tabular}}')

const macros = {
  ProbeApps: rows.length,
  ProbeRoutes: total((r) => r.probe.routes.length),
  ProbeScreens: total((r) => r.cmp.counts.frameworkScreens),
  ProbeNodes: total((r) => r.cmp.counts.extractorNodes),
  ProbeInvented: total((r) => r.cmp.counts.invented),
  ProbeMissed: total((r) => r.cmp.counts.missed),
  ProbeSharedBlindSpot: total((r) => r.cmp.counts.sharedBlindSpot),
  ProbeLazyFailures: total((r) => (r.probe.lazyFailures || []).length),
  ProbePageErrors: total((r) => (r.probe.pageErrors || []).length),
  ProbePageErrorApps: rows.filter((r) => (r.probe.pageErrors || []).length > 0).length,
  ProbeConsoleErrorApps: rows.filter((r) => (r.probe.consoleErrors || []).length > 0).length,
  ProbeConsoleErrors: total((r) => (r.probe.consoleErrors || []).length),
  ProbeMissedPrefixOnly: total((r) => r.cmp.counts.missedPrefixOnly || 0),
  // The prefix-only column split in two, because it reported one number for two different
  // phenomena: a prefix that answers its own URL by redirecting into the subtree, and one that
  // answers it with the shell and no screen beyond it.
  ProbeMissedPrefixRedirect: total((r) => r.cmp.counts.missedPrefixRedirect || 0),
  ProbeMissedPrefixUnanswered: total((r) => r.cmp.counts.missedPrefixUnanswered || 0),
  ProbeMatcherRoutes: total((r) => r.cmp.counts.matcherRoutes || 0),
  // The closure of the route total: every entry of a configuration falls in exactly one of these,
  // and routeBuckets throws unless they sum to it, so the census cannot quietly hold a route it
  // files nowhere.
  ...Object.fromEntries(['collapsed', ...EXCLUSIONS.map(([name]) => name)].map((name) => [
    `ProbeDrop${name[0].toUpperCase()}${name.slice(1)}`, total((r) => r.buckets[name]),
  ])),
  // Of the exclusions, the two that drop a component the application does place: the census has no
  // address for these at all, so they are a loss of the census and not a screen it declines to
  // credit. Everything else excluded places no component anywhere.
  ProbeOutletScreens: total((r) => r.loss.namedOutlet),
  ProbeMatcherScreens: total((r) => r.loss.matcher),
  ProbeUnaddressableScreens: total((r) => r.loss.namedOutlet + r.loss.matcher),
  ProbeMissedGhostfolio: rows.find((r) => r.slug === 'ghostfolio').cmp.counts.missed,
  ProbeMissedAlfresco: rows.find((r) => r.slug === 'alfresco').cmp.counts.missed,
  ProbeMissedBitwarden: rows.find((r) => r.slug === 'bitwarden').cmp.counts.missed,
  ProbeMissedMifos: rows.find((r) => r.slug === 'mifos').cmp.counts.missed,
  ProbeZeroInventedApps: rows.filter((r) => r.cmp.counts.invented === 0).length,
  ProbeInventedWhere: rows.filter((r) => r.cmp.counts.invented > 0).map((r) => LABEL[r.slug]).join(', ') || 'none',
  ProbeInventedApps: rows.filter((r) => r.cmp.counts.invented > 0).length,
  ProbeExactApps: rows.filter((r) => r.cmp.counts.invented === 0 && r.cmp.counts.missed === 0).length,
  // The correspondence the chapter rests on, counted rather than asserted: an application the
  // probe finds a missing screen in is an application that said it could not read part of its
  // route set, and one that said nothing is one the probe finds nothing missing in.
  ProbeDeclaredIncomplete: rows.filter((r) => r.cmp.routeSet.declares).length,
  ProbeMissedWithDeclaration: rows.filter((r) => r.cmp.counts.missed > 0 && r.cmp.routeSet.declares).length,
  ProbeMissedWithoutDeclaration: rows.filter((r) => r.cmp.counts.missed > 0 && !r.cmp.routeSet.declares).length,
  ProbeSilentAndComplete: rows.filter((r) => r.cmp.counts.missed === 0 && !r.cmp.routeSet.declares).length,
  // An application that said it could not read part of its route set and turned out to be missing
  // nothing: the declaration was true of the reading and cost the route set nothing.
  ProbeDeclaredButComplete: rows.filter((r) => r.cmp.counts.missed === 0 && r.cmp.routeSet.declares).length,
  ProbeDeclaredButCompleteWhere: rows.filter((r) => r.cmp.counts.missed === 0 && r.cmp.routeSet.declares).map((r) => LABEL[r.slug]).join(', ') || 'none',
  // How far the reading this comparison depends on --- which entries of a route configuration
  // answer an address with a screen --- was held against what the framework was observed to do.
  // Counted here rather than asserted in the chapter, from answerability.mjs's own output and
  // the same classifier the comparison uses, so a disagreement cannot be reported as agreement.
  ...answerMacros(),
  // The scope oracle: whether the SET OF SCREENS attribution computed for a navigation site is
  // the set the running application renders it on. Counted from scope-check.mjs's own output.
  ...scopeMacros(),
}

/**
 * The scope oracle's figures and its table. Only the direction "rendered but not predicted" is
 * evidence against the analysis, and the bound is as important as the figure: a screen the
 * router redirects away from without a backend cannot be judged at all, and on this corpus that
 * is most of them. Both are published, so the share is never read as covering the corpus.
 */
function scopeMacros() {
  const files = rows.map((r) => ({ slug: r.slug, path: join(a.scope ?? a.results, `${r.slug}.scope.json`) })).filter((f) => existsSync(f.path))
  if (!files.length) return {}
  const rs = files.map((f) => ({ slug: f.slug, ...JSON.parse(readFileSync(f.path, 'utf8')) }))
  // One measurement means one harness. A file with no stamp predates the version that reads a
  // static routerLink, and mixing it with the others publishes two readings as one.
  const versions = [...new Set(rs.map((r) => r.scopeHarness ?? 'unstamped'))]
  if (versions.length > 1) {
    throw new Error(`the scope results come from ${versions.join(' and ')}; re-run scope-check.mjs for every application so the table is one measurement`)
  }
  const sum = (k) => rs.reduce((t, r) => t + (r[k] || 0), 0)
  // The unit is a (screen, target pattern) pair, because that is what a scope claims. The raw
  // anchor count is published beside it and never as the headline: one tag list renders fifteen
  // anchors answering one pattern, and a shared header's links are rendered again on every
  // screen, so anchors overstate the number of facts by roughly a factor of two here.
  const pairs = sum('pairs')
  const confirmed = sum('pairsConfirmed')
  const unpredicted = sum('pairsUnpredicted')
  const anchors = sum('observedLinks')
  if (confirmed + unpredicted !== pairs) {
    throw new Error(`the scope oracle saw ${pairs} rendered (screen, pattern) pairs and classified ${confirmed + unpredicted}; every pair must be either predicted or not`)
  }
  if (rs.some((r) => r.pairs === undefined)) {
    throw new Error('a scope result predates the pair count; re-run scope-check.mjs for every application')
  }
  if (rs.some((r) => r.predictedDefinite === undefined)) {
    throw new Error('a scope result predates the exact-target split, so the over-attribution direction cannot be reported; re-run scope-check.mjs for every application')
  }
  // The over-attribution direction is only as strong as the number of predictions it can be
  // asked about. Published so the chapter states the denominator rather than the share.
  const exact = sum('predictedDefinite')
  const over = sum('overAttributed')
  if (over > exact) {
    throw new Error(`${over} predictions were judged over-attributed out of ${exact} that carry an exact destination`)
  }
  scopeTable.push('\\newcommand{\\TabScope}{%', '\\begin{tabular}{@{}lrrrrrr@{}}', '\\toprule')
  scopeTable.push('Application & Screens & Judged & \\shortstack[r]{Pairs\\\\rendered} & \\shortstack[r]{Predicted\\\\by the scope} & \\shortstack[r]{Not\\\\predicted} & \\shortstack[r]{Raw\\\\anchors} \\\\', '\\midrule')
  for (const r of rs) scopeTable.push(`${LABEL[r.slug] ?? r.slug} & ${r.screensInGraph} & ${r.usable} & ${r.pairs} & ${r.pairsConfirmed} & ${r.pairsUnpredicted} & ${r.observedLinks} \\\\`)
  scopeTable.push('\\midrule', `All & ${sum('screensInGraph')} & ${sum('usable')} & ${pairs} & ${confirmed} & ${unpredicted} & ${anchors} \\\\`)
  scopeTable.push('\\bottomrule', '\\end{tabular}}')
  return {
    ScopeApps: rs.length,
    ScopeScreens: sum('screensInGraph'),
    ScopeJudged: sum('usable'),
    ScopeUnjudged: sum('redirectedAway'),
    ScopePairs: pairs,
    ScopeConfirmed: confirmed,
    ScopeConfirmedShare: pairs ? `${((confirmed / pairs) * 100).toFixed(1)}\\,\\%` : 'n/a',
    ScopeAnchors: anchors,
    ScopeUnpredicted: unpredicted,
    ScopeUnrendered: sum('unrendered'),
    ScopeExact: exact,
    ScopeApprox: sum('predictedApprox'),
    ScopeOverAttributed: over,
  }
}

/**
 * The agreement between the classification taken from the route configuration and the verdict a
 * navigation produced, over every application an answerability measurement exists for. An address
 * the classifier declines to decide --- which it does for an application mounting a route through
 * a `UrlMatcher`, since such a route may claim any address --- is counted apart rather than
 * scored, because a declined answer is neither agreement nor disagreement.
 */
function answerMacros() {
  const out = { ProbeAnswerApps: 0, ProbeAnswerAddresses: 0, ProbeAnswerChecked: 0, ProbeAnswerAgreed: 0, ProbeAnswerUndecided: 0, ProbeCmpChecked: 0, ProbeCmpAgreed: 0 }
  let missing = 0
  for (const r of rows) {
    const f = join(a.results, `${r.slug}.answer.json`)
    if (!existsSync(f)) { missing += 1; continue }
    const answer = JSON.parse(readFileSync(f, 'utf8'))
    // The file has to be this application's, and it has to carry a measurement: a file naming
    // another application, or one whose addresses the probe file does not cover, would publish an
    // agreement over evidence that is not about what the macro says it is about.
    if (answer.slug !== r.slug) throw new Error(`${r.slug}.answer.json reports on ${JSON.stringify(answer.slug)}`)
    if (!Array.isArray(answer.results) || answer.results.length === 0) throw new Error(`${r.slug}.answer.json carries no measurement`)
    out.ProbeAnswerApps += 1
    const served = Array.isArray(r.cmp.frameworkAddresses) ? r.cmp.frameworkAddresses : null
    for (const row of answer.results) {
      out.ProbeAnswerAddresses += 1
      // The comparison's own predicate, held against the same navigations on the two
      // implications that bind it: a screen it must hold, a catch-all it must not.
      const seenKind = !row.recognized || row.catchAll ? 'catch-all' : row.redirected ? 'redirect' : row.placesComponent ? 'screen' : 'no-screen'
      if (served && (seenKind === 'screen' || seenKind === 'catch-all') && frameworkAnswer(r.probe.routes, row.target) !== 'undecided') {
        out.ProbeCmpChecked += 1
        if (served.some((pattern) => matches(pattern, row.target)) === (seenKind === 'screen')) out.ProbeCmpAgreed += 1
      }
      const got = frameworkAnswer(r.probe.routes, row.target)
      if (got === 'undecided') { out.ProbeAnswerUndecided += 1; continue }
      out.ProbeAnswerChecked += 1
      const want = !row.recognized || row.catchAll ? ['catch-all'] : row.redirected ? ['redirect', 'catch-all'] : [row.placesComponent ? 'screen' : 'no-screen']
      if (want.includes(got)) out.ProbeAnswerAgreed += 1
    }
  }
  // An application with no measurement is not one whose classification agreed. Printing an
  // agreement over whatever files happen to be present would let the chapter cite a check that was
  // not run, so a run with no measurement at all stops instead of emitting a pass over nothing.
  if (missing > 0) throw new Error(`${missing} application(s) have no answerability measurement in ${a.results}; the agreement would be published over whatever files happen to exist`)
  return out
}

const before = rows.map((r) => ({ slug: r.slug, bad: beforeNotMounted(r.slug, r.cmp) })).filter((r) => r.bad !== null)
if (before.length > 0) {
  macros.ProbeBeforeApps = before.length
  macros.ProbeBeforeNotMounted = before.reduce((n, r) => n + r.bad.length, 0)
  macros.ProbeBeforeWhere = before.filter((r) => r.bad.length > 0).map((r) => LABEL[r.slug]).join(', ') || 'none'
  macros.ProbeBeforeAffectedApps = before.filter((r) => r.bad.length > 0).length
}
for (const [k, v] of Object.entries(macros)) lines.push(`\\newcommand{\\${k}}{${v}}`)
lines.push(...scopeTable)

writeFileSync(a.out, `${lines.join('\n')}\n`)
console.log(`wrote ${a.out}: ${rows.length} applications, ${macros.ProbeInvented} minted-but-not-mounted, ${macros.ProbeMissed} mounted-but-not-minted`)
console.log(`closure: ${macros.ProbeRoutes} route entries bucketed, ${macros.ProbeScreens} mounted, ${macros.ProbeUnaddressableScreens} component(s) excluded for want of an address`)
