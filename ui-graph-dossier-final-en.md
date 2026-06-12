# UI Transition Graphs for LLM Agent Testing — Research Dossier (Final)

> Consolidated record of the full discussion (final version, 2026-06-12). Covers the thesis (Aalto, Algorithms track), the OSS project, market strategy, and both red-team rounds.

---

## 1. Core idea & the gap

**Original problem:** AI agents interact well via Playwright MCP and understand code logic, and can use code graphs — but they are blind to the UI graph. They fail to cover "one button → multiple behaviors" cases (state-dependent transitions, guards, interceptors).

**Standard term in the literature:** UI Transition Graph (UTG) / Window-State Transition Graph.

**Gap confirmed across multiple search rounds (as of 06/2026):**
- Nearly all UTG research is Android/mobile; static extraction for web SPAs is essentially untouched.
- Existing UTGs are mostly dynamic (crawl/trace-based) → incomplete, no guards.
- No one packages a UI graph as an MCP server providing structured context to agents.
- The specific combination — *build-time extracted guarded UI graph + modal must/may labels + MCP + test graph* — **does not yet exist**, but four fields are converging on it: mobile academia, hybrid static+LLM code review, black-box MCP testing, and Angular's official MCP. The window is measured in quarters, not years.

---

## 2. Value proposition (refined): "LSP for app behavior"

The claim is **not** "agents can't build the map" — agents with repo access grep routes and read components, self-deriving a map on demand. The claim is **amortization and discipline**: compute the map once per commit, deterministically, and share it across every agent, session, team member, and CI run.

Precedent: LSP didn't make jump-to-definition *possible* (grep existed); it made it **instant, shared, and consistent**. Four axes where the precomputed graph wins:

1. **Amortization** — self-mapping is paid per session × per person × per CI run × per context compaction; extraction is paid once per commit. The multiplier is largest in CI/team contexts → consistent with the PR-bot wedge.
2. **Scale (strongest axis)** — beyond ~100 routes the map no longer fits an agent's context window; self-derived maps are partial and forgotten across compactions. The graph lives *outside* the context window, queried piecemeal via MCP. **Advantage grows with app size.**
3. **Amnesia & sharing** — an agent's self-built map dies with the session; the graph is git-committed team memory. Tagline: *"Stop paying your agent to re-learn your app every session."*
4. **Determinism** — two agent sessions derive two slightly different, unauditable maps; the graph has witnesses and hashes. Platforms (CLAUDE.md, agent memory) are building the *undisciplined* version of this; the moat is the word "verified", not the word "map".

**Burden of proof this creates:** the killer chart is the **delta-vs-app-size curve** — (agent+repo self-mapping) vs (agent+graph), measuring time-to-first-correct-action, total tokens, and cross-run variance, on apps from 10 to 300 routes. If the curves separate only above ~100 routes, that is not bad news — it is the numeric definition of the ICP.

---

## 3. Related work (verified)

### Academic
- **LLMDroid** (FSE 2025) — UTG from execution traces + Dijkstra navigation to target pages; UI page clustering.
- **Agent+P** (arXiv 2510.06042) — formal UTG; reduces UI automation to classical planning (PDDL).
- **KG-RAG** (EMNLP 2025) — UTG → knowledge-graph RAG; states UTGs are "underutilized due to poor extraction + inefficient integration".
- **GUI-Xplore** (CVPR 2025) — exploration videos → GUI transition graph as agent context.
- **RLDroid** — static seed UTG + Q-learning refinement; +60% coverage.
- **NaviDroid / Guided Bug Crush** — static STG + dynamic supplementation. **MiniScope** — static UTG for MiniApps with data-flow resolution of dynamic targets. **GoalExplorer, StoryDroid, CoSer** (UTG-based test repair), **UI-CTX** (NDSS 2025).
- **WMA web agent** (arXiv 2410.13232) — learned world models; confirms LLMs lack a mental model of the web (learned-simulation route, not an explicit graph).
- **Crawljax** — classic dynamic SPA crawling into a state-flow graph.
- UI-representation research: UI state accounts for >80% of agent token usage → the economic argument for a compressed graph.

### Tooling / products
- **ngrev** (static Angular reverse engineering — structure graph, NOT transitions), **ng-analyzer**, **Compodoc**, **codelyzer**.
- **MCP testing ecosystem** (all black-box runtime): web-eval-agent, debugg-ai-mcp, qa-use, BrowserMCP, chrome-devtools-mcp (~40k★), semantic-snapshot servers.
- **Official Angular CLI MCP** (experimental): docs, best practices, codegen, modernize — NO behavior graph. The Angular team publicly invites tool proposals.
- **Autofix Bot** (Show HN 12/2025) — hybrid static analysis + LLM agents for code review; the identical thesis in a neighboring domain.
- **YC W26 startup** — tests against backend source code (routes, controllers, API schemas): the white-box wedge entered from the backend; the frontend UI-graph side remains open.
- QA market 2025: record capital — Functionize $41M B, Momentic $15M A (Notion, Xero, Webflow), Thunder Code, TestSprite. Agentic AI rewards "measurable workflow replacement".

### Relationship to code graphs (Sourcegraph/SCIP, Aider repo map, Joern/CodeQL, Graphify/CodeGraph/Probe/RTK)
- **Different spaces**: code graphs live in *code space* (nodes = symbols, edges = calls/imports: "who calls whom"); the UI graph lives in *behavior space* (nodes = screens/states, edges = (event, guard, effect): "what happens when the user acts").
- **The UI graph is built *through* the code graph**: the extractor walks call chains (event binding → handler → navigate), assigning UI semantics to code-graph patterns (knowing `router.navigate` and `canActivate` are special). The code graph is an internal IR of the extractor.
- **The join between the two graphs IS impact analysis**: commit → changed symbols → affected handlers → affected UI edges → flows/tests to rerun. The code-node ↔ ui-edge traceability map is a first-class artifact, and change propagation across two heterogeneous graphs is another countable algorithm.
- **Market lesson**: generic code context is being absorbed by platforms (Aider repo map, Cursor indexing, Claude Code grep) — *the generic layer dies to the platform; the vertical layer survives*. The UI graph is the vertical, domain-specific layer platforms have no incentive to specialize into, and it has what code graphs definitionally lack: a runtime tier (witnesses, confirmed edges, behavioral diffs).
- **Strategy**: integrate, don't compete. Reuse their bones — TS compiler API for Angular/TS; tree-sitter queries as the cheapest path to L1 (routes) adapters across frameworks.

---

## 4. Theoretical foundations (debates settled)

### 4.1. Having source code ≠ sound + complete
- Rice's theorem: non-trivial semantic properties are undecidable. Source gives syntax, not decidable semantics.
- Impossible cases for pure static analysis: data-dependent guards (`user.role === 'admin'`), string-built targets, dynamic dispatch (`actions[mode]()`), code outside the repo (module federation, feature flags, lazy configs from APIs), cross-cutting behavior in interceptors.
- **State ≠ page**: real state = page × form × store × data × timing → any finite graph is an abstraction, losing information by construction.
- Honest claim level: **soundiness** — sound modulo a declared list of dynamic features.

### 4.2. Drawing the graph ≠ answering queries on it
- if/else with literal targets → two may-edges with guard ASTs: the easy, majority case.
- But reachability/feasibility on an EFSM with arbitrary guards = program reachability = undecidable → the **infeasible path problem** in test path generation.
- The Angular gift: **the route table bounds the codomain** — unresolvable navigations over-approximate into may-edges over the finite declared route set.

### 4.3. The test-generation purpose forgives imprecision
- False edge → try, fail, demote (the failure is information). Missing edge → exploration finds it; the graph is a prior, not a cage.
- Theory bites in three operational places: budget economics, the coverage denominator, and the oracle (= model-vs-runtime discrepancy; bug classes: dead navigation, unreachable screens, wrong guards, undocumented behavior).
- **Uncertain regions are the most valuable for testing** → must/may/unknown labels are a test-effort prioritization function, not an apology.

### 4.4. Legibility > decidability when the consumer is an LLM
- A classical analyzer must *evaluate* a guard; an LLM agent only needs to *read* it symbolically. The requirement shifts from decidability to legibility. Worth a dedicated thesis section.

---

## 5. Settled architecture

### 5.1. Three sources, one invariant
```
Tier 1  AST/compiler  → must-edges + node inventory (statically proven)
Tier 2  LLM           → proposals + semantic annotations (QUARANTINED; never writes to the graph)
Tier 3  Runtime agent → observations → confirmed edges
```
**Golden invariant:** *No edge enters the graph without a deterministic witness (static proof or runtime observation).* When an LLM guess is confirmed, the **observation** enters the graph, not the guess.

- The Tier-1 node inventory is the anti-hallucination fence for Tier 2.
- Semantic annotations are safer than proposals: a wrong label degrades planning but cannot mint phantom transitions.
- **Canonical analogy:** the LLM is the heuristic in A* — a bad heuristic only slows the search, never corrupts the result. (AlphaGo pattern: MCTS correctness + NN priors.)

### 5.2. Pure system (hard requirement)
```
G = fold(reduce_fn, static_facts(repo@commit) ++ observation_log)
```
- Event sourcing: the graph is a pure fold over an append-only log. Same log → same graph (Redux-reducer analogy).
- static_facts = f(commit hash, extractor version, ruleset version); content-addressed, Nix/Bazel-style caching.
- Observations are data with provenance (env hash, seed, commit), not computation. Hermetic environments help log reproducibility; graph purity does not depend on them.
- LLM non-determinism cannot touch purity (quarantine). Reproducible proposals: pin model + cache hash(prompt)→response.
- **App non-determinism is signal**: a 50/50 flickering edge is often a race-condition bug; the log records both outcomes with counters.
- Semantic annotations → sidecar file with its own hash; the core graph stays clean.
- Artifact = `hash(commit, extractor_ver, ruleset_ver, obs_log)` → a **lockfile for the app's behavior**; diffs explainable edge by edge.

### 5.3. Formal model
- IR = guarded labeled transition system + **must/may/unknown** modal labels (after Larsen–Thomsen modal transition systems) + per-source confidence.
- Edge = (event, symbolic guard, effect). Node = screen/state.
- Provable lemma: *given a complete route config, the must-graph is sound w.r.t. all declared navigations.*

---

## 6. Tap points: source vs build vs DOM

| Substrate | Knows | Blind to |
|---|---|---|
| Source (via compiler) | The possibility space: branches, readable guards, intent | What actually ships; runtime data |
| Build output | What ships (env resolved, tree-shaken); chunk graph = coarse route map | Minification kills legibility; intent lost |
| Runtime DOM | What actually happens | Only visited states; no guards; "what is", never "what could be" |

**Recommendation:** sit inside the compilation pipeline (ngtsc transformer / builder plugin, like the Angular Language Service). ⚠ **Open risk (red team #2.5):** Angular CLI does not officially support custom ngtsc transformers — historically requires ngx-build-plus or builder patching, breaking across majors. **Verify this week**; fallback = standalone analyzer using the compiler *as a library* (Language-Service-style), which weakens but does not kill the "graph as build artifact" story.
- **The graph is a build artifact**: `ui-graph.json` next to the sourcemap. Standardization framing: apps ship their own behavioral map (like openapi.json / robots.txt). Caveat: standards succeed via vendor backing or overwhelming utility — ship a format and let it earn; don't market a "standard".
- DOM keeps two roles: observation substrate + **registration anchor** (`ng.getComponent(el)` in dev builds → risk #1 nearly solved in dev mode).
- Source-graph vs build-graph diff = free finding class: dead features.

---

## 7. The intent layer (specs / docs / Figma)

**Three layers of truth**; each pairwise mismatch is a distinct bug class:

| Mismatch | Bug class |
|---|---|
| Intent ≠ Code | Spec drift; flow built differently than designed |
| Code ≠ Runtime | Extraction error or environment-dependent bug |
| Intent ≠ Runtime | User-visible defect |
| Code ∖ Intent | Undocumented behavior ("the button's second behavior") |

- **Figma prototype links = a designed transition graph** → extract via Figma API/MCP, diff against the code graph = design-to-implementation conformance checking. Highly demoable.
- Acceptance criteria (LLM-parsed) → expected paths = oracles for business logic.
- Reverse direction: **living docs from the graph** (flow maps, screen catalogs, onboarding) — docs rot is a more universal pain than testing; a candidate viral hook.
- Extra algorithms: Figma frame ↔ route node matching (bipartite/similarity); conformance = simulation checking.
- **Scope warning:** expansion pack — one thin slice in the thesis or Future Work. Grand positioning: *a conformance engine across design–docs–code–runtime; the graph is the contract.*

---

## 8. The test graph (test cases as data, not code)

- MBT separation: **abstract test suite** (the product) vs concrete scripts (adapters). Code is the interface for dumb runners; agents consume data.
- **Test graph = a projection of the UI graph**: paths selected by a coverage objective, merged into a shared-prefix DAG, annotated:

```yaml
test_case:
  path: [edge_refs]
  setup: {api: POST /cart, items: 2}   # reach preconditions via API (OpenAPI)
  inputs: {email: <semantic:email>}
  oracles: [destination = CheckoutPage, effect POST /orders fired]
  priority: uncertainty × churn × criticality
  status: proposed | validated | stale | infeasible
  witness: hash → trace
```

- Lifecycle: the test graph is a **view recomputed every build** (pure); only the **witness store** persists (traces + bindings, keyed by content hash). The diff between two commits' test graphs *is* the retest plan.
- **Explore once, compile forever**: the agent validates a path once (solving infeasible paths empirically); the trace is the "compiled" test — a deterministic replay player re-runs it with zero tokens.
- Executors as adapters: agent / replay player / human (Gherkin export = free manual-QA docs) / optional .spec.ts codegen.
- Two commercially potent by-products: **stable testids stamped at build time** (kills brittle selectors) and **semantic waits from effect labels** + **self-healing with witnesses** (graph diffs make repair inferred, not guessed; "stale test" distinguishable from "new bug").
- ⚠ Red-team caveat: record-playback has died repeatedly in testing history; graph-driven repair only covers changes the graph models (navigation/structure). CSS/timing/data-shape changes break replays silently → the same trust death-spiral as false positives. Needs explicit handling.
- Final stack, all data: UI graph (what the app *can* do) → test graph (what to *verify*) → witnesses (how it was *done* once, replayable).

---

## 9. The algorithmic content (Algorithms track)

1. **Formal model**: guarded LTS + modal must/may + confidence; must-graph soundness lemma.
2. **Static extraction**: interprocedural AST analysis; call graph from event binding → handler → navigate; constant propagation; lightweight TS points-to; complexity analysis.
3. **State abstraction**: partition refinement (Paige–Tarjan / bisimulation); granularity-vs-explosion trade-off.
4. **Multi-source reconciliation**: weighted bipartite matching (Hungarian), graph edit distance (NP-hard → heuristics), conformance = simulation preorder (polynomial). The most novel part. Plus cross-graph change propagation (code graph ↔ UI graph traceability).
5. **Test path generation**: directed rural postman (NP-hard → approximation), greedy set cover (ln n), bounded SMT feasibility; **coverage is submodular → greedy 1−1/e guarantee**.
6. **Navigation on an uncertain graph**: may-edges = the **Canadian Traveller Problem** (PSPACE-hard); promote/demote ≈ active automata learning (Angluin's L*).
7. **Incremental recomputation**: commit diff → subgraph invalidation.
+ **Standalone empirical contribution**: the statically-resolvable-transition distribution for real web apps — a number that does not yet exist.

**Proposed core**: 1, 4, 5, 6 + the empirical study; 2–3 demoted to engineering.

**Committee defense line**: "The LLM is a noisy oracle with a cost, on par with any data source; all guarantees, complexity analyses, and approximation bounds live in the symbolic layer. The thesis is not 'using an LLM' — it is designing the algorithmic structure to safely exploit a noisy oracle."

---

## 10. Evaluation (updated after red team #2)

- **RQ1 — Corpus study**: 8–12 OSS Angular apps. Edge/node precision-recall; must/may/unknown distribution; per-category breakdown. Ground truth: manual annotation (two annotators, inter-rater agreement) + exhaustive crawl (declared under-approximation).
- **RQ2 — Ablation (the heart; baseline FIXED)**: baseline is **agent + repo access** (self-mapping), NOT bare Playwright MCP — the old baseline was a strawman. Conditions: (A) agent+repo, (B) +must-graph, (C) +proposals, (D) full. Tasks: navigation / exploration / bug finding. Metrics: success rate, steps, tokens, coverage per budget, **cross-run variance** (the consistency claim), and the **delta-vs-app-size curve** (10 → 300 routes) — the thesis's and the pitch deck's most valuable chart.
- **RQ3 — Mutation study**: seeded faults on navigation logic (flip guard, delete route, swap target, break handler, remove API-error branch); detection + FP rate vs baselines on equal budgets. ⚠ Circularity caution: seeding only what the model models is self-serving — complement with a small real-bug study from repo issue histories if feasible.
- **RQ4 — Algorithm quality**: greedy vs ILP-optimal on small instances; scalability vs LOC; graph stability across rebuilds (must = 100%); **git-history replay** — do graph diffs over 50 historical commits predict the E2E tests that actually broke in CI?
- Discipline: 5 runs/config, mean ± variance, pinned model, declared token budget, threats-to-validity drafted up front.
- **Public benchmark** ("AngularUTG-Bench": corpus + annotations + mutants) — benchmarks outlive tools and out-cite papers.
- 6–9-month scope: RQ1 + RQ2 mandatory; RQ3 small; RQ4 pick 2 of 4. Cut RQ3 first if squeezed.

---

## 11. Naming

**Thesis (recommended):**
- EN: *Statically Extracted UI Transition Graphs as Grounding for LLM-Based End-to-End Testing of Single-Page Applications* (optional subtitle: *Deterministic Extraction and Uncertainty-Guided Test Generation*)
- VN: *Đồ thị chuyển trạng thái giao diện trích xuất tĩnh làm nền ngữ cảnh cho kiểm thử đầu-cuối bằng tác tử LLM trên ứng dụng web đơn trang*

Alternatives: "Modal UI Transition Graphs: …" (algorithms-forward); "Grounding the Agent: A Neurosymbolic Pipeline…" (architecture-forward); "The UI Graph as a Build Artifact…" (pure-system-forward).

**The OSS tool**: a separate short name, typable after `npx`. The thesis is for Google Scholar; the repo is for human memory.

---

## 12. The final product

**One-line positioning:** your app generates its own behavioral map at build time; tests, docs, agents, and impact analysis are all views over that map. *(Agentic-engineer framing: "Your agents write the code. Give them the map — and give yourself the diff.")*

**Four pieces:**
1. **Build plugin** → `dist/ui-graph.json` next to the sourcemap; optional testid stamping.
2. **CLI**: `map` (interactive viz — the 90-second wow) · `diff` (impact analysis) · `plan` (test-graph.json) · `run` (validate + replay).
3. **MCP server**: get_graph · plan_path · report_observation — plugs into Claude Code/Cursor.
4. **GitHub Action / PR bot**: flows touched, witness replay results, new uncovered edges, suggested tests. *(For the vibe-coder segment: a hosted web product instead — auto-run after every AI edit, findings rendered as copy-paste fix-prompts, an honest coverage meter with explicit unknown zones.)*

**System state = 4 data files**: `ui-graph.json` / `proposals.json` (sidecar) / `test-graph.json` / `witnesses/`. All diffable, hashable, replayable.

**Boundaries:** Thesis = extractor + formal model + plan/diff algorithms + evaluation + benchmark (Angular). OSS = polished thin slice of pieces 1–3, time-to-wow < 2 minutes (Next/React-first for the community). Commercial = piece 4 hosted + dashboards + on-prem; B2B2C engine deals with vibe-coding platforms.

---

## 13. Market segments (the three-segment geometry)

| | Enterprise (Angular) | Vibe coders | **Agentic engineers (BEACHHEAD)** |
|---|---|---|---|
| Who | Banks, insurers, public sector | Lovable/Bolt/v0/Replit users, non-technical | Experienced engineers at startups shipping via agents |
| App size | 100–300+ routes | 10–30 routes | 30–150 routes (sweet spot of the delta curve) |
| Pain | Coverage, audit, governance | **Regression anxiety** ("AI broke my app") | Skipped testing for velocity + **reviewing agent-written code** |
| Product shape | On-prem, model-free tier, audit trails | Hosted safety net; fix-prompts; coverage meter | OSS + MCP + PR bot; advisory mode (never block CI) |
| Buys because | Compliance & scale | Peace of mind | Velocity with a safety net; **behavioral diff = code review for agent PRs** |
| Installer = beneficiary? | ✗ (org chasm) | ✓ | ✓ |
| Channel | Sales, design partners | Platforms (B2B2C), X/YouTube/Discord | HN, X, GitHub — the OSS playbook fits natively |
| Risk | Procurement, LLM bans | Platforms build in-house; low WTP; overpromise trap | Most crowded; strong counterfactual ("ask Claude to write tests") |

**Sequencing:** agentic engineers (beachhead: adopt fast, pay, give feedback, right channels) → vibe-coder platforms (B2B2C scale: same engine packaged as a safety net) → enterprise (thesis + upmarket: on-prem, model-free tier).

**Two-track structure:** thesis = Angular L3 (science needs the thick must-tier); product = Next/React L1–L2 + exploration (the market lives there). Shared core IR/algorithms. Capability levels map to segments: L0–L1+exploration (vibe platforms), L1–L2 (beachhead), L3 (enterprise).

**The sharpest wedge (agentic engineers):** in agentic engineering the scarce resource is *human review bandwidth*. When agents write the code, the reviewer needs exactly one thing: *what actually changed in the app's behavior*. The behavioral diff — "this agent PR touches 2 flows; 1 new edge appeared at Checkout; intended?" — is a **reviewer for agent-written code**, a need growing at the rate of agentic coding itself.

**Founder-market fit:** a Next.js product shipped agentically is precisely the builder's own situation — user #1, design partner #1, demo #1 (dogfood on one's own product).

---

## 14. Model access — BYOA (bring your own agent)

**Spec line:** *Core MUST be model-free; model access is provided by the connecting agent.*
- The core never calls an LLM API. The user's agent (Claude Code on a subscription, Cursor, Copilot…) brings the model via MCP → subscription users fully served; no API key; no billing on your side.
- LLM-free tier (works for everyone, incl. LLM-banning enterprises): extractor, map, diff, PR bot, testids, **all CI replay** (witnesses). = the natural free tier + the data-governance answer.
- Model-needing (through the user's agent, interactive at dev time): proposals + first-run authoring; sidecar + witnesses committed to the repo.
- API keys only for optional headless CI authoring. Ollama fallback for proposals (a bad heuristic is only slow, never wrong).
- Caveats: long explorations eat the user's usage limits (estimate cost up front); never hardcode vendor plan assumptions — MCP neutrality is both correctness and risk shielding.

---

## 15. Red team — both rounds

### Round 1 (operational)
1. **Finding precision** (not edge precision) is the survival metric; real apps are full of non-bug discrepancies → high FP = uninstalled. No mechanism designed yet.
2. **Test data & environments** are the felt pain; a perfect map stalls at the login form.
3. **Codebase long tail** (Nx monorepos, ancient Angular, custom routers) → 80% compatibility engineering. (Mitigated by the compiler-pipeline strategy.)
4. **Angular customer paradox**: enterprise bans code-to-LLM → on-prem needed. (Mitigated by BYOA + model-free tier.)
5. **Bitter lesson**: better models swallow the may-tier. Concentrate value where they can't: guaranteed must-tier, intent conformance, audit trails, token economics.
6. **Non-deterministic graphs break the pitch** → solved by the pure system + LLM quarantine.
7. **Single-founder capacity**: large surface area alongside two theses + a brand. Cut everything off the critical path.
8. **No moat**: the schema is copyable in a quarter; the plausible moat is data (confirmed-graph + triaged-finding corpus) — requires scale.

### Round 2 (premise-level)
1. **The core hypothesis was never smoke-tested, and the old baseline was a strawman.** Real usage = agent with repo AND browser, self-mapping on demand. The honest baseline is agent+repo. **One-day test:** 10 testing tasks on a mid-size app, with vs without a handmade graph; if delta < 30%, stop and rethink.
2. **Persona chasm** (original enterprise framing): the build plugin is installed by the app team, the pain belongs to QA. Tools win when one person can adopt unilaterally. *(Resolved by the segment pivot: beachhead installer = beneficiary.)*
3. **The visualization wow is a one-time toy** (cf. madge/dependency-cruiser: stars ≠ retention). The only weekly trigger is the PR bot — the piece with the highest FP risk. Retention loop still unsolved.
4. **Angular-first vs fame conflict**: the pond is small because the water is draining; enterprise Angular devs don't star repos; React devs bounce off Angular demos. Resolution: thesis = Angular; OSS launch headline = Next.js (file-based routing makes L1 nearly free, and the community lives there).
5. **Concrete unverified technical risk**: Angular CLI does not officially support custom ngtsc transformers. **Verify this week** before any architecture is written. Fallback: compiler-as-a-library analyzer.
6. **Witness replay = record-playback in a new hat** — a genre that has died repeatedly. Graph-driven repair only covers what the graph models; CSS/timing/data-shape breakage is silent.
7. **No demand-side evidence for "graph"**: the community loudly begs for *unflaky tests* and *unbreakable selectors*, not graphs. Sell "stable testids" and "this PR needs exactly 3 retests"; the graph is an implementation detail. Nobody adopts a graph; people adopt their E2E ceasing to flake. *(The vibe-coder segment adds genuine demand-side pull: "AI broke my app" is the loudest complaint in AI coding.)*
8. **Platform risk with named addresses**: the Angular team is openly soliciting MCP tool ideas (propose it and they may build it); Playwright/Microsoft is moving toward planning. For a platform this is a sprint; defense = the disciplined/verified version (witnesses, deterministic tier, honest coverage accounting) vs "the agent grading itself".

---

## 16. Commercial & OSS playbook

- Precedents: browser-use (viral OSS → funding), Playwright MCP. "Fame first, monetize later" is proven in this niche.
- **Time-to-wow**: `npx <tool>` → an interactive graph of *their own app* in 90 seconds; GIF in the README. Useful WITHOUT AI.
- **Ride the MCP wave**: MCP server from day one → awesome-mcp-servers, registries, Claude Code/Cursor demos.
- **Launch**: Show HN + X thread with video + the blog post "Why your AI agent can't see your UI" (its content = this dossier's debates).
- MIT/Apache; open-core preserves the commercial option. Ship the extractor early — speed > completeness. State the support scope (burnout defense).
- Hidden upside: niche fame = job offers from freshly funded QA startups.
- Three things stack: thesis (time + rigor + "backed by an empirical study at Aalto") / OSS (distribution + reputation) / commercial (open option).

---

## 17. Action items (updated)

**Falsification tests first (cheap, this month):**
- [ ] **One-day smoke test** (kills or confirms the premise): agent+repo self-mapping vs handmade graph on a mid-size app; measure tokens, steps, cross-run variance. Decision gate: delta < 30% → rethink.
- [ ] **Verify ngtsc transformer support** in current Angular CLI before writing any extractor architecture.
- [ ] **Demand probe**: a week in Lovable/Cursor Discords counting "AI broke my app" complaints; 10 conversations with devs/QA asking *"what did you last swear at your E2E for?"*; a landing page ("Know instantly if AI broke your app") measuring signups.

**Then:**
- [ ] Prototype the registration module (graph ↔ DOM via dev-mode hooks) in weeks 1–6 — risk #1.
- [ ] Lock thesis scope: RQ1+RQ2 (fixed baseline + delta-vs-size curve) core; Figma slice in or Future Work.
- [ ] 2–3 design partners (agentic-engineer startups; plus dogfooding on one's own Next.js product).
- [ ] Pick the tool name; reserve npm + domain + GitHub org.
- [ ] Monitoring: GitHub topic / HN keyword alerts ("ui graph", "transition graph", "route graph mcp", repos in §3).
- [ ] IR spec v0 + capability levels L0–L3 + first golden fixtures + the adapter contract (extract / register / stamp).
- [ ] Draft "Why your AI agent can't see your UI".
- [ ] At launch: Next.js adapter as the headline + Angular reference; submit to awesome-mcp-servers; Show HN.
- [ ] Consider the Angular-team proposal channel carefully (big-co absorption risk — see red team #2.8).

---

## Appendix — Key sources

**Papers**
- LLMDroid (FSE 2025): dl.acm.org/doi/pdf/10.1145/3715763
- Agent+P: arxiv.org/pdf/2510.06042
- KG-RAG (EMNLP 2025): aclanthology.org/2025.emnlp-main.274.pdf · arxiv.org/pdf/2509.00366
- GUI-Xplore (CVPR 2025): arxiv.org/pdf/2503.17709
- WMA Web Agents with World Models: arxiv.org/abs/2410.13232
- NaviDroid: arxiv.org/pdf/2205.13992 · Guided Bug Crush: arxiv.org/pdf/2201.12085
- MiniScope: arxiv.org/pdf/2401.03218 · StoryDroid: arxiv.org/pdf/1902.00476
- AUITestAgent: arxiv.org/pdf/2407.09018 · GAPS: arxiv.org/html/2511.23213
- UI representation token study: arxiv.org/pdf/2512.13438

**Tools / products**
- ngrev: github.com/mgechev/ngrev · ng-analyzer: github.com/marcinmilewicz/ng-analyzer
- Angular CLI MCP: angular.dev/ai/mcp
- awesome-mcp (testing cluster): github.com/abordage/awesome-mcp
- Autofix Bot (Show HN): news.ycombinator.com/item?id=46237358

**Theoretical concepts**
Modal transition systems (Larsen–Thomsen) · Soundiness manifesto · Infeasible path problem (MBT) · Submodular maximization (Nemhauser 1−1/e) · Canadian Traveller Problem · Active automata learning (Angluin's L*) · Paige–Tarjan partition refinement · Rural postman problem · Event sourcing · LSP as an architecture precedent.
