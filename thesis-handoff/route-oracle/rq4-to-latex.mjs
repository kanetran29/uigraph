#!/usr/bin/env node
//
// Emits the RQ4 tables from the mutation result files. Never edit the output by hand.
// usage: node rq4-to-latex.mjs <rq4-*.json ...> > generated-rq4.tex
// The per-application diagnostics go to stderr, and results-rq4/rq4-diagnostics.txt is that
// stream: refresh it with 2> results-rq4/rq4-diagnostics.txt whenever the result files change,
// since a diagnostics file left behind by an earlier run is a figure waiting to be miscopied.
// Files named rq4base-* are the unattributed baseline and are read separately; the other files
// are the attributed runs, whose argument order is the column order of the tables. The current
// thesis is produced with the attributed runs as realworld, alfresco, bitwarden, then the three
// rq4base-* files in any order.
//
import fs from 'node:fs'
import path from 'node:path'

const OPS = ['RENAME_PATH', 'DELETE_ROUTERLINK', 'CHANGE_NAV_TARGET', 'REMOVE_GUARD']
const PRETTY = {
  RENAME_PATH: 'Rename a route path',
  DELETE_ROUTERLINK: 'Delete a \\texttt{routerLink}',
  CHANGE_NAV_TARGET: 'Retarget a \\texttt{navigate}',
  REMOVE_GUARD: 'Remove a guard',
}

const runs = process.argv.slice(2).filter((f) => !path.basename(f).startsWith('rq4base-')).map((f) => {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'))
  r.slug = path.basename(f).replace(/^rq4-/, '').replace(/-attributed\.json$/, '')
  return r
})

/** Detections where only the witness set moved, the edge set being legitimately unchanged. */
function witnessOnly(run, kind) {
  return run.results.filter((x) => x.kind === kind && x.verdict === 'DETECTED' && x.delta &&
    !((x.delta.edgesRemoved || []).length || (x.delta.edgesAdded || []).length ||
      (x.delta.routeChanged || []).length || (x.delta.nodesAdded || []).length ||
      (x.delta.nodesRemoved || []).length || (x.delta.guardChanged || []).length)).length
}

/**
 * The scored mutants the graph did not flag, optionally for one operator: MISSED got no
 * response at all, WRONG got a response that is not the predicted one. EXCLUDED mutants are
 * never failures, because the harness could not score them either way.
 */
function failures(run, kind) {
  return run.results.filter((x) => (x.verdict === 'MISSED' || x.verdict === 'WRONG') && (!kind || x.kind === kind))
}

/**
 * True when a mutant's delta is empty in every field it carries, meaning the mutation moved
 * nothing in the graph. A mutant with no delta at all is not treated as empty, so a record
 * that lacks the evidence cannot be counted as having shown the absence.
 */
function emptyDelta(delta) {
  return !!delta && Object.values(delta).every((v) => !v || v.length === 0)
}

/**
 * Reads, from a REMOVE_GUARD mutant's own subject text, how the harness labelled the guard it
 * removed: 'emptyPath' when it recorded the guarded path as the empty string, 'namedCall' when
 * the canActivate element is written as a call, guard(), rather than as a name. The label is the
 * harness's, not a fact about the route: it reads the nearest preceding path literal, which for a
 * route that has children is the last child's path rather than the route's own. Returns null when
 * the record shows neither, so the caller's sum check refuses it instead of guessing.
 */
function guardMissCause(x) {
  if (/^path ""$/.test(x.subject)) return 'emptyPath'
  if (/^canActivate:\s*\[\s*[\w$]+\s*\(/.test(x.subject)) return 'namedCall'
  return null
}

/**
 * Scored guard mutants the harness labelled with the empty path, split by outcome. The prose
 * needs both halves: such a mutant is detected more often than not, so the empty path is not
 * what separates a detected guard mutant from a missed one.
 */
function emptyPathGuards(runs) {
  const all = runs.flatMap((r) => r.results.filter((x) => x.kind === 'REMOVE_GUARD' &&
    x.verdict !== 'EXCLUDED' && guardMissCause(x) === 'emptyPath'))
  return { scored: all.length, detected: all.filter((x) => x.verdict === 'DETECTED').length }
}

/**
 * Reads the route segment an EXCLUDED mutant's reason names, for example
 * 'no baseline edge enters a screen with route segment "sends"'. Throws on a reason of any
 * other shape, since a segment guessed from free text would reach the thesis unchecked.
 */
function excludedSegment(x) {
  const m = /route segment "([^"]+)"/.exec(x.reason || '')
  if (!m) throw new Error(`cannot read a route segment from the reason of the excluded mutant at ${x.file}:${x.line}: ${JSON.stringify(x.reason)}`)
  return m[1]
}

/**
 * Renders text as \texttt{} with every character LaTeX reads as markup escaped, so a route
 * segment such as a path parameter or an underscore name cannot break the document.
 */
function texttt(s) {
  const ESC = { '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }
  return `\\texttt{${s.replace(/[\\~^{}#$%&_]/g, (c) => ESC[c] || `\\${c}`)}}`
}

/**
 * Turns an application slug into the capitalised suffix of a macro name, refusing a slug with
 * a character a LaTeX control sequence cannot carry.
 */
function macroCase(slug) {
  if (!/^[a-z]+$/.test(slug)) throw new Error(`the application slug "${slug}" cannot be part of a LaTeX macro name`)
  return slug[0].toUpperCase() + slug.slice(1)
}

/**
 * Throws unless the parts add up to the total. Each figure the prose states is checked against
 * a count taken from a different field of the result files, so a drift between them stops the
 * generator and names both numbers rather than emitting a wrong value silently.
 */
function expectSum([totalName, total], parts) {
  const sum = parts.reduce((a, [, v]) => a + v, 0)
  if (sum !== total) {
    throw new Error(`${totalName} is ${total} but ${parts.map(([n, v]) => `${n} (${v})`).join(' + ')} = ${sum}; these were meant to add up`)
  }
}

/**
 * Throws unless a count lies within its bound, the guard for a subset that cannot exceed the
 * set it is drawn from.
 */
function expectAtMost([name, value], [boundName, bound]) {
  if (value > bound) throw new Error(`${name} is ${value} but ${boundName} is only ${bound}; a subset cannot be larger than its set`)
}

const cell = (o) => {
  if (!o || o.sampled === 0) return '--'
  const n = o.detected + o.missed + o.wrong
  return n ? `${o.detected}/${n}` : `0/0`
}

let out = '% Generated by rq4-to-latex.mjs from the mutation result files. Do not edit by hand.\n'
out += `% Harness ${runs[0]?.harnessVersion}, attributed graph, seed ${runs[0]?.seed}, quota ${runs[0]?.quota} per operator.\n\n`

out += '\\newcommand{\\TabMutation}{%\n\\begin{tabular}{@{}l' + 'r'.repeat(runs.length) + '@{}}\n\\toprule\n'
out += 'Operator & ' + runs.map((r) => r.slug).join(' & ') + ' \\\\\n\\midrule\n'
for (const op of OPS) {
  out += `${PRETTY[op]} & ` + runs.map((r) => cell(r.perOperator[op])).join(' & ') + ' \\\\\n'
}
out += '\\midrule\n'
out += 'All operators & ' + runs.map((r) => `${r.detected}/${r.scored}`).join(' & ') + ' \\\\\n'
out += 'Detection rate & ' + runs.map((r) => r.scored ? `${((r.detected / r.scored) * 100).toFixed(1)}\\%` : '--').join(' & ') + ' \\\\\n'
out += '\\bottomrule\n\\end{tabular}}\n\n'

out += '\\newcommand{\\TabMutationSample}{%\n\\begin{tabular}{@{}l' + 'rrr'.repeat(1) + 'r'.repeat(runs.length * 0) + '@{}}\n'
out += '\\toprule\nApplication & Candidates & Sampled & Excluded \\\\\n\\midrule\n'
for (const r of runs) {
  const disc = Object.values(r.discovered).reduce((a, b) => a + b, 0)
  const samp = Object.values(r.sampled).reduce((a, b) => a + b, 0)
  const excl = r.results.filter((x) => x.verdict === 'EXCLUDED').length
  out += `${r.slug} & ${disc} & ${samp} & ${excl} \\\\\n`
}
out += '\\bottomrule\n\\end{tabular}}\n'

// The baseline runs, when given, so the chapter can state what attribution does to change
// sensitivity without a number being typed by hand. A file named rq4base-<slug>.json is read
// as the same application's unattributed run; the two must cover the same applications.
const baseFiles = process.argv.slice(2).filter((f) => path.basename(f).startsWith('rq4base-'))
if (baseFiles.length) {
  const base = baseFiles.map((f) => ({ slug: path.basename(f).replace(/^rq4base-/, '').replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(f, 'utf8')) }))
  const slugs = (rs) => rs.map((r) => r.slug).sort().join(',')
  if (slugs(base) !== slugs(runs)) throw new Error(`the baseline runs cover ${slugs(base)} and the attributed runs ${slugs(runs)}; the comparison would be between different corpora`)
  const tot = (rs) => rs.reduce((a, r) => {
    for (const o of Object.values(r.perOperator || {})) { a.det += o.detected; a.n += o.detected + o.missed + o.wrong; a.exc += o.excluded }
    return a
  }, { det: 0, n: 0, exc: 0 })
  const A = tot(runs), B = tot(base)
  // RENAME_PATH is detected by construction wherever the path was already parsed, so the
  // chapter states the rate with and without it. MISSED, as against WRONG, is a mutant the
  // graph did not respond to at all, which is the one that bears on change impact analysis.
  const perOp = (rs, ops) => rs.reduce((a, r) => {
    for (const [op, o] of Object.entries(r.perOperator || {})) {
      if (!ops.includes(op)) continue
      a.det += o.detected; a.n += o.detected + o.missed + o.wrong
    }
    return a
  }, { det: 0, n: 0 })
  const RENAME = ['RENAME_PATH']
  const FALLIBLE = OPS.filter((o) => !RENAME.includes(o))
  const R = perOp(runs, RENAME), F = perOp(runs, FALLIBLE)
  const missed = runs.reduce((a, r) => a + r.results.filter((x) => x.verdict === 'MISSED').length, 0)
  const candidates = runs.reduce((a, r) => a + Object.values(r.discovered).reduce((x, y) => x + y, 0), 0)
  for (const [k, v] of [
    ['HarnessVersionMutation', runs[0].harnessVersion], ['MutCandidates', candidates], ['MutRenameScored', R.n], ['MutRenameDetected', R.det],
    ['MutFallibleScored', F.n], ['MutFallibleDetected', F.det], ['MutNoResponse', missed],
  ]) out += `\\newcommand{\\${k}}{${v}}\n`
  const pc = (x) => `${((x.det / x.n) * 100).toFixed(1)}\\,\\%`

  // The two rates above are taken over different mutant sets, because a mutant whose
  // construct produces no edge in one graph cannot be scored against it. Comparing them
  // directly therefore mixes a detection difference with an eligibility difference. The
  // paired figures below are taken over the mutants BOTH graphs can score, identified by the
  // operator, file, line and subject the harness records, so the two columns answer the same
  // question about the same changes.
  const SCORED = new Set(['DETECTED', 'MISSED', 'WRONG'])
  const keyed = (rs) => {
    const m = new Map()
    for (const r of rs) {
      for (const x of r.results) {
        if (!SCORED.has(x.verdict)) continue
        m.set(`${r.slug}|${x.kind}|${x.file}|${x.line}|${x.subject ?? ''}`, x.verdict)
      }
    }
    return m
  }
  const kA = keyed(runs), kB = keyed(base)
  const paired = [...kA.keys()].filter((k) => kB.has(k))
  if (!paired.length) throw new Error('no mutant is scorable by both graphs, so the paired comparison has no subject')
  const pDet = (m) => paired.filter((k) => m.get(k) === 'DETECTED').length
  const favour = paired.filter((k) => kA.get(k) !== kB.get(k))
  const againstAttr = favour.filter((k) => kB.get(k) === 'DETECTED' && kA.get(k) !== 'DETECTED')
  const ppc = (d) => `${((d / paired.length) * 100).toFixed(1)}\\,\\%`
  // An unmatched mutant is not the same thing as an ineligible one. The operators pick a new
  // target at random, so the two runs can mutate the same construct into different things;
  // that pair is two different mutants and says nothing about what either graph can score.
  // Counted apart from the mutants that are genuinely absent from the other run.
  const site = (k) => k.split('|').slice(0, 4).join('|')
  const aOnly = [...kA.keys()].filter((k) => !kB.has(k))
  const bOnly = [...kB.keys()].filter((k) => !kA.has(k))
  const aSites = new Set(aOnly.map(site)), bSites = new Set(bOnly.map(site))
  const bothSites = [...aSites].filter((x) => bSites.has(x))
  for (const [k, v] of [
    ['MutPaired', paired.length],
    ['MutPairedDetected', pDet(kA)], ['MutPairedRate', ppc(pDet(kA))],
    ['MutPairedBaseDetected', pDet(kB)], ['MutPairedBaseRate', ppc(pDet(kB))],
    ['MutPairedDisagree', favour.length],
    ['MutPairedAgainstAttribution', againstAttr.length],
    ['MutAttributedOnly', aOnly.filter((k) => !bSites.has(site(k))).length],
    ['MutBaselineOnly', bOnly.filter((k) => !aSites.has(site(k))).length],
    ['MutUnmatchedSites', bothSites.length],
  ]) out += `\\newcommand{\\${k}}{${v}}\n`
  console.error(`paired ${paired.length}: attributed ${pDet(kA)} (${ppc(pDet(kA))}), baseline ${pDet(kB)} (${ppc(pDet(kB))}), ` +
    `${favour.length} disagree, ${againstAttr.length} against attribution`)

  out += '\n% Attributed against baseline, for the change-sensitivity claim.\n'
  for (const [k, v] of [
    ['MutScored', A.n], ['MutDetected', A.det], ['MutRate', pc(A)], ['MutExcluded', A.exc],
    ['MutBaseScored', B.n], ['MutBaseDetected', B.det], ['MutBaseRate', pc(B)], ['MutBaseExcluded', B.exc],
  ]) out += `\\newcommand{\\${k}}{${v}}\n`
  console.error(`attributed ${A.det}/${A.n} (${pc(A)}), ${A.exc} excluded; baseline ${B.det}/${B.n} (${pc(B)}), ${B.exc} excluded`)

  out += '\n% Figures the prose states; each is checked against a count taken from another field of the result files.\n'
  const sampledOf = (rs) => rs.reduce((a, r) => a + Object.values(r.sampled).reduce((x, y) => x + y, 0), 0)
  const nSampled = sampledOf(runs), nBaseSampled = sampledOf(base)
  expectSum(['MutSampled', nSampled], [['MutScored', A.n], ['MutExcluded', A.exc]])
  expectSum(['MutBaseSampled', nBaseSampled], [['MutBaseScored', B.n], ['MutBaseExcluded', B.exc]])

  const nFailures = runs.reduce((a, r) => a + failures(r).length, 0)
  expectSum(['MutScored', A.n], [['MutDetected', A.det], ['MutFailures', nFailures]])
  const failuresPerApp = runs.map((r) => {
    expectSum([`${r.slug} scored - detected`, r.scored - r.detected], [[`${r.slug} failures`, failures(r).length]])
    return [`MutFailures${macroCase(r.slug)}`, failures(r).length]
  })
  expectSum(['MutFailures', nFailures], failuresPerApp)

  const L = perOp(runs, ['DELETE_ROUTERLINK']), T = perOp(runs, ['CHANGE_NAV_TARGET']), G = perOp(runs, ['REMOVE_GUARD'])
  // The same operator on the baseline graph, because the chapter contrasts the two and the
  // contrast is not that the baseline could score none of these mutants.
  const LB = perOp(base, ['DELETE_ROUTERLINK'])
  expectAtMost(['MutLinkBaseDetected', LB.det], ['MutLinkBaseScored', LB.n])
  expectSum(['MutScored', A.n], [['MutRenameScored', R.n], ['MutLinkScored', L.n], ['MutRetargetScored', T.n], ['MutGuardScored', G.n]])
  expectSum(['MutDetected', A.det], [['MutRenameDetected', R.det], ['MutLinkDetected', L.det], ['MutRetargetDetected', T.det], ['MutGuardDetected', G.det]])
  const linkWitnessOnly = runs.reduce((a, r) => a + witnessOnly(r, 'DELETE_ROUTERLINK'), 0)
  expectAtMost(['MutLinkWitnessOnly', linkWitnessOnly], ['MutLinkDetected', L.det])

  const retargetFailures = runs.flatMap((r) => failures(r, 'CHANGE_NAV_TARGET'))
  const retargetWrong = retargetFailures.filter((x) => x.verdict === 'WRONG').length
  const retargetNoChange = retargetFailures.filter((x) => x.verdict === 'MISSED').length
  expectSum(['MutRetargetScored - MutRetargetDetected', T.n - T.det], [['MutRetargetWrong', retargetWrong], ['MutRetargetNoChange', retargetNoChange]])
  // A WRONG retarget that adds no edge and one that adds an edge to the wrong screen are two
  // different outcomes, and the chapter states both, so neither count is typed by hand.
  const retargetWrongNoAdd = retargetFailures.filter((x) => x.verdict === 'WRONG' &&
    !((x.delta?.edgesAdded || []).length)).length
  expectAtMost(['MutRetargetWrongNoAdd', retargetWrongNoAdd], ['MutRetargetWrong', retargetWrong])

  const guardFailuresPerApp = runs.map((r) => failures(r, 'REMOVE_GUARD'))
  const guardFailures = guardFailuresPerApp.flat()
  expectSum(['MutGuardScored - MutGuardDetected', G.n - G.det], [['MutGuardMissed', guardFailures.length]])
  const guardCause = (c) => guardFailures.filter((x) => guardMissCause(x) === c).length
  const guardEmptyPath = guardCause('emptyPath'), guardNamedCall = guardCause('namedCall')
  expectSum(['MutGuardMissed', guardFailures.length], [['MutGuardMissedEmptyPath', guardEmptyPath], ['MutGuardMissedNamedCall', guardNamedCall]])
  const guardApps = guardFailuresPerApp.filter((f) => f.length).length
  expectAtMost(['MutGuardMissedApps', guardApps], ['the number of applications', runs.length])
  const emptyPath = emptyPathGuards(runs)
  expectAtMost(['MutGuardEmptyPathScored', emptyPath.scored], ['MutGuardScored', G.n])
  expectAtMost(['MutGuardEmptyPathDetected', emptyPath.detected], ['MutGuardEmptyPathScored', emptyPath.scored])

  // MutNoResponse counts MISSED verdicts; here the same mutants are found again by their empty delta.
  const silent = runs.flatMap((r) => failures(r)).filter((x) => emptyDelta(x.delta))
  const silentGuard = silent.filter((x) => x.kind === 'REMOVE_GUARD').length
  const silentRetarget = silent.filter((x) => x.kind === 'CHANGE_NAV_TARGET').length
  expectSum(['MutNoResponse', missed], [['MutNoResponseGuard', silentGuard], ['MutNoResponseRetarget', silentRetarget]])

  const excluded = runs.flatMap((r) => r.results.filter((x) => x.verdict === 'EXCLUDED'))
  expectSum(['MutExcluded', A.exc], [['the EXCLUDED records', excluded.length]])
  const segments = [...new Set(excluded.map(excludedSegment))]

  for (const [k, v] of [
    ['MutSampled', nSampled], ['MutBaseSampled', nBaseSampled], ['MutFailures', nFailures], ...failuresPerApp,
    ['MutLinkScored', L.n], ['MutLinkDetected', L.det], ['MutLinkWitnessOnly', linkWitnessOnly],
    ['MutLinkBaseScored', LB.n], ['MutLinkBaseDetected', LB.det],
    ['MutRetargetScored', T.n], ['MutRetargetDetected', T.det], ['MutRetargetWrong', retargetWrong], ['MutRetargetNoChange', retargetNoChange],
    ['MutRetargetWrongNoAdd', retargetWrongNoAdd],
    ['MutGuardScored', G.n], ['MutGuardDetected', G.det],
    ['MutGuardMissed', guardFailures.length], ['MutGuardMissedApps', guardApps],
    ['MutGuardMissedEmptyPath', guardEmptyPath], ['MutGuardMissedNamedCall', guardNamedCall],
    ['MutGuardEmptyPathScored', emptyPath.scored], ['MutGuardEmptyPathDetected', emptyPath.detected],
    ['MutNoResponseGuard', silentGuard], ['MutNoResponseRetarget', silentRetarget],
  ]) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} is ${v}, which is not a count`)
    out += `\\newcommand{\\${k}}{${v}}\n`
  }
  out += `\\newcommand{\\MutExcludedSegments}{${segments.map(texttt).join(' and ')}}\n`
  console.error(`prose figures: ${nSampled} sampled (${nBaseSampled} baseline), ${nFailures} failures, ` +
    `guard misses ${guardFailures.length} in ${guardApps} apps (${guardEmptyPath} empty path, ${guardNamedCall} named call), excluded segments ${segments.join(', ')}`)
}

process.stdout.write(out)

// Figures the prose needs, to stderr so they do not land in the table file.
for (const r of runs) {
  const wo = OPS.map((op) => `${op}=${witnessOnly(r, op)}`).join(' ')
  console.error(`[${r.slug}] detected ${r.detected}/${r.scored} ` +
    `(${r.scored ? ((r.detected / r.scored) * 100).toFixed(1) : 0}%)  witness-only detections: ${wo}`)
  console.error(`[${r.slug}] operators with no candidates: ` +
    (OPS.filter((op) => !r.discovered[op]).join(', ') || 'none'))
  for (const x of r.results.filter((v) => v.verdict === 'MISSED' || v.verdict === 'WRONG'))
    console.error(`[${r.slug}] ${x.verdict} ${x.kind} ${x.subject} at ${x.file}:${x.line}`)
}
