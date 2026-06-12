# The uigraph Incremental Development Cycle

This is the single methodology every feature in uigraph follows — no exceptions. It is deliberately small, strict, and repeatable: one feature at a time, design before code, tests before implementation, a green gate before "done". Each numbered step below is a phase of one per-feature loop. When step 7 completes you return to step 0 and pick the next feature.

The two rules that bracket this whole document are non-negotiable: **abstract-first** (you write and reconcile the feature's contract and module boundary before any low-level design or code) and **doc-comments** (every new function/type/class gets a leading doc-comment; no inline trailing comments). A feature that skips either is not done, regardless of whether tests pass.

## 0. PICK

Take the next feature from `docs/roadmap.md` whose `dependsOn` entries are all marked `done`. Never start a feature with an unmet dependency — adapters depend on `core`, the CLI and MCP server depend on the adapters, and skipping that order produces interfaces that churn. If several features are eligible, prefer the one that unblocks the most downstream features. Work exactly one feature at a time through to step 7.

## 1. THINK / ABSTRACT

Re-read the feature's design doc at `docs/features/<id>-<slug>.md`. In your own words, restate the **contract** (inputs, outputs, invariants, error behavior) and the **module boundary**: what this module exposes to the rest of the workspace and what it is allowed to depend on. Do this *before* writing any code or low-level types. If your understanding shifted during this re-read, stop and update the doc's abstract section first — the doc is the source of truth, so reconcile it before proceeding.

## 2. LOW-LEVEL DESIGN

Extend the **same** feature doc with the concrete design: TypeScript types and exact function signatures, the file layout under the owning package (`packages/core`, `packages/adapter-*`, `packages/cli`, or `packages/mcp`), and an explicit **numbered test list**. Still write no implementation — only interfaces and the test plan. Abstract-before-low-level is mandatory: if step 1 is incomplete or out of date, you may not be here. The numbered test list from this step is the literal input to step 3.

## 3. TESTS FIRST (TDD)

Write the tests directly from the numbered test list, one test per item, before any implementation exists. Run them with `vitest` and confirm they **fail for the right reason** (red) — a missing export or unimplemented function, not a typo or a misconfigured suite. Reference the `test-driven-development` skill for the red→green→refactor discipline. Do not write or stub implementation code to make a test pass yet.

## 4. IMPLEMENT

Write the **minimal** code that makes the failing tests pass (green) — nothing speculative, no params or abstractions for hypothetical futures (YAGNI). Match the surrounding style of the package you are editing. Every new function, type, and class gets a leading doc-comment stating what it does and why; do not add inline trailing comments, and add an in-body comment only for a genuinely non-obvious step. Re-run the feature's tests until they pass before moving on.

## 5. SELF-HEAL

Run the check gate: `node scripts/check.mjs`, which runs across the whole workspace (a) `tsc --noEmit` via `pnpm -r run typecheck`, then (b) `vitest run` via `pnpm -r run test`, then (c) `eslint .`. The gate always runs all three steps so you see the full picture, then prints `CHECK GREEN` or `CHECK RED: <failed steps>`. Fix every signaled error, re-running the gate after each fix, for a **maximum of 3 heal iterations**; if it is still red after the third, **STOP and escalate** with the remaining error rather than continuing. Never claim a feature done on a red gate or a skipped/short-circuited one — this mirrors the self-healing-refapp pattern.

## 6. SELF-CHECK

Verify the feature doc's acceptance criteria are *literally* met, item by item — not approximately. Run the feature's golden fixtures and confirm that no sibling feature regressed by re-running the whole suite to green. Reference `verification-before-completion`: produce the evidence (gate output, fixture diffs, suite result) before asserting completion, never the reverse. Record any **soundiness caveats** — declared, intentionally-unresolved dynamic cases (e.g. computed-key or runtime-constructed routes) — in the feature doc so the limitation is documented rather than silently shipped.

## 7. COMMIT

Make a conventional commit: `feat(scope): ...` (or `fix`/`refactor`/`test`/`docs` as appropriate), where `scope` is the owning package (`core`, `adapter-react`, `cli`, etc.). End the commit message with the Co-Authored-By line below. Then flip this feature's status in `docs/roadmap.md` to `done` so its dependents become eligible, and loop back to step 0 for the next feature.

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## (A) Definition of Done

A feature is done only when all of the following hold:

- [ ] Feature doc's abstract (contract + module boundary) is current and was written before code.
- [ ] Feature doc contains the low-level design: types, signatures, file layout, numbered test list.
- [ ] Tests exist for every numbered item and were observed to fail before implementation (TDD).
- [ ] Implementation is minimal and matches surrounding style.
- [ ] Every new function/type/class has a leading doc-comment; no inline trailing comments.
- [ ] `node scripts/check.mjs` prints `CHECK GREEN` (typecheck + tests + lint, whole workspace).
- [ ] All acceptance criteria are literally met; golden fixtures pass; full suite green (no sibling regression).
- [ ] Any soundiness caveats are documented in the feature doc.
- [ ] Conventional commit made with the Co-Authored-By line; `docs/roadmap.md` status flipped to `done`.

## (B) Check-Gate Contract

The gate is itself a **foundation feature** (`scripts/check.mjs`) and is held to this same loop. Its contract:

- Runs three steps across the workspace in order: `typecheck`, `test`, `lint`.
- Always runs **all** steps regardless of earlier failures, so the full picture is visible in one run.
- Exits **non-zero** if any step failed, exits `0` only if all passed.
- Prints a compact summary line: `CHECK GREEN` on success, or `CHECK RED: <comma-separated failed steps>` on failure.

Because the gate is the completion signal for every feature, a change that breaks it blocks the entire pipeline and must be healed first.

## (C) Workflows and Adapter Validation

The Workflow tool drives **multi-feature batches** — it sequences and parallelizes work across several roadmap features — but it does not relax the loop: **each feature still passes the full steps 0–7 independently**, including its own red→green tests and its own green gate. A batch is not done until every feature in it is individually done. Adapters (`adapter-react`, `adapter-angular`) are additionally validated against the **sample-app golden graphs** per the validation-ladder doc: each adapter must reproduce the expected UI graph for the sample app, and any divergence is a failed acceptance criterion, not a soundiness caveat.

## (D) Non-Negotiables

These two rules override convenience and are never waived:

1. **Doc-comments.** Every new function, type, and class carries a leading doc-comment (what + why). No inline trailing comments; in-body comments only for a genuinely non-obvious step, on their own line.
2. **Abstract-first.** The contract and module boundary (step 1) are written and reconciled in the feature doc *before* the low-level design (step 2), which is written *before* any tests or implementation. You may not skip ahead, and a shifted understanding means you update the doc before writing more code.
