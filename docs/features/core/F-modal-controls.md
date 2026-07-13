# F-modal-controls — Descend into modal component files for their controls

**Status:** in progress
**Milestone:** M10 — Modal & deep-view control reach
**Depends on:** F-control-identity-selectors, F2.9 (shared-shell + dynamic targets)

## Problem

Modals are opaque leaf nodes. The React adapter descends a screen's child-component
tree to **depth 1** to harvest controls (`screenSourceFiles(route.componentFile, 1)`),
and when it meets a `*Modal`/`*Dialog`/`*Drawer`/`*Sheet`/`*Popover` tag it creates a
single `kind:'modal'` node — but it **never resolves or descends into the modal's own
component file**. Everything rendered *inside* the modal is invisible.

Verified against the reference production app: `AppContent` (the `/` screen, depth 0) renders `<LandingPage/>`
(depth 1) which renders `<SignupLoginModal/>`, `<LandingPageCouldBuyOrCouldSellModal/>`,
`<ProfileView/>` (all **depth 2**). So the modal *nodes* exist (their tags are seen at
depth 1) but their contents — the Google/Facebook OAuth buttons + email `<form>` inside
`SignupLoginModal → LoginOrSignup`, the could-buy/could-sell `<form>`/`<input>` fields —
are never extracted. The graph shows an empty modal with no way to know a login form,
OAuth, or a buy/sell form lives behind it.

## Scope (v1) — imported modals only

Descend into a modal's component file **only when it resolves to a different file than
the one rendering it** (an *imported* modal). Reason — red-team finding: a modal defined
*inline in the same file* (e.g. the sample app's `ConfirmDialog` local function in
`Checkout.tsx`) already has its controls walked by the screen's `allJsxElements` pass and
parented to the screen. Re-parenting those to the modal node would **change their
content-addressed ids** (`controlNodeId` hashes off the owner id), silently orphaning any
Tier-2 proposals / Tier-3 observations bound to them — the known proposal-orphaning bug.
Most imported modal files are never control-swept today (they sit at depth ≥2, past
the depth-1 control horizon), so their controls are **net-new** → modal-scoped ids are
safe. The one exception: an imported modal rendered at depth ≤1 by a *representative*
route (e.g. `ClaimListingPage` rendering `<SignupLoginModal/>` directly) *was* swept and
its controls *were* screen-parented. Those are **re-homed** to the modal node — a
one-time, more-correct id change (modal contents belong under the modal regardless of
where it is rendered). Verified on the reference production app: exactly 2 such controls moved, and **zero**
proposals/observations were bound to their old ids, so nothing was orphaned. This is the
intended, tested behaviour (a route component directly rendering an imported modal →
modal-parented controls), not a silent surprise.

the reference app's modals are all imported separate files, so v1 covers the real target.

## Design

In the `opts.controls` block of `extractGraph` (adapter-react):

1. **Capture the modal's component file when the modal node is created.** At the modal
   detection site, `resolveComponentFile(usageFile, tagBaseName)`. If it resolves AND its
   path ≠ the usage file's path, record `modalDescend.set(modalId, modalFile)`.
2. **After the screen-control pass, run one modal-control pass per descended modal:**
   gather controls from `screenSourceFiles(modalFile, 1)` (depth 1 within the modal
   subtree reaches a modal that delegates to a child, e.g. `SignupLoginModal →
   LoginOrSignup`), assign **per-modal** `nth` scope, and emit each control with
   `parent = modalId`, `id = controlNodeId(modalId, selector)`.
3. **All modal-control nav edges are capped to `may`** (modal contents are conditionally
   rendered — never statically guaranteed to mount). OAuth/Stripe buttons have no in-app
   nav target → they become control nodes with **no out-edge** (honest: they appear in the
   graph, but create no fake edge and do not move coverage).

To stay DRY the per-control emission body is factored into a local `emitControls(ownerId,
items, forceMay)` closure, called once for screen controls (`route.nodeId`, `false`) and
once per modal (`modalId`, `true`). Each call keeps its **own** `nthBySig` map — so a modal
`<button>Cancel</button>` never perturbs a screen `<button>Cancel</button>`'s nth/id.

### Cut / deferred (per red-team)

- **External-redirect sink node** (`kind:'external'` for OAuth/Stripe): **CUT.** It is the
  only facet touching shared core (ir.ts NodeKind + schema), and a `must`+static external
  edge would count as `accounted:true` while never being runtime-verifiable — a coverage
  cheat if static detection misfires. The OAuth/Stripe buttons still appear as controls via
  this feature; their external nature is left as metadata, not a counted edge.
- **Facet C — deep non-modal views** (`ProfileView`: notification settings, add-phone,
  identity-verify→Stripe): **DEFERRED.** Needs *selective* path-gated descent (gate the
  extra hop on a `currentPath.startsWith('/profile')` predicate) to avoid funnelling every
  deep shell component onto the single `n_root` representative. Tracked as follow-up.
- **Angular/Vue parity:** deferred (YAGNI — the validation target is React; no non-React app needs modal
  descent yet).

## Golden-invariant & stability guarantees

- Every new edge flows through the existing `pushEdge`/`pushDynamicEdge`, which always
  attach `source:'static'` + a `witness{file,loc,ruleId}` → no unwitnessed edge possible.
- Modal controls only ever emit `may` edges (forced) → `MUST_PROVENANCE` untouchable.
- Modal-control ids are keyed off the modal id → net-new, **zero rename** of existing ids.
- Gated entirely behind `opts.controls` → the no-controls golden (9 nodes / 15 edges) is
  byte-identical.
- Bounded: `screenSourceFiles` carries a visited set; modal-descent is a single pass (no
  recursion into modals discovered *inside* modal files in v1) → terminates.

## Coverage impact

New modal-control nav edges are `may` → classify → `open`, `accounted:false`, until
confirmed by runtime or parked — the same honest path as every other `may` edge. OAuth
buttons add control nodes with no edges → coverage unchanged. `accountedRatio` may drop
(honestly) as real-but-unverified modal flows surface; `loopDone` stays meaningful.

## Tests (TDD, written first)

1. Imported modal → its form/OAuth/input controls parented to the **modal node**, valid graph.
2. Modal that delegates to a child component (depth 1 within modal) → child's controls reached.
3. Modal-control nav edges are `may`.
4. **Id stability:** a screen control's id is unchanged whether or not an imported modal
   with a same-labelled control is present (per-owner nth scope).
5. **Inline modal NOT re-parented:** sample-app golden (9/15) byte-identical; ConfirmDialog
   controls stay under `n_checkout`.
6. Bounded recursion: a modal whose file imports itself terminates, one modal node, no dup ids.
7. No-controls golden unchanged (gated behind `opts.controls`).
