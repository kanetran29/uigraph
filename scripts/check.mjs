#!/usr/bin/env node
// The self-healing check gate (dossier dev-cycle step 5). Runs typecheck, tests,
// and lint across the workspace, always running every step so the full picture
// is visible, then exits non-zero if any step failed. The dev cycle heals
// against this gate (max 3 iterations) and never claims a feature done on red.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const steps = [
  ['typecheck', 'pnpm', ['-r', '--if-present', 'run', 'typecheck']],
  ['test', 'pnpm', ['-r', '--if-present', 'run', 'test']],
  ['lint', 'pnpm', ['exec', 'eslint', '.']],
]

const failed = []
for (const [name, cmd, args] of steps) {
  console.log(`\n─── ${name} ───`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: false })
  if (r.status !== 0) failed.push(name)
}

console.log('\n' + '='.repeat(40))
if (failed.length > 0) {
  console.error(`CHECK RED: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('CHECK GREEN')
process.exit(0)
