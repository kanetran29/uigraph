#!/usr/bin/env node
// Reproducible evaluation runner.
//
// One command rebuilds every number in the thesis from pinned inputs: a pinned extractor
// commit, corpus repositories pinned to exact SHAs, and a versioned harness. It writes a
// single results file and generates the result tables as Markdown, so the thesis prints
// tables from data instead of having them typed by hand — which is where the errors in
// this project have come from every time so far.
//
// Usage:
//   node run-all.mjs [--only slug,slug] [--work /tmp/eval] [--skip-clone] [--out results]
//                    [--label fin] [--extractor-dir <path>] [--allow-branch] [--attribution]
//                    [--no-mutation] [--mutants N]
//
// --label names the run and goes into every per-test file name. round2-to-latex.mjs compares
// runs, so make them into one --out, one command each:
//   --label ctrl   the extractor as it stood before the round (it reads C and L)
//   --label fin    the round-two extractor (it reads C, L, B, why and notes)
//   --label pre    not a label of this script, which rejects it. The declared-screen denominator move is
//                  accounted against the EARLIER oracle, which is index.mjs as it stood before f42b615, the
//                  first commit after the 2 Nov draft (bd71281) to change it. Declared screens come from
//                  index.mjs and not from the extractor, so this script's index.mjs would record the current
//                  count as the earlier one, and the earlier run-all.mjs has no label to run it with.
//                  round2-to-latex.mjs therefore does not read a pre file from its <outDir> at all: it reads
//                  the earlier oracle's own output from the tracked results-before/raw/<slug>.C.json beside
//                  itself, which is committed and complete for all six applications. A hand-made pre file is
//                  neither needed nor read, and the reason it is not is worth keeping: one made from a
//                  mid-round revision of the oracle satisfies every internal check the generator can make,
//                  and it published a denominator move that was partly the round's own doing as the earlier
//                  oracle's. To regenerate the tracked files, run the earlier oracle on each application:
//                    git show f42b615^:thesis-handoff/route-oracle/index.mjs > <dir>/index.mjs
//                    ln -s <this directory>/node_modules <dir>/node_modules
//                    node <dir>/index.mjs <work>/corpus/<slug>/<appDir> --json results-before/raw/<slug>.C.json
//                  <work> is the --work of the fin run (default /tmp/eval) and <appDir> the repo's appDir in
//                  corpus.json (only realworld and mifos have ".").
// Give these runs an --out of your own, never the default results/: every run refreshes and prunes
// raw/ in its --out, and the tracked results/raw/ is meant to hold one fin run, made on its own.
// The ctrl run is expected to exit non-zero: the pre-round extractor leaves constructs UNKNOWN,
// which is the premise of the round, and unexplained.mjs exits 1 for it (see Exit status). Do not
// chain the runs with && or run them under set -e; the fin run is the one that must exit 0.
//
// --extractor-dir builds an existing local checkout instead of cloning the sha the manifest
// pins. The pinned sha is the pre-attribution parent and predates the round-two fixes, so the
// Section 5.5 figures cannot come from it; the checkout actually used is recorded in
// results.json as source "local-checkout" with its real HEAD sha. The build rewrites each
// packages/<pkg>/package.json in that checkout, so give it a throwaway worktree.
//
// --allow-branch lifts the drift check on the default clone: with --skip-clone it accepts a
//                <work>/uigraph at any HEAD and records source "unpinned" when that is not the pinned
//                sha, which is where an "(unpinned)" in a generated header comes from. Without
//                --skip-clone the fresh clone is checked out at the pin and the flag changes nothing.
//                --extractor-dir ignores it.
// --attribution  passes --attribution to the extractor's map command (provenance.extractor.attribution).
// --no-mutation  skips mutate.mjs, so no F file is written.
// --mutants N    mutants per application for mutate.mjs (default 5).
//
// Outputs, under <out>/:
//   <slug>.<label>.{C,L,B,D,F,why,notes}.json   per-test JSON from each oracle
//   raw/<slug>.{C,L,B,D,F,why,notes}.json   this run's files again, under the unlabelled names
//                   to-latex.mjs and node-audit.mjs read. Refreshed AND pruned by every run whatever
//                   its label, as results.json is: a file of those seven kinds this run did not
//                   produce is DELETED from raw/, tracked or not, which includes every such file of an
//                   application an --only run left out. So for those seven kinds raw/ and results.json
//                   describe the same run.
//                   Two further kinds in raw/ are NOT touched, because no run of this driver produces
//                   them: <slug>.diag.json, written by hand by diagnose-attribution.mjs and read by
//                   compare.mjs (it builds TabRemaining from it), and <slug>.attr.json, written by
//                   attribute.mjs --json. After a run into an <out> that already holds them they
//                   describe an EARLIER run: compare.mjs --tex then prints tables from this run beside
//                   a TabRemaining from that one. Regenerate diagnose-attribution.mjs's file after
//                   every run whose TabRemaining is to be published.
//   results.json    every measurement with its provenance (a later run into <out> replaces it)
//   tables.md       generated Markdown tables, ready to paste into the thesis
//
// Exit status: non-zero when an enforcement check failed (see ENFORCEMENT below), after every
// output above has been written, so the evidence of the failure is on disk. The one exception is
// the oracle's own `node index.mjs --self-check`, which runs first: if it fails the run throws before
// it clones, builds or writes a result, and <out> keeps the files of the run before. When it passes, its
// output is the first thing in the log, so a log without it is a run that did not check.

import { execSync, execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'corpus.json'), 'utf8'))

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : dflt }
const has = (flag) => process.argv.includes(flag)
const WORK = path.resolve(arg('--work', '/tmp/eval'))
const OUT = path.resolve(arg('--out', path.join(HERE, 'results')))
const ONLY = arg('--only', null)?.split(',')
// --only as the last argument has no value, and an empty ONLY would silently select all six applications.
if (has('--only') && !ONLY) throw new Error('--only needs a comma-separated list of applications from corpus.json')
// A typo here would cover no application, and refreshRaw would then prune every raw file.
for (const s of ONLY ?? []) if (!manifest.repos.some((r) => r.slug === s)) throw new Error(`--only names ${s}, which is not an application in corpus.json`)
const LABEL = arg('--label', 'fin')
if (!/^\w[\w-]*$/.test(LABEL ?? '')) throw new Error(`--label must be letters, digits, - or _, and not start with -, got ${LABEL}`)
// Compared without case so no spelling of the label slips through. The refusal is about what the
// label would MEAN, not about a file anything reads: round2-to-latex.mjs takes the earlier
// oracle's reading from the repository's tracked results-before/raw and never from this --out.
if (LABEL.toLowerCase() === 'pre') throw new Error('--label pre is not available here: it would record this harness\'s declared-screen count as the pre-round one. See the --label pre entry in the header of run-all.mjs.')
const LOCAL_EXTRACTOR = has('--extractor-dir')
const EXTRACTOR = LOCAL_EXTRACTOR ? path.resolve(arg('--extractor-dir')) : path.join(WORK, 'uigraph')
const CLI = path.join(EXTRACTOR, 'packages', 'cli', 'dist', 'cli.js')

const repos = manifest.repos.filter((r) => !ONLY || ONLY.includes(r.slug))
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(WORK, { recursive: true })

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8', timeout: 900000, ...opts })
const log = (...a) => console.log(...a)

// ---------------------------------------------------------------- 1. the extractor

/**
 * Builds the extractor under test and returns { sha, source } for the provenance record.
 *
 * By default it clones the sha manifest.extractor pins and throws if HEAD is anywhere else,
 * unless --allow-branch is given: that skips the throw and records the real HEAD with source
 * "unpinned", so a header that says "(unpinned)" names the flag that produced it.
 * That pin is the pre-attribution parent (see manifest.extractor.note) and predates the
 * round-two fixes, so a run of it cannot reproduce the Section 5.5 figures: that is why
 * --extractor-dir exists. It builds a checkout the caller already holds, records its real
 * HEAD sha, and marks the source "local-checkout" so a results file made from one can never
 * be read as a run of the pinned sha. The drift check is skipped for it on purpose.
 *
 * The build rewrites each packages/<pkg>/package.json in place (see the loop below), so a
 * local checkout should be a throwaway worktree, not the tree the extractor is developed in.
 * --skip-clone reuses an already built directory, local or cloned, without rebuilding it.
 *
 * A checkout with any change under packages/<pkg>/src, tracked or not, gets "+dirty" on its sha,
 * so the provenance never names a commit the figures were not made from. The package.json
 * rewrite of the build is outside src and does not count.
 */
function buildExtractor() {
  const dir = EXTRACTOR
  if (LOCAL_EXTRACTOR && !fs.existsSync(path.join(dir, 'packages'))) throw new Error(`--extractor-dir ${dir} has no packages/ directory, so it is not an extractor checkout`)
  if (!has('--skip-clone') || !fs.existsSync(dir)) {
    if (!LOCAL_EXTRACTOR) {
      fs.rmSync(dir, { recursive: true, force: true })
      log(`cloning extractor ${manifest.extractor.repo} @ ${manifest.extractor.sha.slice(0, 8)}`)
      sh(`git clone --filter=blob:none -q https://github.com/${manifest.extractor.repo}.git ${dir}`)
      sh(`git -C ${dir} checkout -q ${manifest.extractor.sha}`)
    } else log(`building local extractor checkout ${dir}`)
    sh(`pnpm install --silent`, { cwd: dir })
    // See manifest.extractor.buildPatch: workspace exports point at TypeScript source, so
    // the built CLI cannot resolve its sibling packages at runtime. Rewrite to dist.
    for (const pkg of fs.readdirSync(path.join(dir, 'packages'))) {
      const pj = path.join(dir, 'packages', pkg, 'package.json')
      if (!fs.existsSync(pj)) continue
      const d = JSON.parse(fs.readFileSync(pj, 'utf8'))
      // A checkout built before already points at dist, and the rewrite below is not idempotent.
      if (typeof d.main === 'string' && d.main.startsWith('./dist/')) continue
      const fix = (s) => s.replace('./src/', './dist/').replace(/\.ts$/, s.includes('types') ? '.d.ts' : '.js')
      if (d.exports) for (const v of Object.values(d.exports)) {
        if (typeof v === 'object' && v) { if (v.types) v.types = v.types.replace('./src/', './dist/').replace('.ts', '.d.ts'); if (v.default) v.default = v.default.replace('./src/', './dist/').replace('.ts', '.js') }
      }
      if (d.bin) for (const k of Object.keys(d.bin)) d.bin[k] = fix(d.bin[k])
      d.main = fix(d.main || './dist/index.js')
      fs.writeFileSync(pj, JSON.stringify(d, null, 2))
    }
    sh(`pnpm -r build`, { cwd: dir })
  }
  const sha = sh(`git -C ${dir} rev-parse HEAD`).trim()
  // The pathspec is git's, not the shell's: a shell glob would expand against the caller's cwd, not dir.
  const dirty = sh(`git -C ${dir} status --porcelain -- ':(glob)packages/*/src/**'`).trim() ? '+dirty' : ''
  if (LOCAL_EXTRACTOR) return { sha: sha + dirty, source: 'local-checkout' }
  if (has('--allow-branch')) return { sha: sha + dirty, source: sha === manifest.extractor.sha ? 'pinned' : 'unpinned' }
  if (sha !== manifest.extractor.sha) throw new Error(`extractor SHA drift: got ${sha}, manifest says ${manifest.extractor.sha}`)
  return { sha: sha + dirty, source: 'pinned' }
}

// ---------------------------------------------------------------- 2. the corpus

function fetchRepo(r) {
  const dir = path.join(WORK, 'corpus', r.slug)
  if (has('--skip-clone') && fs.existsSync(dir)) {
    const sha = sh(`git -C ${dir} rev-parse HEAD`).trim()
    if (sha !== r.sha) throw new Error(`${r.slug} SHA drift: ${sha} != ${r.sha}`)
    return dir
  }
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  log(`  fetching ${r.repo} @ ${r.sha.slice(0, 8)}`)
  sh(`git -C ${dir} init -q`)
  sh(`git -C ${dir} remote add origin https://github.com/${r.repo}.git`)
  // Fetch the exact commit — never a branch tip, which moves.
  sh(`git -C ${dir} fetch -q --depth 1 origin ${r.sha}`)
  sh(`git -C ${dir} checkout -q FETCH_HEAD`)
  return dir
}

// ---------------------------------------------------------------- 3. measurements

function countConstructs(appPath) {
  // Count bindings, not substrings: `grep -o routerLink` also matches routerLinkActive and
  // routerLinkActiveOptions, which inflated the denominator in harness 1.0.0.
  const count = (pattern, ext) => {
    try { return parseInt(sh(`grep -rhoE "${pattern}" ${appPath} --include=*.${ext} --exclude=*.spec.ts --exclude-dir=node_modules --exclude-dir=e2e 2>/dev/null | wc -l`).trim(), 10) } catch { return 0 }
  }
  return {
    routerLink: count('\\[?routerLink\\]?[[:space:]]*=', 'html') + count('\\[?routerLink\\]?[[:space:]]*=', 'ts'),
    navigate: count('[Rr]outer[[:alnum:]_$]*[[:space:]]*\\.[[:space:]]*(navigate|navigateByUrl)[[:space:]]*\\(', 'ts'),
  }
}

function readGraph(appPath) {
  const dbp = path.join(appPath, 'uigraph.db')
  if (!fs.existsSync(dbp)) return null
  const db = new DatabaseSync(dbp)
  const g = JSON.parse(db.prepare("select json from docs where key='graph'").get()?.json || '{}')
  return {
    nodes: (g.nodes || []).length,
    edges: (g.edges || []).length,
    must: (g.edges || []).filter((e) => e.modality === 'must').length,
    may: (g.edges || []).filter((e) => e.modality === 'may').length,
    unknown: (g.edges || []).filter((e) => e.modality === 'unknown').length,
  }
}

// Scripts whose exit status IS a claim the thesis makes, so a failure of one fails the run.
// unexplained.mjs writes its JSON and then exits 1 when any construct reaches the end with
// reason UNKNOWN: that exit code is the entire enforcement of "no site is left without a
// reason". Every other script's status is recorded and printed but does not fail the run: none
// of them has an exit-code contract, and e2e-oracle and mutate are optional to begin with.
const ENFORCEMENT = new Set(['unexplained.mjs'])

// One { slug, script, status } per script run; status is 0, a non-zero exit code, a signal
// name, or a string saying the script could not be run at all.
const toolRuns = []

// The per-test files each run writes, as named in <slug>.<label>.<kind>.json.
const RAW_KINDS = ['C', 'L', 'B', 'D', 'F', 'why', 'notes']

/**
 * Runs one oracle script for one application and returns the JSON it wrote, or null.
 *
 * The exit status is recorded in toolRuns and printed when it is not 0, never swallowed.
 * The JSON of a script that failed is still read, because unexplained.mjs reports its UNKNOWN
 * constructs in the file it writes before exiting 1. The caller has already removed every
 * labelled file of this slug, so the JSON returned belongs to this invocation: with labelled
 * files that survive between runs, a script that died before writing would otherwise hand back
 * the previous run's data as if it were this one's.
 */
function runTool(slug, script, args, outFile) {
  let status = 0
  try {
    execFileSync('node', ['--max-old-space-size=6144', path.join(HERE, script), ...args, '--json', outFile],
      { stdio: 'pipe', timeout: 900000 })
  } catch (e) {
    // status is null when the child was killed (timeout, signal) or never started.
    status = e.status ?? e.signal ?? e.code ?? 1
    log(`  ! ${script} exited ${status}`)
    const tail = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n').filter(Boolean).slice(-30)
    for (const line of tail) log(`      ${line}`)
  }
  toolRuns.push({ slug, script, status })
  return fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null
}

/**
 * Makes OUT/raw/ hold exactly this run's files of the kinds in RAW_KINDS: for each application the
 * run covered, its OUT/<slug>.<label>.<kind>.json is copied to OUT/raw/<slug>.<kind>.json, and every
 * other raw file of a manifest application and of one of those kinds is deleted.
 *
 * Any other .json file in raw/ (a file, or a link to one) is left alone and listed in the log as
 * not produced by this run, because it may describe an earlier one. That covers the kinds no run of this
 * driver produces, <slug>.diag.json (diagnose-attribution.mjs writes it by hand and compare.mjs reads it
 * for TabRemaining) and <slug>.attr.json (attribute.mjs --json), which RAW_KINDS is not widened to cover
 * because every run would then delete the committed diag files; and a file of a kind it does produce under
 * a slug the manifest does not name, such as one left by an earlier corpus.json. Anything that is not a
 * file, such as a directory called sub.json, is neither listed nor touched.
 *
 * to-latex.mjs and node-audit.mjs read OUT/raw/ under unlabelled names, while this driver writes
 * labelled files beside results.json. Without this step they pair a fresh results.json with the
 * raw files of whichever run last wrote them, so the mix reaches the thesis tables unseen. A kind
 * this run did not produce is removed, not left from an earlier run, for the same reason, and so is
 * every kind of an application an --only run did not cover (node-audit.mjs then refuses to total
 * the directory). For those the labelled file may still sit in OUT from the earlier run, so
 * its existence proves nothing about this run: only membership of the covered set decides a copy.
 * The deletion reaches tracked files, because the default OUT is the tracked results/ directory, so
 * each file it deletes is logged by its full path.
 *
 * Every label refreshes raw/, ctrl included. results.json is replaced by the latest run whatever
 * its label, so raw/ follows the same rule and results.json's provenance.label names the run both
 * hold. Running ctrl and then fin into one --out leaves fin in both, which is what the tables want.
 */
function refreshRaw() {
  const rawDir = path.join(OUT, 'raw')
  fs.mkdirSync(rawDir, { recursive: true })
  const covered = new Set(repos.map((r) => r.slug))
  for (const r of manifest.repos) for (const kind of RAW_KINDS) {
    const from = path.join(OUT, `${r.slug}.${LABEL}.${kind}.json`)
    const to = path.join(rawDir, `${r.slug}.${kind}.json`)
    if (covered.has(r.slug) && fs.existsSync(from)) fs.copyFileSync(from, to)
    else if (fs.existsSync(to)) {
      log(`  pruned ${to}`)
      fs.rmSync(to)
    }
  }
  const owned = new Set(manifest.repos.flatMap((r) => RAW_KINDS.map((kind) => `${r.slug}.${kind}.json`)))
  const left = fs.readdirSync(rawDir).filter((f) => f.endsWith('.json') && !owned.has(f) && fs.statSync(path.join(rawDir, f), { throwIfNoEntry: false })?.isFile())
  if (left.length) log(`  left alone, not produced by this run and possibly describing an earlier one: ${left.map((f) => path.join(rawDir, f)).join(', ')}`)
}

// ---------------------------------------------------------------- run

// index.mjs --self-check pins the oracle's path-boundary predicate and lazy-module hop on built fixtures.
// It takes about a second, needs no application, and nothing else invokes it, so a run is where it fires.
// A harness that fails its own check measures nothing, so the run stops before it clones or builds anything.
// A passing check is logged with its own output, so the log of a run that checked differs from one that did not.
let selfCheck
try { selfCheck = execFileSync('node', [path.join(HERE, 'index.mjs'), '--self-check'], { stdio: 'pipe', encoding: 'utf8' }) }
catch (e) { throw new Error(`index.mjs --self-check failed (${e.status ?? e.signal ?? e.code}), so the oracle cannot be trusted to measure:\n${e.stdout ?? ''}${e.stderr ?? ''}`) }
log(`index.mjs --self-check passed:\n${selfCheck.trimEnd().replace(/^/gm, '  ')}`)

const started = new Date().toISOString()
const extractor = buildExtractor()
const results = []

for (const r of repos) {
  log(`\n=== ${r.slug} ===`)
  const repoDir = fetchRepo(r)
  const appPath = path.resolve(repoDir, r.appDir)

  const constructs = countConstructs(appPath)
  let mapOk = true, mapError = ''
  try { sh(`node ${CLI} map ${appPath} --adapter angular${has('--attribution') ? ' --attribution' : ''}`) }
  catch (e) { mapOk = false; mapError = String(e.stderr || e.message).slice(0, 400) }

  const graph = mapOk ? readGraph(appPath) : null
  const raw = (n) => path.join(OUT, `${r.slug}.${LABEL}.${n}.json`)
  for (const kind of RAW_KINDS) fs.rmSync(raw(kind), { force: true })

  const testC = mapOk ? runTool(r.slug, 'index.mjs', [appPath, path.join(appPath, 'uigraph.db')], raw('C')) : null
  // --routes is what turns on the destination test: without it witness-check reports
  // destinationsChecked false and NODE_NOT_DECLARED cannot fire, so the driver would publish a
  // must tier judged by three of the four questions the thesis says are asked of it.
  const testB = mapOk && graph?.edges ? runTool(r.slug, 'witness-check.mjs', [appPath, path.join(appPath, 'uigraph.db'), '--routes', raw('C')], raw('B')) : null
  const testD = mapOk && r.e2eDir ? runTool(r.slug, 'e2e-oracle.mjs', [path.resolve(repoDir, r.e2eDir), path.join(appPath, 'uigraph.db')], raw('D')) : null
  const testL = mapOk ? runTool(r.slug, 'loss-breakdown.mjs', [appPath, path.join(appPath, 'uigraph.db'), '--routes', raw('C')], raw('L')) : null
  // The reason every unrecovered construct is unrecovered, and the extractor's own notes.
  // These two are what the dead-link and route-set-completeness figures are counted from, so
  // they belong in the driver: while they were run by hand the section they feed could not be
  // reproduced from the repository at all.
  const testWhy = testC && testL ? runTool(r.slug, 'unexplained.mjs', [appPath, path.join(appPath, 'uigraph.db'), '--routes', raw('C'), '--loss', raw('L')], raw('why')) : null
  // A check that never ran is recorded as failed, or exit 0 would assert "no site is left without a reason" for an application that was not analysed.
  if (!mapOk) toolRuns.push({ slug: r.slug, script: 'unexplained.mjs', status: 'not run: map failed' })
  else if (!(testC && testL)) toolRuns.push({ slug: r.slug, script: 'unexplained.mjs', status: 'not run: route or loss JSON missing' })
  const testNotes = mapOk ? runTool(r.slug, 'notes.mjs', [path.join(appPath, 'uigraph.db')], raw('notes')) : null
  const testF = mapOk && !has('--no-mutation') ? runTool(r.slug, 'mutate.mjs', [repoDir, appPath, '--limit', arg('--mutants', '5')], raw('F')) : null

  // One definition of a construct across the thesis: the loss-breakdown parser's. The grep
  // count is kept in the results file as a cross-check.
  const totalConstructs = testL?.constructs ?? (constructs.routerLink + constructs.navigate)
  results.push({
    slug: r.slug, repo: r.repo, sha: r.sha, appDir: r.appDir, role: r.role,
    mapOk, mapError: mapOk ? undefined : mapError,
    constructs, totalConstructs, graph,
    // Construct-level conversion: the fraction of constructs witnessed by at least one must
    // edge. Edge counts are not used, because attribution can store one construct as one
    // anchored edge or as several per-screen edges.
    conversion: testL && totalConstructs ? +((testL.tally?.CONVERTED_MUST || 0) / totalConstructs).toFixed(4) : null,
    edgeRatio: graph && totalConstructs ? +(graph.must / totalConstructs).toFixed(4) : null,
    testB: testB && { edges: testB.edges, clean: testB.clean, mustEdges: testB.mustEdges, mustClean: testB.mustClean, tally: testB.tally },
    testC: testC && { declaredScreens: testC.comparison?.declaredScreens, coverage: testC.comparison?.coverage, blindSpots: testC.blindSpots?.length },
    testD: testD && { urls: testD.rows?.length, recall: testD.recall },
    testF: testF && { tally: testF.tally },
    loss: testL && { constructs: testL.constructs, lost: testL.lost, tally: testL.tally },
    why: testWhy && { total: testWhy.total, byReason: testWhy.byReason },
    notes: Array.isArray(testNotes) ? testNotes.length : null,
    toolStatus: Object.fromEntries(toolRuns.filter((t) => t.slug === r.slug).map((t) => [t.script, t.status])),
  })
  const g = graph || {}
  log(`  constructs ${totalConstructs}  ->  nodes ${g.nodes ?? '-'} edges ${g.edges ?? '-'} (must ${g.must ?? '-'})  conversion ${results.at(-1).conversion !== null ? (results.at(-1).conversion * 100).toFixed(1) + '%' : 'n/a'}`)
}

// ---------------------------------------------------------------- output

// A failed enforcement check is carried into results.json and tables.md as well as the exit
// status, so figures from a run whose claim did not hold cannot be pasted without seeing it.
const enforcementFailures = toolRuns.filter((t) => ENFORCEMENT.has(t.script) && t.status !== 0)

refreshRaw()

const out = {
  provenance: {
    harnessVersion: manifest.harnessVersion,
    label: LABEL,
    extractor: { repo: manifest.extractor.repo, sha: extractor.sha, source: extractor.source, attribution: has('--attribution') },
    node: process.version,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    enforcementFailures,
  },
  results,
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(out, null, 2))

const pct = (v) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1)}%`)
let md = `<!-- generated by run-all.mjs — do not edit by hand -->\n`
md += `Extractor \`${extractor.sha.replace(/^([0-9a-f]{8})[0-9a-f]*/, '$1')}\` (${extractor.source}), run \`${LABEL}\`, harness ${manifest.harnessVersion}, ${started.slice(0, 10)}.\n\n`
if (enforcementFailures.length) md += `**ENFORCEMENT FAILED:** ${enforcementFailures.map((f) => `${f.slug}/${f.script} (${f.status})`).join(', ')}. Do not publish figures from this run.\n\n`
md += `## Construct-to-transition conversion\n\n`
md += `| repo | SHA | routerLink | router.navigate | nodes | must-edges | conversion |\n|---|---|---|---|---|---|---|\n`
for (const r of results) {
  md += `| ${r.slug} | \`${r.sha.slice(0, 8)}\` | ${r.constructs.routerLink} | ${r.constructs.navigate} | ${r.graph?.nodes ?? '–'} | ${r.graph?.must ?? '–'} | ${pct(r.conversion)} |\n`
}
md += `\n## Edge tiers\n\n| repo | edges | must | may | unknown |\n|---|---|---|---|---|\n`
for (const r of results) md += `| ${r.slug} | ${r.graph?.edges ?? '–'} | ${r.graph?.must ?? '–'} | ${r.graph?.may ?? '–'} | ${r.graph?.unknown ?? '–'} |\n`
md += `\n## Oracle results\n\n| repo | B: witness clean | C: route coverage | D: E2E recall | F: mutation |\n|---|---|---|---|---|\n`
for (const r of results) {
  md += `| ${r.slug} | ${r.testB ? `${r.testB.clean}/${r.testB.edges}` : '–'} | ${r.testC?.coverage !== undefined ? pct(r.testC.coverage) : '–'} | ${r.testD ? pct(r.testD.recall) : '–'} | ${r.testF ? JSON.stringify(r.testF.tally) : '–'} |\n`
}
const LOSS = ['CONVERTED_MUST', 'CONVERTED_MAY', 'ATTRIBUTION_SERVICE', 'ATTRIBUTION_SHARED', 'LAZY_BOUNDARY', 'CONSTANT_PATH', 'COMPONENT_UNLINKED', 'NAMED_OUTLET', 'CONSTANT_TARGET', 'NODE_MISS', 'OTHER', 'QUERY_ONLY']
md += `\n## Loss breakdown by defect class\n\n| repo | constructs | ${LOSS.join(' | ')} |\n|---|---|${LOSS.map(() => '---').join('|')}|\n`
for (const r of results) md += `| ${r.slug} | ${r.loss?.constructs ?? '–'} | ${LOSS.map((c) => r.loss?.tally?.[c] ?? 0).join(' | ')} |\n`
fs.writeFileSync(path.join(OUT, 'tables.md'), md)

log(`\nwrote ${path.join(OUT, 'results.json')}`)
log(`wrote ${path.join(OUT, 'tables.md')}`)

for (const f of enforcementFailures) log(`ENFORCEMENT FAILED: ${f.slug}: ${f.script} (${f.status})`)
if (enforcementFailures.length) process.exitCode = 1
