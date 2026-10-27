# Thesis review and achievements, 27 October 2026

Produced from five independent review lenses plus a five-lens adversarial red team, each
finding then checked against the text or the raw result files. Findings that did not
survive that check are listed at the end rather than silently dropped.

Where a finding below says **verified here**, I confirmed it myself from the harness
output, not from a reviewer's word.

---

## Status, updated after the fixing pass

| item | state |
|---|---|
| 1. "proves" / "guarantees" soundness | **fixed.** Ch1, Ch7 and the abstract now say the property is stated and mechanically tested, not proved, and Ch1 points at the violating edge. |
| 2. Provenance and reproducibility | **fixed in the text; one step left.** Both runs used one commit with the pass toggled, now said so in Ch4. Tag `thesis-eval` created on the recreated commit, which reproduces the published realworld figures with the pass off (21 edges, 7 must) and on (50 edges, 10 must). **Not pushed** — that needs your word. |
| 3. "468 is an upper bound" | **fixed.** Corrected in Ch5 and Ch6, and the measurement is now a generated table, `TabRecoverySource`. |
| 4. The 81 counts may edges | **fixed.** `TabBeforeAfter` splits must and may (38 / 43); Ch5 and Ch7 report both tiers and the 79 must-tier gain. |
| 8. Kurant and Kertusha | **fixed.** Kurant no longer "explicitly excludes" routing, and the survey is no longer credited with a finding it does not report. |
| AI-use statement | **fixed.** Scoped to numbers, result tables and plots; the hand-drawn diagrams are stated as such. |
| 5. Table 4.2 against the harness | **fixed.** Rewritten to the decision chain `loss-breakdown.mjs` implements, with the nested owner-has-no-node branch and the two missing classes, `COMPONENT_UNLINKED` (389 constructs) and `NODE_MISS`. All ten classes in the generated loss table now appear. |
| 6. Claim 3.2 has no reported result | **fixed.** 7 attribution unit tests pass, and a corpus-level check at `thesis-eval` finds 50 anchored edges expanding to 97 by the per-screen query and to the same 97 by materialising, identical sets. Reported in 5.3, scoped to one application plus fixtures. Script committed as `route-oracle/expansion-check.mts`. |
| 7. Section 6.1 repeats raw numbers | **fixed.** Rewritten to argue rather than recount; the only digits left are RQ labels. Eight regressions the de-numbering introduced were caught by a verifier and repaired. |
| 9. Chapter 3 bounds and contradictions | **fixed.** One bound per computation, correctly related; termination on finite height with monotonicity argued; the acyclicity claim dropped; Sigma pulled back to event kinds; the third modality given a consistent specified-but-not-produced voice across Chapters 2, 3 and 6. |
| Table 3.1 against Algorithm 3.1 | **fixed, against the extractor.** A first attempt removed the routed-component guard from the algorithm, which made it disagree with the code that produced Chapter 5. Algorithm 3.1 now stands as the model; the prototype's restriction (no propagation into a route-mounted component) is documented in the implementation section, carried as a side condition on Table 3.1's template row, and the least-solution claim is scoped to the model. The restriction can only lose edges, so the must-tier claim is unaffected. |
| Part 3: scope has no oracle | **declared.** 6.2 now has a "No oracle for the scope" threat explaining why the witness check and the e2e oracle both miss an over-large scope, and 6.5 proposes the hand-enumerated comparison that would give it ground truth. |
| Part 3: may-tier failures unreported | **fixed.** 5.3 reports 179 of 201 non-must edges failing target agreement before attribution and 553 of 599 after, with mifos accounting for 177 and 529, and says why the must-tier claim excludes them. |
| Part 3: RQ4 aggregate carried by rename | **fixed.** 5.4 states that rename detection is near-definitional once the mutant is scored, gives its share (22 of 48 scored, 22 of 39 detections), and reports the three operators that can fail at 17 of 26. Alfresco's single-edge graph is flagged. |
| Part 3: CI use case proposes guard assertions | **fixed.** The guard assertion is removed from the list and named as the one the graph cannot yet carry, citing RQ4. |
| Part 4: voice, orphan entry, aphorism, caption | **fixed.** One voice throughout (first person, as the abstract and Ch1 already used); `llmdroid2025` now cited; 4.3.2's closer replaced with the five corrections that were actually found by disbelieving a figure; the mutation figure caption matches Ch5's wording. |
| Panel: node precision never reported | **fixed.** `comparison.extraNodes` was in every C.json and never reached the page. 197 of 338 nodes match no declared screen. `to-latex.mjs` now emits the column and `node-audit.mjs` decomposes all 197: 143 have no route at the path, 43 are parser blind spots, 11 are prefix or redirect routes that lie outside $S$. |
| Panel: Claim 3.2 check was near-vacuous | **fixed.** `expandAnchoredEdges` is a loop over `edgesFrom`, so the first check compared a function with its own caller. The check now materialises independently and 5.3 states what it does and does not exercise. |
| Part 3: RQ2's two-method rule; Part 4: plot redundancy, page balance | **open.** |

Corrections to my own earlier reporting, from redoing the diff on the stable construct
id (`at`) instead of `file:line`: the conversions out of `LAZY_BOUNDARY` are 40 must and
2 may, not the 64 I first estimated; and there are **no** regressions out of the converted
classes, which confirms `regressed=0` and retracts the 12 I had flagged as unresolved.

The rebuild after all of this is clean: 73 pages, no overfull boxes, no warnings, no
undefined references.

---

## Part 1. What the thesis has earned

This is the honest achievement list. Every number traces to a generated table or a
result file.

**A measured baseline where none existed.** 1820 navigation constructs across six pinned
Angular applications spanning 14 to 921 declared route entries. The baseline extractor
converts 0 to 15 percent of them into deterministic transitions. Before this work there
was no published figure for how much of a client-side router's navigation static analysis
recovers, and that number is now on the record with its inputs.

**A defect taxonomy with a real acceptance rule.** Every lost construct is assigned to
exactly one class by an ordered rule set, so classes can be compared by size. A class is
admitted only on two independent confirmations, and the one class that has a single
confirmation is reported as a candidate rather than promoted. That discipline is rarer
than it should be.

**An analysis that works, measured on identical inputs.** Corpus-wide deterministic
conversions rise from 96 to 175, a gain of 79, while must-tier precision does not move:
one failing edge before, one after, and it is the same edge. On realworld the conversion
ratio goes 15.0 to 37.5 percent.

**A genuine discovery in RQ4, not just a rate.** The mutation harness found that a guard
declared on a route whose path is the empty string never reaches the edges entering that
screen. Direct graph inspection then confirmed it independently: both children of
realworld's `editor` route declare `canActivate: [requireAuth]`, yet only the edge into
`/editor/:slug` carries the guard. Finding a real defect in the artefact under study,
with two methods agreeing, is the strongest single result in the thesis.

**A result that separates two hypotheses.** Running the same mutants against the baseline
graph shows attribution does not raise per-change detection (92.3 to 95.2 percent on
realworld) but widens what the graph responds to at all: scorable mutants rise from 13 to
21, and link deletion goes from entirely excluded to six of six detected. That is a
sharper claim than "attribution helps".

**Seven protocol corrections reported in full**, three of which made the reported figures
worse. A thesis that publishes the measurement errors that flattered it earns credibility
that no amount of polish buys.

**Reusable artefacts.** 13 harness scripts, 55 result files committed as provenance, a
pinned corpus manifest, and tables and plots generated from results rather than typed.

**The document itself.** 73 pages, 10 figures, 17 tables, 80 references each verified
field by field, building with zero LaTeX warnings and no undefined references.

---

## Part 2. Must fix before 2 November

Ordered by how much damage each does at the defence. The first four are the ones I would
fix if there were only time for four.

### 1. The thesis says it "proves" a soundness property it does not prove, and its own data
contains a counterexample

Three lenses raised this independently, which makes it the strongest finding in the set.

Chapter 1 line 122 says the thesis "proves a conditional soundness property over a
declared scope". Claim 3.1 is stated with no proof and no proof sketch. Chapter 5 then
reports a must edge whose witness navigates to `/profile/:username` while the edge targets
`/profile`, and says in plain words that it violates Claim 3.1. The abstract calls the
property one the analysis "guarantees".

So the one formal claim in the thesis is asserted, falsified by the thesis's own harness,
and still described as proved and guaranteed. This is the first thing an opponent will
open with.

Fix: replace "proves" and "guarantees" with what is true, that the thesis states the
property, tests it mechanically on 153 must edges and finds one violation. Add a proof
sketch covering the two implemented relations so the claim has an argument as well as a
test. State the counterexample where the claim is made, not only in Chapter 5, and say
whether you attribute it to the adapter's target resolution rather than to the analysis.

### 2. Every RQ1 to RQ3 figure is currently unreproducible, and the "two tagged versions"
design is not what was run — **verified here**

`results-before/results.json` and `results-after/results.json` both record extractor sha
`4505fd2a580ad3a6b07fd6c02c999e43668708b4` and differ only by `"attribution": false`
against `"attribution": true`. Chapter 4 says the measurement was made on "two tagged
versions of the extractor". It was made on one commit with a runtime flag. And
`4505fd2a` exists in no clone this project holds, while `corpus.json` pins `c4f8b833`,
so the harness as shipped cannot reproduce Chapter 5.

The design is actually *better* than the thesis claims: toggling one flag on one commit
rules out every other difference between the runs, and section 3.3 already establishes
that the flag off reproduces the baseline edge set exactly. The problem is only that the
thesis describes something else.

Fix: push and tag `4505fd2a`, then describe the real design and claim its advantage.
Reconcile the Chapter 5 provenance comment and the `generated-tables.tex` header, which
currently disagree with `results.json` about both the commit and the date.

### 3. The 468 attribution constructs are not an upper bound on what attribution can
recover — **verified here**

Chapter 5 line 117 and Chapter 6 line 46 both state that bound. The harness contradicts
it. Corpus-wide `CONVERTED_MUST` rises 96 to 175, a gain of 79, while `compare.json`
credits `recoveredMust` as 38. The other 41, a majority of the deterministic gain, come
from constructs the loss rules had filed in node-defect classes, chiefly mifos constructs
classed `LAZY_BOUNDARY`.

Attribution recovers constructs the rules booked as node-extraction defects, because it
reaches a site through a shell or subtree scope even when the site's own route component
has no node. The two classes are therefore not separable by the instrument used to
separate them.

This weakens the "node extraction is the bottleneck" headline without destroying it: the
target-side form of the argument still holds, since no edge can be drawn *to* a screen
that was never created. But the headline currently rests on the source-side form.

Fix: report the baseline-class by attributed-class move matrix as a generated table.
`compare.mjs` already has both row sets and only needs to stop filtering to attribution
classes. Then state the claim the data supports: the loss classes interact, and 41 of the
79 newly deterministic constructs were filed as node defects in the baseline.

### 4. The headline recovery figure counts may edges — **verified here**

`conversion` is `CONVERTED_MUST / constructs` (`run-all.mjs:164`), must-tier only. The
adjacent Recovered column is `recoveredMust + recoveredMay` (`compare.mjs:57`). The
corpus total of 81 is 38 must plus 43 may. Chapter 5 then writes "from 15.0 percent to
37.5 percent, where 21 of the 22 attribution losses are recovered", and on realworld that
21 is 9 must plus 12 may while the 22.5 point rise comes from the 9 alone. Chapter 7
repeats the 81 beside "costs nothing in deterministic precision", which invites the reader
to read a may-tier gain as deterministic.

Fix: split the column, or report must-tier recovery as 38 of 468 and the may-tier gain
separately. More than half the headline benefit currently lands in the tier Chapter 3 says
carries no soundness property.

### 5. The loss-rule table does not match the harness, and omits the second-largest class

Table 4.2 is not the precedence `loss-breakdown.mjs` implements, and it leaves out
`COMPONENT_UNLINKED`, which is 389 constructs, the second largest class in the corpus.
Since the whole RQ2 argument rests on the rules partitioning the losses, a table that
misstates them undermines the chapter that depends on it.

### 6. Claim 3.2 is stated, said to be tested, and no result for it appears

Two lenses confirmed this. The expansion claim is given a number, the implementation
section says a function exists to test it, and no outcome is reported anywhere. Either
report the test result or demote it from a numbered claim.

### 7. Section 6.1 repeats raw numbers

The supervisor asked for exactly one thing in 6.1, a synthesis without raw numbers. It
currently restates them. Cheap to fix and he will notice.

### 8. Two literature claims do not survive contact with their sources

Kurant (2025) is described as a static analysis that "explicitly excludes routing". The
paper does not mention routing at all, so it cannot exclude it explicitly, and the gap
argument leans on that wording. Separately, the Kertusha survey is credited with reporting
that every model-based tool builds its model dynamically; it does not report that.

These are the two most dangerous sentences in the thesis, because a negative existence
claim is the easiest thing for an examiner to falsify and both are load-bearing for
novelty. Restate them as what the sources actually support, and describe the literature
search protocol so the negative claim is falsifiable rather than unfalsifiable.

### 9. Chapter 3's mathematics has internal contradictions

Confirmed by the program-analysis lens: the fixpoint bound omits the nesting relation and
the chapter gives two different bounds for the same quantity; termination is justified by
the wrong property; Table 3.1 contradicts Algorithm 3.1, so the computed result is not the
least solution the text claims. Also, the modality set has three elements and the third is
empty in every measured graph.

---

## Part 3. Examiner will ask

- **RQ4's aggregate is carried by an operator that cannot fail.** `RENAME_PATH` supplies
  22 of 48 scored mutants and 22 of 39 detections, and its detection is close to
  definitional: the harness excludes the mutant unless a node already holds that path
  segment, then scores it detected when the renamed segment appears. Strip it and the rate
  is 17 of 26. Lead with per-operator figures, as Chapter 2 says Papadakis recommends, and
  say that the rename operator tests node extraction rather than change sensitivity. Add
  that alfresco's attributed graph carries a single edge, so its 81.8 percent is a
  node-level result.
- **Nothing validates the screen set attribution computes.** Every method checks edges,
  nodes or witnesses. The scope, which is the contribution, has no oracle. The cheapest
  high-value addition to the thesis.
- **Witness-check failures outside the must tier are never reported.** Across the corpus
  they go from 180 to 554 as the may tier grows. Chapter 3 justifies not treating them as
  precision failures; the thesis should still say the number.
- **The CI use case proposes guard assertions** that the thesis's own RQ4 result shows the
  graph cannot support.
- **RQ2's two-method rule** is not fully satisfied for every class on close reading.
- **The end-to-end oracle** has n=14 on one of six applications and is the only
  execution-grounded figure in the thesis.

---

## Part 4. Smaller, cheap, worth doing

- The AI-use statement claims every figure is produced by the harness. Six of the ten
  figures are hand-drawn TikZ diagrams. Narrow the sentence; it is a declaration in your
  name.
- Figure 5.4's legend disagrees with the text about how many mutants were missed.
- Three of Chapter 5's four plots reprint the table beside them.
- `llmdroid2025` is the one bibliography entry nothing cites.
- The thesis uses three different voices for the same person.
- Section 4.3.2 ends on an aphorism.
- Chapters 3, 4 and 5 each sit about a page under their page target while Chapter 6 is at
  the top of its range.

---

## Part 5. What I rejected

- **Regressions out of the converted classes.** A red-team lens implied constructs lost
  their conversion after attribution. `compare.mjs` reports `regressed=0` for all six
  applications, and my own per-construct diff hit 181 duplicate `file:line` keys in mifos,
  so my matcher is the unreliable one. Not a finding. It does show the harness needs a
  stable construct id before anyone trusts a per-construct diff.
- **"Two papers are each called the closest related work."** Refuted on verification.
- Several severities were inflated by their reviewers and have been corrected downward
  here, including three findings first filed as blockers.

---

## Suggested order of work

1. The three wording fixes that remove false claims: "proves" and "guarantees", the Kurant
   and Kertusha sentences, the AI-use statement. An afternoon, and they remove the three
   easiest ways to lose the defence.
2. Push and tag `4505fd2a`, fix the provenance comment and table header. Restores
   reproducibility for all of Chapter 5.
3. The move matrix and the must/may split. These change what Chapter 5 and Chapter 6 claim,
   so they need the numbers before the prose.
4. Table 4.2 against the harness, and the Chapter 3 bounds.
5. Section 6.1's raw numbers, then the per-operator RQ4 framing.
