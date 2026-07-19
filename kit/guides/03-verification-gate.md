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

## Watch-outs

- **forbid-mode patterns fail OPEN on a typo.** ast-grep silently matches
  nothing for a malformed pattern, so a `mode: "forbid"` rule with a typo
  never fires and the verdict stays green — it looks like proof of absence
  but proves nothing. Smoke-test each forbid pattern once against a scratch
  file that SHOULD match before trusting it in a contract.
- **ast-grep 0.42 cannot see inside `.vue` SFCs at all**, as invoked here (no
  `--lang`, no `sgconfig.yml`) — it skips `.vue` files entirely while walking
  a directory, even with `--lang typescript` forced on one directly. If the
  workspace has any `.vue` files, `ast-grep` verdict goes red on a
  `forbid`-mode pattern instead of silently trusting a clean 0-match run
  (fail-open would otherwise look like proof of absence). `must`-mode
  patterns still run and fail loud on their own, but get a one-line note
  since an "absent" verdict there could equally be the blind spot. Opt a
  pattern out — when you're certain it only concerns non-`.vue` code — with
  the `[ts-only]` tag: `"pattern[ts-only]: setId($_)"` or
  `"rule[ts-only]: rules/x.yml"`.
- **`verify` reds on pre-existing graph damage, not just this ticket.** The
  verdict drives the workspace's shared next-to-verify worklist, so an
  unrelated unverified/refutable transition elsewhere in the graph can red
  the gate even though your change is correct. Keep the workspace's graph
  healthy (or scope `--verify-limit`/expectations deliberately) rather than
  treating every red `verify` as your ticket's fault.
