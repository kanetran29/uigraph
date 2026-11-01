#!/usr/bin/env node
// The mutation sweep over the demotion rules, as a script that can be run again.
//
// Each mutant in sweep-mutants.mjs deletes one rule, or one term of a rule, from a scratch copy
// of packages/adapter-angular, and the adapter's whole vitest suite is run against it. A mutant
// is killed when the suite fails and survives when it passes; the thesis claims that no rule can
// be deleted unseen, so sweep-to-latex.mjs refuses a result in which one survives.
//
// The copy is made with rsync into a temporary directory, with the repository's node_modules,
// tsconfig.base.json and packages/core linked beside it, so the repository is never edited and a
// crash cannot leave a mutated file in it. Every mutant is checked to apply exactly once before
// anything runs, and the copy is compared with the repository when the sweep is over.
//
// Usage: node mutation-sweep.mjs [--out <file>] [--only <id,id,...>] [--dry-run]
//   --out      where the result is written; results-must/mutation-sweep.json by default, which a
//              partial run (--only) will not overwrite, so it needs --out
//   --only     run these mutants only; the result is marked partial and sweep-to-latex refuses it
//   --dry-run  check that every mutant applies once, run nothing, write nothing
// A flag that needs a value and is given none is refused: `--only` read as absent ran the whole
// sweep and overwrote the recorded one.
// The sweep describes a commit, so it refuses to run with uncommitted changes under packages/, and
// it records the tree of packages/adapter-angular/src it ran on (srcTree), which sweep-to-latex.mjs
// compares with HEAD's so that a sweep of other rules is not published.
// A full sweep runs the suite once per mutant, about twelve seconds each.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MUTANTS, applyMutant, judge, mutationProblems, sweepRecord, unappliedIds } from './sweep-mutants.mjs'

const REPO = path.resolve(import.meta.dirname, '..', '..')
const PKG = 'packages/adapter-angular'
const SRC = path.join(REPO, PKG, 'src')
const DEFAULT_OUT = path.join(import.meta.dirname, 'results-must', 'mutation-sweep.json')

const argv = process.argv.slice(2)
/**
 * The value following `name` on the command line; undefined if the flag is not given, and an
 * error if it is given with no value after it, which would otherwise read as the flag being absent.
 */
const flag = (name) => {
  const i = argv.indexOf(name)
  if (i === -1) return undefined
  const value = argv[i + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}
const only = flag('--only')?.split(',')
const out = flag('--out') ?? (only ? undefined : DEFAULT_OUT)
const dryRun = argv.includes('--dry-run')

/** Runs git in the repository and returns what it printed. */
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' })

/** Runs the adapter's suite in `cwd` and returns everything it printed. */
function suite(cwd) {
  const r = spawnSync('pnpm', ['-s', 'exec', 'vitest', 'run'], { cwd, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 })
  return r.error?.code === 'ETIMEDOUT' ? 'timed out' : `${r.stdout}\n${r.stderr}`
}

const unknown = (only ?? []).filter((id) => !MUTANTS.some((m) => m.id === id))
if (unknown.length) throw new Error(`no mutant with the id ${unknown.join(', ')}`)
const chosen = only ? MUTANTS.filter((m) => only.includes(m.id)) : MUTANTS
if (!out && !dryRun) throw new Error('a partial run does not overwrite the recorded sweep: give --out')

// The whole list is checked, not only the chosen mutants, so that a stale find string is found
// by the first run after the adapter changed and not by the one that reaches it.
const problems = mutationProblems(MUTANTS, (f) => fs.readFileSync(path.join(SRC, f), 'utf8'))
if (problems.length) {
  const stale = unappliedIds(MUTANTS, (f) => fs.readFileSync(path.join(SRC, f), 'utf8'))
  console.error(`${stale.length} mutant(s) no longer apply to the adapter, ids: ${stale.join(', ')}\n  ${problems.join('\n  ')}`)
  process.exit(2)
}
console.log(`${MUTANTS.length} mutants, each applies exactly once; ${chosen.length} to run`)
if (dryRun) process.exit(0)

if (git('status', '--porcelain', '-uall', '--', 'packages').trim()) {
  console.error('packages/ has uncommitted changes; commit before the sweep, which records the commit it ran at')
  process.exit(2)
}
const commit = git('rev-parse', '--short', 'HEAD').trim()

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-sweep-'))
try {
  const copy = path.join(scratch, PKG)
  fs.mkdirSync(path.dirname(copy), { recursive: true })
  execFileSync('rsync', ['-a', '--exclude', '.vite', '--exclude', 'dist', `${path.join(REPO, PKG)}/`, `${copy}/`])
  // The golden tests read examples/sample-angular-app, three levels above src/.
  fs.mkdirSync(path.join(scratch, 'examples'))
  execFileSync('rsync', ['-a', '--exclude', 'node_modules', `${path.join(REPO, 'examples', 'sample-angular-app')}/`, `${path.join(scratch, 'examples', 'sample-angular-app')}/`])
  // The package's node_modules are links to ../../../node_modules and ../../../core, relative to the copy.
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(scratch, 'node_modules'))
  fs.symlinkSync(path.join(REPO, 'tsconfig.base.json'), path.join(scratch, 'tsconfig.base.json'))
  fs.symlinkSync(path.join(REPO, 'packages', 'core'), path.join(scratch, 'packages', 'core'))

  const base = judge(suite(copy), '')
  const baselineTests = /\((\d+)\)\s*$/.exec(base.result)?.[1]
  if (!/passed/.test(base.result) || /failed/.test(base.result) || !baselineTests) {
    throw new Error(`the unmutated suite does not pass in the copy: ${base.result}`)
  }
  console.log(`baseline: ${base.result}`)

  const mutants = []
  for (const m of chosen) {
    const file = path.join(copy, 'src', m.file)
    const original = fs.readFileSync(path.join(SRC, m.file), 'utf8')
    const mutated = applyMutant(m, original)
    if (mutated === original) throw new Error(`${m.id}: the edit does not change ${m.file}`)
    let verdict
    try {
      fs.writeFileSync(file, mutated)
      verdict = judge(suite(copy), baselineTests)
    } finally {
      fs.writeFileSync(file, original)
    }
    const what = [m.find].flat().map((f, k) => `${JSON.stringify(f.trim())} -> ${JSON.stringify([m.replace].flat()[k].trim())}`).join(' ;; ')
    mutants.push({ id: m.id, rule: m.rule, file: `${PKG}/src/${m.file}`, what, ...verdict })
    console.log(`${m.id.padStart(4)} ${verdict.survived ? 'SURVIVED' : 'killed  '} ${m.rule}  ${verdict.result}`)
  }

  const touched = [...new Set(chosen.map((m) => m.file))]
  for (const f of touched) {
    if (fs.readFileSync(path.join(copy, 'src', f), 'utf8') !== fs.readFileSync(path.join(SRC, f), 'utf8')) throw new Error(`${f} was left mutated in the copy`)
  }
  if (git('status', '--porcelain', '-uall', '--', 'packages').trim()) throw new Error('packages/ changed while the sweep ran')

  const survivors = mutants.filter((m) => m.survived)
  if (out) {
    fs.writeFileSync(out, JSON.stringify(sweepRecord({ commit, baseline: base.result, partial: Boolean(only), mutants }), null, 1) + '\n')
    console.log(`wrote ${out}`)
  }
  if (survivors.length) {
    console.error(`survived: ${survivors.map((m) => `${m.id} (${m.rule})`).join(', ')}`)
    process.exitCode = 1
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
