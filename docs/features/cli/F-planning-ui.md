# Human planning tool: add/edit nodes, named scenarios, export spec

- **Slug:** F-planning-ui
- **Status:** designed (red-team plan)

## Purpose

Turn the dashboard from an edge-only annotator into a real planning surface. Today the dashboard can only add/edit/delete EDGES (App.tsx handleConnect/handleEditEdge/handleDelete -> updateGraph addEdge/editEdge/remove) and runs against a single anonymous overlay (store key 'overlay'); update_graph already supports addNode but nothing in the UI emits it. This feature lets a human (a) create a new screen node, edit an existing node's label/route, and attach a control to a screen; (b) keep MULTIPLE named scenarios (named overlays) they can toggle/compare; and (c) export the active scenario as a markdown feature spec (new screens, new transitions, touched controls) for a dev or agent to implement. The base graph stays immutable; all edits land in the selected named overlay; validateOverlay + the stale-base-hash guard remain the soundness backbone (proven edges never gain a non-witnessed sibling in the base; manual additions stay quarantined as source:'manual', modality may/unknown, witness undefined).

## Contract & boundary

Two boundaries, both additive — no existing signature changes, so the golden invariant code paths (validateGraph/validateOverlay/validateMerged/mergeOverlay/loadMergedGraph stale-hash) are untouched.

CORE (@ui-graph/core), framework-agnostic, pure, browser-safe (no node:fs):
1. ir.ts — extend Overlay with two OPTIONAL fields so old overlays still parse:
   `name?: string` and `editedNodes?: GraphNode[]`. Default semantics: absent name => the legacy default scenario; absent editedNodes => `[]`.
2. overlay.ts — extend mergeOverlay to apply editedNodes (replace base node by id, like editedEdges replaces base edge by id). New pure helpers:
   - `applyNodeOp(base: UiGraph, overlay: Overlay, op: NodeOp): Overlay` — pure, returns a NEW overlay with addNode/editNode/attachControl applied (base passed so it can route an editNode to editedNodes vs addedNodes and reject editing a non-base id). Used by both MCP and the planning store path so logic cannot drift.
   - `exportPlanMarkdown(base: UiGraph, overlay: Overlay): string` — renders the overlay as a feature spec (see design). Pure string builder, no IO.
3. validate.ts — extend validateOverlay to also validate editedNodes via the existing node shape check + manual-purity for any edges; keep it base-free (the can't-edit-a-non-base-node rule lives in applyNodeOp where base is in hand).
4. schema.ts — validateOverlayShape: accept optional `name` (string) and optional `editedNodes` (array of node shape).

STORE (@ui-graph/core/store.ts) — named scenarios = named overlays, reusing the docs table with namespaced keys (`overlay:<name>`, `overlay_active`):
   - `listOverlays(): { name: string }[]`
   - `getOverlayByName(name: string): Overlay | null`
   - `setOverlayByName(name: string, overlay: Overlay): void` (validates via validateOverlay before write, like setOverlay)
   - `deleteOverlay(name: string): void`
   - `getActiveOverlayName(): string | null` / `setActiveOverlayName(name: string): void`
   Backward compat: existing `getOverlay()/setOverlay()` resolve through the active name with a legacy `overlay`-key fallback, so loadMergedGraph, updateGraph and the serve API are unchanged.

MCP (@ui-graph/mcp/tools.ts) — extend UpdateOp with two node ops + scenario arg (all back-compat):
   - UpdateOp gains `{ kind: 'editNode'; node }` and `{ kind: 'attachControl'; parent; control; label? }` (addNode already typed).
   - UpdateGraphArgs gains optional `scenario?: string`; absent => active/default. New pure tools `listScenarios(ctx)` and `exportPlan(ctx, { scenario? })`.
   - register `export_plan` + `list_scenarios` in server.ts TOOLS + dispatch.

CLI serve API (@ui-graph/cli/server.ts) — additive routes reusing MCP logic:
   - `GET /api/scenarios` -> `{ active, scenarios:[{name}] }`; `POST /api/scenarios/active` `{ name }`; `GET /api/plan?scenario=` -> `{ scenario, markdown }`; `POST /api/overlay` body grows optional `{ op, scenario? }`.

DASHBOARD (apps/dashboard) — api.ts mirrors the new UpdateOp + scenario; App.tsx gains node add/edit + attach-control handlers, a scenario switcher, and an Export-plan action.

## Data shapes

// ir.ts — Overlay grows two OPTIONAL fields (back-compat; absent => default scenario, [] editedNodes)
export interface Overlay {
  version: 0
  base: string
  name?: string                 // scenario name; absent => 'default'
  addedNodes: GraphNode[]
  addedEdges: GraphEdge[]
  editedEdges: GraphEdge[]
  editedNodes?: GraphNode[]      // replace base node by id in merge
  removedRefs: string[]
}

// overlay.ts
export type NodeOp =
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'editNode'; node: GraphNode }
  | { kind: 'attachControl'; parent: string; control: ControlMeta; label?: string }
export function applyNodeOp(base: UiGraph, overlay: Overlay, op: NodeOp): Overlay
export function exportPlanMarkdown(base: UiGraph, overlay: Overlay): string
// mergeOverlay signature unchanged; now also folds overlay.editedNodes

// store.ts (Store methods)
listOverlays(): { name: string }[]
getOverlayByName(name: string): Overlay | null
setOverlayByName(name: string, overlay: Overlay): void   // validates via validateOverlay
deleteOverlay(name: string): void
getActiveOverlayName(): string | null
setActiveOverlayName(name: string): void
// getOverlay()/setOverlay() retained, now operate on the active/legacy scenario

// mcp/tools.ts — UpdateOp extended (addNode already present)
export type UpdateOp =
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'editNode'; node: GraphNode }
  | { kind: 'attachControl'; parent: string; control: ControlMeta; label?: string }
  | { kind: 'addEdge'; edge: GraphEdge }
  | { kind: 'editEdge'; edge: GraphEdge }
  | { kind: 'remove'; id: string }
export interface UpdateGraphArgs { op: UpdateOp; scenario?: string }
export interface ScenarioInfo { active: string | null; scenarios: { name: string }[] }
export interface ExportPlanArgs { scenario?: string }
export interface ExportPlanResult { scenario: string; markdown: string }
export function listScenarios(ctx: ToolContext): ScenarioInfo
export function exportPlan(ctx: ToolContext, args?: ExportPlanArgs): ExportPlanResult

// dashboard/api.ts — UpdateOp mirrors mcp UpdateOp exactly; postOverlay(op, scenario?)
// new clients: fetchScenarios(), setActiveScenario(name), fetchPlan(scenario?)

## Design

STORE — Named overlays reuse the docs table (which the store comment reserves for byte-faithful JSON that must round-trip for hashing/validation): one doc per scenario keyed `overlay:<name>`, plus a `overlay_active` doc holding the active name. listOverlays = `SELECT key FROM docs WHERE key LIKE 'overlay:%'` stripping the prefix. The LEGACY single key `overlay` is the implicit "default" scenario: getOverlay() reads the active-named doc, else the legacy `overlay` doc, else null; setOverlay() writes the active-named doc, or the legacy `overlay` doc when no scenario is active. So every current caller and test stays green with zero schema migration.

applyNodeOp (pure, overlay.ts) switches on op.kind. addNode -> push to addedNodes (GraphNode has NO source field — confirmed in ir.ts — so nothing to stamp). editNode -> if id is a base node, push/replace in editedNodes (replace-by-id in merge); if id is an addedNode in this overlay, replace it in addedNodes in place; if id is neither, THROW (you cannot edit a non-existent base node — that is an add). attachControl -> synthesize a control GraphNode `{ id: cc_<parent>__<controlType>_<n>, route:null, componentPath:null, label, kind:'control', parent, control }` and push to addedNodes. Availability of the control from its parent screen is already provided by buildAdjacency's synthetic containmentEdge, so NO manual edge is fabricated. Added screen nodes use the `n_manual_<slug>` prefix the dashboard already keys "manual" off (GraphCanvas.isManualNode + n_manual prefix; Inspector manual badge).

mergeOverlay change: after the editedEdges loop, build an editedNodes Map and replace base nodes by id in the nodes list — exactly mirroring the editedEdges path. addedNodes already appended. This is the ONLY behavioral change to merge; same non-mutating deep-copy discipline as F1.4, order-stable.

EXPORT PLAN (exportPlanMarkdown, pure) computes from (base, overlay) and the merged graph (for label resolution of added nodes):
  - New screens = addedNodes with kind!=='control'; New controls = addedNodes with kind==='control' grouped by parent label.
  - New transitions = addedEdges, each `fromLabel --[event guard?]--> toLabel`.
  - Touched = editedEdges/editedNodes rendered as a per-field diff vs the base twin (inline field-compare, NOT diffGraphs which diffs whole graphs).
  - Removed = removedRefs resolved to base labels.
  Output (editorial tone matching examples/.../GRAPH.md): H1 scenario name, a one-line count summary, then `## New screens`, `## New transitions`, `## Touched controls`, `## Edited / removed` (each a table or bullet list), and a `> Base: <hash>` provenance footer. Empty sections omitted.

DASHBOARD
- Scenario switcher (header control in App.tsx or a tiny ScenarioBar): a <select> of names + "New scenario…" + "Export plan". Selecting POSTs /api/scenarios/active then re-fetches; the active overlay is what the canvas merges. Export plan GETs /api/plan and shows the markdown in a readOnly <textarea>/modal (KISS — no markdown-render dep).
- Add screen: a "+ Screen" button on the canvas Panel (beside expand-all) opens an inline label/route form -> applyOp({kind:'addNode', node:{ id: n_manual_<slug(label)>, route, componentPath:null, label, kind:'screen' }}).
- Edit node: extend Inspector's node branch (today read-only Fields + Delete) with a NodeEditor (label+route, Save) mirroring the existing EdgeEditor -> applyOp({kind:'editNode', node:{...n,label,route}}); for a control, also name/controlType.
- Attach control: in the screen Inspector branch add an Attach-control sub-form (controlType select from GraphCanvas's known set, name) -> applyOp({kind:'attachControl', parent:n.id, control:{element,controlType,name}, label:name}).
- App.tsx: applyOp already funnels every UpdateOp through postOverlay; add the new op kinds to api.ts UpdateOp + handlers and thread the active scenario into the POST body. The live/read-only guard and error surface are reused as-is.
- Manual tint: an editNode-only change does not create a manual edge, so isManualNode won't tint an edited base node — acceptable (the node still belongs to base). Added screens tint via the n_manual_ prefix.

## Soundness

The golden invariant is preserved structurally, not by new policing:
- Base immutability: every new write path is an overlay write. mergeOverlay still deep-copies (F1.4 discipline) and the base doc is never written by any planning op. No new code calls setBaseGraph.
- No proven edge without a witness: planning adds only nodes (GraphNode has no provenance field) and source:'manual' edges via the EXISTING asManualEdge stamping (which strips witness, downgrades must->may). exportPlan/attachControl never mint a static/runtime GraphEdge, so validateGraph's UNWITNESSED/MUST_PROVENANCE/MANUAL_IN_BASE invariants are never at risk in the base.
- Proposals stay quarantined: untouched — this feature does not read or write the proposals tables.
- Stale-base soundness: loadMergedGraph's `overlay.base !== hashValue(base)` guard is unchanged and now protects every named scenario equally (each scenario stores its own base hash via emptyOverlay(hashValue(base))). A scenario authored against an old extraction is rejected loudly; validateMerged additionally catches an editedNode/edge that dangles after a re-extract.
- validateOverlay is EXTENDED, not weakened: editedNodes get the same node shape check; existing valid overlays remain valid. The can't-edit-a-non-base-id and addedNode-id-collision rules live in applyNodeOp (where base is available), enforced before write and unit-tested there.
Risk to soundness only if attachControl synthesized a witnessed edge — it does NOT; availability comes from buildAdjacency's pre-existing in-memory synthetic containment edge, never persisted to the base.

## Test strategy

TDD — write these first, all in the existing vitest harness (in-memory store / temp workspace patterns from store.test.ts, overlay.test.ts, tools.test.ts).

CORE overlay.test.ts:
1. mergeOverlay applies editedNodes: base node 'a' label 'A'; overlay editedNodes:[{...a,label:'A2'}] -> merged 'a'.label==='A2'; base deep-equal to a pre-call snapshot (mirrors existing "does not mutate base").
2. Back-compat: editedNodes undefined behaves as before (existing 4 mergeOverlay tests stay green).
3. applyNodeOp: addNode appends to addedNodes; editNode of a base id pushes editedNodes; editNode of an already-added id replaces in addedNodes (no dup); editNode of an unknown id THROWS; attachControl pushes a control node with parent set + a cc_ id; input overlay not mutated (returns new).
4. exportPlanMarkdown: base a->b + overlay (addedNode screen 'c', addedEdge manual b->c, editedEdge e_ab event changed, removedRefs:['x']) -> markdown contains '## New screens' with C, '## New transitions' with B --> C, an edited line for e_ab, a `Base:` footer; omits '## Touched controls' when none.

CORE validate.test.ts / schema.test.ts:
5. validateOverlay accepts valid editedNodes; rejects a malformed editedNode.
6. validateOverlayShape accepts optional name + editedNodes; rejects editedNodes with a bad node.

STORE store.test.ts:
7. setOverlayByName/getOverlayByName round-trip; listOverlays returns all names; deleteOverlay removes one; getActive/setActive round-trip.
8. Legacy compat: after only the legacy `overlay` key is set, getOverlay() returns it as default; with an active scenario, setOverlay() writes that scenario's doc.
9. applyNodeOp through the store rejects editNode of an unknown base id and addNode colliding with a base id.

MCP tools.test.ts:
10. update_graph {kind:'addNode'} surfaces in get_graph; {kind:'editNode'} changes a node label in get_graph; {kind:'attachControl'} adds a control whose parent is the screen and which plan_path routes through (BFS via containment edge).
11. update_graph with scenario:'feat-x' writes a SEPARATE overlay; the default scenario's graph is unchanged; listScenarios reports both.
12. exportPlan returns markdown for the active scenario and reflects an added edge.
13. Red-team: editNode of a non-base id throws; a stale scenario (wrong base hash) -> loadMergedGraph throws /stale overlay/ (reuse existing pattern).

CLI cli.test.ts (pure router handleApiRequest): GET /api/scenarios, POST /api/scenarios/active, GET /api/plan return expected shapes; POST /api/overlay with {op,scenario} writes the named overlay; unknown route still 404.

DASHBOARD: type-level — api.ts UpdateOp stays assignable to mcp UpdateOp (the existing anti-drift contract) and tsc --noEmit (the build script) stays green; manual smoke that an added n_manual_ screen tints violet. (Dashboard has no vitest runner; keep all real logic pure in core and unit-test it there.)

## Files to touch

- `packages/core/src/ir.ts`
- `packages/core/src/overlay.ts`
- `packages/core/src/overlay.test.ts`
- `packages/core/src/validate.ts`
- `packages/core/src/validate.test.ts`
- `packages/core/src/schema.ts`
- `packages/core/src/schema.test.ts`
- `packages/core/src/store.ts`
- `packages/core/src/store.test.ts`
- `packages/core/src/index.ts`
- `packages/mcp/src/tools.ts`
- `packages/mcp/src/tools.test.ts`
- `packages/mcp/src/server.ts`
- `packages/mcp/src/index.ts`
- `packages/cli/src/server.ts`
- `packages/cli/src/cli.test.ts`
- `apps/dashboard/src/api.ts`
- `apps/dashboard/src/App.tsx`
- `apps/dashboard/src/Inspector.tsx`
- `apps/dashboard/src/GraphCanvas.tsx`
- `docs/features/F-planning-ui.md`
- `docs/roadmap.md`

## Dependencies

- F1.4 (overlay merge model) - extended here with editedNodes; mergeOverlay/emptyOverlay reused
- F1.3 (invariant validation) - validateOverlay/validateMerged reused and extended for editedNodes
- F6.1-F6.5 (dashboard scaffold, canvas, inspector, manual-edit overlay, steps) - the UI surface this builds on; reuses applyOp/postOverlay, the Inspector EdgeEditor pattern, the GraphCanvas control-type palette
- F5.4 (MCP update_graph overlay) - UpdateOp/asManualEdge/updateGraph reused; addNode already typed
- F4.4 (local API server) - handleApiRequest router reused; new routes added
- F6.1-store (SQLite store) - the docs-table JSON-doc pattern reused for named overlays

## Risks

- Back-compat of Overlay shape: adding required fields would break every stored overlay and the round-trip tests. Mitigation: name/editedNodes are OPTIONAL; merge/validate treat absent as default/[]. Verified against schema.ts (validateOverlayShape iterates a fixed key array) and store.test.ts round-trip.
- Named-overlay storage drift: a separate table risks two sources of truth vs the legacy `overlay` doc. Mitigation: reuse the docs table with `overlay:<name>` + `overlay_active` keys and resolve getOverlay/setOverlay through the active name with a legacy fallback, so loadMergedGraph/updateGraph/serve API need no change.
- validateOverlay has no base param, so the can't-edit-a-non-base-node rule cannot live there. Mitigation: enforce base-membership in applyNodeOp/store path (where base is in hand) and test it there; keep validateOverlay base-free (shape + manual purity + editedNodes shape).
- Dashboard has no test runner today; UI logic is largely type-checked only. Mitigation: keep all real logic pure in core (applyNodeOp/exportPlanMarkdown) and unit-test it; the dashboard just emits UpdateOps it already knows how to POST; keep api.ts UpdateOp identical to mcp UpdateOp (the existing anti-drift contract).
- attachControl could be misread as proving an interaction. Mitigation: it only adds a control node; availability is the pre-existing in-memory containment edge in buildAdjacency, never a persisted witnessed edge. Documented in the feature doc + soundness section.
- Export markdown is a new artifact; label ambiguity for ids. Mitigation: resolve labels via merge(base,overlay) and include a Base:<hash> footer for provenance; omit empty sections to keep it terse.
