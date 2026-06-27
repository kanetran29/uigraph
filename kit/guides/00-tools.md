# uigraph MCP tools

Every tool is model-free and pure over the workspace. Grouped by intent. (The
canonical list lives in `kit/manifest.json` and is kept in sync with the server by
a test.)

## Read

- **get_graph** — the merged proven graph (base + manual overlay + runtime fold) with node/edge counts. Your ground truth.
- **get_grounding** `{screen?}` — per-screen digest of controls (with wired events/effects) and already-witnessed edges. Use to cite real controls and prune hypotheses that reference nothing real.
- **get_proposals** `{screen?, category?, evidencedOnly?, minConfidence?, status?}` — the quarantined leads. `status: 'proposed'` is your open worklist; `confirmed`/`rejected`/`unverifiable` are the resolved archive.
- **get_proposal_graph** — proposals projected to nodes+edges (only `proposed` ones). The hypotheses as a graph.
- **describe_screen** `{screen}` — one screen's controls + proven AND proposed outgoing actions.
- **get_state** `{id}` — one state as a trust-tiered action surface: all out-edges as cases, each with `event`, `guard`, `outcomeClass` (to-node / `ps_*` sub-state), `trustTier` (witnessed>proven>asserted>llm-verified>proposed>unknown) and an `evidence` cite. Answers "what can I do here and how far can I trust each path?". 404s on an unknown id.
- **list_cases** `{from?, outcomeClass?, minTier?}` — the behavioral case set across the merged graph + proposals, tier-tagged and sorted most-trusted first. `minTier: 'proven'` → witnessed+proven only; filter by source (`from`) or target (`outcomeClass`).
- **get_frontier** `{state?}` — the known-unknowns: states with unresolved (`unknown`-modality / dynamic-sink) out-edges or no out-edges at all, each with its unknown-case count. Where the map is incomplete — probe or ask before relying. The safety spine.
- **get_coverage** — runtime-verification coverage of the proven graph: `verified` (= `source:runtime`) / `total`, `unverified[]`.
- **next_to_verify** `{limit?}` — the ranked worklist: `unknown` edges, then `may`, then proposed transitions, minus anything already runtime-witnessed.
- **get_loop_status** — the DONE signal: `{coverage, resolution, worklistSize, loopDone}`. `loopDone` = worklist empty AND no `proposed` proposals left.
- **get_freshness** — is the stored graph current with the source? `{state: fresh|stale|unknown, mappedAt, changed[], added[], removed[]}`. Call at session start; on `stale`, notify the user + offer to re-map (see rules/04-graph-freshness.md).

## Plan

- **plan_path** `{from, to, allow?, minTier?}` — a directed route over the merged graph (optionally restricting allowed modalities). Returns the leg sequence or none. With `minTier`, any hop below that trust floor is reported in `tierWarnings` — the path is still returned, low-trust hops are flagged not dropped.
- **gen_spec** `{from, to, baseUrl?}` — a Playwright spec for that route (locator actions from stable selectors + assertions). Drives verification.
- **list_scenarios** / **set_scenario** `{name}` — named overlays (alternate planned states).

## Mutate

- **report_observation** `{from, to, event, outcome, effect?, proposalId?, screenshot?}` — record a runtime attempt. `confirmed` folds into a `runtime` must-edge AND reconciles the linked proposal to `confirmed`; `refuted` adds no edge and reconciles to `rejected`. Returns the entry + `reconciled[]`.
- **reconcile_proposals** — re-derive all proposal statuses from the observation log (idempotent). Use after observations were appended out-of-band (e.g. by `uigraph verify`).
- **withdraw_proposal** `{id, reason}` — mark a hallucinated/impossible lead `rejected` (out of the worklist). Never touches the proven graph.
- **mark_unverifiable** `{id, reason}` — park a plausible-but-undrivable lead `unverifiable` (out of the worklist, kept for a human).
- **park_edge** `{id, reason}` — park a may/unknown EDGE out of the worklist with an auditable reason. Becomes **accounted-for but NEVER runtime-verified** (accounted ≠ verified) and never edits the edge. The honest path to a fully *accounted-for* known edge set — which is not the same as the app being fully mapped or fully verified.
- **unpark_edge** `{id}` — return a parked edge to the worklist.
- **update_graph** — apply a manual overlay edit (addNode/editNode/addEdge/editEdge/remove). Edits are `manual`, modality ≤ `may`.

## Compare

- **diff** `{a, b}` — diff two graph files by stable id (added/removed nodes+edges, changed-edge fields).
- **diff_since_last** `{}` — what the last re-map did to the proven UI graph: the current base vs the previous map (added/removed nodes+edges, changed-edge fields) + both `mappedAt` timestamps. `{state: ok|no-prior|no-current, diff, previousMappedAt, currentMappedAt}`. No args (the previous base is in the workspace db, not a file). Base-graph only. After re-mapping, call it to tell the user what changed — distinct from `get_freshness` (source-file staleness). See rules/04-graph-freshness.md.
