# Thesis handoff (2 Nov 2026, evening)

Read this first. It is written for a Claude Code session continuing the work. Everything below was
checked against the repository on 1 Nov 2026; anything not checked says so.

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

## Where things are

| path | what |
|---|---|
| `thesis-handoff/thesis/` | LaTeX sources. `thesis.tex` (abstract, AI-use declaration) + `ch1`..`ch7`, `appendix-a.tex`, `figures/`, `references.bib`. `generated-*.tex` are written by the harness, never by hand. Build: `latexmk -pdf -interaction=nonstopmode thesis.tex` (the build checked at `3ebbf35` was 141 pages). |
| `thesis-handoff/route-oracle/` | measurement harness (Node 22+, `node:sqlite`). Its own tests: `npx vitest run harness.test.mjs` (plus `guard-resolve.test.mjs`, `template-context.test.mjs`). |
| `thesis-handoff/reviews/panel4/` | the fourth Opus panel and the three fix rounds that followed it, as JSON: `prose-panel.json` (68 prose findings, each with a verifier verdict; 62 real), `code-panel.json` (36 code findings, 31 real), `round1-fixes.json`, `round2-followups.json`, `round3.json` (each: what a fix branch did, and an Opus review of it). |
| `~/personal/uigraph-corpus/` | the six corpus applications at their pinned SHAs (`fetch.sh` re-creates them). |
| `~/personal/uigraph-work/` | work dir: `corpus` symlinks to the durable corpus; `noattr/`, `ablation/`, `guard-only/`, `corpus-rq4/`, `final7/`, logs. Never use `/tmp` for this: macOS pruned a corpus `.git` there once, and `remeasure.sh` refuses it. |
| `thesis-handoff/route-oracle/results-round2/final14.tgz` | the two run-all.mjs runs at `c42f220`; reproduces tables, before-after and round-two byte for byte (stamps aside). `final7.tgz` (eb9dab80) does not. |
| `thesis-handoff/route-oracle/results-ablation/ablation.tgz` | `ablation.json` and the six realworld level DBs; reproduces the ablation and ground-truth tables. |
| `thesis-handoff/REPRODUCE.md` | grader-facing reproduction guide: versions, corpus pins, regeneration from archives, full re-measurement, build. |
| `thesis-handoff/reviews/wip-2026-11-01.json` | the Opus review of the uncommitted working-tree changes (46 findings, each with a verifier verdict; 45 real). |
| `~/personal/uigraph-work/wip-review/` | snapshot of those changes (`wip.patch`, `untracked/`), the six corpus graphs mapped with HEAD and with the working tree (`maps/head`, `maps/wip`, `maps/diff.json`), and the working-tree PDF text. |

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

## State at a glance (1 Nov, partly stale)

- `main` is at `469b210`, 48 commits ahead of `origin/main` (`5eb2864`). Nothing after `5eb2864` is pushed.
- Adapter suite at `469b210`: 453 tests pass, `tsc` clean. Harness suite: 2 of 91 fail, both the mutation-sweep
  anchor tests (the sweep's mutant list no longer matches the adapter code; see Open work 3).
- **Uncommitted changes of unknown origin are in the working tree.** Files modified between 07:45 and 07:48 on
  1 Nov, after this session's last commit and not made by it: `packages/adapter-angular/src/conditions.ts`
  (a rewrite of the superseded-navigation rule), new `packages/adapter-angular/src/supersession.test.ts`,
  new `route-oracle/merge-sweeps.mjs` and `merge-sweeps.test.mjs`, edits to `route-oracle/{compare,
  diagnose-attribution,round2-to-latex,sweep-mutants}.mjs`, `harness.test.mjs`, `corpus.json`, and prose in
  `thesis.tex`, `ch1`, `ch3`..`ch7`, `figures/alg-attribution.tex` (about 600 lines, 16 files). They are still
  uncommitted and untouched; the student has not decided what to keep.
  **Reviewed on 1 Nov** (`reviews/wip-2026-11-01.json`). Mechanically they pass: `tsc` clean, adapter suite
  475/475, harness suite 104/104 (their new mutant anchors fix the two red sweep tests), the thesis builds at
  140 pages, and the six corpus graphs are edge-for-edge and modality-for-modality identical to HEAD's. The
  review (4 critical, 21 major, 20 minor confirmed) found:
  - **Prose: do not commit as it is.** It relabels the eb9dab80 round-two tables (conversion, loss,
    before/after, round2 soundness) as the "final snapshot" although no `generated-*.tex` was regenerated, so
    the PDF prints contradictions (Table 5.1 baseline must 7/10/1 beside the census's 1/1/15; Table 5.18
    "Final-snapshot" over the 20-edge round tier with k8sdash n/a). It undoes the panel-4 provenance
    corrections, leaves the `**` route-order assumption (126 of the 150 must edges) and the known open
    false-must paths undeclared, still blames guards for the small tier, credits the call graph with 35 sites
    instead of its own 6, and overstates the sweep's coverage.
  - **`corpus.json`: do not commit as it is.** It bumps the harness to 1.8.1 with the changelog entry "Final
    repair measurement. Re-runs ..." for a measurement that never ran.
  - **Harness code:** the new mutant list has no mutant for the soundness-side router rules of the fix rounds
    (rerun, catch-all rivals, `within`, `apart`), and some supersession mutants point the wrong way;
    `merge-sweeps.mjs` checks less than its note claims.
  - **Extractor (`conditions.ts`, wider supersession rule):** mostly more conservative, but one regression
    makes a false must (a navigation in a getter called as `this.x()` goes from may to must); a callback
    registered before the site is ignored while one registered after it demotes; `mayNavigate` is exponential
    without memoisation; ch3 still describes the old same-block rule. The corpus exercises none of the new
    must-preserving sub-rules, so the identical graphs are no evidence for them.
- Worktrees under `.claude/worktrees/`: 13. The nine of rounds one to three are merged into `main`; the three of
  round four (`wf_f4a7a38a-07e-*`) are empty (round four was stopped before it committed). All can be removed with
  `git worktree remove`.

## Figures the thesis currently prints, and how current they are

Generated at extractor `0027017` (the last full `remeasure.sh`), before fix rounds one to three:

- Must tier: 150 edges / 25 constructs with attribution (realworld 9, k8sdash 125, bitwarden 1, mifos 15;
  alfresco and ghostfolio 0); 17 edges / 21 constructs without. Witness check: 0 failures, and 62 must edges
  (k8sdash's toolbar logo link) whose cited target the checker cannot read (`\MustWitnessUnread`).
- Every one of the 25 must constructs has a recorded reading in `route-oracle/results-must/tier-reading.json`
  (made once by the assistant, with the extractor's decisions in view; the census refuses a must construct that
  file does not list).
- Guard-only counterfactual: 191 must edges; 41 run a guard, 37 of them source-behind.
- Ground truth (realworld): call graph 100% precision, 97.3% recall; the class-level join it replaced 95.3%
  precision (9 excess pairs, all at `UserService.logout`). The call graph was written after the ground truth
  exposed that error and is scored on the same ground truth.
- RQ4 (mutation harness 1.7.0 at that time): 59/64 attributed, 42/53 baseline; paired 44 vs 40 of 49, none
  against attribution; guard removal 11/11.
- Sweep macros (`generated-sweep.tex`): the 72-mutant sweep at `a8c7480`. Stale (see Open work 3).

Each fix branch of rounds one to three re-mapped the corpus read-only and found the must tier unchanged:
the same 150 edges, sources, targets and witnesses. May edges, (site, screen) pairs, call-graph resolution
counts and ablation figures did change (details in the round JSONs). Mapped on 1 Nov with the code at
`469b210` (`wip-review/maps/head`), the attributed graphs hold realworld 65, alfresco 55, ghostfolio 406,
k8sdash 309, bitwarden 529 and mifos 10811 edges (the thesis prints the `0027017` counts: 62, 56, 402, 309,
253, 10819). `remeasure.sh` has not been run since,
and the round-two tables (`generated-{tables,before-after,round2,plots}.tex`) still come from extractor
`eb9dab80`, before the call graph and the router-guard rule. They must be regenerated (Open work 4).

## What changed since the last handoff (21 Oct)

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

## Open work, in order

1. **Decide the uncommitted working-tree changes** (above) with the student. On the review's evidence the
   prose and the `corpus.json` changelog should not go in as they are; the extractor, test and harness parts
   can be kept only after the listed defects are fixed and the mutant list covers every rule.
2. **Round four (was stopped).** The open review problems are in `reviews/panel4/round3.json`. Fix the
   false-must ones first:
   - `routes.ts` host branch: the first empty-path child reached through a wrapper call (new false must).
   - `heldEmpty` versus `land()`: an address a componentless route declared first answers can land at must on a
     later parameter pattern (new false must).
   - Controls mode never consults the conditional-outlet rule (`hiddenAbove`); pre-existing false must.
   - A route that spreads its address in (`{...BASE, component, children}`) is dropped silently: declare the
     subtree unread and demote links into it; pre-existing.
   - The bootstrap component's root outlet under a condition; `firmOutlet` `.some` over a joined selector.
   - Witness check: `arrayTarget` making `['../', id]` unread hides certain mismatches; `navigate([...])`
     capture stops at the first nested `]`.
   Then the regressions (realworld precision via `edgesFrom` dedupe, `catchAllFor` on the original literal,
   recall after a relative redirect), the untested sub-rules, and the sweep record's source-tree timing.
   Whatever is left unfixed must emit a soundiness note and appear in the thesis's approximation list
   (ch6, Section `sec:approximations`). Each round so far has found new false-must paths in the previous
   round's fixes, so keep reviewing until a round finds none.
3. **Sweep.** Update the anchors in `sweep-mutants.mjs` to the code at the final commit, add mutants for every
   rule the fix rounds added, run `node route-oracle/mutation-sweep.mjs` in full (about 20 minutes), write an
   adapter test for every survivor (a triage at round two found 28), and regenerate
   `results-must/mutation-sweep.json` and `generated-sweep.tex`. The harness tests must pass again.
4. **Re-measure at the final commit.** `bash route-oracle/remeasure.sh ~/personal/uigraph-work` (packages/ must be
   committed; about an hour), then `bash route-oracle/regen-round.sh ~/personal/uigraph-work
   ~/personal/uigraph-work/final8` for the round-two tables. Re-check `tier-reading.json` against the new
   must tier (the census refuses unlisted or changed constructs).
5. **Prose.** At committed `HEAD`, these prose-panel findings (`reviews/panel4/prose-panel.json`) are still
   open. The uncommitted diff touches many of them but, per its review, closes three with new defects and
   leaves about fifteen open, so do not take it as their fix:
   guards blamed for the small tier (ch7, ch5); "cost RQ1's stricter measure almost everything" (ch1);
   "move at all", "ratios over the same", "node classes are now empty", "carries a reason", "two of the
   three", "is a smaller one now", "Each correction removed a claim", "An application whose screens all sit
   behind a guard", "keeps \MustFateKept{}", hand-typed "nearly three quarters" and "the oracle saw 2" (ch5);
   guard-only edges counted as constructs (ch5); "the call graph \AblationFullAddedSites" (use
   `\AblationCallGraphNetSites`); "The call graph replaced a coarser rule" (it remains the fallback); canLoad and
   "same route object" wording (ch5); "exactly where the computed scopes are widest", "40, 34 and 132", "an
   order of magnitude more edges" (ch6); "where node defects limit it", "toolbar links" (ch7); the FigLoss caption
   (`figures/fig-plots.tex`). Also cite `\MustWitnessUnread` wherever `\MustWitnessViolations` is used as
   evidence, describe the residual approximations from step 2, and update every sentence the router and
   call-graph changes make false (each round JSON lists them under `thesisProseToChange`).
6. **Build, check, panel.** `pnpm -s check` at the repo root, the harness tests, a clean LaTeX build with no
   undefined macro or overfull float, then a final Opus panel (code, tier re-reading, harness, prose) and its
   verification. Commit straight to `main`; push only on the student's word.

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
