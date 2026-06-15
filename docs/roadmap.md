# uigraph — Roadmap

This roadmap enumerates every feature of v1, grouped by milestone. The **features are listed in intended build order**: each feature is built only after its dependencies, then carried through the full [development cycle](./20-development-cycle.md) (tests-first, implement, self-healing check gate). Adapter features in particular are validated against hand-authored **sample-app golden graphs** by climbing the [validation ladder](./50-validation-ladder.md).

## Legend

**Level** — where a feature sits in the architecture:

- **infra** — workspace, toolchain, and the self-healing check gate. The frame everything else is built into.
- **L0** — foundational contracts and types: the framework-agnostic IR, the adapter contract, the JSON schema, and the golden fixtures.
- **L1** — pure core ops, graph algorithms, the first layer of each adapter (route + literal-navigation extraction), the CLI, the MCP tools, and the dashboard shell.
- **L2** — the harder, soundiness-bearing work: over-approximation, guard capture, golden validation, manual-edit overlay flows, the steps view, and real-world validation.

**Status** — every feature is `planned` until built and passed through the cycle.

**Build order** — follow the tables top-to-bottom across milestones; the `Depends on` column shows the hard prerequisites.

---

## M0 — Foundation

**Goal:** Monorepo scaffold, self-healing check gate, framework-agnostic IR core types, and the Adapter contract interface.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F0.1 | pnpm workspace monorepo scaffold | infra | — | planned | [F0.1](./features/F0.1-monorepo-scaffold.md) |
| F0.2 | Shared TypeScript, vitest, and eslint toolchain | infra | F0.1 | planned | [F0.2](./features/F0.2-toolchain-ts-vitest-eslint.md) |
| F0.3 | Self-healing check gate (scripts/check.mjs) | infra | F0.2 | planned | [F0.3](./features/F0.3-self-healing-check-gate.md) |
| F0.4 | Framework-agnostic IR types (guarded modal LTS) | L0 | F0.3 | planned | [F0.4](./features/F0.4-core-ir-types.md) |
| F0.5 | Adapter contract interface (extract/register/stamp) | L0 | F0.4 | planned | [F0.5](./features/F0.5-adapter-contract-interface.md) |

## M1 — Core ops

**Goal:** Pure load/save+schema, invariant validation, overlay merge, diff, and the graph algorithms layer (reachability + plan_path BFS).

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F1.1 | UiGraph JSON schema | L0 | F0.4 | planned | [F1.1](./features/F1.1-graph-json-schema.md) |
| F1.2 | Pure load/save graph ops | L1 | F1.1 | planned | [F1.2](./features/F1.2-load-save-ops.md) |
| F1.3 | Invariant validation (golden witness invariant) | L1 | F1.2 | planned | [F1.3](./features/F1.3-validate-invariants.md) |
| F1.4 | Sidecar overlay model and merge(base, overlay) | L1 | F1.3 | planned | [F1.4](./features/F1.4-overlay-merge-model.md) |
| F1.5 | diff(a, b) over two graphs | L1 | F1.4 | planned | [F1.5](./features/F1.5-diff-graphs.md) |
| F1.6 | Graph algorithms: reachability and plan_path BFS | L1 | F1.5 | planned | [F1.6](./features/F1.6-graph-algorithms-reachability-bfs.md) |

## M2 — React adapter + sample-react-app

**Goal:** Sample React app fixture, then React Router v5+v6 route-node and navigation-edge extraction with over-approximation, guard capture, and soundiness report validated against a golden graph.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F2.1 | Scaffold sample-react-app golden fixture | L0 | F0.5 | planned | [F2.1](./features/F2.1-sample-react-app-fixture.md) |
| F2.2 | React route-node extraction (v5 + v6) | L1 | F2.1, F1.6 | planned | [F2.2](./features/F2.2-react-route-node-extraction.md) |
| F2.3 | React literal navigation-edge extraction | L1 | F2.2 | planned | [F2.3](./features/F2.3-react-literal-navigation-edges.md) |
| F2.4 | Over-approximation for non-literal React targets | L2 | F2.3 | planned | [F2.4](./features/F2.4-react-over-approximation-edges.md) |
| F2.5 | React guard capture as symbolic guard text | L2 | F2.4 | planned | [F2.5](./features/F2.5-react-guard-capture.md) |
| F2.6 | React adapter soundiness report | L2 | F2.5 | planned | [F2.6](./features/F2.6-react-soundiness-report.md) |
| F2.7 | Validate React adapter against sample golden graph | L2 | F2.6 | planned | [F2.7](./features/F2.7-react-adapter-golden-validation.md) |

## M3 — Angular adapter + sample-angular-app

**Goal:** Sample Angular app fixture, RouterModule/Routes extraction, navigate/routerLink edges, and canActivate guard capture to may-edges validated against a golden graph.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F3.1 | Scaffold sample-angular-app golden fixture | L0 | F0.5 | planned | [F3.1](./features/F3.1-sample-angular-app-fixture.md) |
| F3.2 | Angular RouterModule/Routes extraction | L1 | F3.1, F1.6 | planned | [F3.2](./features/F3.2-angular-route-extraction.md) |
| F3.3 | Angular navigate/navigateByUrl/routerLink edges | L1 | F3.2 | planned | [F3.3](./features/F3.3-angular-navigation-edges.md) |
| F3.4 | Angular canActivate guard capture to may-edges | L2 | F3.3 | planned | [F3.4](./features/F3.4-angular-canactivate-guards.md) |
| F3.5 | Validate Angular adapter against sample golden graph | L2 | F3.4 | planned | [F3.5](./features/F3.5-angular-adapter-golden-validation.md) |

## M4 — CLI

**Goal:** uigraph CLI with map --adapter, diff, the local API server feeding the dashboard, and dash + mcp launchers.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F4.1 | uigraph CLI scaffold and command dispatch | L1 | F1.6, F2.7, F3.5 | planned | [F4.1](./features/F4.1-cli-scaffold.md) |
| F4.2 | CLI map --adapter command | L1 | F4.1 | planned | [F4.2](./features/F4.2-cli-map-command.md) |
| F4.3 | CLI diff command | L1 | F4.2 | planned | [F4.3](./features/F4.3-cli-diff-command.md) |
| F4.4 | Local API server feeding the dashboard | L1 | F4.2 | planned | [F4.4](./features/F4.4-local-api-server.md) |
| F4.5 | CLI dash and mcp launchers | L1 | F4.4, F5.1 | planned | [F4.5](./features/F4.5-cli-dash-mcp-launchers.md) |

## M5 — MCP server

**Goal:** Stdio MCP scaffold exposing get_graph, plan_path, update_graph (overlay), report_observation (append-only log), and diff over core IR.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F5.1 | Stdio MCP server scaffold | L1 | F1.6 | planned | [F5.1](./features/F5.1-mcp-stdio-scaffold.md) |
| F5.2 | MCP get_graph tool | L1 | F5.1 | planned | [F5.2](./features/F5.2-mcp-get-graph.md) |
| F5.3 | MCP plan_path tool | L1 | F5.2 | planned | [F5.3](./features/F5.3-mcp-plan-path.md) |
| F5.4 | MCP update_graph tool (writes to overlay) | L1 | F5.3 | planned | [F5.4](./features/F5.4-mcp-update-graph-overlay.md) |
| F5.5 | MCP report_observation (append-only log) and diff tools | L1 | F5.4 | planned | [F5.5](./features/F5.5-mcp-report-observation-and-diff.md) |

## M6 — Dashboard

**Goal:** Vite+React+React Flow editable graph view: canvas styled by modality+source, inspector, manual edits to overlay, and a plan_path steps view.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F6.1 | Vite + React + React Flow dashboard scaffold | L1 | F4.4 | planned | [F6.1](./features/F6.1-dashboard-scaffold.md) |
| F6.2 | Graph canvas styled by modality and source | L1 | F6.1 | planned | [F6.2](./features/F6.2-dashboard-graph-canvas.md) |
| F6.3 | Inspector panel for nodes and edges | L1 | F6.2 | planned | [F6.3](./features/F6.3-dashboard-inspector-panel.md) |
| F6.4 | Manual edit to overlay persistence | L2 | F6.3 | planned | [F6.4](./features/F6.4-dashboard-manual-edit-overlay.md) |
| F6.5 | Steps view (plan_path walk) | L2 | F6.4 | planned | [F6.5](./features/F6.5-dashboard-steps-view.md) |

## M7 — Real-world validation

**Goal:** Run the React adapter on the real refapp.example react-router v5 frontend and produce a coverage/sanity and soundiness-gap report.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F7.1 | Run React adapter on the refapp.example frontend | L2 | F2.7, F4.2 | planned | [F7.1](./features/F7.1-refapp-frontend-extraction-run.md) |
| F7.2 | Coverage/sanity and soundiness-gap report for refapp frontend | L2 | F7.1 | planned | [F7.2](./features/F7.2-refapp-coverage-soundiness-report.md) |

## M8 — Multi-framework control parity

**Goal:** Bring every adapter to control-level parity so all three frameworks expose the same IR (screens + controls + selectors + nav edges) to agents. React was the reference; this milestone adds Angular control extraction and a brand-new Vue adapter, each validated against a sample-app golden graph and wired into `map --adapter`.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F8.1 | Angular control + selector extraction (parity with React) | L2 | F3.5, F-control-identity-selectors | done | [F-angular-controls](./features/F-angular-controls.md) |
| F8.2 | Vue Router adapter + sample-vue-app + CLI wiring | L2 | F8.1 | done | [F-vue-adapter](./features/F-vue-adapter.md) |

## M9 — Self-healing proposal loop + agent kit

**Goal:** Close the loop on quarantined proposals — derive their lifecycle from the observation log (confirm→archive, refute/hallucinate→withdraw), expose a deterministic loop-completion signal so an LLM can drive to 100% resolution, and ship the whole protocol (rules + tool playbook + loop) as a kit any MCP client loads.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F9.1 | Proposal reconciliation loop (status fold, loop-done metric, MCP tools) | L2 | F5.5, F-coverage-tier3 | done | [F-proposal-loop](./features/F-proposal-loop.md) |
| F9.2 | Shippable LLM agent kit (skill + rules + guides + loop), MCP resource + `uigraph kit` | L2 | F9.1 | done | [F-agent-kit](./features/F-agent-kit.md) |

## M10 — Modal & deep-view control reach

**Goal:** Stop treating modals as opaque leaves. Descend into a modal's own component file (incl. one delegation hop) to surface the controls rendered inside it — login OAuth + email form, could-buy/could-sell forms — parented to the modal node, ids byte-stable, navs capped to `may`. Deep non-modal views (profile) and a first-class external-redirect sink are deferred follow-ups.

| ID | Title | Level | Depends on | Status | Doc |
|----|-------|-------|------------|--------|-----|
| F10.1 | Modal-control descent (imported modals → controls under the modal node) | L2 | F-control-identity-selectors, F2.9 | done | [F-modal-controls](./features/F-modal-controls.md) |
| F10.2 | Deep overlay-view reach (*Visible-gated sub-views; e.g. ProfileView) | L2 | F10.1 | done | [F-deep-view-controls](./features/F-deep-view-controls.md) |
