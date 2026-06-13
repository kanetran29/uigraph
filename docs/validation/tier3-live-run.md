# Tier-3 live verification run (end-to-end)

The full pipeline driven against the **running** sample app, proving the loop is
real — not just unit-tested.

## Setup
- Sample app served at `http://localhost:5180` (react-router v6 SPA).
- `uigraph map examples/sample-react-app --controls` → `uigraph.db` (47 nodes, 24
  edges; all static, **0 runtime-witnessed**).
- `uigraph verify <dir> --app-url http://localhost:5180 --limit 8` (default
  `playwright-core` driver, cached Chromium).

## Result
```
coverage BEFORE: verified 0 / 24 (0%)
uigraph verify : 3 confirmed / 1 refuted of 4 target(s)
coverage AFTER : verified 3 / 24 (13%)
```
Confirmed runtime edges minted from observations:
- `Dashboard → Login` (navigate)
- `Products → ProductDetail` (click:Link)
- `Checkout → Login` (navigate)

The 1 refuted target did **not** reproduce in the browser and was correctly **not**
minted — soundness: the runner records observations; only confirmed ones enter the
graph as `source:'runtime'` edges (witness = the observation).

## What this validates together
- **F1** — stable control selectors are what the driver locates with.
- **F2** — `next_to_verify` produced the worklist the runner consumed.
- **F4** — codegen `buildSpecPlan` produced the per-leg actions the driver executed.
- **F5 + Tier-3 runner** — `report_observation` → `applyObservations` fold →
  `buildCoverage` rose from 0% to 13% from real browser evidence.

Chromium is driven via the optional `playwright-core` dependency (no browser
download — the runner reuses the cached Chromium). The orchestration is also unit-
tested with a fake driver, so the loop is covered without a browser.
