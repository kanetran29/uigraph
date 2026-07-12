// Regression lock for the adversarial gauntlet (examples/sample-gauntlet-react):
// every golden expectation must extract at or above its minimum honesty level —
// a silent miss or a dishonest downgrade fails the suite. If a change here
// regresses a case, run `pnpm exec tsx scripts/gauntlet-report.ts` for the table.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gradeGauntlet } from '../../../scripts/gauntlet'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples', 'sample-gauntlet-react')

describe('gauntlet regression (35 common-website patterns)', () => {
  it('extracts every gauntlet case at or above its golden minimum — zero silent misses', () => {
    const grade = gradeGauntlet(appDir)
    const failed = grade.rows.filter((r) => !r.pass)
    expect(failed.map((r) => `${r.id} min=${r.minimum} got=${r.achieved}`)).toEqual([])
    expect(grade.rows).toHaveLength(35)
  })
})
