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
//
// Outputs, under <out>/:
//   results.json    every measurement with its provenance
//   tables.md       generated Markdown tables, ready to paste into the thesis
//   raw/<slug>.*    per-test JSON from each oracle

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
const CLI = path.join(WORK, 'uigraph', 'packages', 'cli', 'dist', 'cli.js')

const repos = manifest.repos.filter((r) => !ONLY || ONLY.includes(r.slug))
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true })
fs.mkdirSync(WORK, { recursive: true })

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8', timeout: 900000, ...opts })
const log = (...a) => console.log(...a)

// ---------------------------------------------------------------- 1. the extractor

function buildExtractor() {
  const dir = path.join(WORK, 'uigraph')
  if (!has('--skip-clone') || !fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    log(`cloning extractor ${manifest.extractor.repo} @ ${manifest.extractor.sha.slice(0, 8)}`)
    sh(`git clone --filter=blob:none -q https://github.com/${manifest.extractor.repo}.git ${dir}`)
    sh(`git -C ${dir} checkout -q ${manifest.extractor.sha}`)
    sh(`pnpm install --silent`, { cwd: dir })
    // See manifest.extractor.buildPatch: workspace exports point at TypeScript source, so
    // the built CLI cannot resolve its sibling packages at runtime. Rewrite to dist.
    for (const pkg of fs.readdirSync(path.join(dir, 'packages'))) {
      const pj = path.join(dir, 'packages', pkg, 'package.json')
      if (!fs.existsSync(pj)) continue
      const d = JSON.parse(fs.readFileSync(pj, 'utf8'))
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
  if (has('--allow-branch')) return sha + (sh(`git -C ${dir} status --porcelain -- packages/*/src`).trim() ? '+dirty' : '')
  if (sha !== manifest.extractor.sha) throw new Error(`extractor SHA drift: got ${sha}, manifest says ${manifest.extractor.sha}`)
  return sha
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

function runTool(script, args, outFile) {
  try {
    execFileSync('node', ['--max-old-space-size=6144', path.join(HERE, script), ...args, '--json', outFile],
      { stdio: 'pipe', timeout: 900000 })
  } catch (e) { /* tool prints to stdout; a failure still may have written JSON */ }
  return fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null
}

// ---------------------------------------------------------------- run

const started = new Date().toISOString()
const extractorSha = buildExtractor()
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
  const raw = (n) => path.join(OUT, 'raw', `${r.slug}.${n}.json`)

  const testC = mapOk ? runTool('index.mjs', [appPath, path.join(appPath, 'uigraph.db')], raw('C')) : null
  const testB = mapOk && graph?.edges ? runTool('witness-check.mjs', [appPath, path.join(appPath, 'uigraph.db')], raw('B')) : null
  const testD = mapOk && r.e2eDir ? runTool('e2e-oracle.mjs', [path.resolve(repoDir, r.e2eDir), path.join(appPath, 'uigraph.db')], raw('D')) : null
  const testL = mapOk ? runTool('loss-breakdown.mjs', [appPath, path.join(appPath, 'uigraph.db'), '--routes', raw('C')], raw('L')) : null
  const testF = mapOk && !has('--no-mutation') ? runTool('mutate.mjs', [repoDir, appPath, '--limit', arg('--mutants', '5')], raw('F')) : null

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
  })
  const g = graph || {}
  log(`  constructs ${totalConstructs}  ->  nodes ${g.nodes ?? '-'} edges ${g.edges ?? '-'} (must ${g.must ?? '-'})  conversion ${results.at(-1).conversion !== null ? (results.at(-1).conversion * 100).toFixed(1) + '%' : 'n/a'}`)
}

// ---------------------------------------------------------------- output

const out = {
  provenance: {
    harnessVersion: manifest.harnessVersion,
    extractor: { repo: manifest.extractor.repo, sha: extractorSha, attribution: has('--attribution') },
    node: process.version,
    startedAt: started,
    finishedAt: new Date().toISOString(),
  },
  results,
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(out, null, 2))

const pct = (v) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1)}%`)
let md = `<!-- generated by run-all.mjs — do not edit by hand -->\n`
md += `Extractor \`${extractorSha.slice(0, 8)}\`, harness ${manifest.harnessVersion}, ${started.slice(0, 10)}.\n\n`
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
