# E2E codegen: plan_path → Playwright spec

- **Slug:** F-codegen-playwright
- **Status:** designed (red-team plan)

## Purpose

Turn a proven path through the UI graph into runnable Playwright test code. Today nothing converts a graph/path into executable verification: planPath (packages/core/src/algorithms.ts) returns PlanStep[] and the MCP plan_path tool (packages/mcp/src/tools.ts planPathTool) flattens it to readable labels, but the loop stops there — an agent must hand-write Playwright. This feature emits a deterministic *.spec.ts from the steps of a planned path: each leg becomes a locator action (click/fill/navigate), each step appends assertions derived from the target node (route → expect URL) and the edge effect (open:modal → expect dialog visible; api:POST → expect a matching request), and any witness screenshot becomes an optional visual baseline. It is exposed as a CLI command `uigraph gen <from> <to> --framework playwright` and a model-free MCP tool `gen_spec`. It is the missing executable artifact that makes the graph pay off as the by-product the dossier names (docs/ui-graph-dossier-final-en.md:174 "optional .spec.ts codegen"; line 175 "stable testids → kills brittle selectors"): the agent gets a self-healing spec whose selectors come from the graph, not from guesses.

## Contract & boundary

NEW pure module `packages/core/src/codegen.ts` (the framework-agnostic core stays the home of pure ops; Playwright is just one emitter, so the code generator lives in core as a pure string-builder, NOT in the adapters — adapters never run here). Public surface, re-exported from packages/core/src/index.ts:

```ts
// codegen.ts
import type { PlanStep } from './algorithms'
import type { GraphNode, GraphEdge } from './ir'

/** A single emitted leg: the action + the assertions it implies, kept as data so the
 *  string renderer is trivially testable and a future framework reuses the plan. */
export interface SpecAction {
  kind: 'navigate' | 'click' | 'fill' | 'select' | 'check' | 'press' | 'available'
  /** Playwright locator expression for the control, e.g. `page.getByTestId('checkout-submit')`
   *  or `page.getByRole('button', { name: 'Place order' })`. Empty for navigate/available. */
  locator: string
  /** For fill/select/check/press: the value to supply (a placeholder for required inputs). */
  value?: string
  /** Human comment line emitted above the action (event + source screen→target). */
  comment: string
}

/** An assertion emitted after an action, derived from the edge target/effect. */
export interface SpecAssertion {
  kind: 'url' | 'dialog' | 'request' | 'screenshot' | 'visible'
  /** The rendered Playwright expect(...) expression. */
  code: string
  /** True when this assertion is a verified consequence of a witnessed edge (route/effect),
   *  false when it is a best-effort heuristic (so it is emitted commented-out / soft). */
  proven: boolean
}

export interface SpecLeg {
  edgeId: string
  action: SpecAction
  assertions: SpecAssertion[]
  /** Open TODOs for data this leg needs but the graph cannot supply (form values, guard
   *  preconditions). Surfaced as // TODO(uigraph): ... lines and in the result manifest. */
  gaps: string[]
}

export interface BuildSpecOptions {
  /** Base URL the test navigates to first (default 'http://localhost:3000'). */
  baseUrl?: string
  /** Concrete values for parameterized route segments, e.g. { id: '42' }. */
  params?: Record<string, string>
  /** Concrete values for named form inputs, keyed by control name. */
  inputs?: Record<string, string>
  /** Emit `await expect(page).toHaveScreenshot(...)` baselines from witness screenshots. */
  visualBaseline?: boolean
  /** Test title (default `from → to`). */
  title?: string
}

/** The structured spec plan (pure data) — render() turns it into source text. */
export interface SpecPlan {
  title: string
  from: string
  to: string
  baseUrl: string
  legs: SpecLeg[]
  /** All unresolved data gaps across legs, deduped — the F-input-guard hand-off. */
  gaps: string[]
  /** True iff every leg's primary assertion is `proven` (no soft/heuristic assertions). */
  fullyProven: boolean
}

/** Pure: PlanStep[] (from core planPath) → SpecPlan. No IO, no framework strings beyond
 *  the locator/expect fragments. Deterministic for a given (path, options). */
export function buildSpecPlan(path: PlanStep[], opts?: BuildSpecOptions): SpecPlan

/** Pure: SpecPlan → a complete Playwright spec source string (a `test(...)` in a file). */
export function renderPlaywrightSpec(plan: SpecPlan): string
```

NEW MCP tool in packages/mcp/src/tools.ts + packages/mcp/src/server.ts:
```ts
export interface GenSpecArgs { from: string; to: string; allow?: Modality[]; baseUrl?: string;
  params?: Record<string,string>; inputs?: Record<string,string>; visualBaseline?: boolean }
export interface GenSpecResult { found: boolean; from: string; to: string;
  spec: string; gaps: string[]; fullyProven: boolean }
export function genSpecTool(ctx: ToolContext, args: GenSpecArgs): GenSpecResult
```
genSpecTool loads the merged graph (loadMergedGraph), calls core planPath, then buildSpecPlan + renderPlaywrightSpec. `found:false` with empty spec when unreachable (mirrors planPathTool). The tool RETURNS the spec text (does not write files) so the model-free guarantee holds and the agent decides where to save.

NEW CLI command `uigraph gen <from> <to>` in packages/cli/src/cli.ts + a `runGen` handler in packages/cli/src/commands.ts:
```ts
export interface RunGenOptions { dir: string; from: string; to: string; framework: 'playwright';
  out?: string; baseUrl?: string; allow?: Modality[]; params?: Record<string,string>;
  inputs?: Record<string,string>; visualBaseline?: boolean }
export interface GenSummary { found: boolean; outPath?: string; legs: number; gaps: string[]; fullyProven: boolean }
export function runGen(opts: RunGenOptions): GenSummary
```
runGen loads the base+overlay+observations graph from the workspace .db (reuse the loadMergedGraph logic — see Design/risks), plans, builds, renders, and WRITES the file to `<dir>/e2e/<slug(from)>__to__<slug(to)>.spec.ts` (or `--out`). `--framework` only accepts `playwright` for now (throw on others, matching pickAdapter's pattern in commands.ts).

Boundary rule (golden invariant): codegen NEVER invents an edge or a transition. It only renders steps that core planPath already returned over the proven (+overlay+runtime) graph. A `may`/`unknown` leg is rendered but its derived assertion is marked `proven:false` (soft / commented), so a generated spec cannot assert an unproven consequence as fact.

## Data shapes

See Contract for the full TS. Key invariants the shapes enforce: SpecAssertion.proven gates hard-vs-soft rendering (must-edge ⇒ proven:true); SpecLeg.gaps + SpecPlan.gaps are the F-input-guard hand-off channel; SpecAction.kind is a closed union mapped 1:1 to a Playwright verb so renderPlaywrightSpec is a pure switch with no branching on framework-of-the-app. The selector shape consumed from F-control-identity-selectors: `selector?: { strategy: 'testid'|'role'|'label'|'placeholder'|'text'|'css'; value: string; role?: string; name?: string }` added to ControlMeta in ir.ts. GenSpecResult/GenSummary expose found/spec/gaps/fullyProven so both the agent (MCP) and a human (CLI stdout) see exactly what is proven and what still needs data.

## Design

STEP → CODE MAPPING (the heart). Each PlanStep has `edge` (event, guard, effect, modality, witness.screenshot) and `from`/`to` GraphNodes (route, kind, control meta). Two step shapes occur:

1) CONTAINMENT step (synthetic screen→control edge from buildAdjacency: edge.event === '(available)', effect === 'contains', to.kind === 'control'). This is NOT a user action by itself — it means "the control is now reachable on this screen". Emit NO action for it alone; instead REMEMBER `to` (the control node) and fold it into the NEXT step, which is the real edge OUT of that control. Rationale: planPath routes screen → control (containment) → target; only the second edge is the user gesture.

2) REAL edge step. Derive the action from the *origin control* (the control node the edge leaves from — either step.from when from.kind==='control', or the control remembered from the preceding containment step) and the edge.event:
   - origin control present + event starts 'click' (control.controlType 'button'|'element', or a Link) → `kind:'click'`, locator from the control (see selectors). 
   - control.controlType 'input'|'richtext' → `kind:'fill'`, value from opts.inputs[control.name] else a placeholder `'TODO'` (+ gap). 'checkbox' → `kind:'check'`. 'select' → `kind:'select'` with value or gap.
   - event like 'keydown'/'keyup'/'keypress' → `kind:'press'`, value = a key gap ('Enter' default + gap noting the real key is unknown).
   - No origin control (pure route→route edge: Link/Navigate/redirect/useNavigate at screen scope, event 'click:Link'|'redirect'|'navigate') → if a Link/redirect to a known route, prefer a navigation action `page.goto(url)` ONLY when there is no locatable control; otherwise emit `kind:'navigate'`. For a redirect (effect 'redirect') emit just the resulting URL assertion (no gesture).

LOCATOR (depends on F-control-identity-selectors). That feature adds a `selector` to ControlMeta describing the stable identity the adapter found, shaped as a discriminated value the emitter renders:
```ts
// added by F-control-identity-selectors to ir.ts ControlMeta:
selector?: { strategy: 'testid'|'role'|'label'|'placeholder'|'text'|'css'; value: string; role?: string; name?: string }
```
Render priority (Playwright-idiomatic, matching the existing name-derivation order in adapter-react controlMetaFor: name→id→placeholder→aria-label→text):
   - testid → `page.getByTestId('<value>')`
   - role → `page.getByRole('<role>', { name: '<name>' })`
   - label → `page.getByLabel('<value>')`
   - placeholder → `page.getByPlaceholder('<value>')`
   - text → `page.getByText('<value>')`
   - css (last resort) → `page.locator('<value>')` + a `gap` warning (brittle).
   FALLBACK when F-control-identity-selectors is absent or selector missing: synthesize a best-effort locator from existing ControlMeta — `getByRole('button',{name})` for buttons, `getByPlaceholder`/`getByLabel` for inputs from control.name — and add a gap "selector inferred, not stamped". This keeps codegen shippable before its dependency lands, then strengthens automatically once selectors exist.

ASSERTIONS, derived ONLY from the edge target + effect (never invented):
   - TARGET ROUTE: if to.kind==='screen'/'route' and to.route !== null → `await expect(page).toHaveURL(<urlFor(route, params)>)`, proven = (edge.modality==='must'). For 'may'/'unknown' targets emit it as a soft assertion (proven:false) rendered commented with a note `// may-edge: target not proven`.
   - PARAMETERIZED ROUTE (`/products/:id`): replace each `:seg` with opts.params[seg]; if missing, leave `:seg` and add gap "route param :seg unbound". URL assert uses a regex when params still symbolic: `toHaveURL(/\/products\/[^/]+$/)`.
   - effect 'open:modal' (or to.kind==='modal') → `await expect(page.getByRole('dialog')).toBeVisible()`, proven when modality must.
   - effect matches `api:<METHOD> <path>` (parse with the existing parseApiEffect/summarizeApiEffect already in core openapi.ts — REUSE, do not re-implement) → wrap the action in `const reqP = page.waitForRequest(r => r.method()==='<METHOD>' && r.url().includes('<path>'))` before the click and `await reqP` after, plus a comment. proven when must.
   - effect 'redirect' → URL assertion only.
   - WITNESS SCREENSHOT + opts.visualBaseline: if step.edge.witness?.screenshot present → `await expect(page).toHaveScreenshot('<edgeId>.png')` as an OPTIONAL baseline (proven:false — a visual baseline is advisory, never a correctness proof). The witness path is recorded in a comment so a human can seed the baseline from it.

OUTPUT FILE LAYOUT: `<workspace>/e2e/<slug>.spec.ts` where slug = `${nodeIdSlug(from)}__to__${nodeIdSlug(to)}` (node ids are already filesystem-safe like `n_products__id`; slug just strips/normalizes). Rendered file:
```ts
import { test, expect } from '@playwright/test'
// Generated by uigraph gen — path <from> → <to> over the proven graph.
// Gaps (supply via --inputs/--params or edit): <list or "none">
test('<title>', async ({ page }) => {
  await page.goto('<baseUrl>')
  // leg 1: <comment> ...
})
```
One `test()` per path (a path is one scenario). renderPlaywrightSpec is pure text assembly over SpecPlan.

WHY core, not adapter: the adapters (adapter-react/extract.ts) are framework-of-the-app extractors; codegen is framework-of-the-test emission and operates only on the IR + PlanStep, so it belongs beside algorithms.ts/grounding.ts as a pure core op (KISS/DRY: one emitter, reusing parseApiEffect and the IR types, no new dependency).

## Soundness

Golden-invariant preserving: codegen is a pure projection of paths that core planPath ALREADY produced over the proven (base+overlay+runtime) graph — it mints no edge and consults no model (the MCP tool is model-free like the rest of tools.ts). The invariant is honored at the assertion layer: a derived assertion is `proven:true` only when its source edge is a `must` edge; `may`/`unknown` legs render their URL/effect assertions as SOFT (commented-out or marked), so a generated spec can never assert an unproven consequence as a hard expectation — a wrong proposal/over-approximation degrades the spec into TODOs, never into a false green. Visual-baseline screenshot assertions are always advisory (proven:false): a screenshot is evidence, not a correctness proof. Determinism: buildSpecPlan/renderPlaywrightSpec are pure functions of (PlanStep[], options); same path + options → byte-identical spec (snapshot-testable), matching core's existing order-stable ops (grounding.ts, runtime.ts fold). The witness screenshot the spec references comes straight from edge.witness.screenshot (set by the Tier-3 runtime fold in runtime.ts), so a visual baseline is grounded in a real observation, not synthesized.

## Test strategy

TDD, tests first, all pure (no Playwright runtime, no spawned process), mirroring the existing in-memory style of packages/core/src/grounding.test.ts and packages/cli/src/cli.test.ts.

A. packages/core/src/codegen.test.ts (the bulk):
  1. click leg → `page.getByTestId(...).click()` when control has selector.strategy 'testid'; `getByRole('button',{name})` when 'role'.
  2. fill leg with opts.inputs['email']='a@b.c' → `getByPlaceholder('Email').fill('a@b.c')`; WITHOUT the input → value 'TODO' AND a gap "input 'email' has no value".
  3. route assertion: must-edge to /checkout → `toHaveURL` proven:true; may-edge → assertion proven:false and rendered commented.
  4. parameterized route /products/:id with params {id:'42'} → `toHaveURL` containing '/products/42'; without params → regex form + gap "route param :id unbound".
  5. effect 'open:modal' → `getByRole('dialog')).toBeVisible()`.
  6. effect 'api:POST /orders' → emits `waitForRequest` with method POST and url includes '/orders' wrapping the action (assert ordering: waitForRequest declared BEFORE the click, awaited AFTER); reuse parseApiEffect — assert it is called/consistent with openapi.test.ts expectations.
  7. containment step folding: a path [screen→control (available), control→target] yields ONE leg (the control gesture), not two; no action emitted for the '(available)' edge.
  8. witness screenshot + visualBaseline:true → `toHaveScreenshot('<edgeId>.png')` present and proven:false; visualBaseline:false → absent.
  9. fallback locator when selector undefined → inferred `getByRole`/`getByPlaceholder` + gap "selector inferred, not stamped".
  10. fullyProven flips false when any leg has a non-proven primary assertion; gaps deduped across legs.
  11. renderPlaywrightSpec output: contains `import { test, expect } from '@playwright/test'`, one `test(`, the baseUrl goto, and is deterministic (snapshot-stable) for fixed input.

B. packages/mcp/src/tools.test.ts (extend): genSpecTool over a seeded store returns found:true with spec containing `test(` for a reachable pair; found:false + empty spec for an unreachable pair (parallels existing planPathTool tests). Assert it does NOT write any file.

C. packages/cli/src/cli.test.ts (extend): runGen against the real sample-react-app golden (SAMPLE_REACT, already imported) — map it, then `runGen({dir, from:'n_root', to:'n_checkout', framework:'playwright'})` writes `<dir>/e2e/*.spec.ts` (assert existsSync), GenSummary.legs>0, and `runGen` with framework:'angular' throws. One end-to-end: the emitted file parses as valid TS via the ts-morph Project already available (createSourceFile) — cheap syntactic validity check without running Playwright. Unreachable pair → found:false, no file written.

Concrete fixtures: build a tiny UiGraph in-memory (node()/edge() helpers like cli.test.ts) plus use the sample-react-app's /checkout (form inputs, required email) and /products/:id (parameterized) which already exist in examples/sample-react-app/src/pages, so the param + form-input + api-effect branches hit real extracted data.

## Files to touch

- `packages/core/src/codegen.ts (NEW — buildSpecPlan, renderPlaywrightSpec, SpecPlan/SpecLeg/SpecAction/SpecAssertion types; pure)`
- `packages/core/src/codegen.test.ts (NEW — TDD, all pure)`
- `packages/core/src/index.ts (export the codegen surface + types, alongside the algorithms exports)`
- `packages/mcp/src/tools.ts (NEW genSpecTool + GenSpecArgs/GenSpecResult)`
- `packages/mcp/src/server.ts (register gen_spec in TOOLS catalogue + dispatch case)`
- `packages/mcp/src/tools.test.ts (extend with genSpecTool cases)`
- `packages/cli/src/commands.ts (NEW runGen + RunGenOptions/GenSummary; slug helper; reuse merged-graph load)`
- `packages/cli/src/cli.ts (register `gen <from> <to>` command with --framework/--out/--base-url/--param/--input/--visual-baseline/--allow)`
- `packages/cli/src/cli.test.ts (extend with runGen cases against sample-react-app)`
- `packages/core/src/ir.ts (ONLY if F-control-identity-selectors has not already added ControlMeta.selector — this feature consumes it; do not author it here)`
- `docs/roadmap.md (add the feature row under a codegen milestone; mark dependency F-control-identity-selectors)`
- `docs/features/F-codegen-playwright.md (NEW feature doc, docs-first convention)`

## Dependencies

- F-control-identity-selectors (HARD): supplies ControlMeta.selector (the stable testid/role/label identity) that the locator renderer maps to getByTestId/getByRole/getByLabel/getByPlaceholder. Until it lands, codegen ships with a fallback that infers a locator from the existing ControlMeta (element/controlType/name) and flags a gap; it strengthens automatically once selectors are stamped.
- F-input-guard (SOFT / data hand-off): the graph today has no concrete input values and only SYMBOLIC guard text (GraphEdge.guard is a string like 'isLoggedIn', captured by adapter-react getGuard). Codegen therefore cannot fill real form data or satisfy a guard precondition (e.g. 'must be authenticated before /checkout'). Every such missing datum is surfaced as a // TODO(uigraph) gap line and in SpecPlan.gaps/GenSummary.gaps. F-input-guard would supply input exemplars and guard-satisfaction preconditions to close these gaps; this feature is built to consume them when present (opts.inputs/opts.params today; a richer guard-precondition input later).
- Built on existing, already-implemented pieces: core planPath + PlanStep (algorithms.ts), parseApiEffect/summarizeApiEffect (openapi.ts) for the api:effect assertion, the IR types (ir.ts), loadMergedGraph (mcp/tools.ts), and the CLI command-body pattern (commands.ts/cli.ts).

## Risks

1) MCP PlanPathStep is LOSSY: planPathTool (tools.ts) flattens steps to {edgeId,from,to,event,guard,modality} and DROPS effect, witness.screenshot, and the full node/control meta. genSpecTool MUST call core planPath directly (returns rich PlanStep[]) — NOT reuse planPathTool's flattened output — or the api/modal/screenshot assertions and locator derivation are impossible. (Optionally extend PlanPathStep to carry effect for parity, but codegen should not depend on it.) 2) loadMergedGraph lives in mcp/tools.ts, not core; the CLI runGen needs the same merged view. DRY risk: either import the MCP helper (cli already depends on @ui-graph/mcp via startServer in cli.ts) or extract a shared loadMergedGraph into @ui-graph/core/node. Prefer the latter (small, removes a real 2-site duplication) — verify the import direction first; do not create a cycle. 3) Dependency ordering: F-control-identity-selectors is unbuilt (confirmed: no `selector` field anywhere in the repo today). The fallback locator path is mandatory so this feature is not blocked, but its tests must cover BOTH the selector-present and selector-absent branches. 4) Containment-edge folding is subtle: a naive 1-leg-per-step emission would emit a bogus action for the synthetic '(available)' edge — the test for fold (A.7) is the guard against this. 5) Selector/value string injection into generated source: render with proper escaping (JSON.stringify for string literals inside getBy* / fill) so a control name containing a quote/newline cannot break or inject into the emitted TS — treat extracted strings as untrusted text (security-by-default). 6) Parameterized-route assertion precision: a `:id` left unbound must degrade to a regex URL match, never a literal `:id` in the assertion (would always fail) — covered by test A.4. 7) Scope creep (YAGNI): emit ONE framework (playwright) and ONE test per path; resist a generic multi-framework template engine until a second framework is actually requested — `--framework` validates and throws otherwise.
