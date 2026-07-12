// Gauntlet grading library: extract the adversarial sample app and grade the
// result against its golden.json. Pure functions shared by the CLI report
// (scripts/gauntlet-report.ts) and the adapter-react regression test, so the
// grading semantics can never drift between the two.

import { join, basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { buildProject, extractGraph } from '../packages/adapter-react/src/index'

/** One golden expectation for a gauntlet case. */
export interface Expectation {
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
export type Achieved = 'node' | 'must' | 'may' | 'unknown-edge' | 'soundiness' | 'proposal' | 'MISS'

/** One graded row: the expectation, what was achieved, and whether it meets the minimum. */
export interface GradedRow {
  id: string
  category: string
  minimum: Expectation['minimum']
  achieved: Achieved
  pass: boolean
  description: string
}

/** The full gauntlet grade: per-expectation rows plus extraction totals. */
export interface GauntletGrade {
  rows: GradedRow[]
  nodes: number
  edges: number
  soundiness: number
  proposals: number
}

const LEVEL_RANK: Record<Achieved, number> = { node: 5, must: 5, may: 4, 'unknown-edge': 3, soundiness: 2, proposal: 2, MISS: 0 }
const MINIMUM_RANK: Record<Expectation['minimum'], number> = { node: 5, must: 5, may: 4, honest: 2 }

/** Extract the gauntlet app at `appDir` and grade every golden expectation. */
export function gradeGauntlet(appDir: string): GauntletGrade {
  const golden = JSON.parse(readFileSync(join(appDir, 'golden.json'), 'utf8')) as { expectations: Expectation[] }
  const project = buildProject(appDir)
  const { graph, soundiness, proposals = [] } = extractGraph(project, appDir, { controls: true })

  const nodeByRoute = new Map(graph.nodes.filter((n) => n.route !== null).map((n) => [n.route as string, n]))
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))

  const grade = (e: Expectation): Achieved => {
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
    return { id: e.id, category: e.category, minimum: e.minimum, achieved, pass: LEVEL_RANK[achieved] >= MINIMUM_RANK[e.minimum], description: e.description }
  })
  return { rows, nodes: graph.nodes.length, edges: graph.edges.length, soundiness: soundiness.length, proposals: proposals.length }
}
