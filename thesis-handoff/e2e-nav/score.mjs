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
 * A missed pair is classified from the graph alone:
 *   dynamic   the routed component of the source screen or of an ancestor holds a site the
 *             soundiness ledger declares unresolved (a fully dynamic target, or a prefix that
 *             over-approximates to no route), so the graph says it does not know the target;
 *   base      the target is in the graph from a strict ancestor of the source screen but not
 *             from the source screen (a relative link resolved against the wrong route);
 *   other     neither.
 *
 * Usage: node score.mjs --app realworld=results/realworld --app mifos=results/mifos --tex out.tex
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'

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

function observed(file) {
  const pairs = new Map()
  let ends = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const r = JSON.parse(line)
    if (r.type !== 'NavigationEnd' || !r.fromPattern) continue
    if (r.trigger !== 'imperative') continue
    ends++
    const k = `${r.fromPattern}\u0000${r.pattern}`
    pairs.set(k, (pairs.get(k) ?? 0) + 1)
  }
  return { pairs, ends }
}

function score(dir) {
  const g = JSON.parse(gunzipSync(readFileSync(join(dir, 'graph.json.gz'))).toString())
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const screens = new Map(g.nodes.filter((n) => n.kind === 'screen').map((n) => [n.id, n.route]))
  const expand = (id) => {
    const n = byId.get(id)
    if (n?.kind === 'screen') return [n.route]
    if (n?.kind !== 'scope') return []
    if (n.scope.kind === 'top') return [...screens.values()]
    return n.scope.members.filter((m) => screens.has(m)).map((m) => screens.get(m))
  }
  // Component files, without extension, of the routed component at each normalised address.
  const compAt = new Map()
  for (const n of g.nodes)
    if (n.kind === 'screen' && n.componentPath) compAt.set(norm(n.route), n.componentPath.replace(/\.ts$/, ''))
  // Component files holding a site the soundiness ledger declares unresolved: a fully dynamic
  // target, or a target prefix that over-approximates to no route.
  const declared = new Set()
  for (const x of JSON.parse(gunzipSync(readFileSync(join(dir, 'soundiness.json.gz'))).toString()))
    if (x.file && (x.kind === 'dynamic-target' || (x.kind === 'over-approximation' && /to 0 route/.test(x.detail))))
      declared.add(x.file.replace(/\.(ts|html)$/, ''))
  const hit = new Map() // normalised pair -> Set of 'top' | 'screen'
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
  const runs = ['navlog-run1.jsonl', 'navlog-run2.jsonl'].map((f) => observed(join(dir, f)))
  const same = [...runs[0].pairs.keys()].sort().join('|') === [...runs[1].pairs.keys()].sort().join('|')
  const pairs = [...runs[0].pairs.keys()]
  const ancestors = (p) => {
    const s = p.split('/').filter(Boolean)
    const out = []
    for (let i = s.length - 1; i >= 1; i--) out.push('/' + s.slice(0, i).join('/'))
    return out
  }
  const res = { pairs: pairs.length, ends: runs[0].ends, same, hit: 0, hitTop: 0, miss: 0, base: 0, dynamic: 0, other: 0, missed: [] }
  for (const k of pairs) {
    const [f, t] = k.split('\u0000')
    const h = hit.get(`${norm(f)}\u0000${norm(t)}`)
    if (h) {
      res.hit++
      if (!h.has('screen')) res.hitTop++
      continue
    }
    res.miss++
    let cls = 'other'
    if (ancestors(f).some((a) => hit.has(`${norm(a)}\u0000${norm(t)}`))) cls = 'base'
    else if ([f, ...ancestors(f)].some((a) => declared.has(compAt.get(norm(a))))) cls = 'dynamic'
    res[cls]++
    res.missed.push({ from: f, to: t, cls })
  }
  res.graphPairs = [...hit.keys()].length
  return res
}

const a = args(process.argv)
const name = (s) => s.charAt(0).toUpperCase() + s.slice(1)
let tex = '% Generated by e2e-nav/score.mjs from e2e-nav/results. Do not edit.\n'
for (const spec of a.app) {
  const [app, dir] = spec.split('=')
  const r = score(dir)
  console.log(app, JSON.stringify(r, null, 1))
  const N = 'EtoE' + name(app)
  for (const [k, v] of Object.entries({ Pairs: r.pairs, Ends: r.ends, Hit: r.hit, HitTop: r.hitTop, HitScreen: r.hit - r.hitTop, Miss: r.miss, MissBase: r.base, MissDynamic: r.dynamic, MissOther: r.other, GraphPairs: r.graphPairs }))
    tex += `\\newcommand{\\${N}${k}}{${v}}\n`
  tex += `\\newcommand{\\${N}Stable}{${r.same ? 'yes' : 'no'}}\n`
}
if (a.tex) writeFileSync(a.tex, tex)
