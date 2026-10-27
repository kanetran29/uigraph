// Tests Claim 3.2 (expansion) on a real graph. Reported in Section 5.3.
//
// It imports @ui-graph/core, so it has to run from inside the extractor workspace rather
// than from here: copy it into packages/adapter-angular/ at the tag thesis-eval and run
//   pnpm -s -C packages/adapter-angular exec tsx expansion-check.mts <app>.db ...
// after mapping each application with --attribution.
//
// The expansion of the anchored edge set, taken screen by screen through edgesFrom,
// must equal the set that expandAnchoredEdges materialises for the whole graph.
import { DatabaseSync } from 'node:sqlite'
import { edgesFrom, expandAnchoredEdges } from '@ui-graph/core'

const key = (from: string, e: any) => `${from}|${e.to}|${e.event}`
for (const dbPath of process.argv.slice(2)) {
  const db = new DatabaseSync(dbPath)
  const row: any = db.prepare("select json from docs where key='graph'").get()
  const g = JSON.parse(row.json)
  const screens = g.nodes.filter((n: any) => n.kind === 'screen')
  const scopes = g.nodes.filter((n: any) => n.kind === 'scope')

  const viaQuery = new Set<string>()
  for (const s of screens) for (const e of edgesFrom(g, s.id)) viaQuery.add(key(s.id, e))

  const mat = expandAnchoredEdges(g)
  const viaMaterialise = new Set<string>(mat.edges.map((e: any) => key(e.from, e)))

  const onlyQuery = [...viaQuery].filter((k) => !viaMaterialise.has(k))
  const onlyMat = [...viaMaterialise].filter((k) => !viaQuery.has(k))
  const name = dbPath.split('/').slice(-2)[0]
  console.log(`  ${name.padEnd(12)} screens=${String(screens.length).padStart(4)} scopeNodes=${String(scopes.length).padStart(3)} ` +
    `anchored=${String(g.edges.length).padStart(4)} expanded=${String(viaQuery.size).padStart(5)} ` +
    `materialised=${String(viaMaterialise.size).padStart(5)} ` +
    (onlyQuery.length || onlyMat.length ? `MISMATCH query-only=${onlyQuery.length} mat-only=${onlyMat.length}` : 'equal'))
}
