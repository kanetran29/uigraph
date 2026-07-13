# uigraph

Your app generates its own **behavioral map** at build time. A framework-agnostic
core extracts a **UI transition graph** — screens as nodes, `(event, guard, effect)`
transitions as edges, labeled `must` / `may` / `unknown` — that agents, tests, docs,
and impact-analysis are all views over. React and Angular are **adapter plugins**;
the core never knows a framework.

Status: **v1**, validated end-to-end on bundled sample apps and the real
refapp.example frontend. See [docs/](docs/README.md) and the source dossier
[`docs/ui-graph-dossier-final-en.md`](docs/ui-graph-dossier-final-en.md).

![The dashboard on the adversarial gauntlet sample: green edges are runtime-witnessed, the coverage panel keeps verified / runtime-verified / parked honestly distinct](docs/assets/dashboard-graph.png)

*The bundled gauntlet sample after a verify run: 65% of transitions runtime-witnessed
(green), 100% accounted — every remaining edge either proven or parked with a
written reason. The numbers never conflate.*

## What's here

| Package | Role |
| --- | --- |
| `@uigraph/core` | framework-agnostic IR + pure ops (validate, overlay/merge, diff, plan_path, codegen, coverage, trust tiers) + the adapter contract |
| `@uigraph/adapter-react` | react-router **v5 + v6 + data-router (`createBrowserRouter`)** static extraction (ts-morph) |
| `@uigraph/adapter-vue` | vue-router (SFC template + script, nested routes, guards) |
| `@uigraph/adapter-angular` | Angular `Routes` / `routerLink` / `canActivate` extraction |
| `@uigraph/adapter-next` | Next.js filesystem routes (App + Pages router) on the shared react engine |
| `@uigraph/mcp` | model-free **stdio MCP server**, 27 tools (`get_graph`, `plan_path`, `propose`, `report_observation` — proof-gated, `update_graph`, `diff`, …) |
| `@uigraph/cli` | `uigraph map` / `verify` (`--all`, `--until-done`) / `login` / `dash` / `gen` / `diff` / `serve` / `workspace` / `mcp` |
| `apps/dashboard` | **React Flow** viewer: graph, coverage, freshness, verify worklist (read-only; editing lives in studio) |
| `examples/sample-*` | golden fixtures, incl. the adversarial **gauntlet** (35 graded extraction expectations) |

The **golden invariant**: no edge enters the base graph without a deterministic
witness (static proof). Manual edits live in a sidecar **overlay**, never the base.
The core is **model-free** — the connecting agent brings the LLM (BYOA).

## Quickstart

```bash
pnpm install
pnpm check                       # full self-heal gate: typecheck + tests + lint

# extract a graph from an app
pnpm --filter @uigraph/cli run uigraph -- \
  map "$PWD/examples/sample-react-app" --adapter react --out /tmp/demo/uigraph.db

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

![Multi-project switcher with the freshness banner: the Vue RealWorld graph is out of date and says so, and the verify worklist names exactly what to confirm next](docs/assets/dashboard-freshness.png)

*Freshness is never silent: a stale graph gets a banner, and the verify worklist
ranks exactly which conditional edges to confirm next — with the reminder that a
confirmation needs proof.*

## Status & honest limitations (post red-team)

This is an early static-extraction spine. What is actually true today:

**Proven / enforced:**
- Framework-agnostic core (no React/Angular/ts-morph import in `@uigraph/core`).
- The LLM/proposal/manual **quarantine is structurally enforced** — nothing promotes a proposal or a manual edit into a `must`/base edge.
- **The map is partial by design and says so.** No coverage number is a completeness claim — the denominator (all real behaviors) is unknowable. Metrics are honest about which fraction they measure: `verified%` = runtime-confirmed edges, `accounted%` = edges resolved by any means (parking included); the two are kept distinct and a parked edge is accounted-for but **never** verified. `loopDone` means "all *known* work resolved," not "the app fully mapped." Timing/race, multi-field, and cross-session behaviors are outside what a finite graph represents and are never counted.
- The **`must`-tier soundness holes are closed**: a programmatic navigation after an early-return, or inside a loop / switch / catch / array-iteration callback, is a `may`-edge; an ambiguous param literal fans out to `may`, never a single wrong `must`; the served base+overlay is re-validated and stale overlays are rejected.
- **Verification is proof-gated.** `report_observation(confirmed)` requires structured evidence (a real URL change, an asserted URL/dialog, or an existing screenshot file) plus `reportedBy` provenance, or it is rejected and records nothing — a hallucinated confirmation cannot enter the witnessed tier. The fold matches observations by the full `(from, to, event)` triple, preserves guards/modality on guarded edges (existence ≠ unconditionality), and stamps each observation with the base hash: after a re-map, old witnesses fold as `witnessStale` (tier drops to `asserted`, excluded from verified%, re-queued by `next_to_verify`).
- **Tier-2 has a shipped write path.** The `propose` MCP tool batch-stores quarantined hypotheses (validated, deduped, base-bound) straight onto the verify worklist — the agent maximizes recall; only a proven observation ever mints an edge.
- **Negatives are honest.** `get_graph` carries a freshness field; "no path" / "no such screen" answers carry a blind-spot caveat (accounted%, freshness) so a partial graph's silence is never mistaken for proof of absence.

**Not yet true (do not rely on these):**
- **No proof the graph beats an agent grepping the repo at scale.** The dossier's #1 kill-switch ablation was run on the 8-route sample ([docs/validation/premise-ablation.md](docs/validation/premise-ablation.md)) and found **zero accuracy delta** — capable agents answer small apps perfectly from source. The premise is predicted to pay off only past ~100 routes, and that large-app test is not yet wired up. So the graph's correctness advantage is unvalidated; adopt for cost/amortization, not accuracy.
- **No shipped Tier-2 generator.** `propose` is the write path, but producing good proposals still depends on the connecting agent following the kit; the tool ships no `uigraph review` generator of its own.
- **`unknown` modality** exists in the IR but no adapter emits it yet.
- Adapters extract a partial route set on real apps (refapp: ~half the routes resolved); **an empty/partial graph is not yet always distinguishable from a blind spot** for every router style (e.g. `createBrowserRouter`, aliased hooks, constant route paths).
- OpenAPI binding is core-only (no CLI/MCP/dashboard wiring yet, JSON specs only); the Angular adapter extracts controls/events but **not** `api:*` effects (React/Vue parity gap), and does not yet trace signal-based routing.

Per-adapter **supported / not-yet-supported** matrices (the honest coverage per framework — data-router config, parallel/intercepting routes, dispatch-driven nav, Angular signals, etc.) live in [docs/40-adapter-contract.md §5](docs/40-adapter-contract.md).

The honest near-term priority is **validating the premise** (the ablation) before adding more surface area.

## Open core

This repository is the complete, MIT-licensed trust engine: extraction,
proof-gated verification, the runner, the MCP server, the CLI, and a
viewer-grade dashboard (graph, coverage, freshness, verify worklist — read
only). Nothing epistemic is paywalled.

The commercial layer, **uigraph studio** (separate private repository), adds
the interactive workflow on top: scenario/feature drafting, overlay editing
and proposals triage in the UI, and Playwright e2e **suite** generation from
the verified graph (per-role auth, regeneration on re-map). The single-path
`uigraph gen` primitive stays here.

## Development

Each feature is built through the cycle in
[docs/20-development-cycle.md](docs/20-development-cycle.md): think → abstract
design → low-level design → tests-first → implement → **self-heal** (`pnpm check`,
max 3 iterations) → self-check → commit. Adapters climb the
[validation ladder](docs/50-validation-ladder.md): core unit/golden → sample-react
→ sample-angular → refapp.
