#!/usr/bin/env node
// Loss breakdown (RQ2, quantitative).
//
// For every navigation construct in the source, decide what became of it in the graph:
// converted to a must edge, converted to a may/unknown edge, or lost. Each lost construct
// is assigned to exactly one defect class by a fixed precedence, so the classes add up
// to the number of lost constructs and can be put in one table per application.
//
// Precedence for lost constructs (first rule that applies wins):
//   NAMED_OUTLET         the construct targets an auxiliary outlet ({outlets: ...})
//   ATTRIBUTION_SERVICE  the construct sits in a class that is not a component
//                        (service, guard, interceptor, resolver, effect, plain module)
//   ATTRIBUTION_SHARED   the construct sits in a component that no route renders
//   CONSTANT_PATH        the owning route component has no node because its route path
//                        is not a string literal
//   LAZY_BOUNDARY        the owning route component has no node and its route is declared
//                        in a lazily loaded routes file
//   COMPONENT_UNLINKED   a node for the owner's route exists, but the extractor did not link
//                        it to the component that renders it, so nothing can be attributed
//                        to it (needs --routes from the Test C parser)
//   NODE_MISS            the owning route component has no node for another reason
//   CONSTANT_TARGET      the owner has a node, but the construct's target is a constant
//                        reference rather than a literal
//   OTHER                none of the above: a genuine extractor miss to inspect by hand
//
// QUERY_ONLY (navigate([], {queryParams})) changes the URL query on the same screen. It is
// not a screen transition and is reported apart from the lost classes.
//
// Guards are not a loss class: a wrong guard mislabels an edge, it does not remove one.
// They are measured by the witness check, not here.
//
// A construct is matched to an edge when an edge witness cites the same file within one
// line. The construct pattern is `routerLink=` / `[routerLink]=` (so routerLinkActive is
// not counted) and `router.navigate(` / `navigateByUrl(`.
//
// Harness 1.2.0: merged witnesses and inline-template matching by target.
//
// Usage: node loss-breakdown.mjs <appDir> <uigraph.db> [--routes C.json] [--json out.json]

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const appDir = path.resolve(process.argv[2])
const dbPath = path.resolve(process.argv[3])
const jIdx = process.argv.indexOf('--json')
const jsonOut = jIdx > -1 ? process.argv[jIdx + 1] : null
const rIdx = process.argv.indexOf('--routes')
const routesJson = rIdx > -1 && fs.existsSync(process.argv[rIdx + 1]) ? JSON.parse(fs.readFileSync(process.argv[rIdx + 1], 'utf8')) : null

// ---------------------------------------------------------------- files

function walk(dir, out = []) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (['node_modules', 'dist', 'e2e', 'cypress', 'playwright'].includes(e.name) || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|html)$/.test(e.name) && !/\.(spec|test|stories|e2e)\.ts$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}
const files = walk(appDir)
const cache = new Map()
const read = (f) => { if (!cache.has(f)) { try { cache.set(f, fs.readFileSync(f, 'utf8')) } catch { cache.set(f, '') } } return cache.get(f) }
const rel = (f) => path.relative(appDir, f)

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const c of [base, base + '.ts', path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  return null
}

// ---------------------------------------------------------------- components

const componentFiles = new Set()
const templateOwner = new Map() // html file -> component ts file
for (const f of files.filter((f) => f.endsWith('.ts'))) {
  const src = read(f)
  if (!/@Component\s*\(/.test(src)) continue
  componentFiles.add(f)
  for (const m of src.matchAll(/templateUrl\s*:\s*['"`]([^'"`]+)['"`]/g)) templateOwner.set(path.resolve(path.dirname(f), m[1]), f)
}

// ---------------------------------------------------------------- route components

// For each route declaration we record the component file it renders, whether its path
// is a literal, and the file it is declared in.
const routeComponent = new Map() // component file -> { literalPath, declFile }
const lazyRouteFiles = new Set()

function importsOf(f) {
  const map = new Map()
  for (const m of read(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)) map.set(name, m[2])
  }
  for (const m of read(f).matchAll(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g)) map.set(m[1], m[2])
  return map
}

for (const f of files.filter((f) => f.endsWith('.ts'))) {
  const src = read(f)
  if (!/\b(component|loadComponent|loadChildren)\s*:/.test(src)) continue
  const imports = importsOf(f)
  for (const m of src.matchAll(/loadChildren\s*:\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const t = resolveImport(f, m[1]); if (t) lazyRouteFiles.add(t)
  }
  // Split on object braces is unreliable; instead, look back from each component key to
  // the nearest preceding `path:` within the same object literal (approximate window).
  const keyRe = /\b(component\s*:\s*(\w+)|loadComponent\s*:\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)(?:\s*\.then\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.(\w+)\s*\))?)/g
  for (const m of src.matchAll(keyRe)) {
    let file = null
    if (m[2]) { const spec = imports.get(m[2]); file = spec ? resolveImport(f, spec) : (componentFiles.has(f) && new RegExp(`class\\s+${m[2]}\\b`).test(src) ? f : null) }
    else if (m[3]) file = resolveImport(f, m[3])
    if (!file) continue
    const before = src.slice(Math.max(0, m.index - 400), m.index)
    const lastBrace = before.lastIndexOf('{')
    const objStart = before.slice(lastBrace >= 0 ? lastBrace : 0)
    const pm = objStart.match(/\bpath\s*:\s*([^,\n}]+)/) || src.slice(m.index, m.index + 300).match(/\bpath\s*:\s*([^,\n}]+)/)
    const literalPath = !pm || /^\s*['"`][^'"`$]*['"`]\s*$/.test(pm[1])
    const prev = routeComponent.get(file)
    // A component rendered by several routes counts as literal if any of its routes is.
    routeComponent.set(file, { literalPath: (prev?.literalPath || false) || literalPath, declFile: prev?.declFile || f })
  }
}

// ---------------------------------------------------------------- graph

const db = new DatabaseSync(dbPath)
const graph = JSON.parse(db.prepare("select json from docs where key='graph'").get()?.json || '{}')
const nodeComponentFiles = new Set((graph.nodes || []).filter((n) => n.componentPath).map((n) => path.resolve(appDir, n.componentPath)))
const witnessAt = new Map() // "file:line" -> strongest modality, placed sources only
// An edge whose SOURCE is an `o_`/`u_` node (kind 'unknown') carries a destination the
// extractor did read, from a screen it could not place. That is accounted for, not recovered.
const unknownKindNodes = new Set((graph.nodes || []).filter((n) => n.kind === 'unknown').map((n) => n.id))
const unplacedAt = new Set()
const inlineWitness = new Map() // "file:line" -> [{ modality, to }]
const nodeRoute = new Map((graph.nodes || []).map((n) => [n.id, n.route]))
const rank = { must: 3, may: 2, unknown: 1 }
// Every witness of an edge counts: the primary one and any merged ones (constructs that
// produce the same edge are merged by the extractor and listed in mergedWitnesses).
const witnessList = []
for (const e of graph.edges || []) for (const w of [e.witness, ...(e.mergedWitnesses || [])]) if (w) witnessList.push({ e, w })
for (const { e, w } of witnessList) {
  if (!w.file || !w.loc?.line) continue
  const abs = path.isAbsolute(w.file) ? w.file : path.resolve(appDir, w.file)
  for (const d of [-1, 0, 1]) {
    const k = `${abs}:${w.loc.line + d}`
    if (unknownKindNodes.has(e.from)) unplacedAt.add(k)
    else if ((rank[e.modality] || 0) > (rank[witnessAt.get(k)] || 0)) witnessAt.set(k, e.modality)
  }
  // Inline templates: the extractor cites the line of `template:` for every link inside
  // it. Keep the edge targets per template line so a construct can be matched by target.
  const tk = `${abs}:${w.loc.line}`
  if (!inlineWitness.has(tk)) inlineWitness.set(tk, [])
  inlineWitness.get(tk).push({ modality: e.modality, to: nodeRoute.get(e.to) })
}

// Declared routes from the independent route parser (Test C), when available: full path,
// rendered component, and whether any segment on the way is a constant reference.
const declaredByComponent = new Map() // component file -> [{ path, constantPath }]
if (routesJson) {
  for (const r of routesJson.routes || []) {
    // `SCREEN_UNRESOLVED` is a screen whose path expression the oracle could not read. It is
    // outside the coverage denominator there, but it is exactly the route the CONSTANT_PATH
    // class below exists to name, so dropping it here would re-file those constructs as a
    // missing node and hide the reason they are missing.
    if ((r.kind !== 'SCREEN' && r.kind !== 'SCREEN_UNRESOLVED') || !r.component) continue
    const declAbs = path.resolve(appDir, r.file)
    let file = null
    if (r.component.startsWith('.')) file = resolveImport(declAbs, r.component)
    else { const spec = importsOf(declAbs).get(r.component); file = spec ? resolveImport(declAbs, spec) : null }
    if (!file) continue
    if (!declaredByComponent.has(file)) declaredByComponent.set(file, [])
    declaredByComponent.get(file).push({ path: r.path, constantPath: !!r.constantPath, lazy: !!r.lazy })
  }
}
const norm = (p) => (p || '').replace(/\/+$/, '') || '/'
const nodeRoutes = new Set((graph.nodes || []).map((n) => norm(n.route)))
const unlinkedNodeRoutes = new Set((graph.nodes || []).filter((n) => !n.componentPath).map((n) => norm(n.route)))

// ---------------------------------------------------------------- constructs

const LINK = /\[?routerLink\]?\s*=\s*("([^"]*)"|'([^']*)')/
// Receiver names vary: router, _router, router_, this.appRouter ...
const NAV = /\b[\w$]*[Rr]outer[\w$]*\s*\.\s*(navigate|navigateByUrl)\s*\(([^\n]*)/

const constructs = []
for (const f of files) {
  const src = read(f)
  const lines = src.split('\n')
  const isHtml = f.endsWith('.html')
  lines.forEach((line, i) => {
    let kind = null, target = ''
    const l = line.match(LINK)
    if (l && (isHtml || /template\s*:|`/.test(src))) { kind = 'routerLink'; target = l[2] ?? l[3] ?? '' }
    else if (!isHtml) {
      const n = line.match(NAV)
      if (n) {
        kind = n[1]
        target = n[2]
        // NAV captures to the end of the line, so a call that puts its commands array on the
        // next line gave an empty target --- and an empty target reads as "names no
        // destination", which took real transitions out of the denominator. bitwarden writes
        // most of its navigations that way: 70 of them were filed as naming no destination
        // while the graph had resolved every one. Read on to the first line that has content.
        for (let j = 1; j <= 3 && target.trim() === ''; j++) target = lines[i + j] ?? ''
      }
    }
    if (!kind) return
    let owner = isHtml ? templateOwner.get(f) || null : f
    let tplLine = null
    if (!isHtml && kind === 'routerLink') for (let j = i; j >= 0; j--) if (/\btemplate\s*:/.test(lines[j])) { tplLine = j + 1; break }
    constructs.push({ file: f, line: i + 1, kind, target: target.trim().slice(0, 100), owner, isHtml, tplLine })
  })
}

// ---------------------------------------------------------------- classify

const isLiteralTarget = (c) => {
  const t = c.target
  if (c.kind === 'routerLink') {
    // plain attribute routerLink="/a/b" is a literal; a bound array of quoted parts plus
    // simple variables is literal enough for the extractor to build a pattern.
    if (!/^\s*\[/.test(t) && !/[.()]/.test(t)) return true
    return !/\b[a-zA-Z_]\w*\.(?!id\b|slug\b|username\b|name\b)\w+/.test(t.replace(/'[^']*'|"[^"]*"/g, ''))
  }
  return /^\s*\[\s*['"`]/.test(t) || /^\s*['"`]/.test(t)
}

const tally = {}
// Match a construct in an inline template to an edge citing the template's start line,
// by target: a literal target must equal the edge's route pattern up to parameters;
// a non-literal target matches any edge there whose route starts with its static prefix.
function inlineMatch(c) {
  const cands = inlineWitness.get(`${c.file}:${c.tplLine}`)
  if (!cands) return undefined
  const lits = [...c.target.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2])
  const raw = c.target.trim().startsWith('[') ? lits.join('/').replace(/\/+/g, '/') : c.target.trim()
  const dynamic = c.target.trim().startsWith('[') && c.target.split(',').length > lits.length
  const norm = (p) => (p || '').split('/').filter(Boolean)
  const want = norm(raw)
  let best
  for (const e of cands) {
    const have = norm(e.to)
    const ok = dynamic
      ? want.every((seg, i) => have[i] === seg || (have[i] || '').startsWith(':'))
      : have.length === want.length && want.every((seg, i) => have[i] === seg || have[i].startsWith(':'))
    if (ok && (rank[e.modality] || 0) > (rank[best] || 0)) best = e.modality
  }
  return best
}

const rows = []
for (const c of constructs) {
  const k = `${c.file}:${c.line}`
  let cls
  let hit = witnessAt.get(k)
  if (!hit && c.tplLine) hit = inlineMatch(c)
  if (hit === 'must') cls = 'CONVERTED_MUST'
  else if (hit === 'may') cls = 'CONVERTED_MAY'
  // An edge into a `u_<screen>` sink carries modality unknown: the construct leaves the screen
  // by an event the graph records, but at a destination only the run time knows. That is
  // neither a recovered transition nor an unexplained loss, so it is counted on its own and
  // taken out of the denominator the loss rules have to explain.
  else if (hit === 'unknown') cls = 'ACCOUNTED_DYNAMIC'
  else if (unplacedAt.has(`${c.file}:${c.line}`)) cls = 'ACCOUNTED_UNPLACED'
  else if (c.kind !== 'routerLink' && /^\s*\[\s*\]/.test(c.target)) cls = 'QUERY_ONLY'
  // Two kinds of construct are not transitions between screens at all, so they leave the
  // denominator rather than counting as losses: a navigation into a secondary outlet, which
  // the model admits no screens for, and a call that carries no commands and so names no
  // destination. Counting them as lost blamed the extractor for the question being wrong.
  else if (/outlets\s*:/.test(c.target)) cls = 'EXCLUDED_NAMED_OUTLET'
  else if (String(c.target ?? '').trim() === '') cls = 'EXCLUDED_NO_COMMANDS'
  else if (!c.owner || !componentFiles.has(c.owner)) cls = c.isHtml ? 'OTHER' : 'ATTRIBUTION_SERVICE'
  else if (!routeComponent.has(c.owner)) cls = 'ATTRIBUTION_SHARED'
  else if (!nodeComponentFiles.has(c.owner)) {
    const rc = routeComponent.get(c.owner)
    const decl = declaredByComponent.get(c.owner)
    if (decl && decl.some((d) => unlinkedNodeRoutes.has(norm(d.path)))) cls = 'COMPONENT_UNLINKED'
    else if (decl && decl.every((d) => d.constantPath)) cls = 'CONSTANT_PATH'
    else if (decl && decl.some((d) => nodeRoutes.has(norm(d.path)))) cls = 'OTHER'
    else if (decl && decl.some((d) => d.lazy)) cls = 'LAZY_BOUNDARY'
    else if (decl) cls = 'NODE_MISS'
    else if (routesJson) cls = 'NODE_MISS' // neither parser found a route for it
    else cls = !rc.literalPath ? 'CONSTANT_PATH' : lazyRouteFiles.has(rc.declFile) ? 'LAZY_BOUNDARY' : 'NODE_MISS'
  } else if (!isLiteralTarget(c)) cls = 'CONSTANT_TARGET'
  else cls = 'OTHER'
  tally[cls] = (tally[cls] || 0) + 1
  rows.push({ at: `${rel(c.file)}:${c.line}`, kind: c.kind, owner: c.owner ? rel(c.owner) : null, cls, target: c.target })
}

const order = ['CONVERTED_MUST', 'CONVERTED_MAY', 'QUERY_ONLY', 'ACCOUNTED_DYNAMIC', 'ACCOUNTED_UNPLACED', 'EXCLUDED_NAMED_OUTLET', 'EXCLUDED_NO_COMMANDS', 'ATTRIBUTION_SERVICE', 'ATTRIBUTION_SHARED', 'LAZY_BOUNDARY', 'CONSTANT_PATH', 'COMPONENT_UNLINKED', 'NAMED_OUTLET', 'CONSTANT_TARGET', 'NODE_MISS', 'OTHER']
const recovered = (tally.CONVERTED_MUST || 0) + (tally.CONVERTED_MAY || 0) + (tally.QUERY_ONLY || 0)
const accounted = (tally.ACCOUNTED_DYNAMIC || 0) + (tally.ACCOUNTED_UNPLACED || 0)
const excluded = (tally.EXCLUDED_NAMED_OUTLET || 0) + (tally.EXCLUDED_NO_COMMANDS || 0)
const inScope = constructs.length - excluded
const lost = inScope - recovered - accounted
console.log(`app:          ${appDir}`)
console.log(`constructs:   ${constructs.length}  (routerLink ${constructs.filter((c) => c.kind === 'routerLink').length}, navigate ${constructs.filter((c) => c.kind !== 'routerLink').length})`)
console.log(`route components found: ${routeComponent.size}, of which with a graph node: ${[...routeComponent.keys()].filter((f) => nodeComponentFiles.has(f)).length}`)
console.log(`lost:         ${lost}`)
for (const c of order) if (tally[c]) console.log(`  ${c.padEnd(20)} ${String(tally[c]).padStart(5)}  ${((tally[c] / constructs.length) * 100).toFixed(1)}%`)

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ appDir, constructs: constructs.length, excluded, inScope, recovered, accounted, lost, tally, rows }, null, 2))
