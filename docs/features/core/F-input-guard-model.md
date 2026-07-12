# Input-constraint model on controls + guard-aware planning (preconditions surfaced, never decided)

- **Slug:** F-input-guard-model
- **Status:** designed (red-team plan)

## Purpose

Codegen and planning consumers (LLM agents over the MCP server, and the dashboard) cannot act on two things they need:

1. INPUT VALUES. A `control` node carries ControlMeta { element, controlType, name?, events?, effects? } (packages/core/src/ir.ts:30-36) but nothing about what to TYPE into a control: no required-ness, no value type, no validation pattern, no example. An agent told "fill the checkout form" has no machine-readable field contract. Meanwhile packages/core/src/openapi.ts already recovers per-endpoint request fields (ApiField { name, type, required }) from an OpenAPI spec, but that artifact is orphaned: it is only ever written/read as a JSON sidecar (packages/core/src/node.ts:72-80), never stored in SQLite, never surfaced through MCP/CLI/dashboard, and never bound back to the controls whose api:* effects it describes.

2. ACTIONABLE GUARDS. planPath (packages/core/src/algorithms.ts:65-101) is pure BFS that IGNORES GraphEdge.guard. It returns a route to Checkout through a may-edge guarded by isAuthenticated with no signal that login is a precondition. planPathTool (packages/mcp/src/tools.ts:184-199) copies each step's guard into the output but never aggregates the path's preconditions and offers no way to prefer a guard-free route. Consumers receive infeasible plans with no warning of what must be satisfied first.

This feature (a) adds an input-constraint model to ControlMeta, optionally populated from OpenAPI, and (b) makes planning guard-AWARE: it surfaces the ordered guards along a planned path as explicit preconditions and can prefer routes with fewer guards — while keeping guards strictly symbolic (read, never evaluated), so the golden invariant is untouched.

## Contract & boundary

SCOPE BOUNDARY (core/pure vs node/IO vs adapter vs surface):

A. CORE/PURE (packages/core/src), framework-agnostic, browser-safe, no node:fs:
- ir.ts: extend ControlMeta with optional `inputs?: InputConstraint[]`; add the InputConstraint type. Purely additive — every field optional, so all existing graphs, fixtures, validators and the schema check remain valid with zero migration.
- openapi.ts: add bindInputs(graph, spec), a PURE function returning a NEW graph in which each control node whose effects contain an api:* effect resolvable against the spec gets control.inputs derived from that operation's ApiField[]. Never mutates input. Reuses existing summarizeApiEffect. Maps ApiField{name,type,required} -> InputConstraint{name,type,required,source:'openapi'} (+ pattern/example when declared).
- algorithms.ts: add summarizePreconditions(steps): Precondition[] (ordered, deduped non-null guards along a PlanStep[]); add PlanPathOptions.preferGuardFree?: boolean and a guard-count tiebreak. planPath STILL ignores guard for FEASIBILITY (a guarded edge is always traversable); preferGuardFree only chooses among equal-length paths.

B. NODE/IO (node.ts, store.ts): NO new persistence schema. bindInputs runs at map time so bound inputs live inside the base-graph JSON already stored in the docs table. CLI loads the spec via the existing loadOpenApi (node.ts:65).

C. ADAPTERS: NOT touched. Inputs come from OpenAPI binding (source:'openapi'), not framework heuristics — keeping the constraint model framework-agnostic and avoiding speculative per-framework guessing (YAGNI). controlType already distinguishes input/checkbox/file/select/richtext/form (extract.ts:394-428); binding attaches the contract.

D. SURFACES:
- MCP (tools.ts): PlanPathStep stays; add preconditions: Precondition[] and guardCount: number to PlanPathResult, and preferGuardFree? to PlanPathArgs. getGraph already returns controls verbatim so control.inputs flows through unchanged. Update plan_path JSON-Schema in server.ts.
- CLI: add --openapi <file> to map; thread through runMap; report boundControls.
- Dashboard (Inspector.tsx, Steps.tsx): render control.inputs in the control inspector; render the planned path's preconditions banner in Steps.

GOLDEN-INVARIANT CONTRACT:
- InputConstraint.source ('openapi'|'manual') is DOCUMENTATION provenance, a distinct union from ir.ts Source ('static'|'manual'|'runtime'). It never appears on a GraphEdge/Witness and never interacts with validate.ts Source checks. No edge is added/changed/promoted; bindInputs writes only node.control.inputs (validateGraph never reads it — verified).
- Guards stay symbolic, never evaluated for feasibility. preferGuardFree is a tiebreak between EQUAL-length paths, so it cannot hide a shorter route or fabricate reachability. Preconditions are reported text, never booleans.

## Data shapes

InputConstraint { name: string; type: string; required: boolean; pattern?: string; example?: string; source: 'openapi' | 'manual' } added to ir.ts; ControlMeta gains inputs?: InputConstraint[]. Precondition { guard: string; stepIndex: number } added to algorithms.ts. ApiField (openapi.ts) gains optional pattern?: string; example?: string. PlanPathOptions gains preferGuardFree?: boolean. MCP PlanPathArgs gains preferGuardFree?: boolean; PlanPathResult gains preconditions: Precondition[] and guardCount: number. CLI RunMapOptions gains openapi?: string; MapSummary gains boundControls: number.

## Design

ALGORITHM 1 — bindInputs (packages/core/src/openapi.ts), pure, reuses summarizeApiEffect:

  export function bindInputs(graph: UiGraph, spec: Json): UiGraph {
    const nodes = graph.nodes.map((n) => {
      if (n.kind !== 'control' || n.control === undefined) return n
      const apiEffect = (n.control.effects ?? []).find((e) => e.startsWith('api:'))
      if (apiEffect === undefined) return n
      const summary = summarizeApiEffect(spec, apiEffect)
      if (summary === null) return n              // unmatched -> unchanged (drift, reported via existing `unmatched`)
      const inputs = summary.request.map(fieldToConstraint)
      if (inputs.length === 0) return n
      return { ...n, control: { ...n.control, inputs } }
    })
    return { ...graph, nodes }
  }
  fieldToConstraint(f) = { name:f.name, type:f.type, required:f.required, source:'openapi', ...(f.pattern?{pattern:f.pattern}:{}), ...(f.example?{example:f.example}:{}) }

ApiField gains optional pattern?/example?; requestFields (openapi.ts:110-125) reads schema['pattern']/schema['example'] when present — additive, defaults absent.

DATA SHAPES (exact TS):
  // ir.ts
  export interface InputConstraint { name: string; type: string; required: boolean; pattern?: string; example?: string; source: 'openapi' | 'manual' }
  export interface ControlMeta { element: string; controlType: string; name?: string; events?: string[]; effects?: string[]; inputs?: InputConstraint[] }
  // algorithms.ts
  export interface Precondition { guard: string; stepIndex: number }   // 1-based step whose edge first introduces the guard
  export interface PlanPathOptions { allow?: Modality[]; preferGuardFree?: boolean }

ALGORITHM 2 — summarizePreconditions (algorithms.ts), pure, no evaluation:
  export function summarizePreconditions(steps: PlanStep[]): Precondition[] {
    const out: Precondition[] = []; const seen = new Set<string>()
    steps.forEach((s, i) => { const g = s.edge.guard; if (g !== null && !seen.has(g)) { seen.add(g); out.push({ guard: g, stepIndex: i + 1 }) } })
    return out
  }

ALGORITHM 3 — guard-aware planPath tiebreak (algorithms.ts:65-101). Keep the shortest-length BFS exactly. When preferGuardFree is true, among paths of EQUAL shortest length pick the one with fewest guarded edges, via a two-key relaxation over the same frontier:
  - Keep dist (edge count, fixed by the unchanged first BFS pass) and guards (cumulative guarded-edge count) per node, predecessor edge in prev. g(e) = e.guard !== null ? 1 : 0.
  - Relax neighbor `to` via edge `e` only on a shortest path: newDist = dist[from]+1; accept when newDist < dist[to] (as today) OR (preferGuardFree && newDist === dist[to] && guards[from]+g(e) < guards[to]). On the equal-dist guard-improving case set guards[to] and prev.set(to,e). Simplest correct realization: first BFS pass fixes dist (byte-identical to today); a second pass over dist-layered edges minimizes guards in layer order. Both O(V+E). When preferGuardFree is false the function is byte-identical to today (default off). GUARANTEE: returned path length equals plain planPath's length (covers risk 1, test 11).

MCP planPathTool (tools.ts:184-199): call planPath with { ...(allow), ...(preferGuardFree) }; then preconditions = path ? summarizePreconditions(path) : [], guardCount = preconditions.length; return both on PlanPathResult. PlanPathArgs gains preferGuardFree?: boolean. server.ts plan_path inputSchema gains preferGuardFree: { type:'boolean' } and the description documents preconditions/guardCount.

CLI: RunMapOptions gains openapi?: string; MapSummary gains boundControls: number. In runMap (commands.ts:85): after extract, let g = graph; let bound = 0; if (opts.openapi) { const spec = loadOpenApi(opts.openapi); const before = countControlsWithInputs(graph); g = bindInputs(graph, spec); bound = countControlsWithInputs(g) - before } then store.setBaseGraph(g, soundiness) (re-validates -> invalid can never persist). formatMapSummary adds a `bound controls: N` line. cli.ts map adds .option('--openapi <file>', 'OpenAPI spec to bind control input contracts from') and passes opts.openapi.

DASHBOARD UI:
- Inspector.tsx control branch (lines 103-143): after the effects list add <h3>inputs</h3> listing each c.inputs entry as `name : type` with a required chip (reuse Badge) and example/pattern as muted subtext; empty-state <p className="muted">No input contract.</p> matching the existing 'No effects.' pattern. Optional-chaining throughout (sample-graph.json may lack inputs — risk 7).
- Steps.tsx: after computing path (lines 86-89), const preconditions = useMemo(() => path ? summarizePreconditions(path) : [], [path]); render a banner above the steps list when non-empty: "Preconditions: isAuthenticated (before step 2), …" so a user sees what must hold before the route is feasible. Import summarizePreconditions from @uigraph/core (browser-safe).

index.ts re-exports: add InputConstraint (ir.ts), summarizePreconditions + Precondition (algorithms.ts), and bindInputs (openapi.ts).

DOCS: append a short subsection to docs/30-ir-spec-v0.md §6 noting input constraints carry their own documentation provenance and that guard-aware planning reports preconditions but never evaluates guards.

## Soundness

The golden invariant (docs/30-ir-spec-v0.md §4, §6; enforced by packages/core/src/validate.ts): no proven edge without a deterministic witness; guards are symbolic source text NEVER evaluated; proposals quarantined. This feature is invariant-preserving by construction:

1. NO NEW/CHANGED EDGES. bindInputs writes ONLY node.control.inputs; adds/removes/promotes no GraphEdge and touches no edge field, witness, modality, source, or confidence. validateGraph (validate.ts:30-64) inspects edges and node parent refs only (the sole node check is DANGLING_PARENT) — it never reads control.inputs — so a bound graph passes validateGraph unchanged. runMap calls store.setBaseGraph AFTER binding; setBaseGraph re-validates (store.ts:98-101), so an invalid bind could never persist.

2. PROVENANCE NOT CONFLATED. InputConstraint.source ('openapi'|'manual') is documentation provenance, a DISTINCT union from ir.ts Source ('static'|'manual'|'runtime'). It lives on ControlMeta only, never on an edge/witness, so it cannot satisfy or violate UNWITNESSED / WITNESS_PROVENANCE / MUST_PROVENANCE / MANUAL_IN_BASE. 'openapi' is honest: the constraint came from the spec, which may drift from code — the drift openapi.ts already reports via unmatched.

3. GUARDS STAY SYMBOLIC AND UNDECIDED. summarizePreconditions copies guard TEXT and parses/evaluates nothing (IR spec §6: "uigraph never evaluates it"). preferGuardFree is a tiebreak among EQUAL shortest-length paths: it can only reorder equally-optimal routes, never suppress a shorter one nor invent reachability, because relaxation stays within the dist-minimal frontier (dist[to] fixed by the unchanged first BFS pass). Planning still treats every guarded edge as TRAVERSABLE — uigraph does not decide isAuthenticated is false and prune the edge; it REPORTS the precondition and lets the consumer satisfy it. Soundness-correct direction: over-approximate reachability (never miss a real route), under-claim feasibility (warn about preconditions). A wrong/over-broad guard at worst adds a spurious precondition note; it can never mint a phantom proven transition nor hide a real one.

4. ADDITIVE/BACKWARD-COMPATIBLE. inputs?, pattern?, example?, preferGuardFree?, preconditions are all optional. Default planPath behaviour is byte-identical (preferGuardFree default off), so algorithms.test.ts holds verbatim. Graphs produced without --openapi are identical to today.

RESIDUAL RISK (honest soundiness): OpenAPI is the backend's declared contract and can drift from the running app; a bound required:true or pattern may be stale. This is reported-not-decided documentation, the consumer still verifies at runtime via report_observation, and openapi.ts's unmatched list already flags code<->docs drift — so binding only ATTACHES documentation, never gates a transition.

## Test strategy

TDD — write these tests first (vitest, reusing fixtures.ts builders node()/edge()/graph() and the spec object in openapi.test.ts). Concrete cases:

A. packages/core/src/openapi.test.ts — bindInputs:
1. Binds inputs from a control's api effect: control with control.effects ['api:POST /api/orders'] gets control.inputs === [{name:'email',type:'string',required:true,source:'openapi'}, {name:'notes',required:false,...}, {name:'items',type:'array<number>',required:false}] (reuse existing spec; assert names/required/type).
2. Purity: input graph not mutated (deep-equal a structuredClone after calling; returned graph is a different ref; source control still has no inputs).
3. Unmatched effect leaves control unchanged: effects ['api:POST /api/ghost'] -> no inputs key (undefined, not []).
4. Control with no api effect (effects ['state:setCart']) -> unchanged.
5. pattern/example propagate when the schema property declares them (extend a fixture property; assert on the InputConstraint).
6. First-matching-effect rule: control with two api effects, only the second resolvable -> binds from the second.

B. packages/core/src/algorithms.test.ts — guard-aware planning (extend existing g):
7. summarizePreconditions: path with step guards 'isAuth', null, 'isAuth', 'isAdmin' -> [{guard:'isAuth',stepIndex:1},{guard:'isAdmin',stepIndex:4}] (ordered, deduped, 1-based).
8. summarizePreconditions([]) === [] and an all-null-guard path === [].
9. Default planPath unchanged: re-run the EXISTING cases (must still pass) — backward-compat proof.
10. preferGuardFree picks the guard-free equal-length route: two length-2 paths a->x->c (x edges guarded) and a->y->c (unguarded); planPath(a,c,{preferGuardFree:true}) routes via y; plain planPath(a,c) length is also 2; chosen path guardCount 0.
11. preferGuardFree NEVER lengthens: only-shortest route is guarded -> preferGuardFree still returns that route (no detour to a longer guard-free one); length equals plain planPath.

C. packages/mcp/src/tools.test.ts — planPathTool:
12. Result includes preconditions (deduped) and guardCount for a guarded route; unguarded route -> preconditions:[], guardCount:0.
13. preferGuardFree:true forwarded to core (two equal routes; assert chosen edge ids).
14. getGraph round-trips control.inputs for a control bound at map time (store a graph whose control has inputs; assert getGraph returns them).

D. packages/cli/src/cli.test.ts — runMap --openapi:
15. runMap with opts.openapi -> stored base graph has inputs on a known control (open store, getBaseGraph, assert); MapSummary.boundControls > 0.
16. runMap without opts.openapi -> controls have no inputs (additivity regression guard).

E. Validation regression (validate.test.ts or store.test.ts):
17. A graph with control.inputs populated passes validateGraph with zero errors and setBaseGraph accepts it (golden-invariant check unaffected).

Run gate: repo vitest green across packages plus tsc --noEmit on touched packages. No Playwright — every unit is pure.

## Files to touch

- `packages/core/src/ir.ts`
- `packages/core/src/openapi.ts`
- `packages/core/src/openapi.test.ts`
- `packages/core/src/algorithms.ts`
- `packages/core/src/algorithms.test.ts`
- `packages/core/src/index.ts`
- `packages/mcp/src/tools.ts`
- `packages/mcp/src/tools.test.ts`
- `packages/mcp/src/server.ts`
- `packages/cli/src/commands.ts`
- `packages/cli/src/cli.ts`
- `packages/cli/src/cli.test.ts`
- `apps/dashboard/src/Inspector.tsx`
- `apps/dashboard/src/Steps.tsx`
- `docs/30-ir-spec-v0.md`

## Dependencies

- F0.4 core IR types (ControlMeta in packages/core/src/ir.ts) - DONE
- F1.6 graph algorithms reachability + plan_path BFS (packages/core/src/algorithms.ts) - DONE; this feature extends planPath
- OpenAPI binding module (packages/core/src/openapi.ts: summarizeApiEffect/collectApiEffects/buildApiBindings + ApiField) - DONE; this feature adds bindInputs reusing it
- Controls extraction (adapter-react extract.ts opts.controls path emitting control nodes with api:* effects) - DONE; inputs binding depends on controls being present
- M4 CLI map command + loadOpenApi node helper (packages/cli + packages/core/src/node.ts:65) - DONE; this feature adds --openapi
- M5 MCP plan_path tool (packages/mcp/src/tools.ts planPathTool + server.ts schema) - DONE; this feature extends its result
- SQLite store base-graph persistence (packages/core/src/store.ts setBaseGraph) - DONE; no schema change, binding happens before persist

## Risks

1. ALGORITHM-CORRECTNESS REGRESSION (highest). The preferGuardFree tiebreak must NOT alter the default path nor return a non-shortest route. Mitigation: default-off; test 9 re-runs the existing planPath suite verbatim; test 11 asserts preferGuardFree never lengthens; keep the shortest-length BFS first pass exactly, minimize guards only within the dist-minimal frontier.

2. SOUNDNESS DRIFT. Temptation to prune guarded edges or decide feasibility would violate IR spec §6. Mitigation: forbidden by contract; preconditions are reported text; preferGuardFree is a tiebreak only; review must confirm no boolean evaluation of guard strings anywhere.

3. OPENAPI<->CODE DRIFT (data quality, not safety). A bound required/pattern may be stale. Mitigation: source:'openapi' makes provenance explicit; existing unmatched reports drift; consumer verifies via report_observation. Documented as residual soundiness, not a defect.

4. MULTI-EFFECT AMBIGUITY. A control with several api:* effects. Mitigation: bind the FIRST resolvable (KISS), tested in test 6; revisit only on a real multi-endpoint control (YAGNI).

5. SCHEMA/SHAPE CHECK. validateGraphShape (schema.ts) might reject the new ControlMeta field. Mitigation: read schema.ts before coding; inputs is optional/additive; test 17 asserts validateGraph stays green. Existing optional events?/effects? already pass, so an extra optional array should too — verify, do not assume.

6. DASHBOARD TYPE FLOW / BROWSER-SAFETY. Adding inputs to ControlMeta and Precondition+summarizePreconditions to algorithms must stay browser-safe (no node:fs). Mitigation: both live in already-browser-safe modules (ir.ts, algorithms.ts) re-exported from index.ts; Steps.tsx already imports from @uigraph/core.

7. BUNDLED SAMPLE GRAPH. apps/dashboard/src/sample-graph.json likely lacks inputs; Inspector/Steps must render gracefully when inputs/preconditions are absent. Mitigation: optional-chaining + empty-state copy matching the existing 'No effects.' pattern.
