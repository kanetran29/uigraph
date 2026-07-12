# Stable selector-based control identity

- **Slug:** F-control-identity-selectors
- **Status:** designed (red-team plan)

## Purpose

Today control nodes get a POSITIONAL id minted in packages/adapter-react/src/extract.ts:919 — `cc_${route.nodeId}__${meta.controlType}_${cidx++}` — where `cidx` is a single counter declared at extract.ts:888 and incremented across ALL screens in source order. Any control added, removed, or reordered (in any earlier-walked file) shifts `cidx` and silently re-numbers every later control. Consequences: (1) overlays (Overlay.removedRefs / addedNodes in ir.ts:94, validated in validate.ts:40 DANGLING_PARENT), runtime observations (store.ts observations.from/to), and proposals (Proposal.control / Proposal.from in proposals.ts:28, persisted in store.ts proposals table) are all keyed by control id and will mis-bind to a DIFFERENT control after an edit; (2) ControlMeta (ir.ts:30) carries element/controlType/name/events/effects but NO selector, so codegen/automation (Playwright, the runtime tier) has no reliable locator to actually click the control. This feature gives every control a stable, content-addressed selector and derives its node id from that selector, so identity survives edits and re-maps, and downstream features (runtime confirmation, codegen, overlay re-anchoring) can bind reliably. It is foundational: F-runtime-* and any codegen feature depend on the selector field, and the overlay/proposal re-anchor logic depends on the id being stable.

## Contract & boundary

CORE ir.ts: add SelectorStrategy = 'testid'|'role-name'|'label'|'structural'|'text'; ControlSelector { strategy; value: string; nth?: number }; ControlMeta gains required `selector: ControlSelector`. New core packages/core/src/ids.ts: controlNodeId(screen: string, sel: ControlSelector): string = `c_${screen}__${fnv1a(`${sel.strategy}|${sel.value}|${sel.nth ?? ''}`).slice(0,8)}`, re-exported from index.ts. schema.ts checkNode: require control.selector object (string strategy in set, string value, optional number nth) so validateGraph rejects control-without-selector at the store boundary (store.ts:99). grounding.ts GroundedControl gains selector, copied at grounding.ts:69. Boundary preserved: core defines the type + id fn; each adapter computes the selector from its own AST — no framework type enters core.

## Data shapes

ControlSelector { strategy: 'testid'|'role-name'|'label'|'structural'|'text'; value: string; nth?: number }. ControlMeta { element: string; controlType: string; name?: string; selector: ControlSelector; events?: string[]; effects?: string[] }. controlNodeId(screen, sel) -> `c_${screen}__${fnv1a(`${sel.strategy}|${sel.value}|${sel.nth ?? ''}`).slice(0,8)}`. GroundedControl gains selector: ControlSelector. Example for Showcase first radio: { strategy:'role-name', value:'radio|plan', nth:0 } => e.g. c_n_showcase__1a2b3c4d; second radio nth:1 => different hash. Example testid: data-testid='save' => { strategy:'testid', value:'save' }. Example structural fallback for a bare on*-div: { strategy:'structural', value:'form>ul>li:nth-of-type(1)' }.

## Design

SELECTOR PRECEDENCE (per control element, deterministic, first match wins): (1) testid: data-testid attr -> strategy 'testid'. (2) role-name: implicit/explicit ARIA role + accessible name (reuse name resolution at extract.ts:426) -> 'role-name', value `role|name`. (3) label: id then name attr -> 'label'. (4) structural: tag:nth-of-type path from nearest testid/id ancestor or component root -> 'structural'. (5) text: normalized visible text -> 'text'. DISAMBIGUATION via per-screen nth grouping on (strategy,value); proven collision: Showcase.tsx:31-32 two radios with name='plan' both yield role-name 'radio|plan', nth 0/1. ID: controlNodeId = `c_${screen}__${fnv1a(strategy|value|nth).slice(0,8)}`, replacing the global cidx counter (extract.ts:888) and cc_ positional id (extract.ts:919). Two-pass control loop: collect rawSelectors -> assign nth -> emit nodes/edges with stable cId. Migration: prefix cc_->c_; no live user data pre-1.0, so re-extract regenerates ids and validateGraph DANGLING flags stale overlay/proposal refs loudly; update examples/sample-react-app/proposals.json only if it literals a control id (route-level n_* proposals unaffected). Dashboard Inspector.tsx adds a selector Field. Angular core types written but control extraction not implemented (no control nodes there yet). Soundness: identity-only change, emits no edges, golden invariant untouched; selector is a pure deterministic function of the AST so as-witnessed as the node; structural is a total fallback so controlNodeId is total; nth+screen-prefix guarantees no DUP_NODE_ID.

## Soundness

Identity/locator-only change: emits NO edges and changes NO modality, so the golden invariant (no proven edge without a deterministic witness; proposals quarantined) is untouched — every pushEdge call site (extract.ts 821-852, 932-948) and its witness are unchanged. The selector is a pure deterministic function of the static AST (no IO), so it is as witnessed as the control node it annotates; identical source => identical (strategy,value,nth) => identical id, preserving content-addressability (hashValue(graph), grounding base hashes). controlNodeId is TOTAL: precedence ends at 'structural' (always computable from the JSX position) before 'text', and a control is by definition a positioned JSX element, so a non-empty selector.value always exists. Per-screen nth grouping makes (strategy,value,nth) unique within a screen and the unique screen prefix makes ids globally unique, so validateGraph DUP_NODE_ID cannot fire from this scheme. Proposals stay quarantined (no change to proposals.ts materialize/quarantine logic).

## Test strategy

TDD, tests first. (A) core/src/ids.test.ts (new): controlNodeId is pure/deterministic (same input => same id), prefix 'c_', distinct selectors => distinct ids, nth participates in the hash, screen participates. (B) core/src/schema.test.ts: a control node WITHOUT selector now fails validateGraphShape; a well-formed selector passes; bad strategy/value types fail. (C) core/src/validate.test.ts: a graph whose controls carry selectors still returns [] (no spurious errors); two controls with same selector but different nth get different ids => no DUP_NODE_ID. (D) adapter-react/src/extract.test.ts (extend the existing golden F2.7 + 'extracts nested controls' block at lines 92-138, keeping every current assertion green): selector precedence cases — add a `data-testid` to ONE Showcase control and assert its selector.strategy==='testid'; assert the two `name=\"plan\"` radios (Showcase.tsx:31-32) produce strategy 'role-name' value 'radio|plan' with nth 0 and 1 and DISTINCT ids; assert every control has a non-empty selector.value; assert a textless/attrless on*-div falls back to 'structural'. STABILITY test (the core regression this feature fixes): extract the fixture, snapshot one Checkout control's id; prepend a NEW sibling control earlier in source order (in-memory variant); assert the original control's id is UNCHANGED (positional scheme would have changed it). Keep extract.test.ts:97-138 assertions (parent linkage, controlType coverage, events, interprocedural must-edge, modal open) passing unchanged — verify edge ids from controls still resolve since cId is still the from-endpoint. (E) grounding.test.ts: GroundedControl includes selector. (F) Determinism guard: extract the fixture twice, assert hashValue(graph) equal (content-addressable). Run full suite (vitest) across all packages to confirm no `cc_` literal expectation breaks (verified none exists, but the run is the gate).

## Files to touch

- `packages/core/src/ir.ts`
- `packages/core/src/ids.ts`
- `packages/core/src/index.ts`
- `packages/core/src/schema.ts`
- `packages/core/src/grounding.ts`
- `packages/adapter-react/src/extract.ts`
- `packages/adapter-react/src/extract.test.ts`
- `packages/core/src/ids.test.ts`
- `packages/core/src/schema.test.ts`
- `packages/core/src/validate.test.ts`
- `packages/core/src/grounding.test.ts`
- `apps/dashboard/src/Inspector.tsx`
- `examples/sample-react-app/proposals.json`
- `examples/sample-react-app/src/pages/Showcase.tsx`
- `docs/30-ir-spec-v0.md`

## Dependencies

- F-control-extraction (already shipped: extract.ts opts.controls path that mints control nodes — this feature replaces its id/selector logic)
- Core IR + adapter contract (ir.ts ControlMeta, schema.ts, validate.ts) — already shipped (M0/M1)
- fnv1a/hashValue in packages/core/src/hash.ts — reused for the id hash
- Downstream DEPENDENTS (this feature is foundational FOR them, not blocked BY them): runtime observation tier (store.ts observations keyed by control id), proposals re-anchor (proposals.ts Proposal.control/from), overlay re-anchor (ir.ts Overlay), and any codegen/automation feature needing a Playwright locator (consumes ControlMeta.selector)

## Risks

(1) Migration breakage of persisted overlays/proposals/observations keyed by the OLD cc_ id — mitigated by pre-1.0 status, no auto-migration, and validateGraph DANGLING flagging stale refs loudly (the current silent mis-bind becomes a loud error). Must grep examples/sample-react-app/proposals.json for literal control ids before merge. (2) Structural-path stability: a real DOM restructure churns the structural-strategy id — acceptable (the control genuinely moved) but means testid is strongly preferred; documentation should nudge fixture/app authors toward data-testid. (3) schema.ts now REQUIRES control.selector — any code path that builds a control node without one (manual overlay control additions? Inspector/overlay POST) will fail validateGraph; audit overlay control-creation paths (none emit controls today — verified Inspector only deletes/edits) and ensure any future manual control gets a selector (strategy could be a 'manual' value or reuse 'text'). (4) Accessible-name computation is a simplified subset of the full ARIA spec; v1 reuses the existing name resolution (extract.ts:426) which is sufficient for the fixture but may under/over-name complex cases — bounded by KISS, revisit only on real evidence. (5) Touching Showcase.tsx (adding a data-testid) changes the golden fixture; must re-verify all extract.test.ts counts (control coverage at lines 128-131) still hold.
