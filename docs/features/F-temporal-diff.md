# Temporal diff — "what did my code change do to the UI graph?"

- **Slug:** F-temporal-diff
- **Status:** designed (design + 3-lens red-team, all APPROVE / zero blocking)

## Purpose

`uigraph diff <a> <b>` already diffs two graph FILES. But the everyday question after a
code change is "what did that change do to the UI graph?" — i.e. diff the new map of a
workspace against its **previous** map. Until now each `map` overwrote the base graph and
the prior one was lost, so there was nothing to compare against. This feature snapshots the
base graph at each map and exposes the delta (current vs previous) through the CLI, the MCP
agent loop, and a dashboard panel. It composes with — but is orthogonal to — the freshness
signal: freshness = "did source files change since the map" (fingerprint), temporal diff =
"what changed in the proven graph between two maps".

The diff is over the **proven base graph only** — never overlay/proposals/observations
("what the code change did", not what a human/agent planned). The golden invariant and
quarantine are untouched: rotation and diff read `getBaseGraph()` only.

## Design

### Data model (history depth ONE)

One new `docs` key `graph_prev` holding `GraphSnapshot { graph: UiGraph; mappedAt: string }`.
No new table / migration (`docs` is already key→json). Each successful re-map rotates the
current snapshot into `graph_prev`, so the store always holds exactly current (`graph`) +
previous (`graph_prev`). No accumulation, no unbounded growth.

`mappedAt` in the envelope is the **prior map's** `fingerprint.mappedAt` (the value already
in the DB at rotation time) — never a fresh clock read, keeping the store clock-free. A
workspace whose base graph predates fingerprinting (e.g. a `migrate` import, which never
stamps a fingerprint) snapshots with `mappedAt = ''`, rendered as "unknown".

### Store (packages/core/src/store.ts — node-only)

- `GraphSnapshot { graph: UiGraph; mappedAt: string }` (exported, re-exported via `core/node`).
- `snapshotCurrentAsPrevious(): boolean` — reads `getBaseGraph()`; if null (first map) returns
  `false` with **no write** (no-op-safe). Else writes `graph_prev = { graph: <current>, mappedAt:
  <getFingerprint()?.mappedAt ?? ''> }` and returns `true`. Clock-free (never `new Date()`).
- `getPreviousGraph(): GraphSnapshot | null` — reads `graph_prev`.
- **Critical ordering:** `snapshotCurrentAsPrevious()` must run BEFORE `setBaseGraph` (overwrites
  `graph`) and BEFORE `setFingerprint` (overwrites the `mappedAt` it reads). It is NOT folded into
  `setBaseGraph` because `setBaseGraph` has a second caller — `importJsonWorkspace` (one-shot
  JSON→SQLite migration) — where rotating a non-existent previous would corrupt migration.

### Core diff (packages/core/src/diff.ts — pure, browser-safe)

Reuse the existing pure `diffGraphs(a, b)`. Add ONE pure helper that takes **plain data, not the
Store** (so it stays browser-safe and is the single source of the 3-state branch for all three
consumers — CLI, MCP, serve):

```ts
export interface SinceLastDiff {
  state: 'ok' | 'no-prior' | 'no-current'
  diff: GraphDiff | null
  previousMappedAt: string | null
  currentMappedAt: string | null
  detail: string | null
}
export function diffSinceLast(
  current: UiGraph | null,
  currentMappedAt: string | null,
  previous: { graph: UiGraph; mappedAt: string } | null,
): SinceLastDiff
```

Orientation is load-bearing: `diffGraphs(previous.graph, current)` so added* = what the new code
introduced, removed* = what it deleted, `changedEdges.before` = previous / `.after` = current.
Empty-string `previousMappedAt` is normalized to `null` (→ "unknown").

### CLI (packages/cli)

- `runMap` calls `store.snapshotCurrentAsPrevious()` immediately before `store.setBaseGraph(...)`.
- `runDiffSinceLast(dir): SinceLastDiff` — opens the store, reads base + fingerprint.mappedAt +
  previous, calls `diffSinceLast`. `formatDiffSinceLast(r)` renders the three states + a counts
  headline, reusing `formatDiff` verbatim for the per-change body.
- `diff` command: positionals become optional `[a] [b]`; add `--since-last`. Exactly-one-mode
  guard. `uigraph diff <dir> --since-last` (the workspace dir as `<a>`, mirroring `status <dir>`).

### MCP (packages/mcp)

New tool `diff_since_last` (no args — dir bound via `ToolContext`, like `get_freshness`). The
existing `diff` tool needs two file PATHS the agent doesn't have (the previous base is rotated
inside the DB, not a file), so without this an agent cannot answer "what did that change" through
MCP. Description keeps it distinct from `get_freshness`.

### Dashboard (apps/dashboard)

- Serve `GET /api/changes` (?ws-aware via `config.resolveDir`) returns `SinceLastDiff` — the SAME
  shape as CLI/MCP (one contract). No `fingerprint.projectDir` → no absolute-dir leak; the node/
  edge fields are the same ones `GET /api/graph` already serves (not a new leak class).
- `fetchChanges(wsId?)` mirrors `fetchProposals` (offline-safe `EMPTY_CHANGES` fallback).
- New `Changes.tsx` panel (CollapsibleSection, `panel.changes` i18n in en/fi/vi/zh/de), placed
  FIRST in the side rail. Three states: no-prior (first map) / ok-empty (no changes) / ok-with-
  changes (counts header + Added/Removed/Changed-edges lists, click-to-select guarded against the
  current graph). NO changed-nodes list (GraphDiff has none). NO canvas recoloring (removed
  elements aren't in the rendered current graph — deferred with the cross-workspace visual diff).

## Caveats (from red-team, non-blocking)

- **Mid-map throw** (extraction succeeds but `setBaseGraph` rejects an invalid graph) can leave
  `graph_prev === graph`, a self-healing false "No changes" until the next successful map. No data
  loss; the live proven graph is never lost. Accepted (KISS) — adapters produce valid graphs.
- **Id churn:** a re-map that mass-renames node/edge ids (overlay/LLM-inferred names dangle on
  re-map, see naming-and-remap-durability) reads as wholesale add/remove, not changed-edges —
  inherent to id-based diffing. Copy says "changes by id", never "the only behavioral changes".

## Tests (TDD, failing-first)

- **core store.test.ts:** first-map no-op (false, prev null); rotation captures old graph + old
  mappedAt; rotation reads the PRIOR fingerprint.mappedAt not a clock; fingerprint-null → `''`;
  depth-ONE overwrite.
- **core diff.test.ts:** `diffSinceLast` no-current / no-prior / ok; orientation (node added only
  in current → addedNodes); empty-string previousMappedAt → null.
- **cli.test.ts:** `runDiffSinceLast`/`formatDiffSinceLast` states + counts + reused body; runMap
  rotation (map g1, map g2 → previous == g1); `/api/changes` router (available false on one map,
  the diff + both timestamps on two maps, unknown ?ws still 404).
- **mcp tools.test.ts:** `diff_since_last` no-prior on a single-map store; ok with addedEdges after
  a rotation + changed current.
- **Gate:** `node scripts/check.mjs` green; the `/api/changes` field flow is a data-passthrough →
  end-to-end verified live against a two-map workspace.
