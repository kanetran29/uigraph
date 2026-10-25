#!/usr/bin/env node
// Prototype of the attribution algorithm (thesis Chapter 7).
//
// PROBLEM. A navigation call site l lives inside some component c. The current extractor
// emits an edge only when c is itself a route component. The correct semantics is
//
//     screens(l) = { r in R : c is reachable from C(r) in the component nesting graph }
//
// i.e. a navigation fires from every screen whose rendered component tree contains c.
// This single definition explains three separately observed defects: shared components
// (a header) contribute nothing, components mounted at several routes contribute one edge
// instead of many, and applications that navigate from services or presentational
// components produce no edges at all.
//
// WHAT THIS PROTOTYPE DOES
//   1. discovers components (selector, template, class file)
//   2. builds the nesting graph by finding each component's selector inside templates
//   3. maps route components from the graph's nodes
//   4. for every navigation call site, computes screens(l) by reverse reachability
//   5. reports what the edge set would become, and how it compares to what exists
//
// It is deliberately simple: selector matching by text, no NgModule import-scope
// resolution, no structural-directive conditions. Those are exactly the parts that make
// the real algorithm a contribution rather than a script, and they are listed at the end
// as what the thesis version must add.
//
// Usage: node attribute.mjs <appDir> <uigraph.db> [--json out.json]

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const appDir = path.resolve(process.argv[2])
const dbPath = path.resolve(process.argv[3])
const jIdx = process.argv.indexOf('--json')
const jsonOut = jIdx > -1 ? process.argv[jIdx + 1] : null

// ---------------------------------------------------------------- collect files

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|html)$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name)) out.push(p)
  }
  return out
}
const files = walk(appDir)
const read = (f) => fs.readFileSync(f, 'utf8')

// ---------------------------------------------------------------- 1. components

// A component is a class with @Component({selector, template|templateUrl}).
const components = []
for (const f of files.filter((f) => f.endsWith('.ts'))) {
  const src = read(f)
  const decoRe = /@Component\s*\(\s*\{([\s\S]*?)\}\s*\)\s*export\s+class\s+(\w+)/g
  for (const m of src.matchAll(decoRe)) {
    const body = m[1], cls = m[2]
    const sel = body.match(/selector:\s*['"`]([^'"`]+)['"`]/)?.[1] || null
    const tUrl = body.match(/templateUrl:\s*['"`]([^'"`]+)['"`]/)?.[1] || null
    const inline = /template:\s*[`'"]/.test(body)
    const templateFile = tUrl ? path.resolve(path.dirname(f), tUrl) : null
    components.push({
      cls, selector: sel, file: f, templateFile,
      inlineTemplate: inline ? (body.match(/template:\s*`([\s\S]*?)`/)?.[1] || '') : null,
      rel: path.relative(appDir, f),
    })
  }
}
const bySelector = new Map(components.filter((c) => c.selector).map((c) => [c.selector, c]))
const byClass = new Map(components.map((c) => [c.cls, c]))

const templateOf = (c) => {
  if (c.inlineTemplate !== null) return c.inlineTemplate
  if (c.templateFile && fs.existsSync(c.templateFile)) return read(c.templateFile)
  return ''
}

// ---------------------------------------------------------------- 2. nesting graph

// Edge A -> B when A's template instantiates B's selector.
const nests = new Map(components.map((c) => [c.cls, new Set()]))
for (const c of components) {
  const tpl = templateOf(c)
  if (!tpl) continue
  for (const [sel, child] of bySelector) {
    if (child.cls === c.cls) continue
    if (new RegExp(`<${sel}[\\s/>]`).test(tpl)) nests.get(c.cls).add(child.cls)
  }
}

// ---------------------------------------------------------------- 3. route components

const db = new DatabaseSync(dbPath)
const graph = JSON.parse(db.prepare("select json from docs where key='graph'").get()?.json || '{}')
const nodes = (graph.nodes || []).filter((n) => ['screen', 'route', 'modal'].includes(n.kind))
const existingEdges = graph.edges || []

// Map each screen node to its component class, via componentPath or label.
const screenComponent = new Map()
for (const n of nodes) {
  let cls = null
  if (n.componentPath) {
    const abs = path.resolve(appDir, n.componentPath)
    cls = components.find((c) => c.file === abs)?.cls || null
  }
  if (!cls && n.label && byClass.has(n.label)) cls = n.label
  if (cls) screenComponent.set(n.id, cls)
}

// Reachability: which components are inside screen r's tree.
function reachFrom(cls) {
  const seen = new Set([cls]), stack = [cls]
  while (stack.length) {
    const cur = stack.pop()
    for (const nx of nests.get(cur) || []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx) }
  }
  return seen
}
const screenReach = new Map()
for (const [id, cls] of screenComponent) screenReach.set(id, reachFrom(cls))

// Reverse index: component class -> screens containing it.
const containedIn = new Map()
for (const [id, set] of screenReach) for (const cls of set) {
  if (!containedIn.has(cls)) containedIn.set(cls, new Set())
  containedIn.get(cls).add(id)
}

// ---------------------------------------------------------------- 4. call sites

const callSites = []
for (const c of components) {
  const tpl = templateOf(c)
  if (tpl) {
    tpl.split('\n').forEach((line, i) => {
      if (/\[?routerLink\]?\s*=/.test(line)) callSites.push({ cls: c.cls, kind: 'routerLink', where: `${path.relative(appDir, c.templateFile || c.file)}:${i + 1}`, text: line.trim().slice(0, 90) })
    })
  }
  read(c.file).split('\n').forEach((line, i) => {
    if (/router\s*\.\s*navigate(ByUrl)?\s*\(/.test(line)) callSites.push({ cls: c.cls, kind: 'navigate', where: `${c.rel}:${i + 1}`, text: line.trim().slice(0, 90) })
  })
}
// Navigation from non-component classes (services) is a separate, larger case.
let serviceSites = 0
for (const f of files.filter((f) => f.endsWith('.ts') && !byClass.has(path.basename(f)))) {
  if (components.some((c) => c.file === f)) continue
  for (const line of read(f).split('\n')) if (/router\s*\.\s*navigate(ByUrl)?\s*\(/.test(line)) serviceSites++
}

// ---------------------------------------------------------------- 5. attribute

const attributed = []
let orphan = 0
for (const s of callSites) {
  const screens = [...(containedIn.get(s.cls) || [])]
  if (screens.length === 0) { orphan++; continue }
  attributed.push({ ...s, screens: screens.map((id) => nodes.find((n) => n.id === id)?.route || id) })
}

const fanout = attributed.map((a) => a.screens.length)
const materialised = fanout.reduce((a, b) => a + b, 0)
const shared = attributed.filter((a) => a.screens.length > 1)

console.log(`app:                 ${appDir}`)
console.log(`components:          ${components.length} (${bySelector.size} with a selector)`)
console.log(`screens in graph:    ${nodes.length}`)
console.log(`navigation sites:    ${callSites.length} in components, ${serviceSites} more in non-component classes`)
console.log(`  attributable:      ${attributed.length}`)
console.log(`  orphaned:          ${orphan}  (component never reached from any screen)`)
console.log(``)
console.log(`edges today:         ${existingEdges.length} (must ${existingEdges.filter((e) => e.modality === 'must').length})`)
console.log(`edges if materialised: ${materialised}   <-- naive attribution blows up`)
console.log(`sites firing from >1 screen: ${shared.length}/${attributed.length}`)
console.log(``)
console.log(`top fan-out sites (why materialising is the wrong output):`)
for (const a of [...attributed].sort((x, y) => y.screens.length - x.screens.length).slice(0, 6)) {
  console.log(`   ${String(a.screens.length).padStart(3)} screens  ${a.cls}  ${a.where}`)
  console.log(`              ${a.text}`)
}

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({
  appDir, components: components.length, screens: nodes.length,
  callSites: callSites.length, serviceSites, attributable: attributed.length, orphan,
  edgesToday: existingEdges.length, edgesMaterialised: materialised,
  sharedSites: shared.length, attributed,
}, null, 2))
