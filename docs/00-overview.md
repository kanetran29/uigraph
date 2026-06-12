# uigraph — Overview

**Your app generates its own behavioral map. Tests, docs, and agents are views over it.**

## The problem

AI coding agents are good at two things and blind to a third. They drive a browser well (Playwright MCP), and they read code logic well (grep routes, follow imports, reason about call graphs). But they have no model of the **UI transition graph** — the screens an app can reach and what happens when a user acts on each one. They miss the cases that matter most: one button with multiple behaviors, state-dependent transitions, guards, interceptors. An agent can self-derive a map per session, but that map dies with the session, drifts between runs, and stops fitting the context window past ~100 routes.

The framing is **"LSP for app behavior."** Language servers didn't make jump-to-definition *possible* — grep already did. They made it instant, shared, and consistent. uigraph does the same for behavior: compute the map once per commit, deterministically, and share it across every agent, session, teammate, and CI run. The graph lives *outside* the context window and is queried piecemeal. The moat is not the word "map" — it's the word **verified**.

## What v1 actually is

A runnable, end-to-end slice:

- **`@uigraph/core`** — the framework-agnostic IR and pure operations, plus the adapter contract.
- **`@uigraph/adapter-react`** and **`@uigraph/adapter-angular`** — plugins that turn one framework's router source into the shared IR (React Router v5 *and* v6; Angular `RouterModule`/`Routes`, navigation calls, `routerLink`, guards).
- **`@uigraph/mcp`** — a stdio MCP server (`get_graph`, `plan_path`, `update_graph`, `report_observation`, `diff`) so the connecting agent brings the model.
- **`@uigraph/cli`** (`uigraph map | diff | dash | mcp`).
- **`apps/dashboard`** — a React + Vite + React Flow editable graph view.
- **`examples/sample-react-app`** and **`examples/sample-angular-app`** — golden fixtures with known routes/guards/navigations.

It runs end-to-end on the bundled sample apps; the real refapp.example frontend (react-router v5) is the validation target *after* the samples pass.

## Core vs adapter

The split is the whole architecture:

- **The core** defines the IR (a guarded labeled transition system with modal `must|may|unknown` labels, per-edge source and confidence), the pure ops (`load/save/merge/diff/validate`), a small graph-algorithms layer (reachability, `plan_path`/BFS), and the **adapter contract**. The core knows nothing about any framework.
- **The adapters** are plugins. Each implements the contract — `extract(projectDir) -> UiGraph` in v1 (`register` and `stamp` are declared-but-stubbed) — to map one framework's source into the shared IR.

Adding a framework means adding an adapter. The core never changes.

## Non-goals (v1)

Explicitly **not** built: build/compiler plugin; testid stamping implementation (contract stub only); test-graph plan/run generation; a witness replay player (the observation log is append-only — no replay engine); Next.js; Figma; PR bot / GitHub Action; and interprocedural points-to beyond literal targets plus over-approximation over the declared route set.

## Three guarantees that survive better models

Better models will swallow the fuzzy "may" tier. Value concentrates where they can't:

1. **A deterministic `must` tier.** Statically proven edges are sound w.r.t. the declared route config — same commit, same graph.
2. **The golden invariant.** No edge enters the graph without a deterministic witness (static proof or runtime observation). Manual human edits live in a **sidecar overlay** and never mutate the static base; the displayed graph is `merge(base, overlay)`.
3. **Model-free / BYOA.** The core, adapters, and MCP server never call an LLM API. The connecting agent brings the model — so the LLM-banning enterprise, the subscription user, and the offline CI run are all served.
