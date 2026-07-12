// Gauntlet gap report CLI: extract the adversarial sample app and print the
// per-expectation grade table. The ONLY failure is a silent miss (or a
// dishonest downgrade below the golden minimum). Run:
//   pnpm exec tsx scripts/gauntlet-report.ts [--strict]
// The grading logic lives in scripts/gauntlet.ts, shared with the
// adapter-react regression test.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { gradeGauntlet } from './gauntlet'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..', 'examples', 'sample-gauntlet-react')

const grade = gradeGauntlet(appDir)
const width = Math.max(...grade.rows.map((r) => r.category.length))
console.log(`gauntlet: ${grade.nodes} nodes, ${grade.edges} edges, ${grade.soundiness} soundiness notes, ${grade.proposals} proposals\n`)
for (const r of grade.rows) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(5)} ${r.category.padEnd(width)}  min=${r.minimum.padEnd(6)} got=${r.achieved.padEnd(12)} ${r.description}`)
}
const failed = grade.rows.filter((r) => !r.pass)
console.log(`\n${grade.rows.length - failed.length}/${grade.rows.length} pass · ${failed.length} FAIL (silent misses / dishonest downgrades)`)
if (failed.length > 0 && process.argv.includes('--strict')) process.exit(1)
