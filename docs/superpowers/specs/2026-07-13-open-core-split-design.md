# Open-core split: uigraph (OSS) + uigraph-studio (commercial)

Date: 2026-07-13. Approved: gen primitive stays OSS / suite product paid;
studio consumes OSS via git (submodule) first, npm later; private
`kanetran29/uigraph-studio` created now.

## Boundary

**OSS `uigraph` (this repo, MIT) — the trust engine, full-featured:**
- core IR, adapters (react/vue/angular/next), proof-gated verify loop, runner
  (probe, press, param-pattern asserts), `uigraph login`, MCP server (27
  tools), CLI, kit
- single-path `uigraph gen` + `gen_spec` STAY (the runner depends on
  codegen/plans; ripping them out would cripple OSS verification)
- dashboard limited to VIEWER grade: graph canvas, legend, search, inspector
  (read), coverage, changes, freshness banner, verify worklist (read). No
  write surfaces: no scenario/feature drafting, no proposals triage UI, no
  overlay editing from the UI. (The serve API keeps its write routes — agents
  and studio use them; the OSS UI just doesn't.)

**Commercial `uigraph-studio` (private) — the workflow product:**
- full interactive dashboard (scenario/feature drafting, overlay editing,
  proposals triage, verify orchestration, exports)
- e2e suite product (`@ui-graph-studio/suitegen`): batch-generate Playwright
  suites from the graph (witnessed/proven paths), per-role auth choreography
  via storageState, regeneration on re-map (self-healing selectors come from
  the graph, not guesses), CI-friendly output
- future: PR bot / impact reports (the dossier's retention wedge)

## Why this line

Adoption comes from the free trust engine (agents + devs get the full
verify loop — nothing epistemic is paywalled). Revenue comes from the team
workflow on top: humans interacting with the graph and shipping test suites
from it. OSS keeps the primitive (one spec at a time); studio sells the
product (suites, roles, maintenance, reporting).

## Mechanics

- Studio consumes the OSS packages via a **git submodule** (`vendor/uigraph`)
  listed in studio's pnpm workspace globs, with the OSS catalog mirrored in
  studio's pnpm-workspace.yaml (the `catalog:` protocol resolves only inside
  the consuming workspace). Pinning = submodule commit. Upgrade path: switch
  to published npm versions when OSS goes public; the tsup/publishConfig
  pipeline is already in place.
- Licenses: OSS stays MIT; studio is proprietary (no LICENSE grant).
- The gauntlet, harness, and all verification machinery stay OSS — the
  honesty story is the OSS brand.

## Non-goals now

- No npm publish yet.
- No billing/licensing enforcement in studio (it is a private repo; gating
  comes when there is a distribution).
- No PR bot yet (skeleton dir only).
