# Changelog

All `@ui-graph/*` packages are versioned in lockstep.

## 0.1.1

First public release on npm (0.1.0 never went live — it stayed in npm staging
and predated the package metadata and provenance below).

- Every package now links back to the repository on npm (`repository`,
  `homepage`, `bugs`, `keywords`, MIT license) and is published from CI with
  **npm provenance** — a verifiable attestation binding each tarball to this
  repo and the exact commit that built it.
- npm-consumer docs: `npm i -g @ui-graph/cli` quickstart, an MCP client config
  snippet, and a per-package README for `@ui-graph/cli`.
- No behavior changes from the 0.1.0 engine.

## 0.1.0

Initial engine (published to npm staging only; superseded by 0.1.1).

- **Deterministic extraction** — React (react-router v5/v6/data-router), Vue
  (vue-router), Angular (Routes/routerLink/canActivate), Next.js (App + Pages
  router); every edge carries a `file:line` witness. Unresolvable cases degrade
  loudly (soundiness notes, `may` fan-out), never silently — enforced by an
  adversarial gauntlet of 35 golden expectations and validated on 10 well-known
  OSS apps.
- **Proof-gated verification** — a confirmed runtime observation requires
  evidence (URL change, asserted dialog/URL, screenshot on disk) plus
  provenance, or it is rejected; the observation fold matches by the full
  `(from, to, event)` triple, preserves guards, and demotes stale witnesses
  after a re-map.
- **Trust tiers + honest coverage** — `witnessed > proven > asserted >
  llm-verified > proposed > unknown`; `runtime ⊆ verified ⊆ accounted`, never
  conflated; undrivable edges parked with reasons.
- **Tier-2 write path** (`propose`, quarantined), **Tier-3 runner** (drive,
  probe, press, `--all` sweep, param-pattern asserts), `uigraph login`,
  one-command `uigraph dash`, Playwright spec generation, structural + temporal
  diffs.
- **Model-free stdio MCP server** (27 tools, BYOA) + an installable agent kit.
