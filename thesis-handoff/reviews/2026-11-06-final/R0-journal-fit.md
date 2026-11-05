# Re-Review Report: Journal-Fit Reviewer (EIC seat), round 2

## Manuscript Information
- **Title (revised)**: Measuring Static UI Transition Graph Extraction in Single-Page Applications, with Scope Attribution (D. K. Tran, Aalto MSc thesis, revised draft dated 5 Nov 2026)
- **Length**: 117 pp. (was 124). Body pp. 8-96 = 89 pp. (was pp. 8-115 = 108). Bibliography pp. 97-104. Appendix A (Table A.1, corrections) pp. 105-111 and Appendix B (Table B.1, declared approximations) pp. 112-116.
- **Review date**: 2026-11-06. **Round**: 2, verification of the revised manuscript.
- **What I read**: `manuscript.txt` in full, except the bibliography. I checked four pages of the rendered `thesis/thesis.pdf` (pp. 11, 51, 82, 93), listed near-empty body pages with `pdftotext`, and checked the LaTeX sources for three cross-references and placeholders. Inputs were my round-1 report, `editorial-decision.md` and `cards.md`. I did not read the other seats' round-2 reports or any response letter. I did not take any change on trust: every verdict below cites the revised text.
- **Known and intended**: the AI-use statement (pp. 2-3) is unchanged because the author is rewriting it from a draft. I record it once (W5/REV-10) and do not count it again under REV-13.

## Reviewer Information
- **Role**: Journal-Fit Reviewer. Configured identity: professor of software engineering at a Nordic university, examiner of Aalto CS master's theses, grading on the Aalto 1-5 scale. Same card as round 1.
- **Blind spot (declared)**: estimation and analysis semantics in detail. No verdict below depends on them.

## Overall Recommendation
**Minor Revision.**

The revision fixes what drove my round-1 Major Revision on claims. The title and contribution order now say that the measurement is primary. RQ1 is stated as largely definitional, with the 33/159/203 sensitivity. RQ4 is a sanity check. RQ5 is answered in three parts. The Rima et al. headline carries its post-hoc label and the pooled no-rank statement. Section 1.2 states aims only.

What remains is local editing, not reframing:
- The body is 89 pages against the roadmap's acceptance level of about 80 or fewer. Table 7.1 and Table 6.1 together still take about 10 pages.
- The abstract is shorter but still carries 16 figures.
- The services-novelty sentence in Ch. 7 is unchanged, and the airbus tension is still unexplained.
- Figure names and float placement are only partly fixed.
- Author placeholders are left in the text.
- The AI-use statement still has to be replaced.

None of these needs new data or a change to a core claim. Each is a condition for submission, but none needs another full panel read.

A mechanical reading of the re-review derivation would give a different answer. REV-04, REV-09, REV-10 and REV-22 each keep a residual that the roadmap classed as must_fix. My recommendation is Minor because every such residual is a bounded edit. The synthesizer decides.

**Grade signal (not computed)**: around 4 (range 3-4) once the residuals are done. Readability is still the first grade-limiting factor: the dense summary tables, long sentences and heavy cross-referencing. The ceiling to 5 is the independence of the readings, which is the Methodology seat's should-fix (X-01 to X-03) and outside this seat.

## Confidence Score
4. Thesis scope, RQ structure, supervisor-request compliance and claim-versus-evidence consistency are within my area. I made no finding that depends on estimation or dataflow details.

## Calibration Status
`NOT_CALIBRATED`

---

## Part 1: Verification of round-1 findings and roadmap items attributed to this seat

Verdict scale: **Addressed** / **Partly addressed** / **Not addressed**. Each row merges one of my round-1 weaknesses with the roadmap item derived from it, so nothing is counted twice. Quotes are from the revised manuscript, at most 15 words, with printed page numbers.

| # | Round-1 finding / roadmap item | Verdict | Revised text (≤15 words, page) | What changed; residual |
|---|---|---|---|---|
| 1 | W1 / REV-04: length and repetition (supervisor's first request) | **Partly** | "with the figures they rest on and their main limit" (Table 7.1 caption, p. 93) | **Done:** body 108 to 89 pp.; extracted body words 45.6k to 37.0k (-19 %). Table 4.5 and 4.3.2 moved to Appendix A, and the approximations list to Appendix B. Sections 2.8 and 2.9 are now about one page each. **Not done:** the acceptance level (body about 80 pp. or fewer) is missed by about 9 pp. The total the supervisor sees moved only from 124 to 117 pp. (-6 %). Table 7.1 keeps both "Key figures" and "Main limit" and grew to about 2.5 pp. (pp. 93-95): the RQ3 key-figures cell alone fills p. 94 and repeats Ch. 5 figure by figure. Table 6.1 still runs pp. 82-89. Caveats are still repeated: "in-sample / fitted to" 12 to 9 times; "own relations" 9 to 9; "close to guaranteed / could hardly fail" 2 to 4. Section 6.1 restates 5.4 on RQ4. **Residual (must_fix):** cut Table 7.1 to the Answer column, about 2 pp. Shorten Table 6.1 rows or move its oracle block to Appendix B, about 3 pp. Fix float placement, about 2 pp. (see row 11). Delete the RQ4 restatement in 6.1. Alternatively, get the supervisor to confirm that 89 pp. is acceptable. |
| 2 | W2 / REV-06: title and contribution order (also round-1 minor: "modest extension" vs abstract) | **Addressed** | Title page: "Measuring Static UI Transition Graph Extraction in Single-Page Applications, with Scope Attribution"; p. 10: "The measurement is the main contribution and scope attribution a modest extension" | The same ordering appears in the abstract, 1.1, 1.3 (p. 12), Ch. 7 ("The primary contribution is the measurement", p. 95; scope attribution is listed fourth) and Fig. 3.1. Section 1.1 gives the evidence size early: 36 sites, 2.0 % over the outlet level (p. 10). |
| 3 | W3 / REV-12: RQ5 "the loss was the tool's" | **Addressed** | p. 75: "answered in three parts, not by one claim that the loss was the tool's" | Table 7.1 (p. 95) answers "Three-way": the tool's, the application's and open, with the 151-construct remainder. The abstract now says "Most causes of loss traced in the source are constructs a static reader can read" (p. 1). That is accurate, because it is about causes. The application side is carried by the 1631/1657 sentence just before it. Residual (minor): the open remainder is not in the abstract. See N8 for a labelling inconsistency. |
| 4 | W4 / REV-11: Section 1.2 aims only | **Partly** | p. 10: "The aim is to measure how far static extraction of a UI transition graph gets" | **Done:** the text of 1.2 is now an aim, five RQs and one short scope paragraph. The "how answered" paragraphs are gone. **Not done:** Fig. 1.1 was not moved to Ch. 4 or merged with Fig. 4.1. In the rendered PDF it floats to the top of p. 11, between RQ1 (p. 10) and RQ2, so 1.2 visibly still contains a method-to-RQ map. The scope paragraph's "(Section 2.6.2)" points to the wrong section (N6). **Residual (should_fix):** place the figure after 1.3 or in Ch. 4. |
| 5 | W5 / REV-10: AI-use statement names no tool, model or version; prose share vague | **Not addressed** (known and intended; counted once here) | pp. 2-3 (unchanged): "An AI coding assistant was used in this work in the ways set out below" | No change, by design. For the rewrite, two further points: (a) the statement's pointer "demotion rules of Section 5.5" is now stale, since the rules are in Section 3.1 and Table 3.2; (b) REV-13's model-identity part ("a stronger model of the same assistant", pp. 70, 72) depends on this rewrite. **Residual: must_fix before submission.** |
| 6 | W6 / REV-07: RQ4 cannot fail | **Addressed** | p. 46: "This is a sanity check of the mapping from a source change to its witness" | Abstract: "Mutation testing only sanity-checks the witness mapping" (p. 1). Section 5.4: "The one denominator used for the headline is the scored mutants, 67/67" (p. 75). Table 7.1 gives 67/67 and 51 vs 50 paired (p. 95). Section 6.1 uses 45 only with "rename excluded" (p. 81). The unlabelled 45/45 is gone. Residual (minor): RQ4 is still worded "as change impact analysis requires" (p. 11), and 6.1 repeats about 0.7 p. of 5.4. |
| 7 | W7 / REV-05: abstract readability | **Partly** | p. 1: "The corpus yields 159 edges that always fire, 33 without an assumed route order" | **Done:** about 360 words (was about 460). Must and may are glossed in plain words ("always fire", "merely possible"). The corrected claims of REV-01, 03, 07 and 12 are carried, and the limits sentence states in-sample and consumer use not measured. **Not done:** it carries 16 numerals in 9 sentences (159, 33, 203, 1631, 1657, 66.7, 38.6, 2.0, 1.7, 18.7, 82.0, 94.1, 10.2, 72.6, 75.2, 6.5), against the target of about 250 words with one number per finding. It also lost three caveats (N3-N5). **Residual (should_fix):** drop the numbers that are not needed to understand the abstract (1657, 1.7/18.7, 72.6/75.2) and restore the order caveat. |
| 8 | W8 / REV-03: Rima comparison is a post-hoc subgroup | **Addressed** | p. 1: "on five applications grouped after reading, its relative recall (share of real transitions either finds" | p. 73 adds "a grouping formed after the results were read", estimated real counts of 1512 and 163, and Wilson-end ranges. "The pooled comparison does not rank the tools" appears in the abstract, 5.3.8 and Table 7.1. Both precisions are given; "similar precision" is gone. Relative recall is defined at first use in the abstract. Mifos stratum sizes are still not given. That part belongs to R1's REV-03 and was not part of my W8. |
| 9 | W9 / REV-09: services novelty against the airbus evidence | **Partly** | Table 7.1, p. 94: "Among the published rules of earlier work only it places navigation inside services." | **Done:** the claim is narrowed to the published specification (2.4, p. 16; 5.3.7, p. 71: "the construct the specification's rule does not follow"). The evidence size is given (36 sites, 2.0 %, 20/48, 7 sites over the class join). The levels are labelled as reimplementations, "not runs of either tool" (p. 66). **Not done:** (a) The text still does not explain how their tool holds the 3 airbus reference pairs. Table 5.18 gives their tool 100.0 % recall on airbus (p. 73), and p. 70 says it holds every pair "by construction". (b) Which "three airbus pairs from the sign-in screen" (p. 72) the repair removed can only be pieced together from Table 5.17 (airbus other pairs 17/20) and Appendix A (p. 111). The main text still reads as if reference pairs were lost. (c) Ch. 7 keeps the sentence the editor asked to withhold: "accounts for the transitions it adds over their rules on their own subjects" (p. 96). (d) The abstract calls it "its one new step" without the specification qualifier. Because the contribution is now reframed, I lower this from Major to **Minor**. **Residual (should_fix):** one explanatory sentence in 5.3.7 (or run X-08), "other pairs" made explicit, and the Ch. 7 sentence qualified to "over their specification's rules, on 3 pairs of one application". |
| 10 | W10 / REV-01: RQ1 headline is largely definitional | **Addressed** | p. 56: "The small must tier is therefore largely a matter of definition" | The abstract (p. 1), 6.1 (p. 82) and Table 7.1 (p. 93: "largely by definition") now agree. Sensitivity 33/159/203 is in the abstract and Table 7.1. Assumptions A1-A4 are stated with counterexamples and edge counts (p. 28). Table 7.1 gives "125 from one toolbar" and the 62 unread. The census limit stays next to the claim (p. 56). Residual (minor): the abstract's "159 edges that always fire" states the extractor's claim as a fact. The 203 figure has no source in the results chapter (N6). |
| 11 | W11 / REV-22: figure and table naming, denominators, placement | **Partly** | Fig. 4.2 note, p. 50: "The fifth method, the runtime route probe, is not drawn" | **Done:** the body text uses "runtime route oracle" consistently. The 45 vs 67 issue is resolved (row 6). Table 5.5's column keys are spelled out in its note. Table 2.1 now fits on one page (p. 24). **Not done:** (a) Fig. 1.1 still labels a box "runtime probe" (p. 11, source `fig-overview.tex:27`), and Table 4.4 says "Differential test" where Figs. 1.1 and 4.1 say "route parser" / "independent route parser". (b) Table 5.1 still uses "kdash" (p. 56). (d) Float placement is still poor in the rendered PDF: Tables 4.1-4.3 are deferred to the end of the chapter (pp. 52-54, cited from p. 41 onward), leaving p. 51 with 7 lines. Algorithm 1 sits after the Ch. 3 summary on p. 40, leaving p. 39 with 5 lines. Table 6.1's caption, header and "Internal validity" label are orphaned at the foot of p. 82. Fig. 1.1 splits the RQ list. (e) Table 5.7 keeps its two-level header. **Residual (must_fix, supervisor request):** one name per method in the figures, and float placement fixed. That fix also recovers about 2 pp. for row 1. |
| 12 | REV-13 (my traceability part of W5): which figures are model readings | **Partly** | p. 74: "with the reading's verdict in view, so not blind to it" | **Done:** the abstract flags "as an AI model read them" (p. 1). Change rates 3/45 and 10/114 and the Wilson interval for 41/41 are given (pp. 72, 74). **Not done:** whether the proposing tool was shown to the author is left as a placeholder, "[author: state whether the proposing tool was shown]" (Table 6.1, p. 88). The model's identity depends on the AI-statement rewrite (row 5). |
| 13 | REV-17 (D2, where my S4 was cited): "usable" basis vs untested consumers | **Addressed** | p. 96: "The may tier is a candidate generator whose edges a consumer must still check" | The abstract ends with "consumer use is not measured" (p. 1). "Usable" is gone. Ch. 7 separates may (candidates) from must (25 constructs). |
| 14 | Round-1 minor / REV-23: abbreviations | **Addressed** | p. 4 list: "NgRx Angular state-management library built on RxJS" | Ajax, NgRx, SPIN and ZAP were added and MVC dropped. I found no undefined abbreviation in the body: E2E and LLM occur only in bibliography titles. |
| 15 | Round-1 minor: long, many-clause sentences | **Not addressed** | p. 82: "Only the must tier is meant as a lower bound on the navigation an application" | This is a rough count that includes table text, so it is indicative only. Mean sentence length went from 26.6 to 27.6 words, and sentences over 40 words from 14.9 % to 15.8 %. The quoted sentence runs more than 60 words. |
| 16 | Round-1 minor: heavy cross-referencing | **Not addressed** | (count) | "Section n" references went from 237 to 242 while the body shrank by 19 %. Ch. 5 still carries several per paragraph. |
| 17 | Round-1 minor: Table 2.1 split across pages | **Addressed** | Table 2.1, p. 24: "Prior work closest to this thesis, by target, extraction mode" | It now fits on one page. |

**Tally (17 items):** 8 addressed (2, 3, 6, 8, 10, 13, 14, 17); 6 partly addressed (1, 4, 7, 9, 11, 12); 3 not addressed (5, 15, 16). Item 5 is the known AI-use deferral, counted once.

**Round-1 strengths, re-checked:**
- S1, transparency: kept, now in Appendix A.
- S2, the RQ-to-measure Table 4.2: kept, p. 53.
- S3, the preregistered comparison that runs their tool: kept, 5.3.7-5.3.8.
- S4, the calibrated closing sentence: kept and sharpened, p. 96.

---

## Part 2: New issues introduced by the revision

All new issues are Minor by decision impact. None adds an overclaim of Major weight. N1 must still be fixed before submission.

### N1: Author placeholders and to-do notes left in the text
- **Severity**: Minor (blocks submission as a matter of hygiene)
- **Evidence Anchor**: text: p. 50 "[author: archive DOI; a repository URL would name the extractor]"
- **Detail**: There are three bracketed notes to the author: p. 50 twice (DOI; "[author: confirm, per rima/PREREGISTRATION.txt:27]") and p. 88 (Table 6.1, the proposing-tool question). Table 4.1's note also says "(confirm at the pinned commits)" (p. 52). An examiner reading these will conclude the text is not final. They also mean the artifact is still not identifiable, so R3's REV-18 is not closed.
- **Fix**: Resolve each note or delete it, and grep the sources for `[author:` before printing.
- **Confidence**: 5, directly checkable.

### N2: Relation count is inconsistent after the Ch. 3 rework
- **Severity**: Minor
- **Evidence Anchor**: text: p. 39 "as a least fixpoint over four input relations"
- **Detail**: Section 3.2 now specifies "three input relations", all implemented, plus "Two further relations, dispatch (D) and guards (T)" (pp. 30-31). That makes five. Section 3.4 (p. 39), 6.4 ("the four input relations", p. 90) and the Ch. 7 contribution statement ("three of its four input relations", p. 96) still say four. The contribution statement is the place a reader will quote.
- **Fix**: Settle the count once and use it in 3.2, 3.4, 6.4 and Ch. 7.
- **Confidence**: 4.

### N3: The abstract lost the loss-rule-order caveat
- **Severity**: Minor
- **Evidence Anchor**: text: p. 1 "The largest category is navigation that belongs to no single screen"
- **Detail**: The round-1 abstract qualified this with "under the order of the loss rules", and 1.1 still does (p. 10). Section 5.2 says the ranking flips on alfresco and k8s dashboard if the target is tested first (p. 58). The cut removed the qualifier, so the abstract now says more than Ch. 5.
- **Fix**: Add "under the order of the loss rules".
- **Confidence**: 5.

### N4: The abstract's RQ3 precision contrast has no comparator
- **Severity**: Minor
- **Evidence Anchor**: text: p. 1 "but its precision against a reference read from one application's source is 82.0 %"
- **Detail**: The "but" tells the reader nothing without the comparator: the class join's 92.3 %, and 100.0 % for the lower levels (Table 5.14, p. 66). The cut also dropped the round-1 caveat that both references apply the analysis's own relations. The figure given is the unfavourable one, so this is not an overclaim. It is an unreadable claim. REV-02's acceptance criterion asked for the reversal itself, not only the number. That item is not mine to grade, but the gap is visible from my seat.
- **Fix**: Change to "82.0 %, below the 92.3 % of a simpler per-class join, against a reference that applies the analysis's own relations".
- **Confidence**: 4.

### N5: The abstract leads with the pooled figure that the thesis itself says is not primary
- **Severity**: Minor
- **Evidence Anchor**: text: p. 42 "per-application figures are the primary summary where the chapters give them"
- **Detail**: Section 4.1.2 and Table 6.1 (p. 86, "the per-application median, 40.2 %, is the primary summary") make the median primary. The abstract and Table 7.1 lead with the pooled 66.7 % and give the without-mifos 38.6 % second. The median (40.2 %, range 14.3-100 %) is in neither the abstract nor the first sentence of the Ch. 7 answer. I recomputed the median from Table 5.7, and 40.2 % is correct.
- **Fix**: Either lead with the median in the abstract, or drop the "primary summary" wording in 4.1.2 and Table 6.1.
- **Confidence**: 4.

### N6: Cross-references mis-pointed after the restructuring
- **Severity**: Minor
- **Evidence Anchor**: text: p. 82 "raises the tier from 159 to 203 edges (Section 5.5)"
- **Detail**: There are three such references:
  - **p. 82:** 203 does not appear in Section 5.5, or anywhere in Ch. 5. The figure is now in the abstract and Table 7.1, but its only body occurrence is this sentence, so the sensitivity number has no results-chapter source.
  - **p. 11:** "lists what it approximates (Section 2.6.2)" points to the soundiness background (`\ref{sec:soundiness}`, ch1 l. 123). The list is Section 6.3 and Appendix B.
  - **p. 30:** "a mutation sweep deletes each rule ... (Section 5.5)". The sweep is reported only in Table A.1 (p. 110).
- **Fix**: Report 203 (and 33) in 5.1 next to Table 5.1, and repoint the two references.
- **Confidence**: 5.

### N7: Flow artefacts from the cuts
- **Severity**: Minor
- **Evidence Anchor**: text: p. 66 "barely exercises the step only this thesis adds: 16 sites and 174 pairs"
- **Detail**: Four places read as cut damage:
  - **p. 66:** the 16 sites and 174 pairs are alfresco's, but the sentence now attaches them to realworld (ch5 l. 375).
  - **p. 31:** "On it no application is without edges." is unparseable.
  - **p. 70:** "Oshima and Kishi's restrictions admit 0 of the 6 corpus applications." is a stray last line that repeats the bullet above it.
  - **p. 92:** Section 6.6, "Summary", is two sentences and does not summarise the chapter.
- **Fix**: Repair these four places in a read-through.
- **Confidence**: 5.

### N8: "Open" names two different things in RQ5
- **Severity**: Minor
- **Evidence Anchor**: text: p. 76 "Still not read (open). The final version does not read these causes."
- **Detail**: Under this heading, 5.5.1 lists named outlets and ghostfolio's route spread. The thesis calls both tool-side ("could read and does not"). The three-part RQ5 answer on p. 75 and in Table 7.1 (p. 95) uses "Open" for the attribution remainder and runtime-only destinations. A reader will mix up the cause trace (read / unread / beyond) with the RQ5 answer (tool / application / open).
- **Fix**: Rename the heading to "Still not read by the final version".
- **Confidence**: 4.

### N9: Positioning sentence on Rima et al. reads as self-contradictory (pre-existing, noticed now)
- **Severity**: Minor
- **Evidence Anchor**: text: p. 16 "The specification excludes router-outlet modelling and provider resolution beyond module"
- **Detail**: Fig. 3.1 (p. 36) labels outlet descent "(Rima et al.)". Section 5.3.3 says their specification closes over ancestor routes, "which is what outlet adds" (p. 66). If "router-outlet modelling" means named outlets, say so. This sentence carries the narrowed novelty claim of row 9. The Domain seat is better placed to judge it.
- **Confidence**: 3.

---

## Criterion-Bound Judgements (round 2)

| Dimension / criterion | Criterion source | Judgement | Evidence anchors | Rationale | Uncertainty / scope limit | Decision bearing? |
|---|---|---|---|---|---|---|
| RQ clarity and answerability at master's scope | EIC card (1) | MEETS | text: p. 46 "This is a sanity check of the mapping"; p. 75 "answered in three parts" | RQ4 is reframed as a sanity check and RQ5 answered three-way. Every RQ answer in Table 7.1 matches Ch. 5. | RQ4's wording on p. 11 still invokes change impact. | no |
| Contribution is the author's own and correctly scoped | EIC card (2) | MEETS | text: title; p. 95 "The primary contribution is the measurement" | Title, 1.1, 1.3, abstract and Ch. 7 agree. The modest size of the service join is stated early. | Services-novelty residual (row 9). | no |
| Shorten considerably | Supervisor, 4 Nov | PARTLY_MEETS | absence: pp. 8-96 — expected body ≤ about 80 pp.; checked page count, Table 7.1 pp. 93-95, Table 6.1 pp. 82-89 | 108 to 89 body pp. (-18 %); total 124 to 117. | The supervisor gave no number. | yes, as a submission condition |
| One-page abstract, readable | Supervisor, 4 Nov | MEETS (page); PARTLY_MEETS (readability) | text: p. 1 "The corpus yields 159 edges that always fire" | One page, about 360 words, 16 numerals; three caveats lost (N3-N5). | | no |
| Precise AI-use statement | Supervisor, 4 Nov | DOES_NOT_MEET (deferred by design) | text: p. 2 "An AI coding assistant was used in this work" | Unchanged; the rewrite is pending. | Rewrite not seen. | yes, as a submission condition |
| Abbreviations | Supervisor, 4 Nov | MEETS | text: p. 4 list | Missing terms added, single-use MVC dropped. | | no |
| Section 1.2 aims only | Supervisor, 4 Nov | PARTLY_MEETS | text: p. 10 "The aim is to measure"; figure: Fig. 1.1 on p. 11 | The text is aims-only, but the figure floats into the RQ list. | | no |
| Figure and table fixes | Supervisor, 4 Nov | PARTLY_MEETS | figure: Fig. 4.2 note p. 50; Fig. 1.1 p. 11 | Denominators fixed; method names in the figures and float placement not fixed. | Checked four rendered pages, not all of them. | yes (minor) |
| Abstract and Ch. 7 claims match Ch. 5 | EIC card | PARTLY_MEETS | text: p. 96 "accounts for the transitions it adds over their rules" | All six round-1 overclaims are fixed. Residuals: the Ch. 7 services sentence and the abstract's lost order caveat. | | no (minor) |
| 117 pages justified | EIC card | PARTLY_MEETS | table: Table 7.1 pp. 93-95; Table 6.1 pp. 82-89 | About 10 pp. of summary tables restate Ch. 5, and about 2 pp. are lost to float placement. | | no |

## Summary Assessment

The revised thesis says what it measured and claims no more than Ch. 5 shows on every point I raised as decision-bearing in round 1:
- The title and contribution order put the measurement first.
- The deterministic tier is presented as largely definitional, with its sensitivity range.
- The mutation result is a sanity check.
- RQ5 has a three-part answer.
- The Rima et al. comparison is labelled post hoc and explicitly does not rank the tools.
- Section 1.2 is aims-only in its text.

These were the substantive changes, and they are done well and consistently across the abstract, Ch. 5, Ch. 6 and Table 7.1. I spot-checked the median, the width range, the edge counts and the comparison figures against their tables, and they match.

What is left is presentation:
- The body is still about 9 pages over the agreed target. The two summary tables (7.1 and 6.1) are the obvious place to cut.
- The abstract still carries too many numbers.
- The services-novelty point needs one explanatory sentence and a qualified Ch. 7 sentence.
- Figure names and float placement need fixing.
- The cut introduced small artefacts: placeholders, a relation-count mismatch, mis-pointed references and two garbled sentences.

Together with the AI-use rewrite, these are a few days of editing, not another revision cycle. Minor Revision.

## Questions for the Author
1. Has the supervisor confirmed that 89 body pages (117 in total) is acceptable? If not, will you reduce Table 7.1 to its Answer column and compress Table 6.1?
2. How does Rima et al.'s tool reach the three airbus reference pairs if its specification does not follow calls into services?
3. Were the three airbus pairs that the repair removed reference pairs or other pairs? Please say so in 5.3.7.
4. How many input relations does the model have: four or five?

## Minor Issues (not counted above)
- Table 5.7's two-level header is still hard to parse. One header row with the RQ named in the caption would be enough.
- Section 4.3 says "Five methods are used; RQ3 adds four further checks". Fig. 1.1 draws six boxes, with a note explaining that one is not a method. Drawing the loss breakdown visibly differently would remove the need for the note.

## Recommendation (one line)
Minor Revision: remove the placeholders, replace the AI-use statement, cut about 9-10 more pages from the summary tables and float placement (or confirm 89 pp. with the supervisor), qualify the Ch. 7 services sentence and explain the airbus pairs, fix the figure names, and repair N2-N8.
