# UI-graph Verification Gate — Design

Date: 2026-07-19
Status: approved (brainstorm complete)
Pilot target: `examples/sample-gauntlet-react`

## Problem

A coding loop needs a machine verifier that proves a UI change matches its
requirement — not just that the code compiles. `scripts/check.mjs` proves
typecheck/test/lint; nothing proves "the ticket's acceptance criteria are met."
The graph knows what changed; it does not know what was *supposed* to change.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Where does it live | Agent kit (workflow + script), no product code; promote to `uigraph assert` CLI only after the pattern proves out |
| How ACs are authored | Natural-language ACs in the ticket; the agent translates them into a contract JSON *before* coding; the human approves the contract (approval = definition of done) |
| Verification depth | Structure (graph contract) + behavior (Playwright specs); layout/visual regression deferred to phase 2 |
| Pilot app | `sample-gauntlet-react` (richest graph, existing golden harness) |
| Approach | A — deterministic gate script + skill. B (LLM self-judging via MCP only) rejected: grader grades its own homework. C (contract-as-proposals) rejected: proposals cannot reference nodes that do not exist yet (`validateProposals` refuses dangling refs) |

## §0 Tool roles — context vs verdict

Principle (same as the engine's witness rule): **only deterministic tools vote
on the verdict; LLM-semantic tools may help produce the artifacts that get
checked, never grade them.**

| Tool | Tier | Role |
|---|---|---|
| codegraph `context`/`query` | Context (no vote) | Agent understands the code before translating the contract / writing code |
| understand-anything | Context (no vote) | Knowledge graph for onboarding; LLM-semantic → banned from verdict |
| RTK | Execution wrapper | Token economy when the *agent* reads output (PreToolUse hook already rewrites); irrelevant inside gate.mjs — its output goes to files, not model context |
| `scripts/check.mjs` (tsc+vitest+eslint) | **Verdict 1** | Existing foundation |
| ast-grep | **Verdict 2** | Code-shape assertions: per-ticket must/forbid patterns + repo-wide rules |
| codegraph `affected` + `impact` | **Verdict 3** | Change-surface containment: change must stay inside the contract's allowed scope; affected tests must pass |
| uigraph map → diff → contract match | **Verdict 4** | Structure matches contract |
| uigraph verify (Playwright) | **Verdict 5** | New/changed transitions witnessed in a real browser |
| Playwright behavioral specs | **Verdict 6** | Content/behavior ACs |

GREEN = all six verdicts green. Fail-fast cheap → expensive. Every finding
carries a machine witness: file:line, ast-grep match, impact list, observation
id, or spec result.

## §1 Contract format — `contracts/<ticket>.json`

```jsonc
{
  "ticket": "GAU-1",
  "requirement": "verbatim AC text as the human wrote it",
  "expect": {
    "addedNodes": [
      { "kind": "control", "label~": "Clear filter", "parent~": "inventory",
        "control": { "controlType": "button" } }
    ],
    "addedEdges": [
      { "from~": "inventory", "event": "click", "effect~": "state:clearFilter" }
    ],
    "changedNodes": [],
    "forbidRemovals": true,
    "strict": false
  },
  "code": {
    "impactAllow": ["examples/sample-gauntlet-react/src/**"],
    "patterns": [
      { "mode": "must",   "astGrep": "rule: new-button-uses-design-system.yml" },
      { "mode": "forbid", "astGrep": "pattern: dangerouslySetInnerHTML=$_" }
    ]
  },
  "behavioral": [
    { "id": "AC2", "text": "typing 'button' filters the table to matching rows",
      "spec": "specs/gau-1.spec.ts" }
  ]
}
```

Matching semantics: plain field = exact match; `~` suffix = substring
(labels/ids/effects churn in detail). The matcher checks three things:

1. every `expect` item has ≥1 match in the actual `SinceLastDiff`;
2. `forbidRemovals` → no node removals beyond those declared;
3. diff entries not covered by the contract are listed as "uncovered" in the
   report — fail when `"strict": true`, warn otherwise.

All relative paths in a contract (`spec`, ast-grep rule files) resolve against
the workspace `<dir>` passed to the gate, not the contract file's location.

The contract is schema-checked both when the agent generates it and when the
gate runs.

## §2 Gate script — `kit/gate.mjs`

Imports `diffSinceLast` + the store from `@ui-graph/core` — never reimplements
diff logic. `.mjs` because kit files are copied loose into host repos (no
accompanying package.json, so `.js` would inherit the host's module type) and
must run on bare Node with zero toolchain.

```
node kit/gate.mjs baseline <dir>    # map to pin the pre-code baseline
node kit/gate.mjs check <dir> --contract contracts/GAU-1.json --app-url http://...
```

`check` pipeline, in order:

```
check.mjs → ast-grep scan → codegraph sync + affected(git-changed) + impact containment
          → uigraph map → diffSinceLast → contract match
          → uigraph verify (worklist prioritizes new edges, --max-rounds 3)
          → behavioral specs (@playwright/test in host repo; structure layers run without it)
          → aggregate: uigraph-gate-report.md + .json, exit code
```

Exit codes: `0` GREEN · `1` AC failure · `2` infrastructure error (no
baseline / app-url unreachable / extraction or validator failure / malformed
contract). The loop's circuit breaker counts only exit 1.

needs-verify at implementation time (do not guess):
- exact `codegraph affected`/`impact` flags and output format;
- how `uigraph kit install` registers extra files (gate.mjs + skill);
- whether `uigraph verify` can be scoped to a set of edge ids or only via
  worklist ordering + `--limit`.

## §3 Loop protocol — `kit/skills/uigraph-gate/SKILL.md`

1. Baseline map before touching code.
2. Agent translates ACs → contract, schema-checks it, **stops for human
   approval of the contract** (approval = definition of done frozen).
3. Code loop: implement → `gate check` → on RED fix from the report → repeat,
   max 3 rounds; identical failing-AC set 2 rounds in a row → stop early and
   escalate.
4. GREEN → report to the human. Hard role split: the LLM only *translates* ACs
   and *writes* assertions; all *grading* is machine (matcher / verify / spec
   runner).
5. Agent reads gate results from the report files, never raw tool logs (RTK
   keeps what does enter context lean).

## §4 Error handling

- Malformed contract → exit 2 with the failing JSON path.
- `diffSinceLast` returns `no-prior` → exit 2, message says run `baseline`.
- App URL unreachable → exit 2 (infra, not AC failure).
- Playwright flake: verify retries via its own round mechanism; behavioral
  specs retry once.
- Core validator rejects a graph → exit 2 with the validator's own message.

## §5 Testing the gate

- Matcher = pure function inside gate.mjs; unit-tested with Node's built-in
  `node:test` (`kit/gate.test.mjs`) — kit is not a workspace package, so no
  vitest wiring.
- E2E self-check: one synthetic ticket on the gauntlet ("add a Clear filter
  button to the inventory screen") — the gate must be RED before the code
  change and GREEN after. That run is the acceptance test of the whole
  workflow.

## §6 Out of scope (YAGNI) & roadmap

Not now:
- Layout sweep + visual regression (phase 2; candidates: Lost Pixel or Argos
  as a deterministic Verdict 7).
- Stagehand action-cache as an exploration→spec source: LLM authors a flow
  once, cache-hit replays are deterministic and could be promoted into specs
  (phase 2).
- `uigraph assert` CLI-ification — only after the kit pattern proves out.
- CI wiring beyond exit codes.
- Contract editor UI (studio territory).
