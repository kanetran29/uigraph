# Thesis handoff (21 Oct 2026)

Read this first. It is written for a Claude Code session continuing the work.

## Who and what

- Student: Duy Khanh Tran (official name order as in Sisu), student number 103503394, Aalto SCI, CS (Algorithms).
- Supervisor: Prof. Petri Vuorimaa. No advisor. Plan approved 5 Oct.
- Title: Scope Attribution for Static UI Transition Graph Extraction in Single-Page Applications.
- Deadlines: full draft to Petri **2 Nov 2026** (hold strictly). Submission 30 Nov. Study right ends 31 Dec 2026.
- Tool under study: uigraph (this repo). Angular adapter in `packages/adapter-angular`.

## Files in this folder

| file | what |
|---|---|
| `thesis-latex.zip` | LaTeX source + built PDF. 7 chapters, 38 pages. Build: `latexmk -pdf thesis.tex` |
| `harness.zip` | evaluation harness `route-oracle/` (Node 22+, uses `node:sqlite`) with results of the last runs |
| `attribution-v1.patch` | scope attribution v1, `git am` onto commit `c4f8b833` (GitHub main). Not yet applied anywhere you own |
| `lit2.bib`, `lit2-notes.md` | 43 new references, every field verified (Crossref/publisher), with notes on what each paper says |
| `petri-review-2026-10-21.md` | Petri's latest review, by chapter, with our notes |

## Thesis structure (thesis-latex.zip)

`thesis.tex` includes `generated-tables.tex` and `generated-before-after.tex` (generated, never edit by hand) and
ch1-introduction, ch2-background, ch3-analysis, ch4-evaluation, ch5-results, ch6-discussion, ch7-conclusion,
`references.bib` (38 entries, all verified). `plan.tex/plan.pdf` is the approved plan (do not change).
Preamble is a report-class preview; swap to the official `aaltothesis.cls` before submission.

RQs:
1. How much navigation can static analysis recover as deterministic (must) transitions? (conversion ratio per construct)
2. Where does it fail and why? (defect classes, each confirmed by 2 methods; loss breakdown per construct)
3. How does scope attribution affect coverage and precision? (before/after on identical inputs; must-tier precision must not fall)
4. Is the graph sensitive enough to source changes for change impact analysis? (mutation testing) -- not re-run yet

## Current results (harness 1.2.0; baseline = c4f8b833, after = attribution commit 4505fd2)

| app | conversion before | after | must-tier clean before | after | attribution losses | recovered |
|---|---|---|---|---|---|---|
| realworld | 15.0% | 37.5% | 6/7 | 9/10 | 22 | 21 |
| alfresco | 2.9% | 2.9% | 1/1 | 1/1 | 18 | 0 |
| ghostfolio | 0% | 0% | - | - | 81 | 0 |
| k8s dashboard | 0% | 4.2% | - | 3/3 | 56 | 2 |
| bitwarden | 12.1% | 15.9% | 10/10 | 13/13 | 56 | 6 |
| mifos | 5.4% | 10.0% | 69/69 | 129/129 | 235 | 52 |

Remaining 387 attribution losses: owner component not reached 156 (~63 dialogs, ~73 inside unreached components, ~20
selector unused), target screen has no node 132, services/guards (not implemented) 48, dynamic target 34, unexplained 17.
Key message: attribution works where node extraction is complete; node defects (constant paths, lazy boundaries,
unlinked components) cap it on larger apps.

## Harness (harness.zip -> route-oracle/)

- `run-all.mjs [--skip-clone] [--allow-branch] [--no-mutation] [--attribution] --out <dir>`: clones extractor + corpus at
  pinned SHAs from `corpus.json`, maps, runs Tests B (witness-check), C (index.mjs route parser), D (e2e-oracle),
  F (mutate.mjs), L (loss-breakdown). Writes results.json + tables.md. It no longer BUILDS the CLI: it runs it from
  source through tsx, which `packages/cli/package.json` already declares. Building it needed each package's `exports`
  rewritten from ./src to ./dist first, which edited the checkout under measurement and was the one step of this
  harness that could not be committed. That patch and the rule about it are both gone.
  The harness directory is outside the workspace, so it needs `npm ci` in `route-oracle/` before the first run.
- `to-latex.mjs results.json > generated-tables.tex`; `compare.mjs before after --tex generated-before-after.tex`
  (refuses two runs of different extractor commits, and refuses unless recovered + remaining equals the attribution
  class); `diagnose-attribution.mjs` (resolves the adapter from source beside itself; run it under tsx).
- Container paths used before: work dir /tmp/eval. They no longer exist; re-run from scratch.

## Six protocol corrections already in Section 4.3 (keep them)

E2E matcher tightened + negative tests excluded; witness check tier-aware (over-approx fan-outs); coverage-confounded
mutants excluded; construct count by parser not substring; route parser fixed (wrappers, NgModule routing imports, no
double walk; mifos coverage 100% -> 58/610); conversion per construct, not edges/constructs.

## TODO for the 2 Nov draft (from Petri's review), suggested order

1. **Ch3 formal fixes** (small, do first):
   - Define S, Σ, G, M (M = modalities {must, may, unknown}, not targets) and S = { screen(r) | r ∈ Routes }.
   - ⊥ = empty scope (site fires from no screen, e.g. unreached code).
   - Lattice: the implementation keeps explicit screen sets (join = union over P(S)), so height is |S|. Recommended:
     define the domain as P(S) with union; screen(r), subtree(r), ⊤ are named elements used for anchoring
     (representation), and state the bound as O(|S| · |E_callgraph|) for a worklist fixpoint. The implemented
     nesting/outlet part is plain reachability: O(|routes| · (|components| + |nesting edges|)).
   - Anchored-edges formula: ancestor-or-self (reflexive).
   - Start of 3.2: one paragraph saying which relations are implemented (nesting, outlets, shell, anchors) and which are
     model only (DI call graph, dispatch, UrlTree guards).
2. **RQ4**: fix mutate.mjs (seeded sampling, fixed quota per operator, CHANGE_NAV_TARGET retargets to a declared route,
   exclude coverage-confounded mutants), run on the attributed graph, write 5.4 with n per operator. If it fails, move RQ4
   to future work and say so.
3. **Ch5**: one paragraph making the node-extraction bottleneck the explicit headline (ghostfolio constants are
   `publicRoutes.*` / `internalRoutes.*`; mifos lazy boundaries + unlinked components).
4. **Ch6**: write 6.1, 6.2, 6.3, 6.5; add the "qualitative analysis" note to 6.4; utility for change impact analysis and
   zero-execution CI checks. Include corpus limits: tool-driven selection bias (Spartacus), size vs e2e density, and
   future selection criteria (GitHub search pipeline, industrial case study, minimum UI-test density). For NgModule vs
   standalone, measure it per app before claiming anything.
5. **Ch7**: conclusion, 1-2 pages, one sentence per RQ, then contributions.
6. **Ch2 expansion** to ~15 pages: reorder 2.6 before 2.5; new sections on AST/TypeScript static analysis, mutation
   testing, DI/IoC (Jasmine ASE 2022 is the closest analogue), reactive programming boundaries; LLM agents in 1.1/6.5.
   Only cite entries from lit2.bib (all verified); copy them into references.bib as used.
7. Style pass (see rules), rebuild, then email Petri with the PDF.

## Rules that have held so far

- Writing: simple English, few dashes, concise; no "First/Second/Third" scaffolds, no aphoristic closers, no bold claim
  lead-ins, no "It should be noted". Results in Ch5, interpretation in Ch6.
- Never cite anything not verified field by field. Never invent numbers; every number comes from results.json.
- Freeze before fix: measure the tagged version, fix on a branch, compare on identical inputs.
- Anything that looks unusually good or bad is checked for measurement error first.
- Do not push or tag without the student's go-ahead. Suggested tags: eval-1 = c4f8b833, eval-2 = attribution commit.
- Aalto asks theses to state how AI tools were used; add a short statement (preface or methods).

## Open admin items

- Email study coordinator about study-right timing (overdue).
- Get 2026-27 DPC dates from MyCourses.
- Download aaltothesis.cls / aaltologo.sty and switch the preamble.
