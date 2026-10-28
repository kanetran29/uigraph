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

// The note about a construct, found by where it sits. A note with a line is keyed `file:line`. One
// without a line is keyed on its file alone, but only `unattributed-non-component`: its detail counts
// every navigation call in the file, so it speaks for each of them. Another kind with no line (an
// ambiguous selector) is about one thing in the file, and keying it on the file would let it explain
// every site there.
const noteAt = new Map()
for (const n of notes) if (n.file) {
  const k = n.loc?.line ? `${n.file}:${n.loc.line}` : n.kind === 'unattributed-non-component' ? n.file : null
  if (k && !noteAt.has(k)) noteAt.set(k, n)
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

/**
 * The top-level segments of a bracketed commands array, or null when the text does not open
 * with one. Splitting on every comma would cut `foo(a, b)` in half and `['/x', a[0]]` at the
 * wrong bracket, so the scan tracks quote and bracket depth and closes at the matching `]`.
 */
function commandsParts(target) {
  const open = target.indexOf('[')
  if (open === -1 || target.slice(0, open).trim() !== '') return null
  const parts = []
  let buf = ''
  let depth = 0
  let quote = null
  for (let i = open + 1; i < target.length; i++) {
    const ch = target[i]
    if (quote) {
      if (ch === '\\') { buf += ch + (target[++i] ?? ''); continue }
      if (ch === quote) quote = null
      buf += ch
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; buf += ch; continue }
    if (ch === '[' || ch === '(' || ch === '{') depth++
    if (ch === ')' || ch === '}') depth--
    if (ch === ']') {
      if (depth === 0) { parts.push(buf); return parts.map((p) => p.trim()).filter((p) => p !== '') }
      depth--
    }
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue }
    buf += ch
  }
  return null
}

/**
 * The route PATTERN a target expression names: its quoted segments literal and its computed
 * segments `:param` holes, which is the form `matchesDeclared` is built to compare against.
 * Returns null for anything that is not an absolute commands array or an absolute string.
 *
 * Reading only the FIRST quoted segment, as this did before harness 1.6.0, tested
 * `['/nodes', id, 'rules']` as the path `/nodes`. alfresco declares no route at `/nodes`
 * while `/nodes/:nodeId/rules` is exactly what it does declare, so two live links were
 * published as dead links. A prefix is not a target.
 */
function literalTarget(target) {
  const parts = commandsParts(target)
  const quoted = (s) => { const q = /^'([^']*)'$|^"([^"]*)"$|^`([^`$]*)`$/.exec(s); return q ? (q[1] ?? q[2] ?? q[3]) : null }
  if (!parts) {
    const m = /'([^']*)'|"([^"]*)"/.exec(target)
    const v = m ? (m[1] ?? m[2]) : null
    return v && v.startsWith('/') ? v : null
  }
  const head = quoted(parts[0])
  if (head === null || !head.startsWith('/')) return null
  return parts.map((p) => quoted(p) ?? ':param').join('/').replace(/\/+/g, '/')
}

/**
 * Does this target address something inside a subtree the oracle could not read? `blindSpots`
 * records the prefix of every route array it failed to follow, and no claim that a path is
 * undeclared can hold inside one: the route that declares it may be in the file that was
 * never opened. Without this test the census called a link dead on the strength of a hole the
 * result file had already recorded one field away.
 */
function underBlindSpot(p) {
  const t = norm(p).split('/').filter(Boolean)
  return (routesJson.blindSpots || []).some((b) => {
    if (!b.prefix) return false
    const d = norm(b.prefix).split('/').filter(Boolean)
    // A hole mounted at the application root would void every claim in the application, which
    // is a suppression so broad it stops being evidence. The route set being a lower bound is
    // reported once per application by the extractor's own note instead.
    if (d.length === 0) return false
    return d.length <= t.length && d.every((seg, i) => seg.startsWith(':') || t[i].startsWith(':') || seg === t[i])
  })
}

/**
 * The blindSpots entry that explains why `owner` has no node, or undefined. It holds only for a
 * component (by its text) that the graph neither anchors a node in nor witnesses an edge from and
 * that a lazy module the parser could not read plausibly owns; when any of those fails, the
 * missing node is not the blind spot's doing. It is asked before the extractor's note on purpose:
 * a declared blind spot is a gap in the route set, and a note about the same site must not hide it.
 *
 * What the match establishes, stated exactly, because the attribution is a filename heuristic and
 * not a resolution: the blind spot's own file stem is a substring of the owner's path, or the
 * literal segments of its route prefix appear in the owner's path as WHOLE segments, in order
 * and next to each other. A bare substring test on the prefix read `/cluster` into
 * `resourcelist/clusterrole/component.ts` and replaced a true extractor note with a tool blind
 * spot that does not cover that file, so the segment test is the minimum that keeps the claim
 * honest. It narrows the heuristic; it does not close it, and it is loose in three ways the
 * thesis records. A route prefix does not determine a directory name, so a hole whose components
 * sit under a differently named directory is not attributed by the prefix arm. A blind spot
 * whose prefix is entirely parameterised has no literal segment, so the prefix arm cannot reach
 * it -- though the file arm still can, independently, where the blind spot carries a file. And a
 * one-segment prefix still matches any owner with that directory name anywhere in its path, so
 * a `/reports` hole in one feature claims a component under another feature's `reports`
 * directory: the remaining false direction, narrowed by the contiguity rule and not removed by
 * it. Where two holes match, `find` returns the first the oracle listed, which is an order and
 * not a ranking.
 *
 * Measured over the six applications, this function is asked 24 times and returns undefined
 * every one of them, so the comparison below decides nothing that is published. It is NOT that
 * an earlier branch of the explanation chain answers those rows: they reach here, and this
 * function's own first two conditions turn all of them away -- 16 because the owning file is not
 * a component, 8 because the graph already witnesses an edge from it. The looseness properties
 * above are therefore about what this rule would say, not about any figure.
 */
function lazyBlindSpotOf(relFile, owner) {
  if (!owner || fileKind(owner) !== 'component') return undefined
  if (witnessFiles.has(relFile) || witnessFiles.has(owner)) return undefined
  if ((graph.nodes || []).some((n) => n.componentPath === owner)) return undefined
  return (routesJson.blindSpots || []).find((b) => {
    if (b.file && owner.includes(b.file.replace(/\.module\.ts$/, ''))) return true
    if (!b.prefix) return false
    const segs = owner.split('/')
    const lit = b.prefix.replace(/^\//, '').split('/').filter((k) => k && !k.startsWith(':'))
    if (lit.length === 0) return false
    return segs.some((_, i) => lit.every((k, j) => segs[i + j] === k))
  })
}

const ACCOUNTED = /^(CONVERTED|QUERY_ONLY|ACCOUNTED|EXCLUDED)/
const rows = []
for (const r of loss.rows) {
  if (ACCOUNTED.test(r.cls)) continue
  const target = String(r.target ?? '').trim()
  const owner = r.owner
  const [relFile, lineNo] = [r.at.replace(/:\d+$/, ''), Number(r.at.match(/:(\d+)$/)?.[1] ?? 0)]
  const note = noteAt.get(r.at) ?? noteAt.get(`${relFile}:${lineNo}`) ?? noteAt.get(relFile)
  const lit = literalTarget(target)
  const lazyBlind = lazyBlindSpotOf(relFile, owner)
  let reason = null
  let detail = ''

  if (/outlets\s*:/.test(target)) {
    reason = 'named-outlet'
    detail = 'navigates a secondary outlet; the model admits only the primary outlet, so this is excluded by design, not missed'
  } else if (target === '' || /^\[\s*\]/.test(target)) {
    reason = 'not-a-navigation'
    detail = 'the construct carries no commands, so it names no destination'
  } else if (lit !== null && !matchesDeclared(lit) && underBlindSpot(lit)) {
    // Ordered before the dead-link test on purpose: "the application declares no such route"
    // and "the oracle never opened the file that declares it" look identical from a
    // navigation site, and only this branch can tell them apart.
    reason = 'target-under-unreadable-subtree'
    detail = `the target "${lit}" lies inside a route subtree the oracle could not read, so it is not claimed that no route declares it`
  } else if (lit !== null && !matchesDeclared(lit)) {
    // Tested here rather than inherited from the extractor's note, because the thesis asserts
    // this predicate of every site in the group: an earlier ordering let the note fire first
    // and only a fifth of the group had ever been checked against the route set.
    reason = 'target-names-no-declared-route'
    detail = `the target "${lit}" matches no route the application declares; a dead link, or a route neither tool reads`
  } else if (lit !== null && !matchesNode(lit)) {
    reason = 'declared-route-has-no-node'
    detail = `the target "${lit}" names a declared route the extractor minted no node for`
  } else if (lazyBlind) {
    reason = 'owner-has-no-node:lazy-blind-spot'
    detail = `the owning route is behind a lazy module the parser could not read: ${lazyBlind.reason ?? ''} ${lazyBlind.file ?? lazyBlind.prefix ?? ''}`
  } else if (note) {
    reason = `extractor-note:${note.kind}`
    detail = note.detail ?? ''
  } else if (owner && fileKind(owner) === 'missing') {
    // "Outside a component" is a claim about the file's contents, which cannot be made about a
    // file that could not be opened: that is this harness's own gap, not a property of the source.
    reason = 'owner-file-not-readable'
    detail = `the owning file "${owner}" could not be opened here, so nothing is established about what declares this navigation`
  } else if (owner && fileKind(owner) !== 'component') {
    reason = `non-component-source-unattributed:${fileKind(owner)}`
    detail = 'navigation outside a component, and the extractor attached no note to it, so whether anything in the application injects this class is not established'
  } else if (!owner) {
    reason = 'no-owner-file'
    detail = 'the construct sits in a template the harness could not tie to a component class'
  } else if (!witnessFiles.has(relFile) && !witnessFiles.has(owner)) {
    // The extractor anchored nothing in this file; a lazy blind spot, the commonest cause, was ruled out above.
    const ownerHasNode = (graph.nodes || []).some((n) => n.componentPath === owner)
    reason = ownerHasNode ? 'no-witness-though-owner-has-a-node' : 'owner-has-no-node'
    detail = ownerHasNode
      ? 'the owning screen is in the graph, but no target was parsed out of this file'
      : 'the owning component has neither a node nor a scope, so there is no source to anchor its targets at'
  } else if (/[A-Za-z]/.test(target) && !/['"`]/.test(target)) {
    reason = 'name-not-resolved'
    detail = `the target names a value (${target.slice(0, 40)}) the resolver could not follow to a constant`
  } else {
    const lit = target.match(/'([^']*)'|"([^"]*)"/)
    const p = lit ? (lit[1] ?? lit[2]) : null
    if (p && !p.startsWith('/')) {
      // A relative target tested against an absolute route set can only ever fail, so
      // counting it as a target no route declares credited the analysis's own missing base
      // as a defect of the application. It is a separate claim and it gets a separate name.
      reason = 'relative-target-unresolved'
      detail = `the target "${p}" is relative and the analysis had no base to resolve it against, which is its own gap and not a dead link`
    } else if (p && !matchesDeclared(p) && underBlindSpot(p)) {
      reason = 'target-under-unreadable-subtree'
      detail = `the target "${p}" lies inside a route subtree the oracle could not read, so it is not claimed that no route declares it`
    } else if (p && !matchesDeclared(p)) {
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
