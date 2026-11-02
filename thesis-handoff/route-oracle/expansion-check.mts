// Tests Claim 3.2 on a real graph.
//
// The first version of this check compared edgesFrom against expandAnchoredEdges. That
// was near-vacuous: expandAnchoredEdges is a loop over edgesFrom, so the two can only
// disagree about which nodes they iterate. This version materialises the anchored edges
// independently, walking the edge list and fanning each scope-anchored edge out over its
// members, so the comparison exercises the member walk and the dedupe key rather than
// comparing a function with its own caller. scopeMembers is still shared, since that is
// the definition of a scope's membership rather than part of the expansion.
//
// Equal key sets are not enough: when two stored edges fire from one screen with one key, the
// expansion must keep the stronger modality and every witness of both. The independent side
// therefore also joins, per key, the highest modality and the union of witnesses, and the
// check compares those labels as well as the keys.
import { DatabaseSync } from 'node:sqlite'
import { edgesFrom, expandAnchoredEdges, scopeMembers } from '@ui-graph/core'
import { extractorStamp } from './provenance.mjs'

const key = (from: string, e: any) => `${from}|${e.to}|${e.event}|${e.guard ?? ''}`
const RANK: Record<string, number> = { unknown: 0, may: 1, must: 2 }
const wkey = (w: any) => `${w?.file}:${w?.loc?.line}:${w?.loc?.col}:${w?.observationId ?? ''}`
const witnesses = (e: any) => [e.witness, ...(e.mergedWitnesses ?? [])].filter(Boolean).map(wkey)
const label = (modality: string, ws: Iterable<string>) => `${modality}|${[...new Set(ws)].sort().join(',')}`
const rows: Array<{ slug: string; screens: number; anchored: number; query: number; independent: number; caller: number; joined: number; labelDiffs: number; agrees: boolean }> = []

for (const dbPath of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const db = new DatabaseSync(dbPath)
  const g = JSON.parse((db.prepare("select json from docs where key='graph'").get() as any).json)
  const byId = new Map<string, any>(g.nodes.map((n: any) => [n.id, n]))
  const screens = g.nodes.filter((n: any) => n.kind === 'screen')

  // independent materialisation: fan each edge out over the screens its anchor stands for
  const indep = new Set<string>()
  const indepLabel = new Map<string, { modality: string; ws: Set<string>; n: number }>()
  for (const e of g.edges) {
    const from = byId.get(e.from)
    if (!from) continue
    const sources = from.kind === 'scope' ? scopeMembers(g, from) : [e.from]
    for (const s of sources) {
      if (byId.get(s)?.kind !== 'screen') continue
      const k = key(s, e)
      indep.add(k)
      const l = indepLabel.get(k) ?? { modality: 'unknown', ws: new Set<string>(), n: 0 }
      if (RANK[e.modality]! > RANK[l.modality]!) l.modality = e.modality
      for (const w of witnesses(e)) l.ws.add(w)
      l.n++
      indepLabel.set(k, l)
    }
  }
  const joined = [...indepLabel.values()].filter((l) => l.n > 1).length

  const viaQuery = new Set<string>()
  let labelDiffs = 0
  for (const s of screens) for (const e of edgesFrom(g, s.id)) {
    const k = key(s.id, e)
    viaQuery.add(k)
    const l = indepLabel.get(k)
    if (l && label(e.modality, witnesses(e)) !== label(l.modality, l.ws)) labelDiffs++
  }

  const viaCaller = new Set<string>(
    expandAnchoredEdges(g).edges.map((e: any) => key(e.from, e)))

  const qOnly = [...viaQuery].filter((k) => !indep.has(k))
  const iOnly = [...indep].filter((k) => !viaQuery.has(k))
  // Every corpus database is called uigraph.db, so the file name names nothing: the
  // application is the first path segment under the corpus directory.
  const parts = dbPath.split('/')
  const i = parts.lastIndexOf('corpus')
  const name = i >= 0 && parts[i + 1] ? parts[i + 1]! : parts.slice(-2, -1)[0] || dbPath
  console.error(`  ${name.padEnd(11)} screens=${String(screens.length).padStart(3)} ` +
    `anchored=${String(g.edges.length).padStart(4)} query=${String(viaQuery.size).padStart(4)} ` +
    `independent=${String(indep.size).padStart(4)} caller=${String(viaCaller.size).padStart(4)}  ` +
    `joined=${String(joined).padStart(4)}  ` +
    (qOnly.length || iOnly.length || labelDiffs
      ? `MISMATCH query-only=${qOnly.length} independent-only=${iOnly.length} label-diffs=${labelDiffs}`
      : 'query == independent (keys, modality, witnesses)'))
  for (const k of [...qOnly.slice(0, 2), ...iOnly.slice(0, 2)]) console.error(`      diff: ${k}`)
  rows.push({ slug: name, screens: screens.length, anchored: g.edges.length, query: viaQuery.size, independent: indep.size, caller: viaCaller.size, joined, labelDiffs, agrees: !qOnly.length && !iOnly.length && !labelDiffs })
}

// The chapter states these figures, so they are emitted as macros rather than read off a
// console: --tex writes the table and the inline macros Chapter 5 uses for Claim 3.3.
if (process.argv.includes('--tex')) {
  if (!rows.length) throw new Error('no database was read, so the expansion table would be empty; pass one uigraph.db per application')
  const bad = rows.filter((r) => !r.agrees)
  if (bad.length) throw new Error(`the expansion disagrees with the independent materialisation on ${bad.map((r) => r.slug).join(', ')}; Claim 3.3 does not hold on this graph and no table may say it does`)
  let out = '% Generated by expansion-check.mts. Do not edit by hand.\n' + extractorStamp() + '\n'
  out += '\\newcommand{\\TabExpansion}{%\n\\begin{tabular}{@{}lrrrr@{}}\n\\toprule\n'
  out += 'Application & Screens & Anchored & Expanded & Independent \\\\\n\\midrule\n'
  for (const r of rows) out += `${r.slug} & ${r.screens} & ${r.anchored} & ${r.query} & ${r.independent} \\\\\n`
  out += '\\bottomrule\n\\end{tabular}}\n'
  out += `\\newcommand{\\ExpansionApps}{${rows.length}}\n`
  // Screen edges the expansion forms by joining more than one stored edge, where modality and
  // witnesses could be lost; the check above has compared both on every one of them.
  out += `\\newcommand{\\ExpansionJoined}{${rows.reduce((a, r) => a + r.joined, 0)}}\n`
  // The library's own materialisation walks every node that is not an anchor or a control, not only the screens, so it can return more than the query.
  out += `\\newcommand{\\ExpansionLibraryLarger}{${rows.filter((r) => r.caller > r.query).length}}\n`
  const biggest = rows.reduce((a, r) => (r.query / r.anchored > a.query / a.anchored ? r : a))
  out += `\\newcommand{\\ExpansionWidest}{${biggest.slug}}\n`
  out += `\\newcommand{\\ExpansionWidestRatio}{${(biggest.query / biggest.anchored).toFixed(1)}}\n`
  process.stdout.write(out)
}
