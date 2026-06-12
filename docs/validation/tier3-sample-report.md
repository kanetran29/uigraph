# Tier-3 runtime verification: sample-react-app

The autonomous Tier-3 explorer drove a real (headless) browser through the running
`sample-react-app` (react-router v6, `http://localhost:5179`) and attempted every
screen→screen edge in the extracted graph, recording each as a runtime
**observation**. Confirmed observations were folded into the served graph as
witnessed `runtime` edges (`source:'runtime'`, `witness.observationId`); refuted
ones produced no edge. This closes the "the observation enters the graph, not the
guess" half of the golden invariant.

## Result

**13 screen→screen edges attempted: 10 confirmed · 2 refuted · 1 blocked.**
All plain `Link`/`navigate` transitions reproduced exactly. The interesting output
is the **discrepancies** — cases where static extraction and runtime disagree
(dossier §7, *Code ≠ Runtime*). These are precisely what a graph built from source
alone gets wrong, and what an agent reading source would likely also get wrong.

## Code ≠ Runtime discrepancies found

1. **`n_dashboard → n_login` (guarded `may`-edge, `!isAuthenticated`) — REFUTED.**
   The static graph predicts a redirect to `/login` when unauthenticated. At
   runtime, direct navigation to `/dashboard` stays on `/dashboard` and renders the
   Dashboard. Cause: `navigate()` is called during render, which is a no-op in
   react-router v6. The guarded redirect does **not** reproduce.

2. **`Review` button → `open:modal` (`must`-edge) — does not reproduce.**
   The static graph says clicking "Review" on Checkout opens the `ConfirmDialog`
   modal. At runtime, "Review" redirects to `/login` (the Checkout `!isAuthenticated`
   guard *does* fire here, via the same during-render `navigate`) and the modal
   never opens.

3. **`n_checkout → n_root` (Cancel `navigate`, `must`-edge) — BLOCKED / unreachable.**
   The Cancel button's trigger lives only inside the `ConfirmDialog` that never
   opens, so the edge is unreachable in the running app as wired.

## Why this matters

The static tier alone would tell an agent "Dashboard redirects to Login" and
"Review opens a modal." Both are wrong at runtime. The Tier-3 pass corrects the
record with witnessed observations, and surfaces the three discrepancies as
findings — the kind a source-reading agent would miss. The honest cost (dossier
red-team #2): this sample needs no auth; on a real app the deeper flows stall at
the login form, which is why runtime truth requires real auth/test-data.
