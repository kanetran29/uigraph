---
name: uigraph-gate
description: Use when implementing any feature/bugfix ticket in a repo with the uigraph gate installed (.uigraph/kit/gate.mjs), or when the user says "gate" or gives acceptance criteria for a UI change — runs the verification-gate protocol (contract → RED → implement → GREEN) so done is machine-proven, never claimed.
---

# uigraph verification gate

The gate (`.uigraph/kit/gate.mjs`) is the machine verifier that proves a UI
change matches its ticket's acceptance criteria. Six verdict layers, fail-fast:
check-cmd → ast-grep → impact containment → graph-match → verify → specs.

## Invocation

```bash
node .uigraph/kit/gate.mjs baseline <app-dir>
node .uigraph/kit/gate.mjs check <app-dir> --contract <contract.json> \
  [--no-browser | --app-url http://localhost:PORT]
```

Prerequisites: Node >=22, `uigraph` on PATH (or set `UIGRAPH_BIN`), `ast-grep`
on PATH, `@playwright/test` as a devDependency for the behavioral layer
(structure layers run without it). `--check-cmd "<cmd>"` overrides verdict 1
(default `pnpm check`).

Exit: `0` GREEN · `1` an AC failed (read `<app-dir>/.uigraph-gate/report.md`)
· `2` infrastructure problem — fix the environment; does NOT count as a
failing round.

## Protocol

1. **Baseline before touching code:** `gate.mjs baseline <app-dir>` (pins the
   pre-code graph + git sha), once per ticket.
2. **Translate the ACs → a contract** (`contracts/<ticket>.json`). Smoke-test
   every ast-grep pattern against a should-match scratch fixture first
   (forbid-mode fails open on a typo). STOP and get the human's approval of
   the contract — approval freezes the definition of done. You translate;
   you never grade.
3. **Code loop:** implement → `check` → on exit 1 read the report and fix.
   Max 3 rounds; the same failing-verdict set 2 rounds in a row → stop early,
   escalate. Use `--no-browser` for fast mid-loop runs; the final proving run
   MUST use `--app-url` with the dev server up.
4. **GREEN → report to the human** with the report file. Never claim a
   feature done on a red or skipped browser verdict.

## Watch-outs

- **forbid-mode patterns fail OPEN on a typo.** ast-grep silently matches
  nothing for a malformed pattern, so a `mode: "forbid"` rule with a typo
  never fires and the verdict stays green. Smoke-test each forbid pattern
  once against a scratch file that SHOULD match before trusting it.
- **ast-grep cannot see inside `.vue` SFCs.** It skips `.vue` files while
  walking a directory, so a `forbid`-mode pattern goes red instead of
  silently trusting a clean 0-match run when the workspace has `.vue` files.
  Opt a pattern out — only when certain it concerns non-`.vue` code — with
  the `[ts-only]` tag: `"pattern[ts-only]: setId($_)"`.
- **`verify` reds on pre-existing graph damage, not just this ticket.** An
  unrelated unverified/refutable transition elsewhere in the graph can red
  the gate even though your change is correct. Keep the workspace's graph
  healthy rather than treating every red `verify` as your ticket's fault.
