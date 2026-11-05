# Thesis handoff (5 Nov 2026, late)

Read this first. It is written for a Claude Code session continuing the work. Sections are dated and the
newest come first; the section "Current state, 5 Nov 2026" was checked against the repository on 5 Nov and
supersedes every older section where they disagree.

## Who and what

- Student: Duy Khanh Tran (official name order as in Sisu), student number 103503394, Aalto SCI, CS (Algorithms).
- Supervisor: Prof. Petri Vuorimaa. No advisor. Plan approved 5 Oct.
- Title: Scope Attribution for Static UI Transition Graph Extraction in Single-Page Applications.
- Dates on record: full draft to Petri 2 Nov 2026, submission 30 Nov, study right ends 31 Dec 2026.
- Tool under study: uigraph (this repo). Angular adapter in `packages/adapter-angular`.

## The student's standing instructions (in force)

- Do the work to completion; do not give advice or plan around dates. The student handles deadlines and email.
- Do not push or tag without the student's explicit go-ahead.
- Never cite anything not verified field by field. Never invent a number: every figure in the thesis comes from a
  generated macro file, never typed by hand.
- Run an Opus red-team panel on finished work before calling it done; verify the panel's own claims before acting.
- Before a striking headline, check it adversarially. Verify the referent, not the nearest proxy.

## Later on 5 Nov 2026 (supersedes the section below where they disagree)

- **Framing decisions by the student:** uigraph was built within the thesis (coded before the text, in scope); it is
  the first contribution, never "an existing tool" or "the instrument this work began with". The body presents only
  the final version (c42f220); development versions and corrections live only in Appendix A (`app:repairs`,
  `tab:repairs`, which now also holds the version list). Comparing uigraph's own versions is not a result.
- **Before/after = the world without the thesis vs with uigraph:** ch5 `sec:res-earlier`, Table `tab:earlier`
  (Oshima-Kishi stated restrictions admit 0 of 6, `earlier-work.mjs` + test; their mechanisms reimplemented in uigraph
  as rooted/outlet vs full) and Table `tab:world` (static extraction 0/6 vs 6/6; a browser run without sign-in
  renders 30 of 806 screens; dead-link candidates from the source; realworld suite pairs vs graph pairs; mutation).
- **Held-out check (out-of-sample, preregistered):** `heldout/PREREGISTRATION.txt` committed before any clone
  (`f2e60e7`, addenda `e0b4d4f`, `6b0d723`); PeerTube (client/) and angular-spotify picked by rule from a GitHub
  star-ordered search; `heldout/heldout.sh` from a clean worktree (`~/personal/uigraph-work/heldout-wt`, packages =
  c42f220), apps in `~/personal/uigraph-work/heldout/`; `heldout-to-latex.mjs` (+ test) -> `generated-heldout.tex`.
  Result: both complete, but 1 of 45 declared screens on PeerTube (lazy route files loaded by default export,
  `loadChildren: () => import('./+admin/routes')`) and no route at all on angular-spotify (router provided inside an
  Nx library module). Reported in ch5 `sec:res-heldout` (Table `tab:heldout`), abstract, ch1, ch6, ch7. Not repaired,
  by the preregistration. These two forms are the first thing to extend after submission.
- **Held-out round two (student asked for more apps, 5 Nov):** the first round stays reported; dropping it would hide a
  preregistered result. Addendum C (`b2f76bc`, committed before any screening) walks the same search further and
  takes the next four by S1-S5, with no criterion on route declarations; Addendum D (`ea7a579`, before mapping) records
  the walk of positions 73-150 (the search ends at 150) and the two that qualified: ElectronMail
  (`src/web/browser-window`) and docs.nestjs.com (`.`). `heldout.sh` takes an apps file and results dir;
  `heldout-to-latex.mjs` gains `MustConverted` and names its dir in the header (test first) ->
  `generated-heldout2.tex`. Result: docs.nestjs.com 163/163 screens, 0 blind spots, 161 must edges all witnessed (all
  from one `routerLink="/support"` in the page frame); ElectronMail 0/9: every route on a named outlet, which by design
  gets no primary node; the parser's 9 come from the settings module read at the root because its 3 async-body lazy
  loads are unresolved. Predictions: P5, P8 held; P6 first part held (on the parser's artefact), second not (named
  outlets are in the corpus); P7 did not hold (see the full review below). Table `tab:heldout` now has 4 columns; abstract, ch1, ch4 provenance, ch5 `tab:world` caption, ch6,
  ch7 updated. Harness scripts unchanged between rounds (checked). A third round would need its own addendum, e.g. a
  lower star threshold, written before screening.
- **Panel on round two (2 Sonnet lenses, claims checked by hand):** no blockers. Fixed in prose: commit-order caveat,
  round-1 walk extension (60 -> 72) and search end at 150, ElectronMail opened in round 1, docs site's only guard is
  an external redirect, "carries over" narrowed to the route reader, ElectronMail's 9 are a parser artefact (not
  primary addresses), P5/P8 over two (P7 later rescored, see below).
  S1 "sample" exclusion was stricter than the corpus (which has RealWorld): Addendum E (`772970e`, before cloning)
  measures #147 stefanoslig/angular-ngrx-nx-realworld-example-app (apps/conduit) as a labelled sensitivity case
  (#82 fails S2 anyway: no `children`). Result: 9/9 screens, attribution 8 of 8, but its 8 must edges all fail the
  witness check: one `routerLink="/"`, app redirects `''` -> `home`, extractor follows redirects
  (`redirectAddress`), `witness-check.mjs` applies none. A gap in the check, not repaired (preregistration); reported
  as failures. Fifth column in `tab:heldout`; `generated-heldout-sens.tex`.
- **May-reason census (done, committed `6df6c62`, thesis `c32cf06`):** behaviour-neutral switch
  `UIGRAPH_MAY_REASONS=1` in the adapter; `route-oracle/may-reasons.mjs`; equivalence on all six apps
  (`results-may-reasons/equivalence.json`, re-checked by `remeasure.sh`). Two Opus reviews; all blockers fixed. Result
  in ch5 Table `tab:mayreasons`, ch7, abstract: 1550 of 1575 may-only constructs sit behind an application decision the
  extractor reads (guard/resolver 1440), 25 are held by the extractor's uncertainty alone; mifos holds 1210. Open
  minors from the second review (no census number changes): N3 the shared-reason anchored path omits `same screen`
  (alternative definition would give TemplateSole 27, MayAppSemantics 626); N4 `flag && go()` vs `a(); go()` labelled
  differently by path; N5 template-literal branches never record `resolver` (GuardAny low by at most 10); N6 two
  template labels could hide extractor causes (none in the corpus). Run the remeasure loops with bash: zsh does not
  word-split `$APPS` (it silently counted only realworld once on 5 Nov).
- **Sweep re-recorded at `d05227c`** (c42f220 + the switch): 173/173 killed after re-expressing mutants 46, 59, 161
  for the refactored source (`09b5938`). The extractor commit for the census and sweep is d05227c; every other final
  figure is c42f220 (packages identical except the switch).
- **Ablation idea (student, later):** per-feature ablation of the final version's extraction (lazy boundaries,
  constant paths, ...) with measurement flags, like `UIGRAPH_IGNORE_GUARDS`; attribution levels and guard-only exist.
- **Full ARS review (`academic-paper-reviewer`, 5 seats Sonnet blind Phase 1 + Phase 2, Opus synthesizer) + an Opus
  gate, both on `593c26e`:** decision major revision (F3: D1, D2, D3, D6 at warn; no block, no DA critical). All
  surviving items applied after checking them against the data: construct counts are app-directory only (angular-spotify
  0 in the app, all in libs; RealWorld's 8 are the navbar); PeerTube's cause is an inline `export default [...]` (the
  corpus's `export default routes;` is read), `\HeldoutLazyBlindSpotsPeertube`=17 (new macro, test first); spotify's
  cause stated as untested (`provideRouter(webShellRoutes)`, `Route[]`, async loaders); P3 vacuous, P2/P4 PeerTube
  only; P7 did not hold (docs must conversion 20 % > corpus max 7.7 %, 161 > 150 edges, one layout link); sensitivity
  predictions not blind; attribution untested out of sample (0 recovered on all four); witness check is literal (ch4
  limits cell); stale ch4:94 "no held-out application" fixed; abstract, ch1, ch6, ch7, ch5 Summary, tab:world caption
  aligned; table gains the Oshima-Kishi row from macros. Review note `heldout/REVIEW-NOTE-2026-11-05.txt` (S2-S4 of the
  unlisted example/template exclusions; clone-time tie; harness freeze). Rejected by the synthesizer with reasons:
  rescoring P6 or blanking ElectronMail's cell, a counterfactual strict-S1 table. **For the student:** ch5 now says
  the held-out causes "were read ... by the AI assistant and re-read by AI reviewers" (REV-19); confirm or adjust with
  the AI-use statement (Q3).
- **Held-out removed from the thesis (student's decision, 5 Nov, "xoá hẳn vì dài quá"):** I advised shrinking it to
  a paragraph in ch6 plus an appendix instead (deleting a preregistered study after a bad result can read as
  concealment; the repo keeps it). The student chose full removal. Done: ch5 section and `tab:heldout` gone, the three
  `generated-heldout*.tex` removed, abstract/ch1/ch4/ch5 Summary/`tab:world` caption/ch6/ch7 now say only that every
  figure is in-sample and not an estimate for other applications (no claim that generalisation is untested). The
  witness-check limits cell keeps the literal-target caveat (true in general). `heldout/` stays unchanged, with
  Addendum F recording the decision. Build 152 pages, 0 overfull, 0 undefined, abstract on one page.
- **Build after the full review:** 159 pages, 0 errors, 0 undefined, 0 overfull; abstract on one page; one "float too
  large" warning from ch3-analysis.tex line 50 (file untouched in round two). Nothing pushed, nothing tagged.

## Current state, 5 Nov 2026

- **What happened on 4-5 Nov.** The supervisor's email of 4 Nov (thesis far too long, repetitive, long sentences;
  one-page abstract; precise AI-use statement; list of abbreviations; Section 1.2 without results; Fig 1.1 lacks
  RQ5?; Fig 5.1, Table 5.1 header, Table 5.3 layout, Table 5.16; Section 5.5.3 title; three-of-four relations at the
  start of 3.2; a table of all ratios in 4.2; presentation must precede submission, 23.11 vs 31.12 deadline) and the
  4 Nov review were worked in the order the student approved: harness/macros first, then the cut, then the review's
  prose fixes on what survived, then a verified panel.
- **Commits on `main` (not pushed; nothing tagged).** `bb9c1f0` the student's working tree as found (prose, `e2e-nav/`,
  review), kept apart from the assistant's changes; `0172867` harness: preregistered redirect rule in
  `e2e-nav/score.mjs` (mifos 12/22, was 15/22 on landed targets) plus comparison graphs, rule-order macros
  (`AttrNonLiteral`, `AttrOrderFlips/Where`), mutation sample overlap (`MutOverlap` 46/73, `rq4earlier-*` = 583a72c),
  node-audit scalar macros; `b846112` one-page abstract, aims-only 1.2, short ch7; `3e725ab`, `340cbb6` "must
  conversion" in Table 5.1, the before-after table and the plot axis; `47cd2ee` chapters 2-6 and Appendix A cut, one
  home per concept, repair history as Appendix A Table `tab:repairs` (`app:repairs`), `tab:ratios` in 4.2,
  abbreviations list, terminology fixed (node coverage, must conversion, recovered share, loss category vs defect
  class, independent route parser, runtime route oracle, rendered-interface check, starting/intermediate/final
  instrument), review A1-A5, B7-B14 and most of C applied; `f69cf5f` the verified findings of the 5 Nov panel (3
  Sonnet lenses + Opus gate: 37 findings, 21 confirmed, 11 partly, 5 refuted; JSON in the session scratchpad only).
- **Regeneration.** Every regenerated file was diffed against the committed one: only the added macros or the renamed
  header/axis label differ. Tests: harness vitest 101/101 (the two node scripts run separately: guard-resolve 13/13,
  template-context 12/12; vitest's "2 failed files" for them is pre-existing), `e2e-nav` `node --test score.test.mjs`
  3/3.
- **Size.** Build 152 pages (was 155), 0 errors, 0 undefined references, 0 overfull boxes; abstract on one page; body
  ch1-ch7 57.3k -> ~47k words (ch1 2.9k->2.0k, ch5 15.7k->13.8k, ch6 12.7k->10.0k, ch7 3.3k->0.8k); Appendix A grew
  (tab:repairs, 32 rows). The body still runs p7-p118. A further cut would mean dropping content (5.3.2-5.3.4 detail,
  the must-tier review detail, the probe subsection, 2.x background, 6.4 transfer, 5.6 dead links): the student's
  call.
- **Left for the student (not decided by the assistant):** Q2 guard defect class: demote to candidate or state an
  exception (the text now credits red-team panels, not the witness check; the class row's "Methods" count is
  unchanged); Q3 AI-use facts (who drew the diagrams, who read the realworld reference, that the assistant ran the
  evaluation, which prose the student wrote — the supervisor asks exactly this); Q4 cohort b7926b7 edge-by-edge or
  total, why the alfresco/k8sdash suites were not run, whether the title can change; Fig 1.1 without RQ5 (intentional?);
  which of 698/2798 belongs to the parser (`route-oracle/index.mjs:1223` vs appendix; dated to `d40c8dc`); typed
  counts with no generated source (e.g. "nine header sites", "five pairs"; disclosed as a kind in the AI statement).
- **Logic panel, 5 Nov (landed).** 4 Sonnet lenses (circularity, argument chain, numbers recomputed from final14 /
  e2e / rq4 data, overclaim) + Opus gate: 35 findings, 20 confirmed, 15 partly, 0 refuted; 5 major. The assistant
  re-checked the two largest itself (ghostfolio's 50 "dynamic" constructs are fields initialised from the constant
  route table; mifos supplies 210 of the 292 recovered, 82/220 elsewhere). Applied in the last commit: the
  "Accounted, dynamic" bucket is "destination recorded as unresolved", not "only the run time knows"; every RQ4
  operator is scored only where the graph already reads the construct; attribution recovery stated with
  `AttrRecoveredShareNoMifos` (37.3 %) and `AttrUnderHalfApps` (4) (new compare.mjs macros, test-first); RQ5 answered
  at cause level (classes name extraction failures by definition); mifos base misses are losses of a declared
  approximation, dynamic misses are forms the extractor does not read; "validated" dropped; reproducibility limits in
  ch7; dangling refs fixed. Findings JSON: session scratchpad only (`logic-panel.json`, `panel.json`); not committed.
- **Left for the student from the logic panel:** C1 recount the guard and attribution rows of tab:defects (the
  attribution row's only method line restates the loss ledger; the guard row has no named method) — this is Q2;
  C2 restating RQ5 as a partition of causes with counts (needs new macros); C5 the preregistration's timing cannot be
  corroborated from the archive (same commit/birth time for prereg and logs) and P1-P4/PM1-PM3 are not reported (H2);
  A2 ch4:74-75 vs the mifos e2e run, ch4:28-30 mifos has Playwright specs; H3 whether the e2e check belongs in the
  abstract; H9 name the independent route parser in the AI statement.
- **Harness bug found, not fixed:** `route-oracle/diagnose-attribution.mjs:22-28` treats a bare-identifier target as a
  literal path, so TabRemaining's "Scope found, target screen has no node" row also counts targets held in a field
  (all 23 in ghostfolio). The text now qualifies the row; fixing it needs a regen-round run (DBs + diagnose). Also
  optional: split the dynamic bucket by target form, and an accounted-share decomposition (recoveries vs relabelling),
  both as new round2-to-latex macros.
- **Final build (5 Nov):** 152 pages, 0 errors, 0 undefined, 0 overfull; abstract on one page; body ch1-ch7 ~47.6k
  words. Stashes and worktrees as below, untouched. Nothing pushed.

## Current state, 4 Nov 2026

- **Branches and tags.** Local `main` is `204f325`, the same commit as `origin/thesis-final-2026-11` (pushed).
  `origin/main` is still `e7add5d` (2 Nov). On origin, tag `thesis-eval-final` points at `c42f220`, the evaluated
  extractor; `thesis-eval` (`dd28cc2`) is superseded.
- **Code.** `packages/` is identical to `c42f220`. Generated tables are stamped `c42f220` (round tables
  `c42f2204 (local-checkout)`), except ablation (`c5f2fe5`) and ground truth (`7338774`), which are harness-only
  commits on the same extractor, and the historical earlier instrument (`f17a302`) and node audit (`4505fd2a`).
- **Checks run on 4 Nov on the working tree.** Adapter `vitest --maxWorkers=2` 498/498; harness vitest 98/98,
  `node guard-resolve.test.mjs --corpus ~/personal/uigraph-work/corpus` 13/13, `node template-context.test.mjs`
  12/12; the thesis builds from a scratch copy at 155 pages with 0 errors, 0 undefined references, 0 overfull boxes.
- **Uncommitted in the working tree** (the student's work after `204f325`): prose in `thesis.tex`, `ch1`..`ch7`,
  `appendix-a.tex`, `references.bib`, `REPRODUCE.md`, this file (the "Rigour ..." and "End-to-end ..." sections
  below) and `thesis.pdf`; new `e2e-nav/` (`PREREGISTRATION.txt`, `collector.mjs`, `nav-trace.ts`, `score.mjs`,
  `results/{realworld,mifos}`) and `thesis/generated-e2e.tex`; new `reviews/review-2026-11-04-vi.md` and
  `review-2026-11-04.json`.
- **Headline figures the thesis prints** (all through macros): must tier 150 edges on 25 constructs, 17 on 21
  without attribution; 126 must edges on 3 constructs (k8sdash, bitwarden) rest on the route-order assumption,
  24 edges on 22 constructs without it; witness check 0 failures, 62 must edges unread (k8sdash's toolbar link);
  guard-only 194 must edges, 44 of them guarded; attribution recovers 292 of 454 constructs (64.3%); full adds 36
  sites over outlet, of which the call graph's own net contribution is 7; structural reference on realworld 100%
  precision and recall; RQ4 attributed 67/67, baseline 50/51, paired 51 vs 50 of 51; sweep 173 mutants;
  end-to-end navigations realworld 19/19 pairs in the graph, mifos 15/22 (7 misses: 4 dynamic, 3 base).
- **Open: the 4 Nov review** (`reviews/review-2026-11-04-vi.md`, details in `review-2026-11-04.json`): 62
  findings, 44 confirmed in full and 18 in part, none fixed yet; the student decides. To fix before the text goes
  to the supervisor (section A):
  1. `e2e-nav/score.mjs` does not apply the preregistered redirect rule; applied, mifos is 12/22, not 15/22.
  2. "same seed and same sample" is false.
  3. The witness check is credited with finding the guard defect, which it did not.
  4. mifos's 4 "dynamic" misses are extractor read failures.
  5. "all but one were repaired" is false.
  Then section B (items 6-14: must-tier history wording, rule-order dependence of "attribution is the largest
  class", the realworld e2e not discriminating, ch6:72, "most" of 88.2%, ch5:168 "none remains", the AI-use
  claims) and the minor batch C. The file ends with five questions for the student (fix `score.mjs` or only
  disclose; the guard class; facts for the AI-use declaration; cohort, unrun suites and title; new macros for
  items 7, 8 and 12).
- **Stashes.** `stash@{0}` holds the 1 Nov work of unknown origin plus execution-prep docs, labelled "review found
  defects, do not commit as-is"; `stash@{1}` is older. Leave both untouched.
- **Worktrees.** Nine merged fix-round worktrees under `.claude/worktrees/` can be removed with
  `git worktree remove`. `~/personal/uigraph-work/thesis-repair-20261101/extractor` (branch
  `codex/thesis-repair-evaluation`, at `469b210`) belongs to another tool; ask before removing it.
- **Still open from earlier sections:** a human re-reading of the must-tier verdicts (`review.json` and
  `tier-reading.json` are the assistant's); graders' access to `kanetran29/uigraph` (check its visibility);
  stale `harness.zip` and `thesis-latex.zip`; the admin items at the end.
- **Limits.** Check usage (`get_usage`) and `memory_pressure` before any fan-out; see the memory rule under
  "Rules that have held".

## Where things are

| path | what |
|---|---|
| `thesis-handoff/thesis/` | LaTeX sources. `thesis.tex` (abstract, AI-use declaration) + `ch1`..`ch7`, `appendix-a.tex`, `figures/`, `references.bib`. `generated-*.tex` are written by the harness, never by hand. Build: `latexmk -pdf -interaction=nonstopmode thesis.tex` (155 pages on 4 Nov). |
| `thesis-handoff/route-oracle/` | measurement harness (Node 22+, `node:sqlite`). Its own tests: `npx vitest run --maxWorkers=2` (98), `node guard-resolve.test.mjs --corpus <corpus>` (13), `node template-context.test.mjs` (12). |
| `thesis-handoff/e2e-nav/` | end-to-end navigation check (uncommitted): preregistration, collector, `score.mjs`, results for realworld and mifos; writes `thesis/generated-e2e.tex`. |
| `thesis-handoff/reviews/review-2026-11-04-vi.md` | the open 4 Nov review (Vietnamese summary; full findings in `review-2026-11-04.json`). |
| `thesis-handoff/reviews/panel4/` | the fourth Opus panel and the three fix rounds that followed it, as JSON: `prose-panel.json` (68 prose findings, each with a verifier verdict; 62 real), `code-panel.json` (36 code findings, 31 real), `round1-fixes.json`, `round2-followups.json`, `round3.json` (each: what a fix branch did, and an Opus review of it). |
| `~/personal/uigraph-corpus/` | the six corpus applications at their pinned SHAs (`fetch.sh` re-creates them). |
| `~/personal/uigraph-work/` | work dir: `corpus` symlinks to the durable corpus; `noattr/`, `ablation/`, `guard-only/`, `corpus-rq4/`, `final7/`, logs. Never use `/tmp` for this: macOS pruned a corpus `.git` there once, and `remeasure.sh` refuses it. |
| `thesis-handoff/route-oracle/results-round2/final14.tgz` | the two run-all.mjs runs at `c42f220`; reproduces tables, before-after and round-two byte for byte (stamps aside). `final7.tgz` (eb9dab80) does not. |
| `thesis-handoff/route-oracle/results-ablation/ablation.tgz` | `ablation.json` and the six realworld level DBs; reproduces the ablation and ground-truth tables. |
| `thesis-handoff/REPRODUCE.md` | grader-facing reproduction guide: versions, corpus pins, regeneration from archives, full re-measurement, build. |
| `thesis-handoff/reviews/wip-2026-11-01.json` | the Opus review of the uncommitted working-tree changes (46 findings, each with a verifier verdict; 45 real). |
| `~/personal/uigraph-work/wip-review/` | snapshot of those changes (`wip.patch`, `untracked/`), the six corpus graphs mapped with HEAD and with the working tree (`maps/head`, `maps/wip`, `maps/diff.json`), and the working-tree PDF text. |

## Rigour, circularity and concealment review, 3 Nov 2026

- Five-reviewer pass over the whole text; 26 ranked items, all approved by the student and applied.
  Prose only: no harness, generator or `packages/` change. `packages/` is still identical to `c42f220`.
- Verified against code or data before the text was changed:
  - `outlet` already covers Rima et al.'s same-class helper following: a navigation call anywhere in a
    component class is emitted at that component's screens (`extract.ts` 626, 667-677). On realworld the
    outlet→full difference is exactly `user.service.ts:86`. ch5 says so.
  - Ambiguous-selector joins: no must edge cites a construct placed through one (k8sdash must edges cite
    `chrome/component.ts` and `template.html`; bitwarden's cites `request-sm-access`, route-mounted at
    `oss-routing.module.ts:729`). ch3 states it without a hand-typed count.
  - 0 of 22 mifos e2e pairs are must edges (realworld 5 of 19).
  - Bib: `websurvey2025` and `llmdroid2025` checked on Crossref (DOIs `10.1016/j.scico.2026.103473`,
    `10.1145/3715763`): venue, volume, pages, authors, year all match the rendered entries.
  - tab:defects attribution row: at `f17a302` the six realworld `DELETE_ROUTERLINK` mutants (all in
    `header.component.html`) are EXCLUDED on the baseline graph ("witnessed by no baseline edge") and
    DETECTED on the attributed one (`results-rq4/rq4base-realworld.json`, `rq4-realworld-attributed.json`).
    Row now says "mutants excluded on the baseline graph", not "mutation misses" (MISSED is a different verdict).
  - ch6 "before the call graph was added they were the only remaining loss the analysis as specified would
    have recovered" was unsupported: `TabRemaining` has 17 "scope found, not explained" at `f17a302` and 2 at
    `296f4bd`. Replaced with the ablation macros (`\AblationFullAddedSites`, `\AblationCallGraphNetSites`).
- Reviewer claims rejected: Yang "6 apps" (now "20 apps; manual on 6"); the Expansion tautology and the
  ground-truth circularity are already disclosed (ch5); `\RoundTwoDeadLinkUnanswered` is decided via the
  oracle (appendix-a). `\RoundTwoMustClean` kept: unused in prose but read by `earlier-instrument.mjs`.
- Disclosed instead of done: baselines are in-tool reimplementations; no fresh-seed mutation run; the e2e
  miss classes were defined after the misses were read and the preregistered M3 classes were not scored.

## End-to-end navigation check, 3 Nov 2026

- New measurement (RQ3): router navigations logged while each app's own Playwright suite runs,
  scored against the c42f220 graphs. Rules, validity checks and predictions in
  `e2e-nav/PREREGISTRATION.txt`, written before any log was read (mifos as Addendum A).
- realworld: 123/123 pass, 19 distinct pairs, all in the graph (3 via the shell scope only).
- mifos (local Fineract, digest-pinned): 86 pass / 5 skip in all runs, 22 pairs, 15 in the graph.
  Misses: 4 dynamic (`navigate([`actions/${name}`], {relativeTo})`, declared unresolved in the
  soundiness ledger), 3 base (relative links in `clients-view.component.html` 264/267/420 resolved
  against the child tab's address on the subtree scope, giving edges to `*`). Not repaired on the
  student's decision: no held-out app; wait for the supervisor's review.
- Miss classes are rules over the graph in `score.mjs`, defined after the misses were read; ch4 says so.
- Text: ch4 `sec:metrics` paragraph and provenance row; ch5 RQ3 paragraph after the ground truth and a
  sentence in the qualifications; ch6 `sec:limitations`; ch7 RQ3 answer and open gaps; ch1; abstract.
- Macros from `generated-e2e.tex`; regenerate with the command in REPRODUCE.md.
- Alfresco has a suite but needs ACS on Kubernetes with registry credentials; not run.

## Authentication and static-plus-dynamic framing, 3 Nov 2026

- Student asked that the thesis say plainly that most real applications are used signed in, behind
  guards, and that the static graph can be combined with dynamic measurement to complete it.
- ch1 motivation: new paragraph, the two approaches complement each other; combination discussed in
  `sec:future`, not measured.
- ch6 findings: paragraph after the runtime-routing one; \ScopeUnjudged/\ScopeScreens redirect to
  sign-in, \CensusMust → \GuardOnlyMust with every guard passing, ghostfolio's per-route guard.
- ch6 future work: GoalExplorer cited as static-guides-dynamic precedent; paragraph on what each side
  supplies; an observation witness is evidence for a may edge, not a promotion to must.
- ch7: one sentence after the sign-in limitation pointing to `sec:future`.
- Abstract: "reimplemented in the same extractor" added to the earlier-work sentence (matches ch5:544).
- No numbers changed; prose only, no re-run.

## Data and figure audit, 3 Nov 2026

- 20 of 21 `generated-*.tex` regenerated and identical (comment lines aside): 11 from the archives
  (REPRODUCE section 1 plus probe), 7 from the c42f220 corpus graphs in `uigraph-work/corpus` and
  `noattr` (census, census-base, expansion, must, guard-only, route-order, callgraph), earlier
  from git, approx from the sources. `packages/` is identical to c42f220. node-audit (4505fd2a,
  historical) cannot be regenerated. `expansion-check.mts` failed once with SQLITE "unable to open"
  and succeeded on rerun.
- Figures: alg-attribution now marks the canDeactivate seed model only, seeds layouts, points to
  the implementation departures; lst-angular declares `session`; fig-scopes and fig-anchored
  notes match `extract.ts:549-564` (one stored edge only if conditional, or target outside the
  subtree); fig-loss caption says "Converted" is must or may, unlike the conversion ratio.

## Deep self-review, round 2, 3 Nov 2026

Prose only; no code or input changed, so no re-run. The five main generated tables were rebuilt
from `final14.tgz` and are identical to the thesis copies.

- Abstract, ch1, ch7, AI declaration: qualifiers from 26fee8e carried up (witness check reads no
  guard; conversion ratio an upper bound at line granularity; reference partly completed from the
  graph; only realworld and bitwarden rendered judged pairs; 21→25 decomposed; 62 unread are k8sdash
  toolbar edges; deletions near-guaranteed, 11/17 guard mutants scored; two readings are one model;
  no held-out application; measurement framed as the main contribution).
- ch2: Angular guard list (canLoad deprecated, RedirectCommand/Promise/Observable, canMatch false
  tries the next route, preloading); Android single-owner claim softened; "found no earlier work";
  Oshima & Kishi faults were injected only into sample-app variants (checked in the SEKE PDF).
- ch3: route reuse vs guard re-run wording aligned with `paramsChange` and `extract.ts:223`.
- ch6: reuse rule includes the matrix condition; effects stand-in at full and class
  (`attribute.ts:568`) and the `@Effect`/outside-dir path goes through the call graph; three threats
  enlarge the framework set; React loader revalidation; Vue catch-all order; beforeEach analogue;
  "NgRx effects"; remaining no-node losses described as "some", matching l.27-30.
- appendix-a: orphan baseline sentence removed; 698/2798, 174/3512 and "eight" labelled as measured
  at c0fe3b1, not re-measured on the final extractor (no recorded file or macro holds them).
- Not verified: tab:rw sample sizes (Yang, GoalExplorer, StoryDroid, ProMal, UI-CTX); PDFs blocked.

## Deep self-review (correctness, logic), 3 Nov 2026

Prose and formula exposition only. No code or data changed, no corpus or sweep re-run. Each finding was checked against code or data first.
- ch3: pass can exceed the model (indirect/lost shells get top, attribute.ts:500–514; unimported ambiguous selector join);
  unknown may lie in E for effect navigations (none emitted); M ordered; solver init counts all seeds; |T| times targets;
  implemented pass is not "full model with D, T empty"; entry-guard row is an approximation; no prefix-route anchors
  (subtreeAnchor size >= 2); "root-level primary outlet" in alg-attribution.
- ch4: witness check reads no guard (witness-check.mjs); ±1-line witness tolerance (loss-breakdown.mjs:196) makes conversion an
  upper bound; "lost" definition; RQ3 criterion over one construct denominator; no held-out app; "Other" tallies several causes.
- ch5/ch7 RQ1–RQ3: must constructs 21→25 = 2 recoveries + 2 k8sdash may→must (final14 L.json rows); 62 of 133 added must edges
  unread; structural-reference precision qualified (completed from graph); +1 pair is the full step; scope check rendered pairs
  only on realworld and bitwarden.
- ch5 RQ4–RQ5: all 6 exclusions are guard mutants (11/17 scored); DELETE_ROUTERLINK near-guaranteed; review readers are one model;
  62 unread = k8sdash toolbar edges (same as scope/route-order weakness); probe zero is a precondition, not half the must claim;
  dead links checked against probe config; remaining sites carry a recorded reason, not a verified one.
- PDF 151 pages, 0 errors, 0 undefined, 0 overfull.

## Consolidated review of 964034a (C01–C11, E01–E04), 3 Nov 2026

Prose, figures and bib only. No code or data changed, and no corpus or sweep re-run. Each finding was checked against code or data first.
- C01: the measured graph's guard holds router guards only. Enclosing `if` text is kept only in `--controls` mode.
  The guard is part of the edge ID, so a merge never drops a recorded guard (ch3, ch6).
- C02: the emitted service scopes are the least CG solution widened by fallbacks. Reached members also get unseen-caller
  joins (extract.ts:752–772). The ch6 receiver forms now match callgraph.ts:160–168.
- C03: the solver bound includes initialisation and excludes relation building. The size bound gives single-target vs the
  sum over scope × targets.
- C04: ch5 RQ5 has the spread exception. The ch6 loss class is a diagnostic partition, not a bound.
- C05: fig-oracles is "test-source cross-check". ch6 separates test sources (alfresco), runtime config (6) and rendered
  links (5, historical).
- C06: ch5 /vault is now the extractor's fallback, not the router's (bitwarden.answer.json: recognised, no redirect).
- C07: ch6 build configuration is not a superset threat. The findings are bounded to the recorded dev configuration.
- C08: AutoDroid UTG memory; JS static analysis exists (TAJS cited); effects "not determined exactly / not attempted";
  Oshima literal-only qualified. New bib entry `angulareffects`.
- C09: ch6 React loader redirect source is the origin of the incoming navigation (join via T, or top), not subtree(r).
- Closure pass (e12e39b review): C02 "constraints in tab:scopes", C04 "bound" wording removed, C06 "final instrument
  used for the main RQ1--RQ3 results", C09 above.
- C10: fig-anchored uses a uniform may example plus the self case. fig-utg-example labels the effect edge as unrealised.
- C11: caption and label fixes (round2nodes off/on; current vs superseded must counting; "next one"; final tier;
  compare closure; "Evaluation basis").
- E01–E04 done. Bierman was checked against the paper PDF, and the TLDR note was removed.
- PDF 150 pages, 0 errors, 0 undefined, 0 overfull.

## Examiner-critique round, 3 Nov 2026 (later the same day)

Five argument fixes, no new experiment. Each was checked against the code first.
- Claim 3.1 (ch3) now names its execution model: plain primary activation, no other listener
  navigates, no unresolved call or scheduled work navigates. ch6's approximation items are tied to it.
- RQ3 (ch7, ch5, ch1): retention (`AttrRegressed`, `AttrDemoted`) is no longer read as precision.
  RQ3 is answered in part, and must-tier precision is not established (62 of 150 destinations unread).
- Runtime scope check (ch5, ch6, ch7): `scope-check.mjs` pools destinations per screen with no site
  identity, so 29/33 is aggregate outgoing-destination coverage. The unpredicted pairs remain direct evidence.
- Guards (ch3, ch6): the prototype does not materialise template conditions into `edge.guard`. They only
  demote to may. Handler navigations carry if/ternary text.
- RQ5 (ch1, ch5, ch7, abstract): three groups (repaired; ghostfolio spread, unsupported but readable;
  runtime/out of abstraction). "Every extractor cause repaired" is gone.
- ch7: the near-empty must tier is bound to the semantics, demotion policy and approximations.
- PDF 149 pages, 0 errors, 0 undefined, 0 overfull.
- Optional, not done: a held-out site–screen evaluation, especially of service/DI cases.

## State on 3 Nov 2026 (supersedes everything below where they disagree)

- Examiner-style review of every chapter, every finding checked against the source, data or paper before it
  was applied. Major fixes:
  - VeriFlow is open access (mdpi-res PDF). It evaluates 4 apps (Casdoor, iTrust, OpenRMF, DVWA) against ZAP and
    does not represent guards, so the tab:rw cell is now "no", "4 apps, vs. ZAP", and the footnote is gone.
  - Yang 2015 already models the window stack, so 2018 is cited as the journal version.
  - ProMal's diagnosis is aliasing and data-flow imprecision, not shared dialogs (ch2, ch6).
  - Rima et al. already read nested and lazy routes and attach guards to edges. The novelty claim is narrowed to
    cross-class/service attribution, modality, and loss classified by construct across a corpus.
  - The RQ4 wording is now "responds to source changes in the constructs it represents" (ch1, ch2, ch7).
  - The abstract's DI claim now says "reading every provider binding as if it applied everywhere".
  - tab:provenance:
    - the scope check is 1.3.0;
    - the route check is 29–30 Oct, probe 1.0.0 and comparison 1.1.0;
    - node audit `4505fd2a` is absent from the repo;
    - a sweep footnote says `packages/core` differs at `920e1aa`.
  - fraggen2022 is TSE 49(3) 2023.
  - The ch3 member relation is renamed `Mem`, and E carries the strongest modality.
  - ch5 judged-locations arithmetic now excludes the 535 unread.
- REPRODUCE.md section 1 was run by a grader-style agent in a clean worktree. It needs a root
  `pnpm install --frozen-lockfile`, which is now in the guide. All 11 generated files are then identical.
- PDF 148 pages, 0 errors, 0 undefined refs, 0 overfull boxes.
- Pushed to branch `thesis-final-2026-11` (not main), with tag `thesis-eval-final` → `c42f220`. `thesis-eval` is
  unchanged.
- Still open: human re-reading of the must-tier verdicts; graders' access to the repo (check that it is
  public); stale `harness.zip` and `thesis-latex.zip`.

## State on 2 Nov 2026, evening

- Commits after `35ca3cf`: witness tables count must edges *read and passed* (k8sdash 63/125, corpus 88/150;
  unread edges are neither); non-shell recall (rooted 82.8 %, outlet 98.3 %, full 100 %); outlet is the
  earlier-work baseline (99.5 %), the thesis adds `full` (36 sites, 2.0 %).
- Final content pass: claims of proof softened to what the evidence supports (ch1, ch5, ch6, ch7); ch5
  subsection now "Checking the scopes against the running interface"; VeriFlow guards cell "unverified" with a
  footnote (full text not retrieved) and the Zhang paragraph qualified as the abstract's description.
- New `tab:provenance` in ch4 §Reproducibility: which tables are final (`c42f220`, sweep `920e1aa` with the same
  adapter tree `bdbe98b2`) and which are historical (earlier instrument `f17a302`/`7d109c7`, runtime scope check on
  an earlier graph, node audit `4505fd2a` not recoverable). The route probe records no extractor commit and is
  labelled "recorded 30–31 Oct", not "earlier graph" (its 892 nodes equal `\CensusScreens`). Captions of
  tab:probe and tab:node-audit point to it.
- Reproduction: `corpus.json` `evalTag` is now `thesis-eval-final`, a LOCAL tag at `c42f220`. The pushed tag
  `thesis-eval` (dd28cc2) is left in place and documented as superseded. From the committed archives alone,
  generated tables, before-after, round2, groundtruth, ablation, rq4, plots-rq4, sweep, must-witness and probe
  regenerate identically apart from `%` stamp lines (checked 2 Nov). Steps in `thesis-handoff/REPRODUCE.md`.
- PDF 147 pages, 0 errors, 0 undefined refs, 0 overfull boxes. Harness 98/98.
- Open: (1) push a new branch and `thesis-eval-final` so graders can fetch `c42f220` (needs the student's word);
  `gh` is logged in as `kanetran-jaakko`, which cannot see `kanetran29/uigraph`, so check the repo's visibility
  before giving graders a link. (2) Human re-reading of the must-tier verdicts (`review.json`, `tier-reading.json`
  are the assistant's). (3) `harness.zip` and `thesis-latex.zip` date from 25 Oct and are stale; replace them with
  a `git archive` of the final commit if a zip is wanted.

## State on 2 Nov 2026, afternoon

- `9fee9f5` (after review of `e8ac256`): `\RoundTwoBefore` is over baseline in-scope sites (71.3 %, was 71.9 %
  over all constructs); no re-extraction, `final14.tgz` still reproduces all four round tables byte for byte at this
  commit. Table 3.2 and Algorithm 1 now scope entry guards by the sources of navigations into the route
  (relation T, model only; the prototype's route-naming rule is described as a stand-in), and the complexity bound
  includes M (component → member) and T. Harness 95/95.
- After the second review: the realworld hand reading is a *structural reference* (`scope^R`, ch3 §scope), not
  true scope; precision/recall are agreement with it. Rima is compared against `approach.md` and `main.pdf` in
  `softscanner-sw/softscanner_fa` (ancestor + bootstrap closure ≈ rooted/outlet; same-class helpers depth 1;
  subscribe; no outlet modelling, no provider resolution, no service following). `scope-ablation.mjs` now emits
  `\AblationAboveRooted{Sites,Share}` (50, 2.8 %), regenerated `--from ablation.json`; only the stamp and those two
  macros changed. RQ3/RQ4 conclusions narrowed. Harness 96/96.

- Extractor and harness final at `c42f220`. Every generated table is stamped `c42f220` (round tables
  `c42f2204 (local-checkout)`), produced by `remeasure.sh` then `regen-round.sh` with nothing committed during
  the runs; round runs archived as `route-oracle/results-round2/final14.tgz`. Harness 94/94, guard-resolve 13/13,
  `pnpm -s check` GREEN. Sweep record unchanged at `920e1aa` (adapter src unchanged; `sweep-to-latex` accepted it).
- `daad40d`: expanded edges that collide are joined (strongest modality leads, witnesses united;
  `\ExpansionJoined` 1414); the conversion denominator is in-scope constructs; mutate 1.9.0 retargets the whole
  commands array, draws the destination from declared routes alone and scores the edited line.
- `c42f220`: mutate 1.9.1 matches a guarded route's screens by the file its routing module imports the component
  from (bitwarden has two `AccountComponent`s; 1.9.0 scored an unreachable guard as a miss); the recovery table's
  `OTHER` row is labelled. Remaining known harness limit: realworld's two `editor` children load one file, so the
  baseline run scores and misses the empty-path guard (the single paired disagreement).
- RQ4 now: attributed 67/67, fallible operators 45/45; baseline 50/51; paired 51 vs 50 of 51. Must tier, recovery,
  ablation and ground-truth figures unchanged from the list below.
- Thesis reframed after the review in `~/Downloads/thesis-review.md`: abstract cut to about 430 words and led by
  the measurement and the near-empty must tier, with the 94.7 % rooted baseline and 2.0 % / 0.4 % mechanism shares;
  page-1 supervisor note removed; §3.1 demotion rules as a list; ch1 agent motivation softened; ch5 gains the
  installed-dependency and corpus-selection caveat, the k8sdash scope caveat on must sources, and rewritten RQ4
  prose (non-rename operators first); Table 3.1/5.1 captions reconciled; ch5 meta-commentary trimmed.
- Not done: a human re-reading of the must-tier verdicts (`review.json` is the assistant's); a signed-in runtime
  check of rendered `routerLink`s per screen (would test scope width in both directions).

## State on 2 Nov 2026, morning

- `origin/main` is at `e7add5d`; the revision commits after it are local and not pushed (the student's go-ahead
  is needed). The earlier uncommitted work described below now sits in `stash@{0}` ("do not commit as-is"),
  untouched; `stash@{1}` is older and also untouched.
- Extractor and harness are final at `920e1aa`. Adapter suite 498/498, `tsc` and `eslint` clean; harness suite
  91/91 (plus the two script checks, 13 and 12).
- Every generated table is produced at that one commit: `remeasure.sh` and `regen-round.sh` were run there,
  with nothing committed during the runs (an earlier attempt mixed stamps by committing mid-run, and
  `rq4-to-latex.mjs` refused it). The round-two runs at `920e1aa` are archived as
  `route-oracle/results-round2/final12.tgz`, which reproduces the committed round tables byte for byte;
  `final7.tgz` did not and was replaced (see the README there).
- Fixes in this revision: a navigation that later code may cancel is demoted (the old supersede rule read
  only the next statement; the new one reads the rest of the navigation's expression, the statements and
  blocks after it, a finally block, what each caller in the class does after the call, and later lifecycle
  hooks, after a review reproduced `this.consume(this.router.navigate(['/a']))`); the round-four regressions are undone (`firmOutlet`'s vacuous `.every`, which made
  a component with no outlet count as rendering one, and `host.layouts` overwritten in `8d95262`); a relative
  link that climbs above the root yields no edge (Angular throws NG04005); harness 1.9.0 no longer counts
  constructs inside comments. None of these moved the must tier.
- Figures: must 150 edges / 25 constructs (17 / 21 without attribution); without k8sdash 25 / 23; 126 edges on 3
  constructs (k8sdash, bitwarden) rest on the route-order assumption, 24 / 22 without it (`route-order.mjs`,
  `\RouteOrder*`); witness check 0 failures, 62 unread (all k8sdash's toolbar link); guard-only 194 / 69, 44
  guarded; attribution recovers 292 of 454 (64.3 %); ground truth on realworld full recall and precision 100 %
  after two repairs made with it in view (call graph, empty-path chain); RQ4 59/64 and 42/53, paired 44 vs 40
  of 49.
- Sweep: the first run of the revision (`results-must/mutation-sweep-c8eec9b.json`) had 20 survivors. Tests now
  kill 18 (`uncovered-guards.test.ts`, `uncovered-targets.test.ts`); 110 and 128 are retired as equivalent (the
  reasons are in the header of `sweep-mutants.mjs`). The full sweep at `920e1aa` is the published record.
- Prose: the "final snapshot" labels now hold; "one command" became the two scripts; the k8sdash concentration,
  the 62 unread destinations, the route-order assumption and the rule order behind RQ2 are stated; an
  eleventh protocol correction (constructs in comments) is reported; every em-dash was removed and the
  AI-sounding phrasing rewritten across the thesis.
- Still open: a component mounted through a wrapper call at the empty path is not placed on the screen above
  (declared in Section 6.3, recall only); the resolver keeps a `..` that follows another segment literally where
  Angular applies it (declared); whether each application registers its tables in the assumed order is not read
  (declared, and measured); the supersede reading does not follow callers in other classes, a navigation a
  handler schedules for later, or other listeners of the same event (bubbling, a `(click)` beside a
  `routerLink`) (declared; none occurs in the current must tier); commit messages of this revision lack the session `Co-Authored-By` line, which cannot
  be added now without orphaning the commits the generated tables name; the admin items at the end.

## Earlier state (1 Nov), removed

The 1 Nov "State at a glance", "Figures the thesis currently prints" (at `0027017`) and its six-step open-work
list are done or superseded by the sections above; they are in git at `681c286`
(`git show 681c286:thesis-handoff/HANDOFF.md`).

## What changed between 21 Oct and 1 Nov

- Router guard semantics: an edge is gated only on the guards Angular runs for that navigation
  (canDeactivate on levels left, canMatch on levels matched and on routes tried on the way, canActivate,
  canLoad and resolvers on levels entered, canActivateChild above them; a level is kept only when source and
  target share the same runtime route object, each wrapper call being its own, and the navigation preserves
  every segment it consumed when the mode is matrix-sensitive). Redirect handling reads pathMatch, parameter
  patterns, unreadable `redirectTo`, catch-alls in declaration order, and stops where Angular stops.
  126 of the 150 must edges rest on one declared assumption: a `**` in a separately registered route table is
  matched after every route of the others. The extractor emits a `route-order` soundiness note when it relies
  on it (k8sdash, bitwarden, mifos).
- Member-level call graph with dependency injection, resolved by declaration, provider bindings from loaded
  files, template calls on injected fields, effects seeded at top.
- Harness: witness check reads bound string targets and records unread ones; tier-reading gate; provenance
  covers measurement inputs; `regen-round.sh` re-runs the round-two pipeline at the current commit;
  `mutation-sweep.mjs` + `sweep-mutants.mjs` make the demotion-rule sweep reproducible.
- Prose: two passes after the fourth panel (`4d96296`, `72ccfa4`) rewrote the AI-use declaration, the
  readings' description, the ground-truth framing, scope-validation statements, Angular background facts,
  the correction count (ten), and the matcher exception.

## How to run things

- Map one app: `pnpm -s -C packages/cli run uigraph -- map <corpus>/<app>/<sub> --adapter angular --attribution --out <db>`
  (subs: realworld `.`, alfresco `projects/aca-content`, ghostfolio `apps/client`, k8sdash `modules/web`,
  bitwarden `apps/web`, mifos `.`).
- Ground truth: `cd thesis-handoff/route-oracle && pnpm -s exec tsx score-ground-truth.mjs --truth ground-truth/realworld.json --db full=<db>`.
- Guard-only: `UIGRAPH_IGNORE_GUARDS=1` (measurement switch); scope levels: `UIGRAPH_SCOPE_LAYERS=owned|nesting|rooted|outlet|full|class`.
- Generated files carry a provenance stamp: `% Extractor <sha>, packages/ clean|with uncommitted changes, harness clean|...`.

## Rules that have held

- Writing: simple English, few dashes, concise; no scaffolds, no aphoristic closers, no bold lead-ins. Results in
  Ch5, interpretation in Ch6. Thesis prose academic; numbers only through macros.
- Freeze before fix; measure on identical inputs; a surprising figure is a measurement error until shown otherwise.
- Every behavioural fix gets a test that fails before it; every demotion rule must be killed by the sweep.
- Code comments: a leading doc comment on every new or edited function; inside bodies only single-line comments
  for non-obvious steps (a hook flags trailing comments, and also flags bash `${p#*:}` and `$#` by mistake).
- Repo-local git identity is `Kane Tran <113832098+kanetran29@users.noreply.github.com>`; commit messages end with
  the session's `Co-Authored-By` line.
- `.uigraph-gate/` and `uigraph.db` are never committed.
- **Memory.** The machine has 24 GB and 14 cores, and other apps hold about 15 GB. Parallel agents running test
  suites caused two jetsam events (30 Oct 00:01, 1 Nov 06:18) and a forced reboot (1 Nov 09:46). Measured: one
  adapter `vitest run` forks 13 workers, about 3.9 GB; root `pnpm check` about 5.1 GB; mapping mifos 0.9 GB;
  each claude agent 0.3-0.5 GB. Check `memory_pressure` first; at most 2-3 agents that run tests at once,
  vitest with `--maxWorkers=2`, no `pnpm check` inside agents (run it once after merging), reviewers and
  verifiers read only, corpus maps and the sweep in one place at a time.

## Open admin items (from the earlier handoff; not re-checked)

- Email the study coordinator about study-right timing.
- Get 2026-27 DPC dates from MyCourses.
- Download `aaltothesis.cls` / `aaltologo.sty` and switch the preamble.
- The AI-use declaration in `thesis.tex` is in the student's voice: the student must read and confirm it, and
  state who compiled the realworld ground truth (not recorded anywhere this session could check).
