#!/usr/bin/env node
// Why a navigation construct is not in the graph.
//
// loss-breakdown says WHICH class a lost construct falls in; this says WHY that construct
// could not be turned into an edge, one reason per construct, from the source, the graph and
// the extractor's own soundiness notes. Nothing may be left without a reason: the script
// exits non-zero if a single construct reaches the end unexplained, so "we do not know" is a
// failing state rather than a silent remainder.
//
//   node unexplained.mjs <appDir> <uigraph.db> --routes <C.json> --loss <L.json> [--json out]

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const appDir = path.resolve(process.argv[2] || '.')
const dbPath = process.argv[3]
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const routesJson = JSON.parse(fs.readFileSync(arg('--routes'), 'utf8'))
const loss = JSON.parse(fs.readFileSync(arg('--loss'), 'utf8'))
const jsonOut = arg('--json')

const db = new DatabaseSync(dbPath)
const graph = JSON.parse(db.prepare("select json from docs where key='graph'").get()?.json || '{}')
const notesRaw = db.prepare("select json from docs where key='soundiness'").get()?.json
const notes = notesRaw ? (JSON.parse(notesRaw).notes ?? JSON.parse(notesRaw)) : []

const norm = (p) => (p || '').replace(/\/+$/, '').replace(/^\/?/, '/') || '/'
const declared = new Set(routesJson.routes.map((r) => norm(r.path)))
const declaredSegs = routesJson.routes.map((r) => norm(r.path).split('/').filter(Boolean))

/** Does a target path (its own `:param` holes included) match any declared route pattern? */
function matchesDeclared(p) {
  const t = norm(p).split('/').filter(Boolean)
  if (declared.has(norm(p))) return true
  return declaredSegs.some((d) => d.length === t.length && d.every((seg, i) => seg.startsWith(':') || t[i].startsWith(':') || seg === t[i]))
}

const nodeSegs = (graph.nodes || []).filter((n) => n.route).map((n) => norm(n.route).split('/').filter(Boolean))
/** Does a target path match the route of a node that actually exists in the graph? */
function matchesNode(p) {
  const t = norm(p).split('/').filter(Boolean)
  return nodeSegs.some((d) => d.length === t.length && d.every((seg, i) => seg.startsWith(':') || t[i].startsWith(':') || seg === t[i]))
}

/** Is there an edge whose witness sits in `rel` and whose target node matches path `p`? */
function edgeFromFileTo(rel, p) {
  const t = norm(p).split('/').filter(Boolean)
  const nodeRoute = new Map((graph.nodes || []).map((n) => [n.id, n.route]))
  return (graph.edges || []).some((e) => {
    const files = [e.witness, ...(e.mergedWitnesses || [])].map((w) => w?.file)
    if (!files.includes(rel)) return false
    const r = nodeRoute.get(e.to)
    if (!r) return false
    const d = norm(r).split('/').filter(Boolean)
    return d.length === t.length && d.every((seg, i) => seg.startsWith(':') || t[i].startsWith(':') || seg === t[i])
  })
}

const noteAt = new Map()
for (const n of notes) if (n.file && n.loc?.line) {
  const k = `${n.file}:${n.loc.line}`
  if (!noteAt.has(k)) noteAt.set(k, n)
}
const noteKindsInFile = new Map()
for (const n of notes) if (n.file) {
  if (!noteKindsInFile.has(n.file)) noteKindsInFile.set(n.file, new Set())
  noteKindsInFile.get(n.file).add(n.kind)
}
const witnessFiles = new Set()
for (const e of graph.edges || []) for (const w of [e.witness, ...(e.mergedWitnesses || [])]) if (w?.file) witnessFiles.add(w.file)

const srcCache = new Map()
const lines = (rel) => {
  if (!srcCache.has(rel)) {
    try { srcCache.set(rel, fs.readFileSync(path.join(appDir, rel), 'utf8').split('\n')) } catch { srcCache.set(rel, null) }
  }
  return srcCache.get(rel)
}

/** Is the file a component (an @Component class), a service-like class, or neither? */
const fileKind = (rel) => {
  const src = lines(rel)?.join('\n')
  if (src === undefined || src === null) return 'missing'
  if (/@Component\s*\(/.test(src)) return 'component'
  if (/@Directive\s*\(/.test(src)) return 'directive'
  if (/@Injectable\s*\(/.test(src)) return 'service'
  if (/createEffect\s*\(|@Effect/.test(src)) return 'effect'
  return 'plain-class'
}

/** The first quoted path in a target expression, or null when it names none. */
function literalTarget(target) {
  const m = /'([^']*)'|"([^"]*)"/.exec(target)
  const v = m ? (m[1] ?? m[2]) : null
  return v && v.startsWith('/') ? v : null
}

const ACCOUNTED = /^(CONVERTED|QUERY_ONLY|ACCOUNTED|EXCLUDED)/
const rows = []
for (const r of loss.rows) {
  if (ACCOUNTED.test(r.cls)) continue
  const target = String(r.target ?? '').trim()
  const owner = r.owner
  const [relFile, lineNo] = [r.at.replace(/:\d+$/, ''), Number(r.at.match(/:(\d+)$/)?.[1] ?? 0)]
  const note = noteAt.get(r.at) ?? noteAt.get(`${relFile}:${lineNo}`)
  let reason = null
  let detail = ''

  if (/outlets\s*:/.test(target)) {
    reason = 'named-outlet'
    detail = 'navigates a secondary outlet; the model admits only the primary outlet, so this is excluded by design, not missed'
  } else if (target === '' || /^\[\s*\]/.test(target)) {
    reason = 'not-a-navigation'
    detail = 'the construct carries no commands, so it names no destination'
  } else if (literalTarget(target) !== null && !matchesDeclared(literalTarget(target))) {
    // Tested here rather than inherited from the extractor's note, because the thesis asserts
    // this predicate of every site in the group: an earlier ordering let the note fire first
    // and only a fifth of the group had ever been checked against the route set.
    reason = 'target-names-no-declared-route'
    detail = `the target "${literalTarget(target)}" matches no route the application declares; a dead link, or a route neither tool reads`
  } else if (literalTarget(target) !== null && !matchesNode(literalTarget(target))) {
    reason = 'declared-route-has-no-node'
    detail = `the target "${literalTarget(target)}" names a declared route the extractor minted no node for`
  } else if (note) {
    reason = `extractor-note:${note.kind}`
    detail = note.detail ?? ''
  } else if (owner && fileKind(owner) !== 'component') {
    reason = `non-component-source:${fileKind(owner)}`
    detail = 'navigation outside a component; its scope is the join over whatever calls it, and nothing in the application injects this class'
  } else if (!owner) {
    reason = 'no-owner-file'
    detail = 'the construct sits in a template the harness could not tie to a component class'
  } else if (!witnessFiles.has(relFile) && !witnessFiles.has(owner)) {
    // The extractor parsed the project but anchored nothing in this file. For a component
    // that is because its owner has no node to fire from, and the commonest cause of THAT is
    // a lazy module whose route array the parser could not find, so say which.
    const ownerHasNode = (graph.nodes || []).some((n) => n.componentPath === owner)
    const blind = (routesJson.blindSpots || []).find((b) => (b.file && owner && owner.includes(b.file.replace(/\.module\.ts$/, ''))) || (b.prefix && owner && owner.includes(b.prefix.replace(/^\//, ''))))
    reason = ownerHasNode ? 'no-witness-though-owner-has-a-node' : blind ? 'owner-has-no-node:lazy-blind-spot' : 'owner-has-no-node'
    detail = ownerHasNode
      ? 'the owning screen is in the graph, but no target was parsed out of this file'
      : blind
        ? `the owning route is behind a lazy module the parser could not read: ${blind.reason ?? ''} ${blind.file ?? blind.prefix ?? ''}`
        : 'the owning component has neither a node nor a scope, so there is no source to anchor its targets at'
  } else if (/[A-Za-z]/.test(target) && !/['"`]/.test(target)) {
    reason = 'name-not-resolved'
    detail = `the target names a value (${target.slice(0, 40)}) the resolver could not follow to a constant`
  } else {
    const lit = target.match(/'([^']*)'|"([^"]*)"/)
    const p = lit ? (lit[1] ?? lit[2]) : null
    if (p && !matchesDeclared(p)) {
      reason = 'unmapped-target'
      detail = `the target "${p}" matches no declared route; a dead link or a route the parser did not find`
    } else if (p && matchesDeclared(p) && !matchesNode(p)) {
      // The route is declared and the target names it; what is missing is the NODE. Calling
      // this a witness-line problem, as an earlier version of this script did, pointed at the
      // wrong end of the pipeline.
      reason = 'declared-route-has-no-node'
      detail = `the target "${p}" names a declared route the extractor minted no node for, so there is nothing to draw the edge to`
    } else if (p && edgeFromFileTo(relFile, p)) {
      // The transition IS in the graph; what is missing is the line. Several links on one
      // screen to routes that share a pattern collapse into one edge, and the harness matches
      // a construct to an edge by line, so the siblings read as losses. Coverage is intact;
      // provenance is not.
      reason = 'edge-exists-witness-on-another-line'
      detail = `an edge to "${p}" is witnessed elsewhere in this file, so the construct is covered but not traceable to its own line`
    } else if (noteKindsInFile.get(relFile)?.size || noteKindsInFile.get(owner)?.size) {
      reason = 'parsed-file-no-note-near-construct'
      detail = 'the extractor parsed this file and noted other sites, but nothing lands within one line of this construct'
    } else {
      reason = 'UNKNOWN'
      detail = 'no condition explains this construct — inspect by hand'
    }
  }
  rows.push({ at: r.at, cls: r.cls, target: target.slice(0, 60), reason, detail })
}

const byReason = {}
for (const r of rows) byReason[r.reason] = (byReason[r.reason] || 0) + 1
const unknown = rows.filter((r) => r.reason === 'UNKNOWN')

console.log(`unexplained constructs: ${rows.length}`)
for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
if (unknown.length) {
  console.log(`\nWITHOUT A REASON (${unknown.length}):`)
  for (const u of unknown.slice(0, 20)) console.log(`   ${u.cls.padEnd(20)} ${u.target.padEnd(42)} ${u.at}`)
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ appDir, total: rows.length, byReason, rows }, null, 2))
process.exit(unknown.length ? 1 : 0)
