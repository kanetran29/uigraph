# AI consumption MCP tools: proposal-graph, screen actions, and verify worklist

- **Slug:** F-ai-mcp-tools
- **Status:** designed (red-team plan)

## Purpose

Three things in uigraph are dead or missing for AI/agent consumption:

1. The stored proposal graph (store.getProposalGraph, packages/core/src/store.ts:183, materialized by materializeProposalGraph in proposals.ts:156) is NEVER exposed over MCP or the serve API — dead data.
2. No "what is on this screen and how do I act on it" tool. get_grounding returns the right substrate (ScreenGrounding: controls + knownEdges, grounding.ts:37-43) but is framed as a reviewer-priming digest, not an agent action menu, and does NOT join in the proposal (may) and unknown outgoing transitions.
3. No prioritized worklist of WHAT to verify next. proposals + over-approximated (may/unknown/dynamic-target) edges are unproven; report_observation turns a confirmed attempt into a witnessed runtime edge, but nothing ranks the unproven items into a verify queue.

This feature adds three model-free, pure, deterministic MCP tools — get_proposal_graph, describe_screen (alias actions_from), and next_to_verify — wired into packages/mcp/src/server.ts, re-exported from packages/mcp/src/index.ts, and surfaced as read-only GET routes in packages/cli/src/server.ts. No LLM, no new persistence, no IR change.

## Contract & boundary

All three are pure functions (ctx: ToolContext, args) => Result over the existing workspace SQLite store, mirroring packages/mcp/src/tools.ts. Read-only; never mutate base/overlay/proposals/observations. Deterministic: same store -> byte-identical result (explicit stable ordering). No LLM, no transport touched in tools.ts (server.ts wires it), preserving the model-free guarantee at tools.ts:1-6.

Golden-invariant boundary: strictly read/advisory. Surface unproven candidates flagged unproven; never mint/upgrade/persist an edge. The only candidate -> proven path stays report_observation -> applyObservations (runtime.ts), unchanged. next_to_verify emits the EXACT report_observation arg object per item; calling it stays the agent's separate action.

get_proposal_graph: GetProposalGraphArgs { screen?: string } -> GetProposalGraphResult { nodes: ProposalGraphNode[]; edges: ProposalGraphEdge[]; nodeCount: number; edgeCount: number }. Returns store.getProposalGraph() (already materialized on every setBaseGraph/setProposals); screen filters edges to e.from===screen and prunes nodes to screen + kept-edge targets. Empty on empty workspace, never throws. pe_*/ps_* ids stay separate from the proven id space.

describe_screen (MCP name describe_screen; alias actions_from): DescribeScreenArgs { screen: string }. ScreenControl { id; element; controlType; name?; events: string[]; effects: string[] }. ScreenAction { via:'edge'|'proposal'; from; to; toLabel; event; guard:string|null; effect:string|null; modality:Modality; source:'static'|'manual'|'runtime'|'proposal'; proven:boolean; dynamicTarget:boolean; proposalIds?:string[] }. DescribeScreenResult { screen; label; route:string|null; kind:NodeKind; controls: ScreenControl[]; actions: ScreenAction[]; found:boolean }. Builds grounding for controls + proven knownEdges (already parent-attributed, grounding.ts:63-90); appends proposal-graph edges from===screen as via:'proposal' proven:false. found:false (no throw) when id is not a non-control node; throws 'no base graph' when the workspace has no graph.

next_to_verify: NextToVerifyArgs { screen?: string; limit?: number; minConfidence?: number }. VerifyKind = 'proposal'|'may-edge'|'dynamic-target'. VerifyItem { kind; priority:number; screen; from; to; toLabel; event; guard:string|null; confidence:number; reason:string; proposalId?; edgeId?; suggestedObservation: ReportObservationArgs }. NextToVerifyResult { total:number; items: VerifyItem[] }. Ranks unproven candidates, drops already-confirmed pairs, emits a ready-to-call report_observation per item.

All new types live in tools.ts, re-exported from index.ts, REUSING core types (ProposalGraph/Node/Edge, Modality, NodeKind, Source, ReportObservationArgs) — no core/IR change. suggestedObservation IS ReportObservationArgs (tools.ts:279-287), so an agent feeds it straight into report_observation — the link that closes the verify loop.

## Design

FILES: packages/mcp/src/tools.ts (tool bodies; existing pure-fn + withStore/loadMergedGraph pattern). packages/mcp/src/server.ts (TOOLS catalogue + dispatch cases). packages/mcp/src/index.ts (re-export fns + types). packages/cli/src/server.ts (read-only GET routes).

get_proposal_graph: withStore(ctx, s => s.getProposalGraph()); no loadMergedGraph, so empty-workspace-safe. Filter when screen set: kept = edges.filter(e=>e.from===screen); keptIds = new Set([screen, ...kept.map(e=>e.to)]); nodes = pg.nodes.filter(n=>keptIds.has(n.id)); counts from filtered arrays. Ordering already deterministic (materializeProposalGraph in proposal/rowid order, store.ts:202).

describe_screen: g = loadMergedGraph(ctx); grounding = buildGrounding(g); sg = grounding.screens.find(s=>s.screen===args.screen); n = g.nodes.find(id===screen). If !n || n.kind==='control' => found:false with empty controls/actions and best-effort label/route/kind. controls = sg.controls 1:1. dynSinks = Set of g.nodes where kind==='unknown' && label startsWith 'dynamic'. proven actions = sg.knownEdges.map(e => via:'edge', proven: e.source!=='proposal', dynamicTarget: dynSinks.has(e.to), carrying from/to/toLabel/event/guard/effect/modality/source. proposal actions: pg = store.getProposalGraph() (same withStore); for pe of pg.edges where pe.from===screen append via:'proposal', toLabel from a Map over g.nodes ∪ pg.nodes, modality:pe.modality, source:'proposal', proven:false, proposalIds:pe.proposalIds. Sort: proven edges first (from,to,event), then proposals (to,event). Joins get_grounding's proven data with the previously-dead proposal graph into an action menu.

next_to_verify (heart): merged = loadMergedGraph(ctx); then withStore for queryProposals(filter) + getObservations() + getProposalGraph(). provenPairs = Set of `${o.from}->${o.to}` for confirmed observations (drops already-verified candidates). Candidates: (a) proposals status==='proposed' (skip confirmed/rejected): kind='proposal', priority = p.confidence + (p.evidenced?0.5:0), from=p.screen; resolve concrete to by finding the pg edge whose proposalIds includes p.id (REUSE materialized mapping, no proposalStateKind re-impl); a micro-interaction proposal with NO pg edge is EXCLUDED. suggestedObservation = {from,to,event:p.event??'interact',outcome:'confirmed',proposalId:p.id}. (b) edges modality==='may' && source!=='runtime': kind='may-edge', priority=e.confidence+0.3, edgeId=e.id. (c) edges modality==='unknown' (dynamic-target sinks, ruleId rr.dynamic-target, conf 0.3): kind='dynamic-target', priority=e.confidence+0.1, edgeId=e.id. Tier ordering proposals(+evidenced) > may > dynamic. Drop from->to in provenPairs; apply minConfidence and screen (edges use parentOf like grounding). Sort priority desc, tiebreak (proposalId??edgeId) asc; slice to limit (default 50); total = pre-slice count. Priority is a pure additive formula — deterministic, explainable, no LLM, no clock.

server.ts: 3 Tool entries with JSON-Schema inputSchema (describe_screen requires screen; others all-optional) + descriptions stressing 'unproven candidate' semantics and next_to_verify -> report_observation. 3 dispatch cases using the cast-from-wire pattern at server.ts:140-153.

cli/src/server.ts: KISS — exact-match GETs /api/proposal-graph -> getProposalGraph(ctx) and /api/next-to-verify -> nextToVerify(ctx), mirroring /api/proposals (server.ts:52-54). describe_screen stays MCP-only (path-param routing would force a router rewrite; YAGNI). Import new fns from @ui-graph/mcp (CLI already imports updateGraph/loadMergedGraph there, server.ts:9-10).

Soundiness: golden invariant preserved — tools are read-only/advisory. (1) None call setBaseGraph/setOverlay/setProposals/appendObservation. (2) get_proposal_graph keeps the quarantined pe_*/ps_* id space separate from the proven graph; proposal edges are 'may'|'unknown' only. (3) describe_screen tags every action proven:boolean + source; proposals are proven:false; dynamicTarget flags over-approximated sinks. (4) next_to_verify only ranks + emits a suggestedObservation; proof flows solely through report_observation -> applyObservations (runtime.ts:65). The drop-already-confirmed filter uses confirmed observations, so the queue cannot re-surface a proven transition. (5) Determinism: additive priority + explicit stable sort -> byte-identical JSON; no clock/randomness (next_to_verify never timestamps; only report_observation does).

Risks: (1) suggestedObservation defaults outcome:'confirmed' — an agent could echo it without attempting, minting a false runtime edge; mitigate with description + comment that outcome is a placeholder to set from the real result (same trust boundary report_observation already has). (2) Resolving a proposal's concrete to when p.to is absent/token: reuse the materialized pg edge by proposalIds (no proposalStateKind duplication); micro-interaction proposals with no pg edge are excluded. (3) Cost O(nodes+edges) per call, matching get_grounding; no speculative optimization. (4) Exact-match CLI router (server.ts:44-62) -> only no-arg GETs exposed. (5) Hand-tuned priority weights -> small explicit formula covered by ordering tests, no configurable ranker (YAGNI). (6) describe_screen/next_to_verify throw 'no base graph' on an empty workspace (consistent with get_grounding/plan_path), so /api/next-to-verify 400s there — intentional, pinned by tests.

DASHBOARD (optional follow-on, NOT required): api.ts fetchProposalGraph()/fetchNextToVerify() with the offline-fallback pattern (api.ts:48-56); GraphCanvas ghost-overlay for proposal edges.

## Test strategy

TDD: write tests in the existing packages/mcp/src/tools.test.ts FIRST (reuse its temp-SQLite harness: newWorkspace/chainWorkspace/seedProposals/seedOverlay, node()/edge()/graph(), proposal() factory), then implement to green. Add CLI route tests in packages/cli/src/cli.test.ts (or a focused handleApiRequest test).

get_proposal_graph: empty workspace -> {nodes:[],edges:[],nodeCount:0,edgeCount:0}, no throw. seed a 'disclosure' interaction proposal on 'a' (no real to) -> synth node ps_a__expanded + edge pe_a->ps_a__expanded proposalIds:['p1']. proposal to:'b' -> edge pe_a->b. screen filter (props from a and b) -> only a-origin edges, b-only nodes pruned, counts reflect filter. determinism: two calls deep-equal.

describe_screen: unknown id -> {found:false, controls:[], actions:[]}, no throw. control id as screen -> found:false. screen 'a' with control cc_a_btn witnessed -> 'b' (reuse getGrounding fixture, tools.test.ts:150-168) -> controls:[cc_a_btn], action {via:'edge',from:'cc_a_btn',to:'b',proven:true,modality:'must'}. add a may proposal to:'b' -> also action {via:'proposal',to:'b',proven:false,proposalIds:['p1']}. dynamicTarget: unknown sink node + a->sink unknown edge -> action dynamicTarget:true, modality:'unknown'. no base graph -> throws 'no base graph'.

next_to_verify: p1(.9,evidenced)/p2(.2,!ev)/p3(.7,ev) -> order p1>p3>p2, total 3. mix may-edge(.5)+dynamic-target(.3)+proposal(.9,ev) -> order proposal,may,dynamic. already-verified dropped: report_observation a->b confirmed -> no candidate from a/to b, total -1. refuted does NOT drop. rejected/confirmed proposals excluded (only 'proposed'). screen + minConfidence narrow; limit slices but total = pre-slice. suggestedObservation: proposal item proposalId===p.id, outcome 'confirmed', and reportObservation(ctx,item.suggestedObservation) round-trips (appends one obs). micro-interaction proposal with no pg edge excluded. determinism + stable tiebreak on equal priority.

server/dispatch: dispatch routes the 3 names; unknown-screen describe_screen -> non-error CallToolResult (isError undefined); no-base-graph call -> isError:true via server.ts:137-159 try/catch.

cli router: GET /api/proposal-graph -> 200 {nodes,edges,...} (empty-safe); GET /api/next-to-verify -> 200 {total,items} with a base graph; empty workspace 400s via the existing router catch (server.ts:44-62) — pin as the documented contract.

## Files to touch

- `packages/mcp/src/tools.ts`
- `packages/mcp/src/tools.test.ts`
- `packages/mcp/src/server.ts`
- `packages/mcp/src/index.ts`
- `packages/cli/src/server.ts`
- `packages/cli/src/cli.test.ts`

## Dependencies

- @ui-graph/core store.getProposalGraph + materializeProposalGraph (store.ts:183, proposals.ts:156) - ALREADY IMPLEMENTED; this feature only exposes it. No core change.
- @ui-graph/core buildGrounding / ScreenGrounding / GroundedControl / GroundedEdge (grounding.ts) - reused as describe_screen's substrate. ALREADY IMPLEMENTED.
- @ui-graph/core runtime.applyObservations/getObservations + tools.reportObservation/ReportObservationArgs (runtime.ts, tools.ts:279) - next_to_verify reads confirmed observations to prune and reuses ReportObservationArgs. ALREADY IMPLEMENTED; unchanged.
- @ui-graph/mcp existing plumbing: ToolContext, withStore, loadMergedGraph, dispatch/TOOLS (tools.ts, server.ts) - extended in place.
- OPTIONAL downstream (NOT required to land): apps/dashboard (api.ts, GraphCanvas.tsx) to visualize the proposal graph + verify list - a separate UI feature consuming /api/proposal-graph and /api/next-to-verify.
