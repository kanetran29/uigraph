/**
 * Writes the list of pairs to be classified by reading the source (PREREGISTRATION.txt, M3 and M4):
 * every reference pair missed at the full level, with the ground-truth entries behind it, and the
 * extra pairs of the full level, all of them for a subject with at most 40 and otherwise a sample of
 * 40 drawn with seed 20261105 over the sorted list. Each extra pair carries the graph edges behind it
 * (event, modality, witness site), so a reader can start from the construct the extractor read.
 *
 * Usage: node adjudication-input.mjs --gt <gt dir> --graphs <dir> --results results.json --out adjudication-input.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { norm } from '../e2e-nav/score.mjs'

export const SEED = 20261105
export const CAP = 40

/** The mulberry32 generator: a seeded stream of floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** All of `items` when there are at most `cap`, else `cap` of them by a seeded shuffle; sorted either way. */
export function sample(items, cap = CAP, seed = SEED) {
  const key = (x) => `${x.from} ${x.to}`
  const sorted = [...items].sort((a, b) => key(a).localeCompare(key(b)))
  if (sorted.length <= cap) return sorted
  const rnd = mulberry32(seed)
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
  }
  return sorted.slice(0, cap).sort((a, b) => key(a).localeCompare(key(b)))
}

/** Maps each normalised (from, to) screen pair of a graph to the edges that reach it, scopes expanded. */
function edgesByPair(g) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const screens = g.nodes.filter((n) => n.kind === 'screen')
  const expand = (id) => {
    const n = byId.get(id)
    if (n?.kind === 'screen') return [n.route]
    if (n?.kind !== 'scope') return []
    if (n.scope.kind === 'top') return screens.map((s) => s.route)
    return n.scope.members.map((m) => byId.get(m)).filter((s) => s?.kind === 'screen').map((s) => s.route)
  }
  const out = new Map()
  for (const e of g.edges)
    for (const f of expand(e.from))
      for (const t of expand(e.to)) {
        const k = `${norm(f)}\u0000${norm(t)}`
        if (!out.has(k)) out.set(k, [])
        out.get(k).push({ fromNode: byId.get(e.from)?.kind === 'scope' ? `scope:${byId.get(e.from).scope.kind}` : 'screen', event: e.event, modality: e.modality, file: e.witness?.file, line: e.witness?.loc?.line, rule: e.witness?.ruleId })
      }
  return out
}

/** Builds the adjudication list for every subject in results.json. */
function main() {
  const a = {}
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
  const results = JSON.parse(readFileSync(a.results, 'utf8'))
  const out = {}
  for (const [slug, r] of Object.entries(results)) {
    const gt = JSON.parse(readFileSync(join(a.gt, `${slug}.json`), 'utf8'))
    const g = JSON.parse(gunzipSync(readFileSync(join(a.graphs, `${slug}.full.json.gz`))).toString())
    const ep = edgesByPair(g)
    const route = (x) => '/' + (x ?? '').split('/').filter(Boolean).join('/')
    const misses = r.levels.full.missed.map((m) => ({
      ...m,
      entries: gt.entries
        .filter((e) => {
          const i = e.expectedIntent ?? {}
          const p = e.expectedPlan ?? {}
          const starts = (i.startRouteFullPaths ?? (p.preConditions ?? []).filter((c) => c.type === 'navigate-to-route').map((c) => c.url)).map(route)
          return starts.includes(m.from) && route(i.terminalRoutePath ?? p.terminalUrl) === m.to
        })
        .map((e) => ({ gtId: e.gtId, workflowId: e.workflowId, triggerKind: e.expectedIntent?.triggerKind })),
    }))
    const extras = sample(r.extras).map((x) => ({ ...x, edges: (ep.get(`${norm(x.from)}\u0000${norm(x.to)}`) ?? []).slice(0, 6) }))
    out[slug] = { misses, extrasTotal: r.extras.length, extrasSampled: extras.length, extras }
  }
  writeFileSync(a.out, JSON.stringify(out, null, 1) + '\n')
  for (const [s, v] of Object.entries(out)) console.log(s, 'misses', v.misses.length, 'extras', `${v.extrasSampled}/${v.extrasTotal}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
