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
| `@uigraph/cli` | `uigraph map` / `diff` / `serve` / `mcp` |
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

`map --adapter angular` works the same on an Angular project. `uigraph mcp <dir>`
starts the MCP server for Claude Code / Cursor.

## Development

Each feature is built through the cycle in
[docs/20-development-cycle.md](docs/20-development-cycle.md): think → abstract
design → low-level design → tests-first → implement → **self-heal** (`pnpm check`,
max 3 iterations) → self-check → commit. Adapters climb the
[validation ladder](docs/50-validation-ladder.md): core unit/golden → sample-react
→ sample-angular → refapp.
