// UI-graph verification gate: proves a UI change matches its approved AC
// contract. Pure matcher functions here; CLI + pipeline added by later tasks.
// Spec: docs/superpowers/specs/2026-07-19-uigraph-verification-gate-design.md

/** Convert a minimal glob (only ** and *) to an anchored RegExp. */
export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&')
  const body = escaped.replace(/\*\*/g, '\x00').replace(/\*/g, '[^/]*').replace(/\x00/g, '.*')
  return new RegExp(`^${body}$`)
}

/** Match one spec field against an actual value: `~`-suffix = case-insensitive substring, else strict equality. */
export function fieldMatches(spec, key, actual) {
  if (key.endsWith('~')) {
    const v = actual[key.slice(0, -1)]
    return typeof v === 'string' && v.toLowerCase().includes(String(spec).toLowerCase())
  }
  return actual[key] === spec
}

/** True when every field of `spec` matches `actual`; `control` nests exact field matches. */
export function itemMatches(spec, actual) {
  for (const [key, want] of Object.entries(spec)) {
    if (key === 'control') {
      if (typeof actual.control !== 'object' || actual.control === null) return false
      for (const [ck, cv] of Object.entries(want)) if (actual.control[ck] !== cv) return false
      continue
    }
    if (!fieldMatches(want, key, actual)) return false
  }
  return true
}

/** Structural check of a contract object; returns "<path>: <problem>" strings, empty when valid. */
export function validateContract(contract) {
  const errors = []
  if (typeof contract?.ticket !== 'string' || contract.ticket === '') errors.push('ticket: required non-empty string')
  if (typeof contract?.requirement !== 'string' || contract.requirement === '') errors.push('requirement: required non-empty string')
  if (typeof contract?.expect !== 'object' || contract.expect === null) errors.push('expect: required object')
  for (const k of ['addedNodes', 'addedEdges', 'changedNodes']) {
    const v = contract?.expect?.[k]
    if (v !== undefined && !Array.isArray(v)) errors.push(`expect.${k}: must be an array`)
  }
  const patterns = contract?.code?.patterns
  if (patterns !== undefined) {
    if (!Array.isArray(patterns)) errors.push('code.patterns: must be an array')
    else patterns.forEach((p, i) => {
      if (p.mode !== 'must' && p.mode !== 'forbid') errors.push(`code.patterns[${i}].mode: must be "must" or "forbid"`)
      if (typeof p.astGrep !== 'string' || !/^(rule|pattern): /.test(p.astGrep))
        errors.push(`code.patterns[${i}].astGrep: must start with "rule: " or "pattern: "`)
    })
  }
  const impactAllow = contract?.code?.impactAllow
  if (impactAllow !== undefined && !Array.isArray(impactAllow)) errors.push('code.impactAllow: must be an array')
  const behavioral = contract?.behavioral
  if (behavioral !== undefined) {
    if (!Array.isArray(behavioral)) errors.push('behavioral: must be an array')
    else behavioral.forEach((b, i) => {
      for (const f of ['id', 'text', 'spec'])
        if (typeof b?.[f] !== 'string') errors.push(`behavioral[${i}].${f}: required string`)
    })
  }
  return errors
}

/** Match an approved contract against a GraphDiff; the machine verdict for the structure layer. */
export function matchContract(contract, diff) {
  const expect = contract.expect ?? {}
  const results = []
  const claimedNodes = new Set()
  const claimedEdges = new Set()
  for (const spec of expect.addedNodes ?? []) {
    const hit = diff.addedNodes.find((n) => itemMatches(spec, n)) ?? null
    if (hit) claimedNodes.add(hit.id)
    results.push({ kind: 'addedNodes', spec, matched: hit ? hit.id : null })
  }
  for (const spec of expect.addedEdges ?? []) {
    const hit = diff.addedEdges.find((e) => itemMatches(spec, e)) ?? null
    if (hit) claimedEdges.add(hit.id)
    results.push({ kind: 'addedEdges', spec, matched: hit ? hit.id : null })
  }
  for (const spec of expect.changedNodes ?? []) {
    const hit = diff.changedNodes.find((ch) => itemMatches(spec, ch.after)) ?? null
    if (hit) claimedNodes.add(hit.id)
    results.push({ kind: 'changedNodes', spec, matched: hit ? hit.id : null })
  }
  const removalViolations = expect.forbidRemovals === true ? diff.removedNodes.map((n) => n.id) : []
  const uncovered = {
    nodes: diff.addedNodes.filter((n) => !claimedNodes.has(n.id)).map((n) => n.id),
    edges: diff.addedEdges.filter((e) => !claimedEdges.has(e.id)).map((e) => e.id),
  }
  const unmatched = results.some((r) => r.matched === null)
  const strictFail = expect.strict === true && (uncovered.nodes.length > 0 || uncovered.edges.length > 0)
  return { pass: !unmatched && removalViolations.length === 0 && !strictFail, results, removalViolations, uncovered }
}

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

/** Raised for environment problems (missing tool/baseline/app) — mapped to exit 2, never exit 1. */
export class GateInfraError extends Error {}

/** Run a command (string split on spaces, or argv array); never throws, returns status+output. */
export function sh(cmdline, opts = {}) {
  const argv = Array.isArray(cmdline) ? cmdline : cmdline.split(' ')
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', ...opts })
  if (r.error && r.error.code === 'ENOENT') throw new GateInfraError(`command not found: ${argv[0]}`)
  return { status: r.status ?? 2, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const UIGRAPH = (process.env.UIGRAPH_BIN ?? 'uigraph').split(' ')

/** Read base graph + mappedAt from a workspace's uigraph.db via @ui-graph/core/node. */
async function readWorkspaceGraph(dir) {
  const { openStore } = await import('@ui-graph/core/node')
  const store = openStore(join(dir, 'uigraph.db'))
  try {
    return { graph: store.getBaseGraph(), mappedAt: store.getFingerprint()?.mappedAt ?? null }
  } finally {
    store.close()
  }
}

/** `gate baseline <dir>`: map now, snapshot graph + git sha as the pre-code reference. */
async function cmdBaseline(dir) {
  const map = sh([...UIGRAPH, 'map', dir, '--controls'])
  if (map.status !== 0) throw new GateInfraError(`uigraph map failed:\n${map.stderr || map.stdout}`)
  const { graph, mappedAt } = await readWorkspaceGraph(dir)
  if (!graph) throw new GateInfraError('map produced no graph')
  const sha = sh(['git', 'rev-parse', 'HEAD']).stdout.trim()
  const out = join(dir, '.uigraph-gate')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'baseline.json'), JSON.stringify({ sha, mappedAt, graph }, null, 2))
  console.log(`baseline pinned: ${graph.nodes.length} nodes, ${graph.edges.length} edges @ ${sha.slice(0, 7)}`)
}

/** Render the aggregated gate report as markdown. */
export function renderReport(ctx) {
  const overall = ctx.verdicts.some((v) => v.status === 'red') ? 'RED' : 'GREEN'
  const lines = [`# Gate report — ${ctx.ticket}`, '', `**Overall: ${overall}**`, '']
  for (const v of ctx.verdicts) lines.push(`- [${v.status}] **${v.name}** — ${v.detail}`)
  return lines.join('\n') + '\n'
}

/** Write report.md + report.json into <dir>/.uigraph-gate/. */
function writeReport(dir, ctx) {
  const out = join(dir, '.uigraph-gate')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'report.json'), JSON.stringify(ctx, null, 2))
  writeFileSync(join(out, 'report.md'), renderReport(ctx))
}

/** Placeholder until Task 3 wires the verdict pipeline. */
async function cmdCheck() {
  throw new GateInfraError('check pipeline not implemented yet (Task 3)')
}

/** CLI entry: `baseline <dir>` | `check <dir> --contract <file> [--app-url u] [--check-cmd c] [--no-browser] [--max-rounds n]`. */
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      contract: { type: 'string' },
      'app-url': { type: 'string' },
      'check-cmd': { type: 'string', default: 'pnpm check' },
      'no-browser': { type: 'boolean', default: false },
      'max-rounds': { type: 'string', default: '3' },
      'verify-limit': { type: 'string', default: '10' },
    },
  })
  const [cmd, dirArg] = positionals
  if (!cmd || !dirArg) {
    console.error('usage: gate.mjs baseline <dir> | gate.mjs check <dir> --contract <file> [...]')
    process.exit(2)
  }
  const dir = resolve(dirArg)
  try {
    if (cmd === 'baseline') await cmdBaseline(dir)
    else if (cmd === 'check') await cmdCheck(dir, values)
    else throw new GateInfraError(`unknown command: ${cmd}`)
  } catch (err) {
    if (err instanceof GateInfraError) {
      console.error(`[gate:infra] ${err.message}`)
      process.exit(2)
    }
    throw err
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
