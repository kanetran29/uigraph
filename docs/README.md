# uigraph — Documentation

Your app generates its own behavioral map. Tests, docs, and agents are views over it. These docs describe v1: the framework-agnostic IR, the adapter contract, the pure ops, and the end-to-end slice (core; React, Vue, Angular, and Next.js adapters; MCP server; CLI; dashboard).

## How to use these docs

Read them in order: start with the [overview](./00-overview.md) for the problem and the shape of v1, then the [architecture](./10-architecture.md) for the core/adapter split, the [development cycle](./20-development-cycle.md) for how each feature gets built, and the [adapter contract](./40-adapter-contract.md) for the seam every framework plugin implements. Then implement features from the [roadmap](./roadmap.md) top-to-bottom — each one through the full development cycle, climbing the [validation ladder](./50-validation-ladder.md) from fixtures to sample-app golden graphs to real-world validation. The [IR spec](./30-ir-spec-v0.md) is the reference you keep open the whole way through.

## Reading order

1. [00-overview.md](./00-overview.md) — the problem, what v1 is, and the three guarantees that survive better models.
2. [10-architecture.md](./10-architecture.md) — the core/adapter split, packages, and data flow.
3. [20-development-cycle.md](./20-development-cycle.md) — tests-first, implement, and the self-healing check gate every feature passes.
4. [30-ir-spec-v0.md](./30-ir-spec-v0.md) — the framework-agnostic IR: guarded modal LTS, modality, per-edge source and confidence.
5. [40-adapter-contract.md](./40-adapter-contract.md) — the `extract`/`register`/`stamp` contract every framework plugin implements.
6. [50-validation-ladder.md](./50-validation-ladder.md) — the rungs from golden fixtures to sample-app validation to a real production frontend.
7. [roadmap.md](./roadmap.md) — every v1 feature, grouped by milestone, in intended build order.

## Directories

- [features/](./features/) — one spec per shipped feature, grouped by domain (`foundation/`, `core/`, `adapters/`, `cli/`, `mcp/`, `loop/`).
- [validation/](./validation/) — empirical reports: the premise ablation and the Tier-3 live-run reports.
- [superpowers/specs/](./superpowers/specs/) — dated design documents behind the larger changes.

## Source of truth

The research dossier [`ui-graph-dossier-final-en.md`](ui-graph-dossier-final-en.md) is the source-of-truth research dossier behind these docs; when a doc and the dossier disagree, the dossier wins.
