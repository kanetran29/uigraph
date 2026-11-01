// The provenance line every generator writes at the head of its output.
//
// The title page says every figure is re-measured on the commit named in the generated tables.
// A generator that runs on graphs it did not extract cannot know that commit from the graphs,
// so it records the repository's HEAD when it runs and whether the extractor's sources were
// clean then; the measurement procedure maps the corpus at that same commit before it generates.
import { execSync } from 'node:child_process'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..', '..')

/**
 * The data files and directories under thesis-handoff/route-oracle that a generator reads and
 * that are committed by hand rather than produced by a run: the recorded reading of the must
 * tier, the review of the ledger, the mutation sweep, the ground truth, the corpus manifest, and
 * the graphs of the earlier round. An edit to one changes a generated table as surely as an edit
 * to a script, and none of them ends in a code extension.
 */
const INPUTS = ['results-must/tier-reading.json', 'results-must/review.json', 'results-must/mutation-sweep.json',
  'ground-truth', 'corpus.json', 'round-two-graphs']
const HARNESS = 'thesis-handoff/route-oracle'

/**
 * `% Extractor <sha>, packages/ clean, harness clean` (or `with uncommitted changes`), for a
 * generated file's header. Code counts, and so do the data files a generator reads (INPUTS);
 * generated results do not. `root` is the repository to ask, the one this file sits in by default.
 */
export function extractorStamp(root = repo) {
  const git = (args) => execSync(`git -C ${JSON.stringify(root)} ${args}`, { encoding: 'utf8' })
  const sha = git('rev-parse --short HEAD').trim()
  // `-uall` lists the files of an untracked directory, not the directory, so a new script in one is seen.
  const status = (...paths) => git(`status --porcelain -uall -- ${paths.join(' ')}`).split('\n').map((l) => l.trim()).filter(Boolean)
  const code = (lines) => lines.some((l) => /\.(ts|mts|mjs|js|sh)$/.test(l))
  const packagesDirty = code(status('packages'))
  const harnessDirty = code(status(HARNESS)) || status(...INPUTS.map((p) => `${HARNESS}/${p}`)).length > 0
  return `% Extractor ${sha}, packages/ ${packagesDirty ? 'with uncommitted changes' : 'clean'}, harness ${harnessDirty ? 'with uncommitted changes' : 'clean'} when generated.`
}
