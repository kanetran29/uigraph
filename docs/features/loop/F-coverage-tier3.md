# Coverage view + Tier-3 verification runner

- **Slug:** F-coverage-tier3
- **Status:** designed (red-team plan)

## Purpose

Today report_observation (packages/mcp/src/tools.ts:298) is a passive sink: anyone can POST a confirmed/refuted observation, and applyObservations (packages/core/src/runtime.ts:65) folds confirmations into the merged graph as witnessed runtime must-edges, but NOTHING (a) tells an agent which edges still need a runtime witness, or (b) actually drives the app to produce those witnesses. There is also no way to see how much of the proven graph is runtime-confirmed vs static/may-only. This feature adds: (1) a pure coverage metric in @uigraph/core derived from edge.source/witness over the merged graph, surfaced via a new get_coverage MCP tool, a GET /api/coverage serve route, and a Coverage panel in the dashboard right rail; (2) a next_to_verify selector (pure ranking of unverified edges) exposed as an MCP tool so a runner has an explicit worklist; (3) a documented Tier-3 runner design (an external Playwright-driven loop) that consumes next_to_verify, drives the sample app, and calls the EXISTING report_observation path. The runner mints no edges itself; soundness is preserved because the only door into the proven graph remains applyObservations, which already ignores refuted observations and observations referencing unknown nodes.

## Contract & boundary

PURE CORE (packages/core/src/coverage.ts, browser-safe, re-exported from index.ts):

// What counts as runtime-witnessed: an edge whose provenance is a confirmed observation.
function isWitnessed(e: GraphEdge): boolean  // e.source === 'runtime' (witness.source==='runtime')

// Which edges are even candidates for runtime verification: real navigational transitions
// between nodes the runner can drive to. Excludes synthetic containment (those are not real
// edges in graph.edges) and self-loops; includes must/may/unknown of any non-runtime source.
function isVerifiable(graph: UiGraph, e: GraphEdge): boolean

export interface EdgeCoverage {
  edgeId: string
  from: string
  to: string
  fromLabel: string
  toLabel: string
  event: string
  modality: Modality
  source: Source            // static | manual | runtime
  witnessed: boolean        // source === 'runtime'
  observationId: string | null  // witness.observationId when witnessed, else null
}

export interface CoverageReport {
  version: 0
  base: string              // hashValue(merged) for provenance, mirrors Grounding.base
  totalVerifiable: number   // verifiable edges (denominator)
  witnessed: number         // verifiable edges with source==='runtime'
  percent: number           // Math.round(witnessed/totalVerifiable*100), 100 when denominator 0
  byModality: Record<Modality, { total: number; witnessed: number }>
  unverified: EdgeCoverage[]  // verifiable && !witnessed, deterministically ordered
  verified: EdgeCoverage[]    // verifiable && witnessed
}

// Pure projection of the MERGED graph (post applyObservations) into the coverage report.
export function buildCoverage(graph: UiGraph): CoverageReport

// Deterministic ranking of unverified edges into a worklist a runner pops from.
export interface VerifyTarget extends EdgeCoverage { guard: string | null; rank: number }
export interface NextToVerifyResult { base: string; remaining: number; targets: VerifyTarget[] }
export function nextToVerify(graph: UiGraph, opts?: { limit?: number; from?: string }): NextToVerifyResult

MCP TOOLS (packages/mcp/src/tools.ts + server.ts catalogue):
  getCoverage(ctx): CoverageReport                  // tool name get_coverage, no args
  nextToVerifyTool(ctx, args: { limit?; from? }): NextToVerifyResult  // tool name next_to_verify

SERVE API (packages/cli/src/server.ts handleApiRequest): GET /api/coverage -> 200 CoverageReport.

DASHBOARD (apps/dashboard/src/Coverage.tsx + api.ts fetchCoverage): read-only panel; offline fallback computes buildCoverage(SAMPLE_GRAPH) client-side so a static build still shows coverage.

RUNNER (design only, no code in this feature beyond a documented loop in docs/ + a thin scripts/tier3-runner mention): an external process that calls next_to_verify, drives Playwright, and calls report_observation. It does NOT import core write paths.

## Data shapes

EdgeCoverage { edgeId:string; from:string; to:string; fromLabel:string; toLabel:string; event:string; modality:Modality; source:Source; witnessed:boolean; observationId:string|null }
CoverageReport { version:0; base:string; totalVerifiable:number; witnessed:number; percent:number; byModality:Record<Modality,{total:number;witnessed:number}>; unverified:EdgeCoverage[]; verified:EdgeCoverage[] }
VerifyTarget extends EdgeCoverage { guard:string|null; rank:number }
NextToVerifyResult { base:string; remaining:number; targets:VerifyTarget[] }
Observation (existing, runtime.ts:11) { id; from; to; event; effect?; outcome:'confirmed'|'refuted'; proposalId?; screenshot?; ts? } — unchanged; the runner produces these via report_observation. No persisted shape changes anywhere: coverage is computed on read from the merged UiGraph.

## Design

DATA FLOW (no new persistent state — coverage is a pure projection of existing data): report_observation -> store.appendObservation (observations table) -> loadMergedGraph runs applyObservations -> merged graph carries source:'runtime' edges -> buildCoverage(merged) reads edge.source/witness. Coverage needs ZERO schema change; it derives entirely from the merged graph that get_graph / GET /api/graph already serve.

CORE ALGORITHM (coverage.ts, mirrors grounding.ts/proposals.ts: pure, order-stable, invents nothing): labelOf=Map(id->label) (grounding.ts:58 idiom). isVerifiable(graph,e): both endpoints exist AND e.from!==e.to; counts only edges physically in graph.edges (NOT synthetic containment edges that buildAdjacency adds for planning) so coverage measures real transitions only, honoring the golden invariant. buildCoverage iterates graph.edges once: classify each verifiable edge verified/unverified via isWitnessed (source==='runtime'); accumulate byModality; percent = denom===0 ? 100 : round(witnessed/total*100). unverified/verified ordered deterministically by (modality rank must<may<unknown, then from id, then edgeId) for snapshot stability and a stable runner worklist. nextToVerify ranks unverified edges so a runner attacks highest-value gaps first: must=0 (an unproven static must is most important), may=1, unknown=2, tiebreak from id then edgeId; optional from filter; limit caps batch; remaining = full unverified count before limit.

WHY source==='runtime' is the witnessed predicate: applyObservations sets source:'runtime',modality:'must',confidence:1,witness on confirm, UPGRADING the existing edge in place (runtime.ts:84) so no twin. GraphCanvas.tsx:388 already treats source==='runtime' as the superseding witnessed edge and the legend (GraphCanvas.tsx:680) labels it 'runtime (witnessed)'. Coverage reuses that exact predicate so metric and canvas agree.

MCP WIRING: add get_coverage (no props) + next_to_verify ({limit,from}) to TOOLS (server.ts:35), two dispatch cases (server.ts:139) calling getCoverage/nextToVerifyTool, export from tools.ts+index.ts — same shape as getGrounding (tools.ts:146): loadMergedGraph(ctx) then the pure core fn.

SERVE API: GET /api/coverage -> {200, buildCoverage(loadMergedGraph(ctx))} in handleApiRequest beside /api/proposals (server.ts:44); update serve route list (cli.ts:57).

DASHBOARD Coverage.tsx: <section className="coverage"> in App.tsx right rail (between Steps and ProposalsPanel). Header "Coverage (N%)", thin progress bar reusing prop-conf-track/fill (Proposals.tsx:58), byModality chips, "Unverified (k)" expandable list of fromLabel->toLabel · event · modality; row click -> onSelect edge Selection (focuses canvas). api.ts fetchCoverage(): on failure returns buildCoverage(SAMPLE_GRAPH) so offline still renders. App.load() adds fetchCoverage to Promise.all; recomputed after each overlay write since load() re-runs.

TIER-3 RUNNER (documented design + sketch, not wired into core write paths): a standalone async loop, an MCP client or against serve API: while true { const {targets}=await next_to_verify({limit:20}); if !targets.length break; for t of targets { try { plan_path to t.from; drive Playwright (navigate+click path events); attempt t.event; wait until URL/DOM reaches t.to (witness condition); screenshot to <dir>/shots; report_observation({from:t.from,to:t.to,event:t.event,outcome:'confirmed',screenshot,proposalId?}) } catch/timeout/wrong-dest { report_observation({...,outcome:'refuted'}) } } re-fetch coverage }. The runner is the ACTOR; report_observation+applyObservations remain the only writer.

## Soundness

The golden invariant (no proven edge without a deterministic witness; proposals quarantined) is preserved end to end:
- Coverage is a READ-ONLY projection. buildCoverage/nextToVerify never construct GraphEdges and never write — they only classify edges already in the merged graph. They cannot mint a phantom proven transition.
- The runner cannot bypass the witness gate. Its ONLY write is report_observation, which appends to the observations table; the edge only appears because applyObservations (runtime.ts:65) folds a CONFIRMED observation. Refuted observations and observations referencing unknown nodes are dropped there (runtime.ts:77), so a runner that misfires (lands on the wrong screen) and honestly reports outcome:'refuted' produces no edge. A runner that LIES (reports confirmed without reaching t.to) is the trust boundary — same boundary that already exists for report_observation today; this feature does not widen it. The witness it attaches (observationId + screenshot) is the deterministic proof, exactly as runtime.ts:81 requires.
- 'witnessed' === source==='runtime' is consistent with validate.ts provenance rules (a runtime edge must carry a runtime witness) and with the canvas (GraphCanvas.tsx:388/680). Coverage therefore cannot count a static/may edge as witnessed.
- nextToVerify is deterministic (stable ranking), so re-running the runner on the same graph yields the same worklist — the fold stays G = fold(reduce_fn, static ++ obs_log) (runtime.ts header) and coverage is a pure function of it.
- percent with empty denominator returns 100 (a graph with no verifiable edges is vacuously fully covered) — chosen over NaN/0 to avoid a misleading 0% on trivial graphs; documented in the doc-comment.

## Test strategy

TDD — write these first (vitest, mirroring runtime.test.ts/grounding.test.ts using fixtures.ts node()/edge()/graph()):

packages/core/src/coverage.test.ts (buildCoverage):
1. empty graph (no edges) -> totalVerifiable 0, witnessed 0, percent 100, unverified [].
2. one static must edge -> totalVerifiable 1, witnessed 0, percent 0, unverified has it with witnessed:false, observationId:null.
3. apply a confirmed observation then buildCoverage on the merged result (via applyObservations from runtime.ts) -> that edge witnessed:true, observationId set, percent 100, byModality.must.witnessed===1.
4. mixed: one runtime + one static may + one unknown -> percent === round(1/3*100)=33; byModality counts correct.
5. self-loop edge (from===to) excluded from totalVerifiable.
6. manual may edge counts as verifiable-but-unverified (source!=='runtime').
7. determinism: buildCoverage(g).unverified order is stable across two calls and independent of input edge insertion order (shuffle, expect same order).
8. base === hashValue(graph) (provenance binding).

packages/core/src/coverage.test.ts (nextToVerify):
9. ranks an unverified static must-edge ahead of an unverified unknown-edge.
10. limit caps targets but remaining reflects full unverified count.
11. from filter returns only edges leaving that screen.
12. fully-witnessed graph -> targets [] , remaining 0.

packages/mcp/src/tools.test.ts (extend existing): seed a store (openStore(':memory:') pattern already used) with a base graph + one confirmed observation; getCoverage(ctx) returns percent 100; next_to_verify(ctx,{}) on an unwitnessed base returns the edge; assert get_coverage appears in the server TOOLS catalogue and dispatch routes it (mirror existing report_observation dispatch test).

packages/cli/src/ server test: handleApiRequest(ctx,{GET,/api/coverage}) -> status 200 with a CoverageReport shape; unknown still 404.

apps/dashboard: lightweight — a coverage.spec for buildCoverage already covered in core; add a render smoke test only if the dashboard has a test runner (it currently has none, so verify via type-check + manual offline render against SAMPLE_GRAPH).

Runner: no automated test in this feature (it is an integration harness); validate manually by running it against examples/sample-react and asserting coverage percent rises and only confirmed targets become source:'runtime' edges.

## Files to touch

- `packages/core/src/coverage.ts (NEW: buildCoverage, nextToVerify, EdgeCoverage/CoverageReport/VerifyTarget/NextToVerifyResult types — pure, browser-safe)`
- `packages/core/src/coverage.test.ts (NEW: TDD cases above)`
- `packages/core/src/index.ts (export buildCoverage, nextToVerify, and the coverage types)`
- `packages/mcp/src/tools.ts (NEW getCoverage + nextToVerifyTool calling loadMergedGraph then core; export arg/result types)`
- `packages/mcp/src/server.ts (add get_coverage + next_to_verify to TOOLS catalogue and dispatch switch)`
- `packages/mcp/src/index.ts (re-export the two tool fns + their arg/result types)`
- `packages/mcp/src/tools.test.ts (extend: coverage/next_to_verify over an in-memory store)`
- `packages/cli/src/server.ts (handleApiRequest: GET /api/coverage -> buildCoverage(loadMergedGraph(ctx)))`
- `packages/cli/src/cli.ts (serve command: print the new /api/coverage route)`
- `apps/dashboard/src/Coverage.tsx (NEW: read-only coverage panel, edge-focus on row click)`
- `apps/dashboard/src/api.ts (NEW fetchCoverage with offline buildCoverage(SAMPLE_GRAPH) fallback)`
- `apps/dashboard/src/App.tsx (fetch coverage in load(); render <Coverage> in right rail; wire row->setSelection)`
- `apps/dashboard/src/index.css (coverage-* classes, reusing prop-conf bar idiom)`
- `docs/ (NEW: Tier-3 runner loop spec — next_to_verify -> plan_path -> Playwright drive -> report_observation; soundness note that it mints no edges)`

## Dependencies

- packages/core/src/runtime.ts applyObservations (the fold that produces source:'runtime' edges; coverage reads its output and the runner feeds it via report_observation) — already implemented
- packages/mcp/src/tools.ts loadMergedGraph + reportObservation + report_observation tool — already implemented; coverage tools sit beside them and the runner calls report_observation
- packages/core/src/algorithms.ts planPath + reachableFrom — reused by the runner (via the existing plan_path tool) to drive to t.from; no change
- packages/core/src/store.ts observations table + getObservations — the durable observation log coverage is derived from; no change
- packages/core/src/grounding.ts — pattern source for the pure per-graph projection (labelOf map, base=hashValue); no change
- apps/dashboard/src/App.tsx selection/Selection state + Proposals.tsx prop-conf bar — reused by the Coverage panel; App.tsx is edited
- Tier-2 proposals (proposals.ts, F-proposals) — OPTIONAL/soft dep: a verify target may carry a proposalId so a confirmation links back to its proposal; coverage works without proposals present
- examples/sample-react app — system-under-test the documented runner drives; no code change here

## Risks

1. TRUST BOUNDARY: a runner that reports outcome:'confirmed' without truly reaching t.to mints a false runtime edge. This is inherent to report_observation today and NOT widened here, but the runner design must gate confirmation on a real witness condition (URL/DOM assertion + screenshot) and prefer refuted on any ambiguity. Mitigation: document the witness condition as mandatory; keep screenshots as the deterministic evidence trail.
2. VERIFIABLE-SET DEFINITION: choosing what counts in the denominator is a judgement call. Counting control-origin/open-modal edges as verifiable is correct (the runner can drive them) but counting them risks a denominator that balloons when --controls extraction is on, making percent look low. Mitigation: byModality breakdown + the unverified list make the metric explainable rather than a single opaque number; consider a future opts.kinds filter (YAGNI for now).
3. ORDERING DRIFT: if buildCoverage ordering is not fully deterministic, snapshot tests flake and the runner worklist churns. Mitigation: total order by (modality,from,edgeId) with explicit tiebreaks; test 7 asserts shuffle-invariance.
4. DASHBOARD HAS NO TEST RUNNER: Coverage.tsx can't be unit-tested in-repo today. Mitigation: keep all logic in the tested core buildCoverage; the component is a thin renderer; verify via tsc + manual offline render.
5. RUNNER SCOPE CREEP: building the full Playwright runner is large (auth, dynamic guards, flaky waits). This feature delivers the metric + worklist + report path that make the runner POSSIBLE and a documented loop; the runner implementation itself should be a separate follow-up feature to keep this one shippable (KISS/YAGNI).
6. percent=100 on empty denominator could mislead ("100% covered" on a graph with nothing to verify). Mitigation: documented in the doc-comment and the panel shows totalVerifiable so 0/0 is visible.
