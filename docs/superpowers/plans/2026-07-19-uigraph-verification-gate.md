# UI-graph Verification Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic gate script (`kit/gate.mjs`) that proves a UI change matches its ticket's acceptance criteria, by matching a pre-approved contract against the uigraph graph diff plus five other machine verdicts.

**Architecture:** Pure matcher functions + a small CLI in one `.mjs` file under `kit/`, registered in the kit manifest. The gate saves a pre-code baseline graph snapshot, then on each check runs six fail-fast verdict layers (check-cmd → ast-grep → impact containment → graph match → uigraph verify → Playwright specs) and writes one aggregated report. Spec: `docs/superpowers/specs/2026-07-19-uigraph-verification-gate-design.md`.

**Tech Stack:** Node ≥22 (`node:sqlite` via `@ui-graph/core/node`, `node:test`, `util.parseArgs`), tsx (in-repo runner, root devDep), ast-grep 0.42 (`/opt/homebrew/bin/ast-grep`), codegraph 0.9.7 (`~/.local/bin/codegraph`, optional evidence), `@playwright/test` (pilot example only).

## Global Constraints

- Deviation from spec §2, locked in here: the gate does **NOT** use `diffSinceLast`. `uigraph map` rotates `graph` → `graph_prev`, so on fix-round 2 `diffSinceLast` would compare round N vs round N−1 instead of vs the pre-code baseline. Instead `baseline` saves the full graph snapshot to `.uigraph-gate/baseline.json` and `check` computes `diffGraphs(baseline.graph, currentGraph)` (both exported from `@ui-graph/core`). Idempotent across rounds.
- Exit codes: `0` GREEN · `1` AC failure · `2` infrastructure error (missing baseline/contract/tool, unreachable app, validator failure). Fail-fast: first red verdict stops the pipeline; later verdicts report `skip`.
- In-repo, `@ui-graph/core` resolves to raw `.ts` (`exports.default: ./src/index.ts`), so the gate MUST be run via `pnpm exec tsx kit/gate.mjs …`. In npm-installed host repos the same import resolves to `dist/` and bare `node` works.
- `uigraph` CLI invocation: env `UIGRAPH_BIN`, default `uigraph`. In-repo: `UIGRAPH_BIN="pnpm -s -C packages/cli run uigraph --"` (split on spaces). Always pass the workspace dir as an absolute path (`path.resolve` at entry).
- No new dependencies anywhere except `@playwright/test` as devDependency of `examples/sample-gauntlet-react` (Task 5). Gate uses stdlib + `@ui-graph/core` only.
- `kit/manifest.json` is the kit registry — files not listed there are invisible to `kit print/install`. `kit/gate.test.mjs` stays OUT of the manifest.
- Comment style (user global): leading doc comment above every new function; no inline trailing comments; body comments only when non-obvious, single line.
- Contract path semantics: `behavioral[].spec` and ast-grep rule files resolve against the workspace dir; `code.impactAllow` globs match repo-root-relative git paths.
- Commits go straight to `main` (solo repo), message style `feat|docs|test: …` lowercase, each ending with the Co-Authored-By line used in this session.

---

### Task 1: Matcher + contract validation (pure logic, TDD)

**Files:**
- Create: `kit/gate.mjs` (pure functions only in this task)
- Test: `kit/gate.test.mjs`

**Interfaces:**
- Produces (used by Tasks 2–3):
  - `validateContract(contract: object) -> string[]` (empty = valid; entries are `"<json-path>: <problem>"`)
  - `matchContract(contract, diff: GraphDiff) -> { pass: boolean, results: {kind, spec, matched: string|null}[], removalViolations: string[], uncovered: {nodes: string[], edges: string[]} }`
  - `itemMatches(spec: object, actual: object) -> boolean` (plain key = exact, `~`-suffixed key = case-insensitive substring, `control` key = nested exact match)
  - `globToRegExp(glob: string) -> RegExp` (supports `**` and `*` only)
- GraphDiff shape consumed (from `@ui-graph/core` `diff.ts:20-27`): `{ addedNodes: GraphNode[], removedNodes: GraphNode[], changedNodes: {id, fields, before, after}[], addedEdges: GraphEdge[], removedEdges: GraphEdge[], changedEdges: … }`

- [ ] **Step 1: Write the failing test**

```js
// kit/gate.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateContract, matchContract, itemMatches, globToRegExp } from './gate.mjs'

const node = (over = {}) => ({
  id: 'c_products_clear_0', route: null, componentPath: 'src/pages/ProductsIndex.tsx',
  label: 'Clear filter', kind: 'control', parent: 'n_products_index',
  control: { element: 'button', controlType: 'button' }, ...over,
})
const emptyDiff = () => ({
  addedNodes: [], removedNodes: [], changedNodes: [], addedEdges: [], removedEdges: [], changedEdges: [],
})

test('itemMatches: exact, substring (~), nested control', () => {
  const spec = { kind: 'control', 'label~': 'clear filter', 'parent~': 'products', control: { controlType: 'button' } }
  assert.equal(itemMatches(spec, node()), true)
  assert.equal(itemMatches(spec, node({ label: 'Reset' })), false)
  assert.equal(itemMatches({ ...spec, control: { controlType: 'input' } }, node()), false)
})

test('matchContract: pass when every expected item matches', () => {
  const contract = { ticket: 'T', requirement: 'r', expect: { addedNodes: [{ 'label~': 'clear' }], forbidRemovals: true } }
  const diff = { ...emptyDiff(), addedNodes: [node()] }
  const res = matchContract(contract, diff)
  assert.equal(res.pass, true)
  assert.equal(res.results[0].matched, 'c_products_clear_0')
})

test('matchContract: fail when an expected node is absent', () => {
  const contract = { ticket: 'T', requirement: 'r', expect: { addedNodes: [{ 'label~': 'clear' }] } }
  const res = matchContract(contract, emptyDiff())
  assert.equal(res.pass, false)
  assert.equal(res.results[0].matched, null)
})

test('matchContract: forbidRemovals flags any removal', () => {
  const contract = { ticket: 'T', requirement: 'r', expect: { forbidRemovals: true } }
  const diff = { ...emptyDiff(), removedNodes: [node({ id: 'n_gone' })] }
  const res = matchContract(contract, diff)
  assert.equal(res.pass, false)
  assert.deepEqual(res.removalViolations, ['n_gone'])
})

test('matchContract: uncovered additions warn, fail only under strict', () => {
  const extra = node({ id: 'c_surprise', label: 'Surprise' })
  const diff = { ...emptyDiff(), addedNodes: [extra] }
  const loose = matchContract({ ticket: 'T', requirement: 'r', expect: {} }, diff)
  assert.equal(loose.pass, true)
  assert.deepEqual(loose.uncovered.nodes, ['c_surprise'])
  const strict = matchContract({ ticket: 'T', requirement: 'r', expect: { strict: true } }, diff)
  assert.equal(strict.pass, false)
})

test('validateContract: catches missing fields and bad pattern mode', () => {
  assert.deepEqual(validateContract({ ticket: 'T', requirement: 'r', expect: {} }), [])
  assert.ok(validateContract({}).some((e) => e.startsWith('ticket')))
  const bad = { ticket: 'T', requirement: 'r', expect: {}, code: { patterns: [{ mode: 'maybe', astGrep: 'pattern: x' }] } }
  assert.ok(validateContract(bad).some((e) => e.includes('mode')))
})

test('globToRegExp: ** crosses slashes, * does not', () => {
  assert.equal(globToRegExp('examples/**').test('examples/a/b.ts'), true)
  assert.equal(globToRegExp('examples/*.ts').test('examples/a/b.ts'), false)
  assert.equal(globToRegExp('examples/*.ts').test('examples/a.ts'), true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test kit/gate.test.mjs`
Expected: FAIL — `Cannot find module … kit/gate.mjs`

- [ ] **Step 3: Write minimal implementation**

```js
// kit/gate.mjs
// UI-graph verification gate: proves a UI change matches its approved AC
// contract. Pure matcher functions here; CLI + pipeline added by later tasks.
// Spec: docs/superpowers/specs/2026-07-19-uigraph-verification-gate-design.md

/** Convert a minimal glob (only ** and *) to an anchored RegExp. */
export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = escaped.replaceAll('**', ' ').replaceAll('*', '[^/]*').replaceAll(' ', '.*')
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test kit/gate.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add kit/gate.mjs kit/gate.test.mjs
git commit -m "feat: verification-gate matcher + contract validation (kit)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Gate CLI — baseline, report writer, exit-code plumbing

**Files:**
- Modify: `kit/gate.mjs` (append CLI section)
- Test: `kit/gate.test.mjs` (append report test)
- Modify: `.gitignore` (add `.uigraph-gate/`)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces (used by Task 3):
  - `sh(cmdline: string|string[], opts?) -> {status: number, stdout: string, stderr: string}`
  - `class GateInfraError extends Error` (thrown by steps → exit 2)
  - `renderReport(ctx: {ticket, verdicts: {name, status: 'green'|'red'|'skip', detail: string}[]}) -> string` (markdown)
  - CLI: `baseline <dir>` writes `<dir>/.uigraph-gate/baseline.json` = `{ sha, mappedAt, graph }`
  - `main()` guarded by `import.meta.url === pathToFileURL(process.argv[1]).href` so importing for tests never executes the CLI.

- [ ] **Step 1: Write the failing test (append to kit/gate.test.mjs)**

```js
import { renderReport } from './gate.mjs'

test('renderReport: one line per verdict with status and PASS/FAIL banner', () => {
  const md = renderReport({
    ticket: 'GAU-1',
    verdicts: [
      { name: 'check-cmd', status: 'green', detail: 'exit 0' },
      { name: 'graph-match', status: 'red', detail: '1 expected node unmatched' },
      { name: 'verify', status: 'skip', detail: 'fail-fast' },
    ],
  })
  assert.ok(md.includes('# Gate report — GAU-1'))
  assert.ok(md.includes('RED'))
  assert.ok(md.includes('graph-match'))
  assert.ok(md.includes('skip'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test kit/gate.test.mjs`
Expected: FAIL — `renderReport` not exported

- [ ] **Step 3: Implement CLI section (append to kit/gate.mjs)**

```js
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
```

`cmdCheck` does not exist yet — add a stub so Task 2 stands alone:

```js
/** Placeholder until Task 3 wires the verdict pipeline. */
async function cmdCheck() {
  throw new GateInfraError('check pipeline not implemented yet (Task 3)')
}
```

- [ ] **Step 4: Run tests + exercise the CLI**

Run: `node --test kit/gate.test.mjs`
Expected: PASS, 8 tests

Run: `UIGRAPH_BIN="pnpm -s -C packages/cli run uigraph --" pnpm exec tsx kit/gate.mjs baseline examples/sample-gauntlet-react`
Expected: `baseline pinned: <N> nodes, <M> edges @ <sha>` and file `examples/sample-gauntlet-react/.uigraph-gate/baseline.json` exists

Run: `pnpm exec tsx kit/gate.mjs check examples/sample-gauntlet-react --contract /tmp/none.json`
Expected: `[gate:infra] check pipeline not implemented yet (Task 3)`, exit code 2 (`echo $?`)

- [ ] **Step 5: Add `.uigraph-gate/` to .gitignore and commit**

Append line `.uigraph-gate/` to the repo root `.gitignore`.

```bash
git add kit/gate.mjs kit/gate.test.mjs .gitignore
git commit -m "feat: gate CLI skeleton — baseline snapshot + report writer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Verdict pipeline (six layers, fail-fast)

**Files:**
- Modify: `kit/gate.mjs` (replace `cmdCheck` stub, add step functions)
- Test: `kit/gate.test.mjs` (append parser/containment tests)

**Interfaces:**
- Consumes: Task 1 matcher, Task 2 `sh`/`GateInfraError`/`writeReport`/`readWorkspaceGraph`/`UIGRAPH`.
- Produces: working `check` command. Step contract: each step returns `{ name, status: 'green'|'red', detail }` or throws `GateInfraError`; helpers `parseAstGrepSpec(s)`, `containmentViolations(changed: string[], allow: string[])` exported for tests.

- [ ] **Step 1: Write the failing tests (append)**

```js
import { parseAstGrepSpec, containmentViolations } from './gate.mjs'

test('parseAstGrepSpec: rule vs pattern prefixes', () => {
  assert.deepEqual(parseAstGrepSpec('rule: rules/x.yml'), { type: 'rule', value: 'rules/x.yml' })
  assert.deepEqual(parseAstGrepSpec('pattern: setId($_)'), { type: 'pattern', value: 'setId($_)' })
})

test('containmentViolations: files outside every allow glob leak', () => {
  const allow = ['examples/sample-gauntlet-react/**']
  assert.deepEqual(containmentViolations(['examples/sample-gauntlet-react/src/a.tsx'], allow), [])
  assert.deepEqual(containmentViolations(['packages/core/src/ir.ts'], allow), ['packages/core/src/ir.ts'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test kit/gate.test.mjs`
Expected: FAIL — `parseAstGrepSpec` not exported

- [ ] **Step 3: Implement the pipeline (replace the `cmdCheck` stub)**

```js
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
```

- [ ] **Step 4: Run tests + a real RED-path smoke**

Run: `node --test kit/gate.test.mjs`
Expected: PASS, 10 tests

Write a throwaway contract `/tmp/gate-smoke.json`:

```json
{
  "ticket": "SMOKE-0",
  "requirement": "smoke: expect a node that cannot exist",
  "expect": { "addedNodes": [{ "label~": "zzz-not-real-zzz" }] }
}
```

Run: `UIGRAPH_BIN="pnpm -s -C packages/cli run uigraph --" pnpm exec tsx kit/gate.mjs check examples/sample-gauntlet-react --contract /tmp/gate-smoke.json --no-browser`
Expected: report prints, `graph-match` is `red` (expected node unmatched), exit code 1. `check-cmd`, `ast-grep`, `impact` green before it; `verify`/`specs` skip.

- [ ] **Step 5: Commit**

```bash
git add kit/gate.mjs kit/gate.test.mjs
git commit -m "feat: gate check pipeline — six fail-fast verdict layers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Kit registration + loop-protocol guide

**Files:**
- Create: `kit/guides/03-verification-gate.md`
- Modify: `kit/manifest.json` (append to `files[]`)

**Interfaces:**
- Consumes: gate CLI from Tasks 2–3.
- Produces: `uigraph kit print` / `kit install` ship the gate; agents get the loop protocol as a kit guide.

- [ ] **Step 1: Write the guide**

```markdown
<!-- kit/guides/03-verification-gate.md -->
# Verification gate — loop protocol

The gate (`gate.mjs`) is the machine verifier that proves a UI change matches
its ticket's acceptance criteria. Six verdict layers, fail-fast:
check-cmd → ast-grep → impact containment → graph-match → verify → specs.
Exit 0 = GREEN, 1 = an AC failed, 2 = infrastructure problem (fix the
environment, do not count it as a failing round).

## Protocol

1. **Baseline before touching code:** `gate.mjs baseline <dir>` (pins the
   pre-code graph + git sha in `<dir>/.uigraph-gate/baseline.json`).
2. **Translate ACs → contract** (`contracts/<ticket>.json`), schema-checked.
   STOP and get human approval of the contract — approval freezes the
   definition of done. You translate; you never grade.
3. **Code loop:** implement → `gate.mjs check <dir> --contract … --app-url …`
   → on exit 1 read `.uigraph-gate/report.md`, fix, repeat. Max 3 rounds;
   identical failing-verdict set 2 rounds in a row → stop early, escalate.
4. **GREEN → report to the human** with `.uigraph-gate/report.md`. Read gate
   results from the report files, never from raw tool logs.

## Contract shape

See the worked example in `contracts/` of the pilot app. Matching semantics:
plain field = exact; `~`-suffixed field = case-insensitive substring;
`control` = nested exact. `forbidRemovals: true` fails on any node removal.
`strict: true` fails on additions the contract does not cover.
`code.impactAllow` globs are repo-root-relative; `behavioral[].spec` and
ast-grep rule files resolve against the workspace dir.
```

- [ ] **Step 2: Register in the manifest**

In `kit/manifest.json`, append to the `files` array (keep existing order, add at the end):

```json
"guides/03-verification-gate.md",
"gate.mjs"
```

- [ ] **Step 3: Verify kit plumbing picks them up**

Run: `pnpm -s -C packages/cli run uigraph -- kit print | grep -c "verification-gate\|gate.mjs"`
Expected: ≥ 2

Run: `pnpm -C packages/mcp test`
Expected: PASS. If a kit test asserts an exact file list, update that assertion to include the two new entries in the same commit.

- [ ] **Step 4: Commit**

```bash
git add kit/guides/03-verification-gate.md kit/manifest.json packages/mcp
git commit -m "feat: register verification gate + loop guide in agent kit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Pilot RED→GREEN on the gauntlet (acceptance test of the workflow)

**Files:**
- Create: `examples/sample-gauntlet-react/contracts/GAU-1.json`
- Create: `examples/sample-gauntlet-react/specs/gau-1.spec.ts`
- Create: `examples/sample-gauntlet-react/playwright.config.ts`
- Modify: `examples/sample-gauntlet-react/package.json` (devDep `@playwright/test`)
- Modify: `examples/sample-gauntlet-react/src/pages/ProductsIndex.tsx` (the "ticket" — only AFTER the RED run)

**Interfaces:**
- Consumes: full gate from Tasks 1–4.
- Produces: proof the workflow works; the committed contract + spec double as the worked example the kit guide references.

- [ ] **Step 1: One-time tool setup**

```bash
codegraph init . && codegraph index .
cd examples/sample-gauntlet-react && pnpm add -D @playwright/test && cd ../..
pnpm install
```

- [ ] **Step 2: Pin the baseline (pre-code)**

Run: `UIGRAPH_BIN="pnpm -s -C packages/cli run uigraph --" pnpm exec tsx kit/gate.mjs baseline examples/sample-gauntlet-react`
Expected: `baseline pinned: …`

- [ ] **Step 3: Write the contract (the "human-approved" definition of done)**

```json
{
  "ticket": "GAU-1",
  "requirement": "ProductsIndex: add a 'Clear filter' button that resets the product id input to empty",
  "expect": {
    "addedNodes": [
      { "kind": "control", "label~": "clear filter", "parent~": "products",
        "control": { "controlType": "button" } }
    ],
    "addedEdges": [],
    "forbidRemovals": true
  },
  "code": {
    "impactAllow": [
      "examples/sample-gauntlet-react/**",
      "kit/**",
      "docs/**",
      ".gitignore",
      "pnpm-lock.yaml"
    ],
    "patterns": [
      { "mode": "must", "astGrep": "pattern: setId('')" },
      { "mode": "forbid", "astGrep": "pattern: dangerouslySetInnerHTML=$_" }
    ]
  },
  "behavioral": [
    { "id": "AC2", "text": "clicking Clear filter empties the product id input",
      "spec": "specs/gau-1.spec.ts" }
  ]
}
```

- [ ] **Step 4: Write the behavioral spec + config**

```ts
// examples/sample-gauntlet-react/specs/gau-1.spec.ts
import { test, expect } from '@playwright/test'

test('AC2: Clear filter empties the product id input', async ({ page }) => {
  await page.goto('/products')
  const input = page.getByLabel('Product id')
  await expect(input).toHaveValue('widget-1')
  await page.getByRole('button', { name: 'Clear filter' }).click()
  await expect(input).toHaveValue('')
})
```

```ts
// examples/sample-gauntlet-react/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './specs',
  use: { baseURL: process.env.APP_URL ?? 'http://localhost:5187' },
})
```

- [ ] **Step 5: RED run (code not written yet — the gate must refuse)**

Run: `UIGRAPH_BIN="pnpm -s -C packages/cli run uigraph --" pnpm exec tsx kit/gate.mjs check examples/sample-gauntlet-react --contract examples/sample-gauntlet-react/contracts/GAU-1.json --no-browser`
Expected: exit 1; report shows `ast-grep` red (must-pattern `setId('')` absent). This is the workflow's own failing-test moment.

- [ ] **Step 6: Implement the ticket**

In `examples/sample-gauntlet-react/src/pages/ProductsIndex.tsx`, directly under the existing "Open product" button (after line with `Open product</button>`), add:

```tsx
      <button onClick={() => setId('')}>Clear filter</button>
```

- [ ] **Step 7: GREEN run (full, browser on)**

Start the app (background): `pnpm --filter @uigraph/sample-gauntlet-react dev` (port 5187, wait for "ready").

Run: `UIGRAPH_BIN="pnpm -s -C packages/cli run uigraph --" pnpm exec tsx kit/gate.mjs check examples/sample-gauntlet-react --contract examples/sample-gauntlet-react/contracts/GAU-1.json --app-url http://localhost:5187`
Expected: exit 0, all six verdicts green; `.uigraph-gate/report.md` shows the matched control node id.

Stop the dev server afterwards.

- [ ] **Step 8: Gauntlet goldens must stay honest**

Run: `pnpm exec tsx scripts/gauntlet-report.ts --strict`
Expected: PASS. If the new control shifts a golden expectation, update `examples/sample-gauntlet-react/EXPECTED.md` + `golden.json` in this same commit (the button is additive — expected impact is zero or one new extraction row, never a removed witness).

Run: `pnpm check`
Expected: `CHECK GREEN`

- [ ] **Step 9: Commit**

```bash
git add examples/sample-gauntlet-react kit docs pnpm-lock.yaml
git commit -m "feat: pilot GAU-1 — Clear filter via verification gate (RED→GREEN)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- Spec coverage: §0 six verdicts → Task 3 steps; §1 contract + semantics → Task 1 + GAU-1 example; §2 script/exit codes → Tasks 2–3 (with the documented `diffGraphs`-vs-`diffSinceLast` deviation); §3 protocol → Task 4 guide; §4 error handling → `GateInfraError` paths; §5 testing → node:test suite + Task 5 pilot; §6 unchanged.
- The spec's "codegraph affected + impact" verdict is implemented as deterministic git+glob containment with `codegraph affected -j` attached as evidence; `codegraph impact <symbol>` is not called (symbol derivation is nondeterministic glue — containment already gates the same property). Affected-tests-must-pass is subsumed by verdict 1 (`pnpm check` runs the full suite).
- Type consistency: `matchContract` return `{pass, results, removalViolations, uncovered}` used identically in Task 1 tests and Task 3 `stepGraphMatch`; `sh` returns `{status, stdout, stderr}` everywhere; baseline file `{sha, mappedAt, graph}` written in Task 2, read in Task 3.
