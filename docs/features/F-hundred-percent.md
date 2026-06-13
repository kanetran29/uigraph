# Honest 100% coverage — edge-level resolution loop

- **Slug:** F-hundred-percent
- **Status:** designed (design + red-team)

## Purpose

Today coverage = runtime/total only credits source:'runtime', so the 12 statically-proven `must` edges read "unverified" and the 11 dynamic `u_<screen>` `unknown` edges (target is a synthetic, never-runtime-stampable sink) are permanently stuck. The verify worklist re-surfaces may/unknown forever; there is no edge-level resolve/park, so loopDone over edges is unreachable and refapp sits at 21%. We add an edge-level reconciliation layer that mirrors the proposal lifecycle (resolve via witness / park via reason) so the loop can reach an HONEST 100% accounted-for — every edge is either witnessed (static must = a real static witness, or runtime-confirmed) or explicitly parked with an auditable reason — WITHOUT ever inventing or rubber-stamping an unwitnessed proven edge. The strict runtimeRatio is kept untouched alongside, so "how much is runtime-confirmed" stays honest and visible.

## Design

TWO METRICS in buildCoverage (extend CoverageReport, do NOT add a second function — KISS; coverage already maps over edges once).

An edge is classified by a pure helper edgeAccounting(edge, parked: Set<edgeId>):
- witnessed: edge.witness !== undefined AND (edge.source==='static' || edge.source==='runtime' || edge.source==='manual'). A static `must` edge carries witness {source:'static', file, loc, ruleId} (verified in extract.ts line 894) — that witness IS the deterministic proof the golden invariant demands, so it legitimately counts as accounted-for. runtimeConfirmed: edge.source==='runtime'.
- parked: parked.has(edge.id).
- open: NOT witnessed AND NOT runtimeConfirmed AND NOT parked. In practice the open set = may/unknown edges with no witness that are not parked (a `may` static edge today has source 'static' with a witness too — but the dynamic u_ sink edges have source 'static' modality 'unknown' with witness ruleId 'rr.dynamic-target'; see the soundness note below for why u_ edges are NOT auto-credited).

CRITICAL refinement for the dynamic sink (so static-witness crediting cannot be abused): an edge whose `to` node is a synthetic sink (target node kind==='unknown', i.e. the `u_<screen>` nodes) is NEVER counted as witnessed even though it carries a static witness — its destination is a placeholder, not a real transition. It is open until resolved or parked. So `accounted` for a u_ edge requires resolution or park, never the static witness. All other static/manual edges with a witness are witnessed. This is the one place we override "has witness ⇒ accounted".

New CoverageReport fields (additive, existing fields unchanged):
  runtimeVerified: number            // = existing `verified` (rename-keep both via alias `verified`)
  runtimeRatio: number               // = existing `ratio`
  accounted: number                  // witnessed-real ∪ runtimeConfirmed ∪ parked
  accountedRatio: number             // accounted/total (1 when total 0)
  open: EdgeCoverage[]               // the OPEN set (may/unknown, unwitnessed-real, unparked)
  parked: EdgeCoverage[]             // parked edges, each with its reason
EdgeCoverage gains: accounted: boolean; status: 'runtime'|'static'|'manual'|'dynamic-open'|'open'|'parked'; reason?: string. Keep `verified` for back-compat (= runtimeConfirmed).

buildCoverage signature changes to buildCoverage(graph: UiGraph, parked: ParkedEdge[] = []). parked default [] keeps all existing call sites valid; loadMergedGraph-based callers pass the stored set.

DYNAMIC-SINK RESOLUTION (the soundest rule). When the runner drives a `u_<from>` unknown edge it navigates from `from`, performs the event, and observes the REAL landing screen `realTo`. It calls report_observation(from, realTo, event, confirmed) — existing applyObservations mints a concrete runtime must-edge from→realTo (the witness is the observation). The synthetic u_ edge is then RESOLVED — but NOT by claiming it fired. Rule (pure, derivable, no new state): a u_ unknown edge `from→u_<from>` is "resolved" iff the merged graph contains >=1 runtime edge out of the SAME `from` node (source==='runtime' && edge.from===from && to is a real, non-sink node). Rationale: the dynamic dispatch out of `from` has now been exercised and produced a concrete witnessed landing; the placeholder has served its purpose. This is computed in edgeAccounting from the graph itself (set of `from` ids that have a concrete runtime out-edge) — so resolution is a pure function of the witnessed log, never a flag an agent sets. If a `from` has multiple dynamic branches and the agent wants them all covered it keeps driving (each adds a runtime edge); when it judges the branch space exhausted but unresolved, it PARKS the u_ edge 'exhausted'. So a u_ edge leaves OPEN by EITHER (a) a concrete runtime out-edge from its source appearing (auto, witnessed) OR (b) an explicit park. It is never credited merely for existing.

EDGE PARK mechanism. New stored doc key 'parked_edges' (the docs table already stores arbitrary JSON via setDoc/getDoc — reuse it, no schema migration). Shape ParkedEdge { edgeId: string; reason: string; ts: string; by?: 'agent'|'runner' }. Store surface on Store:
  parkEdge(edgeId, reason, by?) : ParkedEdge  — upsert into the 'parked_edges' doc array (dedupe by edgeId), returns the entry.
  unparkEdge(edgeId): boolean — remove (lets a human/agent re-open).
  getParkedEdges(): ParkedEdge[].
Parking NEVER edits the edge: no modality change, no witness, no source change — it only records a sidecar note keyed by edge id. It is purely additive metadata, exactly like proposal.reason/'unverifiable'. Auditable: round-trips through the docs table, returned in coverage.parked with reason+ts.

Exclusion wiring:
- nextToVerify(graph, proposalGraph, parkedIds: Set<string>, limit): add a 3rd param (default empty set). In the edge loop `if (parkedIds.has(e.id)) continue`. Also already skips runtime edges; ADD: skip u_ edges whose `from` already has a concrete runtime out-edge (resolved) — compute resolvedFroms once, `if (e.modality==='unknown' && resolvedFroms.has(e.from)) continue`. So the worklist strictly shrinks as runtime edges land or edges are parked.
- get_coverage open set already excludes parked + resolved via edgeAccounting.

MCP tools (mirror withdraw/mark_unverifiable exactly):
  park_edge { id, reason } → withStore(store.parkEdge(id, reason, 'agent')); returns { id, reason, ts }. Description stresses: parks a may/unknown edge out of the worklist with an auditable reason; NEVER marks it proven, NEVER adds a witness.
  unpark_edge { id } → store.unparkEdge(id).
  (mark_edge_unverifiable is an alias name in the tool registry pointing at park_edge for discoverability — single handler.)
Pass parked into the read tools: getCoverage(ctx) → buildCoverage(loadMergedGraph(ctx), store.getParkedEdges()); nextToVerifyTool/getLoopStatus pass parked ids.

get_loop_status redefinition. LoopStatus gains openEdges: EdgeCoverage[] and openProposals (the proposed list). loopDone = coverage.open.length===0 AND resolution.openCount===0. Return BOTH ratios (coverage.runtimeRatio and coverage.accountedRatio) + both open lists + worklistSize. The "100%" the user demands is accountedRatio===1 with loopDone true; runtimeRatio stays visible as the honest "how much is actually runtime-confirmed" number (never forced to 1).

AUTONOMOUS until-done loop. CLI: `uigraph verify --until-done [--max-rounds N]` (default N=10). runVerify gains untilDone?:boolean, maxRounds?:number, parkTriesPerTarget?:number (default 2). New runVerifyUntilDone(opts) loop:
  round = 0; while round < maxRounds:
    compute loopDone via getLoopStatus(ctx); if loopDone break.
    snapshot openCount = coverage.open.length + resolution.openCount.
    run one runVerify pass (existing) over nextToVerify (now parked-aware).
    For each target the driver could not reach/confirm after parkTriesPerTarget attempts (tracked by a per-edgeId attempt counter persisted across rounds in a 'verify_attempts' doc), PARK it: edge target → store.parkEdge(id, 'unreachable after N attempts (autonomous)'), proposal target → markUnverifiable(id, ...). For a u_ unknown target whose source still has no concrete runtime out-edge after N tries → park 'exhausted: no reachable concrete landing'.
    recompute openCount'; if openCount' >= openCount (no progress AND nothing parked) → park the entire remaining open frontier with reason 'autonomous: no progress, parked for human' and break (guarantees termination).
    round++.
  TERMINATION proof: each round either (a) confirms ≥1 edge (open shrinks), (b) parks ≥1 edge/proposal (open shrinks), or (c) makes zero progress → the no-progress guard parks the whole frontier and breaks; plus the hard round cap. Open set is monotonically non-increasing and strictly decreases every round that continues, so it reaches 0 (loopDone) or hits the cap with a fully-parked, audited remainder.
Reuses runVerify + storageState verbatim (auth via --storage-state flows straight through). Agent-kit loop doc (SKILL/loop playbook): next_to_verify → drive authed → report_observation (for u_ targets report the REAL landing screen, not the sink) → after R failed tries call park_edge/mark_unverifiable with a concrete reason → poll get_loop_status until loopDone.

## Data shapes

REUSE core types: GraphEdge/Witness/Source/Modality (ir.ts), Observation (runtime.ts), ProposalStatus/ResolutionReport (reconcile.ts), ProposalGraph (proposals.ts). No change to GraphEdge, Witness, or the proven graph schema.

NEW/CHANGED:
- ParkedEdge (new, in coverage.ts or store.ts): { edgeId: string; reason: string; ts: string; by?: 'agent'|'runner' }. Stored as a JSON array under docs key 'parked_edges' via the EXISTING setDoc/getDoc — no SQL migration. This is the ONLY place parked-edge state lives; it is a sidecar note, structurally identical in spirit to proposal.reason. Soundness of "stored where": parked state lives in the docs overlay-class store (mutable agent/runner metadata), NEVER in the base graph or as a GraphEdge mutation — the base graph + its witnesses remain the sole source of proof. It stays sound because edgeAccounting treats parked purely as "excluded from open", and surfaces it as its own `parked` bucket with reason — it is never folded into witnessed/runtimeVerified counts and never resurfaces as a proven edge.
- EdgeCoverage (changed): add accounted: boolean; status: 'runtime'|'static'|'manual'|'dynamic-open'|'open'|'parked'; reason?: string. Keep existing id/from/to/event/modality/source/verified.
- CoverageReport (changed, additive): add runtimeVerified, runtimeRatio (aliases of verified/ratio kept for back-compat), accounted, accountedRatio, open: EdgeCoverage[], parked: EdgeCoverage[]. Keep total/verified/ratio/byModality/bySource/unverified.
- buildCoverage signature: (graph, parked: ParkedEdge[] = []).
- nextToVerify signature: (graph, proposalGraph, parkedIds: Set<string> = new Set(), limit = 20) — keep limit last with a default; update the one core test + tools.ts/runner.ts call sites.
- LoopStatus (changed): add openEdges: EdgeCoverage[]; openProposals: Proposal[]; keep coverage/resolution/worklistSize/loopDone. loopDone redefined to coverage.open.length===0 && resolution.openCount===0.
- VerifyAttempt state for until-done: docs key 'verify_attempts' = Record<edgeId, number>, ephemeral run bookkeeping (cleared at run start) — not part of soundness, only termination.

## Soundness (design)

The golden invariant holds and 100% can NEVER be faked:
1. Static-must crediting is legitimate, not rubber-stamping: a static `must` edge carries witness {source:'static', file, loc, ruleId} produced by the deterministic adapter (extract.ts:894). That witness IS the deterministic static proof the invariant requires. Counting it as "accounted-for" reports an existing fact; it does not mint anything. The strict runtimeRatio still shows it is NOT runtime-confirmed, so nothing is hidden.
2. Dynamic resolution mints only witnessed concrete edges: a u_ sink edge is NEVER credited by its own static witness (explicit override: target kind==='unknown' ⇒ not witnessed). It leaves OPEN only when (a) report_observation mints a real runtime from→realTo edge (a true runtime witness via applyObservations — the existing sole minter) so its source gains a concrete out-edge, or (b) it is explicitly parked. The synthetic placeholder is never itself claimed to fire and is never promoted to `must`.
3. Parking requires a reason, is auditable, never claims the edge fires: parkEdge writes {edgeId, reason, ts} to a sidecar doc; it does not touch the edge's modality, source, or witness. Parked edges are reported in their own `parked` bucket with reasons, excluded from open but EXPLICITLY NOT counted as verified/runtime-confirmed and not as a static witness — they are a third, visibly-distinct category. A human can unpark and re-open.
4. loopDone is honest: it is true only when the open set (computed from witnesses + parks, not from any agent assertion) is empty AND no proposed proposals remain. An agent cannot flip it by inventing an edge — there is no code path to add a GraphEdge except applyObservations (runtime witness) and the static adapter; the overlay forces source 'manual' and modality ≤ 'may' (tools.ts asManualEdge) and a manual `may` edge without a runtime witness stays OPEN, so manual edits cannot reach 100% either.
5. The two ratios make abuse visible: runtimeRatio is never coerced to 1; if the headline accountedRatio is 100% it is decomposable into runtimeVerified + static-witnessed + parked(with reasons), each independently auditable. "100% accounted-for" means "every edge has a deterministic witness OR an auditable human-readable reason for being parked" — which is exactly an honest, non-fakeable completeness claim.

## Red-team: holes + fixes (MUST hold)

HOLES (each: severity, why, concrete fix). Verified against real code, not assumption.

H1 — CRITICAL (minting-grade dishonesty). The design's witnessed rule is "edge.witness!==undefined AND source∈{static,runtime,manual}" with the ONLY override being u_ sink edges. But EVERY static edge carries a witness — pushEdge in extract.ts:880-895 unconditionally sets witness on must AND `may` edges alike (and the Angular adapter at extract.ts:497). So as written, a static `may` edge (modality 'may' = guarded/conditional, "might not actually fire") would be auto-credited as accounted-for purely for existing in source — that is exactly rubber-stamping an unwitnessed-AT-RUNTIME transition as done. A `may` edge's static witness proves the CALL SITE exists, NOT that the transition fires; crediting it as accounted hides a real gap (the user's "11 may edges" would flip to green without ever being driven). FIX: restrict crediting to modality==='must' (rule 4 above). A `may`/over-approx edge is OPEN until runtime-confirmed or explicitly parked. Only `must`-static is a genuine deterministic proof of the transition. (This is the single most important correction; the design's own prose conflates "has a witness" with "is proven to transition", which is false for `may`.)

H2 — HIGH (over-crediting / faked 100%). resolvedFroms credits a u_ edge as resolved iff its source has ANY one concrete runtime out-edge. But a screen with N distinct dynamic branches (navigate(roleBasedUrl) → /admin | /user | /guest) emits ONE u_<from> edge; driving ONE branch mints ONE runtime edge and the rule marks the dispatch "resolved", silently claiming the entire dynamic branch space is accounted for. That is reaching 100% by exercising 1 of N. FIX: resolution credits exactly ONE witnessed dispatch; it does NOT assert branch-exhaustion. Either (a) keep the u_ edge OPEN until the agent explicitly parks the residual with reason 'exhausted: drove K of suspected N branches' (auditable, honest), or (b) if you want auto-resolve, gate it on the soundiness note count — the adapter already emits one 'dynamic-target' soundiness note per dynamic site (extract.ts:940, angular 528/577); require >= that many runtime landings from the `from` before auto-resolving. Default to (a): never auto-claim exhaustion.

H3 — HIGH (silent real-branch loss masquerading as progress). applyObservations skips any confirmed observation whose `to` is not already a node (runtime.ts:77 `!nodeIds.has(o.to)`). A dynamic landing on a screen the static pass never saw mints NO runtime edge — so resolvedFroms stays empty (good, the u_ edge stays open) BUT the observation is silently swallowed: the runner believes it confirmed a landing, the log shows a confirmed observation, yet the graph gained nothing and coverage did not move. Over rounds the autonomous loop will then PARK that branch as "unreachable", burying a real, witnessed transition under a park. FIX: report_observation must detect the dropped observation (to not in graph) and either (i) auto-add the landing node to the overlay before folding, or (ii) return a 'dropped: unknown target node' flag so the runner adds the node and re-reports. A confirmed observation that produced no edge MUST never be counted as progress and MUST never be silently parked.

H4 — MEDIUM (parked-mistaken-for-verified across the surface). The design correctly says park ≠ proven in coverage, but the risk is leakage at the EDGES of the system: (a) accountedRatio lumps parked into the numerator, so a dashboard/CLI that prints only accountedRatio shows "100%" for an app that is mostly parked. (b) Autonomous parks and human parks are indistinguishable if reason text is freeform. FIX: (1) EVERY surface (coverage JSON, get_loop_status, CLI summary, dashboard) MUST print runtimeRatio AND accountedRatio AND parkedCount together — never accountedRatio alone. (2) Tag autonomous parks by:'runner' + reason prefix 'autonomous:' so audit can separate "a human judged this unverifiable" from "the bot gave up". (3) parked edges appear in coverage.parked (not coverage.open and NOT in any witnessed/accounted breakdown that reads like "verified").

H5 — MEDIUM (loopDone can lie via two-source drift). loopDone = coverage.open.length===0 AND resolution.openCount===0, but worklistSize comes from nextToVerify and coverage.open from edgeAccounting — two independent computations of "open edges". If their exclusion logic diverges (e.g. nextToVerify skips resolvedFroms but edgeAccounting forgets to, or vice-versa), loopDone could read true while the worklist is non-empty, or worklist drains while open>0. FIX: single source of truth — derive the worklist's edge portion FROM coverage.open (or assert in a test that {open edge ids} === {edge-kind worklist ids}). Keep loopDone reading the SAME open set the worklist reads.

H6 — LOW (termination vs honesty tension in the autonomous loop). The no-progress guard "parks the entire remaining frontier and breaks" guarantees termination but is precisely the move that, unguarded, converts "we couldn't verify this" into "100% accounted". This is acceptable ONLY because parked is excluded from runtimeRatio and tagged auditable. FIX (already in hardened design): the loop's final summary MUST surface that the run ended by mass-park (distinct exit reason) and report how many edges were autonomously parked vs witnessed, so 100%-accounted reached by giving up is visibly different from 100% reached by confirming.

WHAT THE DESIGN GOT RIGHT (legitimately sound):
- The core insight is correct and NOT a cheat: static-`must` edges carry a real deterministic static witness (extract.ts:894 / 497), so reporting them as accounted-for fixes a reporting bug; it does not invent an edge. The golden invariant is about the PROVEN GRAPH never gaining a witness-less edge — and this design adds ZERO edges and ZERO witnesses.
- Keeping runtimeRatio strict and untouched alongside accountedRatio is exactly right: "how much is actually runtime-confirmed" stays honest and is never forced to 1.
- Park-as-sidecar (docs table, never the edge, never the overlay) is the correct, sound storage choice — it cannot alter the merged graph, mirrors proposal.reason, and is auditable/round-trippable. Reusing setDoc/getDoc with no migration is correct (store.ts:95-104).
- Resolution as a PURE function of the witnessed log (resolvedFroms derived from runtime edges, never an agent-set flag) is the right shape — it inherits the same "derived from witness, not asserted" property as reconcileProposals.
- The u_ override (never credit a sink edge by its own static witness) is correct and necessary — its destination is a placeholder, not a real transition.
- Mirroring withdraw_proposal/mark_unverifiable for park_edge (reason mandatory, leaves worklist, never touches proven graph) is the right precedent (tools.ts:461/471).
- The termination proof (monotone non-increasing open set + hard cap) is valid.

CAN 100% BE FAKED? After H1+H2+H3 fixes: NO honest path mints a false edge — accountedRatio can reach 1 only when every edge is (must-static witness | runtime witness | audited park). It CAN reach 1 via mass-park, but that is HONEST iff H4/H6 hold (parked is excluded from runtimeRatio, tagged, and always co-reported). Without the H1 fix: YES, trivially — every `may` edge auto-greens. That is the blocking hole.

## Red-team: hardened rules

HARDENED DESIGN (the proposal, corrected for the holes below).

TWO METRICS in buildCoverage(graph, parked: ParkedEdge[] = []) — additive fields, existing `verified`/`ratio`/`unverified` UNCHANGED so all current callers and tools.test.ts keep passing.

Pure classifier edgeAccounting(edge, graph-derived context, parkedById): returns { accounted: boolean; status }. Precedence (FIRST match wins; ORDER IS LOAD-BEARING):
  1. status 'runtime'  : edge.source==='runtime'  → accounted (a confirmed-observation witness; the only runtime minter is applyObservations, runtime.ts:65). runtimeConfirmed=true.
  2. status 'parked'   : parkedById.has(edge.id)   → accounted. (Checked BEFORE static so a parked edge is never silently double-credited as a witness; its accounting comes from the audit note, not a witness.)
  3. status 'dynamic-open' / 'dynamic-resolved' : target node kind==='unknown' (the u_<screen> sink). NEVER witnessed by its own static witness. dynamic-resolved (accounted) iff resolvedFroms.has(edge.from); else dynamic-open (NOT accounted).
  4. status 'must-static' : source∈{'static','manual'} AND modality==='must' AND witness!==undefined → accounted. (THE crediting rule. Restricted to MUST. See hole H1.)
  5. status 'open'     : everything else — i.e. unwitnessed-real OR a `may`/over-approx edge that has a static witness but is NOT a proven must. NOT accounted until runtime-confirmed or parked.

New CoverageReport fields: runtimeVerified:number (=verified), runtimeRatio:number (=ratio), accounted:number, accountedRatio:number (1 when total 0), open:EdgeCoverage[], parked:EdgeCoverage[] (each with reason). EdgeCoverage gains accounted:boolean, status (the union above), reason?:string, keeps verified (=runtimeConfirmed) for back-compat.

resolvedFroms (HARDENED — fixes hole H2): a Set<string> of `from` ids that have a CONCRETE runtime out-edge: { e.from | e.source==='runtime' && targetNodeKind(e.to)!=='unknown' }. A u_ edge is dynamic-resolved iff its `from` is in this set AND (HARDENING) the design must NOT auto-resolve when the from has MORE THAN ONE distinct dynamic branch unless an explicit per-branch park/confirm accounts for each — see H2 fix: resolution credits ONE dynamic dispatch; multi-branch froms require either N runtime landings or explicit park of the residual.

DYNAMIC-SINK RESOLUTION: runner drives u_<from>, performs event, observes real landing realTo, calls report_observation(from, realTo, event, confirmed). applyObservations mints from→realTo runtime must-edge. resolvedFroms then contains `from`, so the u_ edge is dynamic-resolved (pure, derived from the witnessed log — never a flag). CRITICAL PRECONDITION (fixes hole H3): applyObservations SILENTLY SKIPS any confirmed observation whose `to` is not already a node (runtime.ts:77 `!nodeIds.has(o.to)`), so a dynamic landing on a NEW screen mints NO runtime edge — resolvedFroms stays empty and the u_ edge stays dynamic-open. The runner MUST add the landing node first (overlay addNode, or extend applyObservations to mint the sink-discovered node) and report_observation must surface a 'dropped: unknown node' signal so a real branch is never counted as resolved without its witnessed landing actually entering the graph.

EDGE PARK: stored doc key 'parked_edges' via existing setDoc/getDoc (store.ts:100/95 — arbitrary JSON, no migration). ParkedEdge { edgeId; reason; ts; by?:'agent'|'runner' }. Store: parkEdge(edgeId, reason, by?) upsert+dedupe by edgeId (REASON MANDATORY — reject empty/whitespace, mirroring withdrawProposal/markUnverifiable which both require args.reason, tools.ts:461/471), unparkEdge(edgeId):boolean, getParkedEdges():ParkedEdge[]. Parking NEVER edits the edge (no modality/witness/source change) — sidecar metadata only, exactly like proposal.reason.

nextToVerify(graph, proposalGraph, parkedIds:Set<string>=new Set(), limit=20): `if (parkedIds.has(e.id)) continue`; compute resolvedFroms once, `if (e.modality==='unknown' && resolvedFroms.has(e.from)) continue`. Worklist strictly shrinks.

MCP wiring: getCoverage(ctx)=buildCoverage(loadMergedGraph(ctx), store.getParkedEdges()); nextToVerifyTool/getLoopStatus pass parked ids. New tools park_edge {id,reason} and unpark_edge {id}; mark_edge_unverifiable is a registry alias → single park_edge handler. Tool descriptions MUST state: parks a may/unknown edge out of the worklist with an auditable reason; NEVER marks proven, NEVER adds a witness.

get_loop_status: LoopStatus gains openEdges:EdgeCoverage[], openProposals (proposed list); returns BOTH coverage.runtimeRatio AND coverage.accountedRatio + both open lists + worklistSize. loopDone = coverage.open.length===0 AND resolution.openCount===0. (HARDENING H5: loopDone must read coverage.open AFTER park/resolve exclusion AND must agree with worklistSize — keep a single source of truth: derive worklistSize from the same open set, or assert open.length<=worklistSize+parked, so the two cannot disagree.)

AUTONOMOUS until-done loop: uigraph verify --until-done [--max-rounds N=10]. runVerifyUntilDone tracks per-edgeId attempts in a 'verify_attempts' doc; after parkTriesPerTarget (default 2) unreachable attempts, park edge (reason 'unreachable after N attempts (autonomous)') / markUnverifiable proposal. No-progress guard parks the whole remaining frontier ('autonomous: no progress, parked for human') and breaks. Termination: open set monotonically non-increasing, strictly decreases each continuing round, plus hard cap. HARDENING H4/H6: every autonomous park reason MUST be machine-distinguishable from a human/explicit park (by:'runner' + a stable reason prefix 'autonomous:'), and the loop's exit summary MUST report accountedRatio AND runtimeRatio AND a parkedCount broken down by reason-class, so "100% accounted" that is mostly autonomous-parked is visibly NOT "100% runtime-confirmed".

## Test strategy

TDD, extend coverage.test.ts / reconcile-style tests + tools.test.ts + cli.test.ts. RED first.
buildCoverage (coverage.test.ts):
- static `must` edge with a static witness ⇒ accounted true, status 'static', NOT in open, but runtimeVerified unchanged (verified stays count of runtime only). runtimeRatio < accountedRatio.
- runtime edge ⇒ accounted true, status 'runtime', counted in BOTH runtimeVerified and accounted.
- `may` static edge with witness but real target ⇒ currently witnessed; a `may` MANUAL edge (overlay, no witness) ⇒ OPEN (red-team: manual edit cannot mark itself accounted).
- u_ unknown edge with static witness + NO concrete runtime out-edge from its source ⇒ status 'dynamic-open', in OPEN, NOT accounted (red-team: a static witness on a synthetic-sink edge must NOT reach 100%).
- u_ unknown edge whose source HAS a concrete runtime out-edge (resolved) ⇒ excluded from open, status reflects resolution, accounted true — and assert the concrete runtime edge itself exists (resolution minted a witnessed edge, not the u_ edge).
- parked edge ⇒ in `parked` with its reason, excluded from open, accounted true, but runtimeVerified and the static-witnessed count both EXCLUDE it (red-team: parked is a distinct bucket, never counted as verified).
- accountedRatio===1 only when open empty; with one unparked open edge it is < 1.
nextToVerify: parked ids excluded; resolved u_ source excluded; existing ranking test updated for the new param.
RED-TEAM termination/fakery:
- cannot reach 100% by inventing an edge: assert no tool/path adds a GraphEdge except applyObservations; a withdraw/park leaves open empty only via the parked bucket.
- a parked edge is excluded from open but NOT counted as verified: explicit assertion on both buckets.
- dynamic sink resolves to a concrete runtime edge: drive u_ target, report real landing, assert a source:'runtime' from→realTo edge exists and the u_ edge left open.
- loopDone only when every edge+proposal accounted-for: open edge present ⇒ loopDone false; park it ⇒ loopDone true; one proposed proposal ⇒ false.
tools.test.ts: park_edge round-trips through store + appears in get_coverage.parked + leaves next_to_verify; unpark re-opens.
cli.test.ts (runner): runVerifyUntilDone with a driver that confirms some / refuses others ⇒ terminates within maxRounds, parks the unreachable remainder with a reason, ends loopDone true; assert it never exceeds maxRounds (mock a driver that always refuses ⇒ frontier fully parked, loop breaks, no infinite loop); assert open set strictly shrinks each continuing round.

## Red-team test musts

TDD, red-team-first. Each test states what it would catch.

RED-TEAM (must FAIL on the naive design, PASS after fix):
1. H1: graph with a static `may` edge (source:'static', modality:'may', witness present) and NO runtime observation → buildCoverage: that edge is in `open`, accounted=false, status='open'. (Catches auto-crediting `may` for having a witness. This is THE gate test.)
2. H1: static `must` edge with witness, no runtime obs → accounted=true, status='must-static', but verified=false and it is NOT in runtimeVerified count. (Confirms legit static crediting without touching the strict metric.)
3. H1 invariant: there exists NO input to buildCoverage that makes accounted=true for an edge with no witness AND source!=='runtime' AND not parked. Property test over random edges.
4. H2: screen `from` with one u_ edge; report ONE runtime landing from `from`. Without the residual-park, accountedRatio MUST NOT be 1 if the from is known multi-branch (or, under fix (a), the u_ edge stays open until explicitly parked). Assert the u_ edge is NOT auto-credited as exhausted.
5. H3: confirmed observation to a node NOT in the graph → applyObservations mints no edge (assert), resolvedFroms stays empty, the u_ edge stays in `open`, AND report_observation surfaces the 'dropped' signal. Assert the autonomous loop does NOT park it as 'unreachable' on the same round it was confirmed.
6. Cannot reach 100% by inventing an edge: feed buildCoverage a graph with one unwitnessed `may` edge; no tool call (park_edge requires a reason, no edge mutation exists) can flip it to accounted EXCEPT park_edge(id, reason) — and after parking, assert it is in `parked` with the reason, NOT in any witnessed/runtime count.
7. Parked != verified, everywhere: park an edge → it is excluded from coverage.open AND from nextToVerify worklist, BUT runtimeVerified and runtimeRatio are unchanged, and it appears in coverage.parked with reason+ts. (Catches the double-credit / leak.)
8. park reason mandatory: park_edge(id, '') and park_edge(id, '   ') throw/reject (mirror withdrawProposal). 

RESOLUTION + DYNAMIC SINK:
9. Drive a u_ edge: report_observation(from, realTo, event, confirmed) where realTo IS a graph node → applyObservations mints from→realTo runtime edge; resolvedFroms.has(from); the u_ edge becomes status='dynamic-resolved', accounted=true; nextToVerify drops it; the minted runtime edge is status='runtime', verified=true. (Confirms dynamic resolution mints a CONCRETE witnessed edge, never the synthetic one.)
10. The synthetic u_ edge is never itself given source:'runtime' or a witness by resolution (assert edge.source still 'static', witness.ruleId still 'rr.dynamic-target').

LOOP STATUS / TERMINATION:
11. H5: for any graph, the set of edge-kind ids in nextToVerify(parked) === the set of ids in coverage.open. loopDone true ⇔ both empty AND resolution.openCount===0. (Catches two-source drift.)
12. loopDone honest: a graph with one open `may` edge and zero proposals → loopDone=false; park it → loopDone=true, accountedRatio=1, runtimeRatio still <1. Assert BOTH ratios present in the result.
13. Autonomous until-done terminates: a target the driver can never reach is parked after parkTriesPerTarget; no-progress guard parks the frontier and breaks; round count <= maxRounds; final open set empty; exit summary reports parkedCount by reason-class and both ratios. Assert autonomous parks carry by:'runner' and 'autonomous:' prefix (H4/H6).
14. Back-compat: existing tools.test.ts cases (get_loop_status at tools.test.ts:387-393) still pass — CoverageReport.verified/ratio/unverified unchanged; buildCoverage(graph) with no parked arg behaves as before for those fields.
15. Idempotence: buildCoverage(g, parked) called twice = same report; parkEdge then unparkEdge then recompute = original open set.

## Files

- `packages/core/src/coverage.ts`
- `packages/core/src/coverage.test.ts`
- `packages/core/src/store.ts`
- `packages/core/src/index.ts`
- `packages/mcp/src/tools.ts`
- `packages/mcp/src/tools.test.ts`
- `packages/mcp/src/server.ts`
- `packages/cli/src/runner.ts`
- `packages/cli/src/cli.ts`
- `packages/cli/src/cli.test.ts`
- `packages/cli/src/index.ts`
