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
//   kept       the current graph still holds a must edge with the same endpoints and event;
//   guard      the current graph reads a guard on the destination that the earlier one missed;
//   redirect   the destination is a screen whose own address an empty-path child redirects,
//              so the edge now enters the screen the redirect reaches;
//   self-loop  the source already displays the destination, or stands for screens that include
//              it, so whether the navigation runs depends on parameters and router settings;
//   condition  every construct the edge cites runs under a condition.
// Each construct an edge cites is classified as well, with the extractor's OWN readers
// (callCondition and templateCondition in packages/adapter-angular/src/conditions.ts). This is
// therefore a record of the extractor's decisions, not a second opinion on them: a construct
// both get wrong is wrong here too. The per-construct table it writes is what a reader checks.
//
// Usage: pnpm exec tsx must-context.mjs --corpus <dir> --before <dir> --after <dir>
//                                       [--out <dir>] [--tex <file>]
//        --before and --after hold <app>/<sub>/uigraph.db for the two instruments; --corpus
//        holds the sources both were extracted from.
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import { callCondition, templateCondition } from '../../packages/adapter-angular/src/conditions.ts'
import { inlineTemplate } from '../../packages/adapter-angular/src/templates.ts'
import { templateLoc } from '../../packages/adapter-angular/src/nav.ts'

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d }
const corpus = flag('--corpus'), before = flag('--before'), after = flag('--after')
if (!corpus || !before || !after) { console.error('usage: pnpm exec tsx must-context.mjs --corpus <dir> --before <dir> --after <dir> [--out <dir>] [--tex <file>]'); process.exit(2) }

/** Where each application's database sits under the corpus, as the other harnesses have it. */
const APPS = { realworld: '.', alfresco: 'projects/aca-content', ghostfolio: 'apps/client', k8sdash: 'modules/web', bitwarden: 'apps/web', mifos: '.' }
const LINK_RE = /\[?routerLink\]?\s*=\s*"/g

/** The graph a database holds. */
function graphOf(db) {
  if (!existsSync(db)) throw new Error(`no graph at ${db}`)
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
  const was = graphOf(path.join(before, slug, sub, 'uigraph.db'))
  const now = graphOf(path.join(after, slug, sub, 'uigraph.db'))
  const musts = was.edges.filter((e) => e.modality === 'must')
  if (musts.length === 0) continue
  const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true })
  for (const f of tsFiles(root)) project.addSourceFileAtPath(f)
  const route = new Map([...was.nodes, ...now.nodes].map((n) => [n.id, n.route ?? n.id]))
  const scopeOf = new Map(now.nodes.filter((n) => n.scope).map((n) => [n.id, n.scope]))
  for (const e of musts) {
    const label = `${route.get(e.from)} -> ${route.get(e.to)}`
    const same = now.edges.filter((x) => x.from === e.from && x.to === e.to && x.event === e.event)
    const scope = scopeOf.get(e.from)
    const selfLoop = e.from === e.to || scope?.kind === 'top' || (scope?.members ?? []).includes(e.to)
    const sites = [e.witness, ...(e.mergedWitnesses ?? [])].filter((w) => w?.file)
    const read = sites.map((w) => ({ app: slug, edge: label, site: `${w.file}:${w.loc.line}`, ...conditionAt(project, root, w.file, w.loc.line) }))
    constructs.push(...read)
    const fate = same.some((x) => x.modality === 'must') ? 'kept'
      : same.some((x) => x.guard && !e.guard) ? 'guard'
      : same.length === 0 ? 'redirect'
      : selfLoop ? 'self-loop'
      : read.every((r) => r.condition !== null) ? 'condition'
      : 'unexplained'
    edgesOut.push({ app: slug, edge: label, event: e.event, fate, sites: read.length, unconditionalSites: read.filter((r) => r.condition === null).length })
  }
}

const total = edgesOut.length
const fates = ['kept', 'guard', 'redirect', 'self-loop', 'condition']
const fateCount = Object.fromEntries(fates.map((f) => [f, edgesOut.filter((r) => r.fate === f).length]))
const unexplained = edgesOut.filter((r) => r.fate === 'unexplained')
if (unexplained.length) throw new Error(`${unexplained.length} edge(s) left the must tier for no reason this ledger knows: ${unexplained.map((r) => `${r.app} ${r.edge}`).join('; ')}`)
if (fates.reduce((a, f) => a + fateCount[f], 0) !== total) throw new Error(`the fates do not account for all ${total} edges`)
const reasons = ['after await', 'in a callback', 'under a branch', 'after early exit', 'in a catch clause', 'in a loop', 'control-flow block', 'structural directive', 'ng-template', 'unreadable template']
const reasonCount = Object.fromEntries(reasons.map((r) => [r, constructs.filter((c) => c.condition === r).length]))
const conditional = constructs.filter((c) => c.condition !== null).length
if (reasons.reduce((a, r) => a + reasonCount[r], 0) !== conditional) throw new Error('a construct carries a condition this ledger does not name')

const outDir = flag('--out')
if (outDir) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, 'must-context.json'), JSON.stringify({ edges: edgesOut, constructs, fates: fateCount, reasons: reasonCount }, null, 2) + '\n')
}
const tex = flag('--tex')
if (tex) {
  const esc = (s) => String(s).replace(/\\/g, '\\textbackslash{}').replace(/([_%&#$])/g, '\\$1').replace(/~/g, '\\textasciitilde{}')
  const cap = (s) => s.split(/[^a-z]+/i).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  const lines = ['% Generated by must-context.mjs from the corpus graphs. Do not edit by hand.',
    `\\newcommand{\\MustCtxEdges}{${total}}`,
    `\\newcommand{\\MustCtxConstructs}{${constructs.length}}`,
    `\\newcommand{\\MustCtxDistinct}{${new Set(constructs.map((c) => `${c.app} ${c.site}`)).size}}`,
    `\\newcommand{\\MustCtxConditional}{${conditional}}`,
    `\\newcommand{\\MustCtxUnconditional}{${constructs.length - conditional}}`,
    `\\newcommand{\\MustCtxHoldingApps}{${new Set(edgesOut.map((r) => r.app)).size}}`,
    `\\newcommand{\\MustCtxMixed}{${edgesOut.filter((r) => r.unconditionalSites > 0 && r.unconditionalSites < r.sites).length}}`,
    ...fates.map((f) => `\\newcommand{\\MustFate${cap(f)}}{${fateCount[f]}}`),
    ...reasons.map((r) => `\\newcommand{\\MustWhy${cap(r)}}{${reasonCount[r]}}`),
    `\\newcommand{\\MustWhyTemplate}{${reasonCount['control-flow block'] + reasonCount['structural directive'] + reasonCount['ng-template']}}`,
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
