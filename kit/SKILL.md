---
name: uigraph
description: Use when driving a uigraph workspace over MCP — building or auditing the UI transition graph, reconciling LLM proposals, or running Tier-3 runtime verification. Load before calling any uigraph tool.
---

# uigraph agent kit

uigraph is a self-mapping behavioral graph of a UI: screens (nodes) and the
transitions between them (edges), extracted statically from the source, enriched
by quarantined LLM proposals, and confirmed by runtime observation. The core is
**model-free** — you (the LLM) are a consumer, not part of the trusted base.

## The one law you must not break

Read [rules/00-golden-invariant.md](rules/00-golden-invariant.md). In one line: **no
edge enters the proven graph without a deterministic static or runtime witness.**
You never write a proven edge. The observation enters the graph, not your guess.

## Vocabulary (6 lines)

- **modality** — `must` (always fires) · `may` (conditional/guarded) · `unknown` (dynamic target, undecidable statically). See [rules/01-modality.md](rules/01-modality.md).
- **source / provenance** — `static` (extractor) · `manual` (human overlay) · `runtime` (observed) · `proposal` (quarantined lead). See [rules/02-provenance.md](rules/02-provenance.md).
- **a proposal is a LEAD, not a fact** — see [rules/03-proposal-is-a-lead.md](rules/03-proposal-is-a-lead.md).

## The tools at a glance

Full reference: [guides/00-tools.md](guides/00-tools.md). Grouped:
- **Read** — get_graph, get_proposals, get_grounding, get_proposal_graph, describe_screen, get_coverage, next_to_verify, get_loop_status
- **Plan** — plan_path, gen_spec, list_scenarios, set_scenario
- **Mutate** — update_graph, report_observation, reconcile_proposals, withdraw_proposal, mark_unverifiable
- **Compare** — diff

## The job you are usually here to do

Drive proposals + uncertain edges to resolution: the **reconciliation loop**,
[loop/reconciliation-loop.md](loop/reconciliation-loop.md). Read state with
get_loop_status, verify the worklist, archive what's confirmed, withdraw what's
hallucinated, until `loopDone`.

## Reading the app's runtime state

[guides/02-reading-state.md](guides/02-reading-state.md) (coverage + worklist) and
[guides/01-verify-flow.md](guides/01-verify-flow.md) (Tier-3 + authenticated runs).
