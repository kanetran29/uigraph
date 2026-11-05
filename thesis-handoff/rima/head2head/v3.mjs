/**
 * Third pass: after cross-mount pairs were withdrawn from their side (only mifos changes), re-uses the
 * second pass's seeded samples by post-stratification, reading nothing new. Their pairs only shrink, so
 * the new shared and only-theirs strata are subsets of the old ones and the old samples restricted to them
 * are random samples of them; shared pairs that lost their twin form a third only-ours part ("oursMoved"),
 * estimated from the old shared sample's pairs that moved.
 * Usage: node v3.mjs --work <work dir> --v2 results-v2 --out results-v3
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { norm } from '../../e2e-nav/score.mjs'
import { ourPairs, theirPairs } from './pairs.mjs'

const a = {}
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
const strata = JSON.parse(readFileSync(join(a.v2, 'strata.json'), 'utf8'))
const reading = JSON.parse(readFileSync(join(a.v2, 'reading.json'), 'utf8'))
const decls = JSON.parse(readFileSync(join(a.v2, 'route-decls.json'), 'utf8'))
const slug = 'mifos'
const appDir = join(a.work, 'corpus', 'mifos')
const t = join(a.work, 'rima', 'theirs', slug)
const theirs = theirPairs(JSON.parse(readFileSync(join(t, 'a2-workflows.json'), 'utf8')).workflows, JSON.parse(readFileSync(join(t, 'json', 'routes.json'), 'utf8')).routes, appDir, decls[slug])
const ours = ourPairs(JSON.parse(new DatabaseSync(join(appDir, 'uigraph.db')).prepare("select json from docs where key='graph'").get().json))
const key = (p) => `${norm(p.from)}\u0000${norm(p.to)}`
let both = 0, theirsOnly = 0
for (const k of theirs.keys()) ours.has(k) ? both++ : theirsOnly++
const old = strata[slug]
const moved = old.both - both
const relabel = []
for (const p of reading[slug].pairs) {
  const k = key(p)
  if (p.stratum === 'both') relabel.push({ ...p, stratum: theirs.has(k) ? 'both' : 'oursMoved' })
  else if (p.stratum === 'theirs') { if (theirs.has(k)) relabel.push(p) }
  else relabel.push(p)
}
strata[slug] = { ...old, both, theirsOnly, theirs: theirs.size, oursParts: [['oursShell', old.oursShell], ['oursOther', old.oursOther], ['oursMoved', moved]] }
reading[slug] = { ...reading[slug], pairs: relabel }
mkdirSync(a.out, { recursive: true })
writeFileSync(join(a.out, 'strata.json'), JSON.stringify(strata, null, 1) + '\n')
writeFileSync(join(a.out, 'reading.json'), JSON.stringify(reading, null, 1) + '\n')
const c = {}
for (const p of relabel) c[p.stratum] = (c[p.stratum] ?? 0) + 1
console.log(JSON.stringify(strata[slug]), JSON.stringify(c))
