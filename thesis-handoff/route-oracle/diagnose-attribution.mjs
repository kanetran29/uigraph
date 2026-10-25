#!/usr/bin/env node
// Why does a construct that was lost to attribution stay lost after attribution?
// For each such construct: was its owner component given a scope, and does its target
// resolve to a node in the graph?
// Usage: node diagnose-attribution.mjs <appDir> <after-L.json> <before-L.json> <uigraph.db>
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
const ADP = '/tmp/eval/uigraph/packages/adapter-angular/dist/index.js'
const { buildProject, attributeScopes, collectRoutes } = await import(ADP)
const [appDir, afterL, beforeL, dbp] = process.argv.slice(2)
const project = buildProject(path.resolve(appDir))
const routes = collectRoutes(project)
const sc = attributeScopes(project.getSourceFiles(), routes)
const after = new Map(JSON.parse(fs.readFileSync(afterL, 'utf8')).rows.map((r) => [r.at, r]))
const before = JSON.parse(fs.readFileSync(beforeL, 'utf8')).rows
const g = JSON.parse(new DatabaseSync(dbp).prepare("select json from docs where key='graph'").get().json)
const routesSet = g.nodes.filter((n) => n.route).map((n) => n.route.split('/').filter(Boolean))
const resolves = (t) => {
  const lits = [...t.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2])
  const raw = t.trim().startsWith('[') ? lits.join('/') : t.trim().replace(/^\//, '')
  const want = raw.split('/').filter(Boolean)
  if (!t.trim().startsWith('[') && /[{}()]/.test(t)) return 'dynamic'
  if (t.trim().startsWith('[') && lits.length === 0) return 'dynamic'
  return routesSet.some((h) => want.every((s, i) => h[i] === s || (h[i] || '').startsWith(':'))) ? 'resolves' : 'target-missing'
}
const tally = {}
for (const r of before) {
  if (!/^ATTRIBUTION/.test(r.cls)) continue
  const a = after.get(r.at)
  if (/^CONVERTED/.test(a?.cls)) continue
  const owner = r.owner && path.resolve(appDir, r.owner)
  let why
  if (r.cls === 'ATTRIBUTION_SERVICE') why = 'service (not in this version)'
  else if (!sc.screensOf.has(owner) && !sc.shell.has(owner) && !sc.indirectShell?.has(owner)) why = 'no scope: component not reached from any route component or shell'
  else why = `scoped; target ${resolves(r.target)}`
  tally[why] = (tally[why] || 0) + 1
}
console.log(JSON.stringify(tally)); if (process.argv[6]) fs.writeFileSync(process.argv[6], JSON.stringify(tally))
