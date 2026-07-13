# Tier-3 runtime verification

The confirm path — how an uncertain transition becomes a witnessed `runtime` edge.

## The cycle

1. **next_to_verify** → the ranked worklist (`unknown` > `may` > proposal).
2. For each target, **plan_path**(from, to) then **gen_spec**(from, to, baseUrl) to
   get the per-leg actions, OR drive the app directly with Playwright.
3. Drive the running app and observe the outcome.
4. **report_observation** `{from, to, event, outcome, evidence, reportedBy, proposalId?}`:
   - `confirmed` REQUIRES proof — pass what you actually saw as `evidence`
     (`url-change` with the real start/landed URLs, `url-assert`, `dialog`, or a
     `screenshot` path that exists) and `reportedBy:'agent'`. A confirmation
     without valid proof is REJECTED (`{error}`) and records nothing: never
     report confirmed unless you drove the transition and watched it happen.
   - an accepted `confirmed` → the core folds a `runtime` edge into the graph
     (guarded edges keep their guard AND modality — one run proves existence,
     not unconditionality) AND reconciles the linked proposal to `confirmed`.
   - `refuted` → no proof needed; no edge is added; a linked proposal reconciles
     to `rejected`.
   - after a re-map, previously-witnessed edges become `witnessStale` (tier drops
     to `asserted`) and re-enter next_to_verify — re-confirm them.

## Running it via the CLI

```
uigraph verify <dir> --app-url http://localhost:3000 --limit 12
```

drives the worklist with a Playwright driver and records observations for you. It
appends observations out-of-band, so follow with **reconcile_proposals** (or just
read `get_loop_status`, which reflects the fold).

## Authenticated runs

Most real apps gate routes behind login. Capture the session once with the
built-in manual-login flow — a headed browser opens, the USER logs in like a
human (password, OAuth, SSO, MFA all work), Enter saves it:

```
uigraph login http://localhost:3000/login --out auth.json
```

Then pass it to every verify run:

```
uigraph verify <dir> --app-url http://app.local:3000 --storage-state auth.json --limit 34
```

The runner opens the browser context from that session, so it can reach
profile/dashboard/checkout routes. Without it, only public routes confirm and
coverage stalls low.
