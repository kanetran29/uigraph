/**
 * Builds the author's blind reading sheet for the first comparison with Rima et al.
 * (rima/PREREGISTRATION.txt, verdicts in rima/adjudication.json). Items: every reference pair the
 * graph missed, a seeded sample of the extra pairs judged real (proportional to each subject's
 * real pairs, largest remainder), the extra pairs judged spurious, and constructed decoys: pairs of
 * a subject's screens that neither the graph at 2aac284 nor the reference holds and that no
 * reading judged, each shown with a construct that leads to its target from another screen. Each
 * item shows the pair and the sites a tool relates to it; no verdict, kind or tool is written.
 *
 * Usage: node make-rima-sheet.mjs
 */
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { appDirs, blocksOf, hash, PAIR_RULE, readJson, tilde, writeSheet } from './sheet-lib.mjs'
import { sample } from '../rima/adjudication-input.mjs'
import { graphHits, norm } from '../e2e-nav/score.mjs'

const SEED = 20261111
const REAL = 30
// heroes-angular is left out: its graph joins every pair of its screens, so it has no decoy pair.
const DECOYS = { 'posts-users-ui-ng': 1, 'airbus-inventory': 1, 'spring-petclinic-angular': 2, 'ever-traduora': 2, 'angular-jumpstart': 1, 'event-booking-mean': 1 }
const CONTEXT = 8
const WILDCARD = "'*' and '/**' name the screen of the wildcard route, shown for any address no other route matches."

/** Splits `total` over groups in proportion to their sizes, largest remainder first (ties by name). */
function allocate(sizes, total) {
  const sum = Object.values(sizes).reduce((a, b) => a + b, 0)
  const quota = Object.entries(sizes).map(([k, n]) => [k, (total * n) / sum])
  const out = Object.fromEntries(quota.map(([k, q]) => [k, Math.floor(q)]))
  let left = total - Object.values(out).reduce((a, b) => a + b, 0)
  for (const [k] of [...quota].sort((a, b) => (b[1] % 1) - (a[1] % 1) || a[0].localeCompare(b[0]))) if (left-- > 0) out[k]++
  return out
}

/** The trigger sites of a missed pair's reference entries, as file:line relative to the subject. */
const missSites = (m) => [...new Set(m.entries.flatMap((e) => [...e.workflowId.matchAll(/\\(src\\[^|]*?):(\d+):\d+/g)].map((x) => `${x[1].replace(/\\/g, '/')}:${x[2]}`)))]

/**
 * Up to `k` decoy pairs of one subject: (s, t) with no graph edge between them once scopes are
 * expanded, not among `taken`, t entered by an edge whose witness lies in the subject; each comes
 * with the first such witness in hash order.
 */
function decoys(slug, k, taken) {
  const g = JSON.parse(gunzipSync(readFileSync(new URL(`../rima/graphs/${slug}.full.json.gz`, import.meta.url))).toString())
  const { screens, hit } = graphHits(g)
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const routes = [...new Set(screens.values())].filter((r) => !r.includes('*'))
  const into = new Map()
  for (const e of g.edges) {
    const t = byId.get(e.to)
    const w = e.witness
    if (t?.kind !== 'screen' || t.route.includes('*') || !w?.file || w.file.startsWith('..') || !w.loc?.line) continue
    if (!into.has(t.route)) into.set(t.route, new Set())
    into.get(t.route).add(`${w.file}:${w.loc.line}`)
  }
  const cands = []
  for (const [t, sites] of into)
    for (const s of routes)
      if (s !== t && !hit.has(`${norm(s)}\u0000${norm(t)}`) && !taken.has(`${slug} ${norm(s)} ${norm(t)}`))
        cands.push({ from: s, to: t, sites: [[...sites].sort((a, b) => hash(a).localeCompare(hash(b)))[0]] })
  return cands.sort((a, b) => hash(`${SEED}|${slug}|${a.from}|${a.to}`).localeCompare(hash(`${SEED}|${slug}|${b.from}|${b.to}`))).slice(0, k)
}

/** One sheet item: the pair, the application directory and the source around each site. */
function item(dirs, slug, p, sites, note) {
  return {
    id: hash(`rima|${slug}|${p.from}|${p.to}`),
    app: slug,
    from: p.from,
    to: p.to,
    title: `${slug} · ${p.from} → ${p.to}`,
    claim: 'Claim: a user on {from} can trigger a navigation that lands on {to}.',
    context: [`Application directory: ${tilde(dirs[slug])}`, ...(`${p.from}${p.to}`.includes('*') ? [WILDCARD] : []), ...(note ? [note] : [])],
    blocks: blocksOf(dirs[slug], sites, CONTEXT),
  }
}

/** Builds and writes rima-sheet.json. */
function main() {
  const dirs = appDirs()
  const adj = readJson('../rima/adjudication.json')
  const input = readJson('../rima/adjudication-input.json')
  const recited = new Set(Object.keys(readJson('../rima/corrections.json')).filter((k) => !k.startsWith('_')))
  const h2h = readJson('../rima/head2head/results-v3/score.json').verdicts
  const taken = new Set([...adj, ...h2h].map((x) => `${x.slug} ${norm(x.from)} ${norm(x.to)}`))
  const items = []
  for (const [slug, v] of Object.entries(input))
    for (const m of v.misses) {
      const sites = missSites(m)
      const named = m.entries.map((e) => e.workflowId.split('|').slice(0, 2).join(' · ')).join('; ')
      items.push(item(dirs, slug, m, sites, sites.length ? null : `No line is cited; the trigger is named as: ${named}.`))
    }
  const edgesOf = (slug, x) => [...new Set(input[slug].extras.find((y) => y.from === x.from && y.to === x.to).edges.map((e) => `${e.file}:${e.line}`))]
  const real = adj.filter((x) => x.kind === 'extra' && x.verdict === 'real' && !recited.has(`${x.slug} ${x.kind} ${x.from} ${x.to}`))
  const bySlug = Object.groupBy(real, (x) => x.slug)
  const counts = allocate(Object.fromEntries(Object.entries(bySlug).map(([s, xs]) => [s, xs.length])), REAL)
  for (const [slug, xs] of Object.entries(bySlug)) for (const x of sample(xs, counts[slug], SEED)) items.push(item(dirs, slug, x, edgesOf(slug, x)))
  for (const x of adj.filter((y) => y.kind === 'extra' && y.verdict === 'spurious')) items.push(item(dirs, x.slug, x, edgesOf(x.slug, x)))
  for (const [slug, k] of Object.entries(DECOYS)) for (const d of decoys(slug, k, taken)) items.push(item(dirs, slug, d, d.sites))
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new Error('two items share an id')
  writeSheet('rima-sheet.json', {
    built: 'make-rima-sheet.mjs',
    title: "Rima et al.'s subjects, first comparison",
    intro: PAIR_RULE,
    questions: [{ key: 'verdict', text: 'Can a user on {from} trigger a navigation that lands on {to}, the trigger shown while the user stays on {from}?', options: ['real', 'spurious', 'unclear'] }],
    items,
  })
  console.log(`${items.length} items -> rima-sheet.json`, counts)
}

main()
