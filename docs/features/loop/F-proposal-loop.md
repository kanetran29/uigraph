# Self-healing proposal reconciliation loop (model-free core + MCP + LLM contract)

- **Slug:** F-proposal-loop
- **Status:** designed

## Purpose

The KNOWN GAP: Proposal.status never transitions. report_observation links proposalId but leaves status 'proposed'; there is no archive/withdraw, no resolution metric, no loop-completion signal. So the LLM has no deterministic way to know which proposals are still open, which are resolved, or when it is DONE. This feature closes that gap with model-free, pure, idempotent core pieces plus a thin transactional MCP surface, so an LLM can loop a quarantined proposal set to 100% resolution (every uncertain edge runtime-witnessed AND every proposal confirmed/rejected/unverifiable) WITHOUT ever being allowed to mint a proven edge from a guess. Status is DERIVED from the observation log (the deterministic witness), never asserted by the model. The active proposal worklist shrinks monotonically so the loop provably terminates.

## Design

CORE (packages/core/src/reconcile.ts — new, pure, no IO, browser-safe):

1. `reconcileProposals(proposals: Proposal[], observations: Observation[]): Proposal[]` — pure, idempotent. Derives each proposal's status from the observation log. Algorithm:
   - Build a confirmed-pair set and a refuted-pair set keyed by `from->to[->event]` from observations, plus index observations by proposalId.
   - For each proposal p, compute its pair key with effective from = `p.from ?? p.screen` (mirrors materializeProposalGraph, which already treats screen as the edge `from`), to = `p.to`. Matching rules, in precedence:
     a. Any CONFIRMED observation with `proposalId === p.id` OR matching p's (from,to[,event]) pair => status 'confirmed'. The runtime edge already exists via applyObservations; this archives/promotes the lead only.
     b. Else any observation linked to p (proposalId===p.id) OR matching its pair is REFUTED with no confirmation => status 'rejected' (hallucinated, withdrawn).
     c. Else keep existing status. confirmed/rejected are terminal and never demoted by later absence of evidence; an existing 'unverifiable' stays 'unverifiable'; a 'proposed' stays 'proposed'.
   - Returns a NEW array (same length, same order, new objects only where status changed); never mutates inputs, never writes anything but `status`. reconcile∘reconcile = reconcile.
   - Event is matched only when the proposal carries an `event`; otherwise pair-only (proposals frequently lack a precise event), so from->to is the primary key and event a tiebreaker — avoids leaving real, witnessed proposals stuck.

2. ACTIVE proposal graph excludes resolved proposals. Add ONE guard at the top of materializeProposalGraph's proposal loop: `if (p.status !== 'proposed') continue`. This is the single choke point: getProposalGraph (stored doc), describeScreen.proposedEdges, and nextToVerify (which consumes the proposal graph) all inherit the filter. confirmed/rejected/unverifiable proposals stay queryable via get_proposals (raw list) for audit but never re-enter the worklist => worklist shrinks monotonically.

3. PROGRESS / LOOP-COMPLETION — new `buildResolution(proposals): ResolutionReport` in reconcile.ts (kept beside reconcileProposals; coverage.ts stays edge-only per separation):
   - `{ total, resolved, openCount, ratio, byStatus }` where resolved = confirmed+rejected+unverifiable, openCount = proposed, ratio = total>0 ? resolved/total : 1.
   - New MCP tool get_loop_status(ctx) composes the model-free DONE signal: `loopDone = nextToVerify(merged, activeProposalGraph).length === 0 AND resolution.openCount === 0`. Returns `{ coverage, resolution, worklistSize, loopDone }`. "100% coverage" = every uncertain edge runtime-witnessed AND every proposal resolved.

MCP / STORE SURFACE (packages/core/src/store.ts + packages/mcp/src/tools.ts):

4a. Store gains `setProposalStatus(id, status, reason?): boolean` — a single transactional UPDATE on the existing proposals.status column (returns whether a row changed) — and `reconcileFromObservations(): number` — load queryProposals()+getObservations(), run reconcileProposals, write changed statuses in one BEGIN/COMMIT, call rebuildProposalGraph(), return count changed. Add a nullable `reason TEXT` column via a guarded `ALTER TABLE ADD COLUMN` in the schema bootstrap (status column already exists).

4b. report_observation (tools.ts) becomes transactional: after appendObservation, in the SAME store scope, run reconcileFromObservations() so the linked proposal flips immediately (proposalId match) or via pair match. Return `ObservationEntry & { reconciled: { id, status }[] }`. applyObservations independently mints the runtime edge — two independent derivations from the same witness.

4c. New tool reconcile_proposals(ctx) -> `{ changed: number; resolution }` — batch/idempotent re-derive (wraps reconcileFromObservations + buildResolution) for observations appended out-of-band (e.g. by the Tier-3 runner) or to re-sync.

4d. New tool withdraw_proposal(ctx, { id, reason }) -> `{ id, status: 'rejected', reason }` — for when the LLM proves a proposal CANNOT be verified / is hallucinated with no refuting observation to record. Sets status 'rejected' with reason, rebuilds the proposal graph; NEVER touches the proven graph.

4e. New tool mark_unverifiable(ctx, { id, reason }) -> `{ id, status: 'unverifiable', reason }` — the no-progress guard target: plausible but unreachable/undrivable. Excluded from the active worklist (so the loop can terminate), still surfaced in get_proposals(status:'unverifiable') and resolution.byStatus for human follow-up. Distinct from 'rejected' (disproven). archive_proposal is deliberately ABSENT — confirmation auto-archives via reconcile; an explicit archive of an unconfirmed proposal would breach the invariant.

4f. get_proposals gains an optional `status` filter (ProposalQuery + queryProposals SQL add `status = ?`). `get_proposals({status:'proposed'})` is the loop's worklist of open leads.

5. THE LLM LOOP CONTRACT (pseudocode shipped in the agent kit/skill, referencing only these model-free tools):
```
loop:
  s = get_loop_status()
  if s.loopDone: STOP                      # 100% — every uncertain edge witnessed, every proposal resolved
  work = next_to_verify(limit=N)           # uncertain edges + still-proposed transitions
  for target in work:
    plan = plan_path(target.from, target.to)
    if not plan.found:
      alt = relax allow modalities OR find a multi-hop route through another screen
      if no alternate after R retries: mark_unverifiable(target.proposalId, reason); continue
    gen_spec(target.from, target.to); runVerify(...) OR report_observation(from,to,event,outcome,proposalId,screenshot)
    # confirmed -> applyObservations mints runtime edge; reconcile auto-archives proposal 'confirmed'
    # refuted   -> reconcile sets proposal 'rejected' (hallucination withdrawn)
  # LLM judgment: realizes a proposal is hallucinated with no clean refuting run -> withdraw_proposal(id, reason)
  guard: if get_loop_status().worklistSize did NOT shrink this iteration AND retries exhausted:
           mark_unverifiable the stuck targets; continue   # prevents infinite loop
termination proof: each iteration removes >=1 proposal from 'proposed' (confirmed/rejected via observation,
or unverifiable via the guard). 'proposed' is finite and strictly decreasing => loopDone is reached.
```
Retry cap R + no-progress detection (worklistSize monotonic) live in the contract/kit, not core. Core only provides deterministic primitives.

## Data shapes

CHANGED:
- ProposalStatus (proposals.ts): add 'unverifiable' => 'proposed' | 'confirmed' | 'rejected' | 'unverifiable'. Update the STATUSES Set used by validateProposals.
- Proposal (proposals.ts): add optional `reason?: string` (rationale for withdraw/unverifiable; distinct from existing `rationale`, the original proposing signal).
- ProposalQuery (store.ts) + GetProposalsArgs (tools.ts): add optional `status?: ProposalStatus`.
- proposals SQLite table: add nullable `reason TEXT` column (guarded ALTER in schema bootstrap; status column already exists).

NEW:
- ResolutionReport (reconcile.ts): { total: number; resolved: number; openCount: number; ratio: number; byStatus: Record<ProposalStatus, number> }.
- LoopStatus (tools.ts): { coverage: CoverageReport; resolution: ResolutionReport; worklistSize: number; loopDone: boolean }.
- WithdrawProposalArgs / MarkUnverifiableArgs (tools.ts): { id: string; reason: string }.
- ReportObservationResult (tools.ts): ObservationEntry & { reconciled: { id: string; status: ProposalStatus }[] }.
- ReconcileResult (tools.ts): { changed: number; resolution: ResolutionReport }.

Reuses unchanged: Observation, GraphEdge, UiGraph, ProposalGraph, CoverageReport, VerifyTarget. The proven IR (GraphNode/GraphEdge/Witness) is untouched — no new edge/node shapes.

## Soundness

GOLDEN INVARIANT preserved end to end: no proven edge is ever minted from a proposal or a model assertion. The ONLY thing that mints a runtime `must` edge remains applyObservations(graph, observations) on a CONFIRMED observation (a pre-existing deterministic witness). reconcileProposals touches `status` ONLY and returns Proposal[] — nothing it returns enters the graph; buildResolution is read-only counting; the new MCP tools write only the proposals table's status/reason. A proposal NEVER becomes a GraphEdge.

NEVER auto-promoted: status 'confirmed' is set ONLY when a confirmed observation already exists in the log (so the runtime edge already exists, derived independently from the SAME witness). There is no tool that flips a proposal to 'confirmed' without an observation; archive_proposal is deliberately absent. withdraw_proposal/mark_unverifiable only move a proposal OUT of the active graph (rejected/unverifiable) — they can never promote to a proven edge.

Hallucinated proposal withdrawn cleanly without corrupting the proven graph: a refuted observation (or explicit withdraw_proposal) flips status to 'rejected'; the materializeProposalGraph guard then drops it from the active proposal graph, so it vanishes from getProposalGraph, describeScreen.proposedEdges, and nextToVerify. The PROVEN graph is untouched — a refuted observation produces no edge in applyObservations (existing runtime.ts behavior), and reconcile cannot reach the edge layer at all. No phantom 'must' can appear: applyObservations skips non-confirmed observations and unknown nodes; reconcile writes no edges.

Idempotency / replay safety: reconcileProposals is a pure fold over the observation log => deterministic and re-runnable (reconcile∘reconcile = reconcile). confirmed/rejected are terminal and not demoted by later absence of evidence, so re-reconciling a resolved set is a no-op. TERMINATION: the active worklist = uncertain edges (finite; only ever upgraded to runtime, never added by this feature) + still-'proposed' proposals. Every loop iteration removes >=1 proposal from 'proposed' under the no-progress guard; a strictly decreasing finite set => loopDone reached. A phantom 'must' is impossible because reconcile never writes edges and the worklist filter keys on status, not on any model-supplied truth.

## Test strategy

TDD, tests-first, vitest, matching existing fixtures (core/src/fixtures.ts node/edge/graph; proposals.test.ts proposal() factory).

reconcile.test.ts (core, pure):
- confirmed observation matching (from,to) flips 'proposed'->'confirmed'.
- confirmed observation matching by proposalId flips status even if pair differs slightly.
- refuted observation (no confirmation) flips 'proposed'->'rejected'.
- a pair with BOTH a refuted and a later confirmed observation => 'confirmed' (confirmation wins).
- untouched stays 'proposed'; existing 'unverifiable' stays; terminal 'confirmed'/'rejected' never demoted when evidence absent.
- screen-as-from fallback: a proposal with only `screen`+`to` matches an observation on (screen,to).
- PURITY: inputs not mutated (deep-equal originals after call). IDEMPOTENT: reconcile(reconcile(x,o),o) === reconcile(x,o).
- RED-TEAM: reconcile output is Proposal[] only and never implies an edge; status is the sole field changed.
- buildResolution: byStatus counts; resolved=confirmed+rejected+unverifiable; ratio=1 when empty; openCount=proposed.

proposals.test.ts additions:
- validateProposals accepts status 'unverifiable' and optional reason.
- materializeProposalGraph EXCLUDES confirmed/rejected/unverifiable (only 'proposed' produce edges). RED-TEAM: a 'confirmed' proposal yields zero proposal-graph edges.

coverage.test.ts additions:
- nextToVerify no longer surfaces a proposal once status is non-'proposed' (via filtered proposal graph) => worklist shrinks.

store.test.ts additions:
- setProposalStatus updates one row transactionally + rebuilds proposal graph (getProposalGraph drops the resolved edge).
- reconcileFromObservations: seed proposals + confirmed/refuted observations, assert derived statuses + count; second call returns 0 (idempotent).
- reason column round-trips (set + queryProposals). queryProposals({status}) filters.

mcp tools.test.ts additions (using its newWorkspace/seedProposals helpers):
- report_observation(confirmed, proposalId) returns reconciled:[{id,status:'confirmed'}], get_proposals shows confirmed, AND the proven graph now has the runtime edge (loadMergedGraph) — two derivations from one witness.
- report_observation(refuted, proposalId) => proposal 'rejected', and RED-TEAM: the proven graph gained NO edge.
- withdraw_proposal removes the lead from get_proposal_graph while base graph edge count is unchanged (phantom-must check).
- mark_unverifiable removes from next_to_verify but proposal still listed in get_proposals(status:'unverifiable').
- get_loop_status.loopDone true only after worklist empty AND no 'proposed' left.
- LOOP-TERMINATION: drive a 2-proposal graph to loopDone in a bounded number of report_observation calls; assert loopDone flips exactly once and stays true.

## Files

- `packages/core/src/reconcile.ts`
- `packages/core/src/reconcile.test.ts`
- `packages/core/src/proposals.ts`
- `packages/core/src/proposals.test.ts`
- `packages/core/src/store.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/index.ts`
- `packages/core/src/coverage.test.ts`
- `packages/mcp/src/tools.ts`
- `packages/mcp/src/tools.test.ts`
- `packages/mcp/src/server.ts`
- `packages/mcp/src/index.ts`
- `packages/cli/src/runner.ts`

## Dependencies



## Risks

1. Widening ProposalStatus with 'unverifiable' touches every exhaustive switch/Record over it. Grep confirms only STATUSES (Set) and validateProposals reference the union today; Record<ProposalStatus,number> in ResolutionReport must initialize all four keys. Verify no other exhaustive switch before merge.
2. Pair-matching ambiguity: proposals often lack a precise event, so reconcile keys primarily on from->to. Two proposals sharing a from->to pair (materializeProposalGraph already dedupes them into one edge with multiple proposalIds) will both reconcile to 'confirmed' from one observation — correct (the pair is witnessed) but add a test asserting it. Event is a tiebreaker, never required, so confirmed-but-event-mismatched proposals don't get stuck.
3. report_observation now reconciles inside its store scope — append + reconcile must run in ONE BEGIN/COMMIT so a failure rolls back both consistently (today appendObservation is a lone statement).
4. The Tier-3 runner appends observations via reportObservation per target; reconciling each call means N small transactions — fine at this scale (worklist bounded, typically <20; proposals table is tens of rows). Do NOT prematurely index queryProposals' full scan.
5. Migration: existing rows have no reason column. The guarded ALTER TABLE ADD COLUMN reason must be idempotent (PRAGMA table_info check or try/catch) — CREATE TABLE IF NOT EXISTS will not add a column to an existing table.
6. Orphaned proposals (from->to no longer in the graph) can't produce a proposal-graph edge (materializeProposalGraph guards realNodeIds) so they never enter the worklist, yet stay 'proposed' and would BLOCK loopDone forever. buildResolution counts them open; the no-progress guard + mark_unverifiable is the intended escape. Document so orphans don't deadlock the loop.
