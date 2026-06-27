# Recall-first coverage MCP — design

**Date:** 2026-06-27
**Status:** approved (brainstorming) — pending implementation plan
**Topic:** an MCP server that lets an AI agent know *all the possible cases* in an app
by maximizing the discovered case set (recall), then verifying each case so the
agent can plan over a trustworthy, gap-aware behavioral map.

## 1. Problem & goal

Today uigraph is **precision-first**: nothing enters the base graph without a
deterministic static witness (the golden invariant), LLM guesses live in a
quarantined proposals sidecar, and runtime verification promotes the few that can
be driven. This guarantees soundness but leaves most of an app's *behavioral* long
tail (per-input validation, error/async outcomes, retries, rate-limits) undiscovered.

The product goal is the inverse emphasis: a **recall-first** system whose MCP server
gives an AI agent the *most complete map of every behavioral case the app can
exhibit*, with each case labeled by how much it can be trusted, so the agent can
**act and plan safely in-app and never be silently blind to a case**.

This is a shift of *priority*, not of primitives — it reuses uigraph's IR
(nodes/edges with guard/effect, `modality` must/may/unknown, `source`
static/runtime/manual), proposals store, runtime observations, and coverage.

## 2. Decisions (from brainstorming)

- **Primary consumer:** an agent that *acts/plans in the app*. It needs a complete,
  trustworthy map and must **know what it does not know** (explicit unknowns).
- **Case boundary:** **behavioral equivalence classes** — one case per
  behaviorally-distinct outcome (valid-submit, invalid-email, 409-taken,
  rate-limited, loading), NOT per concrete value. This bounds the otherwise-infinite
  value/sequence space.
- **Trust model:** **keep every case, tag by strongest evidence (tiered)**. Recall
  stays maximal; safety comes from honest labels, not from dropping the long tail.
- **Approach:** **Generate–Verify–Promote loop** (A) as the spine, with a runtime
  crawler (B) as the verify engine and OpenAPI ingestion (C) as a seed. They
  compose, not compete.

## 3. Case model

A **case = one IR edge**: `(fromState, eventClass, guard, outcomeClass, toState)`.
Reuses `GraphEdge` (packages/core/src/ir.ts). `outcomeClass` is the
behaviorally-distinct result and resolves to either a real screen node or a
synthetic sub-state node (the existing `ps_*` sub-state mechanism:
`error`/`toast`/`loading`/`empty`/`modal`/…).

**Trust tier** — a single field *projected on read* from existing
`source` + `modality` + proposal status, ordered so the agent knows how far to lean:

| tier | derived from | agent meaning |
| --- | --- | --- |
| `witnessed` | `source=runtime`, confirmed observation | trust to plan/act |
| `proven` | `source=static`, `modality=must`, has witness | trust (deterministic) |
| `asserted` | `source=static\|manual`, `modality=may` | exists in code, not exercised |
| `llm-verified` | proposal judged plausible, not run | plausible; verify before relying |
| `proposed` | candidate, unjudged | weak; treat as hypothesis |
| `unknown` | frontier (un-enumerated out-edges / dynamic sink) | **probe/ask before relying** |

**Frontier (the safety spine):** every state carries explicit `unknown` out-edges /
a completeness flag = the *known unknowns*. The agent is never silently blind — it is
told where the map is incomplete. The system **never claims "100% of all cases"**;
the true denominator is unknowable.

## 4. Architecture — the recall-first loop

```
SEED      static map  +  OpenAPI ingest          → sound base + documented response-cases
RECALL    LLM proposer swarm (multi-lens,         → candidate cases (equivalence classes)
          loop-until-dry, dedup by class-key)
VERIFY    LLM-judge (kill hallucinations)         → trust tier per case
          → runtime-confirm (capture-mode drive)
MERGE     fold into store                          → every case kept, labeled
          (base+overlay+proposals+observations)
MEASURE   coverage + frontier                      → recall saturation + ignorance count
SERVE     MCP tools                                → planning agent reads cases by tier
                                                      + feeds its own runtime back
loop until frontier stops shrinking (dry) or budget spent
```

Each phase maps to an isolated, independently-testable unit (see §8).

## 5. Recall engine

- **Proposer lenses** — each an LLM pass with a focused prompt over source + OpenAPI,
  mirroring uigraph's existing proposal categories: *controls/validation ·
  async&error-states (OpenAPI responses) · navigation/deep-link · keyboard/a11y ·
  overlays/disclosure · realtime · list/selection*. Each emits equivalence-class
  candidates `{fromState, eventClass, guard, outcomeClass, rationale, evidenced}`.
- **loop-until-dry** — rounds of (lenses in parallel) → dedup new-vs-seen by class-key
  `(from, eventClass, outcomeClass)` → stop after K consecutive empty rounds
  (= recall saturation).
- **Seeds** — static base (real states/controls) + OpenAPI (each response code → an
  outcomeClass for the relevant submit control). Output stored as quarantined
  proposals (`source=proposal`).
- **Bounds** — `max-rounds` + token budget cap the loop.

## 6. Verify engine

- **V1 LLM-judge** — per candidate: *is this real, given the source?* High-value cases
  get a **perspective-diverse panel** (code-evidence lens + UX-plausibility lens), not
  N identical judges. → `llm-verified` / `rejected (hallucination)` / `uncertain`.
  Cheap, scales, removes swarm noise before expensive runtime work.
- **V2 runtime-confirm** — drivable survivors → Tier-3. **Must use sound confirmation**
  (capture-mode: drive the real interaction with branch-specific values, observe where
  it lands) — *not* the goto-fallback, which over-credits guarded, interaction-triggered
  nav edges (see §9, the flagged soundness bug). Confirmed → `witnessed`;
  observed-not-to-fire → `rejected`; undrivable → stays `llm-verified` + parked-reason.
- **Self-improving loop** — the planning agent's own `report_observation` from live runs
  feeds V2 continuously; real usage hardens the map.
- Reuses `reconcileProposals` + `applyObservations`. Tier projected on read.

## 7. Coverage metric (honest)

The denominator (ALL cases) is unknowable, so completeness is never claimed. Report:
1. **Recall saturation** — new cases/round; dry after K empty rounds →
   *"saturated after N rounds, M cases"* (recall signal, not a guarantee).
2. **Tier distribution** — % of discovered cases per tier; *trustable coverage* =
   witnessed+proven fraction.
3. **Frontier count** — # states with unresolved `unknown` out-edges = explicit
   known-unknowns; the number to drive down.

Readout: *"M cases (saturated); X% witnessed/proven · Y% llm-verified · Z proposed;
F frontier unknowns."*

## 8. MCP surface

Mostly additive — uigraph's MCP already has `get_graph`, `plan_path`, `update_graph`,
`report_observation`, `diff`.

- `get_state(id)` → state + out-cases (eventClass, guard, outcomeClass, toState,
  **trustTier**, evidence)
- `list_cases({from?, outcomeClass?, minTier?})` — filterable case set
- `get_frontier({state?})` → known-unknowns (where to probe/ask) — the safety tool
- `plan_path(from, to, {minTier?})` → tier-aware; flags low-trust hops
- `report_observation(...)` → agent's live runtime feeds recall+verify
- `propose_case(...)` → agent adds a discovered case

## 9. Error handling & dependencies

- Proposer hallucinations → V1 judge → `rejected`; never enter the base graph.
- Only `witnessed`/`proven` are trusted for autonomous action.
- **Soundness dependency:** V2 must NOT use the autonomous goto-fallback, which
  confirms a guarded screen→screen nav edge merely by navigating to the target route
  (codegen.ts `buildSpecPlan` falls back to `goto target` + URL assert; runner.ts
  `makePlaywrightDriver` asserts `page.url()===target`). For interaction-triggered or
  guarded transitions this is a false witness. Fixing/avoiding it (capture-mode or
  required control-drive) is a prerequisite for trustworthy `witnessed` tiers.
  (Tracked separately as the Tier-3 goto-fallback finding.)
- Proposals are bound to the base-graph hash → reconcile/invalidate on re-map.
- Loop bounded by `max-rounds` + token budget.

## 10. Testing

- **Golden fixtures** (sample-form-app first, then react/next/vue/angular samples):
  assert *discovered cases ⊇ authored decision tree*, correct tier labels, and a
  shrinking frontier across rounds.
- **Unit:** class-key dedup; tier projection from source+modality+status; coverage math.
- **Acceptance:** the sign-up form decision tree (DECISION_TREE.md) is the first
  end-to-end target — recall must rediscover every T# and tier them correctly.

## 11. Open questions (resolve in planning)

- Exact `eventClass`/`outcomeClass` vocabulary (canonical enum vs free string).
- Where the trust-tier projection lives (core vs MCP read layer).
- Crawler scope in v1 (reuse Tier-3 runner with capture-mode only, vs a new
  exploratory driver).
- How OpenAPI is supplied (path/URL) and mapped to controls.
