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
export function writeReport(dir, ctx) {
  const out = join(dir, '.uigraph-gate')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'report.json'), JSON.stringify(ctx, null, 2))
  writeFileSync(join(out, 'report.md'), renderReport(ctx))
}

/** Split an "astGrep" contract string into rule-file vs inline-pattern form. */
export function parseAstGrepSpec(s) {
  const type = s.startsWith('rule: ') ? 'rule' : 'pattern'
  return { type, value: s.slice(type.length + 2) }
}

/** Repo-root-relative changed files that no impactAllow glob covers. */
export function containmentViolations(changed, allow) {
  const regs = allow.map(globToRegExp)
  return changed.filter((f) => !regs.some((r) => r.test(f)))
}

/** Verdict 1: the host's deterministic check command (typecheck+test+lint). */
function stepCheckCmd(repoRoot, checkCmd) {
  const r = sh(checkCmd, { cwd: repoRoot })
  const tail = (r.stdout + r.stderr).split('\n').slice(-15).join('\n')
  return { name: 'check-cmd', status: r.status === 0 ? 'green' : 'red', detail: r.status === 0 ? 'exit 0' : tail }
}

/** Verdict 2: ast-grep must/forbid patterns from the contract. */
function stepAstGrep(dir, patterns) {
  if (!patterns || patterns.length === 0) return { name: 'ast-grep', status: 'green', detail: 'no patterns declared' }
  const failures = []
  for (const p of patterns) {
    const spec = parseAstGrepSpec(p.astGrep)
    const argv = spec.type === 'rule'
      ? ['ast-grep', 'scan', '-r', resolve(dir, spec.value), '--json=compact', dir]
      : ['ast-grep', 'run', '-p', spec.value, '--json=compact', dir]
    const r = sh(argv)
    let matches
    try {
      matches = JSON.parse(r.stdout || '[]')
    } catch {
      throw new GateInfraError(`ast-grep output not JSON for: ${p.astGrep}`)
    }
    if (p.mode === 'must' && matches.length === 0) failures.push(`must-pattern absent: ${p.astGrep}`)
    if (p.mode === 'forbid' && matches.length > 0)
      failures.push(`forbidden pattern present (${matches.length}×): ${p.astGrep} @ ${matches[0].file}`)
  }
  return { name: 'ast-grep', status: failures.length === 0 ? 'green' : 'red', detail: failures.join('; ') || `${patterns.length} pattern(s) ok` }
}

/** Verdict 3: change-surface containment vs impactAllow; codegraph affected list attached as evidence when available. */
function stepImpact(repoRoot, baselineSha, impactAllow) {
  if (!impactAllow || impactAllow.length === 0) return { name: 'impact', status: 'green', detail: 'no impactAllow declared' }
  const tracked = sh(['git', 'diff', '--name-only', baselineSha], { cwd: repoRoot }).stdout.trim()
  const untracked = sh(['git', 'ls-files', '--others', '--exclude-standard'], { cwd: repoRoot }).stdout.trim()
  const changed = [...new Set([...tracked.split('\n'), ...untracked.split('\n')])].filter(Boolean)
  const leaks = containmentViolations(changed, impactAllow)
  let evidence = ''
  try {
    const aff = sh(['codegraph', 'affected', '-p', repoRoot, '-j', ...changed], { cwd: repoRoot })
    if (aff.status === 0) evidence = ` | codegraph affected: ${aff.stdout.trim().slice(0, 200)}`
  } catch {
    evidence = ' | codegraph unavailable (evidence skipped)'
  }
  return {
    name: 'impact',
    status: leaks.length === 0 ? 'green' : 'red',
    detail: (leaks.length === 0 ? `${changed.length} changed file(s) contained` : `leak outside impactAllow: ${leaks.join(', ')}`) + evidence,
  }
}

/** Verdict 4: graph structure matches the approved contract (diff vs pinned baseline). */
async function stepGraphMatch(dir, contract) {
  const map = sh([...UIGRAPH, 'map', dir, '--controls'])
  if (map.status !== 0) throw new GateInfraError(`uigraph map failed:\n${map.stderr || map.stdout}`)
  const baselinePath = join(dir, '.uigraph-gate', 'baseline.json')
  let baseline
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  } catch {
    throw new GateInfraError(`no baseline at ${baselinePath} — run: gate.mjs baseline <dir>`)
  }
  const { graph } = await readWorkspaceGraph(dir)
  if (!graph) throw new GateInfraError('map produced no graph')
  const { diffGraphs } = await import('@ui-graph/core')
  const match = matchContract(contract, diffGraphs(baseline.graph, graph))
  const misses = match.results.filter((r) => r.matched === null).map((r) => `${r.kind}:${JSON.stringify(r.spec)}`)
  const detail = match.pass
    ? `all ${match.results.length} expectation(s) matched; uncovered: ${match.uncovered.nodes.length}n/${match.uncovered.edges.length}e`
    : [misses.length ? `unmatched: ${misses.join(' ')}` : '', match.removalViolations.length ? `removals: ${match.removalViolations.join(',')}` : '']
        .filter(Boolean).join('; ')
  return { name: 'graph-match', status: match.pass ? 'green' : 'red', detail, baselineSha: baseline.sha }
}

/** Verdict 5: uigraph verify drives new/uncertain transitions in a real browser. */
function stepVerify(dir, appUrl, limit) {
  if (!appUrl) throw new GateInfraError('--app-url required for browser verdicts (or pass --no-browser)')
  const r = sh([...UIGRAPH, 'verify', dir, '--app-url', appUrl, '--limit', limit])
  const tail = (r.stdout + r.stderr).split('\n').slice(-10).join('\n')
  return { name: 'verify', status: r.status === 0 ? 'green' : 'red', detail: r.status === 0 ? 'no refuted transitions' : tail }
}

/** Verdict 6: behavioral Playwright specs from the contract; one retry for flake. */
function stepSpecs(dir, behavioral, appUrl) {
  if (!behavioral || behavioral.length === 0) return { name: 'specs', status: 'green', detail: 'no behavioral ACs declared' }
  const specs = behavioral.map((b) => b.spec)
  const run = () => sh(['pnpm', 'exec', 'playwright', 'test', ...specs], { cwd: dir, env: { ...process.env, APP_URL: appUrl } })
  let r = run()
  if (r.status !== 0) r = run()
  const tail = (r.stdout + r.stderr).split('\n').slice(-15).join('\n')
  return { name: 'specs', status: r.status === 0 ? 'green' : 'red', detail: r.status === 0 ? `${specs.length} spec file(s) green` : tail }
}

/** `gate check <dir>`: run all six verdicts fail-fast, write the report, set the exit code. */
async function cmdCheck(dir, values) {
  let contract
  try {
    contract = JSON.parse(readFileSync(resolve(values.contract ?? ''), 'utf8'))
  } catch {
    throw new GateInfraError(`cannot read contract: ${values.contract}`)
  }
  const contractErrors = validateContract(contract)
  if (contractErrors.length > 0) throw new GateInfraError(`invalid contract:\n${contractErrors.join('\n')}`)
  const repoRoot = sh(['git', 'rev-parse', '--show-toplevel'], { cwd: dir }).stdout.trim()
  const verdicts = []
  const ordered = [
    () => stepCheckCmd(repoRoot, values['check-cmd']),
    () => stepAstGrep(dir, contract.code?.patterns),
    async () => {
      const baseline = JSON.parse(readFileSync(join(dir, '.uigraph-gate', 'baseline.json'), 'utf8'))
      return stepImpact(repoRoot, baseline.sha, contract.code?.impactAllow)
    },
    () => stepGraphMatch(dir, contract),
    () => (values['no-browser'] ? { name: 'verify', status: 'skip', detail: '--no-browser' } : stepVerify(dir, values['app-url'], values['verify-limit'])),
    () => (values['no-browser'] ? { name: 'specs', status: 'skip', detail: '--no-browser' } : stepSpecs(dir, contract.behavioral, values['app-url'])),
  ]
  let failed = false
  for (const step of ordered) {
    if (failed) {
      verdicts.push({ name: 'skipped', status: 'skip', detail: 'fail-fast' })
      continue
    }
    const v = await step()
    verdicts.push({ name: v.name, status: v.status, detail: v.detail })
    if (v.status === 'red') failed = true
  }
  const ctx = { ticket: contract.ticket, verdicts }
  writeReport(dir, ctx)
  console.log(renderReport(ctx))
  process.exit(failed ? 1 : 0)
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
