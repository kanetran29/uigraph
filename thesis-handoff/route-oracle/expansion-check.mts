// Tests Claim 3.2 on a real graph.
//
// The first version of this check compared edgesFrom against expandAnchoredEdges. That
// was near-vacuous: expandAnchoredEdges is a loop over edgesFrom, so the two can only
// disagree about which nodes they iterate. This version materialises the anchored edges
// independently, walking the edge list and fanning each scope-anchored edge out over its
// members, so the comparison exercises the member walk and the dedupe key rather than
// comparing a function with its own caller. scopeMembers is still shared, since that is
// the definition of a scope's membership rather than part of the expansion.
import { DatabaseSync } from 'node:sqlite'
import { edgesFrom, expandAnchoredEdges, scopeMembers } from '@ui-graph/core'

const key = (from: string, e: any) => `${from}|${e.to}|${e.event}|${e.guard ?? ''}`

for (const dbPath of process.argv.slice(2)) {
  const db = new DatabaseSync(dbPath)
  const g = JSON.parse((db.prepare("select json from docs where key='graph'").get() as any).json)
  const byId = new Map<string, any>(g.nodes.map((n: any) => [n.id, n]))
  const screens = g.nodes.filter((n: any) => n.kind === 'screen')

  // independent materialisation: fan each edge out over the screens its anchor stands for
  const indep = new Set<string>()
  for (const e of g.edges) {
    const from = byId.get(e.from)
    if (!from) continue
    const sources = from.kind === 'scope' ? scopeMembers(g, from) : [e.from]
    for (const s of sources) if (byId.get(s)?.kind === 'screen') indep.add(key(s, e))
  }

  const viaQuery = new Set<string>()
  for (const s of screens) for (const e of edgesFrom(g, s.id)) viaQuery.add(key(s.id, e))

  const viaCaller = new Set<string>(
    expandAnchoredEdges(g).edges.map((e: any) => key(e.from, e)))

  const qOnly = [...viaQuery].filter((k) => !indep.has(k))
  const iOnly = [...indep].filter((k) => !viaQuery.has(k))
  const name = dbPath.split('/').pop()!.replace('.db', '')
  console.log(`  ${name.padEnd(11)} screens=${String(screens.length).padStart(3)} ` +
    `anchored=${String(g.edges.length).padStart(4)} query=${String(viaQuery.size).padStart(4)} ` +
    `independent=${String(indep.size).padStart(4)} caller=${String(viaCaller.size).padStart(4)}  ` +
    (qOnly.length || iOnly.length
      ? `MISMATCH query-only=${qOnly.length} independent-only=${iOnly.length}`
      : 'query == independent'))
  for (const k of [...qOnly.slice(0, 2), ...iOnly.slice(0, 2)]) console.log(`      diff: ${k}`)
}
