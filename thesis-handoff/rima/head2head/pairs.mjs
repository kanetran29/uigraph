/**
 * Turns both tools' outputs into screen pairs under the unit of PREREGISTRATION.txt, splits each
 * application's union into strata (both, theirs only, ours only), draws the reading sample with the
 * preregistered seed, and writes the strata and the blind reading list.
 *
 * Their pairs: every A2 workflow whose terminal node is a route gives (start route, terminal route)
 * for each of its start routes, the routes' full paths read from their own route map. Ours: every
 * edge between screens once scope nodes are expanded. Self pairs and wildcard routes are left out.
 * A reader is shown the pair and every trigger site either tool cites for it, unlabelled and sorted.
 *
 * Usage: node pairs.mjs --work <work dir> --out <dir> [--decls route-decls.json]   (reads apps.txt beside this file)
 * With --decls their routes are identified with ours by declaration site (a post-hoc reading).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { norm } from '../../e2e-nav/score.mjs'
import { sample } from '../adjudication-input.mjs'

export const SEED = 20261106
export const CAP = 12
export const SPLIT = 1000

/** '/a/b/' and 'a/b' both name '/a/b'. */
const route = (r) => '/' + String(r).split('/').filter(Boolean).join('/')
const wild = (r) => r.split('/').some((s) => s === '**' || s === '*')
const key = (s, t) => `${norm(s)}\u0000${norm(t)}`

/**
 * Their pairs from an A2 workflow file and their route map: a Map from pair key to { from, to, sites },
 * sites being the trigger locations their workflow ids name, relative to `appDir`.
 */
export function theirPairs(workflows, routes, appDir, decls = null) {
  // A route is identified by where it is declared when `decls` (file:line -> the paths ours mounts it
  // at) knows it: the mount whose path is the one they record, else the mounts ending in it (their
  // tool does not prefix a lazily loaded module's routes), else every mount.
  const mounts = (r) => {
    const ms = decls && r.origin ? decls[`${r.origin.file}:${r.origin.startLine}`] : undefined
    if (!ms || ms.length === 0) return [route(r.fullPath)]
    const own = norm(route(r.fullPath))
    const same = ms.filter((x) => norm(route(x)) === own)
    if (same.length) return same.map(route)
    const tail = ms.filter((x) => norm(route(x)).endsWith(own))
    return (tail.length ? tail : ms).map(route)
  }
  const paths = new Map(routes.map((r) => [r.id, mounts(r)]))
  const out = new Map()
  for (const w of workflows) {
    // Their enumerator sets a workflow's terminal to its own start route when the trigger does not
    // navigate or its target is unresolved; only a resolved navigation claims a transition.
    const navigates = (w.steps ?? []).some((x) => x.kind === 'WIDGET_NAVIGATES_ROUTE' || x.kind === 'COMPONENT_NAVIGATES_ROUTE')
    if (!navigates || w.meta?.unresolvedTargets?.length) continue
    const m = /\|([^|]+):(\d+):\d+\|/.exec(w.triggerEdgeId ?? w.id ?? '')
    const site = m ? `${relative(appDir, m[1])}:${m[2]}` : null
    for (const t of paths.get(w.terminalNodeId) ?? []) {
      if (wild(t)) continue
      for (const id of w.startRouteIds ?? [])
        for (const s of paths.get(id) ?? []) {
          if (wild(s) || norm(s) === norm(t)) continue
          const k = key(s, t)
          const p = out.get(k) ?? { from: s, to: t, sites: new Set() }
          if (site) p.sites.add(site)
          out.set(k, p)
        }
    }
  }
  return out
}

/** Our pairs from a graph document: a Map from pair key to { from, to, sites } (witness locations). */
export function ourPairs(g) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const screens = g.nodes.filter((n) => n.kind === 'screen' && !wild(route(n.route)))
  const expand = (id) => {
    const n = byId.get(id)
    if (n?.kind === 'screen') return wild(route(n.route)) ? [] : [route(n.route)]
    if (n?.kind !== 'scope') return []
    if (n.scope.kind === 'top') return screens.map((s) => route(s.route))
    return n.scope.members.map((m) => byId.get(m)).filter((s) => s?.kind === 'screen' && !wild(route(s.route))).map((s) => route(s.route))
  }
  const out = new Map()
  for (const e of g.edges)
    for (const s of expand(e.from))
      for (const t of expand(e.to)) {
        if (norm(s) === norm(t)) continue
        const k = key(s, t)
        const p = out.get(k) ?? { from: s, to: t, sites: new Set(), shellOnly: true }
        if (e.witness?.file) p.sites.add(`${e.witness.file}:${e.witness.loc?.line}`)
        if (!(byId.get(e.from)?.kind === 'scope' && byId.get(e.from).scope.kind === 'top')) p.shellOnly = false
        out.set(k, p)
      }
  return out
}

/** The graph document of a uigraph database. */
const graphOfDb = (db) => JSON.parse(new DatabaseSync(db).prepare("select json from docs where key='graph'").get().json)

/** Builds the strata and the reading list for every application of apps.txt. */
function main() {
  const a = {}
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
  const here = new URL('.', import.meta.url).pathname
  const rimaGraphs = join(here, '..', 'graphs-repaired')
  mkdirSync(a.out, { recursive: true })
  const decls = a.decls ? JSON.parse(readFileSync(a.decls, 'utf8')) : null
  const strata = {}
  const reading = {}
  for (const line of readFileSync(join(here, 'apps.txt'), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const [slug, dir] = line.split(/\s+/)
    const appDir = join(a.work, dir)
    const t = join(a.work, 'rima', 'theirs', slug)
    const theirs = existsSync(join(t, 'a2-workflows.json'))
      ? theirPairs(JSON.parse(readFileSync(join(t, 'a2-workflows.json'), 'utf8')).workflows, JSON.parse(readFileSync(join(t, 'json', 'routes.json'), 'utf8')).routes, appDir, decls?.[slug] ?? null)
      : new Map()
    const gz = join(rimaGraphs, `${slug}.full.json.gz`)
    const g = existsSync(gz) ? JSON.parse(gunzipSync(readFileSync(gz)).toString()) : graphOfDb(join(appDir, 'uigraph.db'))
    const ours = ourPairs(g)
    const both = [], theirsOnly = [], oursOnly = []
    for (const [k, p] of theirs) (ours.has(k) ? both : theirsOnly).push({ k, ...p, sites: new Set([...p.sites, ...(ours.get(k)?.sites ?? [])]) })
    for (const [k, p] of ours) if (!theirs.has(k)) oursOnly.push({ k, ...p })
    strata[slug] = { both: both.length, theirsOnly: theirsOnly.length, oursOnly: oursOnly.length, theirs: theirs.size, ours: ours.size }
    const pick = (list, stratum) => sample(list.map(({ from, to, sites }) => ({ from, to, sites: [...sites].sort(), stratum })), CAP, SEED)
    // An only-ours stratum over SPLIT pairs is read in two parts, those only the shell reaches and the
    // rest, so one dominant trigger cannot decide the estimate alone (a post-hoc refinement).
    let ourSample
    if (oursOnly.length > SPLIT) {
      const shell = oursOnly.filter((p) => p.shellOnly), other = oursOnly.filter((p) => !p.shellOnly)
      strata[slug].oursShell = shell.length
      strata[slug].oursOther = other.length
      ourSample = [...pick(shell, 'oursShell'), ...pick(other, 'oursOther')]
    } else ourSample = pick(oursOnly, 'ours')
    reading[slug] = { appDir, pairs: [...pick(both, 'both'), ...pick(theirsOnly, 'theirs'), ...ourSample] }
    console.log(slug.padEnd(26), JSON.stringify(strata[slug]))
  }
  writeFileSync(join(a.out, 'strata.json'), JSON.stringify(strata, null, 1) + '\n')
  writeFileSync(join(a.out, 'reading.json'), JSON.stringify(reading, null, 1) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
