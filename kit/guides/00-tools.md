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
- **get_coverage** — runtime-verification coverage of the proven graph: `verified` (= `source:runtime`) / `total`, `unverified[]`.
- **next_to_verify** `{limit?}` — the ranked worklist: `unknown` edges, then `may`, then proposed transitions, minus anything already runtime-witnessed.
- **get_loop_status** — the DONE signal: `{coverage, resolution, worklistSize, loopDone}`. `loopDone` = worklist empty AND no `proposed` proposals left.

## Plan

- **plan_path** `{from, to, allow?}` — a directed route over the merged graph (optionally restricting allowed modalities). Returns the leg sequence or none.
- **gen_spec** `{from, to, baseUrl?}` — a Playwright spec for that route (locator actions from stable selectors + assertions). Drives verification.
- **list_scenarios** / **set_scenario** `{name}` — named overlays (alternate planned states).

## Mutate

- **report_observation** `{from, to, event, outcome, effect?, proposalId?, screenshot?}` — record a runtime attempt. `confirmed` folds into a `runtime` must-edge AND reconciles the linked proposal to `confirmed`; `refuted` adds no edge and reconciles to `rejected`. Returns the entry + `reconciled[]`.
- **reconcile_proposals** — re-derive all proposal statuses from the observation log (idempotent). Use after observations were appended out-of-band (e.g. by `uigraph verify`).
- **withdraw_proposal** `{id, reason}` — mark a hallucinated/impossible lead `rejected` (out of the worklist). Never touches the proven graph.
- **mark_unverifiable** `{id, reason}` — park a plausible-but-undrivable lead `unverifiable` (out of the worklist, kept for a human).
- **update_graph** — apply a manual overlay edit (addNode/editNode/addEdge/editEdge/remove). Edits are `manual`, modality ≤ `may`.

## Compare

- **diff** `{a, b}` — diff two graph files by stable id (added/removed nodes+edges, changed-edge fields).
