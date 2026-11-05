/**
 * Scores this thesis's graphs of Rima et al.'s seven subjects against their ground truth, under the
 * counting rules of PREREGISTRATION.txt, and writes the LaTeX macros the thesis uses.
 *
 * A reference pair is (start route, terminal route) of a ground-truth entry whose terminal is an
 * internal route outside its start routes. A pair is held at a level when some edge of that level's
 * graph joins the two screens once scope nodes are expanded (e2e-nav/score.mjs graphHits); a
 * reference route is matched to a screen by the e2e scorer's url matcher, so parameter names are
 * ignored and a concrete segment matches a parameter. Extra pairs are graph pairs of the full level
 * that are neither a reference pair nor a pair of a screen with itself.
 *
 * Usage: node score.mjs --gt <softscanner_fa>/docs/analysis/phase-b/gt --graphs <dir> \
 *          --subjects subjects.txt [--json out.json] [--tex out.tex]
 * <dir> holds <slug>.<level>.json.gz for the levels noattr, rooted, outlet and full.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { graphHits, norm, urlMatcher } from '../e2e-nav/score.mjs'

export const LEVELS = ['noattr', 'rooted', 'outlet', 'full']

/** Drops a trailing '/' and ensures a leading one, so '/a/' and 'a' name the route '/a'. */
const route = (r) => '/' + r.split('/').filter(Boolean).join('/')

/**
 * Returns the reference pairs of one ground-truth file, its distinct routes (starts and internal
 * terminals of every entry) and the count of entries per class: nav, same (terminal among the
 * starts), external and noterminal. Both schemas of the published files are read.
 */
export function referencePairs(gt) {
  const pairs = new Map()
  const routes = new Set()
  const classes = { nav: 0, same: 0, external: 0, noterminal: 0 }
  for (const e of gt.entries) {
    const i = e.expectedIntent ?? {}
    const p = e.expectedPlan ?? {}
    const starts = (i.startRouteFullPaths ?? (p.preConditions ?? []).filter((c) => c.type === 'navigate-to-route').map((c) => c.url)).map(route)
    starts.forEach((s) => routes.add(s))
    if (i.terminalExternalUrl) { classes.external++; continue }
    const raw = i.terminalRoutePath ?? (typeof p.terminalUrl === 'string' && p.terminalUrl.startsWith('/') ? p.terminalUrl : null)
    if (raw == null) { classes.noterminal++; continue }
    const t = route(raw)
    routes.add(t)
    if (starts.includes(t)) { classes.same++; continue }
    classes.nav++
    for (const s of starts) pairs.set(`${s}\u0000${t}`, [s, t])
  }
  return { pairs: [...pairs.values()], routes, classes }
}

/**
 * Scores one subject: its reference against each level's graph in `graphs` ({ level: graph }).
 * Returns the pair and route counts, per level the pairs held and the missed ones (why: 'route'
 * when an end matches no screen, 'pair' otherwise), and for the full level the extra pairs.
 */
export function scoreSubject(gt, graphs) {
  const ref = referencePairs(gt)
  const out = { pairs: ref.pairs.length, classes: ref.classes, routes: ref.routes.size, levels: {} }
  for (const [level, g] of Object.entries(graphs)) {
    const { screens, hit } = graphHits(g)
    const match = urlMatcher(screens.values())
    const res = { hit: 0, hitTopOnly: 0, missed: [] }
    const held = new Set()
    for (const [s, t] of ref.pairs) {
      const ms = match(s)
      const mt = match(t)
      if (ms === null || mt === null) { res.missed.push({ from: s, to: t, why: 'route' }); continue }
      const k = `${norm(ms)}\u0000${norm(mt)}`
      held.add(k)
      const h = hit.get(k)
      if (!h) { res.missed.push({ from: s, to: t, why: 'pair' }); continue }
      res.hit++
      if (!h.has('screen')) res.hitTopOnly++
    }
    out.levels[level] = res
    if (level !== 'full') continue
    out.routesHeld = [...ref.routes].filter((r) => match(r) !== null).length
    const named = new Map([...screens.values()].map((r) => [norm(r), r]))
    out.extras = []
    out.selfPairs = 0
    for (const [k, kinds] of hit) {
      const [f, t] = k.split('\u0000')
      if (f === t) { out.selfPairs++; continue }
      if (held.has(k)) continue
      out.extras.push({ from: named.get(f) ?? f, to: named.get(t) ?? t, top: !kinds.has('screen') })
    }
    out.extras.sort((a, b) => `${a.from} ${a.to}`.localeCompare(`${b.from} ${b.to}`))
    out.graphPairs = hit.size
  }
  return out
}

/** Reads a gzipped JSON file. */
const readGz = (file) => JSON.parse(gunzipSync(readFileSync(file)).toString())

/** 'ever-traduora' -> 'EverTraduora', a macro-safe subject name. */
const macroName = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')

/** Percentage with one decimal, or a dash when there is no denominator. */
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}\\,\\%` : '--')

/** Scores every subject of --subjects and writes --json and --tex. */
function main() {
  const a = {}
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
  const slugs = readFileSync(a.subjects, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split(/\s+/)[0])
  const all = {}
  const pooled = { pairs: 0, routes: 0, routesHeld: 0, extras: 0, extrasTop: 0, ...Object.fromEntries(LEVELS.map((l) => [l, 0])) }
  let tex = '% Generated by rima/score.mjs from the graphs of Rima et al.\'s subjects. Do not edit.\n'
  for (const slug of slugs) {
    const graphs = {}
    for (const l of LEVELS) {
      const f = join(a.graphs, `${slug}.${l}.json.gz`)
      if (existsSync(f)) graphs[l] = readGz(f)
    }
    const s = scoreSubject(JSON.parse(readFileSync(join(a.gt, `${slug}.json`), 'utf8')), graphs)
    all[slug] = s
    const N = 'Rima' + macroName(slug)
    const extrasTop = (s.extras ?? []).filter((x) => x.top).length
    const m = { Pairs: s.pairs, Routes: s.routes, RoutesHeld: s.routesHeld ?? 0, Extra: (s.extras ?? []).length, ExtraTop: extrasTop }
    for (const l of LEVELS) m['Hit' + macroName(l)] = s.levels[l]?.hit ?? 0
    for (const [k, v] of Object.entries(m)) tex += `\\newcommand{\\${N}${k}}{${v}}\n`
    pooled.pairs += s.pairs
    pooled.routes += s.routes
    pooled.routesHeld += s.routesHeld ?? 0
    pooled.extras += (s.extras ?? []).length
    pooled.extrasTop += extrasTop
    for (const l of LEVELS) pooled[l] += s.levels[l]?.hit ?? 0
  }
  tex += `\\newcommand{\\RimaSubjects}{${slugs.length}}\n\\newcommand{\\RimaPairs}{${pooled.pairs}}\n`
  tex += `\\newcommand{\\RimaRoutes}{${pooled.routes}}\n\\newcommand{\\RimaRoutesHeld}{${pooled.routesHeld}}\n`
  tex += `\\newcommand{\\RimaExtra}{${pooled.extras}}\n\\newcommand{\\RimaExtraTop}{${pooled.extrasTop}}\n`
  for (const l of LEVELS) {
    tex += `\\newcommand{\\RimaHit${macroName(l)}}{${pooled[l]}}\n`
    tex += `\\newcommand{\\RimaRecall${macroName(l)}}{${pct(pooled[l], pooled.pairs)}}\n`
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, s]) => [k, { pairs: s.pairs, classes: s.classes, hit: Object.fromEntries(LEVELS.map((l) => [l, s.levels[l]?.hit])), routes: `${s.routesHeld}/${s.routes}`, extras: s.extras?.length }])), null, 1))
  if (a.json) writeFileSync(a.json, JSON.stringify(all, null, 1) + '\n')
  if (a.tex) writeFileSync(a.tex, tex)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
