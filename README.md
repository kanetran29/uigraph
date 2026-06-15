# uigraph

Your app generates its own **behavioral map** at build time. A framework-agnostic
core extracts a **UI transition graph** — screens as nodes, `(event, guard, effect)`
transitions as edges, labeled `must` / `may` / `unknown` — that agents, tests, docs,
and impact-analysis are all views over. React and Angular are **adapter plugins**;
the core never knows a framework.

Status: **v1**, validated end-to-end on bundled sample apps and the real
refapp.example frontend. See [docs/](docs/README.md) and the source dossier
[`ui-graph-dossier-final-en.md`](ui-graph-dossier-final-en.md).

## What's here

| Package | Role |
| --- | --- |
| `@uigraph/core` | framework-agnostic IR + pure ops (validate, overlay/merge, diff, plan_path) + the adapter contract |
| `@uigraph/adapter-react` | react-router **v5 + v6** static extraction (ts-morph) |
| `@uigraph/adapter-angular` | Angular `Routes` / `routerLink` / `canActivate` extraction |
| `@uigraph/mcp` | model-free **stdio MCP server** (`get_graph`, `plan_path`, `update_graph`, `report_observation`, `diff`) |
| `@uigraph/cli` | `uigraph map` / `diff` / `serve` (single or multi-project) / `workspace` / `mcp` |
| `apps/dashboard` | **React Flow** editable graph view (the "Obsidian for the UI graph") |
| `examples/sample-*-app` | golden fixtures (known graphs) |

The **golden invariant**: no edge enters the base graph without a deterministic
witness (static proof). Manual edits live in a sidecar **overlay**, never the base.
The core is **model-free** — the connecting agent brings the LLM (BYOA).

## Quickstart

```bash
pnpm install
pnpm check                       # full self-heal gate: typecheck + 88 tests + lint

# extract a graph from an app
pnpm --filter @uigraph/cli run uigraph -- \
  map "$PWD/examples/sample-react-app" --adapter react --out /tmp/demo/ui-graph.json

# serve it + open the dashboard
pnpm --filter @uigraph/cli run uigraph -- serve /tmp/demo --port 4317 &
pnpm --filter @uigraph/dashboard dev      # http://localhost:5173 (proxies /api -> :4317)
```

`map --adapter angular|vue|next` works the same on those projects. `uigraph mcp <dir>`
starts the MCP server for Claude Code / Cursor.

### Multiple projects at once

`uigraph map` auto-registers each project in a per-user registry (`~/.uigraph/`,
or `$UIGRAPH_HOME`). Run `serve` **without a dir** to serve every registered
workspace; a project switcher appears in the dashboard topbar.

```bash
uigraph map ~/work/shop  --adapter next     # registers "shop"
uigraph map ~/work/admin --adapter react    # registers "admin"
uigraph serve                               # serves both, switchable in the dashboard
uigraph workspace list                      # ● available · ○ needs re-map
```

The dashboard selects a project via an **opaque** `?ws=<id>` — that id resolves
only to a registered absolute dir on the server, never builds a path, and the
`/api/workspaces` list omits absolute dirs. `map --no-register` opts out.

## Status & honest limitations (post red-team)

This is an early static-extraction spine. What is actually true today:

**Proven / enforced:**
- Framework-agnostic core (no React/Angular/ts-morph import in `@uigraph/core`).
- The LLM/proposal/manual **quarantine is structurally enforced** — nothing promotes a proposal or a manual edit into a `must`/base edge.
- The **`must`-tier soundness holes are closed**: a programmatic navigation after an early-return, or inside a loop / switch / catch / array-iteration callback, is a `may`-edge; an ambiguous param literal fans out to `may`, never a single wrong `must`; the served base+overlay is re-validated and stale overlays are rejected.

**Not yet true (do not rely on these):**
- **No proof the graph beats an agent grepping the repo.** The dossier's #1 kill-switch — a one-day agent+repo vs agent+repo+graph ablation — has not been run. Adopt with that caveat.
- **The Tier-2 "reviewer" is a session workflow, not shipped code.** `proposals.json` is currently a hand/agent-authored sidecar format; the tool ships no `uigraph review` generator yet.
- **Tier-3 is open**: `report_observation` only appends a log; no observation is folded into a confirmed edge, so a proposal is never promoted by runtime.
- **The artifact is a static snapshot + manual overlay**, not an event-sourced "lockfile" (no reducer/fold, no composite extractor/ruleset/obs-log hash).
- **`unknown` modality** exists in the IR but no adapter emits it yet.
- Adapters extract a partial route set on real apps (refapp: ~half the routes resolved); **an empty/partial graph is not yet always distinguishable from a blind spot** for every router style (e.g. `createBrowserRouter`, aliased hooks, constant route paths).
- OpenAPI binding is core-only (no CLI/MCP/dashboard wiring yet, JSON specs only); the Angular adapter does not extract controls/events/api effects.

The honest near-term priority is **validating the premise** (the ablation) before adding more surface area.

## Development

Each feature is built through the cycle in
[docs/20-development-cycle.md](docs/20-development-cycle.md): think → abstract
design → low-level design → tests-first → implement → **self-heal** (`pnpm check`,
max 3 iterations) → self-check → commit. Adapters climb the
[validation ladder](docs/50-validation-ladder.md): core unit/golden → sample-react
→ sample-angular → refapp.
