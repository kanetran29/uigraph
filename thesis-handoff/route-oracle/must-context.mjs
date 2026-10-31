#!/usr/bin/env node
// What became of each must edge the round-two instrument published, and why.
//
// Claim 3.1 says a must edge corresponds to a navigation that occurs for every input on which
// the enclosing code executes. The witness check cannot test that: it re-reads the destination
// at the cited line and never asks whether the line runs every time its code does. The round's
// instrument published a must tier the corrections that followed then emptied almost entirely,
// and this ledger accounts for every edge of it against the current graph.
//
// Each edge of the earlier tier gets one fate, decided in this order:
//   kept       a construct the edge cited still earns must on its own, on an edge with the same
//              endpoints and event, or, for an edge the shell or a scope anchor held, on one from a
//              screen it stands for, now that such an edge is drawn per screen. An edge whose ends
//              another construct now joins at must is not kept on that account;
//   guard      the current graph reads a guard on the destination that the earlier one missed;
//   self-loop  the source already displays the destination, so whether the navigation runs
//              depends on parameters and router settings;
//   condition  every construct the edge cites runs under a condition;
//   retargeted no edge joins the two ends any more, and the constructs the edge cited now lead
//              from the same source to another screen, through a redirect the reader now follows.
// An edge that fits none of these stops the ledger, rather than being filed under one.
// Each construct an edge cites is classified as well, with the extractor's OWN readers
// (callCondition and templateCondition in packages/adapter-angular/src/conditions.ts). This is
// therefore a record of the extractor's decisions, not a second opinion on them: a construct
// both get wrong is wrong here too. The per-construct table it writes is what a reader checks.
//
// Usage: pnpm exec tsx must-context.mjs --corpus <dir> --before <dir> --after <dir>
//                                       [--out <dir>] [--tex <file>]
//        --before and --after hold <app>/<sub>/uigraph.db for the two instruments, or
//        <app>.graph.json.gz; --corpus holds the sources both were extracted from. The round-two
//        graphs are committed beside this file in round-two-graphs/, as the extractor at b7926b7
//        writes them with its conditional demotion switched off, which reproduces the round's
//        published graphs edge for edge.
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import { callCondition, templateCondition } from '../../packages/adapter-angular/src/conditions.ts'
import { inlineTemplate } from '../../packages/adapter-angular/src/templates.ts'
import { templateLoc } from '../../packages/adapter-angular/src/nav.ts'
import { extractorStamp } from './provenance.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d }
const corpus = flag('--corpus'), before = flag('--before'), after = flag('--after')
if (!corpus || !before || !after) { console.error('usage: pnpm exec tsx must-context.mjs --corpus <dir> --before <dir> --after <dir> [--out <dir>] [--tex <file>]'); process.exit(2) }

/** Where each application's database sits under the corpus, as the other harnesses have it. */
const APPS = { realworld: '.', alfresco: 'projects/aca-content', ghostfolio: 'apps/client', k8sdash: 'modules/web', bitwarden: 'apps/web', mifos: '.' }
const LINK_RE = /\[?routerLink\]?\s*=\s*"/g

/** The graph an application has under `dir`: a committed `<app>.graph.json.gz`, or a database at `<app>/<sub>/uigraph.db`. */
function graphOf(dir, slug, sub) {
  const gz = path.join(dir, `${slug}.graph.json.gz`)
  if (existsSync(gz)) return JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8'))
  const db = path.join(dir, slug, sub, 'uigraph.db')
  if (!existsSync(db)) throw new Error(`no graph for ${slug} under ${dir}`)
  return JSON.parse(new DatabaseSync(db).prepare("select json from docs where key='graph'").get().json)
}

/** Every .ts file under a directory, skipping dependencies and build output. */
function tsFiles(dir) {
  const out = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name.startsWith('.')) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...tsFiles(p))
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.spec.ts')) out.push(p)
  }
  return out
}

/**
 * The condition the extractor reads for the construct at file:line, or null when it reads none.
 * A template site is found the way the extractor finds it: through the component whose template
 * it is, at the line `templateLoc` gives the link.
 */
function conditionAt(project, root, file, line) {
  const abs = path.resolve(root, file)
  // A site in a shared library outside the application directory is read where it lies.
  const load = (f) => project.getSourceFile(f) ?? project.addSourceFileAtPath(f)
  if (file.endsWith('.html')) {
    for (const f of readdirSync(path.dirname(abs))) if (f.endsWith('.ts') && !f.endsWith('.spec.ts')) load(path.join(path.dirname(abs), f))
  }
  const owners = file.endsWith('.html')
    ? project.getSourceFiles().filter((sf) => inlineTemplate(sf)?.externalFile === abs)
    : [load(abs)]
  for (const sf of owners) {
    const tpl = inlineTemplate(sf)
    if (!tpl) continue
    const hits = [...tpl.text.matchAll(LINK_RE)].filter((m) => templateLoc(sf, tpl, m.index).line === line)
    if (hits.length === 0) continue
    const verdicts = new Set(hits.map((m) => templateCondition(tpl.text, m.index)))
    if (verdicts.size > 1) throw new Error(`${file}:${line} holds links the extractor reads differently`)
    return { kind: 'template', condition: [...verdicts][0] }
  }
  if (file.endsWith('.html')) throw new Error(`no component template places a link at ${file}:${line}`)
  const calls = load(abs).getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((c) => c.getStartLineNumber() === line && /(^|\.)navigate(ByUrl)?$/.test(c.getExpression().getText()))
  if (calls.length !== 1) throw new Error(`${file}:${line} holds ${calls.length} navigation calls`)
  return { kind: 'call', condition: callCondition(calls[0]) }
}

const edgesOut = []
const constructs = []
for (const [slug, sub] of Object.entries(APPS)) {
  const root = path.join(corpus, slug, sub)
  const was = graphOf(before, slug, sub)
  const now = graphOf(after, slug, sub)
  const musts = was.edges.filter((e) => e.modality === 'must')
  if (musts.length === 0) continue
  const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true })
  for (const f of tsFiles(root)) project.addSourceFileAtPath(f)
  const route = new Map([...was.nodes, ...now.nodes].map((n) => [n.id, n.route ?? n.id]))
  const scopeOf = new Map(was.nodes.filter((n) => n.scope).map((n) => [n.id, n.scope]))
  const screens = was.nodes.filter((n) => n.kind === 'screen').map((n) => n.id)
  const citesAny = (x, keys) => [x.witness, ...(x.mergedWitnesses ?? [])].some((w) => w?.file && keys.has(`${w.file}:${w.loc?.line}`))
  for (const e of musts) {
    const label = `${route.get(e.from)} -> ${route.get(e.to)}`
    const sites = [e.witness, ...(e.mergedWitnesses ?? [])].filter((w) => w?.file)
    const keys = new Set(sites.map((w) => `${w.file}:${w.loc.line}`))
    const scope = scopeOf.get(e.from)
    const members = scope ? new Set(scope.kind === 'top' ? screens : scope.members ?? []) : null
    // An edge the shell or an anchor held is drawn per screen now when its destination is one of them.
    const same = now.edges.filter((x) => x.to === e.to && x.event === e.event && (x.from === e.from || (members?.has(x.from) && citesAny(x, keys))))
    const elsewhere = now.edges.filter((x) => x.from === e.from && x.to !== e.to && x.event === e.event && citesAny(x, keys))
    const read = sites.map((w) => ({ app: slug, edge: label, site: `${w.file}:${w.loc.line}`, ...conditionAt(project, root, w.file, w.loc.line) }))
    constructs.push(...read)
    const earnsMust = (x) => [x.witness, ...(x.mergedWitnesses ?? [])].some((w) => w?.modality === 'must' && keys.has(`${w.file}:${w.loc?.line}`))
    const fate = same.some(earnsMust) ? 'kept'
      : same.some((x) => x.guard && !e.guard) ? 'guard'
      : e.from === e.to ? 'self-loop'
      : same.length > 0 && read.every((r) => r.condition !== null) ? 'condition'
      : same.length === 0 && elsewhere.length > 0 ? 'retargeted'
      : 'unexplained'
    edgesOut.push({ app: slug, edge: label, event: e.event, fate, sites: read.length, unconditionalSites: read.filter((r) => r.condition === null).length })
  }
}

const total = edgesOut.length
const fates = ['kept', 'guard', 'self-loop', 'condition', 'retargeted']
const fateCount = Object.fromEntries(fates.map((f) => [f, edgesOut.filter((r) => r.fate === f).length]))
const unexplained = edgesOut.filter((r) => r.fate === 'unexplained')
if (unexplained.length) throw new Error(`${unexplained.length} edge(s) left the must tier for no reason this ledger knows: ${unexplained.map((r) => `${r.app} ${r.edge}`).join('; ')}`)
if (fates.reduce((a, f) => a + fateCount[f], 0) !== total) throw new Error(`the fates do not account for all ${total} edges`)
const reasons = ['after await', 'in a callback', 'in a helper method', 'under a branch', 'after early exit', 'in a catch clause', 'in a loop', 'control-flow block', 'structural directive', 'ng-template', 'ICU case', 'unreadable template']
const reasonCount = Object.fromEntries(reasons.map((r) => [r, constructs.filter((c) => c.condition === r).length]))
const conditional = constructs.filter((c) => c.condition !== null).length
if (reasons.reduce((a, r) => a + reasonCount[r], 0) !== conditional) throw new Error('a construct carries a condition this ledger does not name')

// The review: two readings of each distinct construct, by hand and without the readers above,
// recorded in results-must/review.json. Each is compared with the extractor construct by construct.
const reviewFile = path.join(import.meta.dirname, 'results-must', 'review.json')
const review = existsSync(reviewFile) ? JSON.parse(readFileSync(reviewFile, 'utf8')) : null
const distinct = [...new Map(constructs.map((c) => [`${c.app} ${c.site}`, c])).values()]
const agreement = review && Object.fromEntries(Object.entries(review.readers).map(([name, verdicts]) => {
  const byKey = new Map(verdicts.map((v) => [`${v.app} ${v.site}`, v]))
  const missing = distinct.filter((c) => !byKey.has(`${c.app} ${c.site}`))
  if (missing.length) throw new Error(`reader ${name} gives no verdict for ${missing.map((c) => c.site).join(', ')}`)
  const differ = distinct.filter((c) => byKey.get(`${c.app} ${c.site}`).runsAlways !== (c.condition === null))
  return [name, { agree: distinct.length - differ.length, differ: differ.map((c) => ({ app: c.app, site: c.site, extractor: c.condition, reader: byKey.get(`${c.app} ${c.site}`) })) }]
}))
const readersAgree = review && distinct.filter((c) => new Set(Object.values(review.readers).map((vs) => vs.find((v) => v.app === c.app && v.site === c.site)?.runsAlways)).size === 1).length

const outDir = flag('--out')
if (outDir) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, 'must-context.json'), JSON.stringify({ edges: edgesOut, constructs, fates: fateCount, reasons: reasonCount, review: agreement }, null, 2) + '\n')
}
const tex = flag('--tex')
if (tex) {
  const esc = (s) => String(s).replace(/\\/g, '\\textbackslash{}').replace(/([_%&#$])/g, '\\$1').replace(/~/g, '\\textasciitilde{}')
  const cap = (s) => s.split(/[^a-z]+/i).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  const lines = ['% Generated by must-context.mjs from the corpus graphs. Do not edit by hand.', extractorStamp(),
    `\\newcommand{\\MustCtxEdges}{${total}}`,
    `\\newcommand{\\MustCtxConstructs}{${constructs.length}}`,
    `\\newcommand{\\MustCtxDistinct}{${new Set(constructs.map((c) => `${c.app} ${c.site}`)).size}}`,
    `\\newcommand{\\MustCtxConditional}{${conditional}}`,
    `\\newcommand{\\MustCtxUnconditional}{${constructs.length - conditional}}`,
    `\\newcommand{\\MustCtxHoldingApps}{${new Set(edgesOut.map((r) => r.app)).size}}`,
    `\\newcommand{\\MustCtxMixed}{${edgesOut.filter((r) => r.unconditionalSites > 0 && r.unconditionalSites < r.sites).length}}`,
    `\\newcommand{\\MustCtxAllConditional}{${edgesOut.filter((r) => r.unconditionalSites === 0).length}}`,
    ...fates.map((f) => `\\newcommand{\\MustFate${cap(f)}}{${fateCount[f]}}`),
    ...reasons.map((r) => `\\newcommand{\\MustWhy${cap(r)}}{${reasonCount[r]}}`),
    ...(agreement ? [
      `\\newcommand{\\MustReviewReaders}{${Object.keys(agreement).length}}`,
      `\\newcommand{\\MustReviewReadersAgree}{${readersAgree}}`,
      `\\newcommand{\\MustReviewAgreeMin}{${Math.min(...Object.values(agreement).map((a) => a.agree))}}`,
      `\\newcommand{\\MustReviewAgreeMax}{${Math.max(...Object.values(agreement).map((a) => a.agree))}}`,
    ] : []),
    `\\newcommand{\\MustWhyTemplate}{${reasonCount['control-flow block'] + reasonCount['structural directive'] + reasonCount['ng-template'] + reasonCount['ICU case']}}`,
    '\\newcommand{\\TabMustLedger}{%',
    '\\begin{tabular}{@{}l>{\\raggedright\\arraybackslash}p{0.31\\textwidth}>{\\raggedright\\arraybackslash}p{0.33\\textwidth}>{\\raggedright\\arraybackslash}p{0.14\\textwidth}@{}}',
    '\\toprule',
    'Application & Edge & Construct & Condition read \\\\',
    '\\midrule',
    ...constructs.map((c) => `${esc(c.app)} & ${c.edge.split(' -> ').map((x) => `\\path{${x}}`).join(' $\\to$ ')} & \\path{${c.site}} & ${c.condition ?? 'none'} \\\\`),
    '\\bottomrule',
    '\\end{tabular}}']
  writeFileSync(tex, lines.join('\n') + '\n')
}
console.log(`must tier of the earlier instrument: ${total} edges citing ${constructs.length} constructs; fates ${JSON.stringify(fateCount)}; ${conditional} constructs conditional ${JSON.stringify(reasonCount)}`)
