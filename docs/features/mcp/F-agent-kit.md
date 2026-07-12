# Shippable LLM agent kit (skills + rules + guides) bundled with uigraph

- **Slug:** F-agent-kit
- **Status:** designed

## Purpose

A consumer LLM agent (Claude Code / any MCP client) connecting to a uigraph workspace today has to re-derive the whole protocol every session: which of the 14 MCP tools to call in what order, the golden invariant, the modal/source vocabulary, the Tier-3 verify + --storage-state auth flow, and — most importantly — the proposal-reconciliation loop from Design A (confirm/withdraw/archive a proposal so Proposal.status finally transitions). Nothing in the repo carries that knowledge: verified there is no kit/, SKILL.md, or playbook anywhere (only ~/.claude/skills, which is the author's personal global skills, not shipped). The gap is that the protocol lives only in code comments + the dossier, so every agent improvises and risks violating the golden invariant (treating a proposal as a fact, inventing an edge). This feature packs the skills, rules, and guides into a single high-signal kit shipped in the repo and discoverable by the agent over MCP + a CLI, so the agent loads the protocol once and drives uigraph correctly — especially the reconciliation loop — without re-deriving it. It is documentation-as-payload: pure markdown + a manifest, zero new runtime behavior, soundness preserved by construction (the kit only describes the existing model-free tools; it cannot promote anything).

## Design

PRIMARY SHIPPING MECHANISM (recommend ONE): a plain `kit/` directory at repo root, authored as markdown, that is (a) the single source of truth, (b) bundled into the published `@uigraph/cli` package files, and (c) surfaced two ways so the agent never has to know a path: an MCP resource + a CLI command. Rationale for "plain dir bundled in the CLI, surfaced over MCP+CLI" over the alternatives: a separate `@uigraph/agent-kit` npm package is YAGNI (nobody imports markdown as a dependency, and it adds a publish/version axis); a standalone Claude plugin/skill bundle locks the kit to one client (Claude Code) and breaks the BYOA / any-MCP-client promise. A plain dir read at runtime works for every MCP client, ships with the tool the agent is already talking to, and is trivially testable. (Optional thin Claude convenience: the top file is ALSO valid Claude skill format — name+description frontmatter — so a Claude user can symlink/copy `kit/SKILL.md` into `.claude/skills/uigraph/`, but that is a copy, not the source of truth.)

DIRECTORY LAYOUT (`/Users/kanetran29/personal/uigraph/kit/`):
  kit/
    SKILL.md                  # entry skill: frontmatter (name: uigraph, description: when to load) + a 1-screen orientation that links the rest
    manifest.json             # machine-readable index: { version, files:[{path, title, kind:'rule'|'guide'|'loop'|'skill'}], tools:[...14 names...] }
    rules/
      00-golden-invariant.md  # no proven edge without a deterministic static/runtime witness
      01-modality.md          # must / may / unknown — what each means and who may emit it
      02-provenance.md        # source: static | manual | runtime | proposal — the quarantine
      03-proposal-is-a-lead.md# a proposal is a LEAD not a fact; never invent an edge; never trust unconfirmed
    guides/
      00-tools.md             # the MCP tool reference/playbook (GENERATED — see sync section): every tool, when to call it, arg/return shape
      01-verify-flow.md       # Tier-3: next_to_verify -> drive app -> report_observation; the `uigraph verify --storage-state` auth flow
      02-reading-state.md     # how to read get_coverage + next_to_verify + get_proposal_graph to decide what to do next
    loop/
      reconciliation-loop.md  # the Design A step-by-step loop written FOR an LLM: termination + withdraw-on-hallucination rules

DISCOVERY / LOADING (two surfaces, same bytes):
1) MCP resource. The server already declares only `{ capabilities: { tools: {} } }` (server.ts:250). Add `resources: {}` and register two handlers (ListResourcesRequestSchema, ReadResourceRequestSchema) on the SAME low-level Server in createServer(). Expose a virtual resource per kit file under a `uigraph-kit://` scheme plus one aggregate `uigraph-kit://all` that concatenates SKILL.md + every rule/guide/loop in manifest order (so a single read bootstraps the agent). A new pure module `packages/mcp/src/kit.ts` does the work: `kitDir()` resolves the bundled `kit/` (relative to the package, via import.meta.url), `listKit(): KitFile[]` reads manifest.json, `readKitFile(path): string`, `readKitAll(): string`. server.ts maps the resource list/read onto these — kept thin and testable exactly like the tool dispatch.
2) CLI. Add `uigraph kit <subcommand>` in cli.ts wiring + bodies in commands.ts:
   - `uigraph kit print` — print `readKitAll()` to stdout (for piping into an agent prompt / CI).
   - `uigraph kit install [--dir <target>]` — copy `kit/` into a target (default `./.uigraph/kit/`, or `--claude` to drop SKILL.md into `.claude/skills/uigraph/SKILL.md`). This is the `init-kit` requested, named `kit install` to sit under one `kit` command.
   Bodies: `runKitPrint(): string` and `runKitInstall(opts): { written: string[] }` in commands.ts, delegating to a shared `kit.ts` in core/node OR re-exported from @uigraph/mcp (the CLI already imports loadMergedGraph from @uigraph/mcp, so re-export `listKit/readKitAll/kitDir` from @uigraph/mcp and reuse — DRY, one resolver).

CONTENT OUTLINE (headings + 1-line intent each; enough to be mechanical):

SKILL.md — frontmatter: `name: uigraph`; `description: Use when driving a uigraph workspace over MCP — building/auditing the UI transition graph, reconciling LLM proposals, or running Tier-3 runtime verification. Load before calling any uigraph_* tool.` Body sections: ## What uigraph is (one para: self-mapping behavioral graph, model-free core, BYOA). ## The one law you must not break (link rules/00). ## Vocabulary in 6 lines (modality + provenance, link rules/01-02). ## The tools at a glance (link guides/00, list the 14 names grouped: read / plan / verify / edit). ## The job you are usually here to do (link loop/reconciliation-loop.md). ## Where to read more (manifest map). Keep to ~1 screen.

rules/00-golden-invariant.md — # Golden invariant. Intent: state the non-negotiable — no edge in the base/proven graph without a deterministic static OR runtime witness; an LLM never writes a proven edge; the observation, not the guess, enters the graph.
rules/01-modality.md — # Modality: must / may / unknown. Intent: `must` = always fires (only static-proven or runtime-confirmed may claim it); `may` = conditional/guarded; `unknown` = dynamic target undecidable statically — the verify frontier. An agent edit is at most `may` (update_graph downgrades must→may).
rules/02-provenance.md — # Provenance: static | manual | runtime | proposal. Intent: who asserted each edge and how much to trust it; proposals are QUARANTINED in a separate sidecar/graph and never enter the proven IR; manual edits live only in the overlay.
rules/03-proposal-is-a-lead.md — # A proposal is a lead, not a fact. Intent: the four hard prohibitions for the agent — (1) never call a proposal proven, (2) never invent an edge that no tool returned, (3) never set status to confirmed yourself without a runtime witness, (4) plan over proposals only as hypotheses to verify.
guides/00-tools.md — # uigraph MCP tools. Intent: the full playbook, one subsection per tool (name, when to call, args, returns, gotchas), grouped Read (get_graph, get_proposals, get_grounding, get_proposal_graph, describe_screen, get_coverage, next_to_verify) / Plan (plan_path, gen_spec, list_scenarios, set_scenario) / Mutate (update_graph, report_observation) / Compare (diff). GENERATED from the server (see sync).
guides/01-verify-flow.md — # Tier-3 runtime verification. Intent: the confirm path — call next_to_verify to get the ranked worklist, drive the running app (Playwright) to attempt each target, then report_observation { from,to,event,outcome,proposalId,screenshot }; confirmed folds to a runtime must-edge on next get_graph, refuted produces nothing. Documents `uigraph verify --app-url ... --storage-state auth.json --limit N` and how to capture storageState for an authenticated session.
guides/02-reading-state.md — # Deciding what to do next. Intent: read get_coverage (ratio, unverified[]) + next_to_verify (priority unknown>may>proposal) + get_proposal_graph to pick the next action; how to recognize "done" (coverage frontier empty).
loop/reconciliation-loop.md — # The proposal reconciliation loop. Intent: the Design A loop for an LLM, as numbered steps: (0) get_proposal_graph + next_to_verify to list open proposals; (1) for each, plan a runtime attempt; (2) drive the app; (3) report_observation with the proposalId — confirmed => proposal becomes confirmed+witnessed runtime edge (by Design A's status transition), refuted => the WITHDRAW path: mark/archive the proposal as rejected, NEVER leave a phantom must, NEVER delete the proven graph; (4) loop to next target. TERMINATION: stop when next_to_verify returns empty OR a fixed max-attempts budget is hit OR all remaining proposals are refuted. WITHDRAW-ON-HALLUCINATION: a proposal that references a control/screen that get_grounding/get_graph does not contain, or that is refuted at runtime, is archived (status rejected) and removed from the active worklist — it must never influence plan_path or coverage as if proven. Includes a worked example over the sample app.

This feature ships NO change to tool behavior or the graph; only: kit/ markdown + manifest, kit.ts resolver, two MCP resource handlers, one `uigraph kit` CLI command, and a sync test. It depends on Design A only for the WORDS in the loop file (it documents the status-transition + withdraw behavior); the kit can ship its loop guide even before Design A lands, marking the status-transition step as "via report_observation (Design A)".

## Data shapes

Reuse all core types as-is (Proposal, ProposalStatus, Observation, VerifyTarget, CoverageReport, ProposalGraph) — the kit only references them in prose. New types, all in `packages/mcp/src/kit.ts`:
  - `KitFileKind = 'skill' | 'rule' | 'guide' | 'loop'`
  - `KitFile { path: string; title: string; kind: KitFileKind }`  (one manifest entry)
  - `KitManifest { version: 0; tools: string[]; files: KitFile[] }`  (matches kit/manifest.json)
CLI command result (commands.ts): `KitInstallResult { written: string[]; target: string }`.
No DB/IR/sidecar schema changes. No change to GraphEdge/Overlay/Proposals. manifest.json `tools` is a plain string[] of the 14 MCP tool names — the assertion target for the sync test.

## Soundness

The golden invariant is preserved by construction because this feature adds ZERO executable graph logic: the kit is inert markdown plus a file-reader and an MCP resource surface. It cannot promote a proposal, write a base edge, or set a status — those paths are untouched (proposals.ts, runtime.ts, store.ts, the tool dispatch are not modified). Nothing is ever auto-promoted: the kit's loop file explicitly instructs the agent that the ONLY promotion path is a runtime-confirmed report_observation folded by applyObservations into a `runtime`/`must` witnessed edge (the existing Tier-3 mechanism); the agent is told it may never itself mark a proposal confirmed or call an unconfirmed proposal proven. A hallucinated proposal is withdrawn without corrupting the proven graph: the loop's WITHDRAW rule routes a refuted or ungrounded proposal to archive (status rejected, removed from the worklist) — and because proposals already live in a SEPARATE quarantined sidecar/proposal-graph that never enters the proven IR, withdrawing one mutates only the quarantine, never a GraphEdge; the proven graph is defined solely by static witnesses + the append-only observation fold and is unaffected. The kit can NEVER assert a phantom `must`: rules/00-03 + the loop spell out that a `must` edge requires a static or runtime witness and that an agent assertion is at most `may` (mirroring update_graph's asManualEdge must→may downgrade). The sync test guarantees the kit can never document a tool that does not exist (so the agent can't be told to call a non-existent/edge-minting tool).

## Test strategy

TDD, tests first, in `packages/mcp/src/kit.test.ts` (vitest, mirroring tools.test.ts style — real files, no transport):
RED first:
  1. SYNC / single-source-of-truth (the load-bearing test): import the server's `TOOLS` array and `manifest.json`; assert `manifest.tools` sorted === `TOOLS.map(t=>t.name)` sorted (kit lists EXACTLY the tools the server exposes — fails if a tool is added/removed without updating the manifest). Also assert every tool name appears as a heading/anchor token in guides/00-tools.md so the playbook can't silently drift.
  2. manifest integrity: every `files[].path` in manifest.json exists on disk under kit/; SKILL.md has valid frontmatter (name + description present, non-empty); kinds are within the union.
  3. listKit() returns one KitFile per manifest entry; readKitFile(p) returns non-empty for each; readKitAll() contains the golden-invariant heading AND the reconciliation-loop heading (proves the bootstrap concatenation includes rules + loop).
  4. MCP resource surface: build the server via createServer(dir), drive ListResources -> includes `uigraph-kit://all` and one uri per file; ReadResource('uigraph-kit://all') returns text containing 'Golden invariant'. (Use the same in-memory/no-transport pattern the existing server tests use.)
  5. CLI: runKitPrint() returns the same bytes as readKitAll(); runKitInstall({dir:tmp}) writes every manifest file under the target and returns their paths (assert files exist on disk).
RED-TEAM tests (encode the soundness laws as executable assertions on the prose, so a future edit that weakens the kit fails CI):
  6. content guard: rules/03-proposal-is-a-lead.md MUST contain the phrases asserting "never" + "invent"/"proven" (regex), and loop/reconciliation-loop.md MUST contain a WITHDRAW/archive section AND a termination section (regex for 'terminat' and 'withdraw'/'archive' and 'reject'). This is the "never a phantom must / hallucinated proposal removed / loop terminates" check at the doc level.
  7. negative: assert NO kit file instructs setting Proposal.status='confirmed' directly or writing a `must` edge by hand (grep the kit for a forbidden instruction pattern and assert absent) — guards against the kit ever teaching a soundness violation.
GREEN: author kit/ files + kit.ts + wiring until all pass; then `pnpm check` (typecheck + tests + lint) per the repo self-heal gate, max 3 iterations.

## Files

- `kit/SKILL.md`
- `kit/manifest.json`
- `kit/rules/00-golden-invariant.md`
- `kit/rules/01-modality.md`
- `kit/rules/02-provenance.md`
- `kit/rules/03-proposal-is-a-lead.md`
- `kit/guides/00-tools.md`
- `kit/guides/01-verify-flow.md`
- `kit/guides/02-reading-state.md`
- `kit/loop/reconciliation-loop.md`
- `packages/mcp/src/kit.ts`
- `packages/mcp/src/kit.test.ts`
- `packages/mcp/src/server.ts`
- `packages/mcp/src/index.ts`
- `packages/mcp/package.json`
- `packages/cli/src/cli.ts`
- `packages/cli/src/commands.ts`
- `packages/cli/src/cli.test.ts`
- `README.md`

## Dependencies

- No new npm dependencies — markdown + node:fs + the already-present @modelcontextprotocol/sdk (add ListResourcesRequestSchema / ReadResourceRequestSchema imports from @modelcontextprotocol/sdk/types.js, already a catalog dep)
- Reuses @uigraph/mcp's existing low-level Server (server.ts) — add resources capability; no SDK version bump
- CLI reuses @uigraph/mcp re-exports (kit.ts) — no new workspace dep beyond the existing @uigraph/mcp dependency in cli/package.json
- Soft coupling to Design A (F-proposal-loop) for the WORDS of the status-transition step in loop/reconciliation-loop.md; the kit ships independently and the loop file references report_observation's proposalId as the promotion trigger
- Build/packaging: add "kit" to the published files allowlist of @uigraph/cli (and @uigraph/mcp if it resolves kit/ from its own package) so the dir ships in the npm tarball; resolve kit/ via import.meta.url, not cwd

## Risks

["Path resolution at runtime: kit/ lives at repo root but is read from @uigraph/mcp; if resolved via import.meta.url it must survive both monorepo (workspace) and published-tarball layouts. Mitigation: a single kitDir() helper that checks a couple of known-relative locations and throws a clear error; cover with a test that kitDir() resolves an existing dir.", "Kit/code drift is the central risk the sync test exists to kill — but it only covers tool NAMES, not arg/return shapes. guides/00-tools.md prose can still describe a stale signature. Mitigation (KISS, not now): keep arg shapes terse and link to the tool's inputSchema; a future enhancement could generate the arg tables from TOOLS[].inputSchema. Out of scope to keep the kit lightweight.", "Over-generation temptation: generating guides/00-tools.md fully from inputSchema adds a build step. KISS/YAGNI: hand-author the playbook, assert only name-completeness in the test now; defer codegen until drift actually bites.", "Claude-skill copy can rot vs the source kit/SKILL.md if a user copies it once; documented as a copy, not a sync target — acceptable.", "Resources capability is a new MCP surface; some older clients ignore resources — that's why the CLI `kit print` path exists as a transport-independent fallback so no agent is blocked.", "Bundling: forgetting the npm files allowlist would ship a CLI that 404s on kit at runtime; the install/print tests run against the repo copy and would NOT catch a missing-from-tarball bug — add a packaging note + (optional) a postpack smoke check."]
