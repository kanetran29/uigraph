# uigraph Architecture (v1)

This document describes the v1 architecture at an abstract level: the boundaries, the
data model, and the package map. It deliberately contains no implementation code. For
the concrete IR shape, see [`30-ir-spec-v0.md`](./30-ir-spec-v0.md).

## 1. Core vs. adapters: a framework-agnostic core

The central architectural decision is that **`@ui-graph/core` is framework-agnostic**. The
core defines three things and nothing else:

- the **IR** (the intermediate representation that every graph is expressed in),
- the **pure ops** over that IR (load, save, merge, diff, validate), and
- the **adapter contract** — the interface an adapter must implement — plus a small
  **graph-algorithms layer** (reachability, `plan_path`/BFS).

The core never imports React, Angular, or any other framework. It does not know what a
"route" or a "router" is in any specific framework's vocabulary; it only knows nodes,
edges, modal labels, sources, and confidence.

Framework knowledge lives **only** in adapter packages. `@ui-graph/adapter-react`
understands React Router; `@ui-graph/adapter-angular` understands Angular Router. Each
adapter's job is to read one framework's source and emit the shared IR. **Adding a
framework is adding an adapter; the core never changes.** This is enforced by the
dependency direction: adapters depend on core, never the reverse (see §5).

The adapter contract (dossier §17) declares three operations: `extract(projectDir) ->
UiGraph` (the only one required in v1), and `register` (DOM anchor) and `stamp` (testid),
which are **declared but stubbed** in v1.

## 2. Three sources, one invariant

The graph is assembled from three tiers of evidence (dossier §5.1), but only two of them
may ever write an edge:

```
Tier 1  AST / compiler  → must-edges + node inventory   (statically proven)
Tier 2  LLM             → proposals + annotations        (QUARANTINED; never writes the graph)
Tier 3  Runtime agent   → observations → confirmed edges (deterministically witnessed)
```

**Golden invariant:** *no edge enters the graph without a deterministic witness — a static
proof or a runtime observation.* Tier 2 (the LLM) is quarantined: it produces proposals
and semantic annotations only. When an LLM guess is later confirmed, it is the **runtime
observation** that enters the graph, never the guess. The Tier-1 node inventory acts as
the anti-hallucination fence: proposals can only point at nodes that statically exist. A
wrong annotation degrades planning; it can never mint a phantom transition. The LLM is the
heuristic in A* — a bad heuristic only slows the search, it cannot corrupt the result.

## 3. Pure system and the sidecar overlay

The graph is a pure fold over an append-only log of facts (dossier §5.2):

```
G = fold(reduce_fn, static_facts(repo@commit) ++ observation_log)
```

Same log → same graph. `static_facts` is a function of the commit hash, the extractor
version, and the ruleset version, so it is content-addressable and cacheable. Observations
are data with provenance (env hash, seed, commit), not computation. LLM non-determinism
cannot touch purity because it is quarantined outside the fold.

This purity is why **manual human edits never mutate the static base graph.** A manual edit
has no deterministic witness, so admitting it into the base would break the golden
invariant. Instead, manual edits are written to a **sidecar overlay** file. The displayed
graph is always `merge(base, overlay)` — the base stays clean and reproducible from the
repo, while human corrections layer on top non-destructively.

## 4. The IR at a glance

The IR is a **guarded labeled transition system**: nodes are screens/states, edges are
`(event, symbolic guard, effect)` transitions. Every edge additionally carries:

- a **modal label** — `must` | `may` | `unknown` (after Larsen–Thomsen modal transition
  systems),
- a **source** — `static` | `manual` | `runtime`, and
- a **confidence** value.

The IR is fully framework-neutral. The authoritative field-level definition lives in
[`30-ir-spec-v0.md`](./30-ir-spec-v0.md).

## 5. Monorepo package map

pnpm workspaces, TypeScript, vitest, eslint. Dependency direction always points **toward
the core**; the core depends on nothing in the workspace.

| Package | Responsibility | Depends on |
|---|---|---|
| `@ui-graph/core` | Framework-agnostic IR types + pure ops (load/save/merge/diff/validate) + adapter contract + graph algorithms (reachability, plan_path/BFS). | — |
| `@ui-graph/adapter-react` | React Router → IR via ts-morph / TS compiler API. Supports react-router **v5** (`<Switch>`, `<Route component\|render>`, `useHistory().push`, `<Redirect>`) **and v6** (`<Routes>`, `<Route element>`, `useNavigate()`, `<Navigate>`). | core |
| `@ui-graph/adapter-angular` | Angular Router → IR via TS compiler API: `RouterModule`/`Routes` config, `Router.navigate`/`navigateByUrl`, `routerLink`. `canActivate` class names captured as symbolic guard text → may-edges. | core |
| `@ui-graph/mcp` | stdio MCP server exposing `get_graph`, `plan_path`, `update_graph`, `report_observation`, `diff`. Consumes core IR only; framework-agnostic. | core |
| `@ui-graph/cli` (bin `uigraph`) | Subcommands `map --adapter react\|angular <dir>`, `diff <a> <b>`, `dash`, `mcp`. | core, adapters |
| `apps/dashboard` | React + Vite + React Flow editable graph view. Visualizes graph + steps; manual edits write to the overlay. | core |
| `examples/sample-react-app` | Hand-authored React app with a known set of routes/guards/navigations. Golden fixture + integration target. | — |
| `examples/sample-angular-app` | Hand-authored Angular app with a known set of routes/guards/navigations. Golden fixture + integration target. | — |

**Adapters depend on core, never the reverse.** The MCP server and dashboard also depend
only on core IR, so they are equally framework-agnostic — they work identically whether the
graph came from the React adapter or the Angular adapter.

## 6. Data files on disk

The repo carries the app's behavioral state in three files:

- `ui-graph.json` — the **base** graph: static facts only, reproducible from `repo@commit`.
- `ui-graph.overlay.json` — the **sidecar overlay**: manual human edits, merged for display
  but never folded into the base.
- `observations.log.jsonl` — the **append-only observation log**: runtime witnesses, one
  JSON object per line. v1 records observations only; there is no replay engine.

## 7. Model-free / BYOA boundary

The **core, the adapters, and the MCP server never call an LLM API** (dossier §14). The
model is brought by the connecting agent — Claude Code, Cursor, Copilot — over MCP. This
keeps uigraph usable by LLM-banning enterprises (extraction, map, diff, replay are all
LLM-free) and means there is no API key and no billing inside uigraph. Any LLM proposals
flow in through the agent and remain quarantined per §2.

## 8. Diagram

```
  React source ──▶ @ui-graph/adapter-react ─┐
                                           │
  Angular source ▶ @ui-graph/adapter-angular┼──▶ @ui-graph/core (IR)
                                           │     • pure ops: load/save/merge/diff/validate
  runtime agent ─▶ observations ───────────┘     • graph algos: reachability, plan_path/BFS
                                                          │
                            ┌─────────────────────────────┼─────────────────────────────┐
                            ▼                             ▼                             ▼
                      @ui-graph/mcp                  @ui-graph/cli                  apps/dashboard
                  (get_graph, plan_path,        (map, diff, dash, mcp)         (React Flow view;
                   update_graph,                                                manual edits ─▶ overlay)
                   report_observation, diff)

  Data files:  ui-graph.json (base)   ui-graph.overlay.json (sidecar)   observations.log.jsonl (append-only)

                 displayed graph = merge(base, overlay)
```

The connecting agent supplies the model; nothing left of the dashed boundary above ever
calls an LLM.
