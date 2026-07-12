// Gauntlet gap report: extract the adversarial sample app and grade the result
// against golden.json's expectations. Each expectation passes at or above its
// `minimum` honesty level; the ONLY failure is a silent miss (or a dishonest
// downgrade below the minimum). Run: pnpm exec tsx scripts/gauntlet-report.ts
// [--strict exits 1 on any FAIL].

import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { buildProject, extractGraph } from '../packages/adapter-react/src/index'

/** One golden expectation for a gauntlet case. */
interface Expectation {
  id: string
  category: string
  kind: 'node' | 'edge'
  route?: string
  fromRoute?: string
  toRoute?: string | null
  minimum: 'node' | 'must' | 'may' | 'honest'
  description: string
}

/** The honesty level the extractor actually achieved for one expectation. */
type Achieved = 'node' | 'must' | 'may' | 'unknown-edge' | 'soundiness' | 'proposal' | 'MISS'

const LEVEL_RANK: Record<Achieved, number> = { node: 5, must: 5, may: 4, 'unknown-edge': 3, soundiness: 2, proposal: 2, MISS: 0 }
const MINIMUM_RANK: Record<Expectation['minimum'], number> = { node: 5, must: 5, may: 4, honest: 2 }

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..', 'examples', 'sample-gauntlet-react')
const golden = JSON.parse(readFileSync(join(appDir, 'golden.json'), 'utf8')) as { expectations: Expectation[] }

const project = buildProject(appDir)
const { graph, soundiness, proposals = [] } = extractGraph(project, appDir, { controls: true })

const nodeByRoute = new Map(graph.nodes.filter((n) => n.route !== null).map((n) => [n.route as string, n]))
const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))

/** Grade a single expectation against the extracted graph + soundiness + proposals. */
function grade(e: Expectation): Achieved {
  if (e.kind === 'node') {
    return e.route !== undefined && nodeByRoute.has(e.route) ? 'node' : 'MISS'
  }
  const from = e.fromRoute !== undefined ? nodeByRoute.get(e.fromRoute) : undefined
  if (from === undefined) return 'MISS'
  const fromIds = new Set(graph.nodes.filter((n) => n.id === from.id || n.parent === from.id).map((n) => n.id))
  const out = graph.edges.filter((ed) => fromIds.has(ed.from))

  if (e.toRoute !== undefined && e.toRoute !== null) {
    const target = nodeByRoute.get(e.toRoute)
    if (target !== undefined) {
      const hits = out.filter((ed) => ed.to === target.id || nodeById.get(ed.to)?.parent === target.id)
      if (hits.some((h) => h.modality === 'must')) return 'must'
      if (hits.some((h) => h.modality === 'may')) return 'may'
    }
  } else {
    const dyn = out.filter((ed) => nodeById.get(ed.to)?.kind === 'unknown' || ed.modality === 'unknown')
    if (dyn.length > 0) return 'unknown-edge'
    if (out.some((ed) => ed.modality === 'may')) return 'may'
  }

  const fromFile = from.componentPath !== null ? basename(from.componentPath) : null
  if (fromFile !== null && soundiness.some((n) => n.file !== undefined && basename(n.file) === fromFile)) return 'soundiness'
  if (proposals.some((p) => p.screen === from.id)) return 'proposal'
  if (soundiness.length > 0 && fromFile === null) return 'soundiness'
  return 'MISS'
}

const rows = golden.expectations.map((e) => {
  const achieved = grade(e)
  const pass = LEVEL_RANK[achieved] >= MINIMUM_RANK[e.minimum]
  return { id: e.id, category: e.category, minimum: e.minimum, achieved, pass, description: e.description }
})

const width = Math.max(...rows.map((r) => r.category.length))
console.log(`gauntlet: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${soundiness.length} soundiness notes, ${proposals.length} proposals\n`)
for (const r of rows) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(5)} ${r.category.padEnd(width)}  min=${r.minimum.padEnd(6)} got=${r.achieved.padEnd(12)} ${r.description}`)
}
const failed = rows.filter((r) => !r.pass)
console.log(`\n${rows.length - failed.length}/${rows.length} pass · ${failed.length} FAIL (silent misses / dishonest downgrades)`)
if (failed.length > 0 && process.argv.includes('--strict')) process.exit(1)
