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
