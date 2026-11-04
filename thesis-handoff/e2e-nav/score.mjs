/**
 * Scores the router navigations an application's own end-to-end suite performed against the
 * static graph of that application, and writes the LaTeX macros the thesis uses. The counting
 * rules are those of PREREGISTRATION.txt, fixed before the logs were read.
 *
 * An observed pair is (source pattern, target pattern) of a NavigationEnd whose trigger is
 * imperative and that has a previous screen in the same page load. A pair is in the graph when
 * some edge, must or may, joins the two screens once scope nodes are expanded to their members.
 * Edges into nodes that are not screens never count. Route parameter names are ignored.
 *
 * A redirected navigation (its requested address maps to another route pattern than the one it
 * landed on, or to no screen) is counted in its own bucket and compared on the requested
 * pattern, as the preregistration fixes. The pairs keyed on the landed pattern are scored too
 * (PairsAfterRedirects, HitAfterRedirects): that was the rule applied before 4 Nov 2026.
 *
 * A missed pair is classified from the graph alone, in this order, first match wins:
 *   redirect  a redirected pair the graph holds on the landed target (preregistered class c);
 *   base      the target is in the graph from a strict ancestor of the source screen but not
 *             from the source screen (a relative link resolved against the wrong route);
 *   dynamic   the routed component of the source screen or of an ancestor holds a site the
 *             soundiness ledger declares unresolved (a fully dynamic target, or a prefix that
 *             over-approximates to no route), so the graph says it does not know the target;
 *   other     none of these.
 * MissBaseAny and MissDynamicAny count the misses meeting each test whatever the order.
 *
 * Usage: node score.mjs --app realworld=results/realworld --app mifos=results/mifos --tex out.tex
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function args(argv) {
  const out = { app: [] }
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '')
    if (k === 'app') out.app.push(argv[i + 1])
    else out[k] = argv[i + 1]
  }
  return out
}

const norm = (p) => (p ?? '').replace(/:[^/]+/g, ':_')

/**
 * Reads one navigation log and returns its observed pairs. A navigation whose requested address
 * maps to a different route pattern than the one it landed on is a redirect: as the
 * preregistration fixes, it is keyed on the requested pattern and flagged, never dropped.
 * `after` keeps the pairs keyed on the landed pattern, the rule used before the redirect rule
 * was applied, so both figures can be reported.
 */
function observed(file, patternOfUrl) {
  const pairs = new Map()
  const after = new Set()
  let ends = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const r = JSON.parse(line)
    if (r.type !== 'NavigationEnd' || !r.fromPattern) continue
    if (r.trigger !== 'imperative') continue
    ends++
    after.add(`${r.fromPattern}\u0000${r.pattern}`)
    const asked = r.url === r.urlAfterRedirects ? r.pattern : patternOfUrl(r.url)
    const redirect = asked === null || norm(asked) !== norm(r.pattern)
    const target = redirect ? asked ?? `unmatched:${stripUrl(r.url)}` : r.pattern
    const k = `${r.fromPattern}\u0000${target}`
    const p = pairs.get(k) ?? { redirect: false, landed: new Set() }
    if (redirect) p.redirect = true
    p.landed.add(r.pattern)
    pairs.set(k, p)
  }
  return { pairs, after, ends }
}

/** Drops the query, fragment and matrix parameters of a router url, leaving its path. */
const stripUrl = (url) => url.split(/[?#]/)[0].replace(/;[^/]*/g, '')

/**
 * Returns a function mapping a concrete url to the screen route template it matches segment by
 * segment (a ':param' segment matches any one segment), or null when no screen matches. When
 * several match, the one with most literal segments wins, as a literal route shadows a
 * parameterised one in practice. Wildcard routes never match.
 */
function urlMatcher(routes) {
  const cands = [...new Set(routes)].filter((r) => !r.includes('*')).map((r) => [r, r.split('/').filter(Boolean)])
  return (url) => {
    const segs = stripUrl(url).split('/').filter(Boolean)
    let best = null
    let bestLit = -1
    for (const [r, rs] of cands) {
      if (rs.length !== segs.length || !rs.every((x, i) => x.startsWith(':') || x === segs[i])) continue
      const lit = rs.filter((x) => !x.startsWith(':')).length
      if (lit > bestLit) [best, bestLit] = [r, lit]
    }
    return best
  }
}

/** Reads a gzipped JSON file. */
const readGz = (file) => JSON.parse(gunzipSync(readFileSync(file)).toString())

/**
 * Expands a graph's edges to (screen, screen) pairs: scope nodes stand for their member screens,
 * the top scope for every screen, and edges into nodes that are not screens are dropped. Returns
 * the screens by id and a map from each normalised pair to the kinds of source that reach it
 * ('top' for the shell scope, 'screen' otherwise).
 */
function graphHits(g) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const screens = new Map(g.nodes.filter((n) => n.kind === 'screen').map((n) => [n.id, n.route]))
  const expand = (id) => {
    const n = byId.get(id)
    if (n?.kind === 'screen') return [n.route]
    if (n?.kind !== 'scope') return []
    if (n.scope.kind === 'top') return [...screens.values()]
    return n.scope.members.filter((m) => screens.has(m)).map((m) => screens.get(m))
  }
  const hit = new Map()
  for (const e of g.edges) {
    const fromKind = byId.get(e.from)?.kind === 'scope' && byId.get(e.from).scope.kind === 'top' ? 'top' : 'screen'
    const to = byId.get(e.to)
    if (to?.kind !== 'screen' && to?.kind !== 'scope') continue
    for (const f of expand(e.from))
      for (const t of expand(e.to)) {
        const k = `${norm(f)}\u0000${norm(t)}`
        if (!hit.has(k)) hit.set(k, new Set())
        hit.get(k).add(fromKind)
      }
  }
  return { screens, hit }
}

/**
 * Scores the logs in `dir` against its graph.json.gz, and against every graph-<name>.json.gz
 * beside it (a comparison graph, such as the one mapped without attribution) on the same pairs.
 */
export function score(dir) {
  const g = readGz(join(dir, 'graph.json.gz'))
  const { screens, hit } = graphHits(g)
  // Component files, without extension, of the routed component at each normalised address.
  const compAt = new Map()
  for (const n of g.nodes)
    if (n.kind === 'screen' && n.componentPath) compAt.set(norm(n.route), n.componentPath.replace(/\.ts$/, ''))
  // Component files holding a site the soundiness ledger declares unresolved: a fully dynamic
  // target, or a target prefix that over-approximates to no route.
  const declared = new Set()
  for (const x of readGz(join(dir, 'soundiness.json.gz')))
    if (x.file && (x.kind === 'dynamic-target' || (x.kind === 'over-approximation' && /to 0 route/.test(x.detail))))
      declared.add(x.file.replace(/\.(ts|html)$/, ''))
  const patternOfUrl = urlMatcher(screens.values())
  const runs = ['navlog-run1.jsonl', 'navlog-run2.jsonl'].map((f) => observed(join(dir, f), patternOfUrl))
  const same = [...runs[0].pairs.keys()].sort().join('|') === [...runs[1].pairs.keys()].sort().join('|')
  const ancestors = (p) => {
    const s = p.split('/').filter(Boolean)
    const out = []
    for (let i = s.length - 1; i >= 1; i--) out.push('/' + s.slice(0, i).join('/'))
    return out
  }
  const inGraph = (f, t) => hit.get(`${norm(f)}\u0000${norm(t)}`)
  const res = {
    pairs: runs[0].pairs.size, ends: runs[0].ends, same, redirect: 0, hit: 0, hitTop: 0, hitRedirect: 0,
    miss: 0, missRedirect: 0, base: 0, dynamic: 0, other: 0, baseAny: 0, dynamicAny: 0, missed: [],
    pairsAfterRedirects: runs[0].after.size,
    hitAfterRedirects: [...runs[0].after].filter((k) => inGraph(...k.split('\u0000'))).length,
  }
  for (const [k, p] of runs[0].pairs) {
    const [f, t] = k.split('\u0000')
    if (p.redirect) res.redirect++
    const h = inGraph(f, t)
    if (h) {
      res.hit++
      if (!h.has('screen')) res.hitTop++
      if (p.redirect) res.hitRedirect++
      continue
    }
    res.miss++
    const isBase = ancestors(f).some((a) => inGraph(a, t))
    const isDynamic = [f, ...ancestors(f)].some((a) => declared.has(compAt.get(norm(a))))
    if (isBase) res.baseAny++
    if (isDynamic) res.dynamicAny++
    // A redirected pair the graph holds on its landed target misses only because of the redirect rule.
    let cls = 'other'
    if (p.redirect && [...p.landed].some((l) => inGraph(f, l))) cls = 'missRedirect'
    else if (isBase) cls = 'base'
    else if (isDynamic) cls = 'dynamic'
    res[cls]++
    res.missed.push({ from: f, to: t, cls, redirect: p.redirect })
  }
  res.graphPairs = hit.size
  res.possiblePairs = new Set([...screens.values()].map(norm)).size ** 2
  res.variants = {}
  for (const f of readdirSync(dir).sort()) {
    const m = /^graph-(.+)\.json\.gz$/.exec(f)
    if (!m) continue
    const v = graphHits(readGz(join(dir, f))).hit
    const hits = [...runs[0].pairs.keys()].filter((k) => v.has(k.split('\u0000').map(norm).join('\u0000'))).length
    res.variants[m[1]] = { hit: hits, graphPairs: v.size }
  }
  return res
}

/**
 * Scores every --app given on the command line and writes their macros to --tex.
 */
function main() {
const a = args(process.argv)
const name = (s) => s.charAt(0).toUpperCase() + s.slice(1)
let tex = '% Generated by e2e-nav/score.mjs from e2e-nav/results. Do not edit.\n'
for (const spec of a.app) {
  const [app, dir] = spec.split('=')
  const r = score(dir)
  console.log(app, JSON.stringify(r, null, 1))
  const N = 'EtoE' + name(app)
  for (const [k, v] of Object.entries({ Pairs: r.pairs, Ends: r.ends, Hit: r.hit, HitTop: r.hitTop, HitScreen: r.hit - r.hitTop, Redirect: r.redirect, HitRedirect: r.hitRedirect, Miss: r.miss, MissRedirect: r.missRedirect, MissBase: r.base, MissDynamic: r.dynamic, MissOther: r.other, MissBaseAny: r.baseAny, MissDynamicAny: r.dynamicAny, PairsAfterRedirects: r.pairsAfterRedirects, HitAfterRedirects: r.hitAfterRedirects, GraphPairs: r.graphPairs, PossiblePairs: r.possiblePairs }))
    tex += `\\newcommand{\\${N}${k}}{${v}}\n`
  for (const [v, x] of Object.entries(r.variants)) {
    tex += `\\newcommand{\\${N}Hit${name(v)}}{${x.hit}}\n`
    tex += `\\newcommand{\\${N}GraphPairs${name(v)}}{${x.graphPairs}}\n`
  }
  tex += `\\newcommand{\\${N}Stable}{${r.same ? 'yes' : 'no'}}\n`
}
if (a.tex) writeFileSync(a.tex, tex)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
