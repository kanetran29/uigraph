// The provenance line every generator writes at the head of its output.
//
// The title page says every figure is re-measured on the commit named in the generated tables.
// A generator that runs on graphs it did not extract cannot know that commit from the graphs,
// so it records the repository's HEAD when it runs and whether the extractor's sources were
// clean then; the measurement procedure maps the corpus at that same commit before it generates.
import { execSync } from 'node:child_process'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..', '..')

/** `% Extractor <sha>, packages/ clean, harness clean` (or `with uncommitted changes`), for a generated file's header; only code counts, not results. */
export function extractorStamp() {
  const sha = execSync(`git -C ${JSON.stringify(repo)} rev-parse --short HEAD`, { encoding: 'utf8' }).trim()
  const dirty = (dir) => execSync(`git -C ${JSON.stringify(repo)} status --porcelain -- ${dir}`, { encoding: 'utf8' }).split('\n').some((l) => /\.(ts|mts|mjs|js|sh)$/.test(l.trim()))
  return `% Extractor ${sha}, packages/ ${dirty('packages') ? 'with uncommitted changes' : 'clean'}, harness ${dirty('thesis-handoff/route-oracle') ? 'with uncommitted changes' : 'clean'} when generated.`
}
