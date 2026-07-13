# 50 — Validation Ladder

How we earn the right to call uigraph v1 "working." Trust is built in rungs, lowest
first; each rung depends on the one below it. The dossier's evaluation (section 10)
aims at golden-truth precision/recall over a corpus — that is the research target. For
v1 we keep the *spirit* (a known ground truth, measured against a deterministic
extractor) but stay pragmatic: hand-authored golden fixtures, exact graph equality on
small apps, coverage/sanity on the real one.

## Ground rule for every rung

A rung is **not passed** until BOTH hold:

1. **Check gate green** — `pnpm check` (the root `scripts/check.mjs`: `typecheck` +
   `test` + `lint`) passes for the packages the rung touches.
2. **Golden / criterion holds** — the rung's specific artifact below proves the claim.

A green check gate with a stale or absent golden does not count. A matching golden with
a red gate does not count. Both, or the rung is open.

The golden invariant runs through all of it: **no edge enters the base graph without a
deterministic witness** (static proof). Manual edits live in the sidecar overlay and are
out of scope for adapter goldens — goldens are taken over the static base graph only.

---

## RUNG 1 — Core (framework-agnostic)

The core never sees a framework. We prove the IR ops and graph algorithms in isolation.

- **What we test:** pure ops `load` / `save` / `merge` / `diff` / `validate`, and the
  graph algorithms (reachability, `plan_path` / BFS). Property tests for the laws that
  must hold: `merge(base, ∅) == base`; overlay never mutates base; `diff` is the inverse
  of applying a patch; `validate` rejects any edge lacking a witness; modal labels
  (`must` / `may` / `unknown`) survive a load→save round-trip.
- **Golden artifact:** hand-written golden IR fixtures (small graphs authored by hand)
  loaded and asserted field-by-field — node set, edge set, per-edge `source`
  (`static|manual|runtime`), `confidence`, and modality.
- **PASS criterion:** all core unit + property tests green; golden IR fixtures
  load/save/round-trip byte-stable; `validate` fails closed on a witness-less edge.
- **Proves it:** vitest output for `@ui-graph/core`.

## RUNG 2 — React adapter on `examples/sample-react-app`

`examples/sample-react-app` is a small, hand-authored app with a **known, documented**
set of routes, guards, and navigations — covering both react-router **v5**
(`<Switch>`, `<Route component|render>`, `useHistory().push`, `<Redirect>`) and **v6**
(`<Routes>`, `<Route element>`, `useNavigate()`, `<Navigate>`).

- **What we test:** `extract(projectDir)` on the sample produces an IR graph equal to the
  committed golden.
- **Golden artifact:** committed golden graph for the sample app.
- **PASS criterion:** extracted graph **matches the golden exactly** — node set, edge
  set, and modalities — for both router versions. Every committed route is a node; every
  documented navigation is an edge with the expected `source=static` and modality.
- **Proves it:** golden diff (extracted vs committed) is empty in the adapter-react test
  suite.

## RUNG 3 — Angular adapter on `examples/sample-angular-app`

Same discipline, Angular constructs: `RouterModule`/`Routes` config
(`path` / `component` / `children` / `canActivate`), `Router.navigate` /
`navigateByUrl`, `routerLink`. `canActivate` guard class names are captured as symbolic
guard text and become **may-edges**.

- **Golden artifact:** committed golden graph for the sample Angular app.
- **PASS criterion:** extracted graph matches the golden exactly — nodes, edges,
  modalities — with guarded routes appearing as `may` edges carrying the guard symbol.
- **Proves it:** empty golden diff in the adapter-angular test suite.

## RUNG 4 — Both adapters green together

Confirms the framework-agnostic contract actually holds: two adapters, one IR shape, no
cross-contamination.

- **What we test:** run rungs 2 and 3 in one pass; assert both goldens hold and that the
  two extracted graphs are the **same IR shape** (same schema, same field names/types —
  React-isms have not leaked into the core or the Angular output, and vice versa).
- **PASS criterion:** both adapter goldens hold simultaneously; both outputs validate
  against the single core IR schema; nothing framework-specific lives below the adapter
  boundary.
- **Proves it:** full `pnpm check` green across core + both adapters in one run.

## RUNG 5 — Real-world: React adapter on a production frontend

Target: a large closed-source production SPA (react-router-dom **v5**, the
real-world v5 case). Here we have **no exact golden**, so we drop equality and measure
coverage and sanity instead.

- **What we measure:**
  - **Coverage** — every route declared in the app's router config becomes a node in the
    graph (count declared routes; assert each appears).
  - **Sanity** — `extract` runs to completion with **no crashes** on real source.
  - **Soundiness report** — the run emits a list of the dynamic cases it could not
    resolve statically (computed targets, non-literal paths, indirection beyond literal
    targets + the declared-route over-approximation). Honest unknowns are expected, not
    failures.
  - **Eyeball** — a human spot-checks a sample of nodes/edges against the actual app.
- **PASS criterion:** 100% of declared routes present as nodes; zero crashes; a
  soundiness report listing the dynamic cases; sampled edges look right on inspection.
- **Proves it:** coverage report (declared-vs-extracted route count) + the soundiness
  report + recorded eyeball sample.

---

## Order of trust

```
RUNG 1 core  →  RUNG 2 react/sample  →  RUNG 3 angular/sample
            →  RUNG 4 both green     →  RUNG 5 real production frontend
```

Climb in order. v1 is "working" when rungs 1–4 are green on exact goldens and rung 5
clears its coverage/sanity bar on the real frontend.
