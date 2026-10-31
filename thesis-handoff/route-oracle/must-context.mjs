#!/usr/bin/env node
// Under what control-flow context each published must edge's navigation actually runs.
//
// Claim 3.1 says a must edge corresponds to a navigation that occurs for every input on which
// the enclosing code executes, and Chapter 3 says what decides that: a site under a template
// condition, or on a route a guard can refuse, is demoted to may. The witness check cannot see
// whether a site fires unconditionally -- it only re-reads the target at the cited line -- so
// whether the demotion rules cover every way a navigation can be conditional is not tested
// anywhere. This reads each must edge's witness out of the corpus graphs, finds the navigation
// call at that line in the syntax tree, and reports the context it sits in.
//
// A navigation is conditional, in the sense the demotion rules use, when it runs only on some
// executions of the event handler that contains it: inside a callback passed to subscribe,
// then or catch, or under an object's next or error key passed to one; after an await in the
// same function, which a rejection skips; after a return or throw an earlier statement can take;
// or under an if, a ternary, a switch case or a
// short-circuit. A template site is conditional when it sits inside an @if, @else, @for,
// @empty, @switch, @case, @default or @defer block, or inside an element carrying a structural
// directive such as *ngIf or *ngFor: a loop body runs zero times on an empty list, so it is as
// conditional as a branch.
//
// Usage: node must-context.mjs --corpus <dir> [--graphs <dir>] [--out <dir>] [--tex <file>]
//        --graphs reads each graph from <dir>/<app>/<sub>/uigraph.db instead of from the corpus,
//        so a graph built by another extractor can be classified against the same sources.
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { templateContextsOf } from './template-context.mjs'

const require = createRequire(path.join(import.meta.dirname, '..', '..', 'packages', 'adapter-angular', 'package.json'))
const { Project, SyntaxKind, Node } = require('ts-morph')

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d }
const corpus = flag('--corpus')
const graphs = flag('--graphs', corpus)
if (!corpus) { console.error('usage: node must-context.mjs --corpus <dir> [--out <dir>] [--tex <file>]'); process.exit(2) }

/** Where each application's database sits under the corpus, as the other harnesses have it. */
const APPS = { realworld: '.', alfresco: 'projects/aca-content', ghostfolio: 'apps/client', k8sdash: 'modules/web', bitwarden: 'apps/web', mifos: '.' }

const ASYNC_CALLEES = new Set(['subscribe', 'then', 'catch', 'finally'])
const ASYNC_KEYS = new Set(['next', 'error', 'complete'])

/**
 * The conditional contexts between a navigation call and the function that contains it. A
 * context is recorded once per kind; the walk stops at the first function boundary that is not
 * itself an asynchronous callback, since above that point the code is the event handler, and an
 * event handler running is what the edge's event already means.
 */
function contextsOf(call) {
  const found = new Set()
  let node = call
  while (node) {
    const parent = node.getParent()
    if (!parent) break
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const host = parent
      const viaKey = Node.isPropertyAssignment(host) && ASYNC_KEYS.has(host.getName())
      const callExpr = viaKey ? host.getParent()?.getParent() : host
      const callee = Node.isCallExpression(callExpr) ? callExpr.getExpression() : null
      const name = callee && Node.isPropertyAccessExpression(callee) ? callee.getName() : null
      if (name && ASYNC_CALLEES.has(name)) { found.add('async-callback'); node = parent; continue }
      break
    }
    if (Node.isMethodDeclaration(node) || Node.isFunctionDeclaration(node) || Node.isConstructorDeclaration(node)) break
    if (Node.isIfStatement(parent) && parent.getExpression() !== node) found.add('branch')
    if (Node.isConditionalExpression(parent) && parent.getCondition() !== node) found.add('branch')
    if (Node.isCaseClause(parent) || Node.isDefaultClause(parent)) found.add('branch')
    if (Node.isBinaryExpression(parent)) {
      const op = parent.getOperatorToken().getKind()
      if ((op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken || op === SyntaxKind.QuestionQuestionToken) &&
          parent.getRight() === node) found.add('branch')
    }
    if (Node.isBlock(parent)) {
      const idx = parent.getStatements().indexOf(node)
      const earlier = idx > 0 ? parent.getStatements().slice(0, idx) : []
      if (earlier.some((s) => s.getDescendantsOfKind(SyntaxKind.AwaitExpression).length || Node.isAwaitExpression(s))) {
        found.add('after-await')
      }
      // A return or throw in an earlier statement skips the call on some executions, unless it
      // belongs to a function nested in that statement and so leaves only that function.
      const leaves = (st) => Node.isReturnStatement(st) || Node.isThrowStatement(st) ||
        [...st.getDescendantsOfKind(SyntaxKind.ReturnStatement), ...st.getDescendantsOfKind(SyntaxKind.ThrowStatement)].some((x) => {
          for (let a = x.getParent(); a && a !== st; a = a.getParent()) {
            if (Node.isArrowFunction(a) || Node.isFunctionExpression(a) || Node.isFunctionDeclaration(a) || Node.isMethodDeclaration(a)) return false
          }
          return true
        })
      if (earlier.some(leaves)) found.add('early-exit')
    }
    node = parent
  }
  return [...found]
}

/** The template a site sits in, and the site's offset within it, for an .html file or an inline template. */
function templateAt(file, line) {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.html')) return { text, offset: text.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0) }
  const sf = new Project({ skipAddingFilesFromTsConfig: true }).addSourceFileAtPath(file)
  for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (prop.getName() !== 'template') continue
    const init = prop.getInitializer()
    if (!init || line < init.getStartLineNumber() || line > init.getEndLineNumber()) continue
    const body = init.getText().slice(1, -1)
    const lineInBody = line - init.getStartLineNumber()
    return { text: body, offset: body.split('\n').slice(0, lineInBody).join('\n').length + (lineInBody > 0 ? 1 : 0) }
  }
  return null
}

const rows = []
const projects = new Map()
for (const [slug, sub] of Object.entries(APPS)) {
  const root = path.join(corpus, slug, sub)
  const db = path.join(graphs, slug, sub, 'uigraph.db')
  if (!existsSync(db)) throw new Error(`no graph for ${slug} at ${db}`)
  const g = JSON.parse(new DatabaseSync(db).prepare("select json from docs where key='graph'").get().json)
  const route = new Map(g.nodes.map((n) => [n.id, n.route ?? n.id]))
  for (const e of g.edges.filter((e) => e.modality === 'must')) {
   const witnesses = [e.witness, ...(e.mergedWitnesses || [])].filter((w) => w?.file)
   const perWitness = []
   for (const w of witnesses) {
    const file = path.resolve(root, w.file || '')
    const line = w.loc?.line
    const row = { app: slug, edge: `${route.get(e.from)} -> ${route.get(e.to)}`, site: `${w.file}:${line}`, contexts: [], kind: 'unresolved' }
    if (!w.file || !line || !existsSync(file)) { perWitness.push(row); continue }
    const tpl = templateAt(file, line)
    if (tpl) {
      const ctx = templateContextsOf(tpl.text, tpl.offset)
      if (ctx === null) { row.kind = 'unresolved (template did not parse)'; perWitness.push(row); continue }
      row.site += ' [template]'
      row.contexts = ctx
      row.kind = ctx.length ? 'conditional' : 'unconditional'
      perWitness.push(row)
      continue
    }
    if (!projects.has(file)) projects.set(file, new Project({ skipAddingFilesFromTsConfig: true }).addSourceFileAtPath(file))
    const sf = projects.get(file)
    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) =>
      c.getStartLineNumber() === line && /(^|\.)navigate(ByUrl)?$/.test(c.getExpression().getText()))
    if (calls.length !== 1) { row.kind = `unresolved (${calls.length} navigate calls on the line)`; perWitness.push(row); continue }
    row.contexts = contextsOf(calls[0])
    row.kind = row.contexts.length ? 'conditional' : 'unconditional'
    perWitness.push(row)
   }
   const unresolvedW = perWitness.filter((r) => r.kind.startsWith('unresolved'))
   rows.push({
     app: slug, edge: `${route.get(e.from)} -> ${route.get(e.to)}`,
     site: `${witnesses[0]?.file}:${witnesses[0]?.loc?.line}`, witnesses: perWitness.length,
     contexts: [...new Set(perWitness.flatMap((r) => r.contexts))],
     unconditionalWitnesses: perWitness.filter((r) => r.kind === 'unconditional').length,
     kind: unresolvedW.length ? unresolvedW[0].kind
       : perWitness.every((r) => r.kind === 'conditional') ? 'conditional'
       : perWitness.every((r) => r.kind === 'unconditional') ? 'unconditional' : 'mixed',
   })
  }
}

const count = (k) => rows.filter((r) => r.kind === k).length
const unresolved = rows.filter((r) => r.kind.startsWith('unresolved'))
if (unresolved.length) {
  throw new Error(`${unresolved.length} must edges could not be located in the syntax tree: ${unresolved.map((r) => `${r.app} ${r.site} (${r.kind})`).join('; ')}`)
}
const total = rows.length
const parts = [['conditional', count('conditional')], ['unconditional', count('unconditional')], ['mixed', count('mixed')]]
if (parts.reduce((a, [, v]) => a + v, 0) !== total) throw new Error(`the classes do not account for all ${total} must edges`)

for (const r of rows) console.error(`${r.kind.padEnd(13)} ${r.app.padEnd(10)} ${r.edge.padEnd(48)} ${r.unconditionalWitnesses}/${r.witnesses} witnesses unconditional  ${r.contexts.join(',')}`)

const outDir = flag('--out')
if (outDir) { mkdirSync(outDir, { recursive: true }); writeFileSync(path.join(outDir, 'must-context.json'), JSON.stringify(rows, null, 2)) }

const tex = flag('--tex')
if (tex) {
  const by = (c) => rows.filter((r) => r.contexts.includes(c)).length
  let out = '% Generated by must-context.mjs from the corpus graphs. Do not edit by hand.\n'
  for (const [k, v] of [
    ['MustCtxEdges', total], ['MustCtxConditional', count('conditional')], ['MustCtxUnconditional', count('unconditional')],
    ['MustCtxMixed', count('mixed')], ['MustCtxAnyUnconditional', rows.filter((r) => r.unconditionalWitnesses > 0).length],
    ['MustCtxTemplate', rows.filter((r) => r.contexts.some((c) => c.startsWith('@') || c.startsWith('*'))).length],
    ['MustCtxAsync', by('async-callback')], ['MustCtxAfterAwait', by('after-await')],
    ['MustCtxBranch', by('branch')], ['MustCtxEarlyExit', by('early-exit')],
    ['MustCtxHoldingApps', new Set(rows.map((r) => r.app)).size],
  ]) out += `\\newcommand{\\${k}}{${v}}\n`
  writeFileSync(tex, out)
  console.error(`wrote ${tex}`)
}
console.error(`\n${total} must edges: ${count('conditional')} with every witness conditional, ${count('unconditional')} with every witness unconditional, ${count('mixed')} mixed; ${rows.filter((r) => r.unconditionalWitnesses > 0).length} have at least one unconditional witness`)
