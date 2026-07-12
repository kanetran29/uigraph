# Proof-gated verification + Tier-2 write path + usable dash — design

Date: 2026-07-12. Approved policy: runner and agent confirmations mint the same
top tier ("witnessed") IF structured evidence validates; provenance recorded.

## Vision (user's words, paraphrased)

Tier 1 (deterministic code→graph) is the bare bone. Tier 2 (LLM proposals)
exists to create as many candidate nodes/edges as possible so every case is
covered. Tier 3 verifies them — and "verify" means the verifier must present
proof. The UI must be easy to use.

## Red-team findings this fixes

1. `report_observation` accepts `outcome:'confirmed'` with zero evidence — a
   hallucinated confirmation launders into the top trust tier (witness is the
   observation's own id; screenshot string never checked).
2. `applyObservations` matches by `(from,to)` pair only, first edge wins,
   skips later observations on the same pair — a witness can attest a
   transition it never observed; a guarded `may` edge silently becomes an
   unconditional `must` with its guard still on it.
3. Observations carry no base binding — "witnessed" edges outlive the code
   they witnessed across re-maps, invisibly.
4. Stale graphs are served silently; negative answers ("no path", "no such
   screen") are indistinguishable from blind spots.
5. Tier 2 has no shipped write path (proposals only enter via a hand-authored
   file through the CLI) and the runner never produces an artifact.
6. `uigraph dash` prints manual dev-server instructions instead of serving.

## P1 — core: honest fold (`runtime.ts`, `staleness.ts`, `coverage.ts`, `trust-tier.ts`)

- `Observation` gains `evidence?: Evidence`, `reportedBy?: 'runner'|'agent'`,
  `base?: string` (base-graph hash at report time).
- `Evidence` is a discriminated union:
  `{ kind:'url-change', startUrl, landedUrl }` |
  `{ kind:'url-assert', url }` |
  `{ kind:'dialog' }` (with the asserted context) |
  `{ kind:'screenshot', path }`.
- Fold (`applyObservations`): match by `(from, to, event)`. Every confirmed
  observation is processed (no first-per-pair skip). Event matches an existing
  edge → upgrade THAT edge; no event match → append a new runtime edge.
- Guard preservation: upgrading a guarded edge keeps `guard` and keeps
  `modality:'may'` (existence proof ≠ unconditionality proof); the edge still
  gains `source:'runtime'`, `confidence:1`, and the witness (tier `witnessed`).
  Unguarded edges upgrade to `must` as before.
- Stale witness: when `o.base` is present and ≠ current base hash, the edge
  still folds (history survives re-map) but carries `witnessStale: true`.
  Coverage counts stale-witnessed separately from runtime-verified;
  `next_to_verify` re-queues stale-witnessed edges.

## P2 — mcp: proof gate + propose tool (`tools/loop.ts`, new `tools/propose.ts`, `read.ts`, `planning.ts`, `server.ts`, kit)

- `report_observation`: `confirmed` REQUIRES `evidence`; `screenshot` evidence
  is fs-checked (file must exist); `url-change` requires
  `startUrl !== landedUrl`. Invalid/missing proof → the tool returns an error
  explaining what proof looks like; nothing is recorded. `refuted` needs no
  evidence (mints nothing). `reportedBy` required; both provenances mint the
  same tier (approved policy). The base hash is stamped server-side.
- New `propose` tool: batch-submit Tier-2 proposals
  (`{proposals: [{kind, category, screen, title, event?, to?, guard?, effect?,
  rationale, evidenced, confidence}]}`), validated (screen/to must resolve or
  be `<modal>`), ids minted server-side, bound to the current base hash,
  status `proposed`, source `proposal` (quarantine enforced). Result reports
  accepted/rejected with reasons.
- Freshness on read: `get_graph`, `plan_path`, `describe_screen` include a
  `freshness` field (fresh|stale|unknown, from the stored fingerprint).
- Honest negatives: `plan_path` no-path and `describe_screen` unknown-screen
  responses include a `caveat` with accounted%/coverage so a blind spot is
  distinguishable from proven absence.
- Kit docs (SKILL/loop guide) updated: propose → verify-with-proof flow.

## P3 — runner: produce the proof (`cli/src/runner.ts`)

- `drivePlan` returns evidence: capture mode → `url-change {startUrl,
  landedUrl}`; assert mode → `url-assert` / `dialog`. Optional screenshot into
  `<workspace>/screenshots/` when the page API allows.
- `runVerify` passes `evidence` + `reportedBy:'runner'` to
  `report_observation`.

## P4 — usability (`apps/dashboard`, `cli`)

- `uigraph dash`: build once (or use prebuilt `apps/dashboard/dist`), serve
  statically alongside the API, print one URL, auto-open the browser.
- Dashboard: freshness banner when the graph is stale; visual distinction
  verified / proposed / stale-witnessed; coverage progress with a
  "next to verify" panel.
- README honest-limitations updated (Tier-3 "only appends a log" is already
  false and becomes proof-gated; Tier-2 reviewer now has a shipped write path).

## Non-goals

- No LLM calls added anywhere (model-free stays).
- No re-map auto-invalidation of observations (stale-witness flag instead).
- No new frameworks; dashboard changes stay within the existing React app.

## Execution

Per phase: `pnpm check` green, then commit to main. Dashboard (P4 app part)
runs as a parallel agent on disjoint files; core→mcp→runner sequentially
(interlocked). Tests updated alongside each behavior change — the fold and the
proof gate get explicit new cases (wrong-event mismatch, guarded upgrade,
stale base, evidence rejection, propose validation).
