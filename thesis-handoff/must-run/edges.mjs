/**
 * Builds the edge lists the runtime must check drives: for each preregistered must construct
 * (sites.json), every must edge the final graph draws from it, with its source screen, a
 * concrete URL to load that screen, and its target pattern. Parameterised source screens get
 * a value from --params (a JSON map "pattern" -> "concrete path") or are listed as needing one.
 *
 * Usage: node edges.mjs --app <slug> --db <final uigraph.db> --out <edges.json> [--params <map.json>]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const a = {}
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
const sites = JSON.parse(readFileSync(new URL('./sites.json', import.meta.url), 'utf8')).filter((s) => s.app === a.app)
const params = a.params && existsSync(a.params) ? JSON.parse(readFileSync(a.params, 'utf8')) : {}
const g = JSON.parse(new DatabaseSync(a.db, { readOnly: true }).prepare("select json from docs where key = 'graph'").get().json)
const route = new Map(g.nodes.map((n) => [n.id, n.route]))

/** True when the edge's witness (primary or merged) cites the given file:line. */
const cites = (e, site) => [e.witness, ...(e.mergedWitnesses ?? [])].filter(Boolean)
  .some((w) => `${w.file}:${w.loc?.line}` === site)

const edges = []
const needParam = new Set()
for (const s of sites) {
  for (const e of g.edges.filter((x) => x.modality === 'must' && cites(x, s.site))) {
    const from = route.get(e.from)
    const to = route.get(e.to)
    if (typeof from !== 'string' || typeof to !== 'string') continue
    const fromUrl = from.includes(':') ? params[from] : from
    if (!fromUrl) needParam.add(from)
    edges.push({ id: s.site, site: s.site, from, fromUrl: fromUrl ?? null, to })
  }
}
writeFileSync(a.out, JSON.stringify(edges, null, 1) + '\n')
console.log(`${a.app}: ${edges.length} must edges from ${sites.length} constructs; ${needParam.size} source patterns need a parameter value`)
for (const p of needParam) console.log('  needs value:', p)
