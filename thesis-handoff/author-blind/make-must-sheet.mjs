/**
 * Builds the author's blind reading sheet for the final must tier. It mixes the 25 must
 * constructs of route-oracle/results-must/tier-reading.json with decoy constructs that the final
 * graphs hold at may only (template routerLink witnesses on edges between placed screens, picked
 * deterministically per application), so the sheet does not reveal which items are must. Each item shows the
 * construct's source lines, one target the graph draws from it and the source screens of those
 * edges; no verdict, reading or modality is written to the sheet.
 *
 * Usage: node make-must-sheet.mjs [--out must-sheet.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const CORPUS = join(homedir(), 'personal/uigraph-corpus')
const ROOTS = { realworld: '.', mifos: '.', k8sdash: 'modules/web', bitwarden: 'apps/web' }
const DECOYS = { realworld: 3, mifos: 8, k8sdash: 2, bitwarden: 2 }
const CONTEXT = 12
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'must-sheet.json'

/** Stable short hash, used for item ids and for an order that hides the item's kind. */
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10)

/** The witness locations (primary and merged) an edge cites, as file:line strings. */
const citesOf = (e) => [e.witness, ...(e.mergedWitnesses ?? [])].filter(Boolean).map((w) => `${w.file}:${w.loc?.line}`)

/** The source lines around a cited line, numbered, with the cited line flagged. */
function snippet(app, site) {
  const [file, line] = site.split(':')
  const lines = readFileSync(join(CORPUS, app, ROOTS[app], file), 'utf8').split('\n')
  const n = Number(line)
  const from = Math.max(1, n - CONTEXT)
  return lines.slice(from - 1, Math.min(lines.length, n + CONTEXT)).map((text, i) => ({ n: from + i, text, cited: from + i === n }))
}

/** One sheet item: a construct, the target its edges reach and the screens they start from. */
function item(app, site, edges, route) {
  const byTarget = new Map()
  for (const e of edges) {
    const t = route.get(e.to)
    if (typeof t !== 'string') continue
    if (!byTarget.has(t)) byTarget.set(t, new Set())
    byTarget.get(t).add(route.get(e.from))
  }
  const [target, sources] = [...byTarget].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0]
  return { id: hash(`${app}|${site}`), app, file: site.split(':')[0], line: Number(site.split(':')[1]), target, sources: [...sources].filter(Boolean).sort(), lines: snippet(app, site) }
}

const must = JSON.parse(readFileSync(new URL('../route-oracle/results-must/tier-reading.json', import.meta.url), 'utf8')).sites
const items = []
for (const app of Object.keys(ROOTS)) {
  const db = new DatabaseSync(join(CORPUS, app, ROOTS[app], 'uigraph.db'), { readOnly: true })
  const g = JSON.parse(db.prepare("select json from docs where key = 'graph'").get().json)
  const route = new Map(g.nodes.map((n) => [n.id, n.route]))
  const mustSites = new Set(must.filter((s) => s.app === app).map((s) => s.site))
  for (const site of mustSites) items.push(item(app, site, g.edges.filter((e) => e.modality === 'must' && citesOf(e).includes(site)), route))
  const maySites = new Map()
  for (const e of g.edges) {
    const w = e.witness
    if (e.modality !== 'may' || !w || w.ruleId !== 'ng.router-link' || !w.file.endsWith('.html')) continue
    if (typeof route.get(e.from) !== 'string' || typeof route.get(e.to) !== 'string') continue
    const site = `${w.file}:${w.loc?.line}`
    if (mustSites.has(site)) continue
    if (!maySites.has(site)) maySites.set(site, [])
    maySites.get(site).push(e)
  }
  const picks = [...maySites.keys()].sort((a, b) => hash(a).localeCompare(hash(b))).slice(0, DECOYS[app])
  for (const site of picks) items.push(item(app, site, maySites.get(site), route))
}
items.sort((a, b) => a.id.localeCompare(b.id))
writeFileSync(new URL(out, import.meta.url), JSON.stringify({ built: 'make-must-sheet.mjs', items }, null, 1) + '\n')
console.log(`${items.length} items (${must.length} must, ${items.length - must.length} decoys) -> ${out}`)
